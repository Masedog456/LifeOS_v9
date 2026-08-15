/**
 * Retrieval chunk layer (LIFEOS-049).
 *
 * LIFEOS-047 used one chunk per passage. For a paragraph that is fine; for a
 * book it is wrong in both directions — a one-line paragraph carries no context,
 * and 800 tiny chunks make ranking noisy. This module builds a SEPARATE,
 * stable retrieval layer on top of the same passages:
 *
 *   passages (what the Reader displays)  →  chunks (what retrieval ranks)
 *
 * Reader display structure is untouched. Every chunk maps back to the real
 * document, section, the passage ids it covers, and its page range, so citations
 * still resolve to genuine source locations — never to a chunk.
 *
 * Everything here is pure and deterministic: the same document always produces
 * the same chunks with the same ids, which is what makes the semantic index
 * resumable and safely cacheable.
 */

import type { ReadingDocument, Passage } from "@/types/mvp";

/** ~4 chars/token is the usual English approximation; we stay conservative. */
export const CHARS_PER_TOKEN = 4;
/** Target chunk size ≈ 750 tokens; hard ceiling ≈ 1000 tokens. */
export const TARGET_CHUNK_CHARS = 3000;
export const MAX_CHUNK_CHARS = 4000;
/** ~12% overlap: enough to keep an idea that straddles a boundary retrievable. */
export const CHUNK_OVERLAP_CHARS = 360;

