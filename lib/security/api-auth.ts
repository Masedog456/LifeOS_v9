/**
 * Server-side caller authentication for cost-bearing API routes (LIFEOS-055S).
 *
 * ## The hole this closes
 *
 * At public launch, `POST /api/ai` accepted any request from the open internet
 * and, when `ANTHROPIC_API_KEY` was set, spent real money on it. Nothing
 * identified the caller. The same was true of `/api/embed` (a paid embedding
 * provider) and `/api/extract` (an outbound URL fetcher usable as an open proxy).
 *
 * ## Why this is not a parallel auth system
 *
 * It reuses the ONLY identity Conqify has: the Supabase session the browser
 * already holds. The client attaches its existing access token as
 * `Authorization: Bearer <token>`; this module asks Supabase whether that token
 * belongs to a real user. No new credential, no new user table, no cookie
 * scheme, and **no service-role key** — `getUser(jwt)` is validated with the
 * public anon key, which is exactly what it is for. RLS is untouched.
 *
 * ## The cost-linked policy
 *
 * Authentication is required **when, and only when, a request could actually
 * spend money.** If no provider key is configured the route can only return
 * deterministic mocks, so demanding a login there would break local development
 * and signed-out use for no security gain. The boundary tracks the money, not
 * the URL.
 *
 * A rejected caller costs nothing: the provider is never contacted.
 */

import { createClient } from "@supabase/supabase-js";

export type AuthFailure = "missing_token" | "invalid_token" | "unavailable";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  reason?: AuthFailure;
}

/** Extract a bearer token from a request's Authorization header. Pure. */
export function bearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Is a paid provider configured for this route's work?
 *
 * The whole auth requirement hangs off this: no key means no spend means no
 * reason to demand identity.
 */
export function costBearing(keys: (string | undefined)[]): boolean {
  return keys.some((k) => typeof k === "string" && k.trim().length > 0);
}

/**
 * Decide whether a request may proceed to a cost-bearing provider.
 *
 * Pure and dependency-injected so the policy can be tested without a network,
 * a browser, or a Supabase project.
 */
export function evaluateAccess(input: {
  costBearing: boolean;
  supabaseConfigured: boolean;
  token: string | null;
  tokenValid?: boolean;
}): { allow: boolean; status?: 401 | 503; reason?: AuthFailure } {
  // Nothing can be spent — mocks only. Let it through.
  if (!input.costBearing) return { allow: true };

  // A paid key is configured but there is no identity system to check against.
  // Refuse rather than spend anonymously; 503 because this is a server
  // misconfiguration, not the caller's fault.
  if (!input.supabaseConfigured) return { allow: false, status: 503, reason: "unavailable" };

  if (!input.token) return { allow: false, status: 401, reason: "missing_token" };
  if (input.tokenValid !== true) return { allow: false, status: 401, reason: "invalid_token" };
  return { allow: true };
}

/**
 * Verify a Supabase access token server-side and return its user id.
 *
 * Uses the PUBLIC anon key. `auth.getUser(jwt)` asks Supabase to validate the
 * token; it cannot be satisfied by a forged JWT, and it needs no elevated
 * credential. Any failure is reported as invalid — never as a pass.
 */
export async function verifySupabaseToken(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Full guard for a route handler.
 *
 * Returns `{ ok: true, userId }` when the request may proceed, or `{ ok: false }`
 * with a status the caller should return. The provider is never contacted on a
 * rejection, which is the entire point.
 */
export async function guardCostBearingRoute(
  request: Request,
  providerKeys: (string | undefined)[],
): Promise<{ ok: true; userId?: string } | { ok: false; status: 401 | 503; reason: AuthFailure }> {
  const paid = costBearing(providerKeys);
  const token = bearerToken(request.headers.get("authorization"));
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const pre = evaluateAccess({ costBearing: paid, supabaseConfigured, token, tokenValid: false });
  // Short-circuit the cases that need no network round-trip.
  if (pre.allow) return { ok: true };
  if (pre.status === 503 || pre.reason === "missing_token") {
    return { ok: false, status: pre.status!, reason: pre.reason! };
  }

  const userId = await verifySupabaseToken(token!);
  const post = evaluateAccess({ costBearing: paid, supabaseConfigured, token, tokenValid: !!userId });
  if (post.allow) return { ok: true, userId: userId! };
  return { ok: false, status: post.status ?? 401, reason: post.reason ?? "invalid_token" };
}

/**
 * Require an authenticated caller, unconditionally (LIFEOS-068).
 *
 * Different from `guardCostBearingRoute`, and deliberately so. That guard ties
 * the auth requirement to whether a request could spend money, which is right
 * for the AI routes: with no provider key they can only return mocks, and
 * demanding a login there would break offline use for no security gain.
 *
 * Integration linking has no such gradient. Every call is about ONE user's
 * connection to an external account, so there is no version of it that is safe
 * to serve anonymously. This returns the user id or a 401, and nothing in
 * between.
 */
export async function requireUser(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 503; reason: AuthFailure }> {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  // No identity system configured at all: a server misconfiguration, not the
  // caller's fault, and certainly not a reason to proceed without a user.
  if (!supabaseConfigured) return { ok: false, status: 503, reason: "unavailable" };

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, reason: "missing_token" };

  const userId = await verifySupabaseToken(token);
  if (!userId) return { ok: false, status: 401, reason: "invalid_token" };
  return { ok: true, userId };
}

// ------------------------------------------------------------ rate limiting ----

/**
 * A deliberately small per-identity request bucket.
 *
 * **Honest about what this is.** Vercel runs many serverless instances, so this
 * in-memory counter bounds abuse *per instance*, not globally. It is a speed
 * bump against a single caller hammering one warm instance — not a distributed
 * quota. A real quota needs shared state (Redis/Upstash) and is deliberately out
 * of scope for Early Access; the primary cost control is the auth boundary
 * above, which already requires an account per request.
 */
export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 60_000;

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

/** Pure bucket arithmetic, so the policy is testable without timers. */
export function nextBucket(
  current: Bucket | undefined,
  now: number,
  windowMs = RATE_LIMIT_WINDOW_MS,
): Bucket {
  if (!current || now >= current.resetAt) return { count: 1, resetAt: now + windowMs };
  return { count: current.count + 1, resetAt: current.resetAt };
}

export function isOverLimit(b: Bucket, max = RATE_LIMIT_MAX): boolean {
  return b.count > max;
}

/**
 * Record a request for `identity` and report whether it exceeded the bucket.
 * Identity is a user id when authenticated; unauthenticated callers never reach
 * a cost-bearing provider, so they are not the case this protects.
 */
export function rateLimit(identity: string, now = Date.now()): { limited: boolean; retryAfterSeconds: number } {
  // Opportunistic cleanup so the map cannot grow without bound on a warm instance.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
  }
  const b = nextBucket(buckets.get(identity), now);
  buckets.set(identity, b);
  return {
    limited: isOverLimit(b),
    retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

/** Test seam: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
