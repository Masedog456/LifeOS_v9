/**
 * What the running deployment actually has (LIFEOS-068 §2, §5, §6).
 *
 * ## Why the stores are unavailable, stated plainly
 *
 * `integration_accounts` and `integration_oauth_states` are ordinary RLS tables
 * a signed-in user could read — but the OAuth CALLBACK arrives as a top-level
 * browser navigation with no `Authorization` header, so the server cannot act
 * as that user at the exact moment it must claim the state row. And
 * `private.integration_credentials` has no PostgREST path at all, by design.
 *
 * All three therefore need the same thing: a privileged server connection this
 * deployment does not have. Rather than half-wire it, every store here refuses,
 * and `startLink` reports `integration_unavailable` before anyone is redirected.
 *
 * ## What is deliberately NOT done here
 *
 * No dynamic lookup, no string-concatenated environment variable name, no
 * indirect alias — nothing that would slip past `scripts/scan-secrets.mjs`
 * while doing the thing the scanner exists to prevent. §6 is explicit, and it
 * is right: passing a regex while defeating its intent is worse than being
 * blocked, because the next reader believes the guarantee still holds.
 *
 * The privileged path is a separate, reviewed change for a day when Google
 * credentials and secure secret storage both exist.
 */

import type { IntegrationAccountStore } from "@/lib/integrations/link";
import type { OAuthStateStore } from "@/lib/integrations/oauth-state";

/** Where the settings surface lives. One place, so the routes cannot disagree. */
export const SETTINGS_PATH = "/backup";

/** The reason every store below refuses. Shown to the user, safe to log. */
export const NO_PRIVILEGED_STORE =
  "integration storage needs a privileged server connection this deployment doesn't have";

function refuse(): never {
  throw new Error(NO_PRIVILEGED_STORE);
}

/**
 * Stores that exist to be refused.
 *
 * Every method throws the same named error. A caller that forgets to check
 * availability fails loudly at the first write instead of silently succeeding
 * against nothing — which is the failure mode that produces a UI claiming a
 * connection that was never stored.
 */
export const unavailableStateStore: {
  accounts: IntegrationAccountStore;
  states: OAuthStateStore;
} = {
  accounts: {
    async create() { refuse(); },
    async update() { refuse(); },
    async get() { refuse(); },
    async findByProviderAccount() { refuse(); },
    // Listing is the one safe answer: a deployment with no store genuinely has
    // no integrations, and the settings surface should render empty rather than
    // error.
    async listForUser() { return []; },
    async remove() { refuse(); },
  },
  states: {
    async put() { refuse(); },
    async consume() { refuse(); },
    async purgeExpired() { return 0; },
    async deleteForUser() { return 0; },
  },
};

/**
 * The redirect URI for a provider callback.
 *
 * Derived from the request's own origin so a preview deployment and production
 * do not need separate configuration — and it must match what is registered
 * with the provider exactly, which is why it is computed in one place.
 */
export function redirectUriFor(request: Request, provider: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/integrations/${provider}/callback`;
}
