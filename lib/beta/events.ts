/**
 * Closed-beta evidence events (LIFEOS-059).
 *
 * ## What this is for
 *
 * The closed beta needs to answer a short, fixed list of product questions —
 * do people finish the interview, are proposals useful, is `excludeFromAi`
 * understood, did anything ever enter a Constitution without consent. Nothing
 * else. This module is the contract that keeps it that way.
 *
 * ## The rule: a value allowlist, not just a key allowlist
 *
 * `lib/security/redaction.ts` established the pattern — an allowlist so callers
 * "physically cannot attach content". This goes one step further, because a key
 * allowlist alone still lets prose through under an approved key: someone writes
 * `{ event: "x", mode: answerText }` and the field name is legal.
 *
 * So every field here is constrained by VALUE as well as by name:
 *
 *   - numeric fields must be finite numbers, and are clamped
 *   - every string field has a closed enum of permitted values
 *   - `fp` must match /^[0-9a-f]{8}$/ — an 8-hex fingerprint, nothing else
 *
 * A string that is not in its field's enum is dropped. There is no field in this
 * schema in which a sentence can be stored. That is the point: the guarantee is
 * structural, not a matter of every future caller being careful.
 *
 * ## What is deliberately impossible
 *
 * Interview answers · proposal statements · Constitution wording · Note bodies ·
 * source text · prompts · model output · names · emails · URLs · free text of
 * any kind. No event, alone or combined with others, lets anyone reconstruct
 * what a tester wrote.
 *
 * Record ids are not stored either — see `fingerprint()`.
 */

/** Every event name the beta may record. A name outside this set is dropped. */
export const BETA_EVENTS = [
  // interview lifecycle
  "interview_started",
  "interview_review_opened",
  "interview_discarded",
  "interview_finished",
  // proposals
  "proposal_decision",
  // constitution mutation seam (the silent-adoption canary reads these)
  "constitution_created",
  "constitution_adopted",
  "constitution_deleted",
  "state_replaced",
  // trust
  "ai_exclusion_changed",
  // model usage, coarse
  "ai_call",
  // explicit tester feedback (the TEXT lives elsewhere; this is the counter)
  "feedback_submitted",
] as const;

export type BetaEventName = (typeof BETA_EVENTS)[number];

/** Closed enums for every string-valued field. */
const ENUMS = {
  mode: ["struggle", "stocktake"],
  decision: ["adopt", "draft", "dismiss"],
  kind: ["purpose", "value", "principle", "standard"],
  /** How much of the model's wording survived to adoption. See `lib/beta/edit.ts`. */
  edit: ["unchanged", "minor", "substantial"],
  /** Where a Constitution element came from. Never who, never what. */
  origin: ["builder", "direct", "revision", "unknown"],
  /** Why the whole store was replaced — distinguishes sync from a local write. */
  reason: ["remote_adoption", "restore", "reset"],
  task: ["interview_followups", "interview_synthesis"],
  source: ["ai", "mock"],
  degraded: ["auth", "rate_limited", "provider", "offline"],
  category: ["confusing", "wrong_suggestion", "too_many_questions", "privacy_trust", "bug", "other"],
} as const;

type EnumField = keyof typeof ENUMS;

/** Numeric fields, with the ceiling each is clamped to. */
const NUMERIC: Record<string, number> = {
  questionsAnswered: 500,
  domainsVisited: 50,
  domainsSkipped: 50,
  followupsShown: 100,
  proposalsProduced: 50,
  adopted: 50,
  keptDraft: 50,
  dismissed: 50,
  aiCalls: 200,
  contextChars: 100_000,
};

/** Boolean fields. */
const BOOLEAN = ["enabled", "early"] as const;

/**
 * A recorded event. `at` is an ISO timestamp; everything else is optional and
 * drawn from the constrained sets above.
 */
export interface BetaEvent {
  event: BetaEventName;
  at: string;
  fp?: string;
  mode?: string;
  decision?: string;
  kind?: string;
  edit?: string;
  origin?: string;
  reason?: string;
  task?: string;
  source?: string;
  degraded?: string;
  category?: string;
  enabled?: boolean;
  early?: boolean;
  questionsAnswered?: number;
  domainsVisited?: number;
  domainsSkipped?: number;
  followupsShown?: number;
  proposalsProduced?: number;
  adopted?: number;
  keptDraft?: number;
  dismissed?: number;
  aiCalls?: number;
  contextChars?: number;
}

/** The complete set of keys an event may carry. Anything else is dropped. */
export const ALLOWED_BETA_FIELDS: readonly string[] = [
  "event", "at", "fp",
  ...Object.keys(ENUMS),
  ...Object.keys(NUMERIC),
  ...BOOLEAN,
];

