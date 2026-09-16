/**
 * The paid-access boundary policy (LIFEOS-BILLING §18, §19, §22).
 *
 * ONE decision function and ONE allowlist. §18 is explicit that paywall
 * conditionals must not be sprinkled through pages, so no page in LifeOS checks
 * entitlement: `components/billing/PaidAccessGate.tsx` wraps the whole route
 * tree once, and it asks this module what to do.
 *
 * ## Why the gate renders in place instead of redirecting
 *
 * A redirecting gate has to get its allowlist exactly right or it loops: send
 * an unentitled user to `/pricing`, forget to exempt `/pricing`, and the
 * browser spins. This gate never navigates. When a person is not entitled it
 * renders the pricing surface *where they are*, leaving the URL alone. A loop
 * is then not merely avoided but unrepresentable — there is no navigation to
 * loop. `evaluateGate` is still exhaustively tested against the allowlist,
 * because the allowlist still governs which routes render their own content.
 *
 * ## Why there is a deployment switch
 *
 * `NEXT_PUBLIC_REQUIRE_PAID_ACCESS` defaults to OFF. Merging this work must not
 * paywall the existing beta the moment it deploys, and §19 forbids closing that
 * risk with a founder-email backdoor. A deployment-level switch is the honest
 * alternative: it is explicit, it is visible in the Vercel project, it applies
 * to everyone equally, and there is no identity it can be wrong about. Launch
 * is the day it is set to `true`.
 *
 * It is `NEXT_PUBLIC_` because the gate runs in the browser and the value is
 * not a secret — it is a policy statement about the deployment, the same class
 * of thing as the Supabase URL.
 *
 * ## What this gate is, and is not
 *
 * It is a PRODUCT boundary, not the data-security boundary. The data behind it
 * is the signed-in person's own, and it is protected by Postgres RLS, which
 * this module does not touch and cannot weaken. Nobody gains access to anyone
 * else's records by defeating this gate; they would only reach their own.
 * Subscription state itself is not forgeable from the browser — see
 * `supabase/migrations/0048_billing_subscriptions.sql`.
 *
 * ## Local-first is untouched (§22)
 *
 * With no Supabase configuration there is no account, no Stripe customer and
 * nothing to bill, so the gate stands down entirely and LifeOS runs exactly as
 * it does today. The gate never deletes, archives, or hides local data; it
 * changes what is rendered and nothing else.
 *
 * PURE and client-safe: no secret, no I/O, no global reads.
 */

import type { AuthCategory } from "@/lib/security/auth-boundaries";

/**
 * Routes that stay reachable without a subscription.
 *
 * Derived from the repository's real route tree (§18 asks for exactly that),
 * and each entry is here because a person with no subscription has a legitimate
 * reason to be on it:
 *
 *   /pricing            choose a plan — the destination of the gate itself
 *   /billing            subscription state + "Manage subscription"
 *   /billing/success    where Stripe returns after Checkout
 *   /privacy            what is stored, and the deletion controls
 *   /privacy/delete     you may always leave, subscribed or not
 *   /backup             export your data; never hold data hostage to billing
 *   /help               how any of this works, including how to get support
 *   /welcome            first-run explanation
 *   /security           sanitized diagnostics (no user content)
 *   /health             uptime probe
 *   /diagnostics        sanitized diagnostics
 *   /release            release evidence surface
 *   /dev                developer self-tests; already 404s in production
 *
 * Sign-in and sign-out need no entry: `AuthControl` lives in the nav, which
 * renders outside the gate, so it is reachable from every route.
 */
export const PAID_ACCESS_ALLOWLIST: readonly string[] = [
  "/pricing",
  "/billing",
  "/privacy",
  "/backup",
  "/help",
  "/welcome",
  "/security",
  "/health",
  "/diagnostics",
  "/release",
  "/dev",
];

/** Where the gate sends an unentitled person. Must itself be allowlisted. */
export const PRICING_PATH = "/pricing";

/**
 * Prefix match on path segments.
 *
 * Segment-aware on purpose: a plain `startsWith` would exempt `/pricingsecrets`
 * because it exempts `/pricing`, and would exempt nothing under `/privacy/`
 * without a trailing-slash special case. This matches `/billing` and
 * `/billing/success` but not `/billings`.
 */
export function isAllowlistedPath(pathname: string, allowlist: readonly string[] = PAID_ACCESS_ALLOWLIST): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;
  // Normalise away a trailing slash so "/billing/" behaves like "/billing".
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return allowlist.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

export type GateDecision = "allow" | "loading" | "sign-in" | "pricing";

export type GateReason =
  | "billing_disabled"
  | "local_only"
  | "allowlisted"
  | "auth_loading"
  | "not_signed_in"
  | "subscription_loading"
  | "entitled"
  | "not_entitled";

export interface GateInput {
  /** The deployment switch. False means this build does not paywall anything. */
  paidAccessRequired: boolean;
  /** Whether a Supabase project is configured at all. False = local-only mode. */
  supabaseConfigured: boolean;
  /** The auth state, as categorised by lib/security/auth-boundaries. */
  authCategory: AuthCategory;
  /** True once the subscription projection has been read (or definitively not found). */
  entitlementResolved: boolean;
  /** The result of the canonical predicate, `hasPaidAccess`. */
  entitled: boolean;
  pathname: string;
  allowlist?: readonly string[];
}

export interface GateResult {
  decision: GateDecision;
  reason: GateReason;
}

/**
 * Decide what the gate should render.
 *
 * Order matters and is load-bearing:
 *
 *   1. The switch is off        → this build paywalls nothing.
 *   2. No Supabase              → local-only mode, nothing to bill.
 *   3. Allowlisted route        → checked BEFORE auth, so a signed-out person
 *                                 can always reach /pricing, /help and the
 *                                 privacy controls.
 *   4. Auth still loading       → wait rather than flash a paywall at somebody
 *                                 who is in fact subscribed.
 *   5. Not signed in / expired  → sign in; there is no anonymous subscription.
 *   6. Subscription unknown     → wait, for the same reason as (4).
 *   7. Entitled                 → allow. Otherwise → pricing.
 */
export function evaluateGate(input: GateInput): GateResult {
  if (!input.paidAccessRequired) return { decision: "allow", reason: "billing_disabled" };
  if (!input.supabaseConfigured) return { decision: "allow", reason: "local_only" };
  if (isAllowlistedPath(input.pathname, input.allowlist)) return { decision: "allow", reason: "allowlisted" };

  if (input.authCategory === "loading") return { decision: "loading", reason: "auth_loading" };
  if (input.authCategory !== "signed-in") return { decision: "sign-in", reason: "not_signed_in" };

  if (!input.entitlementResolved) return { decision: "loading", reason: "subscription_loading" };
  return input.entitled
    ? { decision: "allow", reason: "entitled" }
    : { decision: "pricing", reason: "not_entitled" };
}
