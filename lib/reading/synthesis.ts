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
/** Max part-summary characters sent in the final synthesis request. */
export const SYNTHESIS_CONTEXT_BUDGET = 7000;
/** Safety ceiling on parts summarized in one run (very long books). */
export const MAX_PARTS_PER_RUN = 40;

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
  const selected = parts.slice(0, limit);

  const partSummaries: PartSummary[] = [];
  for (const part of selected) {
    partSummaries.push(await summarizePart(part, chunks));
  }

  // Reduce: synthesize from the PART SUMMARIES, never the raw document.
  const reduceInput: string[] = [];
  let used = 0;
  for (const p of partSummaries) {
    const block = `${p.title}: ${p.summary}`.trim();
    if (used + block.length > SYNTHESIS_CONTEXT_BUDGET) break;
    reduceInput.push(block);
    used += block.length;
  }
  const { result, source } = await summarize(reduceInput.join("\n\n") || " ");

  const partsCovered = partSummaries.length;
  const partsTotal = parts.length;
  return {
    summary: result,
    parts: partSummaries,
    refs: partSummaries.flatMap((p) => p.refs),
    coverage: partsTotal ? partsCovered / partsTotal : 0,
    partsCovered,
    partsTotal,
    derived: true,
    source,
    note: partsCovered < partsTotal
      ? `This covers ${partsCovered} of ${partsTotal} parts of the document.`
      : undefined,
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