export interface RetrievalChunk {
  /** Stable, deterministic id: `<documentId>:c<ordinal>`. */
  id: string;
  documentId: string;
  /** The section this chunk starts in (chunks never span sections). */
  sectionId: string;
  sectionTitle: string;
  /** Every passage id whose text contributed to this chunk. */
  passageIds: string[];
  /** First page seen in this chunk, when page provenance exists. */
  pageStart?: number;
  /** Last page seen in this chunk. */
  pageEnd?: number;
  /** Reading order across the whole document, 0-based. */
  order: number;
  text: string;
  /** Character length, precomputed for budgeting. */
  chars: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Build stable retrieval chunks for a document. Passages are packed in reading
 * order up to the target size; a passage larger than the ceiling is split on
 * sentence boundaries where possible. Chunks never cross a section boundary, so
 * section-level summarization can group them without re-deriving anything.
 */
export function buildRetrievalChunks(doc: ReadingDocument): RetrievalChunk[] {
  const chunks: RetrievalChunk[] = [];
  let order = 0;

  const push = (sectionId: string, sectionTitle: string, parts: { text: string; p: Passage }[]) => {
    if (!parts.length) return;
    const text = norm(parts.map((x) => x.text).join("\n\n"));
    if (!text) return;
    const pages = parts.map((x) => x.p.page).filter((n): n is number => typeof n === "number");
    chunks.push({
      id: `${doc.id}:c${order}`,
      documentId: doc.id,
      sectionId,
      sectionTitle,
      passageIds: [...new Set(parts.map((x) => x.p.id))],
      pageStart: pages.length ? Math.min(...pages) : undefined,
      pageEnd: pages.length ? Math.max(...pages) : undefined,
      order,
      text,
      chars: text.length,
    });
    order += 1;
  };

  for (const section of doc.sections) {
    let buf: { text: string; p: Passage }[] = [];
    let bufChars = 0;

    const flush = () => {
      if (!buf.length) return;
      push(section.id, section.title, buf);
      // Carry a short tail forward so an idea split across the boundary is still
      // retrievable from the next chunk.
      const tail = buf[buf.length - 1];
      const tailText = tail.text.slice(-CHUNK_OVERLAP_CHARS);
      buf = tailText.trim() ? [{ text: tailText, p: tail.p }] : [];
      bufChars = buf.length ? buf[0].text.length : 0;
    };

    for (const p of section.passages as Passage[]) {
      const text = norm(p.text ?? "");
      if (!text) continue;

      // A single oversized passage is split deterministically on sentence ends.
      if (text.length > MAX_CHUNK_CHARS) {
        flush();
        if (buf.length) { push(section.id, section.title, buf); buf = []; bufChars = 0; }
        for (const piece of splitLong(text)) push(section.id, section.title, [{ text: piece, p }]);
        continue;
      }

      if (bufChars + text.length > TARGET_CHUNK_CHARS && bufChars > 0) flush();
      buf.push({ text, p });
      bufChars += text.length + 2;
    }
    if (buf.length) { push(section.id, section.title, buf); buf = []; bufChars = 0; }
  }
  return chunks;
}

/** Split an oversized passage on sentence boundaries, falling back to hard cuts. */
function splitLong(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > TARGET_CHUNK_CHARS && cur) { out.push(cur.trim()); cur = ""; }
    if (s.length > MAX_CHUNK_CHARS) {
      for (let i = 0; i < s.length; i += TARGET_CHUNK_CHARS) out.push(s.slice(i, i + TARGET_CHUNK_CHARS).trim());
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ------------------------------------------------------------- structure ----

/**
 * A group of chunks understood together. When a document has real sections
 * (Markdown headings), those are used verbatim. When it does not — which is the
 * case for every PDF today, since the plain parser produces a single "Body"
 * section — chunks are grouped into deterministic, honestly-labelled PARTS.
 * We never invent chapter titles.
 */
export interface DocumentPart {
  id: string;
  /** Real section title, or an honest positional label like "Part 3 of 12". */
  title: string;
  /** True when the title came from the document itself, not from grouping. */
  fromDocument: boolean;
  chunkIds: string[];
  pageStart?: number;
  pageEnd?: number;
  order: number;
}

/**
 * Source characters a single part may contain. Parts are grouped by CHARACTER
 * BUDGET, not a fixed chunk count: a part must fit entirely inside one bounded
 * summarization request, otherwise the tail of each part would be silently
 * dropped when its context is assembled — which is precisely the class of bug
 * LIFEOS-049 exists to remove. Kept just under the summarizer's context budget
 * to leave room for page labels and separators.
 */
export const PART_SOURCE_BUDGET = 6200;
/** Hard cap on chunks per part, so a document of tiny chunks still splits. */
export const MAX_CHUNKS_PER_PART = 12;

/** True when the document carries usable structure of its own. */
export function hasRealSections(doc: ReadingDocument): boolean {
  const titled = doc.sections.filter((s) => s.title && s.title !== "Body");
  return doc.sections.length > 1 && titled.length > 0;
}

/**
 * Group chunks into parts for hierarchical understanding. Deterministic: the
 * same chunks always yield the same parts.
 */
export function buildDocumentParts(doc: ReadingDocument, chunks: RetrievalChunk[]): DocumentPart[] {
  const parts: DocumentPart[] = [];
  const pageBounds = (group: RetrievalChunk[]) => {
    const starts = group.map((c) => c.pageStart).filter((n): n is number => typeof n === "number");
    const ends = group.map((c) => c.pageEnd).filter((n): n is number => typeof n === "number");
    return { pageStart: starts.length ? Math.min(...starts) : undefined, pageEnd: ends.length ? Math.max(...ends) : undefined };
  };

  if (hasRealSections(doc)) {
    for (const section of doc.sections) {
      const group = chunks.filter((c) => c.sectionId === section.id);
      if (!group.length) continue;
      parts.push({
        id: section.id,
        title: section.title,
        fromDocument: true,
        chunkIds: group.map((c) => c.id),
        ...pageBounds(group),
        order: parts.length,
      });
    }
    return parts;
  }

  // No usable structure: budget-sized groups in reading order, labelled honestly.
  const groups: RetrievalChunk[][] = [];
  let cur: RetrievalChunk[] = [];
  let curChars = 0;
  for (const c of chunks) {
    if (cur.length && (curChars + c.chars > PART_SOURCE_BUDGET || cur.length >= MAX_CHUNKS_PER_PART)) {
      groups.push(cur); cur = []; curChars = 0;
    }
    cur.push(c);
    curChars += c.chars;
  }
  if (cur.length) groups.push(cur);

  const total = Math.max(1, groups.length);
  for (const group of groups) {
    const order = parts.length;
    const bounds = pageBounds(group);
    const pageLabel = bounds.pageStart != null && bounds.pageEnd != null
      ? ` (pp. ${bounds.pageStart}–${bounds.pageEnd})`
      : "";
    parts.push({
      id: `${doc.id}:p${order}`,
      title: `Part ${order + 1} of ${total}${pageLabel}`,
      fromDocument: false,
      chunkIds: group.map((c) => c.id),
      ...bounds,
      order,
    });
  }
  return parts;
}
