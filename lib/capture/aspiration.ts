/**
 * Recognising a sentence that names something the person WANTS (LIFEOS-080 §7).
 *
 * ## What was there before
 *
 * One anchored regex in `interpret.ts`:
 *
 *   /^i\s+want\s+to\s+(.+)$/i
 *
 * The audit measured what it costs. Because it is anchored at `^`, **any prefix
 * defeats it** — "Someday I want to move closer to my parents", "Long term I
 * want to start my own business". And because `want` is the only operator, the
 * sentence that literally says *"My goal is to save six months of expenses"*
 * became a note.
 *
 * Two more were worse than missed. "I've always wanted to learn to play piano"
 * and "I want to be debt free in two years" matched the NORMATIVE detector — so
 * a wish became a rule the person is held to, in the one tier capture cannot
 * write at all. Both are goals; the second names a two-year horizon.
 *
 * ## Goal or rule?
 *
 * The two overlap in English and the discriminator has to be small enough to
 * read. It is this: **strip the aspiration marker, then look at what is left.**
 *
 *   "I want to be debt free in two years"        → "be debt free in two years"
 *                                                  no normative signal → GOAL
 *   "I want to be honest even when it costs me"  → "be honest even when it costs me"
 *                                                  "even when" → RULE
 *
 * Stripping first is what makes it work. "I've always wanted to learn piano"
 * contains `always`, but the `always` modifies the WANTING, not the acting —
 * remove the marker it belongs to and the remainder is an ordinary ambition.
 *
 * ## Horizons are read, never inferred
 *
 * LIFEOS-078 wrote the rule into `createGoal`: *"only ever what the caller
 * passed. A goal with no stated horizon keeps none — nothing is inferred from
 * the title or the date."*
 *
 * This module holds that line and does NOT map "this year" or "someday" onto a
 * `GoalHorizon`. "This year" is `near` in November and `medium` in January, and
 * picking one would be the product inventing a life fact from a calendar — the
 * same overclaiming 078 refused. A long-range adverb is used for two honest
 * things only: to find the marker behind it, and to tell an ambition from an
 * errand. The horizon stays the user's to set.
 *
 * ## Pure
 *
 * A function of the text alone, like every other detector here.
 */

import { classifyOne } from "@/lib/capture/classify";
import { detectStance } from "@/lib/capture/stance";

/**
 * Adverbs that place something beyond the next step.
 *
 * They may lead the sentence ("Someday I want to…"), in which case they are
 * stripped before the marker is sought, and they may sit anywhere, in which case
 * they mean the sentence is an ambition even if its verb looks like an errand.
 */
const LONG_RANGE = [
  "someday", "some day", "one day", "eventually", "long term", "long-term",
  "in the long run", "ultimately", "down the line", "at some point",
];

const LONG_RANGE_RE = new RegExp(`\\b(?:${LONG_RANGE.map((a) => a.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b`, "i");
const LEADING_LONG_RANGE_RE = new RegExp(`^(?:${LONG_RANGE.map((a) => a.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b[,]?\\s+`, "i");

/**
 * Ways people name something they want.
 *
 * Each captures the OBJECTIVE in group 1. Not anchored at `^` — that anchoring
 * is the specific defect this replaces — but anchored to a CLAUSE boundary, the
 * fix LIFEOS-079 arrived at for the same class of problem: a sentence that
 * *mentions* wanting ("whether teaching is what I want to do") is not a sentence
 * that *states* a want.
 */
const CLAUSE = "(?:^|[.;!?]\\s+|,\\s+|\\bso\\s+|\\bbut\\s+|\\band\\s+|\\bthinking\\s+)";

const ASPIRATION_MARKERS: RegExp[] = [
  new RegExp(`${CLAUSE}i\\s+want\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}i'?d\\s+like\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}i\\s+would\\s+like\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}i'?ve\\s+always\\s+wanted\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}i'?m\\s+trying\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}i\\s+(?:hope|plan|intend|aim)\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}my\\s+goal\\s+is\\s+to\\s+(.+)$`, "i"),
  new RegExp(`${CLAUSE}my\\s+goal\\s+is\\s+(.+)$`, "i"),
  // "Eventually I need to finish my degree". `need to` is an ERRAND everywhere
  // else and must stay one, so this marker exists only behind a long-range
  // adverb — the word that makes the difference between a step and an ambition.
  new RegExp(`${CLAUSE}i\\s+(?:need|have)\\s+to\\s+(.+)$`, "i"),
];

