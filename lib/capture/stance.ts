/**
 * What stance does a sentence take toward the thing it names? (LIFEOS-080 §15–§17)
 *
 * ## The defect this exists for
 *
 * The LIFEOS-080 audit ran the pipeline over a corpus and found three live
 * wrong-positives, all of the same shape:
 *
 *   "I used to always answer emails immediately"   → offered as a rule
 *   "I wonder if I should always be so available"  → offered as a rule
 *   "Is it a rule that I never say no?"            → offered as a rule
 *
 * Every one of them names a rule. Not one of them *holds* a rule. A detector
 * that reads content and ignores stance will keep making this mistake, because
 * the content is genuinely there — what is missing is the person's commitment
 * to it.
 *
 * ## Why one module rather than a check in each detector
 *
 * §11's principle, applied past the normative path: there is ONE answer to
 * "is this sentence actually asserting this?", and both `detectStandard` and
 * `detectAspiration` ask it here. Two copies would drift, and LIFEOS-079 has
 * already paid for that lesson once — its first draft carried a second list of
 * connectives that disagreed with `extractConditional`.
 *
 * ## Scope: the OPERATOR, not the polarity
 *
 * This is the distinction the whole module turns on.
 *
 *   "I don't lie to avoid embarrassment"   — negative CONTENT, asserted stance.
 *                                            A rule. Nothing here fires.
 *   "I don't want to run a marathon"       — negated OPERATOR.
 *                                            Not a goal. `negated`.
 *
 * So the patterns below negate *wanting*, *intending* and *holding* — never the
 * verb inside the commitment. Getting this backwards would suppress exactly the
 * rules Personal Code exists for, since most rules people write for themselves
 * are phrased as prohibitions.
 *
 * ## What a guard does and does not do
 *
 * It withholds a CONSEQUENTIAL reading — a Goal, a Rule. It never suppresses
 * the sentence: the text still becomes a note, kept exactly as typed, and the
 * caller states why the stronger reading was not offered. Recognising something
 * and declining to assert it is the behaviour; going silent is not.
 */

/** The stance a sentence takes toward the commitment it names. */
export type Stance = "asserted" | "past" | "negated" | "questioned";

export interface StanceFinding {
  stance: Stance;
  /** The words that decided it. Shown to the user, so it must be their words. */
  phrase: string;
}

/**
 * The sentence is a QUESTION about a commitment, not a commitment.
 *
 * A trailing question mark is the strongest signal and needs no list. The
 * openers cover the shapes that ask without punctuation ("I wonder if I should
 * always be so available" ends with a full stop and is still a question).
 */
const QUESTIONED: RegExp[] = [
  /\?\s*$/,
  /^i\s+wonder\b/,
  /^i'?m\s+wondering\b/,
  /^i\s+keep\s+wondering\b/,
  /^(?:should|shouldn'?t|do|don'?t|am|is|are|was|were|can|could|would|will|why|what|how)\s+i\b/,
  /^is\s+it\b/,
  /^what\s+if\b/,
  /^maybe\s+i\s+should\b/,
];

/**
 * The sentence describes something that WAS, not something that is.
 *
 * `used to` needs its subject: "I need to get used to waking up early" contains
 * the phrase and is not past tense at all, so the pattern requires a pronoun in
 * front of it rather than matching the bare words.
 */
const PAST: RegExp[] = [
  /\b(?:i|we|he|she|they)\s+used\s+to\b/,
  /**
   * LIFEOS-101 Fix A. A past TIME FRAME makes everything under it a report.
   *
   * The corpus measured the cost of not having this:
   *
   *   "When I was applying to college I called Maria every week"
   *     → Action · weekly recurrence · auto_with_undo
   *
   * A story about a finished chapter of someone's life became a standing
   * commitment they would be reminded of every week. `used to` was already here
   * and this is the same sentence with a different frame around it, so it
   * belongs on the same list rather than in a guard somewhere downstream.
   *
   * Requires the past copula plus a subject, so it reads as a frame and not as
   * a bare "when" — "When I finish the draft I'll send it" has no `was/were`
   * and is not touched.
   */
  /\b(?:when|while|back\s+when)\s+(?:i|we|he|she|they)\s+(?:was|were)\b/,
  /\bi\s+wanted\s+to\b/,
  /\bi\s+(?:always\s+)?used\s+to\b/,
  /\bi\s+would\s+always\b/,
  /\bi\s+never\s+used\s+to\b/,
  /\bback\s+when\s+i\b/,
  /\bi\s+gave\s+up\s+on\b/,
  /\bi\s+stopped\s+(?:trying|wanting)\b/,
  /\bfor\s+years\s+i\b/,
];

/**
 * Irregular past-tense verbs. LIFEOS-101 Fix B.
 *
 * Moved here from `classify.ts`, which kept it privately to keep narrative out
 * of un-delimited conditionals ("When I saw him I told him the truth"). That is
 * the same question this module exists to answer, and the codebase has already
 * paid once for two copies of a judgment — LIFEOS-079's first draft carried a
 * second list of connectives that disagreed with `extractConditional`.
 *
 * So there is now one list, it lives with the other tense tests, and
 * `classify.ts` imports `opensWithPastVerb` rather than re-deriving it.
 */
