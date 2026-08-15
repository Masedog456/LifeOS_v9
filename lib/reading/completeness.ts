/**
 * Ingestion completeness accounting (LIFEOS-049).
 *
 * Answers one question honestly: **"did we actually import the whole readable
 * document?"** Everything here is pure and deterministic — it counts what was
 * really extracted and never infers, rounds up, or calls a document "complete"
 * merely because extraction returned *some* text.
 *
 * The report is persisted additively on `ReadingDocument.sourceMetadata` (jsonb —
 * no migration) so the Reader can show it later, and so a document imported
 * before this sprint simply has no report rather than a fabricated one.
 */

import type { PageSpan } from "@/types/mvp";

/** Contiguous run of pages that yielded no readable text, e.g. 41–55. */
export interface PageRange { from: number; to: number }

export type CompletenessLevel = "complete" | "partial" | "unknown";

export interface IngestionReport {
  /** Pages in the source PDF (0 for pasted/linked text). */
  pageCount: number;
  /** Pages we attempted to read (may be < pageCount if a limit was hit). */
  attemptedPages: number;
  /** Pages that actually produced readable text. */
  readablePages: number;
  /** Page ranges with little/no readable text (image-only, blank, plates). */
  unreadableRanges: PageRange[];
  characters: number;
  words: number;
  passages: number;
  /** Retrieval chunks derived from the document (LIFEOS-049 chunk layer). */
  chunks: number;
  /** Sections/parts the document is understood in. */
  sections: number;
  /** True when extraction stopped early (size/page cap or a read error). */
  truncated: boolean;
  truncationReason?: "page_limit" | "char_limit" | "read_error";
  /** Honest overall judgement — never "complete" unless every page was read. */
  extraction: CompletenessLevel;
  /** Human-readable warnings (never contain document text). */
  warnings: string[];
  generatedAt: string;
}

/** Collapse sorted page numbers into contiguous ranges: [3,4,5,9] → 3–5, 9–9. */
export function toRanges(pages: number[]): PageRange[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: PageRange[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p === last.to + 1) last.to = p;
    else out.push({ from: p, to: p });
  }
  return out;
}

/** Deterministic word count over extracted text. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface ReportInput {
  pageCount: number;
  attemptedPages: number;
  readablePages: number;
  emptyPageNumbers: number[];
  text: string;
  passages: number;
  chunks: number;
  sections: number;
  truncated: boolean;
  truncationReason?: IngestionReport["truncationReason"];
  now: string;
}

/**
 * Build the completeness report. The `extraction` verdict is deliberately
 * conservative:
 *   - "complete"  only when nothing was truncated AND every page was readable;
 *   - "partial"   when pages were skipped, unreadable, or a limit was hit;
 *   - "unknown"   when there is no page information at all (pasted text/links).
 */
export function buildIngestionReport(input: ReportInput): IngestionReport {
  const unreadableRanges = toRanges(input.emptyPageNumbers);
  const warnings: string[] = [];

  if (input.truncated) {
    warnings.push(
      input.truncationReason === "char_limit"
        ? "This document is very long; reading stopped at the size limit, so the end may be missing."
        : input.truncationReason === "page_limit"
          ? "This document has more pages than we can read in one go, so the end may be missing."
          : "Reading stopped early because part of the file could not be read.",
    );
  }
  if (unreadableRanges.length > 0) {
    warnings.push("Some pages contained no readable text — they may be scans or images.");
  }

  let extraction: CompletenessLevel;
  if (input.pageCount <= 0) extraction = "unknown";
  else if (!input.truncated && input.readablePages === input.pageCount) extraction = "complete";
  else extraction = "partial";

  return {
    pageCount: input.pageCount,
    attemptedPages: input.attemptedPages,
    readablePages: input.readablePages,
    unreadableRanges,
    characters: input.text.length,
    words: wordCount(input.text),
    passages: input.passages,
    chunks: input.chunks,
    sections: input.sections,
    truncated: input.truncated,
    truncationReason: input.truncationReason,
    extraction,
    warnings,
    generatedAt: input.now,
  };
}

/** A short, plain-language headline for the Reader — no jargon, no fabrication. */
export function completenessHeadline(r: IngestionReport): string {
  if (r.extraction === "unknown") return `${r.words.toLocaleString()} words imported.`;
  if (r.extraction === "complete") {
    return `All ${r.pageCount} page${r.pageCount === 1 ? "" : "s"} contained readable text.`;
  }
  const parts = [`${r.readablePages} of ${r.pageCount} pages contained readable text.`];
  if (r.unreadableRanges.length) {
    const shown = r.unreadableRanges.slice(0, 3)
      .map((x) => (x.from === x.to ? `${x.from}` : `${x.from}–${x.to}`))
      .join(", ");
    const more = r.unreadableRanges.length > 3 ? ` and ${r.unreadableRanges.length - 3} more` : "";
    parts.push(`Page${r.unreadableRanges.length === 1 && r.unreadableRanges[0].from === r.unreadableRanges[0].to ? "" : "s"} ${shown}${more} appear to be scans or images.`);
  }
  return parts.join(" ");
}

/** Whether the page map itself indicates real page provenance is available. */
export function hasPageProvenance(pageMap: PageSpan[] | undefined): boolean {
  return !!pageMap && pageMap.length > 0;
}
