/**
 * Billing self-tests (LIFEOS-BILLING §25).
 *
 * Deterministic assertions over the PURE billing layer: plan mapping, the
 * entitlement predicate across every Stripe status, the Stripe→canonical
 * projection, webhook event routing, and the access-gate policy.
 *
 * ## What is deliberately NOT here
 *
 * Anything that needs a secret. The route behaviour — checkout authentication,
 * cross-user portal isolation, webhook signature verification, idempotency and
 * the state transitions — is proved by `scripts/inject-billing-routes.cjs`,
 * which drives the real route handlers against stubbed Stripe and Supabase
 * clients. It lives in `scripts/` because those modules carry
 * `import "server-only"` and must never be reachable from a page.
 *
 * ## Why the status table is walked rather than spot-checked
 *
 * `SUBSCRIPTION_STATUSES` is the full list Stripe defines. Section 2 asserts an
 * expected answer for every member of it, and asserts that the policy table has
 * an entry for every member — so a status added to the list without a decision,
 * or a decision quietly flipped, fails here rather than in production.
 */

import {
  BILLING_PLANS,
  PLAN_ENV_VAR,
  annualEffectiveMonthlyCents,
  annualSavingsCents,
  isBillingPlan,
  planForPriceId,
  planPresentation,
  resolvePriceId,
} from "@/lib/billing/plans";
import {
  ENTITLEMENT_GRACE_DAYS,
  STATUS_POLICY,
  SUBSCRIPTION_STATUSES,
  describeSubscription,
  explainPaidAccess,
  hasPaidAccess,
  isSubscriptionStatus,
  type SubscriptionProjection,
} from "@/lib/billing/entitlement";
import {
  HANDLED_EVENT_TYPES,
  SUBSCRIPTION_USER_METADATA_KEY,
  classifyEvent,
  customerIdOf,
  metadataUserId,
  periodEndOf,
  priceIdOf,
  projectSubscription,
  subscriptionIdFromEvent,
  type StripeSubscriptionLike,
} from "@/lib/billing/projection";
import {
  PAID_ACCESS_ALLOWLIST,
  PRICING_PATH,
  evaluateGate,
  isAllowlistedPath,
  type GateInput,
} from "@/lib/billing/gate";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** Placeholder ids. Never real secrets — §25 forbids real values in fixtures. */
const MONTHLY_PRICE = "price_test_monthly";
const ANNUAL_PRICE = "price_test_annual";
const ENV = { [PLAN_ENV_VAR.monthly]: MONTHLY_PRICE, [PLAN_ENV_VAR.annual]: ANNUAL_PRICE };

const NOW = new Date("2026-06-01T12:00:00.000Z");
const USER = "11111111-2222-3333-4444-555555555555";

function sub(patch: Partial<SubscriptionProjection> = {}): SubscriptionProjection {
  return {
    status: "active",
    currentPeriodEnd: "2026-07-01T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    plan: "monthly",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    ...patch,
  };
}

