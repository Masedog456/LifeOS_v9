/**
 * Account linking (LIFEOS-068 §1, §2, §10, §13, §17, §24).
 *
 * ## Authentication is not touched, anywhere
 *
 * Nothing in this file can create a Conqify account, issue a session, or write
 * to `auth.identities`. The user is already signed in before any of this runs,
 * and is exactly as signed in afterwards. `supabase.auth.signInWithOAuth()` and
 * `linkIdentity()` are both absent on purpose: the first creates accounts, and
 * the second would make Google a way to *authenticate as* the user — which is
 * the thing this whole sprint exists to avoid.
 *
 * ## No half-connected accounts (§24)
 *
 * The callback does several things that can each fail independently: exchange a
 * code, fetch an identity, seal a credential, write metadata. A failure at any
 * step must leave NO row claiming to be connected and NO orphaned secret.
 *
 * Two rules make that true:
 *
 *   1. **`connected` is written last.** The row is `pending` until every other
 *      step has succeeded, so a crash anywhere leaves a pending row that
 *      expires, not a connection that does not work.
 *   2. **A failed metadata write deletes the credential it just stored.** That
 *      is the §18-G case, and it is the one that matters most: an orphaned
 *      refresh token nobody can see is a secret with no owner and no way to
 *      revoke it through the product.
 *
 * ## The vault decides whether connecting is even possible
 *
 * If the vault is unavailable the flow refuses BEFORE contacting the provider.
 * Asking a user for consent we cannot safely store would be the worst possible
 * order of operations: they would grant access, and we would drop the token.
 */

import type { KeyRing } from "@/lib/integrations/crypto";
import {
  startState, verifierOf, hashState,
  type OAuthStateStore, type StateRejection,
} from "@/lib/integrations/oauth-state";
import {
  reconcileScopes, ProviderError,
  type IntegrationOAuthProvider,
} from "@/lib/integrations/provider";
import { VaultError, type TokenVault } from "@/lib/integrations/vault";

/** Public, browser-safe metadata. Contains nothing secret, by construction. */
export interface IntegrationAccount {
  id: string;
  userId: string;
  provider: string;
  /** Absent while `pending` — unknown until the provider tells us (§9). */
  providerAccountId?: string;
  /** Human label for the settings row. Metadata, never a Person. */
  displayLabel?: string;
  /** What was GRANTED. */
  scopes: string[];
  status: IntegrationStatus;
  connectedAt?: string;
  updatedAt: string;
}

export const INTEGRATION_STATUSES = ["pending", "connected", "revoked", "error"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** Storage for the public metadata rows. */
export interface IntegrationAccountStore {
  create(account: IntegrationAccount): Promise<void>;
  update(id: string, patch: Partial<IntegrationAccount>): Promise<void>;
  get(id: string): Promise<IntegrationAccount | null>;
  /** The canonical link for a provider account, if one exists (§18). */
  findByProviderAccount(userId: string, provider: string, providerAccountId: string): Promise<IntegrationAccount | null>;
  listForUser(userId: string): Promise<IntegrationAccount[]>;
  remove(id: string): Promise<void>;
}

export interface LinkDeps {
  accounts: IntegrationAccountStore;
  states: OAuthStateStore;
  vault: TokenVault;
  provider: IntegrationOAuthProvider;
  ring: KeyRing | null;
  redirectUri: string;
  /** Injected so every test is deterministic and no module reads a clock. */
  now: () => Date;
  newId: () => string;
}

// ------------------------------------------------------------------- start --

export type StartFailure = "integration_unavailable" | "vault_unavailable" | "forbidden_scope";

export type StartResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; failure: StartFailure; reason: string };

/**
 * Begin linking. The caller has already proved who the user is.
 *
 * Order matters: the vault is checked FIRST. Sending someone to a consent
 * screen when we cannot store the result would spend their trust on nothing.
 */
