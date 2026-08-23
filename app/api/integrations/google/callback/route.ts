/**
 * Complete a Google account link (LIFEOS-068 §10, §13, §24).
 *
 * GET, because a provider redirect is a top-level browser navigation.
 *
 * ## Ownership comes from the state, never from the request
 *
 * This request carries no `Authorization` header — a redirect cannot. So the
 * Conqify user is read from the server-side state record claimed atomically by
 * `completeLink`, and from nothing else: not a query parameter, not the
 * provider's email address, not a cookie. §13.
 *
 * ## It always redirects, and never leaks
 *
 * Every outcome ends at the settings page with a short status word. No token,
 * no code, no state, and no provider error body is ever placed in a URL the
 * browser will keep in its history.
 */

import { NextResponse } from "next/server";
import { completeLink } from "@/lib/integrations/link";
import { resolveGoogleProvider, GOOGLE_CALENDAR_SCOPES } from "@/lib/integrations/provider";
import { resolveProductionVault } from "@/lib/integrations/vault";
import { keyRingFromEnv } from "@/lib/integrations/crypto";
import { unavailableStateStore, redirectUriFor, SETTINGS_PATH } from "@/lib/integrations/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = new URL(SETTINGS_PATH, url.origin);
  to.searchParams.set("integration", "google");

  let result;
  try {
    result = await completeLink(
      {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        requestedScopes: [...GOOGLE_CALENDAR_SCOPES],
        requiredScopes: [...GOOGLE_CALENDAR_SCOPES],
      },
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
    // A store that refuses (this deployment has no privileged connection) throws
    // rather than returning. Redirecting with a status beats a 500: a stack
    // trace on a page the user was sent to by Google tells them nothing, and an
    // error body is a bad place for anything the server knows.
    to.searchParams.set("status", "unavailable");
    return NextResponse.redirect(to, 303);
  }

  // A single, non-identifying status word. `failure` is one of a closed set of
  // our own strings — never the provider's message, which can contain anything.
  to.searchParams.set("status", result.ok ? "connected" : result.failure);
  return NextResponse.redirect(to, 303);
}
