/**
 * Record size & structure limits (LIFEOS-040, Feature 7).
 *
 * Transparent, documented limits that protect RELIABILITY — not to nudge the
 * user. Each limit is validated the same way on the client (before a mutation)
 * and can be re-checked server-side by the import/restore path. Nothing here
 * truncates or silently drops content: a value over a limit is REJECTED with an
 * actionable message so the user can shorten it themselves. Existing stored data
 * that predates a limit is never rewritten — validation runs on new edits only.
 *
 * Every limit is exported and documented (SECURITY_AND_PRIVACY.md §Record limits).
 */

/** Character/element caps. Generous, but bounded. All documented. */
export const LIMITS = {
  title: 500,
  captureText: 20_000,
  note: 50_000,
  description: 50_000,
  completionEvidence: 20_000,
  documentTitle: 1_000,
  documentAuthor: 300,
  tag: 80,
  tagsPerRecord: 100,
  alias: 200,
  aliasesPerRecord: 200,
  relationshipsPerRecord: 2_000,
  historyEntriesPerRecord: 5_000,
  prefsJsonBytes: 256_000,
  jsonDepth: 40,
  importBatchRecords: 200_000,
  exportBytesSoftWarn: 50_000_000, // 50 MB — warn, do not block
} as const;

export type LimitKey = keyof typeof LIMITS;

export interface LimitViolation {
  field: string;
  limit: number;
  actual: number;
  message: string;
}

/** Validate a text field length. Returns a violation or null. */
export function checkText(field: string, value: string | null | undefined, key: LimitKey): LimitViolation | null {
  const max = LIMITS[key];
  const len = value == null ? 0 : String(value).length;
  if (len <= max) return null;
  return { field, limit: max, actual: len, message: `${field} is too long (${len.toLocaleString()} characters; limit ${max.toLocaleString()}). Please shorten it.` };
}

/** Validate an array count (tags, aliases, relationships, history). */
export function checkCount(field: string, arr: unknown[] | null | undefined, key: LimitKey): LimitViolation | null {
  const max = LIMITS[key];
  const n = Array.isArray(arr) ? arr.length : 0;
  if (n <= max) return null;
  return { field, limit: max, actual: n, message: `${field} has too many items (${n.toLocaleString()}; limit ${max.toLocaleString()}).` };
}

/** Control characters that should never appear in stored text (except \n and \t). */
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** True if a string contains disallowed control characters. */
export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/** Strip disallowed control chars (keeps \n, \t). Used on IMPORT, never on live edits. */
export function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/** Valid RFC-4122-ish UUID (any version). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Valid ISO-8601 timestamp that round-trips through Date. */
export function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * Measure the maximum nesting depth of a parsed JSON value. Used to reject
 * pathologically deep (or cyclic-looking) structures before they are stored or
 * imported. Iterative + bounded so it never blows the stack itself.
 */
export function jsonDepth(value: unknown, cap = LIMITS.jsonDepth + 5): number {
  let max = 0;
  const stack: { v: unknown; d: number }[] = [{ v: value, d: 1 }];
  const seen = new WeakSet<object>();
  while (stack.length) {
    const { v, d } = stack.pop()!;
    if (d > max) max = d;
    if (d > cap) return d; // bail early — already over any real limit
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return cap + 1; // cycle → treat as over-limit
      seen.add(v as object);
      for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
        stack.push({ v: child, d: d + 1 });
      }
    }
  }
  return max;
}

/** True if a JSON value is within the allowed depth. */
export function withinJsonDepth(value: unknown): boolean {
  return jsonDepth(value) <= LIMITS.jsonDepth;
}

/** Parse untrusted JSON safely: returns {ok,value} | {ok:false,error}. Never throws. */
export function safeJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.length > LIMITS.prefsJsonBytes * 8) return { ok: false, error: "JSON payload too large." };
  try {
    const value = JSON.parse(text);
    if (!withinJsonDepth(value)) return { ok: false, error: `JSON nested too deeply (limit ${LIMITS.jsonDepth}).` };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON." };
  }
}

/** Approximate UTF-8 byte length of a string (for prefs / export size checks). */
export function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).length;
  // Fallback estimate.
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return bytes;
}
