/**
 * Server-only provider access (LIFEOS-068 §13, §14, §16, §20).
 *
 * ## The only way to get a provider token, and it is a dead end for the browser
 *
 * `getProviderAccessToken` returns a token. Nothing in `app/` may return its
 * result to a client, no React component may import this module, and no API
 * route may serialize what it produces. The token exists to be attached to an
 * outbound request to the provider, in the same process, and then forgotten.
 *
 * The type helps: the result is `{ accessToken }` and nothing else, so there is
 * no object here that could be spread into a JSON response "by accident" and
 * carry a secret along with some harmless metadata.
 *
 * ## The refresh rule that breaks integrations when it is wrong
 *
 * Google returns a refresh token on the FIRST consent and usually omits it from
 * every refresh response afterwards. A naive implementation writes back
 * whatever it received, the stored refresh token becomes `undefined`, and the
 * integration dies the next time the access token expires — an hour later, with
 * no error the user could act on.
 *
 * So: **an absent refresh token in a refresh response PRESERVES the stored
 * one.** A present one replaces it (rotation), and the old value becomes
 * unretrievable. Both directions are asserted.
 *
 * ## `invalid_grant` is the only revocation signal
 *
 * A network blip, a 500, a timeout — none of these mean the user revoked us,
 * and marking an integration `revoked` on a transient failure would make people
 * reconnect for no reason. Only `invalid_grant` does that.
 */

import { ProviderError, type IntegrationOAuthProvider } from "@/lib/integrations/provider";
import { VaultError, assertServerOnly, type TokenVault } from "@/lib/integrations/vault";
import type { IntegrationAccountStore } from "@/lib/integrations/link";

/**
 * Refresh this long before actual expiry.
 *
 * A token that expires in twenty seconds is not usable for a request that takes
 * thirty. The margin turns "technically valid" into "valid when it arrives".
 */
export const REFRESH_MARGIN_SECONDS = 120;

export type AccessFailure =
  | "not_found"
  | "forbidden"
  | "not_connected"
  | "vault_unavailable"
  | "no_refresh_token"
  | "revoked"
  | "refresh_failed";

export type AccessResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; failure: AccessFailure; reason: string };

export interface AccessDeps {
  accounts: IntegrationAccountStore;
  vault: TokenVault;
  provider: IntegrationOAuthProvider;
  now: () => Date;
}

/** Is this access token too close to expiry to use? */
export function needsRefresh(expiresAt: string | undefined, now: Date, marginSeconds = REFRESH_MARGIN_SECONDS): boolean {
  // Unknown expiry is treated as expired. Refreshing unnecessarily costs one
  // request; using a dead token costs a failed sync the user has to diagnose.
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t - now.getTime() <= marginSeconds * 1000;
}

/**
 * Get a usable access token for one linked account.
 *
 * **Server only.** Ownership is verified here rather than trusted from the
 * caller: an integration id is a guessable-shaped string arriving from
 * somewhere, and the user it belongs to is a fact only the database has.
 */
export async function getProviderAccessToken(
  input: { userId: string; accountId: string },
  deps: AccessDeps,
): Promise<AccessResult> {
  assertServerOnly();

  const account = await deps.accounts.get(input.accountId);
  if (!account) return { ok: false, failure: "not_found", reason: "no such integration" };
  // §31.5 — a fabricated integration id belonging to nobody, or to someone
  // else, is refused with the same answer either way.
  if (account.userId !== input.userId) return { ok: false, failure: "forbidden", reason: "no such integration" };
  if (account.status !== "connected") {
    return { ok: false, failure: "not_connected", reason: `this integration is ${account.status}` };
  }

  let cred;
  try {
    cred = await deps.vault.load(input.accountId);
  } catch (e) {
    const reason = e instanceof VaultError ? e.message : "credential storage is unavailable";
    return { ok: false, failure: "vault_unavailable", reason };
  }

  if (!needsRefresh(cred.accessTokenExpiresAt, deps.now())) {
    return { ok: true, accessToken: cred.accessToken, refreshed: false };
  }

  if (!cred.refreshToken) {
    // Nothing to refresh with. Honest failure — the user has to reconnect, and
    // pretending otherwise would produce a confusing provider 401.
    return { ok: false, failure: "no_refresh_token", reason: "this connection needs to be set up again" };
  }

  let tokens;
  try {
    tokens = await deps.provider.refreshAccessToken(cred.refreshToken);
  } catch (e) {
    if (e instanceof ProviderError && e.failure === "invalid_grant") {
      // The one signal that actually means "the user took access away".
      await deps.accounts.update(input.accountId, {
        status: "revoked", updatedAt: deps.now().toISOString(),
      }).catch(() => {});
      return { ok: false, failure: "revoked", reason: "access was revoked at the provider" };
    }
    // Transient. The integration stays connected, because it probably still is.
    return { ok: false, failure: "refresh_failed", reason: "couldn't refresh access just now" };
  }

  try {
    await deps.vault.replace(input.accountId, {
      accessToken: tokens.accessToken,
      // The rule. `undefined` here PRESERVES the stored refresh token; a value
      // rotates it. `vault.replace` is where that is implemented.
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.expiresInSeconds
        ? new Date(deps.now().getTime() + tokens.expiresInSeconds * 1000).toISOString()
        : undefined,
      // Scopes are only overwritten when the provider actually stated them.
      grantedScopes: tokens.grantedScopes.length > 0 ? tokens.grantedScopes : undefined,
    });
  } catch (e) {
    const reason = e instanceof VaultError ? e.message : "credential storage failed";
    return { ok: false, failure: "vault_unavailable", reason };
  }

  return { ok: true, accessToken: tokens.accessToken, refreshed: true };
}

/**
 * Fields that must never appear in anything this module's callers return to a
 * browser. Asserted by the self-test against real API responses.
 */
export const FORBIDDEN_RESPONSE_FIELDS: readonly string[] = [
  "accessToken", "access_token", "refreshToken", "refresh_token",
  "code", "code_verifier", "codeVerifier", "client_secret", "clientSecret",
  "id_token", "idToken", "ciphertext", "state",
];
