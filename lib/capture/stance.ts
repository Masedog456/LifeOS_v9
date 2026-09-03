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
  const p = FIRST_MATCH(t, PAST);
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