/** Markers that only count when a long-range adverb is present. */
const NEEDS_LONG_RANGE = ASPIRATION_MARKERS.length - 1;

/**
 * Signals that the remainder states a RULE rather than an outcome.
 *
 * Deliberately the unconditional-normative core of `lib/code/normative.ts` and
 * nothing else: this is a tie-break between two readings, not a second normative
 * detector. §11 allows exactly one of those and it is not here.
 */
const NORMATIVE_REMAINDER: RegExp[] = [
  /\balways\b/i,
  /\bnever\b/i,
  /\beven (?:when|if)\b/i,
  /\bno matter (?:what|how)\b/i,
  /\bevery (?:time|single time)\b/i,
  /\bno exceptions\b/i,
];

export interface AspirationFinding {
  /** The sentence, unchanged. Never rewritten (§34 of LIFEOS-079, still in force). */
  statement: string;
  /** What is wanted — the remainder after the marker, for the goal's title. */
  objective: string;
  /** The marker that matched, for the explanation and for tests. */
  marker: string;
  /** True when a long-range adverb placed this beyond the next step. */
  longRange: boolean;
}

/** Remove a long-range adverb wherever it sits, so it does not land in a title. */
function withoutLongRange(s: string): string {
  return s.replace(LONG_RANGE_RE, "").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

/**
 * Does the remainder of an aspiration read as a standing rule instead?
 *
 * Exported because `interpret` needs the same answer when deciding which of two
 * detectors owns a sentence, and deriving it twice is how two readings drift.
 */
export function readsAsRule(objective: string): boolean {
  return NORMATIVE_REMAINDER.some((re) => re.test(objective));
}

/**
 * Whether a sentence names something the person wants.
 *
 * Returns `null` for an errand, for a rule, and for anything the stance guards
 * caught — a wish someone has abandoned, is asking about, or has declined is not
 * a goal, and offering one would put a life direction in front of a person who
 * was telling Conqify the opposite (§15, §16, §17).
 */
export function detectAspiration(text: string): AspirationFinding | null {
  const t = (text ?? "").trim();
  if (!t) return null;

  // §15–§17. A named commitment is not a held one.
  if (detectStance(t).stance !== "asserted") return null;

  const longRange = LONG_RANGE_RE.test(t);
  // A leading adverb hides the marker from a clause-anchored pattern, so it comes
  // off first — that anchoring is deliberate and this is how both survive.
  const body = t.replace(LEADING_LONG_RANGE_RE, "");

  for (let i = 0; i < ASPIRATION_MARKERS.length; i++) {
    if (i >= NEEDS_LONG_RANGE && !longRange) continue;
    const m = ASPIRATION_MARKERS[i].exec(body);
    if (!m) continue;

    const objective = withoutLongRange(m[1].trim().replace(/[.,;:!?]+$/, "").trim());
    if (!objective) continue;

    // A rule wearing a want ("I want to be honest even when it costs me")
    // belongs to the normative path. One discriminator, stated once.
    if (readsAsRule(objective)) return null;

    // An ERRAND wearing a want ("I want to call my brother on Saturday") is a
    // next action and always was. The exception is a long-range adverb, which
    // says outright that this is not the next step — "Eventually I need to
    // finish my degree" carries an action verb and is plainly not an errand.
    if (!longRange) {
      const c = classifyOne(objective);
      if (c.suggestedType === "action" && c.confidence === "high") return null;
    }

    return { statement: t, objective, marker: ASPIRATION_MARKERS[i].source, longRange };
  }
  return null;
}

/**
 * Does the sentence name a want at all, stance aside?
 *
 * Same lists, entered one test earlier — the counterpart to
 * `hasNormativeMarker`. A caller may only say "reads as something you've decided
 * against" about a sentence that did read as an ambition.
 */
export function hasAspirationMarker(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const longRange = LONG_RANGE_RE.test(t);
  const body = t.replace(LEADING_LONG_RANGE_RE, "");
  return ASPIRATION_MARKERS.some((re, i) => (i < NEEDS_LONG_RANGE || longRange) && re.test(body));
}

/** Shown on a goal candidate. A reading offered, and a refusal stated (§6). */
export const ASPIRATION_SUGGESTION_REASON =
  "Reads as something you want, not a single next step. Conqify won't create a goal unless you say so.";
