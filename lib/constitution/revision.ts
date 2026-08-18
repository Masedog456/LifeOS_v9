/**
 * Edit vs. revise (LIFEOS-056).
 *
 * A Constitution that logs every keystroke as a change of position produces a
 * history nobody can read — the one genuine revision is buried under forty typo
 * fixes. So the product distinguishes:
 *
 *   EDIT    "attenton" → "attention"          the position is unchanged
 *   REVISE  "I read daily" → "I read weekly"  the position itself changed
 *
 * ## Why a deterministic rule rather than a model
 *
 * The same reasoning as `lib/capture/classify.ts`: rules are instant, free,
 * offline, testable, and cannot quietly change their mind between releases. And
 * here the rule is only ever a **default** — the user can always overrule it in
 * the UI, because only the author knows whether a rewording changed what they
 * meant.
 *
 * ## The rule
 *
 * A change is an EDIT when the two statements still say the same thing:
 *  - identical after normalizing case, punctuation and whitespace, or
 *  - a small enough character-level difference relative to length (typo range),
 *    with no change to the words that carry meaning.
 *
 * Everything else defaults to REVISE. **The bias is deliberate**: mislabelling a
 * real revision as an edit silently loses the user's history, while mislabelling
 * an edit as a revision merely adds a line they can see and correct. We fail
 * toward keeping history.
 */

import type { ConstitutionChangeKind } from "@/types/mvp";

/** Words too common to signal a change of meaning on their own. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "is", "am", "are", "be", "my", "i", "that", "this", "it", "as", "by",
]);

/** Case/punctuation/whitespace-insensitive form. */
export function normalizeStatement(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,;:!?"'()\[\]—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaning-bearing words, in order. */
export function significantWords(s: string): string[] {
  return normalizeStatement(s).split(" ").filter((w) => w && !STOPWORDS.has(w));
}

/** Levenshtein distance, capped — we only ever care about small values here. */
export function editDistance(a: string, b: string, cap = 12): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1; // cannot come back under the cap
    prev = cur;
  }
  return prev[b.length];
}

export interface ChangeClassification {
  /** The default the UI pre-selects. The user may always override it. */
  suggested: Extract<ConstitutionChangeKind, "edited" | "revised">;
  /** Plain language, shown to the user. Never regex internals. */
  reason: string;
}

/**
 * Classify a statement change. Pure; same inputs always give the same answer.
 *
 * Returns a SUGGESTION, never a decision — mirroring the capture classifier's
 * contract that the system may route but the user remains the author.
 */
export function classifyStatementChange(before: string, after: string): ChangeClassification {
  const nb = normalizeStatement(before);
  const na = normalizeStatement(after);

  if (nb === na) {
    return { suggested: "edited", reason: "Only punctuation, capitalization or spacing changed." };
  }

  const wb = significantWords(before);
  const wa = significantWords(after);

  // Adding or removing a meaning-bearing word changes what the statement says.
  if (wb.length !== wa.length) {
    return { suggested: "revised", reason: "The wording gained or lost a meaningful word." };
  }

  // Same number of significant words: compare them pairwise. A word that differs
  // by one or two characters is a spelling fix; a different word is a different
  // claim ("daily" → "weekly" is 3 apart and short, so it reads as revised).
  let typos = 0;
  for (let i = 0; i < wb.length; i++) {
    if (wb[i] === wa[i]) continue;
    const d = editDistance(wb[i], wa[i], 4);
    const tolerance = wb[i].length >= 8 ? 2 : 1;
    if (d <= tolerance) { typos++; continue; }
    return { suggested: "revised", reason: "At least one meaningful word was replaced." };
  }

  if (typos === 0) {
    return { suggested: "edited", reason: "Only punctuation, capitalization or spacing changed." };
  }
  return {
    suggested: "edited",
    reason: typos === 1 ? "One word looks like a spelling correction." : `${typos} words look like spelling corrections.`,
  };
}

/**
 * Does this change need a reason from the user? Only a genuine revision does —
 * asking "why?" for a typo fix trains people to ignore the question.
 */
export function requiresReason(kind: ConstitutionChangeKind): boolean {
  return kind === "revised" || kind === "retired";
}
