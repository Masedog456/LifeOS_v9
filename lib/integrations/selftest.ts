/**
 * Integration linking self-tests (LIFEOS-068 §18, §31, §34, §38).
 *
 * ## This suite is almost entirely negative
 *
 * That is the correct shape for it. A refresh token is standing permission to
 * read someone's calendar, and unlike a password nobody notices one leaking. So
 * what is asserted here is mostly what must NOT happen: a state that cannot be
 * replayed, a callback that cannot be redirected to another user's account, a
 * token that cannot reach a browser, a failed write that cannot leave an
 * orphaned secret, and — the hard gate — an authorization that cannot create or
 * replace a Conqify login.
 *
 * ## Section 6 is the one that would end the sprint if it failed
 *
 * §34: Google authorization must not create an account, must not replace a
 * session, and must not sign in a logged-out visitor. Those are asserted
 * structurally — by the absence of the APIs that could do them — because a
 * behavioural test can only prove that today's code path does not, while an
 * absent import proves no code path exists.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  seal, open, keyRing, keyRingFromEnv, VaultCryptoError, safeEqual,
  type KeyRing, type SealedSecret,
} from "@/lib/integrations/crypto";
import {
  memoryVault, unavailableVault, supabaseTokenVault, resolveProductionVault,
  VaultError, type PrivilegedCredentialStore, type StoredCredential, type TokenVault,
} from "@/lib/integrations/vault";
import {
  startState, hashState, codeChallengeFor, verifierOf, memoryStateStore,
  CONSUME_STATE_SQL, OAUTH_STATE_TTL_SECONDS,
} from "@/lib/integrations/oauth-state";
import {
  googleOAuthProvider, googleConfigFromEnv, reconcileScopes, assertLeastPrivilege,
  GOOGLE_CALENDAR_SCOPES, FORBIDDEN_SCOPE_PATTERNS, ProviderError,
  type IntegrationOAuthProvider, type ProviderTokens,
} from "@/lib/integrations/provider";
import {
  startLink, completeLink, disconnect, purgeUserIntegrations,
  INTEGRATION_STATUSES,
  type IntegrationAccount, type IntegrationAccountStore, type LinkDeps,
} from "@/lib/integrations/link";
import { getProviderAccessToken, needsRefresh, FORBIDDEN_RESPONSE_FIELDS } from "@/lib/integrations/access";
import { NO_PRIVILEGED_STORE, unavailableStateStore } from "@/lib/integrations/runtime";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import { STORE_DOMAINS } from "@/lib/ux/backup";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const NOW = new Date("2026-03-02T09:00:00.000Z");
const KEY = Buffer.alloc(32, 7);
const KEY2 = Buffer.alloc(32, 9);
const RING = keyRing([{ version: 1, key: KEY }])!;

/** A deterministic account store. */
function memoryAccounts(): IntegrationAccountStore & { rows: Map<string, IntegrationAccount>; failNextUpdate?: boolean } {
  const rows = new Map<string, IntegrationAccount>();
  const store = {
    rows,
    failNextUpdate: false,
    async create(a: IntegrationAccount) { rows.set(a.id, { ...a }); },
    async update(id: string, patch: Partial<IntegrationAccount>) {
      if (store.failNextUpdate) { store.failNextUpdate = false; throw new Error("metadata write failed"); }
      const cur = rows.get(id);
      if (!cur) throw new Error("not found");
      rows.set(id, { ...cur, ...patch });
    },
    async get(id: string) { return rows.get(id) ?? null; },
    async findByProviderAccount(userId: string, provider: string, providerAccountId: string) {
      for (const a of rows.values()) {
        if (a.userId === userId && a.provider === provider && a.providerAccountId === providerAccountId) return a;
      }
      return null;
    },
    async listForUser(userId: string) { return [...rows.values()].filter((a) => a.userId === userId); },
    async remove(id: string) { rows.delete(id); },
  };
  return store;
}

/** A scriptable provider. Never touches a network. */
function fixtureProvider(over: Partial<{
  configured: boolean;
  exchange: () => Promise<ProviderTokens>;
  refresh: () => Promise<ProviderTokens>;
  identity: () => Promise<{ accountId: string; label?: string }>;
  revokeResult: boolean;
}> = {}): IntegrationOAuthProvider & { revoked: string[] } {
  const revoked: string[] = [];
  return {
    revoked,
    id: "google",
    label: "Google",
    configured: over.configured ?? true,
    buildAuthorizationUrl(input) {
      assertLeastPrivilege(input.scopes);
      return `https://provider.test/auth?state=${encodeURIComponent(input.state)}&challenge=${input.codeChallenge}`;
    },
    exchangeCode: over.exchange
      ? over.exchange
      : async () => ({ accessToken: "at-1", refreshToken: "rt-1", expiresInSeconds: 3600, grantedScopes: [...GOOGLE_CALENDAR_SCOPES] }),
    refreshAccessToken: over.refresh
      ? over.refresh
      : async () => ({ accessToken: "at-2", expiresInSeconds: 3600, grantedScopes: [...GOOGLE_CALENDAR_SCOPES] }),
    async revoke(token) { revoked.push(token); return over.revokeResult ?? true; },
    getAccountIdentity: over.identity
      ? over.identity
      : async () => ({ accountId: "goog-123", label: "person@example.com" }),
  };
}

