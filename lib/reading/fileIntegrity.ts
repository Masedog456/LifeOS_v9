/**
 * Raw-file integrity for stored originals (LIFEOS-075 C-4).
 *
 * ## Two different things had one name
 *
 * `sourceMetadata.contentHash` is `hashText(text.replace(/\s+/g," ").trim())` —
 * FNV-1a, 32 bits, over the EXTRACTED TEXT. That is the right tool for its job:
 * finding a document the user already added, where whitespace and re-exports
 * should not matter.
 *
 * It was also what got written into `reading_document_files.checksum`. So the
 * column named `checksum` described the text a file produced, not the file. Two
 * different PDFs that extract to the same words collided; a blob that came back
 * truncated or altered was undetectable, because nothing recorded described its
 * bytes; and 32 bits puts a collision around 65k documents even for its own
 * purpose.
 *
 * This module owns the OTHER concept, and only that one: a checksum OF THE
 * BYTES, for answering "are these the bytes we stored?".
 *
 *   TEXT CONTENT HASH  → lib/reading/ingest.ts `contentHash`  → duplicates
 *   RAW FILE CHECKSUM  → this module `sha256Hex`              → integrity
 *
 * They are never interchangeable and never compared to each other.
 *
 * ## Legacy rows
 *
 * Rows written before this sprint hold the old 8-character FNV text hash in
 * `checksum`. They are NOT reinterpreted as verified: `classifyChecksum`
 * distinguishes them by shape (64 lowercase hex vs anything else), and
 * `verifyBytes` reports `"unverifiable"` for them rather than `"mismatch"` —
 * an old row is unknown, not corrupt, and calling it corrupt would be its own
 * false claim. Legacy values are never rewritten into fabricated byte
 * checksums; the only honest way to get one is to hash real bytes.
 *
 * ## When Web Crypto is unavailable
 *
 * `crypto.subtle` needs a secure context. Where it is missing we return null and
 * store NO checksum (the column is nullable) rather than substituting a weaker
 * digest that would look like an integrity guarantee it is not.
 */

/** A canonical SHA-256 hex digest: exactly 64 lowercase hex characters. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ChecksumKind = "sha256" | "legacy-text-hash" | "absent";

/**
 * What a stored `reading_document_files.checksum` value actually is.
 *
 * Shape is the only evidence available — nothing recorded the algorithm — so
 * this deliberately recognises exactly one positive case and treats everything
 * else as legacy. A future digest of a different length must be added here
 * explicitly rather than being guessed at.
 */
export function classifyChecksum(stored: string | null | undefined): ChecksumKind {
  if (!stored) return "absent";
  return SHA256_HEX.test(stored) ? "sha256" : "legacy-text-hash";
}

/** Is Web Crypto's digest available in this context? */
export function fileChecksumAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/**
 * SHA-256 of raw bytes, as 64 lowercase hex characters. Null when Web Crypto is
 * unavailable — never a fallback digest, because a value in this field is taken
 * as an integrity guarantee. Never throws.
 */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string | null> {
  if (!fileChecksumAvailable()) return null;
  try {
    let buf: ArrayBuffer;
    if (data instanceof ArrayBuffer) buf = data;
    else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    else buf = await (data as Blob).arrayBuffer();
    return toHex(await crypto.subtle.digest("SHA-256", buf));
  } catch {
    return null;
  }
}

export type VerifyVerdict = "match" | "mismatch" | "unverifiable";

export interface VerifyResult {
  verdict: VerifyVerdict;
  /** What the stored value turned out to be — the reason an answer is unverifiable. */
  storedKind: ChecksumKind;
  computed: string | null;
  reason?: string;
}

/**
 * Compare retrieved bytes against a stored checksum.
 *
 * `"unverifiable"` is a first-class outcome, not a soft failure: no stored
 * value, a legacy text hash, or no Web Crypto all mean we do not know — and
 * saying "verified" or "corrupt" in those cases would each be a lie in a
 * different direction.
 */
export async function verifyBytes(
  data: Blob | ArrayBuffer | Uint8Array,
  stored: string | null | undefined,
): Promise<VerifyResult> {
  const storedKind = classifyChecksum(stored);
  if (storedKind === "absent") {
    return { verdict: "unverifiable", storedKind, computed: null, reason: "no checksum was recorded for this file" };
  }
  if (storedKind === "legacy-text-hash") {
    return {
      verdict: "unverifiable",
      storedKind,
      computed: null,
      reason: "this file was stored before file checksums were recorded",
    };
  }
  const computed = await sha256Hex(data);
  if (computed === null) {
    return { verdict: "unverifiable", storedKind, computed: null, reason: "checksums can't be computed in this browser context" };
  }
  return { verdict: computed === stored ? "match" : "mismatch", storedKind, computed };
}
