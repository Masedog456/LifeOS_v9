/**
 * Client-side access-token helper for cost-bearing API routes (LIFEOS-055S).
 *
 * The server now requires an authenticated caller before it will spend money on
 * a provider. This attaches the Supabase session the browser ALREADY holds — it
 * mints nothing, stores nothing, and creates no second identity.
 *
 * Signed-out users simply send no header. The routes answer 401, and every
 * caller already falls back to deterministic mocks, so signed-out and local-only
 * use keeps working exactly as before — just without paid AI.
 */

import { getSupabaseClient } from "@/lib/supabase";

/** The current access token, or null when signed out / Supabase unconfigured. */
export async function currentAccessToken(): Promise<string | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * JSON request headers, with `Authorization: Bearer <token>` when a session
 * exists. Never throws — a header that cannot be built is simply omitted.
 */
export async function authedJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = await currentAccessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
