/**
 * The token vault (LIFEOS-068 §2, §7).
 *
 * Provider refresh tokens are the most dangerous thing this product will ever
 * hold: one of them is standing permission to read somebody's calendar, and
 * unlike a password nobody ever notices it leaking. So the rules here are
 * absolute and structural rather than remembered:
 *
 *   - **server only.** `assertServerOnly()` throws in a browser.
 *   - **never in `StoreState`.** No store domain references this module.
 *   - **never exported.** Asserted by the export self-test.
 *   - **never logged.** No function here formats a secret into a string.
 *   - **never plaintext.** Both implementations seal before storing; there is
 *     no code path that writes a raw token anywhere.
 *
 * ## Fail closed — the path that does not exist
 *
 * There is deliberately no branch anywhere in this file that reads
 *
 *     if (vault unavailable) → store plaintext
 *
 * An unavailable vault REFUSES. That is why `unavailableVault()` exists as a
 * first-class implementation rather than as a `null` some caller might forget
 * to check: every consumer holds a `TokenVault`, calls it, and handles the
 * rejection. A missing vault cannot be silently skipped past.
 *
 * ## Why the production backend is not wired in this build
 *
 * It needs a PRIVILEGED database handle — one that can read a table the browser
 * has no path to. Every server route in this codebase deliberately carries only
 * the *user's* JWT, so PostgREST evaluates RLS as that user, and a table the
 * user cannot read is also one our own route cannot read.
 *
 * Obtaining that handle requires a privileged Supabase credential, which
 * (a) does not exist in this environment and (b) is refused in `app/lib/components`
 * by `scripts/scan-secrets.mjs`, a release gate that was deliberately left
 * unchanged. So `supabaseTokenVault` takes the handle as an ARGUMENT and
 * `resolveProductionVault()` reports it unavailable with the reason. Nothing
 * here looks the credential up dynamically, assembles its name from fragments,
 * or otherwise arranges to slip past a scanner — that would defeat the intent
 * while satisfying the regex, which is worse than being blocked.
 */

import {
  seal, open, keyRingFromEnv, VaultCryptoError,
  type KeyRing, type SealedSecret,
} from "@/lib/integrations/crypto";

/** Refuse to run in a browser. Loud, not a silent no-op. */
export function assertServerOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("The token vault must never run in a browser.");
  }
}

/** What is stored for one linked account. Secrets are sealed before they land. */
export interface StoredCredential {
  accessToken: string;
  /**
   * Absent is a real, common state: Google returns a refresh token on the FIRST
   * consent and often not afterwards. Absent here means "we never had one",
   * which is different from "the last refresh omitted it" — see `replace`.
   */
  refreshToken?: string;
  /** ISO. Absent means unknown, which callers treat as "refresh before use". */
  accessTokenExpiresAt?: string;
  /** What the provider actually GRANTED, not what we asked for (§12). */
  grantedScopes: string[];
}

/** A partial update. `undefined` means "leave what is stored alone". */
export interface CredentialPatch {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  grantedScopes?: string[];
}

export type VaultFailure =
  | "unavailable"
  | "not_found"
  | "no_key"
  | "unsupported_key_version"
  | "authentication_failed"
  | "write_failed";

export class VaultError extends Error {
  constructor(public readonly failure: VaultFailure, message?: string) {
    super(message ?? failure);
    this.name = "VaultError";
  }
}

export interface TokenVault {
  /** False when this vault cannot operate. Callers must check before connecting. */
  readonly available: boolean;
  /** Plain language, shown to the user and safe to log. Never mentions a secret. */
  readonly unavailableReason?: string;
  store(accountId: string, credential: StoredCredential): Promise<void>;
  load(accountId: string): Promise<StoredCredential>;
  /**
   * Merge an update.
   *
   * §13's rule lives here: a `refreshToken` of `undefined` PRESERVES the stored
   * one. Google's refresh responses routinely omit it, and treating that as
   * "the user revoked us" would disconnect a working integration on its first
   * token refresh.
   */
  replace(accountId: string, patch: CredentialPatch): Promise<void>;
  delete(accountId: string): Promise<void>;
}

// ------------------------------------------------------------ unavailable ---

/**
 * A vault that refuses everything, for a stated reason.
 *
 * A first-class implementation rather than `null`, so that "no vault" travels
 * through the same interface as a working one and cannot be forgotten at a
 * call site.
 */
export function unavailableVault(reason: string): TokenVault {
  const refuse = async (): Promise<never> => { throw new VaultError("unavailable", reason); };
  return {
    available: false,
    unavailableReason: reason,
    store: refuse,
    load: refuse,
    replace: refuse,
    delete: async () => {
      // Deleting from a vault that never stored anything is a no-op, not an
      // error: §15 says local credential deletion must always be able to
      // proceed, and a disconnect must never be blocked by an unavailable vault.
    },
  };
}

// --------------------------------------------------------------- in-memory --

/**
 * A deterministic vault for tests.
 *
 * It still ENCRYPTS. That is not ceremony: it means the fixture exercises the
 * real seal/open path, so a key-version bug or a tag-verification bug is caught
 * by the suite rather than at whatever future moment the production backend is
 * first wired up.
 */