const FP_RE = /^[0-9a-f]{8}$/;

/**
 * What KIND of value each field accepts.
 *
 * Exported so the guarantee can be asserted directly rather than inferred from
 * field names. The invariant that matters is not "no field is called `text`" —
 * it is that NO FIELD ACCEPTS FREE TEXT. `questionsAnswered` and `contextChars`
 * are counts; a name-matching test flags them and misses the actual property.
 */
export type FieldKind = "meta" | "fingerprint" | "enum" | "number" | "boolean";

export const FIELD_KINDS: Readonly<Record<string, FieldKind>> = Object.freeze({
  event: "meta",
  at: "meta",
  fp: "fingerprint",
  ...Object.fromEntries(Object.keys(ENUMS).map((k) => [k, "enum" as FieldKind])),
  ...Object.fromEntries(Object.keys(NUMERIC).map((k) => [k, "number" as FieldKind])),
  ...Object.fromEntries(BOOLEAN.map((k) => [k, "boolean" as FieldKind])),
});

/**
 * An 8-hex fingerprint of a record id (FNV-1a).
 *
 * Used ONLY by the silent-adoption canary, which has to correlate "this element
 * exists" with "an explicit action created it". A raw id would do that too, but
 * a fingerprint does it without handing over a value that could be joined
 * against a synced database row — and the canary never needs to resolve back to
 * a record, only to match.
 *
 * Not a security boundary and not claimed to be: it is a correlation key chosen
 * to be the least revealing thing that still works.
 */
export function fingerprint(id: string): string {
  let h = 0x811c9dc5;
  const s = id ?? "";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(-8);
}

/**
 * Build an event, dropping everything that is not explicitly permitted.
 *
 * Returns `null` for an unknown event name rather than recording a mystery. A
 * caller cannot force a field through: unknown keys vanish, out-of-enum strings
 * vanish, non-finite numbers vanish, and a malformed `fp` vanishes.
 */
export function buildBetaEvent(name: string, fields: Record<string, unknown> = {}, at?: string): BetaEvent | null {
  if (!(BETA_EVENTS as readonly string[]).includes(name)) return null;
  // Built through an index-signature view so each accepted field is assigned by
  // name; the value is narrowed to the declared type before it lands.
  const out: Record<string, unknown> = { event: name as BetaEventName, at: at ?? new Date().toISOString() };

  for (const [key, raw] of Object.entries(fields)) {
    if (key === "event" || key === "at") continue;

    if (key === "fp") {
      if (typeof raw === "string" && FP_RE.test(raw)) out.fp = raw;
      continue;
    }
    if (key in ENUMS) {
      const allowed = ENUMS[key as EnumField] as readonly string[];
      if (typeof raw === "string" && allowed.includes(raw)) out[key] = raw;
      continue;
    }
    if (key in NUMERIC) {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        out[key] = Math.max(0, Math.min(NUMERIC[key], Math.round(raw)));
      }
      continue;
    }
    if ((BOOLEAN as readonly string[]).includes(key)) {
      if (typeof raw === "boolean") out[key] = raw;
      continue;
    }
    // Anything else is silently dropped — deliberately silent, because a caller
    // passing something unexpected must never be able to make it a hard error
    // that breaks the product action it was attached to.
  }
  return out as unknown as BetaEvent;
}

/**
 * Verify a stored event carries nothing it should not.
 *
 * Used by the tests and by the loader, so a payload hand-edited or carried over
 * from an older build cannot introduce a field the current contract forbids.
 */
export function isCleanBetaEvent(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.event !== "string" || !(BETA_EVENTS as readonly string[]).includes(rec.event)) return false;
  if (typeof rec.at !== "string") return false;
  for (const [key, val] of Object.entries(rec)) {
    if (!ALLOWED_BETA_FIELDS.includes(key)) return false;
    if (key === "event" || key === "at") continue;
    if (key === "fp") { if (typeof val !== "string" || !FP_RE.test(val)) return false; continue; }
    if (key in ENUMS) {
      if (typeof val !== "string" || !(ENUMS[key as EnumField] as readonly string[]).includes(val)) return false;
      continue;
    }
    if (key in NUMERIC) { if (typeof val !== "number" || !Number.isFinite(val)) return false; continue; }
    if ((BOOLEAN as readonly string[]).includes(key)) { if (typeof val !== "boolean") return false; continue; }
  }
  return true;
}

/**
 * The longest a single event's JSON may be.
 *
 * A belt-and-braces bound, set just above the largest event this schema can
 * produce (a fully-populated one is ~490 characters). With every field
 * constrained by enum the ceiling cannot be reached by legitimate output, so a
 * payload that exceeds it is by definition not one this code produced, and is
 * discarded rather than trusted.
 */
export const MAX_EVENT_JSON = 600;
