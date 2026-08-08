/**
 * Source-grounded document study layer (LIFEOS-047, Features 7 & 9).
 *
 * A restrained AI layer that sits UNDER reading, not over it. The grounding is
 * deterministic and testable; only the prose is produced by the model:
 *
 *   - chunkDocument   : one stable chunk per passage, carrying its real
 *                       {documentId, sectionId, passageId, page} location.
 *   - retrieve        : deterministic lexical ranking of chunks for a question
 *                       (no embeddings required; strictly the user's own doc).
 *   - groundedCitations: source references built from the RETRIEVED chunks'
 *                       real locations — never from the model, so page numbers
 *                       are never invented.
 *   - buildContext    : assembles retrieved chunk text within a char budget so a
 *                       whole book is never sent in one request.
 *
 * Ask/Summarize/Study call the existing `aiClient` seam (which falls back to a
 * deterministic mock when no provider is configured). Citations are attached
 * from the deterministic retrieval, not parsed out of the model's answer.
 */

import type { ReadingDocument, Passage } from "@/types/mvp";
import { askQuestion, summarize } from "@/lib/aiClient";

export interface Chunk {
  documentId: string;
  sectionId: string;
  passageId: string;
  page?: number;
  order: number;
  text: string;
}

export interface SourceRef {
  documentId: string;
  sectionId: string;
  passageId: string;
  page?: number;
  snippet: string;
}

/** Max characters of retrieved source sent to the model per request. */
export const CONTEXT_CHAR_BUDGET = 8000;
/** Default number of chunks retrieved for a question. */
export const DEFAULT_TOP_K = 6;

/** One chunk per passage, in reading order, with its real source location. */
export function chunkDocument(doc: ReadingDocument): Chunk[] {
  const chunks: Chunk[] = [];
  let order = 0;
  for (const section of doc.sections) {
    for (const p of section.passages as Passage[]) {
      const text = (p.text ?? "").trim();
      if (!text) continue;
      chunks.push({ documentId: doc.id, sectionId: section.id, passageId: p.id, page: p.page, order: order++, text });
    }
  }
  return chunks;
}

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "was", "were", "it", "this", "that", "for", "as", "at", "by", "be", "with", "what", "does", "do", "how", "why", "here", "mean", "means"]);
function terms(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t));
}

export interface ScoredChunk { chunk: Chunk; score: number }

/**
 * Deterministic lexical retrieval: score each chunk by how many distinct query
 * terms it contains, weighted by term frequency, with a small boost for exact
 * phrase presence. Ties break by reading order (stable). Returns top-k with a
 * positive score only — an unsupported question yields an empty list.
 */
