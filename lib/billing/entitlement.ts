/**
 * The one entitlement predicate (LIFEOS-BILLING §2, §8).
 *
 * LifeOS's architectural rule is *one projection, one predicate, one dependency
 * index*. Billing follows it: there is exactly ONE canonical subscription
 * projection (`billing_subscriptions`) and exactly ONE function that decides
 * whether it grants paid access — `hasPaidAccess`. Nothing anywhere else in the
 * codebase may compare a status string to `"active"`.
 *
 * The reason is not tidiness. A scattered `status === "active"` check gets the
 * `cancel_at_period_end` case wrong (the customer has cancelled but has paid
 * through the period and must keep access), gets `past_due` wrong in whichever
 * direction the author happened to assume, and silently disagrees with the next
 * copy of the check somebody writes. One predicate can only be wrong once, and
 * it can be tested exhaustively — which `billing/selftest.ts` does, for every
 * status Stripe defines.
 *
 * This module is PURE and client-safe. It holds no secret, reads no global, and
 * performs no I/O.
 */

import type { BillingPlan } from "@/lib/billing/plans";

/**
 * Every subscription status the Stripe API can report, as of API version
 * `2026-08-26.dahlia`. Listed explicitly so that a status Stripe adds later
 * fails the exhaustiveness test in the self-test rather than quietly falling
 * into whichever branch happens to catch it.
 */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The canonical subscription projection, as the product sees it.
 *
 * Deliberately small. It is what `billing_subscriptions` stores and nothing
 * more: no payment methods, no card details, no invoice history, no raw Stripe
 * payloads. Stripe remains the system of record for payments; this is the
 * minimum needed to decide entitlement and render an honest account screen.
 */
export interface SubscriptionProjection {
  status: string;
  /** ISO-8601, or null when Stripe has not told us one yet. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plan: BillingPlan | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface StatusPolicy {
  /** Whether this status, on its own, is consistent with paid access. */
  entitles: boolean;
  /** Why — written for the reader of a future incident, not for the compiler. */
  rationale: string;
}

/**
 * The documented policy, one entry per status. §8 requires this be decided and
 * written down rather than implied by code, so it is data.
 *
 * ## The two judgement calls
 *
 * **`past_due` grants access.** When a renewal payment fails, Stripe does not
 * end the subscription; it moves to `past_due` and retries on its Smart Retries
 * schedule for up to ~three weeks, emailing the customer. The overwhelmingly
 * common cause is an expired or reissued card, not a decision to stop paying.
 * Cutting a paying customer out of their own life-management system the hour a
 * card expires is both hostile and bad for revenue recovery — and it is not
 * necessary, because when the retries are exhausted Stripe moves the
 * subscription to `unpaid` or `canceled`, and both of those revoke access here.
 * So `past_due` is a grace window with a definite end that Stripe, not we,
 * enforces.
 *
 * **`trialing` grants access, although no trial is offered.** Conqify is
 * pay-up-front at launch (§8) and no trial is configured on either price, so
 * this branch is unreachable today. It is written the right way round now so
 * that introducing a trial later is a Stripe dashboard change rather than a
 * code change that someone has to remember to make.
 *
 * `paused` does not grant access: a paused subscription is not being billed.
 */
export const STATUS_POLICY: Record<SubscriptionStatus, StatusPolicy> = {
  active: { entitles: true, rationale: "Paid and current. The ordinary subscribed state." },
  trialing: { entitles: true, rationale: "Inside a Stripe-managed trial. Not offered at launch; supported so enabling one later needs no code change." },
  past_due: { entitles: true, rationale: "A renewal payment failed and Stripe is retrying. Access continues through the retry window; when retries are exhausted Stripe moves to unpaid or canceled, which both revoke." },
  unpaid: { entitles: false, rationale: "Stripe exhausted its retries and gave up collecting. The grace window is over." },
  canceled: { entitles: false, rationale: "The subscription has ended. Stripe sets this at the effective end date, so a cancel-at-period-end customer keeps access until then by staying active." },
  incomplete: { entitles: false, rationale: "The first payment never completed. Nothing has been collected, so nothing is owed to the customer." },
  incomplete_expired: { entitles: false, rationale: "The first payment was never completed and Stripe closed the attempt." },
  paused: { entitles: false, rationale: "Collection is paused; no money is being taken, so no access is given." },
};

