/**
 * Client-side, page-aware PDF text extraction (LIFEOS-008).
 *
 * Runs in the browser via pdf.js (dynamic import — not in the main bundle).
 * We extract text per page, keep a page → char-range map, and store ONLY
 * the extracted text + metadata — never the binary. Scanned / malformed /
 * password-protected PDFs are detected and reported honestly, never faked.
 */

import type { ExtractionStatus, PageSpan } from "@/types/mvp";
import { normalizeText } from "@/lib/textNormalize";

// ---- limits ----
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB — hosting/upload bound
export const MAX_PAGES = 1500;

/**
 * Character ceiling for one extraction (LIFEOS-051A).
 *
 * This is a **resource** safeguard, not a statement about how long a book may
 * be. It was 600,000, which is roughly 333 pages of ordinary prose — measured,
 * not estimated — so a 500-page book silently lost its last third and a
 * 1,000-page book lost two thirds. The cap is what a browser tab can hold as one
 * JavaScript string during extraction while the rest of the app stays
 * responsive; it is not a claim that Conqify only understands 333 pages.
 *
 * Raised to 4,000,000 (~2,200 pages of prose, comfortably past the 1,500-page
 * `MAX_PAGES` bound, so `MAX_PAGES` now binds first for any realistic book).
 * When it IS hit, extraction still stops honestly and says which page it reached
 * — never silently.
 */
export const MAX_EXTRACT_CHARS = 4_000_000;
const MIN_CHARS_PER_PAGE = 8; // below this ⇒ likely scanned

export interface PdfExtractResult {
  ok: boolean;
  status: ExtractionStatus;
  text: string;
  pageMap: PageSpan[];
  pageCount: number;
  /** Pages we ATTEMPTED to read (== pageMap.length). Not a readability claim. */
  extractedPages: number;
  /** Pages that actually yielded readable text (LIFEOS-049). */
  readablePages: number;
  /** Page numbers that yielded little/no text — image-only or blank (LIFEOS-049). */
  emptyPageNumbers: number[];
  /** True when extraction stopped early (page cap, char cap, or a read error). */
  truncated: boolean;
  /** Why extraction stopped early, when it did. */
  truncationReason?: "page_limit" | "char_limit" | "read_error";
  /** User-facing message (never contains document text). */
  message?: string;
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

function itemsToText(items: PdfTextItem[]): string {
  let out = "";
  for (const it of items) {
    if (typeof it.str !== "string") continue;
    out += it.str;
    out += it.hasEOL ? "\n" : " ";
  }
  return out;
}

function fail(status: ExtractionStatus, message: string): PdfExtractResult {
  return {
    ok: false, status, text: "", pageMap: [], pageCount: 0, extractedPages: 0,
    readablePages: 0, emptyPageNumbers: [], truncated: false, message,
  };
}

export async function extractPdf(file: File): Promise<PdfExtractResult> {
  if (file.type && file.type !== "application/pdf") {
    return fail("extraction_failed", "Not a PDF file.");
  }
  if (file.size > MAX_PDF_BYTES) {
    return fail(
      "extraction_failed",
      `PDF is too large (${Math.round(file.size / 1024 / 1024)} MB; limit ${MAX_PDF_BYTES / 1024 / 1024} MB).`,
    );
  }

  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
  } catch {
    return fail("extraction_failed", "PDF engine failed to load.");
  }

  const data = new Uint8Array(await file.arrayBuffer());
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
    if (name === "PasswordException") {
      return fail("extraction_failed", "This PDF is password-protected.");
    }
    return fail("extraction_failed", "Could not read this PDF (it may be corrupt).");
  }

  const pageCount = doc.numPages;
  const pagesToRead = Math.min(pageCount, MAX_PAGES);
  const pageMap: PageSpan[] = [];
  // Pages that produced no usable text — image-only, blank, or decorative. These
  // ARE recorded in the page map (as zero-width spans) so page provenance stays
  // aligned, but they must never be counted as "readable" (LIFEOS-049).
  const emptyPageNumbers: number[] = [];
  let text = "";
  let truncated = pagesToRead < pageCount;
  let truncationReason: PdfExtractResult["truncationReason"] = truncated ? "page_limit" : undefined;

  try {
    for (let p = 1; p <= pagesToRead; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const seg = normalizeText(itemsToText(content.items as PdfTextItem[]));
      if (seg.trim().length < MIN_CHARS_PER_PAGE) {
        pageMap.push({ page: p, start: text.length, end: text.length });
        emptyPageNumbers.push(p);
        continue;
      }
      if (text.length > 0) text += "\n\n";
      const start = text.length;
      text += seg;
      pageMap.push({ page: p, start, end: text.length });
      if (text.length > MAX_EXTRACT_CHARS) {
        truncated = true;
        truncationReason = "char_limit";
        break;
      }
    }
  } catch {
    // Partial extraction is still useful — keep what we have, and say so.
    truncated = true;
    truncationReason = truncationReason ?? "read_error";
  }
  void doc.cleanup?.();

  const extractedPages = pageMap.length;
  const readablePages = extractedPages - emptyPageNumbers.length;
  const total = text.trim().length;
  // Density is judged over pages that actually carried text — an appendix of
  // plates should not make a readable book look scanned.
  const perPage = readablePages > 0 ? total / readablePages : 0;

  if (total < 20 || readablePages === 0 || perPage < MIN_CHARS_PER_PAGE) {
    return {
      ok: false,
      status: "scanned_ocr_required",
      text: "",
      pageMap: [],
      pageCount,
      extractedPages,
      readablePages: 0,
      emptyPageNumbers,
      truncated,
      truncationReason,
      message: "Little or no selectable text found — this looks like a scanned PDF (OCR required).",
    };
  }

  return {
    ok: true,
    status: truncated ? "partial_text" : "text_extracted",
    text,
    pageMap,
    pageCount,
    extractedPages,
    readablePages,
    emptyPageNumbers,
    truncated,
    truncationReason,
    message: truncated
      ? `Read ${readablePages} of ${pageCount} page(s) before reaching a size limit.`
      : readablePages < pageCount
        ? `${readablePages} of ${pageCount} page(s) contained readable text.`
        : undefined,
  };
}
