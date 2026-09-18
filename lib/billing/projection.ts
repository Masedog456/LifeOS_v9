/**
 * Stripe subscription → canonical LifeOS projection (LIFEOS-BILLING §6, §14, §16).
 *
 * ONE translation, used by every webhook event. §14 is explicit that business
 * logic must not be duplicated per event type, so no handler builds a row of
 * its own: `customer.subscription.created`, `.updated`, `.deleted`,
 * `checkout.session.completed`, `invoice.paid` and `invoice.payment_failed` all
 * end up calling `projectSubscription` on a Stripe Subscription object and
 * writing the result.
 *
 * ## Structural, not nominal, input
 *
 * The parameter type describes the *shape* this module reads rather than
 * importing `Stripe.Subscription`. That keeps the module free of the Stripe SDK
 * — so it is pure, client-safe and testable with plain object literals — while
 * still type-checking against a real Stripe object at the call site, because a
 * `Stripe.Subscription` structurally satisfies it.
 *
 * ## Where `current_period_end` lives now
 *
 * It is NOT on the Subscription object. Stripe moved the billing period onto
 * subscription *items*; on API version `2026-08-26.dahlia` the field exists
 * only at `subscription.items.data[].current_period_end`. Code written against
 * older examples reads `subscription.current_period_end`, gets `undefined`,
 * and quietly stores a null period — which then disables the staleness guard in
 * `entitlement.ts` and makes a frozen projection look healthy. This module
 * derives the period from the items, and the self-test pins that behaviour.
 *
 * We take the EARLIEST item period end. Conqify sells single-item
 * subscriptions, so in practice there is exactly one; taking the minimum is the
 * conservative reading if that ever stops being true.
 */

import { planForPriceId, type BillingPlan, type PriceEnv } from "@/lib/billing/plans";

/** The subset of a Stripe Subscription this projection reads. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  customer: string | { id: string } | null;
  metadata?: { [key: string]: string } | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      price?: { id?: string | null } | null;
    } | null> | null;
  } | null;
}

export interface CanonicalSubscription {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  plan: BillingPlan | null;
  status: string;
  /** ISO-8601, or null when no item reports a period. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Read a customer id whether Stripe expanded the customer or not. */
export function customerIdOf(customer: string | { id: string } | null | undefined): string | null {
  if (!customer) return null;
  if (typeof customer === "string") return customer.trim() || null;
  return typeof customer.id === "string" && customer.id.trim() ? customer.id.trim() : null;
}

/**
 * The earliest `current_period_end` across the subscription's items, as an ISO
 * string — or null when no item carries one.
 *
 * Epoch seconds, not milliseconds: Stripe timestamps are seconds, and a missing
 * `* 1000` produces a date in 1970 that the staleness guard would read as a
 * very expired subscription.
 */
export function periodEndOf(sub: StripeSubscriptionLike): string | null {
  const items = sub.items?.data ?? [];
  let earliest: number | null = null;
  for (const item of items) {
    const end = item?.current_period_end;
    if (typeof end !== "number" || !Number.isFinite(end) || end <= 0) continue;
    if (earliest === null || end < earliest) earliest = end;
  }
  if (earliest === null) return null;
  return new Date(earliest * 1000).toISOString();
}

