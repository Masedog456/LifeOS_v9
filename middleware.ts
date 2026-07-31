/**
 * Production security headers + Content-Security-Policy (LIFEOS-040, Feature 26).
 *
 * Sets the shared, self-tested security header set (including CSP) on every
 * document response. See lib/security/headers.ts for the policy and the two
 * documented exceptions (framework inline scripts/styles). We do not use a
 * per-request nonce: Next's App Router + Turbopack emit un-nonced first-party
 * inline scripts, so the CSP allows `'unsafe-inline'` for scripts (never
 * `'unsafe-eval'`) rather than silently breaking the framework.
 */

import { NextResponse } from "next/server";
import { securityHeaders } from "@/lib/security/headers";

export function middleware() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let supabaseOrigin: string | undefined;
  try { if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin; } catch { /* ignore */ }

  const response = NextResponse.next();
  for (const h of securityHeaders({ supabaseOrigin })) response.headers.set(h.key, h.value);
  return response;
}

export const config = {
  // Apply to all routes except Next internals and static assets.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