export function memoryVault(ring: KeyRing | null): TokenVault {
  const rows = new Map<string, { access: SealedSecret; refresh?: SealedSecret; expiresAt?: string; scopes: string[] }>();
  if (!ring) return unavailableVault("no encryption key is configured");

  const wrap = async <T>(fn: () => T): Promise<T> => {
    try { return fn(); }
    catch (e) {
      if (e instanceof VaultCryptoError) throw new VaultError(e.failure as VaultFailure, e.message);
      throw e;
    }
  };

  return {
    available: true,
    async store(accountId, credential) {
      assertServerOnly();
      await wrap(() => {
        rows.set(accountId, {
          access: seal(credential.accessToken, ring),
          refresh: credential.refreshToken ? seal(credential.refreshToken, ring) : undefined,
          expiresAt: credential.accessTokenExpiresAt,
          scopes: [...credential.grantedScopes],
        });
      });
    },
    async load(accountId) {
      assertServerOnly();
      const row = rows.get(accountId);
      if (!row) throw new VaultError("not_found");
      return wrap(() => ({
        accessToken: open(row.access, ring),
        refreshToken: row.refresh ? open(row.refresh, ring) : undefined,
        accessTokenExpiresAt: row.expiresAt,
        grantedScopes: [...row.scopes],
      }));
    },
    async replace(accountId, patch) {
      assertServerOnly();
      const row = rows.get(accountId);
      if (!row) throw new VaultError("not_found");
      await wrap(() => {
        rows.set(accountId, {
          access: patch.accessToken !== undefined ? seal(patch.accessToken, ring) : row.access,
          // The §13 rule, in one line: undefined preserves.
          refresh: patch.refreshToken !== undefined ? seal(patch.refreshToken, ring) : row.refresh,
          expiresAt: patch.accessTokenExpiresAt !== undefined ? patch.accessTokenExpiresAt : row.expiresAt,
          scopes: patch.grantedScopes !== undefined ? [...patch.grantedScopes] : row.scopes,
        });
      });
    },
    async delete(accountId) {
      assertServerOnly();
      rows.delete(accountId);
    },
  };
}

// -------------------------------------------------------- production seam ---

/**
 * The privileged store the production vault needs.
 *
 * Deliberately an INTERFACE taking sealed blobs, not a Supabase client: this
 * module never learns how the privileged connection is obtained, and the thing
 * that eventually provides it can be reviewed on its own.
 *
 * Note every method takes and returns `SealedSecret` — the privileged store
 * handles ciphertext only. Even a compromised implementation of this interface
 * never sees a token.
 */
export interface PrivilegedCredentialStore {
  put(accountId: string, row: {
    access: SealedSecret; refresh?: SealedSecret; expiresAt?: string; scopes: string[];
  }): Promise<void>;
  get(accountId: string): Promise<{
    access: SealedSecret; refresh?: SealedSecret; expiresAt?: string; scopes: string[];
  } | null>;
  remove(accountId: string): Promise<void>;
}

/**
 * The real vault, over a privileged store.
 *
 * Identical semantics to `memoryVault` — same sealing, same preserve-on-undefined
 * rule — because the tests that prove those semantics must be proving the thing
 * that will actually run.
 */
export function supabaseTokenVault(store: PrivilegedCredentialStore | null, ring: KeyRing | null): TokenVault {
  if (!ring) return unavailableVault("no encryption key is configured");
  if (!store) return unavailableVault("no privileged credential store is configured");

  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof VaultCryptoError) throw new VaultError(e.failure as VaultFailure, e.message);
      if (e instanceof VaultError) throw e;
      // Whatever the storage layer threw, it is not repeated: a driver error
      // can carry a connection string.
      throw new VaultError("write_failed", "the credential store rejected the write");
    }
  };

  return {
    available: true,
    async store(accountId, credential) {
      assertServerOnly();
      await wrap(async () => store.put(accountId, {
        access: seal(credential.accessToken, ring),
        refresh: credential.refreshToken ? seal(credential.refreshToken, ring) : undefined,
        expiresAt: credential.accessTokenExpiresAt,
        scopes: [...credential.grantedScopes],
      }));
    },
    async load(accountId) {
      assertServerOnly();
      const row = await wrap(async () => store.get(accountId));
      if (!row) throw new VaultError("not_found");
      return wrap(async () => ({
        accessToken: open(row.access, ring),
        refreshToken: row.refresh ? open(row.refresh, ring) : undefined,
        accessTokenExpiresAt: row.expiresAt,
        grantedScopes: [...row.scopes],
      }));
    },
    async replace(accountId, patch) {
      assertServerOnly();
      const row = await wrap(async () => store.get(accountId));
      if (!row) throw new VaultError("not_found");
      await wrap(async () => store.put(accountId, {
        access: patch.accessToken !== undefined ? seal(patch.accessToken, ring) : row.access,
        refresh: patch.refreshToken !== undefined ? seal(patch.refreshToken, ring) : row.refresh,
        expiresAt: patch.accessTokenExpiresAt !== undefined ? patch.accessTokenExpiresAt : row.expiresAt,
        scopes: patch.grantedScopes !== undefined ? [...patch.grantedScopes] : row.scopes,
      }));
    },
    async delete(accountId) {
      assertServerOnly();
      await wrap(async () => store.remove(accountId));
    },
  };
}

/**
 * The vault this build actually gets.
 *
 * Two things are required and neither is present:
 *
 *   1. An encryption key in server-only configuration (`INTEGRATION_TOKEN_KEY`).
 *   2. A privileged credential store — see the module docstring for why one
 *      cannot be constructed here without changing a security gate that was
 *      deliberately left alone.
 *
 * So this returns an unavailable vault with the reason, and every caller
 * refuses to mark an integration connected. That is the correct outcome, not a
 * gap: an integration that cannot store its credential safely must not claim to
 * be connected.
 */
export function resolveProductionVault(env: Record<string, string | undefined> = process.env): TokenVault {
  assertServerOnly();
  const ring = keyRingFromEnv(env);
  if (!ring) return unavailableVault("no encryption key is configured");
  // No privileged store exists in this build. Deliberately passed as null
  // rather than looked up, so the absence is visible in the code.
  return supabaseTokenVault(null, ring);
}