function deps(over: Partial<LinkDeps> = {}): LinkDeps & { accounts: ReturnType<typeof memoryAccounts>; states: ReturnType<typeof memoryStateStore> } {
  let n = 0;
  const base = {
    accounts: memoryAccounts(),
    states: memoryStateStore(),
    vault: memoryVault(RING),
    provider: fixtureProvider(),
    ring: RING as KeyRing | null,
    redirectUri: "https://app.test/api/integrations/google/callback",
    now: () => NOW,
    newId: () => `acct-${++n}`,
  };
  return { ...base, ...over } as never;
}

/**
 * Where the SOURCE tree lives.
 *
 * Section 9's assertions read source files, and they are the hard §34 gate — so
 * a run that cannot find the source must FAIL, never quietly pass over an empty
 * list. That is exactly what happened the first time this suite ran: the
 * compiled harness executes from a different directory, `process.cwd()/lib`
 * did not exist, the walk returned zero files, and every "nothing here calls
 * signInWithOAuth" assertion was vacuously true against an empty string.
 *
 * A structural test that cannot see the code is not a passing test.
 */
function sourceRoot(): string | null {
  const marker = join("lib", "integrations", "vault.ts");
  const candidates: string[] = [];
  if (process.env.LIFEOS_ROOT) candidates.push(process.env.LIFEOS_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(dir);
    const up = join(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  for (const c of candidates) {
    try { statSync(join(c, marker)); return c; } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Strip comments and string literals before matching.
 *
 * Load-bearing, and borrowed from `scripts/audit-auth.mjs`, which learned it the
 * expensive way: an audit that matches raw source is satisfied by the DOC
 * COMMENT explaining the rule. The docstrings in this sprint say, in prose,
 * that `signInWithOAuth()` and `linkIdentity()` are deliberately absent — and
 * scanning raw text found those sentences and called them violations.
 *
 * An audit that cannot fail is worse than no audit; so is one that cannot pass
 * for the right reason.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');
}

/** Walk shipped source for a structural assertion. */
function shippedSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === ".git") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) shippedSources(full, out);
    // Self-tests are excluded, and this one especially: a file whose job is to
    // assert `signInWithOAuth` is absent necessarily CONTAINS the string
    // `signInWithOAuth`. Scanning it would make every assertion below fail
    // against itself. `scripts/audit-auth.mjs` exempts its own directory for
    // exactly this reason. What is scanned is shipped behaviour.
    else if (/\.(ts|tsx)$/.test(e) && !/selftest\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

export async function runIntegrationSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, got: unknown, want: unknown) =>
    ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
      `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

  const browser = typeof window !== "undefined";

  // ============================================= 1. the encryption boundary ==

  {
    const sealed = seal("refresh-token-value", RING);
    ok("1.1 a sealed secret contains no plaintext",
      !JSON.stringify(sealed).includes("refresh-token-value"), JSON.stringify(sealed).slice(0, 80));
    eq("1.2 it records which key sealed it", sealed.keyVersion, 1);
    eq("1.3 the IV is 96 bits", Buffer.from(sealed.iv, "base64").length, 12);
    eq("1.4 the tag is 128 bits", Buffer.from(sealed.tag, "base64").length, 16);
    eq("1.5 it round-trips", open(sealed, RING), "refresh-token-value");

    // A reused IV is the one mistake that breaks GCM catastrophically.
    const ivs = new Set(Array.from({ length: 200 }, () => seal("x", RING).iv));
    eq("1.6 IVs are never reused", ivs.size, 200);

    // §18-C. An altered ciphertext must REFUSE, not return garbage.
    const tampered: SealedSecret = { ...sealed, ciphertext: Buffer.from("nonsense").toString("base64") };
    let failure = "";
    try { open(tampered, RING); } catch (e) { failure = e instanceof VaultCryptoError ? e.failure : "wrong-error"; }
    eq("1.7 a tampered ciphertext fails the auth tag", failure, "authentication_failed");

    // §18-D. A key version we do not hold is a NAMED failure.
    let vfail = "";
    try { open({ ...sealed, keyVersion: 99 }, RING); } catch (e) { vfail = e instanceof VaultCryptoError ? e.failure : "wrong-error"; }
    eq("1.8 an unknown key version is refused explicitly", vfail, "unsupported_key_version");

    // Decrypting with the wrong key is a tag failure, never a wrong string.
    const other = keyRing([{ version: 1, key: KEY2 }])!;
    let wfail = "";
    try { open(sealed, other); } catch (e) { wfail = e instanceof VaultCryptoError ? e.failure : "wrong-error"; }
    eq("1.9 the wrong key cannot open it", wfail, "authentication_failed");

    // §18-B. No key means a hard refusal — never a plaintext fallback.
    let nfail = "";
    try { seal("x", null); } catch (e) { nfail = e instanceof VaultCryptoError ? e.failure : "wrong-error"; }
    eq("1.10 sealing with no key is a hard refusal", nfail, "no_key");

    // §3. No weak default. An unconfigured environment yields no key at all.
    eq("1.11 an empty environment produces no key ring", keyRingFromEnv({}), null);
    eq("1.12 a short key is rejected rather than padded",
      keyRingFromEnv({ INTEGRATION_TOKEN_KEY: Buffer.alloc(16, 1).toString("base64") }), null);
    ok("1.13 a real 32-byte key is accepted",
      !!keyRingFromEnv({ INTEGRATION_TOKEN_KEY: KEY.toString("base64") }));

    ok("1.14 constant-time compare works both ways", safeEqual("abc", "abc") && !safeEqual("abc", "abd"));
    ok("1.15 …and is length-safe", !safeEqual("abc", "abcd"));
  }

  // ==================================================== 2. the vault rules ===

  if (!browser) {
    // §18-A / §2. An unavailable vault refuses every read and write.
    const dead = unavailableVault("no encryption key is configured");
    eq("2.1 an unavailable vault says so", dead.available, false);
    let stored = "ok";
    try { await dead.store("a", { accessToken: "x", grantedScopes: [] }); } catch (e) { stored = (e as VaultError).failure; }
    eq("2.2 …and refuses to store", stored, "unavailable");
    // But DELETE succeeds: §15 says disconnect must never be blocked.
    let deleted = true;
    try { await dead.delete("a"); } catch { deleted = false; }
    ok("2.3 …while still permitting deletion, so disconnect always works", deleted);

    // The fixture vault encrypts too — so these tests exercise the real path.
    const v = memoryVault(RING);
    await v.store("a", { accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: NOW.toISOString(), grantedScopes: ["s1"] });
    const loaded = await v.load("a");
    eq("2.4 a stored credential round-trips", loaded.accessToken, "at");
    eq("2.5 …with its refresh token", loaded.refreshToken, "rt");

    // §13 / §18-J. THE rule: an omitted refresh token preserves the stored one.
    await v.replace("a", { accessToken: "at2" });
    const after = await v.load("a");
    eq("2.6 a refresh that omits the refresh token PRESERVES it", after.refreshToken, "rt");
    eq("2.7 …while the access token is updated", after.accessToken, "at2");

    // §18-I. A rotation replaces it, and the old value is gone.
    await v.replace("a", { accessToken: "at3", refreshToken: "rt2" });
    const rotated = await v.load("a");
    eq("2.8 a rotation replaces the refresh token", rotated.refreshToken, "rt2");
    ok("2.9 …and the old secret is no longer retrievable", rotated.refreshToken !== "rt");

    await v.delete("a");
    let missing = "";
    try { await v.load("a"); } catch (e) { missing = (e as VaultError).failure; }
    eq("2.10 a deleted credential is gone", missing, "not_found");

    // The production vault refuses without its privileged store — and the
    // absence is passed explicitly rather than looked up.
    const prod = supabaseTokenVault(null, RING);
    eq("2.11 the production vault refuses with no privileged store", prod.available, false);
    ok("2.12 …and says why", /privileged/i.test(prod.unavailableReason ?? ""), prod.unavailableReason);
    eq("2.13 …and refuses with no key even if a store exists",
      supabaseTokenVault({} as PrivilegedCredentialStore, null).available, false);
    eq("2.14 this deployment's vault is unavailable", resolveProductionVault({}).available, false);

    // The privileged store interface only ever handles ciphertext.
    const seen: string[] = [];
    const spy: PrivilegedCredentialStore = {
      async put(_id, row) { seen.push(JSON.stringify(row)); },
      async get() { return null; },
      async remove() { /* noop */ },
    };
    await supabaseTokenVault(spy, RING).store("a", { accessToken: "SECRET-AT", refreshToken: "SECRET-RT", grantedScopes: [] });
    ok("2.15 the privileged store never sees a plaintext token",
      !seen.join("").includes("SECRET-AT") && !seen.join("").includes("SECRET-RT"), seen.join("").slice(0, 120));
  } else {
    ok("2.0 vault tests skipped — they refuse to run in a browser, by design", true);
  }

  // ================================================ 3. OAuth state and PKCE ==

  {
    const s1 = startState({ userId: "u1", provider: "google", ring: RING, now: NOW });
    const s2 = startState({ userId: "u1", provider: "google", ring: RING, now: NOW });
    ok("3.1 state values are unpredictable", s1.state !== s2.state);
    ok("3.2 …and long", s1.state.length >= 40, String(s1.state.length));
    // §11. The RAW state is never stored.
    ok("3.3 the raw state is not stored — only its hash",
      !JSON.stringify(s1.record).includes(s1.state), JSON.stringify(s1.record).slice(0, 120));
    eq("3.4 the stored hash is sha256 of the state", s1.record.stateHash, hashState(s1.state));
    ok("3.5 the hash is hex sha256 shaped", /^[0-9a-f]{64}$/.test(s1.record.stateHash));
    // §12. PKCE verifier is sealed, and the challenge is derived correctly.
    ok("3.6 the PKCE verifier is sealed at rest",
      typeof s1.record.verifier === "object" && !!s1.record.verifier.ciphertext);
    eq("3.7 the challenge matches the sealed verifier",
      codeChallengeFor(verifierOf(s1.record, RING)), s1.codeChallenge);
    ok("3.8 …and the verifier never appears in the record",
      !JSON.stringify(s1.record).includes(verifierOf(s1.record, RING)));
    eq("3.9 state is user-bound", s1.record.userId, "u1");
    eq("3.10 …and provider-bound", s1.record.provider, "google");
    ok("3.11 …and short-lived", OAUTH_STATE_TTL_SECONDS <= 900, String(OAUTH_STATE_TTL_SECONDS));

    const store = memoryStateStore();
    await store.put(s1.record);

    // §31.1. User B cannot use user A's state — because B never learns it, and
    // whoever presents it gets A's binding, not their own.
    const claimed = await store.consume(s1.record.stateHash, "google", NOW);
    ok("3.12 a valid state claims successfully", claimed.ok);
    eq("3.13 …and carries the ORIGINATING user, not the caller",
      claimed.ok ? claimed.record.userId : "", "u1");

    // §31.2 / §18-E. Replay.
    const replay = await store.consume(s1.record.stateHash, "google", NOW);
    eq("3.14 a replayed state is refused", replay.ok ? "allowed" : replay.reason, "already_used");

    // §31.3. Expiry.
    await store.put(s2.record);
    const late = new Date(NOW.getTime() + (OAUTH_STATE_TTL_SECONDS + 60) * 1000);
    const expired = await store.consume(s2.record.stateHash, "google", late);
    eq("3.15 an expired state is refused", expired.ok ? "allowed" : expired.reason, "expired");

    // §31.4. Missing.
    const absent = await store.consume(hashState("never-issued"), "google", NOW);
    eq("3.16 an unknown state is refused", absent.ok ? "allowed" : absent.reason, "missing");

    // Provider-bound: a state for one provider cannot complete another.
    const s3 = startState({ userId: "u1", provider: "google", ring: RING, now: NOW });
    await store.put(s3.record);
    const wrong = await store.consume(s3.record.stateHash, "notgoogle", NOW);
    eq("3.17 a state cannot complete a different provider", wrong.ok ? "allowed" : wrong.reason, "wrong_provider");

    // §25. Expired states are swept.
    const sweep = memoryStateStore();
    await sweep.put(startState({ userId: "u", provider: "google", ring: RING, now: NOW }).record);
    eq("3.18 expired pending states are purged", await sweep.purgeExpired(late), 1);
    eq("3.19 …leaving none behind", sweep.size(), 0);

    // §16. Account deletion removes pending states.
    const del = memoryStateStore();
    await del.put(startState({ userId: "gone", provider: "google", ring: RING, now: NOW }).record);
    await del.put(startState({ userId: "stays", provider: "google", ring: RING, now: NOW }).record);
    eq("3.20 deleting a user removes their pending states", await del.deleteForUser("gone"), 1);
    eq("3.21 …and nobody else's", del.size(), 1);

    // The SQL contract and the in-memory contract must not drift.
    ok("3.22 the SQL claim is a single conditional update",
      /update/i.test(CONSUME_STATE_SQL) && /consumed_at is null/i.test(CONSUME_STATE_SQL)
      && /expires_at > now\(\)/i.test(CONSUME_STATE_SQL) && /returning/i.test(CONSUME_STATE_SQL),
      CONSUME_STATE_SQL.replace(/\s+/g, " ").trim());
  }

  // §31.10 / §18-E. Two callbacks racing one state: exactly one wins.
  if (!browser) {
    const d = deps();
    const started2 = startState({ userId: "u1", provider: "google", ring: RING, now: NOW });
    await d.states.put(started2.record);
    const both = await Promise.all([
      completeLink({ code: "c", state: started2.state, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d),
      completeLink({ code: "c", state: started2.state, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d),
    ]);
    eq("4.1 two callbacks racing one state produce exactly one success",
      both.filter((r) => r.ok).length, 1);
    eq("4.2 …and the loser says the state was already used",
      both.find((r) => !r.ok && "failure" in r)?.ok === false
        ? (both.find((r) => !r.ok) as { failure: string }).failure : "", "already_used");
    eq("4.3 …leaving exactly one account row", d.accounts.rows.size, 1);
  }

  // =========================================== 5. the link flow end to end ===

  if (!browser) {
    // Happy path.
    {
      const d = deps();
      const start = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      ok("5.1 a signed-in user can start a link", start.ok, JSON.stringify(start));
      const url = start.ok ? new URL(start.authorizationUrl) : null;
      const state = url?.searchParams.get("state") ?? "";
      ok("5.2 …and the URL carries a state", !!state);

      const done = await completeLink(
        { code: "code-1", state, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      ok("5.3 the callback completes", done.ok, JSON.stringify(done));
      const acct = [...d.accounts.rows.values()][0];
      eq("5.4 the account is connected", acct.status, "connected");
      eq("5.5 …owned by the user who STARTED the flow", acct.userId, "u1");
      eq("5.6 …keyed by the provider account id, not an email", acct.providerAccountId, "goog-123");
      eq("5.7 …with the email kept only as a label", acct.displayLabel, "person@example.com");
      eq("5.8 …and the GRANTED scopes recorded", acct.scopes, [...GOOGLE_CALENDAR_SCOPES]);
      const cred = await d.vault.load(acct.id);
      eq("5.9 the credential was stored", cred.refreshToken, "rt-1");
    }

    // §31.11 / §18. Reconnecting the same provider account yields ONE link.
    {
      const d = deps();
      // Link twice, as a person reconnecting after revoking would.
      for (let attempt = 0; attempt < 2; attempt++) {
        const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
        const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
        await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      }
      eq("5.10 reconnecting the same provider account keeps ONE link", d.accounts.rows.size, 1);
      eq("5.11 …still connected", [...d.accounts.rows.values()][0].status, "connected");
    }

    // §24. The user declined at the consent screen.
    {
      const d = deps();
      const r = await completeLink({ error: "access_denied", requestedScopes: [], requiredScopes: [] }, d);
      eq("5.12 a declined authorization is not an error state", r.ok ? "ok" : r.failure, "denied");
      eq("5.13 …and creates no account row", d.accounts.rows.size, 0);
    }

    // §18-A. Vault unavailable → cannot start, and cannot connect.
    {
      const d = deps({ vault: unavailableVault("no encryption key is configured") });
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      eq("5.14 an unavailable vault refuses BEFORE the user is redirected",
        s.ok ? "ok" : s.failure, "vault_unavailable");
      eq("5.15 …and no pending state is created", d.states.size(), 0);
    }
    {
      // …and if it becomes unavailable mid-flow, no connected row appears.
      const d = deps();
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      const d2 = { ...d, vault: unavailableVault("vault went away") } as LinkDeps;
      const r = await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d2);
      eq("5.16 a vault that fails mid-flow blocks the connection", r.ok ? "ok" : r.failure, "vault_unavailable");
      ok("5.17 …and leaves nothing claiming to be connected",
        [...d.accounts.rows.values()].every((a) => a.status !== "connected"));
    }

    // §18-H. Identity fetch fails → NO credential persisted.
    {
      const d = deps({ provider: fixtureProvider({ identity: async () => { throw new ProviderError("identity_failed"); } }) });
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      const r = await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      eq("5.18 a failed identity fetch fails the link", r.ok ? "ok" : r.failure, "identity_failed");
      eq("5.19 …with no account row", d.accounts.rows.size, 0);
      let none = false;
      try { await d.vault.load("acct-1"); } catch { none = true; }
      ok("5.20 …and no credential stored", none);
    }

    // §18-G. Vault write succeeds, metadata write fails → credential deleted.
    {
      const d = deps();
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      d.accounts.failNextUpdate = true;
      const r = await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      eq("5.21 a failed metadata write fails the link", r.ok ? "ok" : r.failure, "storage_failed");
      eq("5.22 …removing the pending row", d.accounts.rows.size, 0);
      let orphan = false;
      try { await d.vault.load("acct-1"); orphan = true; } catch { /* deleted */ }
      ok("5.23 …and DELETING the credential, so no orphaned secret survives", !orphan);
    }

    // §12. Reduced grant that is missing a required scope fails the connection.
    {
      const d = deps({ provider: fixtureProvider({
        exchange: async () => ({ accessToken: "at", refreshToken: "rt", grantedScopes: [] }),
      }) });
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      const r = await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      eq("5.24 a grant missing a required scope is refused", r.ok ? "ok" : r.failure, "insufficient_scope");
      ok("5.25 …rather than claiming permission we do not have",
        [...d.accounts.rows.values()].every((a) => a.status !== "connected"));
    }
  }

  // §12. Scope reconciliation, the three cases.
  {
    const req = [...GOOGLE_CALENDAR_SCOPES];
    eq("6.1 exact grant", reconcileScopes(req, req, req).missingRequired, []);
    eq("6.2 reduced grant is detected", reconcileScopes(req, [], req).missingRequired, req);
    const extra = reconcileScopes(req, [...req, "https://example.test/other"], req);
    eq("6.3 an unexpected extra scope is recorded, not discarded", extra.extra, ["https://example.test/other"]);
    eq("6.4 …and does not break the required check", extra.missingRequired, []);
    // §14. Least privilege is enforced, not merely intended.
    eq("6.5 only one calendar scope is requested", GOOGLE_CALENDAR_SCOPES.length, 1);
    ok("6.6 …and it is read-only", GOOGLE_CALENDAR_SCOPES[0].endsWith("calendar.readonly"));
    for (const bad of [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/contacts",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ]) {
      let refused = false;
      try { assertLeastPrivilege([bad]); } catch { refused = true; }
      ok(`6.7 "${bad.split("/auth/")[1]}" is refused`, refused);
    }
    let allowed = true;
    try { assertLeastPrivilege([...GOOGLE_CALENDAR_SCOPES]); } catch { allowed = false; }
    ok("6.8 …while the read-only calendar scope is allowed", allowed);
    ok("6.9 the forbidden list actually covers mail, contacts and drive",
      FORBIDDEN_SCOPE_PATTERNS.length >= 4);
  }

  // ================================================ 7. token refresh (§13) ===

  if (!browser) {
    const expired = new Date(NOW.getTime() - 3600_000).toISOString();

    ok("7.1 an unknown expiry is treated as expired", needsRefresh(undefined, NOW));
    ok("7.2 an expired token needs refresh", needsRefresh(expired, NOW));
    ok("7.3 a token expiring inside the margin needs refresh",
      needsRefresh(new Date(NOW.getTime() + 30_000).toISOString(), NOW));
    ok("7.4 a fresh token does not", !needsRefresh(new Date(NOW.getTime() + 3600_000).toISOString(), NOW));

    const setup = async (over: Partial<{ provider: IntegrationOAuthProvider; cred: StoredCredential }> = {}) => {
      const accounts = memoryAccounts();
      const vault = memoryVault(RING);
      accounts.rows.set("a1", {
        id: "a1", userId: "u1", provider: "google", providerAccountId: "goog-123",
        scopes: [...GOOGLE_CALENDAR_SCOPES], status: "connected",
        connectedAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
      });
      await vault.store("a1", over.cred ?? {
        accessToken: "old-at", refreshToken: "rt-1", accessTokenExpiresAt: expired,
        grantedScopes: [...GOOGLE_CALENDAR_SCOPES],
      });
      return { accounts, vault, provider: over.provider ?? fixtureProvider(), now: () => NOW };
    };

    // §18-J. The response omits refresh_token → the stored one SURVIVES.
    {
      const d = await setup();
      const r = await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      ok("7.5 an expired token is refreshed", r.ok && r.refreshed, JSON.stringify(r));
      eq("7.6 …returning the new access token", r.ok ? r.accessToken : "", "at-2");
      eq("7.7 …and PRESERVING the refresh token the response omitted",
        (await d.vault.load("a1")).refreshToken, "rt-1");
    }

    // §18-I. Rotation.
    {
      const d = await setup({ provider: fixtureProvider({
        refresh: async () => ({ accessToken: "at-3", refreshToken: "rt-2", expiresInSeconds: 3600, grantedScopes: [] }),
      }) });
      await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      const cred = await d.vault.load("a1");
      eq("7.8 a rotated refresh token replaces the old one", cred.refreshToken, "rt-2");
      ok("7.9 …and the old one is unretrievable", cred.refreshToken !== "rt-1");
    }

    // invalid_grant → revoked. Anything else → still connected.
    {
      const d = await setup({ provider: fixtureProvider({
        refresh: async () => { throw new ProviderError("invalid_grant"); },
      }) });
      const r = await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      eq("7.10 invalid_grant marks the integration revoked", r.ok ? "ok" : r.failure, "revoked");
      eq("7.11 …in the metadata row", d.accounts.rows.get("a1")!.status, "revoked");
    }
    {
      const d = await setup({ provider: fixtureProvider({
        refresh: async () => { throw new ProviderError("network"); },
      }) });
      const r = await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      eq("7.12 a transient failure does NOT revoke", r.ok ? "ok" : r.failure, "refresh_failed");
      eq("7.13 …and the integration stays connected", d.accounts.rows.get("a1")!.status, "connected");
    }

    // No refresh token at all → honest failure.
    {
      const d = await setup({ cred: { accessToken: "at", accessTokenExpiresAt: expired, grantedScopes: [] } });
      const r = await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      eq("7.14 an expired token with no refresh token fails honestly", r.ok ? "ok" : r.failure, "no_refresh_token");
    }

    // §31.5 / §20. Ownership.
    {
      const d = await setup();
      const other = await getProviderAccessToken({ userId: "u2", accountId: "a1" }, d);
      eq("7.15 another user cannot get this token", other.ok ? "ok" : other.failure, "forbidden");
      const fake = await getProviderAccessToken({ userId: "u1", accountId: "made-up" }, d);
      eq("7.16 a fabricated integration id is refused", fake.ok ? "ok" : fake.failure, "not_found");
      ok("7.17 …and both answers look the same from outside",
        !other.ok && !fake.ok && other.reason === fake.reason, `${!other.ok && other.reason} / ${!fake.ok && fake.reason}`);
    }

    // A non-connected integration hands out nothing.
    {
      const d = await setup();
      d.accounts.rows.get("a1")!.status = "revoked";
      const r = await getProviderAccessToken({ userId: "u1", accountId: "a1" }, d);
      eq("7.18 a revoked integration hands out no token", r.ok ? "ok" : r.failure, "not_connected");
    }
  }

  // ============================================ 8. disconnect and deletion ===

  if (!browser) {
    // §31.8 / §15.
    {
      const d = deps();
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const id = [...d.accounts.rows.keys()][0];
      const r = await disconnect({ userId: "u1", accountId: id }, d);
      ok("8.1 disconnect succeeds", !("ok" in r), JSON.stringify(r));
      ok("8.2 …deleting the credential", !("ok" in r) && r.credentialDeleted);
      ok("8.3 …revoking at the provider", !("ok" in r) && r.providerRevoked);
      eq("8.4 …and removing the metadata row", d.accounts.rows.size, 0);
      let gone = false;
      try { await d.vault.load(id); } catch { gone = true; }
      ok("8.5 the credential is unretrievable afterwards", gone);
    }

    // §15. A failed revocation must NOT leave the local credential in place.
    {
      const d = deps({ provider: fixtureProvider({ revokeResult: false }) });
      const s = await startLink({ userId: "u1", scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
      await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
      const id = [...d.accounts.rows.keys()][0];
      const r = await disconnect({ userId: "u1", accountId: id }, d);
      ok("8.6 a failed provider revocation still deletes locally",
        !("ok" in r) && r.credentialDeleted && !r.providerRevoked, JSON.stringify(r));
    }

    // Ownership on disconnect.
    {
      const d = deps();
      d.accounts.rows.set("x", {
        id: "x", userId: "owner", provider: "google", providerAccountId: "g",
        scopes: [], status: "connected", connectedAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
      });
      const r = await disconnect({ userId: "attacker", accountId: "x" }, d);
      eq("8.7 another user cannot disconnect your integration", "ok" in r ? r.reason : "allowed", "forbidden");
      eq("8.8 …and the row survives", d.accounts.rows.size, 1);
    }

    // §31.9 / §16 / §29. Account deletion leaves no orphan secret.
    {
      const d = deps();
      for (const u of ["gone", "stays"]) {
        const s = await startLink({ userId: u, scopes: [...GOOGLE_CALENDAR_SCOPES] }, d);
        const st = s.ok ? new URL(s.authorizationUrl).searchParams.get("state")! : "";
        // A distinct provider account per user, so both links are real.
        const dd = { ...d, provider: fixtureProvider({ identity: async () => ({ accountId: `goog-${u}` }) }) } as LinkDeps;
        await completeLink({ code: "c", state: st, requestedScopes: [...GOOGLE_CALENDAR_SCOPES], requiredScopes: [...GOOGLE_CALENDAR_SCOPES] }, dd);
      }
      await d.states.put(startState({ userId: "gone", provider: "google", ring: RING, now: NOW }).record);
      const purged = await purgeUserIntegrations("gone", d);
      eq("8.9 deleting a user removes their integration metadata", purged.accounts, 1);
      eq("8.10 …their credentials", purged.credentials, 1);
      // TWO: the one consumed during the link plus the one added above. A
      // consumed state is retained (that is what makes replay detectable) and
      // is swept later by expiry — so account deletion must remove both, not
      // just the unconsumed one.
      eq("8.11 …and every OAuth state row they own, consumed or not", purged.states, 2);
      eq("8.12 …leaving the other user untouched", (await d.accounts.listForUser("stays")).length, 1);
    }
  }

  // ============================== 9. §34 — the hard authentication gate ======
  //
  // Structural, not behavioural. A behavioural test proves today's code path
  // does not create an account; an ABSENT import proves no code path can.

  const root = sourceRoot();
  {
    // If the source cannot be located, say so and fail — do not scan nothing
    // and report success.
    ok("9.0 the source tree was located for the structural gate", !!root,
      `looked from ${process.cwd()}; set LIFEOS_ROOT to point at the repo`);
    const files = root ? [
      ...shippedSources(join(root, "lib", "integrations")),
      ...shippedSources(join(root, "app", "api", "integrations")),
    ] : [];
    ok("9.1 the integration layer exists as its own module", files.length >= 6, String(files.length));
    const body = files.map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");

    ok("9.2 nothing here calls signInWithOAuth", !/signInWithOAuth\s*\(/.test(body));
    ok("9.3 nothing here calls linkIdentity — Google must not become a login",
      !/\blinkIdentity\s*\(/.test(body));
    ok("9.4 nothing here calls signUp or admin.createUser",
      !/\.signUp\s*\(/.test(body) && !/admin\s*\.\s*createUser\s*\(/.test(body));
    ok("9.5 nothing here calls signInAnonymously", !/signInAnonymously\s*\(/.test(body));
    ok("9.6 nothing here sets a session", !/setSession\s*\(/.test(body) && !/refreshSession\s*\(/.test(body));
    // §6. No scanner-avoidance: the privileged credential is not referenced at
    // all, in any spelling, direct or assembled.
    ok("9.7 no privileged credential is referenced, directly or assembled",
      !/SERVICE_ROLE/i.test(body) && !/service_role/i.test(body)
      && !/process\.env\s*\[/.test(body), "an env lookup by computed name would defeat the scanner");
    ok("9.8 the deployment states plainly that the privileged store is absent",
      /privileged server connection/i.test(NO_PRIVILEGED_STORE), NO_PRIVILEGED_STORE);

    // The whole app, not just this module: exactly one sign-in mechanism.
    const app = (root ? [
      ...shippedSources(join(root, "lib")),
      ...shippedSources(join(root, "app")),
      ...shippedSources(join(root, "components")),
    ] : []).map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    ok("9.8b the whole-app scan actually read files", app.length > 10_000, `${app.length} chars`);
    ok("9.9 the app still has no OAuth login path anywhere", !/signInWithOAuth\s*\(/.test(app));
    ok("9.10 …and no identity-linking path anywhere", !/\blinkIdentity\s*\(/.test(app));
  }

  // ============================= 10. secrets never leave the server (§7, §28) =

  {
    // §31.6. No route may serialize a token.
    const routes = (root ? shippedSources(join(root, "app", "api", "integrations")) : [])
      .map((f) => ({ f, body: codeOnly(readFileSync(f, "utf8")) }));
    // Named explicitly: an empty route list would make every per-route
    // assertion below vacuous, which is how a leak ships green.
    eq("10.0 both integration routes were found", routes.length, 2);
    for (const { f, body } of routes) {
      const name = f.split("/").slice(-2).join("/");
      ok(`10.1 ${name} returns no token field`,
        !/NextResponse\.json\([^)]*(access_?[Tt]oken|refresh_?[Tt]oken)/.test(body));
      ok(`10.2 ${name} does not log`, !/console\.(log|info|warn|error)\s*\(/.test(body));
    }
    ok("10.3 the response deny-list covers tokens, codes and secrets",
      ["accessToken", "refreshToken", "code", "client_secret", "state"].every((k) => FORBIDDEN_RESPONSE_FIELDS.includes(k)),
      FORBIDDEN_RESPONSE_FIELDS.join(","));

    // §31.7. Nothing in the integration layer formats a secret into a string.
    const intBody = (root ? shippedSources(join(root, "lib", "integrations")) : [])
      .map((f) => codeOnly(readFileSync(f, "utf8"))).join("\n");
    ok("10.3b the integration-layer scan actually read files", intBody.length > 5_000, `${intBody.length} chars`);
    ok("10.4 the integration layer never logs", !/console\.(log|info|warn|error|debug)\s*\(/.test(intBody));
    ok("10.5 …and never interpolates a token into a message",
      !/\$\{[^}]*(accessToken|refreshToken|clientSecret|code)[^}]*\}/.test(
        intBody.replace(/authorization:\s*`Bearer \$\{accessToken\}`/g, ""),
      ));

    // §28. Integrations are not part of the user's data export at all.
    ok("10.6 no integration domain is exported",
      !(EXPORT_DOMAINS as readonly string[]).some((d) => /integration|credential|oauth|token/i.test(d)),
      (EXPORT_DOMAINS as readonly string[]).join(","));
    ok("10.7 …and none is in StoreState either",
      !(STORE_DOMAINS as string[]).some((d) => /integration|credential|oauth|token/i.test(d)),
      (STORE_DOMAINS as string[]).join(","));
    eq("10.8 StoreState is unchanged by this sprint", (STORE_DOMAINS as string[]).length, 46);
  }

  // ================================ 11. this deployment refuses, honestly ====

  if (!browser) {
    const provider = googleOAuthProvider(googleConfigFromEnv({}));
    eq("11.1 Google is not configured here", provider.configured, false);
    let built = "built";
    try { provider.buildAuthorizationUrl({ state: "s", codeChallenge: "c", redirectUri: "r", scopes: [] }); }
    catch (e) { built = e instanceof ProviderError ? e.failure : "wrong"; }
    eq("11.2 …so no authorization URL is fabricated", built, "not_configured");
    ok("11.3 a configured provider DOES build one",
      googleOAuthProvider({ clientId: "id", clientSecret: "sec" })
        .buildAuthorizationUrl({ state: "s", codeChallenge: "c", redirectUri: "https://r.test/cb", scopes: [...GOOGLE_CALENDAR_SCOPES] })
        .startsWith("https://accounts.google.com/"));
    {
      const url = new URL(googleOAuthProvider({ clientId: "id", clientSecret: "sec" })
        .buildAuthorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "https://r.test/cb", scopes: [...GOOGLE_CALENDAR_SCOPES] }));
      eq("11.4 …with PKCE S256", url.searchParams.get("code_challenge_method"), "S256");
      eq("11.5 …asking for offline access, so a refresh token is actually issued", url.searchParams.get("access_type"), "offline");
      eq("11.6 …and no client secret in the URL", url.searchParams.get("client_secret"), null);
    }
    // The runtime stores refuse rather than silently succeeding against nothing.
    let listed: unknown[] = [];
    try { listed = await unavailableStateStore.accounts.listForUser("u1"); } catch { listed = ["threw"]; }
    eq("11.7 listing integrations in this deployment is simply empty", listed, []);
    let put = "ok";
    try { await unavailableStateStore.states.put({} as never); } catch (e) { put = (e as Error).message; }
    ok("11.8 …but writing refuses loudly", /privileged/i.test(put), put);
    eq("11.9 every status the schema allows is modelled", [...INTEGRATION_STATUSES], ["pending", "connected", "revoked", "error"]);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}

export type { TokenVault };
