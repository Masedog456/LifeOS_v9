/**
 * The credential encryption boundary (LIFEOS-068 §3).
 *
 * AES-256-GCM, a random 96-bit IV per seal, an authentication tag, and an
 * explicit key version. Nothing here knows what a token is — it seals a string
 * and opens it, and every failure is an explicit refusal rather than a partial
 * result.
 *
 * ## Why GCM and not CBC
 *
 * GCM is authenticated. A ciphertext that has been altered — by a corrupted
 * row, a truncated column, or someone with write access to the database — fails
 * the tag check and `open()` throws. CBC would happily return plausible-looking
 * garbage, and a "token" made of garbage is worse than no token: it produces a
 * confusing 401 from the provider instead of an honest "this credential is
 * damaged, reconnect".
 *
 * ## Key versions exist from day one
 *
 * Not because rotation is implemented, but because a sealed blob that does not
 * say which key made it can never be rotated later without guessing. The
 * version travels with the ciphertext, and an unknown version is a NAMED
 * failure (`unsupported_key_version`), never an attempt with the wrong key.
 *
 * ## What the key must never be derived from
 *
 * §3 is explicit and this module enforces it by construction: `seal` takes a
 * key, it does not compute one. There is no code path here that could derive a
 * key from a user id, an email, a provider id, or OAuth state — those are all
 * either public, guessable, or attacker-influenced, and a key derived from one
 * protects nothing.
 *
 * ## No dev default
 *
 * `keyRingFromEnv()` returns `null` when nothing is configured. It does not
 * invent a key. A hardcoded development key would eventually reach production
 * as a real one, and every credential ever sealed with it would be readable by
 * anyone who cloned the repository.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** A sealed secret, exactly as it is stored. No plaintext member exists. */
export interface SealedSecret {
  /** Which key sealed this. Travels with the ciphertext so rotation is possible. */
  keyVersion: number;
  /** Base64, 12 bytes. Random per seal — never reused, never a counter. */
  iv: string;
  /** Base64, 16 bytes. GCM authentication tag. */
  tag: string;
  /** Base64. */
  ciphertext: string;
}

export type SealFailure =
  | "no_key"
  | "unsupported_key_version"
  | "authentication_failed"
  | "malformed";

export class VaultCryptoError extends Error {
  constructor(public readonly failure: SealFailure, message?: string) {
    // The message never contains ciphertext, key material, or plaintext — this
    // string reaches logs, and a log line is not a safe place for any of them.
    super(message ?? failure);
    this.name = "VaultCryptoError";
  }
}

/** One key and the version that names it. */
export interface VersionedKey {
  version: number;
  /** Exactly 32 bytes. AES-256 takes nothing else. */
  key: Buffer;
}

/**
 * The set of keys this process can use.
 *
 * `current` seals. Every key in `all` can open, which is what makes rotation
 * possible without a migration: seal with the new one, keep the old one until
 * nothing is sealed with it any more.
 */
export interface KeyRing {
  current: VersionedKey;
  all: VersionedKey[];
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Build a key ring from raw 32-byte keys. Refuses anything else. */
export function keyRing(keys: VersionedKey[]): KeyRing | null {
  const valid = keys.filter((k) => Buffer.isBuffer(k.key) && k.key.length === KEY_BYTES && Number.isInteger(k.version));
  if (valid.length === 0) return null;
  // Highest version seals. Lower ones remain able to open.
  const current = valid.reduce((a, b) => (b.version > a.version ? b : a));
  return { current, all: valid };
}

/**
 * Read a key ring from server-only configuration, or `null`.
 *
 * `null` is the honest answer when nothing is configured, and every caller
 * treats it as "the vault is unavailable". There is deliberately no fallback.
 */
export function keyRingFromEnv(env: Record<string, string | undefined>): KeyRing | null {
  const raw = (env.INTEGRATION_TOKEN_KEY ?? "").trim();
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  if (key.length !== KEY_BYTES) return null;
  const version = Number(env.INTEGRATION_TOKEN_KEY_VERSION ?? "1");
  return keyRing([{ version: Number.isInteger(version) && version > 0 ? version : 1, key }]);
}

/** Seal a plaintext string. A fresh random IV every time. */
export function seal(plaintext: string, ring: KeyRing | null): SealedSecret {
  if (!ring) throw new VaultCryptoError("no_key", "no encryption key is configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyVersion: ring.current.version,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/**
 * Open a sealed secret, or throw a NAMED failure.
 *
 * Never returns a best-effort string. A tag mismatch means the ciphertext is
 * not what we sealed, and the only safe response is to refuse.
 */
export function open(sealed: SealedSecret, ring: KeyRing | null): string {
  if (!ring) throw new VaultCryptoError("no_key", "no encryption key is configured");
  if (!sealed || typeof sealed !== "object") throw new VaultCryptoError("malformed");

  const match = ring.all.find((k) => k.version === sealed.keyVersion);
  if (!match) {
    throw new VaultCryptoError("unsupported_key_version", `no key for version ${sealed.keyVersion}`);
  }

  let iv: Buffer, tag: Buffer, ciphertext: Buffer;
  try {
    iv = Buffer.from(sealed.iv, "base64");
    tag = Buffer.from(sealed.tag, "base64");
    ciphertext = Buffer.from(sealed.ciphertext, "base64");
  } catch {
    throw new VaultCryptoError("malformed");
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new VaultCryptoError("malformed");

  const decipher = createDecipheriv("aes-256-gcm", match.key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM tag verification failed: altered ciphertext, wrong key, or a
    // truncated column. All three mean the same thing to a caller.
    throw new VaultCryptoError("authentication_failed");
  }
}

/**
 * Constant-time comparison, for anything derived from an attacker-supplied
 * value (an OAuth state hash, for instance). Length differences short-circuit,
 * which leaks only the length — never the content.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