/** The price id of the subscription's first item, if it has one. */
export function priceIdOf(sub: StripeSubscriptionLike): string | null {
  for (const item of sub.items?.data ?? []) {
    const id = item?.price?.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

/**
 * The LifeOS user this subscription belongs to, as recorded in Stripe metadata
 * when the Checkout Session was created (§10).
 *
 * This is a *hint* for mapping a webhook back to a user, never an authorisation
 * claim: it was written by our own server from a server-resolved session, and
 * the webhook that reads it has already been signature-verified. The
 * authoritative mapping is still the `stripe_customer_id` we stored at checkout
 * time; this covers the case where a subscription arrives before that row does.
 */
export function metadataUserId(sub: StripeSubscriptionLike): string | null {
  const raw = sub.metadata?.[SUBSCRIPTION_USER_METADATA_KEY];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // A uuid, or nothing. Anything else did not come from us.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
}

/**
 * The single metadata key Conqify writes onto Stripe objects.
 *
 * It holds a Supabase auth user id — an opaque uuid, which is deliberately the
 * *least* identifying thing that still works. §10 forbids putting sensitive
 * information in Stripe metadata, so no email, no name, and nothing about what
 * the person keeps in LifeOS ever goes here.
 */
export const SUBSCRIPTION_USER_METADATA_KEY = "lifeos_user_id";

export type ProjectionResult =
  | { ok: true; subscription: CanonicalSubscription }
  | { ok: false; reason: "no_customer" };

/**
 * Translate a Stripe Subscription into the canonical projection.
 *
 * Fails only when the subscription has no customer, which cannot happen for a
 * real Stripe subscription but would otherwise produce a row with no owner.
 */
export function projectSubscription(sub: StripeSubscriptionLike, env: PriceEnv): ProjectionResult {
  const stripeCustomerId = customerIdOf(sub.customer);
  if (!stripeCustomerId) return { ok: false, reason: "no_customer" };

  const stripePriceId = priceIdOf(sub);
  return {
    ok: true,
    subscription: {
      stripeCustomerId,
      stripeSubscriptionId: sub.id,
      stripePriceId,
      plan: planForPriceId(stripePriceId, env),
      // Stored verbatim. `entitlement.ts` owns the decision about what a status
      // means; storing a normalised or pre-judged value here would put that
      // decision in two places.
      status: sub.status,
      currentPeriodEnd: periodEndOf(sub),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    },
  };
}

// --------------------------------------------------------------- events ----

/**
 * The Stripe events Conqify subscribes to, and what each one is for.
 *
 * Kept to the minimum that establishes subscription truth (§14). Every entry
 * exists because it changes what we store; nothing is here "for completeness".
 */
export const HANDLED_EVENT_TYPES = [
  // The session carries the subscription id and our metadata; it is the first
  // moment we can bind a Stripe customer to a LifeOS user.
  "checkout.session.completed",
  // The three that carry a Subscription object directly.
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Renewal outcomes. They carry an Invoice, not a Subscription, so the handler
  // re-reads the subscription from Stripe — which is also what §16 asks for as
  // the defence against out-of-order delivery.
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export type EventKind = "checkout" | "subscription" | "invoice" | "ignored";

/** The shapes `subscriptionIdFromEvent` reads, described structurally. */
export interface EventObjectLike {
  /** Checkout Session: the subscription it created. */
  subscription?: string | { id?: string | null } | null;
  /** Subscription events: the object IS the subscription. */
  id?: string | null;
  object?: string | null;
  /** Invoice: the subscription that generated it. */
  parent?: {
    subscription_details?: { subscription?: string | { id?: string | null } | null } | null;
  } | null;
  /** Checkout Session metadata, which Stripe does not copy to the subscription. */
  metadata?: { [key: string]: string } | null;
}

function idOf(value: string | { id?: string | null } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  return typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
}

/**
 * The subscription id an event is about, or null when it is about none.
 *
 * Three event families keep the subscription id in three different places, and
 * this is the only function that knows where. On the pinned API version an
 * Invoice points at its subscription through `parent.subscription_details`, not
 * through a top-level `subscription` field — code written against the older
 * shape silently finds nothing and treats every renewal as unremarkable.
 *
 * A one-off Checkout Session in `payment` mode, and an invoice with no
 * subscription parent, both legitimately return null. They are not failures;
 * Conqify simply has nothing to record about them.
 */
export function subscriptionIdFromEvent(kind: EventKind, object: EventObjectLike): string | null {
  switch (kind) {
    case "checkout":
      return idOf(object.subscription);
    case "subscription":
      return idOf(object.id);
    case "invoice":
      return idOf(object.parent?.subscription_details?.subscription);
    case "ignored":
      return null;
  }
}

/**
 * Classify an event type into the three code paths.
 *
 * Pure, so the routing table is testable without constructing Stripe events.
 * Unknown types classify as `ignored`: Stripe can add event types at any time
 * and an endpoint that 500s on one it does not recognise will be retried,
 * throttled, and eventually disabled.
 */
export function classifyEvent(type: string): EventKind {
  switch (type) {
    case "checkout.session.completed":
      return "checkout";
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return "subscription";
    case "invoice.paid":
    case "invoice.payment_failed":
      return "invoice";
    default:
      return "ignored";
  }
}
