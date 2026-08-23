/**
 * OAuth state and PKCE (LIFEOS-068 §11, §12, §25).
 *
 * ## Why state is persisted server-side at all
 *
 * A provider redirect back to our callback is a **top-level browser
 * navigation**. It carries no `Authorization` header, so the one identity
 * mechanism this codebase has — a Supabase bearer token — is unavailable at
 * exactly the moment we must decide whose account is being linked.
 *
 * The answer cannot come from the request. It has to come from something the
 * server wrote down *before* the redirect, while the caller was still
 * authenticated. That is what this table is: a short-lived note saying "user X
 * began linking provider Y", retrievable only by presenting the random value we
 * handed out.
 *
 * ## What is stored is a HASH
 *
 * The state value goes to Google and comes back through a browser URL, which
 * means it lands in history, in referrers, and in any log along the way. What
 * we keep is `sha256(state)`. A leaked database row therefore cannot be used to
 * complete a link — the attacker would need the original value, which we never
 * stored.
 *
 * ## Consumption is atomic, not check-then-write
 *
 * `consume()` is a single conditional update: claim the row only if it is
 * unconsumed and unexpired, and report what was claimed. Two callbacks racing
 * on one state therefore produce exactly one winner, because the database
 * decides rather than a `if (!row.consumed)` in application code that both
 * requests can pass at the same time.
 *
 * ## PKCE
 *
 * Used even though this is a confidential-client flow where Google does not
 * require it. The verifier never leaves the server, so PKCE here defends
 * against one specific thing: an authorization code intercepted from the
 * redirect URL — in browser history, a referrer header, or a shared machine —
 * being redeemed by someone who does not hold the verifier. Cheap, and it costs
 * nothing to keep.
 *
 * The verifier is SEALED at rest, with the same vault crypto everything else
 * uses, so a leaked state row yields neither a usable state nor a usable
 * verifier.
 */

import { createHash, randomBytes } from "node:crypto";
import { seal, open, type KeyRing, type SealedSecret } from "@/lib/integrations/crypto";

/** How long a pending authorization may sit before it is worthless. */
export const OAUTH_STATE_TTL_SECONDS = 600;

/** The row as it is stored. The raw state is deliberately absent. */
export interface OAuthStateRecord {
  stateHash: string;
  userId: string;
  provider: string;
  /** Sealed PKCE verifier. Never stored in the clear. */
  verifier: SealedSecret;
  /** ISO. */
  expiresAt: string;
  /** ISO, set when claimed. A second claim finds it non-null and loses. */
  consumedAt?: string;
  createdAt: string;
}

/** What the caller needs in order to redirect. */
export interface StartedState {
  /** The random value handed to the provider. Never persisted. */
  state: string;
  /** The S256 challenge derived from the verifier. Safe to send. */
  codeChallenge: string;
  record: OAuthStateRecord;
}

/** SHA-256, hex. The only form of a state value that touches storage. */
export function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function base64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256 challenge. */
export function codeChallengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "utf8").digest());
}

/**
 * Begin an authorization.
 *
 * 256 bits of randomness for both the state and the verifier — these are the
 * only things standing between an attacker and a linked account, and there is
 * no reason to be frugal about entropy.
 */
export function startState(input: {
  userId: string;
  provider: string;
  ring: KeyRing | null;
  now: Date;
  ttlSeconds?: number;
}): StartedState {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(32));
  const ttl = input.ttlSeconds ?? OAUTH_STATE_TTL_SECONDS;
  return {
    state,
    codeChallenge: codeChallengeFor(verifier),
    record: {
      stateHash: hashState(state),
      userId: input.userId,
      provider: input.provider,
      verifier: seal(verifier, input.ring),
      expiresAt: new Date(input.now.getTime() + ttl * 1000).toISOString(),
      createdAt: input.now.toISOString(),
    },
  };
}

/** Read the verifier back out of a claimed record. */
export function verifierOf(record: OAuthStateRecord, ring: KeyRing | null): string {
  return open(record.verifier, ring);
}

export type StateRejection = "missing" | "expired" | "already_used" | "wrong_provider";

/**
 * Storage for pending authorizations.
 *
 * `consume` MUST be atomic — see the module docstring. Both implementations
 * below satisfy that, and the SQL one does it in a single statement.
 */
export interface OAuthStateStore {
  put(record: OAuthStateRecord): Promise<void>;
  /**
   * Claim a state exactly once. Returns the record on success, or the reason it
   * was refused. Never returns a record it did not just claim.
   */
  consume(stateHash: string, provider: string, now: Date): Promise<
    { ok: true; record: OAuthStateRecord } | { ok: false; reason: StateRejection }
  >;
  /** §25. Expired pending states must not accumulate forever. */
  purgeExpired(now: Date): Promise<number>;
  /** Every state belonging to a user — used by account deletion (§16). */
  deleteForUser(userId: string): Promise<number>;
}

/**
 * A deterministic in-memory store.
 *
 * JavaScript is single-threaded per event-loop turn, and `consume` performs its
 * check and its write with no `await` between them — so the claim is atomic
 * here for the same reason the SQL version is atomic: nothing can interleave.
 */
export function memoryStateStore(): OAuthStateStore & { size(): number } {
  const rows = new Map<string, OAuthStateRecord>();
  return {
    size: () => rows.size,
    async put(record) { rows.set(record.stateHash, { ...record }); },
    async consume(stateHash, provider, now) {
      const row = rows.get(stateHash);
      if (!row) return { ok: false, reason: "missing" };
      if (row.consumedAt) return { ok: false, reason: "already_used" };
      if (new Date(row.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
      // Provider-bound: a state minted for one provider cannot complete another.
      if (row.provider !== provider) return { ok: false, reason: "wrong_provider" };
      const claimed = { ...row, consumedAt: now.toISOString() };
      rows.set(stateHash, claimed);
      return { ok: true, record: claimed };
    },
    async purgeExpired(now) {
      let n = 0;
      for (const [k, v] of rows) {
        if (new Date(v.expiresAt).getTime() <= now.getTime()) { rows.delete(k); n += 1; }
      }
      return n;
    },
    async deleteForUser(userId) {
      let n = 0;
      for (const [k, v] of rows) if (v.userId === userId) { rows.delete(k); n += 1; }
      return n;
    },
  };
}

/**
 * The single statement a SQL implementation must use, kept here so the contract
 * and the query cannot drift apart. Asserted by the self-test.
 *
 * The `and consumed_at is null and expires_at > now()` in the WHERE clause is
 * the whole guarantee: two concurrent transactions cannot both match it.
 */
export const CONSUME_STATE_SQL = `
update public.integration_oauth_states
   set consumed_at = now()
 where state_hash = $1
   and provider = $2
   and consumed_at is null
   and expires_at > now()
returning *`;
