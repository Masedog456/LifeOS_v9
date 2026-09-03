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
import { detectStance } from "@/lib/capture/stance";

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

  // ---- LIFEOS-080 §11. Shapes the audit measured falling through to Note ----
  //
  // Every one of these was a rule a person had plainly written for themselves,
  // filed as an undifferentiated note. Added here rather than in a second
  // detector, because there is one normative interpretation path and this is it.

  // "From now on I stop working at 6pm" — the phrase that declares a rule
  // starting now, which is what adopting one IS.
  /\bfrom now on\b/,
  /\bstarting today\b|\bstarting now\b/,

  // "I refuse to take on work I can't finish."
  /\bi refuse to\b/,

  // "I won't reply to anything after 9." Kept to a closed verb set for the same
  // reason `don't` is: "I won't be home until six" is a fact about tonight, not
  // a rule, and an open verb list cannot tell them apart.
  /\bi\s+(?:won'?t|will not)\s+(?:ever\s+)?(?:lie|reply|answer|send|check|work|spend|buy|say|take|let|allow|commit|agree|apologi[sz]e)\b/,

  // "I should be more patient with my kids." `should` alone was deliberately not
  // enough, and that was right — "I should talk to Dana" is an errand. The
  // discriminator is the complement: a DISPOSITION ("be", "stay", "stop") is a
  // way of acting; a plain verb is a thing to do.
  /(?:^|[.;!?]\s+)i (?:should|must|will) (?:be|stay|remain|keep|stop|start|treat|hold|protect|make sure)\b/,

  // "No phone at the dinner table." A bare prohibition with no verb at all —
  // the shortest way people write a house rule, and invisible to every pattern
  // above. The trailing preposition is what stops it matching an ordinary
  // negative noun phrase ("No milk", "No idea").
  /^no\s+\w+(?:\s+\w+)?\s+(?:at|in|on|during|before|after|while|when|around|near)\b/,
  /^no more\b/,
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
  // LIFEOS-080. A bare CLOCK TIME used to disqualify a sentence here, and it
  // was wrong: "From now on I stop working at 6pm" names a rule, not an
  // appointment. A time of day recurs by nature — it is the DATE that makes
  // something a single occasion, and every other pattern in this list is one.
  // "Friday at 3" is still caught, by the day name.
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

  // LIFEOS-080 §15–§17. A sentence that NAMES a rule is not a sentence that
  // HOLDS one. The audit caught three of these live — "I used to always answer
  // emails immediately", "I wonder if I should always be so available", "Is it a
  // rule that I never say no?" — each offered as a commitment the person had
  // just finished telling Conqify they do not have.
  //
  // Delegated rather than re-listed, for the reason the conditional test below
  // is: two copies of a judgment drift, and this module has already paid for
  // that once.
  if (detectStance(t).stance !== "asserted") return null;

  // A when/then belongs to the protocol path, which already handles it.
  if (isLeadingConditional(t)) return null;
  // A dated or single-occasion sentence is not a standing rule.
  if (OCCASION_SIGNALS.some((re) => re.test(lower))) return null;

  const hit = NORMATIVE_MARKERS.find((re) => re.test(lower));
  if (!hit) return null;

  return { marker: hit.source, statement: t };
}

/**
 * Does the sentence carry a normative marker at all, stance aside?
 *
 * The same list, entered one test earlier. It exists so a caller can say *why*
 * a rule was not offered — "reads as something you used to do" is only truthful
 * if the sentence did read as a rule in the first place. Reading the marker list
 * from here rather than copying it is the whole reason it is a function.
 */
export function hasNormativeMarker(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return NORMATIVE_MARKERS.some((re) => re.test(t.toLowerCase()));
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
