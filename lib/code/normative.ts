/**
 * Recognising a sentence that states a standard (LIFEOS-079 §8).
 *
 * ## What this is allowed to do
 *
 * SUGGEST. Nothing else. The detector runs inside the capture classifier, which
 * `FORBIDDEN_CANDIDATE_KINDS` already bars from writing a `constitution_element`
 * — and LIFEOS-060 was explicit that the bar is structural rather than a check
 * someone must remember. That guarantee is not weakened here: a `standard`
 * candidate is `never_auto`, and the conversion path refuses to create one,
 * routing the sentence to the Personal Code create flow instead.
 *
 * So the worst case if this detector is wrong is a suggestion the user ignores.
 * There is no wording in which it produces a record.
 *
 * ## Why detection is conservative
 *
 * A normative sentence and an ordinary intention look almost identical:
 *
 *   "I want to tell the truth even when it's embarrassing."   → a standard
 *   "I want to call my brother on Saturday."                  → an action
 *
 * The difference is that a standard is UNCONDITIONAL and UNBOUNDED — no date, no
 * single occasion, no one-off object. So the rules below require an explicit
 * normative marker AND the absence of a concrete occasion, and everything else
 * falls through to the classifier it already had. Missing a standard costs the
 * user one extra step in Personal Code; inventing one puts a commitment in
 * front of someone who was writing a to-do.
 */

import { extractConditional } from "@/lib/capture/classify";

/**
 * Markers that a sentence states a standing rule rather than a task.
 *
 * Each is a phrase people actually use when writing a rule for themselves. The
 * list is literal and reviewable — there is no learned classifier here.
 */
const NORMATIVE_MARKERS: RegExp[] = [
  /\balways\b/,
  /\bnever\b/,
  /\bdon'?t\s+(?:ever\s+)?(?:lie|exaggerate|distort|pretend|avoid|send|reply|answer|make|schedule|spend|buy)\b/,
  /\bdo not\s+(?:ever\s+)?(?:lie|exaggerate|distort|pretend|avoid|send|reply|answer|make|schedule|spend|buy)\b/,
  // CLAUSE-ANCHORED. An earlier draft matched a bare "i want to do", which
  // fires inside "whether teaching is what I want to do" — a reflection about a
  // career, turned into a commitment by a loose regex. The anchor is the fix:
  // a standard STARTS with the intention, it does not contain the words.
  /(?:^|[.;!?]\s+)i (?:want|try|intend|aim) to (?:be|stay|remain|tell|treat|keep|protect|always|never)\b/,
  /(?:^|[.;!?]\s+)i (?:should|must) (?:always|never)\b/,
  /\beven (?:when|if) it\b/,
  /\bno matter (?:what|how)\b/,
  /\bmy rule\b|\ba rule (?:for|about)\b/,
  /\bhold myself to\b/,
];

/**
 * Signals that the sentence is about ONE occasion, not a standing rule.
 *
 * Any of these disqualifies it. A date, a named day, a specific person plus a
 * verb — these are the shapes an action takes, and a standard has none of them.
 */
const OCCASION_SIGNALS: RegExp[] = [
  /\b(?:today|tomorrow|tonight|yesterday)\b/,
  /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/,
  /\bnext (?:week|month|year)\b/,
  /\b(?:this|last) (?:week|month|year)\b/,
  /\bat \d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/,
  /\b\d{1,2}\/\d{1,2}\b/,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  /\bby (?:friday|monday|the end of)\b/,
];

/**
 * Whether the sentence is a LEADING conditional, which belongs to the other
 * half of Personal Code.
 *
 * Delegated to `extractConditional` — the same function the protocol classifier
 * uses — rather than a second list of connective regexes. Two lists would drift,
 * and the first draft's did: a bare `/\bwhen\b/` rejected "tell the truth even
 * when it is embarrassing", which is an unconditional standard with a
 * subordinate clause, not a when/then rule.
 */
function isLeadingConditional(text: string): boolean {
  const cond = extractConditional(text);
  return !!cond?.leading;
}

export interface StandardFinding {
  /** The marker that matched, for the explanation and for tests. */
  marker: string;
  /** The sentence, unchanged. Never rewritten, never cleaned up (§34). */
  statement: string;
}

/**
 * Whether a sentence reads as an unconditional standard.
 *
 * Returns `null` far more often than not, on purpose.
 */
export function detectStandard(text: string): StandardFinding | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // A when/then belongs to the protocol path, which already handles it.
  if (isLeadingConditional(t)) return null;
  // A dated or single-occasion sentence is not a standing rule.
  if (OCCASION_SIGNALS.some((re) => re.test(lower))) return null;

  const hit = NORMATIVE_MARKERS.find((re) => re.test(lower));
  if (!hit) return null;

  return { marker: hit.source, statement: t };
}

/** The sentence shown when capture recognises a standard. Suggestion, not a claim. */
export const STANDARD_SUGGESTION_REASON =
  "Reads as a standard you hold yourself to.";

/**
 * Said on the candidate, so the boundary is visible in the product and not only
 * in this comment: capture will not write a normative record.
 */
export const STANDARD_NEVER_AUTO_NOTE =
  "Conqify won't add a rule to your Personal Code unless you say so.";
