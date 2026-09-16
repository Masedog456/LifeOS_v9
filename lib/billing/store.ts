import "server-only";

/**
 * Reads and writes of the canonical billing projection (LIFEOS-BILLING §6, §15).
 *
 * The ONLY module that touches `billing_subscriptions` with write authority.
 * Everything here goes through the privileged client in `lib/billing/admin.ts`
 * and through the two guarded functions migration 0048 defines; nothing here
 * issues a bare INSERT or UPDATE, because the ordering guard and the
 * idempotency both live inside those functions.
 *
 * Reads for the UI do NOT come through here. The browser reads the person's own
 * row with the ordinary anon key under RLS, which is both simpler and stricter:
 * the policy makes it impossible to ask for anyone else's row, so there is no
 * server-side ownership check that could be written wrong.
 *
 * Every function reports failure as a value. Supabase's client returns
 * `{ error }` rather than throwing, and an unchecked call here would let a
 * failed billing write look like a successful one — which would show a paying
 * customer the pricing page.
 */

import { getBillingAdminClient } from "@/lib/billing/admin";
import type { BillingPlan } from "@/lib/billing/plans";
import type { SubscriptionProjection } from "@/lib/billing/entitlement";
import type { CanonicalSubscription } from "@/lib/billing/projection";

/** The row shape as the database stores it. */
interface BillingRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  last_event_at: string | null;
}

const ROW_COLUMNS =
  "user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, status, current_period_end, cancel_at_period_end, last_event_at";

export interface StoredSubscription extends SubscriptionProjection {
  userId: string;
}

/** Map a row to the projection the entitlement predicate consumes. */
export function rowToProjection(row: BillingRow): StoredSubscription {
  return {
    userId: row.user_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    plan: row.plan === "monthly" || row.plan === "annual" ? (row.plan as BillingPlan) : null,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

export type StoreFailure = "unavailable" | "query_failed";

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: StoreFailure; detail?: string };

/**
 * The subscription row for a user, or null when they have none.
 *
 * "No row" is a success with a null value, not a failure. A person who has
 * never subscribed is an ordinary state, and conflating it with a database
 * error would make an outage look like a lapsed subscription.
 */
export async function readSubscriptionByUser(userId: string): Promise<StoreResult<StoredSubscription | null>> {
  const client = getBillingAdminClient();
  if (!client) return { ok: false, reason: "unavailable" };

  const { data, error } = await client
    .from("billing_subscriptions")
    .select(ROW_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false, reason: "query_failed", detail: error.code ?? "unknown" };
  return { ok: true, value: data ? rowToProjection(data as BillingRow) : null };
}

/**
 * The user a Stripe customer belongs to.
 *
 * This is the authoritative webhook→user mapping: it was written by our own
 * server, from a server-resolved session, before the Checkout Session existed.
 */
export async function readUserIdByCustomer(customerId: string): Promise<StoreResult<string | null>> {
  const client = getBillingAdminClient();
  if (!client) return { ok: false, reason: "unavailable" };

  const { data, error } = await client
    .from("billing_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) return { ok: false, reason: "query_failed", detail: error.code ?? "unknown" };
  return { ok: true, value: (data as { user_id: string } | null)?.user_id ?? null };
}

/**
 * Bind a Stripe customer to a user and return the id that actually won.
 *
 * The return value is not the argument: if a concurrent checkout got there
 * first, the stored id stands and the caller must use it (§11). Using the
 * argument regardless is how an account ends up with two Stripe customers and a
 * subscription on the one nobody looks at.
 */
export async function attachStripeCustomer(userId: string, customerId: string): Promise<StoreResult<string>> {
  const client = getBillingAdminClient();
  if (!client) return { ok: false, reason: "unavailable" };

  const { data, error } = await client.rpc("attach_stripe_customer", {
    p_user_id: userId,
    p_customer_id: customerId,
  });

  if (error) return { ok: false, reason: "query_failed", detail: error.code ?? "unknown" };
  const effective = typeof data === "string" && data.trim() ? data.trim() : null;
  if (!effective) return { ok: false, reason: "query_failed", detail: "no_customer_returned" };
  return { ok: true, value: effective };
}

/**
 * Apply a projected Stripe subscription to the canonical row.
 *
 * `eventAt` is the Stripe event's `created` time; the database uses it to
 * ignore an event older than the one already applied. Passing `new Date()`
 * here would defeat that guard, so the caller always passes the event's own
 * timestamp.
 */
export async function applySubscription(
  userId: string,
  subscription: CanonicalSubscription,
  eventAt: Date,
): Promise<StoreResult<StoredSubscription>> {
  const client = getBillingAdminClient();
  if (!client) return { ok: false, reason: "unavailable" };

  const { data, error } = await client.rpc("apply_stripe_subscription", {
    p_user_id: userId,
    p_customer_id: subscription.stripeCustomerId,
    p_subscription_id: subscription.stripeSubscriptionId,
    p_price_id: subscription.stripePriceId,
    p_plan: subscription.plan,
    p_status: subscription.status,
    p_current_period_end: subscription.currentPeriodEnd,
    p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
    p_event_at: eventAt.toISOString(),
  });

  if (error) return { ok: false, reason: "query_failed", detail: error.code ?? "unknown" };
  if (!data) return { ok: false, reason: "query_failed", detail: "no_row_returned" };
  return { ok: true, value: rowToProjection(data as BillingRow) };
}
