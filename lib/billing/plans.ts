/**
 * The plan catalogue (LIFEOS-BILLING §4, §9, §20, §29).
 *
 * Conqify sells ONE product with TWO billing intervals. That is the whole
 * catalogue, and this module is the only place it is written down.
 *
 * ## Why the client never names a price
 *
 * A Checkout Session is created with a Stripe price id, and whoever chooses
 * that id chooses what the customer is charged. If the browser supplied it, a
 * person could substitute any price in the account — including a $0 one — and
 * subscribe for nothing. So the browser sends a *semantic* plan (`"monthly"` or
 * `"annual"`) and the server resolves it here. `resolvePriceId` is the only
 * function that turns a plan into a price, and it reads the price from the
 * environment rather than from its caller.
 *
 * ## Why the ids are environment values and not constants
 *
 * Promotion from the Stripe sandbox to the live account must be a configuration
 * change, never a code change (§29). The sandbox ids are documented in
 * `.env.example` and `BILLING.md`; they appear in no domain logic. A build that
 * is pointed at live keys and live price ids is byte-identical to the one that
 * is pointed at sandbox keys.
 *
 * This module is PURE and client-safe: it holds no secret and reads no global.
 * Every input arrives as an argument.
 */

/** The only plans that exist. Ordered as the pricing page presents them. */
export const BILLING_PLANS = ["monthly", "annual"] as const;

export type BillingPlan = (typeof BILLING_PLANS)[number];

/**
 * Narrow an untrusted value to a plan.
 *
 * Used on the request boundary. Everything that is not exactly one of the two
 * strings is rejected — including `"Monthly"`, `" monthly"`, an array, and a
 * Stripe price id someone tried to pass where a plan belongs.
 */
export function isBillingPlan(value: unknown): value is BillingPlan {
  return typeof value === "string" && (BILLING_PLANS as readonly string[]).includes(value);
}

/** The environment variable that carries each plan's price id. */
export const PLAN_ENV_VAR: Record<BillingPlan, string> = {
  monthly: "STRIPE_PRICE_MONTHLY",
  annual: "STRIPE_PRICE_ANNUAL",
};

/** The subset of the environment this module reads. Passed in, never imported. */
export type PriceEnv = Partial<Record<string, string | undefined>>;

export type PriceResolution =
  | { ok: true; plan: BillingPlan; priceId: string }
  | { ok: false; reason: "invalid_plan" | "price_not_configured" };

/**
 * Resolve a caller-supplied plan to the configured Stripe price id.
 *
 * Two distinct failures, deliberately kept apart: `invalid_plan` is the
 * caller's fault and is a 400; `price_not_configured` is ours and is a 503. A
 * single "bad request" for both would make a missing deployment variable look
 * like user error.
 */
export function resolvePriceId(plan: unknown, env: PriceEnv): PriceResolution {
  if (!isBillingPlan(plan)) return { ok: false, reason: "invalid_plan" };
  const priceId = env[PLAN_ENV_VAR[plan]];
  if (typeof priceId !== "string" || priceId.trim() === "") {
    return { ok: false, reason: "price_not_configured" };
  }
  return { ok: true, plan, priceId: priceId.trim() };
}

/**
 * The reverse lookup: which plan is this price?
 *
 * Used when projecting a Stripe subscription into our own model, so the billing
 * UI can say "Annual" instead of `price_1UG7CO…`. Returns null for a price we
 * do not recognise — a legacy price, a price from the other Stripe mode, or a
 * subscription created before an id was rotated. Null is a display concern, not
 * an entitlement concern: `hasPaidAccess` never consults the plan.
 */
export function planForPriceId(priceId: string | null | undefined, env: PriceEnv): BillingPlan | null {
  if (!priceId) return null;
  for (const plan of BILLING_PLANS) {
    const configured = env[PLAN_ENV_VAR[plan]];
    if (typeof configured === "string" && configured.trim() === priceId) return plan;
  }
  return null;
}

export interface PlanPresentation {
  plan: BillingPlan;
  /** Shown as the plan's name. */
  label: string;
  /** Headline price, already formatted. */
  price: string;
  /** The billing period the headline price covers. */
  cadence: string;
  /** A single calm line under the price, or null when there is nothing to add. */
  note: string | null;
}

/** Cents, so the savings line below is arithmetic rather than a claim. */
export const MONTHLY_PRICE_CENTS = 900;
export const ANNUAL_PRICE_CENTS = 7900;

/** What a year costs if you pay monthly. */
export function annualSavingsCents(): number {
  return MONTHLY_PRICE_CENTS * 12 - ANNUAL_PRICE_CENTS;
}

/** The annual plan's effective monthly cost, in cents, rounded to the cent. */
export function annualEffectiveMonthlyCents(): number {
  return Math.round(ANNUAL_PRICE_CENTS / 12);
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * How each plan is presented. Derived from the cent constants above so the
 * pricing page cannot drift from the arithmetic — the "$29/year" saving is
 * computed, not typed.
 *
 * NOTE: these strings describe the *catalogue*, not what any particular
 * customer is charged. Stripe is the authority on the amount; if a price id is
 * ever repointed, this copy must be updated with it.
 */
export function planPresentation(): PlanPresentation[] {
  return [
    {
      plan: "monthly",
      label: "Monthly",
      price: dollars(MONTHLY_PRICE_CENTS),
      cadence: "per month",
      note: null,
    },
    {
      plan: "annual",
      label: "Annual",
      price: dollars(ANNUAL_PRICE_CENTS),
      cadence: "per year",
      note: `About ${dollars(annualEffectiveMonthlyCents())} a month — ${dollars(annualSavingsCents())} less than paying monthly for a year.`,
    },
  ];
}
