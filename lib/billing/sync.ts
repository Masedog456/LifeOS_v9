import "server-only";

/**
 * The one subscription synchroniser (LIFEOS-BILLING §14, §15, §16).
 *
 * Every handled Stripe event ends here, and every one of them takes the same
 * three steps:
 *
 *   1. find the subscription id the event is about
 *   2. RE-READ that subscription from Stripe
 *   3. project it and write the projection
 *
 * §14 forbids duplicating business logic per event, and this is how: the six
 * event types differ only in where step 1 finds the id.
 *
 * ## Why step 2 exists
 *
 * Stripe does not guarantee delivery order (§16). A `customer.subscription.
 * updated` carrying a cancellation can arrive after the `deleted` that followed
 * it, and an event body is a snapshot of the moment it was generated. Reading
 * the subscription back means what we store is Stripe's CURRENT answer, not a
 * possibly-stale echo — so ordering stops mattering for correctness rather than
 * being compensated for.
 *
 * It also collapses the `invoice.paid` / `invoice.payment_failed` cases, which
 * carry an Invoice and no subscription state at all, into the same path as the
 * rest. A payment failure is interesting only because it changes the
 * subscription's status, and after step 2 that status is simply read.
 *
 * The monotonic guard in the database is kept anyway, for the narrow race where
 * two deliveries are re-read concurrently and finish out of order.
 *
 * ## Idempotency (§15)
 *
 * Falls out of the design rather than needing infrastructure. The user is the
 * primary key of the projection, so a redelivered event rewrites the same row
 * with the same values. There is no processed-event ledger because there is
 * nothing a second delivery could duplicate.
 */

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { applySubscription, readUserIdByCustomer } from "@/lib/billing/store";
import {
  classifyEvent,
  customerIdOf,
  metadataUserId,
  projectSubscription,
  subscriptionIdFromEvent,
  type EventObjectLike,
} from "@/lib/billing/projection";

export type SyncOutcome =
  | { ok: true; applied: true; userId: string; status: string }
  | { ok: true; applied: false; reason: "ignored_event" | "no_subscription" | "unknown_user" }
  | { ok: false; reason: "stripe_unavailable" | "stripe_error" | "store_unavailable" | "store_error"; detail?: string };

/**
 * Process one signature-verified Stripe event.
 *
 * ## The two kinds of "we did nothing"
 *
 * `{ ok: true, applied: false }` means the event was understood and correctly
 * produced no change — an event type we do not handle, a session that created
 * no subscription, a customer we have never seen. The route answers 200: a
 * retry would reach the same conclusion, and a non-2xx would make Stripe retry
 * it for days and eventually disable the endpoint.
 *
 * `{ ok: false }` means we could not do the work — Stripe unreachable, the
 * store unavailable, a query that failed. The route answers 500 so that Stripe
 * DOES retry, because a retry is exactly what should happen.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<SyncOutcome> {
  const kind = classifyEvent(event.type);
  if (kind === "ignored") return { ok: true, applied: false, reason: "ignored_event" };

  const object = event.data.object as unknown as EventObjectLike;
  const subscriptionId = subscriptionIdFromEvent(kind, object);
  if (!subscriptionId) return { ok: true, applied: false, reason: "no_subscription" };

  const stripe = getStripe();
  if (!stripe) return { ok: false, reason: "stripe_unavailable" };

  let subscription: Stripe.Subscription;
  try {
    // The period now lives on the items, so they must come back with it.
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
  } catch (error) {
    // Only the error's class is recorded. A Stripe error body can echo request
    // parameters, and those are never worth putting in a log (§13, §23).
    return { ok: false, reason: "stripe_error", detail: errorCode(error) };
  }

  const projected = projectSubscription(subscription, process.env);
  if (!projected.ok) return { ok: true, applied: false, reason: "no_subscription" };

  const userId = await resolveUserId(projected.subscription.stripeCustomerId, subscription, object);
  if (userId.ok === false) return userId.failure;
  if (userId.value === null) return { ok: true, applied: false, reason: "unknown_user" };

  const written = await applySubscription(
    userId.value,
    projected.subscription,
    new Date(event.created * 1000),
  );
  if (!written.ok) {
    return written.reason === "unavailable"
      ? { ok: false, reason: "store_unavailable" }
      : { ok: false, reason: "store_error", detail: written.detail };
  }

  return { ok: true, applied: true, userId: userId.value, status: written.value.status };
}

/**
 * Which LifeOS user this Stripe customer is.
 *
 * The stored `stripe_customer_id` is authoritative: our own server wrote it
 * from a server-resolved session before the Checkout Session existed, so it is
 * the mapping that cannot have been influenced by anything the browser said.
 *
 * Stripe metadata is a fallback for the one case the stored mapping cannot
 * cover — a subscription created outside our checkout flow, for instance by the
 * founder in the Stripe dashboard, where the row does not exist yet. It is
 * safe to consult *here* and only here: this code path runs after the webhook
 * signature has been verified, so the metadata provably came back from Stripe
 * and was put there by our own checkout call. It is never read from a request
 * body.
 */
async function resolveUserId(
  customerId: string,
  subscription: Stripe.Subscription,
  eventObject: EventObjectLike,
): Promise<{ ok: true; value: string | null } | { ok: false; failure: SyncOutcome }> {
  const stored = await readUserIdByCustomer(customerId);
  if (!stored.ok) {
    return {
      ok: false,
      failure: stored.reason === "unavailable"
        ? { ok: false, reason: "store_unavailable" }
        : { ok: false, reason: "store_error", detail: stored.detail },
    };
  }
  if (stored.value) return { ok: true, value: stored.value };

  // Subscription metadata, then the Checkout Session's metadata — Stripe does
  // not copy session metadata onto the subscription, so a subscription created
  // through our own checkout carries it only if we set it on both, which
  // `app/api/billing/checkout/route.ts` does.
  const fromSubscription = metadataUserId(subscription);
  if (fromSubscription) return { ok: true, value: fromSubscription };

  const sessionMetadata = eventObject.metadata;
  const fromSession = metadataUserId({
    id: "",
    status: "",
    cancel_at_period_end: false,
    customer: customerIdOf(subscription.customer),
    metadata: sessionMetadata ?? null,
  });
  return { ok: true, value: fromSession };
}

/** A short, non-identifying label for an error. Never its message. */
function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { type?: unknown; code?: unknown };
    if (typeof e.type === "string") return e.type;
    if (typeof e.code === "string") return e.code;
  }
  return "unknown";
}
