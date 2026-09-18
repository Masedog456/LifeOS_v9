import "server-only";

/**
 * The privileged Supabase connection, scoped to billing (LIFEOS-BILLING §7).
 *
 * ## Why this exists, when the codebase says it deliberately does not
 *
 * `lib/integrations/runtime.ts` states plainly that this deployment has no
 * privileged server connection, and refuses rather than half-wiring one. That
 * was the right call there and it is still in force for integrations. Billing
 * is the case it anticipated — "a separate, reviewed change".
 *
 * A Stripe webhook is a POST from Stripe's servers. It carries no user session,
 * no `Authorization` header and no cookie, and it cannot: the person it is
 * about may be asleep. Yet it must write the one table the person is forbidden
 * to write. Every alternative is worse:
 *
 *   - An RLS policy that lets `authenticated` write its own billing row is
 *     exactly the forgery §7 calls a stop-the-line defect.
 *   - A shared secret checked by a `SECURITY DEFINER` function is a privileged
 *     credential with worse properties than the one Supabase already issues.
 *   - Trusting the browser's `?success=true` return is forbidden by §12, and
 *     rightly: it is a URL anybody can type.
 *
 * So the privileged connection is genuinely required, and the work is to make
 * it narrow and provable rather than to avoid it.
 *
 * ## How it is contained
 *
 * 1. `import "server-only"` — a client component that imports this file, at any
 *    depth, fails the production build. The secret cannot reach a browser
 *    bundle by mistake; it can only get there by deleting this line.
 * 2. The only callers are `lib/billing/store.ts` and, through it, three API
 *    route handlers. Nothing else in the codebase imports it.
 * 3. The database side is narrow independently: the key's role may write
 *    `billing_subscriptions` through two functions granted to `service_role`
 *    and nothing else (migration 0048).
 * 4. `scripts/audit-billing.mjs` asserts 1–2 on every run of `audit:security`,
 *    so a future import from client code is a failed audit, not a discovery.
 *
 * ## Absent by default
 *
 * With no key configured this returns null and billing reports itself
 * unavailable — the same posture `lib/integrations/runtime.ts` takes. Local
 * development and the build step need no credential.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The environment variable holding the privileged key. Server-only, always. */
export const PRIVILEGED_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY";

let cached: SupabaseClient | null | undefined;

/** True when a privileged connection can actually be made. */
export function isBillingStoreConfigured(): boolean {
  const key = process.env[PRIVILEGED_KEY_ENV];
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && typeof key === "string" && key.trim());
}

/**
 * The billing store's privileged client, or null when unavailable.
 *
 * `persistSession: false` and `autoRefreshToken: false` because this client
 * has no user and no browser: leaving them on would have it write a session to
 * whatever storage it could find on a server.
 */
export function getBillingAdminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env[PRIVILEGED_KEY_ENV]?.trim();
  if (!url || !key) {
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-lifeos-client": "billing" } },
  });
  return cached;
}

/** Test seam: forget the memoised client so env changes take effect. */
export function resetBillingAdminClient(): void {
  cached = undefined;
}
