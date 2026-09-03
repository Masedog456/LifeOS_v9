/**
 * Near-duplicate detection across both halves of Personal Code (LIFEOS-079 §9).
 *
 * ## Why this exists
 *
 * A person writes "Don't text when angry" in March and "Wait before replying
 * when I'm furious" in September. Both are true, both are theirs, and a product
 * that silently keeps both leaves them with a code they can no longer read.
 *
 * ## What it will not do
 *
 * It will not merge. Merging two normative statements picks one person's
 * wording over another's — the same person's, months apart — and the wording of
 * a rule carries identity (§34). So this module SUGGESTS, returns both sides,
 * and leaves the decision where it belongs.
 *
 * ## How similarity is decided
 *
 * Two deterministic tests, both checkable by reading the two sentences:
 *
 *   IDENTICAL   the same normalised words. No judgement involved.
 *   OVERLAPPING enough meaning-bearing words in common, measured as a Jaccard
 *               ratio over `significantWords`.
 *
 * There is no learned threshold and no similarity percentage shown to the user;
 * the ratio decides whether to ASK, and the question names the other rule.
 */

import type { StoreState } from "@/types/mvp";
import { significantWords } from "@/lib/constitution/revision";
import { allRules, ruleKey, type CodeRule } from "@/lib/code/personal-code";

/**
 * How much overlap counts as "you may already have this".
 *
 * Deliberately high. A false positive interrupts someone writing down a
 * commitment, which is the worst possible moment to be wrong — so this asks
 * only when the two sentences genuinely share most of their meaning.
 */
export const DUPLICATE_OVERLAP = 0.6;

export type DuplicateKind = "identical" | "overlapping";

export interface DuplicateMatch {
  kind: DuplicateKind;
  existing: CodeRule;
  /** The words the two sentences share. Shown so the user can judge for themselves. */
  sharedWords: string[];
}

function overlap(a: string, b: string): { ratio: number; shared: string[] } {
  const wa = new Set(significantWords(a));
  const wb = new Set(significantWords(b));
  if (wa.size === 0 || wb.size === 0) return { ratio: 0, shared: [] };
  const shared = [...wa].filter((w) => wb.has(w));
  // Jaccard: shared over the union. Using the SMALLER set as the denominator
  // would make a three-word rule "match" every long one that happens to contain
  // those three words.
  const union = new Set([...wa, ...wb]).size;
  return { ratio: shared.length / union, shared };
}

/**
 * Rules that may already say what `statement` says.
 *
 * Retired rules are included: "you retired a rule like this in March" is worth
 * knowing before writing it again, and hiding it would make the product forget
 * something the person did.
 *
 * `excludeId` skips a rule being edited, so a statement never matches itself.
 */
export function findDuplicates(
  state: StoreState, statement: string, excludeId?: string,
): DuplicateMatch[] {
  const text = (statement ?? "").trim();
  if (!text) return [];
  const key = ruleKey({ statement: text } as CodeRule);
  const out: DuplicateMatch[] = [];

  for (const existing of allRules(state)) {
    if (existing.id === excludeId) continue;
    if (ruleKey(existing) === key) {
      out.push({ kind: "identical", existing, sharedWords: significantWords(text) });
      continue;
    }
    const { ratio, shared } = overlap(text, existing.statement);
    if (ratio >= DUPLICATE_OVERLAP) out.push({ kind: "overlapping", existing, sharedWords: shared });
  }

  // Identical first — it is the one a person almost always wants to act on.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "identical" ? -1 : 1));
}

/**
 * The sentence shown when a duplicate is found.
 *
 * States the fact and asks. It never says "you already saved this" (which would
 * be wrong for an overlap) and never offers to merge.
 */
export function duplicateNotice(match: DuplicateMatch): string {
  return match.kind === "identical"
    ? "You already have this rule."
    : "You already have a similar rule.";
}

/** The choices offered. Bounded, and none of them is destructive. */
export const DUPLICATE_CHOICES = [
  { id: "use_existing", label: "Use the one I have" },
  { id: "save_anyway", label: "Save this as well" },
  { id: "review", label: "Show me both" },
] as const;

export type DuplicateChoice = (typeof DUPLICATE_CHOICES)[number]["id"];