export async function startLink(
  input: { userId: string; scopes: string[] },
  deps: LinkDeps,
): Promise<StartResult> {
  if (!deps.vault.available) {
    return {
      ok: false, failure: "vault_unavailable",
      reason: deps.vault.unavailableReason ?? "credential storage is unavailable",
    };
  }
  if (!deps.provider.configured) {
    return {
      ok: false, failure: "integration_unavailable",
      reason: `${deps.provider.label} is not configured for this deployment`,
    };
  }

  const started = startState({
    userId: input.userId, provider: deps.provider.id, ring: deps.ring, now: deps.now(),
  });

  let authorizationUrl: string;
  try {
    authorizationUrl = deps.provider.buildAuthorizationUrl({
      state: started.state,
      codeChallenge: started.codeChallenge,
      redirectUri: deps.redirectUri,
      scopes: input.scopes,
    });
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, failure: "forbidden_scope", reason: e.message };
    throw e;
  }

  // Persisted only once the URL exists, so a refused scope leaves no row.
  await deps.states.put(started.record);
  return { ok: true, authorizationUrl };
}

// ---------------------------------------------------------------- callback --

export type CallbackFailure =
  | "denied"
  | "missing_code"
  | "missing_state"
  | StateRejection
  | "vault_unavailable"
  | "exchange_failed"
  | "identity_failed"
  | "insufficient_scope"
  | "storage_failed";

export type CallbackResult =
  | { ok: true; accountId: string; reconnected: boolean }
  | { ok: false; failure: CallbackFailure; reason: string };

/**
 * Complete a linking flow.
 *
 * Every input is attacker-controllable — the whole request arrives through a
 * browser redirect — so the ONLY thing trusted is what the server wrote down
 * before the redirect. In particular, the Conqify user comes from the claimed
 * state record and from nowhere else (§13): not from a query parameter, not
 * from the provider's email, not from a cookie.
 */
export async function completeLink(
  input: {
    code?: string; state?: string; error?: string;
    requestedScopes: string[]; requiredScopes: string[];
  },
  deps: LinkDeps,
): Promise<CallbackResult> {
  if (input.error) {
    // The user pressed "cancel" on the consent screen. Not an error condition —
    // a decision, and the pending state is simply left to expire.
    return { ok: false, failure: "denied", reason: "authorization was declined" };
  }
  if (!input.state) return { ok: false, failure: "missing_state", reason: "no state was returned" };
  if (!input.code) return { ok: false, failure: "missing_code", reason: "no authorization code was returned" };

  // 1-4. Claim the state ATOMICALLY. This both authenticates the callback and
  //      makes replay impossible: the second attempt finds it consumed.
  const claim = await deps.states.consume(hashState(input.state), deps.provider.id, deps.now());
  if (!claim.ok) return { ok: false, failure: claim.reason, reason: `authorization state ${claim.reason}` };
  const { userId } = claim.record;

  // Re-checked here and not only in `startLink`: a vault can become unavailable
  // between the two, and a credential we cannot store must never be fetched.
  if (!deps.vault.available) {
    return {
      ok: false, failure: "vault_unavailable",
      reason: deps.vault.unavailableReason ?? "credential storage is unavailable",
    };
  }

  // 5. Exchange the code.
  let tokens;
  try {
    tokens = await deps.provider.exchangeCode({
      code: input.code,
      codeVerifier: verifierOf(claim.record, deps.ring),
      redirectUri: deps.redirectUri,
    });
  } catch {
    return { ok: false, failure: "exchange_failed", reason: "the provider rejected the authorization" };
  }

  // §12. What was granted, not what was asked. A missing REQUIRED scope fails
  // the connection rather than producing something that 403s later.
  const scopes = reconcileScopes(input.requestedScopes, tokens.grantedScopes, input.requiredScopes);
  if (scopes.missingRequired.length > 0) {
    return {
      ok: false, failure: "insufficient_scope",
      reason: `the connection needs ${scopes.missingRequired.join(", ")}`,
    };
  }

  // 6. Who is this? §18-H: a failed identity fetch persists NO credential,
  //    which is why this happens before anything is stored.
  let identity;
  try {
    identity = await deps.provider.getAccountIdentity(tokens.accessToken);
  } catch {
    return { ok: false, failure: "identity_failed", reason: "couldn't read the provider account" };
  }

  // §18. Reconnecting the same provider account reuses its canonical row rather
  // than creating a second link to one account.
  const existing = await deps.accounts.findByProviderAccount(userId, deps.provider.id, identity.accountId);
  const accountId = existing?.id ?? deps.newId();
  const nowIso = deps.now().toISOString();

  if (!existing) {
    await deps.accounts.create({
      id: accountId, userId, provider: deps.provider.id,
      scopes: [], status: "pending", updatedAt: nowIso,
    });
  }

  // 7. Seal and store the credential.
  try {
    await deps.vault.store(accountId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: expiryFrom(tokens.expiresInSeconds, deps.now()),
      grantedScopes: scopes.granted,
    });
  } catch (e) {
    // Nothing was written that claims to work. A brand-new pending row is
    // removed so a failed attempt leaves no debris.
    if (!existing) await deps.accounts.remove(accountId).catch(() => {});
    const reason = e instanceof VaultError ? e.message : "credential storage failed";
    return { ok: false, failure: "vault_unavailable", reason };
  }

  // 8. Only now does anything say "connected".
  try {
    await deps.accounts.update(accountId, {
      providerAccountId: identity.accountId,
      displayLabel: identity.label,
      scopes: scopes.granted,
      status: "connected",
      connectedAt: existing?.connectedAt ?? nowIso,
      updatedAt: nowIso,
    });
  } catch {
    // §18-G. The credential is already sealed in the vault and nothing points at
    // it any more. Deleting it is not cleanup — it is the difference between a
    // failed connection and a permanent orphaned secret.
    await deps.vault.delete(accountId).catch(() => {});
    if (!existing) await deps.accounts.remove(accountId).catch(() => {});
    return { ok: false, failure: "storage_failed", reason: "couldn't save the connection" };
  }

  return { ok: true, accountId, reconnected: !!existing };
}