export function retrieve(query: string, chunks: Chunk[], k = DEFAULT_TOP_K): ScoredChunk[] {
  const q = terms(query);
  if (q.length === 0) return [];
  const phrase = query.toLowerCase().trim();
  const scored = chunks.map((chunk) => {
    const body = chunk.text.toLowerCase();
    let score = 0;
    for (const t of new Set(q)) {
      const occurrences = body.split(t).length - 1;
      if (occurrences > 0) score += 1 + Math.min(occurrences - 1, 3) * 0.25;
    }
    if (phrase.length > 8 && body.includes(phrase)) score += 2;
    return { chunk, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order)
    .slice(0, k);
}

/** Source references from retrieved chunks — real locations only, never invented. */
export function groundedCitations(scored: ScoredChunk[]): SourceRef[] {
  return scored.map(({ chunk }) => ({
    documentId: chunk.documentId,
    sectionId: chunk.sectionId,
    passageId: chunk.passageId,
    page: chunk.page,
    snippet: chunk.text.slice(0, 160).trim(),
  }));
}

/** Assemble retrieved source text within the char budget (whole book never sent). */
export function buildContext(scored: ScoredChunk[], budget = CONTEXT_CHAR_BUDGET): string {
  const parts: string[] = [];
  let used = 0;
  for (const { chunk } of scored) {
    const label = chunk.page ? `[p. ${chunk.page}]` : "";
    const block = `${label} ${chunk.text}`.trim();
    if (used + block.length > budget) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n");
}

export interface GroundedAnswer {
  answer: string;
  citations: SourceRef[];
  grounded: boolean;
  source: string;
}

/**
 * ASK — answer a question strictly from the retrieved source. When the document
 * doesn't support the question (nothing retrieved), we say so honestly and never
 * fall back to general model knowledge presented as document-grounded.
 */
export async function askDocument(doc: ReadingDocument, question: string): Promise<GroundedAnswer> {
  const scored = retrieve(question, chunkDocument(doc));
  if (scored.length === 0) {
    return { answer: "This document doesn't seem to cover that. Try rephrasing, or asking about something in the text.", citations: [], grounded: false, source: "grounded" };
  }
  const context = buildContext(scored);
  const { result, source } = await askQuestion(context, question);
  return { answer: result, citations: groundedCitations(scored), grounded: true, source };
}

export type SummaryScope = "section" | "selection" | "document";

/** Collect the passages in scope, with their source locations, for summarizing. */
export function scopeChunks(doc: ReadingDocument, scope: SummaryScope, opts: { sectionId?: string; selection?: string } = {}): Chunk[] {
  const all = chunkDocument(doc);
  if (scope === "selection") {
    const sel = (opts.selection ?? "").trim();
    if (!sel) return [];
    // Ground a selection to the passages it overlaps (so its summary keeps a home).
    return all.filter((c) => c.text.includes(sel) || sel.includes(c.text.slice(0, 60)));
  }
  if (scope === "section" && opts.sectionId) return all.filter((c) => c.sectionId === opts.sectionId);
  return all;
}

export interface GroundedSummary { summary: string; citations: SourceRef[]; scope: SummaryScope; source: string }

/** SUMMARIZE — derived strictly from the source; never replaces the document. */
export async function summarizeScope(doc: ReadingDocument, scope: SummaryScope, opts: { sectionId?: string; selection?: string } = {}): Promise<GroundedSummary> {
  const chunks = scopeChunks(doc, scope, opts);
  const scored: ScoredChunk[] = chunks.map((chunk) => ({ chunk, score: 1 }));
  const context = buildContext(scored, CONTEXT_CHAR_BUDGET);
  const { result, source } = await summarize(context || " ");
  return { summary: result, citations: groundedCitations(scored).slice(0, 8), scope, source };
}

export interface StudyMaterial {
  keyIdeas: { text: string; ref: SourceRef }[];
  questions: string[];
  flashcards: { front: string; back: string; ref: SourceRef }[];
  generated: true;
}

/**
 * STUDY — deterministic study scaffolding drawn from the source. Key ideas are
 * the most content-dense passages (kept with their source ref); questions and
 * flashcards are generated from those passages. Everything is clearly marked as
 * generated (`generated: true`) and NOTHING here becomes a belief or alters
 * Knowledge — those remain explicit, user-reviewed actions.
 */
export function studyMaterial(doc: ReadingDocument, limit = 6): StudyMaterial {
  const chunks = chunkDocument(doc);
  // "Key ideas" = the densest passages (longest distinct-term content), stable order.
  const ranked = [...chunks]
    .map((chunk) => ({ chunk, weight: new Set(terms(chunk.text)).size }))
    .sort((a, b) => b.weight - a.weight || a.chunk.order - b.chunk.order)
    .slice(0, limit)
    .sort((a, b) => a.chunk.order - b.chunk.order);
  const keyIdeas = ranked.map(({ chunk }) => ({
    text: firstSentence(chunk.text),
    ref: { documentId: chunk.documentId, sectionId: chunk.sectionId, passageId: chunk.passageId, page: chunk.page, snippet: chunk.text.slice(0, 160).trim() },
  }));
  const questions = keyIdeas.map((k) => `What does the document say about "${keyPhrase(k.text)}"?`);
  const flashcards = keyIdeas.map((k) => ({ front: `Explain: ${keyPhrase(k.text)}`, back: k.text, ref: k.ref }));
  return { keyIdeas, questions, flashcards, generated: true };
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim().slice(0, 200);
}
function keyPhrase(text: string): string {
  const t = terms(text);
  return (t.slice(0, 3).join(" ") || text.slice(0, 40)).trim();
}
