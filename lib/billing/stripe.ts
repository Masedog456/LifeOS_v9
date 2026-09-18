import "server-only";

/**
 * The single server-side Stripe client (LIFEOS-BILLING §5).
 *
 * ## `import "server-only"` is the security control, not a comment
 *
 * This module reads `STRIPE_SECRET_KEY`. The `server-only` marker makes it a
 * BUILD ERROR for any client component to import this file, directly or
 * through a chain of imports — Next's bundler refuses rather than silently
 * shipping the module to the browser with the secret erased (or, worse, not
 * erased). That is a stronger guarantee than a naming convention or a code
 * review, because it is checked by `npm run build` on every commit.
 *
 * `scripts/scan-secrets.mjs` recognises the same marker, which is why the
 * privileged-credential exception it grants tracks this import rather than a
 * directory.
 *
 * ## Why the key is read lazily
 *
 * A module-level `new Stripe(process.env.STRIPE_SECRET_KEY!)` throws at import
 * time when the variable is absent — which would take down every route that
 * transitively imports billing, including in local development and in the
 * production build step, where no Stripe key exists or should. `getStripe()`
 * returns null instead, and each route turns that into a calm 503 (§23).
 *
 * ## The API version is pinned deliberately
 *
 * Stripe's field shapes move between versions — `current_period_end` left the
 * Subscription object and now lives on subscription items. Pinning means an SDK
 * upgrade changes the types at compile time (visible) instead of changing the
 * JSON at runtime (invisible until a subscription projects wrong).
 */

import Stripe from "stripe";

/**
 * The Stripe API version this code is written against.
 *
 * Matches the SDK's own default for `stripe@22`. If it is raised, re-read
 * `lib/billing/projection.ts` first: that module is where the version's field
 * layout is assumed.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

let cached: Stripe | null | undefined;

/** True when this deployment is configured to talk to Stripe at all. */
export function isStripeConfigured(): boolean {
  return typeof process.env.STRIPE_SECRET_KEY === "string" && process.env.STRIPE_SECRET_KEY.trim().length > 0;
}

/**
 * The shared Stripe client, or null when no secret key is configured.
 *
 * Never throws. A missing key is a deployment state, not an exception: local
 * development and the build step both run without one.
 */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    cached = null;
    return cached;
  }
  cached = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    // Named so the founder can tell Conqify's calls apart from anything else in
    // the Stripe dashboard's request log. Carries no user information.
    appInfo: { name: "Conqify", url: "https://app.conqify.com" },
    // Two retries on Stripe's own idempotency-safe classes. Checkout and portal
    // creation are user-facing and a single transient network fault should not
    // become a visible failure.
    maxNetworkRetries: 2,
  });
  return cached;
}

/** Test seam: forget the memoised client so env changes take effect. */
export function resetStripeClient(): void {
  cached = undefined;
}

/**
 * The application origin used to build Stripe return URLs.
 *
 * Read from `APP_URL` when set; otherwise derived from the incoming request,
 * which is what makes preview deployments work without per-branch
 * configuration. The result is validated as an absolute http(s) origin so a
 * malformed variable cannot produce a Checkout Session that returns the
 * customer somewhere unexpected.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Fall through to the request origin rather than failing the checkout:
      // a typo in a deployment variable should not stop someone paying.
    }
  }
  return new URL(request.url).origin;
}
