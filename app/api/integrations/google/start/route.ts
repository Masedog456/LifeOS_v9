/**
 * Begin linking a Google account (LIFEOS-068 §9, §10).
 *
 * POST, with the caller's existing Conqify bearer token.
 *
 * ## This is not a login route
 *
 * It does not create a session, does not touch `auth.identities`, and refuses
 * outright unless the caller is ALREADY authenticated. The Conqify identity is
 * an input here, never an output.
 *
 * ## It refuses honestly rather than redirecting into a wall
 *
 * With no credential vault and no Google client configured, this returns a
 * plain `integration_unavailable` with a human reason. It does not build a
 * plausible accounts.google.com URL and let the user discover the problem after
 * granting consent.
 */

import { NextResponse } from "next/server";
import { requireUser, rateLimit } from "@/lib/security/api-auth";
import { startLink } from "@/lib/integrations/link";
import { resolveGoogleProvider, GOOGLE_CALENDAR_SCOPES } from "@/lib/integrations/provider";
import { resolveProductionVault } from "@/lib/integrations/vault";
import { keyRingFromEnv } from "@/lib/integrations/crypto";
import { unavailableStateStore, redirectUriFor } from "@/lib/integrations/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const limited = rateLimit(`integrations:${auth.userId}`);
  if (limited.limited) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } });
  }

  let result;
  try {
    result = await startLink(
      { userId: auth.userId, scopes: [...GOOGLE_CALENDAR_SCOPES] },
      {
        accounts: unavailableStateStore.accounts,
        states: unavailableStateStore.states,
        vault: resolveProductionVault(),
        provider: resolveGoogleProvider(),
        ring: keyRingFromEnv(process.env),
        redirectUri: redirectUriFor(request, "google"),
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
      },
    );
  } catch {
    // Same reasoning as the callback: a refusing store throws, and a 501 with a
    // named reason is more useful to a caller than a 500 with a stack.
    return NextResponse.json({ error: "integration_unavailable" }, { status: 501 });
  }

  if (!result.ok) {
    // 501: the server understands the request and has not implemented the
    // capability in this deployment. Not 500 — nothing went wrong — and not
    // 403, which would suggest the user did something they may not.
    return NextResponse.json({ error: result.failure, reason: result.reason }, { status: 501 });
  }
  // The URL is the ONLY thing returned. No state, no verifier, no token.
  return NextResponse.json({ authorizationUrl: result.authorizationUrl });
}
