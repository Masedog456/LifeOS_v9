/**
 * Hierarchical document understanding (LIFEOS-049).
 *
 * The bug this replaces: LIFEOS-047's whole-document summary scored every chunk
 * equally in reading order and then filled a single 8,000-character context —
 * so summarizing a 400-page book actually summarized its first four pages, and
 * said nothing about it.
 *
 * The fix is map/reduce, not a bigger prompt:
 *
 *   chunks → PART summaries (one bounded call each) → DOCUMENT synthesis
 *
 * The whole raw document is never sent in one request. Each stage sends only the
 * material for that stage. Every part summary keeps references to the chunks it
 * came from, so the final synthesis still has lineage all the way back to real
 * passages and pages.
 *
 * Provenance rule (§9): a part summary is DERIVED material. It may inform the
 * document synthesis, but it can never be the final citation for a claim — the
 * citations attached to any synthesis always resolve to source passages.
 */

import type { ReadingDocument } from "@/types/mvp";
import { summarize } from "@/lib/aiClient";
import { buildRetrievalChunks, buildDocumentParts, type RetrievalChunk, type DocumentPart } from "@/lib/reading/chunking";
import { terms } from "@/lib/reading/retrieval";

/** Max source characters sent in ONE part-summary request. */
export const PART_CONTEXT_BUDGET = 7000;
/** Max part-summary characters sent in ONE reduce request. */
export const SYNTHESIS_CONTEXT_BUDGET = 7000;

/**
 * Ceiling on parts summarized in one run — a COST bound (one AI call per part),
 * not a statement about how much of a book Conqify can understand.
 *
 * Raised from 40 in LIFEOS-051A. At the measured ~0.5 parts per page, 40 parts
 * stopped covering a whole book at about **81 pages** — so a 300-page book's
 * "whole document" summary saw its first 27%, and a 500-page book its first
 * 24%. That was the real large-book ceiling, and it bit four times earlier than
 * the 600k extraction cap everyone was watching. 240 parts covers roughly a
 * 480-page book in full.
 *
 * Past this ceiling the run no longer takes the FIRST N parts — see
 * `selectParts`. Coverage is always reported honestly either way.
 */
export const MAX_PARTS_PER_RUN = 240;

/**
 * Max reduce levels before we stop folding summaries together. Three levels of
 * ~7,000 characters each is far more than any book reaches in practice; the
 * bound exists so a pathological input cannot loop.
 */
export const MAX_REDUCE_LEVELS = 3;

export interface SourceRefLite {
  documentId: string;
  sectionId: string;
  passageIds: string[];
  pageStart?: number;
  pageEnd?: number;
}

export interface PartSummary {
  partId: string;
  title: string;
  /** True when the title came from the document, not from deterministic grouping. */
  titleFromDocument: boolean;
  summary: string;
  /** Chunks this summary was derived from — lineage back to real source. */
  refs: SourceRefLite[];
  order: number;
  /** Always true: this is AI-derived material, never source text. */
  derived: true;
  source: string;
}

export interface DocumentSynthesis {
  summary: string;
  parts: PartSummary[];
  /** Source refs aggregated from every part that fed the synthesis. */
  refs: SourceRefLite[];
  /** Fraction of the document's parts actually covered (0..1). Honest coverage. */
  coverage: number;
  partsCovered: number;
  partsTotal: number;
  /**
   * How many reduce levels ran (1 = part summaries folded once). More than one
   * means the book needed hierarchical reduction rather than a single pass.
   */
  reduceLevels: number;
  derived: true;
  source: string;
  /** Present when the run was incomplete — plain language. */
  note?: string;
}

const refOf = (c: RetrievalChunk): SourceRefLite => ({
  documentId: c.documentId,
  sectionId: c.sectionId,
  passageIds: c.passageIds,
  pageStart: c.pageStart,
  pageEnd: c.pageEnd,
});