/**
 * How long a known `current_period_end` may sit in the past before we stop
 * believing the projection.
 *
 * ## Why a staleness guard exists at all
 *
 * Our copy of the subscription is only as fresh as the last webhook we
 * received. If webhook delivery breaks — a bad secret, a deploy that 500s, an
 * endpoint disabled in the Stripe dashboard — the row freezes in whatever state
 * it was last in. Without this guard, a subscription that says `active` and
 * whose period ended in March keeps granting access forever, and the failure is
 * completely silent because everything *looks* fine.
 *
 * ## Why three days and not zero
 *
 * Renewal is not instantaneous: Stripe bills at the period boundary, the
 * payment settles, and the `customer.subscription.updated` event follows. A
 * zero-tolerance check would revoke a paying customer's access during the
 * ordinary renewal window. Three days is comfortably longer than that
 * settlement and comfortably shorter than a billing period.
 *
 * ## Which way this fails
 *
 * It fails CLOSED, and that is a deliberate trade. A webhook outage during a
 * renewal will lock out a paying customer after three days — visible,
 * complained about, and fixable. The alternative fails open: unlimited free
 * access that nobody notices. Given that, the gate must always leave the person
 * a way to act, which is why the pricing screen keeps the "Manage subscription"
 * control (it reads live Stripe state, not this projection).
 */
export const ENTITLEMENT_GRACE_DAYS = 3;
export const ENTITLEMENT_GRACE_MS = ENTITLEMENT_GRACE_DAYS * 24 * 60 * 60 * 1000;

export type AccessReason =
  | "entitled"
  | "no_subscription"
  | "status_not_entitling"
  | "unknown_status"
  | "period_stale";

export interface AccessDecision {
  access: boolean;
  reason: AccessReason;
}

/**
 * Decide, with the reason attached.
 *
 * `hasPaidAccess` is the predicate everything calls; this is the same decision
 * with its explanation, for the account screen and for diagnostics. They share
 * one body so the explanation can never disagree with the answer.
 */
export function explainPaidAccess(
  subscription: SubscriptionProjection | null | undefined,
  now: Date = new Date(),
): AccessDecision {
  if (!subscription) return { access: false, reason: "no_subscription" };

  if (!isSubscriptionStatus(subscription.status)) {
    // A status we have never heard of. Stripe may add one; until a human has
    // decided what it means, it does not buy access.
    return { access: false, reason: "unknown_status" };
  }

  if (!STATUS_POLICY[subscription.status].entitles) {
    return { access: false, reason: "status_not_entitling" };
  }

  if (subscription.currentPeriodEnd) {
    const endMs = Date.parse(subscription.currentPeriodEnd);
    // An unparseable timestamp is treated as "no information", not as expiry:
    // a malformed string is our bug, and it must not cost a paying customer
    // their access.
    if (Number.isFinite(endMs) && now.getTime() - endMs > ENTITLEMENT_GRACE_MS) {
      return { access: false, reason: "period_stale" };
    }
  }

  return { access: true, reason: "entitled" };
}

/**
 * THE canonical entitlement predicate.
 *
 * Every paid-access decision in LifeOS — server or client, route gate or
 * account badge — resolves through this call. If you are about to compare a
 * subscription status to a string literal somewhere else, call this instead.
 */
export function hasPaidAccess(
  subscription: SubscriptionProjection | null | undefined,
  now: Date = new Date(),
): boolean {
  return explainPaidAccess(subscription, now).access;
}

/**
 * Human-facing status wording for the account screen.
 *
 * Calm and non-alarming (§23): a failed card says what to do, not what went
 * wrong internally. Never surfaces a raw Stripe status to the reader.
 */
export function describeSubscription(
  subscription: SubscriptionProjection | null | undefined,
  now: Date = new Date(),
): string {
  const decision = explainPaidAccess(subscription, now);
  if (!subscription) return "No subscription yet.";

  switch (decision.reason) {
    case "entitled":
      if (subscription.status === "past_due") {
        return "Your last payment didn't go through. Your access continues while Stripe retries — updating your payment method will clear it.";
      }
      if (subscription.cancelAtPeriodEnd) {
        return "Cancelled. Your access continues until the end of the current period.";
      }
      if (subscription.status === "trialing") return "In trial.";
      return "Active.";
    case "period_stale":
      return "We couldn't confirm your current subscription period. Open Manage subscription to check with Stripe.";
    case "no_subscription":
      return "No subscription yet.";
    case "unknown_status":
      return "We couldn't read your subscription state. Open Manage subscription to check with Stripe.";
    case "status_not_entitling":
      if (subscription.status === "unpaid") return "Payment couldn't be collected, so the subscription has lapsed.";
      if (subscription.status === "paused") return "Paused.";
      if (subscription.status === "canceled") return "Ended.";
      return "Not active.";
  }
}