function expiryFrom(expiresInSeconds: number | undefined, now: Date): string | undefined {
  if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) return undefined;
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

// -------------------------------------------------------------- disconnect --

export interface DisconnectResult {
  credentialDeleted: boolean;
  providerRevoked: boolean;
  metadataRemoved: boolean;
}

/**
 * Disconnect (§15, §17).
 *
 * Revocation is attempted first and its failure is RECORDED, never fatal: a
 * provider that is unreachable must not leave a usable credential sitting in
 * our database forever. Local deletion is the part that is guaranteed.
 *
 * Nothing else the user owns is touched. LIFEOS-067 already decided what
 * happens to imported Events — they become ordinary local ones, keeping their
 * notes and links — and that behaviour is unchanged and lives in the calendar
 * layer, not here.
 */
export async function disconnect(
  input: { userId: string; accountId: string },
  deps: Pick<LinkDeps, "accounts" | "vault" | "provider">,
): Promise<DisconnectResult | { ok: false; reason: "not_found" | "forbidden" }> {
  const account = await deps.accounts.get(input.accountId);
  if (!account) return { ok: false, reason: "not_found" };
  // Ownership is checked here and not assumed from the request.
  if (account.userId !== input.userId) return { ok: false, reason: "forbidden" };

  let providerRevoked = false;
  try {
    const cred = await deps.vault.load(input.accountId);
    if (deps.provider.configured) {
      providerRevoked = await deps.provider.revoke(cred.refreshToken ?? cred.accessToken);
    }
  } catch {
    // No credential, or an unreadable one. Deletion still proceeds.
  }

  let credentialDeleted = true;
  try { await deps.vault.delete(input.accountId); } catch { credentialDeleted = false; }

  await deps.accounts.remove(input.accountId);
  return { credentialDeleted, providerRevoked, metadataRemoved: true };
}

/**
 * Remove every integration belonging to a user (§16, §29).
 *
 * Called when a Conqify account is deleted. Revocation is attempted, but
 * credential deletion is MANDATORY and happens regardless — an orphaned refresh
 * token that outlives the account it belonged to is the worst outcome available
 * here, because nobody is left who could ever revoke it.
 */
export async function purgeUserIntegrations(
  userId: string,
  deps: Pick<LinkDeps, "accounts" | "vault" | "provider" | "states">,
): Promise<{ accounts: number; credentials: number; states: number }> {
  const accounts = await deps.accounts.listForUser(userId);
  let credentials = 0;
  for (const a of accounts) {
    try {
      const cred = await deps.vault.load(a.id);
      if (deps.provider.configured) await deps.provider.revoke(cred.refreshToken ?? cred.accessToken).catch(() => false);
    } catch { /* unreadable or absent — deletion still happens */ }
    try { await deps.vault.delete(a.id); credentials += 1; } catch { /* counted below as not deleted */ }
    await deps.accounts.remove(a.id);
  }
  const states = await deps.states.deleteForUser(userId);
  return { accounts: accounts.length, credentials, states };
}
