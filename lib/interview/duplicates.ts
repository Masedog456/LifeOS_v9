/**
 * Deterministic duplicate detection against the existing Constitution (§19).
 *
 * ## Why this is local and not a model job
 *
 * The brief permits the builder to inspect the existing Constitution "only if
 * allowed by the privacy model", and an element marked `excludeFromAi` is never
 * allowed. That leaves a gap: an element the model may not see is exactly an
 * element the model may unknowingly re-propose, and the user would then be asked
 * to adopt a near-copy of something they had deliberately hidden.
 *
 * A deterministic local comparison closes it. This code runs in the browser,
 * over state the user already has, and never transmits anything — so it can
 * safely compare against EVERY active element, including excluded ones, and warn
 * the user without the model ever learning that the element exists.
 *
 * That asymmetry is the whole design: the model gets less, the user gets more.
 *
 * ## What "duplicate" means here
 *
 * Nothing semantic. No embeddings, no similarity model — this is content-word
 * overlap, which is crude on purpose. Its output is never an automatic action:
 * it produces a QUESTION ("you already have one about protecting attention —
 * review it instead?") with both paths open. A false positive costs a sentence
 * of screen; a false negative costs nothing at all, since a near-duplicate
 * element is a legitimate thing for a person to want.
 *
 * It never merges, never rewrites, and never suppresses a proposal.
 */

import type { ConstitutionElement, StoreState } from "@/types/mvp";
import { activeConstitution } from "@/lib/constitution/constitution";

/** Words carrying no topical signal. Overlap on these means nothing. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "i", "me", "my", "mine", "myself", "you", "your", "we", "our", "it", "its",
  "is", "am", "are", "was", "were", "be", "been", "being", "do", "does", "did", "doing",
  "have", "has", "had", "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "as", "into", "about", "over",
  "not", "no", "own", "more", "most", "less", "very", "much", "want", "wants", "wanting",
  "life", "live", "living", "things", "thing", "way", "ways", "make", "makes", "keep", "keeps",
]);

/** Content words of a statement, lowercased and de-duplicated. */
export function contentWords(text: string): string[] {
  const words = (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Jaccard overlap of content words, 0..1.
 *
 * Chosen over a directional measure because "protect my attention" and "I will
 * protect my attention from constant interruption" should read as related in
 * both directions; a containment score would call the short one a subset of the
 * long one and the long one novel.
 */
export function overlapScore(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const setB = new Set(wb);
  const shared = wa.filter((w) => setB.has(w)).length;
  return shared / (wa.length + wb.length - shared);
}

/** The bar for "worth mentioning". Tuned to be quiet rather than clever. */
export const DUPLICATE_THRESHOLD = 0.4;

export interface DuplicateHit {
  element: ConstitutionElement;
  score: number;
  /**
   * True when the matched element is hidden from AI. The UI uses this to avoid
   * ever implying the model knew about it — the user is told they already have
   * something similar, and the model is told nothing.
   */
  hiddenFromAi: boolean;
}

/**
 * The closest existing active element to a candidate statement, if any clears
 * the threshold.
 *
 * Compares against ALL active elements including `excludeFromAi` ones — see the
 * file header. Drafts are excluded: an unadopted draft is not yet part of the
 * Constitution, so proposing something similar is not a duplication.
 */
export function findDuplicate(state: StoreState, statement: string): DuplicateHit | undefined {
  let best: DuplicateHit | undefined;
  for (const el of activeConstitution(state)) {
    const score = overlapScore(statement, el.statement);
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { element: el, score, hiddenFromAi: el.excludeFromAi === true };
    }
  }
  return best;
}

/**
 * The sentence shown when a near-duplicate is found.
 *
 * Phrased as an offer, never a block. "You already have one" is a fact; "you
 * don't need another" would be a judgment about someone's Constitution that this
 * product has no standing to make.
 */
export function duplicateNotice(hit: DuplicateHit, kindLabel: string): string {
  return `You already have a ${kindLabel} that covers similar ground: “${hit.element.statement}”. You can review that one instead, or keep both.`;
}
