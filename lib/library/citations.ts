/**
 * Citation system (LIFEOS-028, Features 7 & 13).
 *
 * A Citation is the canonical, reusable answer to "where did this come from?".
 * Every knowledge record generated from a document carries one, pointing back to
 * the exact document / section / page / passage / highlight. Helpers here build
 * a citation from a reading location, format it for display, resolve the link
 * that returns the reader to that location, and look citations up in both
 * directions. Deterministic; no storage (the store owns the citations array).
 */

import type { Citation, DocumentSection, Highlight, Passage, ReadingDocument, StoreState } from "@/types/mvp";

export interface CitationTarget {
  section?: DocumentSection;
  passage?: Passage;
  highlight?: Highlight;
}

/** Build a Citation for a record from a document location. `at`/`id` injected. */
export function makeCitation(
  doc: ReadingDocument,
  target: CitationTarget,
  record: { kind: string; id: string },
  ctx: { id: () => string; now: () => string },
): Citation {
  return {
    id: ctx.id(),
    recordKind: record.kind,
    recordId: record.id,
    documentId: doc.id,
    documentTitle: doc.title,
    author: doc.authors[0],
    sectionId: target.section?.id,
    sectionTitle: target.section?.title,
    page: target.passage?.page,
    passageId: target.passage?.id,
    location: target.passage?.location,
    highlightId: target.highlight?.id,
    createdAt: ctx.now(),
  };
}

/** Human-readable citation, e.g. "Author — *Title*, Section (p. 42)". */
export function formatCitation(c: Citation): string {
  const parts: string[] = [];
  if (c.author) parts.push(c.author);
  parts.push(c.documentTitle);
  const loc: string[] = [];
  if (c.sectionTitle) loc.push(c.sectionTitle);
  if (typeof c.page === "number") loc.push(`p. ${c.page}`);
  else if (c.location) loc.push(c.location);
  const tail = loc.length ? ` — ${loc.join(", ")}` : "";
  return `${parts.join(" — ")}${tail}`;
}

/** The route that returns the user to the cited location in the reader. */
export function citationHref(c: Citation): string {
  const q = new URLSearchParams();
  if (c.passageId) q.set("passage", c.passageId);
  if (c.highlightId) q.set("highlight", c.highlightId);
  const qs = q.toString();
  return `/document/${c.documentId}${qs ? `?${qs}` : ""}`;
}

/** All citations for a given knowledge record (record → source). */
export function citationsForRecord(state: StoreState, kind: string, id: string): Citation[] {
  return state.citations.filter((c) => c.recordKind === kind && c.recordId === id);
}

/** The primary citation for a record, if any. */
export function primaryCitation(state: StoreState, kind: string, id: string): Citation | undefined {
  return citationsForRecord(state, kind, id)[0];
}

/** Citations that point into a given document (source → records). */
export function citationsForDocument(state: StoreState, documentId: string): Citation[] {
  return state.citations.filter((c) => c.documentId === documentId);
}

/** Refresh a citation's cached title/section from the live store (rename-safe). */
export function reconcileCitation(state: StoreState, c: Citation): Citation {
  const doc = state.documents.find((d) => d.id === c.documentId);
  if (!doc) return c;
  const section = c.sectionId ? doc.sections.find((s) => s.id === c.sectionId) : undefined;
  return { ...c, documentTitle: doc.title, author: doc.authors[0] ?? c.author, sectionTitle: section?.title ?? c.sectionTitle };
}