/** Assemble a bounded context from chunks, in reading order. */
export function partContext(chunks: RetrievalChunk[], budget = PART_CONTEXT_BUDGET): string {
  const out: string[] = [];
  let used = 0;
  for (const c of chunks) {
    const label = c.pageStart ? `[p. ${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""}]` : "";
    const block = `${label} ${c.text}`.trim();
    if (used + block.length > budget) break;
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n");
}

/**
 * Choose which parts to summarize when a book exceeds the per-run ceiling.
 *
 * The rule that matters: **spread the selection across the whole work.** The
 * previous implementation was `parts.slice(0, limit)`, which meant a long book's
 * "whole document" summary described its opening chapters and silently knew
 * nothing about its ending — the same first-N failure LIFEOS-049 fixed at the
 * chunk level, still present one layer up (LIFEOS-051A).
 *
 * Evenly samples the range, always keeping the first and last part, and always
 * returns them in reading order. Deterministic: the same book yields the same
 * selection every run, so a re-summary is not a lottery.
 */
export function selectParts<T>(parts: T[], limit: number): T[] {
  if (limit >= parts.length || limit <= 0) return parts.slice();
  if (limit === 1) return [parts[0]];
  const picked: T[] = [];
  const seen = new Set<number>();
  // limit-1 even steps across the full index range guarantees index 0 and the
  // final index are both hit, with the rest distributed between them.
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (parts.length - 1)) / (limit - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(parts[idx]);
  }
  return picked;
}

/**
 * Fold text blocks down to a single summary, adding levels as needed.
 *
 * The reduce stage used to `break` once the accumulated summaries passed
 * `SYNTHESIS_CONTEXT_BUDGET`, silently discarding every later part summary — a
 * second first-N truncation stacked on the first (LIFEOS-051A). Instead of
 * dropping the tail, group the blocks into budget-sized batches, summarize each
 * batch, and repeat on the results until one batch fits.
 *
 * The raw document is still never sent: every level consumes only the previous
 * level's derived summaries. Returns how many levels ran so the caller can say
 * how the synthesis was built.
 */
export async function reduceToOne(
  blocks: string[],
  summarizeFn: (text: string) => Promise<{ result: string; source: string }>,
  budget = SYNTHESIS_CONTEXT_BUDGET,
  maxLevels = MAX_REDUCE_LEVELS,
): Promise<{ summary: string; levels: number; source: string }> {
  let current = blocks.filter((b) => b.trim().length > 0);
  if (current.length === 0) {
    const { result, source } = await summarizeFn(" ");
    return { summary: result, levels: 1, source };
  }

  let levels = 0;
  let source = "mock";
  while (levels < maxLevels) {
    // Group into batches that each fit one request.
    const batches: string[][] = [];
    let cur: string[] = [];
    let used = 0;
    for (const b of current) {
      // A single oversized block still gets its own batch rather than being lost.
      if (cur.length && used + b.length > budget) { batches.push(cur); cur = []; used = 0; }
      cur.push(b);
      used += b.length;
    }
    if (cur.length) batches.push(cur);

    const next: string[] = [];
    for (const batch of batches) {
      const { result, source: s } = await summarizeFn(batch.join("\n\n"));
      next.push(result);
      source = s;
    }
    levels++;
    current = next;
    if (current.length <= 1) break;
  }

  return { summary: current[0] ?? "", levels, source };
}

/** Summarize ONE part from its own chunks. One bounded call. */
export async function summarizePart(
  part: DocumentPart,
  chunks: RetrievalChunk[],
): Promise<PartSummary> {
  const mine = chunks.filter((c) => part.chunkIds.includes(c.id));
  const context = partContext(mine);
  const { result, source } = await summarize(context || " ");
  return {
    partId: part.id,
    title: part.title,
    titleFromDocument: part.fromDocument,
    summary: result,
    refs: mine.map(refOf),
    order: part.order,
    derived: true,
    source,
  };
}

/**
 * Summarize a whole document hierarchically. Every part is summarized from its
 * OWN source, then those summaries (not the raw book) are synthesized.
 *
 * `coverage` reports honestly what fraction of the document the synthesis
 * actually saw — so the UI can say "covers the whole work" only when it does.
 */