const IRREGULAR_PAST = new Set([
  "was", "were", "had", "did", "went", "saw", "told", "said", "got", "came",
  "took", "made", "felt", "knew", "thought", "left", "found", "gave", "heard",
  "met", "ran", "wrote", "bought", "caught", "brought", "sent", "spent", "kept",
  "slept", "woke", "broke", "chose", "forgot", "lost", "paid", "sat", "stood",
  "won", "wore", "drove", "ate", "drank", "began", "held", "let", "quit",
]);

/**
 * Does a clause open with a past-tense verb?
 *
 * A guard, not a tense analyser. The `-ed` test requires a consonant before the
 * suffix because "I need", "I feed" and "I speed" are present tense and every
 * one of them ends in those letters.
 *
 * Exported for `classify.ts`, which used to own this test privately.
 */
export function opensWithPastVerb(clause: string): boolean {
  const first = (clause ?? "").trim().replace(/^i\s+/i, "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/[^aeiou]ed$|ied$/.test(first)) return true;
  return IRREGULAR_PAST.has(first);
}

/**
 * LIFEOS-101 Fix B — `never` before a past-tense verb is a REPORT, not a rule.
 *
 * `lib/code/normative.ts` treats a bare `\bnever\b` as a normative marker,
 * which is right for the habitual ("I never say no", "never lie to look
 * better") and wrong for the past. The corpus caught three:
 *
 *   "Never got around to emailing Marcus"   → Personal Code rule
 *   "I never needed to call the dentist"    → Personal Code rule
 *   "I never sent Marcus the lease"         → Personal Code rule
 *
 * Every one is a fact about something that did not happen — §11's
 * autobiographical truth — filed as a standing commitment the person holds.
 *
 * Fixed HERE rather than by trimming the marker list, because the marker is not
 * what is wrong: "never" really is normative language. What is wrong is the
 * STANCE, and `detectStandard` already refuses any sentence this module does
 * not call asserted. One change, and both the rule path and the goal path get
 * it, which is why the stance question lives in one module at all.
 */
function neverWithPastVerb(t: string): string | null {
  const m = /\b(?:i\s+)?never\s+(\w+)/.exec(t);
  if (!m) return null;
  return opensWithPastVerb(m[1]) ? m[0].trim() : null;
}

/**
 * The sentence DECLINES the commitment.
 *
 * Every pattern negates an operator — want, intend, aim, plan, try — or the
 * universal quantifier that makes a rule a rule ("I don't always tell the
 * truth" is a confession, not a standard). None negates a plain verb, because
 * that is where the rules live.
 */
const NEGATED: RegExp[] = [
  /\bi\s+(?:don'?t|do\s+not|never)\s+(?:want|intend|aim|plan|mean)\s+to\b/,
  /\bi\s+no\s+longer\s+(?:want|intend|aim|plan|try)\b/,
  /\bi\s+(?:don'?t|do\s+not)\s+(?:always|ever)\b/,
  /\bi\s+decided\s+(?:not\s+to|against)\b/,
  /\bi\s+have\s+no\s+(?:intention|plans?)\s+(?:of|to)\b/,
];

const FIRST_MATCH = (text: string, list: RegExp[]): string | null => {
  for (const re of list) {
    const m = re.exec(text);
    if (m) return m[0].trim();
  }
  return null;
};

/**
 * The stance of a sentence. `asserted` when nothing fires — the common case,
 * and the only one that lets a consequential reading through.
 *
 * Order is questioned → past → negated, and it only decides which phrase is
 * REPORTED when more than one fires; all three withhold equally.
 */
export function detectStance(text: string): StanceFinding {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return { stance: "asserted", phrase: "" };

  const q = FIRST_MATCH(t, QUESTIONED);
  if (q) return { stance: "questioned", phrase: q };
  const p = FIRST_MATCH(t, PAST) ?? neverWithPastVerb(t);
  if (p) return { stance: "past", phrase: p };
  const n = FIRST_MATCH(t, NEGATED);
  if (n) return { stance: "negated", phrase: n };

  return { stance: "asserted", phrase: "" };
}

/** Is this sentence actually committing to the thing it names? */
export function isAsserted(text: string): boolean {
  return detectStance(text).stance === "asserted";
}

/**
 * What the user is told when a guard withheld a Goal or a Rule.
 *
 * Each says what was recognised AND what was done about it, because a person who
 * writes "I used to always answer emails immediately" should be able to see that
 * Conqify read the sentence correctly — and that reading it correctly is
 * precisely why it did not offer them a rule.
 */
export const STANCE_DISCLOSURE: Record<Exclude<Stance, "asserted">, string> = {
  past: "Reads as something you used to do, so it's kept as a note rather than offered as a goal or a rule.",
  negated: "Reads as something you've decided against, so it's kept as a note rather than offered as a goal or a rule.",
  questioned: "Reads as a question you're asking yourself, so it's kept as a note rather than offered as a goal or a rule.",
};

/** The disclosure for a finding, or `null` when the stance is asserted. */
export function stanceDisclosure(finding: StanceFinding): string | null {
  return finding.stance === "asserted" ? null : STANCE_DISCLOSURE[finding.stance];
}