function stripeSub(patch: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike {
  return {
    id: "sub_test",
    status: "active",
    cancel_at_period_end: false,
    customer: "cus_test",
    metadata: { [SUBSCRIPTION_USER_METADATA_KEY]: USER },
    items: { data: [{ current_period_end: 1782950400, price: { id: MONTHLY_PRICE } }] },
    ...patch,
  };
}

/** The gate input with everything at its most permissive, for targeted overrides. */
function gate(patch: Partial<GateInput> = {}): GateInput {
  return {
    paidAccessRequired: true,
    supabaseConfigured: true,
    authCategory: "signed-in",
    entitlementResolved: true,
    entitled: true,
    pathname: "/today",
    ...patch,
  };
}

export function runBillingSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Plan mapping (§25) ----
  const monthly = resolvePriceId("monthly", ENV);
  const annual = resolvePriceId("annual", ENV);
  ok("1.1 monthly maps to the monthly price", monthly.ok && monthly.priceId === MONTHLY_PRICE);
  ok("1.2 annual maps to the annual price", annual.ok && annual.priceId === ANNUAL_PRICE);
  ok("1.3 an unknown plan is rejected", resolvePriceId("lifetime", ENV).ok === false);
  ok("1.4 rejection names the caller's fault, not ours",
    (resolvePriceId("lifetime", ENV) as { ok: false; reason: string }).reason === "invalid_plan");
  ok("1.5 a raw price id is NOT accepted where a plan belongs",
    resolvePriceId(MONTHLY_PRICE, ENV).ok === false);
  ok("1.6 an unconfigured price is our fault, not a bad request",
    (resolvePriceId("annual", { [PLAN_ENV_VAR.monthly]: MONTHLY_PRICE }) as { ok: false; reason: string }).reason === "price_not_configured");
  ok("1.7 a blank price counts as unconfigured",
    (resolvePriceId("monthly", { [PLAN_ENV_VAR.monthly]: "   " }) as { ok: false; reason: string }).reason === "price_not_configured");
  ok("1.8 non-string plans are rejected",
    [null, undefined, 1, {}, ["monthly"], true].every((v) => resolvePriceId(v, ENV).ok === false));
  ok("1.9 plan narrowing is exact", isBillingPlan("monthly") && !isBillingPlan("Monthly") && !isBillingPlan(" monthly"));
  ok("1.10 the catalogue has exactly two plans", BILLING_PLANS.length === 2);
  ok("1.11 reverse lookup finds the plan for a price", planForPriceId(ANNUAL_PRICE, ENV) === "annual");
  ok("1.12 an unrecognised price maps to no plan", planForPriceId("price_from_another_account", ENV) === null);
  ok("1.13 a null price maps to no plan", planForPriceId(null, ENV) === null);
  ok("1.14 the savings line is arithmetic, not a claim", annualSavingsCents() === 2900);
  ok("1.15 the effective monthly figure is derived", annualEffectiveMonthlyCents() === 658);
  const presented = planPresentation();
  ok("1.16 pricing shows $9 and $79", presented[0].price === "$9" && presented[1].price === "$79");
  ok("1.17 pricing offers no third option", presented.length === 2);

  // ---- 2. The entitlement predicate, across EVERY Stripe status (§8, §25) ----
  const expected: Record<string, boolean> = {
    active: true, trialing: true, past_due: true,
    unpaid: false, canceled: false, incomplete: false, incomplete_expired: false, paused: false,
  };
  for (const status of SUBSCRIPTION_STATUSES) {
    ok(`2.s ${status} → ${expected[status] ? "access" : "no access"}`,
      hasPaidAccess(sub({ status }), NOW) === expected[status]);
  }
  ok("2.1 every status has a documented policy entry",
    SUBSCRIPTION_STATUSES.every((s) => typeof STATUS_POLICY[s]?.rationale === "string" && STATUS_POLICY[s].rationale.length > 20));
  ok("2.2 the policy table has no entry for a status that does not exist",
    Object.keys(STATUS_POLICY).length === SUBSCRIPTION_STATUSES.length);
  ok("2.3 the table and the predicate agree",
    SUBSCRIPTION_STATUSES.every((s) => STATUS_POLICY[s].entitles === hasPaidAccess(sub({ status: s }), NOW)));
  ok("2.4 no subscription means no access", hasPaidAccess(null, NOW) === false);
  ok("2.5 undefined means no access", hasPaidAccess(undefined, NOW) === false);
  ok("2.6 a status Stripe has not defined fails closed",
    hasPaidAccess(sub({ status: "super_active" }), NOW) === false);
  ok("2.7 …and says why", explainPaidAccess(sub({ status: "super_active" }), NOW).reason === "unknown_status");
  ok("2.8 an empty status fails closed", hasPaidAccess(sub({ status: "" }), NOW) === false);
  ok("2.9 status narrowing is exact", isSubscriptionStatus("active") && !isSubscriptionStatus("ACTIVE"));

  // cancel_at_period_end: the case a scattered `status === "active"` gets wrong.
  ok("2.10 cancelled-at-period-end keeps access while still active",
    hasPaidAccess(sub({ cancelAtPeriodEnd: true }), NOW) === true);
  ok("2.11 …and loses it once Stripe marks it canceled",
    hasPaidAccess(sub({ cancelAtPeriodEnd: true, status: "canceled" }), NOW) === false);

  // The staleness guard.
  const dayMs = 24 * 60 * 60 * 1000;
  const endedDaysAgo = (d: number) => new Date(NOW.getTime() - d * dayMs).toISOString();
  ok("2.12 a period that ended yesterday is inside the grace window",
    hasPaidAccess(sub({ currentPeriodEnd: endedDaysAgo(1) }), NOW) === true);
  ok(`2.13 a period that ended ${ENTITLEMENT_GRACE_DAYS + 2} days ago is stale`,
    hasPaidAccess(sub({ currentPeriodEnd: endedDaysAgo(ENTITLEMENT_GRACE_DAYS + 2) }), NOW) === false);
  ok("2.14 …and says why", explainPaidAccess(sub({ currentPeriodEnd: endedDaysAgo(30) }), NOW).reason === "period_stale");
  ok("2.15 an unknown period does not revoke access",
    hasPaidAccess(sub({ currentPeriodEnd: null }), NOW) === true);
  ok("2.16 an unparseable period does not revoke access (our bug, not their problem)",
    hasPaidAccess(sub({ currentPeriodEnd: "not a date" }), NOW) === true);
  ok("2.17 a future period is fine", hasPaidAccess(sub({ currentPeriodEnd: "2027-01-01T00:00:00.000Z" }), NOW) === true);

  // The explanation can never disagree with the answer.
  ok("2.18 explanation and predicate always agree",
    [null, sub(), sub({ status: "canceled" }), sub({ status: "past_due" }), sub({ currentPeriodEnd: endedDaysAgo(30) })]
      .every((s) => explainPaidAccess(s, NOW).access === hasPaidAccess(s, NOW)));

  // Wording never leaks a raw Stripe status to a reader.
  ok("2.19 status wording is human, never a raw Stripe status",
    SUBSCRIPTION_STATUSES.every((s) => !describeSubscription(sub({ status: s }), NOW).includes(s)));
  ok("2.20 a past-due subscriber is told what to do, not that they are cut off",
    /retries/i.test(describeSubscription(sub({ status: "past_due" }), NOW)));
  ok("2.21 a cancelling subscriber is told access continues",
    /continues/i.test(describeSubscription(sub({ cancelAtPeriodEnd: true }), NOW)));

  // ---- 3. Stripe → canonical projection (§6, §14) ----
  const projected = projectSubscription(stripeSub(), ENV);
  ok("3.1 a subscription projects", projected.ok);
  if (projected.ok) {
    ok("3.2 the customer is carried", projected.subscription.stripeCustomerId === "cus_test");
    ok("3.3 the status is stored verbatim", projected.subscription.status === "active");
    ok("3.4 the price comes from the item", projected.subscription.stripePriceId === MONTHLY_PRICE);
    ok("3.5 the plan is resolved from the price", projected.subscription.plan === "monthly");
    ok("3.6 the period is an ISO timestamp", projected.subscription.currentPeriodEnd === "2026-07-02T00:00:00.000Z");
  }
  ok("3.7 the period comes from the ITEM, not the subscription",
    periodEndOf({ ...stripeSub(), items: { data: [] } } as StripeSubscriptionLike) === null);
  // The field Stripe REMOVED from the Subscription object. If a future edit
  // starts reading it, a subscription with items but a stale top-level value
  // would project the wrong period — so assert it is not consulted.
  const legacyShape = { ...stripeSub({ items: { data: [] } }), current_period_end: 1782950400 };
  ok("3.8 a subscription-level current_period_end is NOT read",
    periodEndOf(legacyShape as StripeSubscriptionLike) === null);
  ok("3.9 epoch SECONDS are converted, not passed through as milliseconds",
    periodEndOf(stripeSub()) === new Date(1782950400 * 1000).toISOString());
  ok("3.10 the earliest item period wins",
    periodEndOf(stripeSub({ items: { data: [
      { current_period_end: 1782950400, price: { id: MONTHLY_PRICE } },
      { current_period_end: 1700000000, price: { id: ANNUAL_PRICE } },
    ] } })) === new Date(1700000000 * 1000).toISOString());
  ok("3.11 a zero or negative period is ignored",
    periodEndOf(stripeSub({ items: { data: [{ current_period_end: 0, price: null }] } })) === null);
  ok("3.12 an expanded customer object is read", customerIdOf({ id: "cus_expanded" }) === "cus_expanded");
  ok("3.13 a missing customer fails the projection",
    projectSubscription(stripeSub({ customer: null }), ENV).ok === false);
  ok("3.14 an unrecognised price still projects, with no plan",
    (projectSubscription(stripeSub({ items: { data: [{ current_period_end: 1782950400, price: { id: "price_other" } }] } }), ENV) as { ok: true; subscription: { plan: unknown } }).subscription.plan === null);
  ok("3.15 no item price projects a null price", priceIdOf(stripeSub({ items: { data: [{ current_period_end: 1, price: null }] } })) === null);

  // Metadata is a uuid or nothing — never free text somebody could have set.
  ok("3.16 our metadata key yields the user id", metadataUserId(stripeSub()) === USER);
  ok("3.17 a non-uuid metadata value is refused",
    metadataUserId(stripeSub({ metadata: { [SUBSCRIPTION_USER_METADATA_KEY]: "admin" } })) === null);
  ok("3.18 absent metadata yields nothing", metadataUserId(stripeSub({ metadata: null })) === null);
  ok("3.19 the metadata key carries an opaque id, never an address",
    SUBSCRIPTION_USER_METADATA_KEY === "lifeos_user_id");

  // ---- 4. Webhook event routing (§14) ----
  ok("4.1 checkout completion routes to the checkout path", classifyEvent("checkout.session.completed") === "checkout");
  ok("4.2 the three subscription events share one path",
    ["created", "updated", "deleted"].every((s) => classifyEvent(`customer.subscription.${s}`) === "subscription"));
  ok("4.3 invoice outcomes share one path",
    classifyEvent("invoice.paid") === "invoice" && classifyEvent("invoice.payment_failed") === "invoice");
  ok("4.4 an unknown event type is ignored, not an error", classifyEvent("radar.early_fraud_warning.created") === "ignored");
  ok("4.5 every handled type classifies to a real path",
    HANDLED_EVENT_TYPES.every((t) => classifyEvent(t) !== "ignored"));
  ok("4.6 exactly six event types are subscribed to", HANDLED_EVENT_TYPES.length === 6);

  ok("4.7 a checkout session names its subscription",
    subscriptionIdFromEvent("checkout", { subscription: "sub_from_session" }) === "sub_from_session");
  ok("4.8 an expanded subscription on a session is read",
    subscriptionIdFromEvent("checkout", { subscription: { id: "sub_expanded" } }) === "sub_expanded");
  ok("4.9 a payment-mode session has no subscription and that is not a failure",
    subscriptionIdFromEvent("checkout", { subscription: null }) === null);
  ok("4.10 a subscription event IS the subscription",
    subscriptionIdFromEvent("subscription", { id: "sub_direct" }) === "sub_direct");
  ok("4.11 an invoice points at its subscription through parent.subscription_details",
    subscriptionIdFromEvent("invoice", { parent: { subscription_details: { subscription: "sub_invoiced" } } }) === "sub_invoiced");
  ok("4.12 the removed top-level invoice.subscription field is NOT relied on",
    subscriptionIdFromEvent("invoice", { subscription: "sub_legacy" } as { subscription: string }) === null);
  ok("4.13 an invoice with no subscription parent yields nothing",
    subscriptionIdFromEvent("invoice", { parent: null }) === null);
  ok("4.14 an ignored event yields nothing", subscriptionIdFromEvent("ignored", { id: "sub_x" }) === null);

  // ---- 5. The access gate (§18) ----
  ok("5.1 the switch off means nothing is gated",
    evaluateGate(gate({ paidAccessRequired: false, entitled: false })).decision === "allow");
  ok("5.2 local-only mode is never gated",
    evaluateGate(gate({ supabaseConfigured: false, entitled: false })).decision === "allow");
  ok("5.3 an entitled user enters the app", evaluateGate(gate()).decision === "allow");
  ok("5.4 an unentitled user reaches pricing", evaluateGate(gate({ entitled: false })).decision === "pricing");
  ok("5.5 a signed-out user is asked to sign in",
    evaluateGate(gate({ authCategory: "signed-out", entitled: false })).decision === "sign-in");
  ok("5.6 an expired session is asked to sign in",
    evaluateGate(gate({ authCategory: "expired" })).decision === "sign-in");
  ok("5.7 loading auth never flashes a paywall",
    evaluateGate(gate({ authCategory: "loading", entitled: false })).decision === "loading");
  ok("5.8 an unresolved subscription never flashes a paywall",
    evaluateGate(gate({ entitlementResolved: false, entitled: false })).decision === "loading");

  // The loop-freedom property, stated as an assertion rather than a hope.
  ok("5.9 the gate's own destination is allowlisted", isAllowlistedPath(PRICING_PATH));
  ok("5.10 EVERY allowlisted route renders for an unentitled, signed-out user",
    PAID_ACCESS_ALLOWLIST.every((p) =>
      evaluateGate(gate({ pathname: p, entitled: false, authCategory: "signed-out" })).decision === "allow"));
  ok("5.11 …and for one whose subscription could not be read",
    PAID_ACCESS_ALLOWLIST.every((p) =>
      evaluateGate(gate({ pathname: p, entitled: false, entitlementResolved: false })).decision === "allow"));
  ok("5.12 the required surfaces are all allowlisted",
    ["/pricing", "/billing", "/billing/success", "/privacy", "/privacy/delete", "/help", "/backup"]
      .every((p) => isAllowlistedPath(p)));
  ok("5.13 nested allowlisted routes are covered", isAllowlistedPath("/billing/success"));
  ok("5.14 a trailing slash does not defeat the allowlist", isAllowlistedPath("/billing/"));
  ok("5.15 a prefix collision is NOT allowlisted", isAllowlistedPath("/pricingsecrets") === false);
  ok("5.16 an ordinary app route is not allowlisted", isAllowlistedPath("/today") === false);
  ok("5.17 a non-path is not allowlisted", isAllowlistedPath("https://evil.example/pricing") === false);
  ok("5.18 paid surfaces really are gated",
    ["/today", "/", "/goals", "/reading", "/constitution"].every((p) =>
      evaluateGate(gate({ pathname: p, entitled: false })).decision === "pricing"));

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