export async function synthesizeDocument(
  doc: ReadingDocument,
  opts: { maxParts?: number } = {},
): Promise<DocumentSynthesis> {
  const chunks = buildRetrievalChunks(doc);
  const parts = buildDocumentParts(doc, chunks);
  const limit = Math.min(parts.length, opts.maxParts ?? MAX_PARTS_PER_RUN);
  // MAP: when a book exceeds the run ceiling, sample ACROSS it rather than
  // taking its opening — the end of a book must be representable (LIFEOS-051A).
  const selected = selectParts(parts, limit);

  const partSummaries: PartSummary[] = [];
  for (const part of selected) {
    partSummaries.push(await summarizePart(part, chunks));
  }

  // REDUCE: fold the PART SUMMARIES — never the raw document — adding levels
  // instead of discarding the tail once one request's budget is full.
  const blocks = partSummaries.map((p) => `${p.title}: ${p.summary}`.trim());
  const { summary, levels, source } = await reduceToOne(blocks, summarize);

  const partsCovered = partSummaries.length;
  const partsTotal = parts.length;
  const complete = partsCovered >= partsTotal;
  return {
    summary,
    parts: partSummaries,
    refs: partSummaries.flatMap((p) => p.refs),
    coverage: partsTotal ? partsCovered / partsTotal : 0,
    partsCovered,
    partsTotal,
    reduceLevels: levels,
    derived: true,
    source,
    // Say plainly that the sample is spread, so "24% covered" is not misread as
    // "the first 24%" — the distinction the previous implementation got wrong.
    note: complete
      ? undefined
      : `This covers ${partsCovered} of ${partsTotal} parts, sampled evenly across the whole document (beginning, middle and end included) rather than only its opening.`,
  };
}

// ------------------------------------------------------------ document map ----

export interface DocumentMap {
  /** Structure as understood — real sections, or honest positional parts. */
  parts: { id: string; title: string; fromDocument: boolean; pageStart?: number; pageEnd?: number }[];
  /** Deterministic: most distinctive recurring terms across the whole document. */
  recurringTerms: { term: string; count: number }[];
  /** Deterministic: the densest chunks, as entry points (with real locations). */
  keyPassages: { text: string; ref: SourceRefLite }[];
  totalChunks: number;
  /** Everything here except `parts` titles from the document is derived. */
  derived: true;
}

/**
 * A deterministic, on-device overview of the WHOLE document — no AI, no network.
 * Terms and key passages are derived material and are never auto-saved to
 * Knowledge; the user chooses what (if anything) to keep.
 */
export function buildDocumentMap(doc: ReadingDocument, limit = 10): DocumentMap {
  const chunks = buildRetrievalChunks(doc);
  const parts = buildDocumentParts(doc, chunks);

  const counts = new Map<string, number>();
  for (const c of chunks) for (const t of terms(c.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  // Distinctive = frequent, but not present in nearly every chunk (stopword-ish).
  const ceiling = Math.max(2, Math.floor(chunks.length * 0.75));
  const recurringTerms = [...counts.entries()]
    .filter(([, n]) => n >= 2 && n <= ceiling)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));

  const keyPassages = [...chunks]
    .map((c) => ({ c, weight: new Set(terms(c.text)).size }))
    .sort((a, b) => b.weight - a.weight || a.c.order - b.c.order)
    .slice(0, Math.min(limit, 6))
    .sort((a, b) => a.c.order - b.c.order)
    .map(({ c }) => ({ text: firstSentence(c.text), ref: refOf(c) }));

  return {
    parts: parts.map((p) => ({ id: p.id, title: p.title, fromDocument: p.fromDocument, pageStart: p.pageStart, pageEnd: p.pageEnd })),
    recurringTerms,
    keyPassages,
    totalChunks: chunks.length,
    derived: true,
  };
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim().slice(0, 220);
}
