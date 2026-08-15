/**
 * Hybrid retrieval for book-length documents (LIFEOS-049).
 *
 * LIFEOS-047 ranked one-passage chunks by exact term overlap and took the top 6.
 * For a book that fails twice: a question phrased in different words finds
 * nothing, and six near-identical chunks from one page can crowd out the rest of
 * the work. This module fixes both, without giving up determinism:
 *
 *   score = w_lex · lexical(query, chunk) + w_sem · cosine(query, chunk)
 *   then MMR-style diversity so evidence spans the document
 *
 * Retrieval SELECTS EVIDENCE. The model only writes prose. Citations are always
 * built from the returned chunks' real locations — never parsed from AI output.
 *
 * Fully deterministic given the same inputs, and degrades cleanly: with no
 * vectors it is exactly the lexical behaviour LIFEOS-047 shipped.
 */

import type { RetrievalChunk } from "@/lib/reading/chunking";
import type { StoredVector } from "@/lib/reading/semanticIndex";

export const LEXICAL_WEIGHT = 0.5;
export const SEMANTIC_WEIGHT = 0.5;
/** How strongly to penalise a candidate that repeats an already-chosen chunk. */
export const DIVERSITY_LAMBDA = 0.35;
/** Default evidence set for a document-wide question. */
export const DEFAULT_EVIDENCE_K = 8;

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "was", "were", "it", "this", "that", "for", "as", "at", "by", "be", "with", "what", "does", "do", "how", "why", "here", "mean", "means", "about", "say", "says", "author"]);

export function terms(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t));
}

/** Lexical relevance in 0..1 — distinct query terms present, frequency-weighted. */
export function lexicalScore(query: string, text: string): number {
  const q = [...new Set(terms(query))];
  if (!q.length) return 0;
  const body = text.toLowerCase();
  let hits = 0;
  for (const t of q) {
    const occurrences = body.split(t).length - 1;
    if (occurrences > 0) hits += 1 + Math.min(occurrences - 1, 3) * 0.15;
  }
  const phrase = query.toLowerCase().trim();
  if (phrase.length > 8 && body.includes(phrase)) hits += 1.5;
  return Math.min(1, hits / (q.length + 1.5));
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RankedChunk {
  chunk: RetrievalChunk;
  score: number;
  lexical: number;
  semantic: number;
}

export interface HybridOptions {
  k?: number;
  /** Query embedding; omit for lexical-only (the honest fallback). */
  queryVector?: number[];
  vectors?: StoredVector[];
  /** Set false to disable diversity (used by tests to observe raw ranking). */
  diversify?: boolean;
}

/**
 * Rank chunks for a query. Returns only positively-scoring chunks, most relevant
 * first, with tie-breaks by reading order so results are stable.
 */
export function rankChunks(query: string, chunks: RetrievalChunk[], opts: HybridOptions = {}): RankedChunk[] {
  const vecById = new Map((opts.vectors ?? []).map((v) => [v.chunkId, v.vector]));
  const useSemantic = !!opts.queryVector && vecById.size > 0;

  const ranked: RankedChunk[] = chunks.map((chunk) => {
    const lexical = lexicalScore(query, chunk.text);
    let semantic = 0;
    if (useSemantic) {
      const v = vecById.get(chunk.id);
      if (v) semantic = Math.max(0, cosine(opts.queryVector as number[], v));
    }
    const score = useSemantic
      ? LEXICAL_WEIGHT * lexical + SEMANTIC_WEIGHT * semantic
      : lexical;
    return { chunk, score, lexical, semantic };
  });

  return ranked
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order);
}

/**
 * Maximal-marginal-relevance selection: pick the best chunk, then repeatedly pick
 * the chunk that is strong AND unlike what is already selected. This is what
 * stops six near-duplicate paragraphs from one page from crowding out the rest of
 * a book. Similarity is term-overlap (deterministic, no vectors required).
 */
export function diversify(ranked: RankedChunk[], k: number, lambda = DIVERSITY_LAMBDA): RankedChunk[] {
  if (ranked.length <= 1) return ranked.slice(0, k);
  const termSets = new Map(ranked.map((r) => [r.chunk.id, new Set(terms(r.chunk.text))]));
  const overlap = (a: string, b: string): number => {
    const sa = termSets.get(a) ?? new Set<string>();
    const sb = termSets.get(b) ?? new Set<string>();
    if (!sa.size || !sb.size) return 0;
    let shared = 0;
    for (const t of sa) if (sb.has(t)) shared++;
    return shared / Math.min(sa.size, sb.size);
  };

  const picked: RankedChunk[] = [ranked[0]];
  const pool = ranked.slice(1);
  while (picked.length < k && pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, overlap(cand.chunk.id, p.chunk.id));
      const val = cand.score - lambda * maxSim;
      // Deterministic tie-break: earlier reading order wins.
      if (val > bestVal || (val === bestVal && cand.chunk.order < pool[bestIdx].chunk.order)) {
        bestVal = val; bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

/** Rank + diversify in one call — the standard evidence selector for Ask. */
export function selectEvidence(query: string, chunks: RetrievalChunk[], opts: HybridOptions = {}): RankedChunk[] {
  const k = opts.k ?? DEFAULT_EVIDENCE_K;
  const ranked = rankChunks(query, chunks, opts);
  if (opts.diversify === false) return ranked.slice(0, k);
  return diversify(ranked, k);
}

/** How many distinct regions of the document the evidence spans (for honesty). */
export function evidenceSpread(picked: RankedChunk[], totalChunks: number): number {
  if (!picked.length || totalChunks === 0) return 0;
  const buckets = new Set(picked.map((p) => Math.floor((p.chunk.order / Math.max(1, totalChunks)) * 5)));
  return buckets.size;
}
