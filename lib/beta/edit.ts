/**
 * The heavy-editing signal (LIFEOS-059 §10).
 *
 * ## The question this answers
 *
 * Does the model's wording carry its weight? If testers adopt AI proposals only
 * after rewriting them, the wording is not earning its place — and the right
 * response is to make the model quieter, not to add more AI machinery on top of
 * prose people are already discarding.
 *
 * ## Reuse, not a new engine
 *
 * The classification is `userRewroteProposal` from `lib/interview/adopt.ts` —
 * the same rule that already decides whether adoption preserves `fromAiText`.
 * Using one rule for both means the evidence cannot drift from the provenance
 * behaviour it is reporting on: a proposal recorded as "substantial" here is
 * exactly a proposal the product treated as the user's own words.
 *
 * No similarity model, no embeddings, no new engine — the brief rules those out
 * and they would be a second source of truth about the same question.
 *
 * ## What is recorded
 *
 * One word: `unchanged` | `minor` | `substantial`. Never the before text, never
 * the after text, never a diff, never a distance. The bucket is the signal.
 */

import { userRewroteProposal } from "@/lib/interview/adopt";
import { normalizeStatement } from "@/lib/constitution/revision";

/** How much of the model's wording survived to the user's decision. */
export type EditBucket = "unchanged" | "minor" | "substantial";

/**
 * Classify an edit for evidence purposes.
 *
 * `unchanged` is decided by the existing normalisation, so punctuation and
 * capitalisation fixes do not count as editing — the same forgiveness
 * `classifyStatementChange` already applies when deciding whether a Constitution
 * change is an edit or a revision.
 */
export function classifyEdit(original: string, final: string): EditBucket {
  if (normalizeStatement(original) === normalizeStatement(final)) return "unchanged";
  return userRewroteProposal(original, final) ? "substantial" : "minor";
}
