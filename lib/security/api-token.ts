/**
 * Client-side access-token helper for cost-bearing API routes (LIFEOS-055S,
 * repaired in LIFEOS-055T).
 *
 * The server requires an authenticated caller before it will spend money on a
 * provider. This attaches the Supabase session the browser ALREADY holds — it
 * mints nothing, stores nothing, and creates no second identity.
 *
 * ## Why the first version produced 401s for signed-in users
 *
 * It asked for `getSession()` and sent whatever came back. That is correct only
 * in the happy case. A Supabase access token is a short-lived JWT (one hour by
 * default), and `autoRefreshToken` only keeps it fresh while the tab is awake.
 * A user who left Conqify open, or came back to a backgrounded tab, is still
 * *signed in* — the UI shows their email, sync works, `onAuthStateChange` never
 * fired — while the stored access token has already expired. Sending it earns a
 * server 401, and the client then reported "no AI key configured", which was
 * both wrong and unactionable.
 *
 * So this now treats a token as usable only if it is actually still valid, and
 * refreshes once when it is not. Signed-out users still send no header at all.
 */

import { getSupabaseClient } from "@/lib/supabase";

/** Refresh when a token expires within this window (clock skew + flight time). */
export const TOKEN_REFRESH_SKEW_SECONDS = 60;

/**
 * Is a token still usable, given its expiry?
 *
 * Pure, so the policy is testable without a browser or a Supabase project.
 * A session with no `expires_at` is treated as usable — some flows omit it, and
 * the server remains the real authority either way.
 */
export function tokenIsFresh(
  expiresAtSeconds: number | undefined,
  nowMs = Date.now(),
  skewSeconds = TOKEN_REFRESH_SKEW_SECONDS,
): boolean {
  if (typeof expiresAtSeconds !== "number") return true;
  return expiresAtSeconds - skewSeconds > Math.floor(nowMs / 1000);
}

/**
 * The current, still-valid access token, or null when signed out.
 *
 * Refreshes exactly once when the stored token is missing or about to expire.
 * Never throws: a token that cannot be obtained simply means no header, and the
 * caller degrades to deterministic mocks.
 */
export async function currentAccessToken(): Promise<string | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data } = await client.auth.getSession();
    const session = data?.session;
    if (session?.access_token && tokenIsFresh(session.expires_at)) {
      return session.access_token;
    }

    // Missing or stale. One refresh attempt — the case that broke Reading → Ask
    // for a signed-in user on a long-lived tab.
    const refreshed = await client.auth.refreshSession();
    return refreshed.data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * JSON request headers, with `Authorization: Bearer <token>` when a valid
 * session exists. Never throws — a header that cannot be built is omitted.
 */
export async function authedJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = await currentAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
