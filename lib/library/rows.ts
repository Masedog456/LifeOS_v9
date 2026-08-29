/**
 * Reading persistence row mapping (LIFEOS-028 amendment).
 *
 * Pure, deterministic conversions between the nested `ReadingDocument` model and
 * the FLAT, normalized rows of the 0021 reading tables — plus the incremental
 * diff (which rows to upsert, which ids to delete) the Supabase adapter uses so
 * editing one annotation never rewrites the whole library. No store, no network,
 * no AI — all unit-tested. Rows omit `user_id`; the DB defaults it to
 * `auth.uid()` on insert (and RLS `with check` enforces ownership).
 */

import type {
  Annotation, Citation, DocumentSection, Highlight, Passage, ReadingDocument, ReadingProgress,
} from "@/types/mvp";

export interface DocumentRow { id: string; title: string; subtitle: string | null; authors: string[]; publication: string | null; publication_date: string | null; language: string | null; description: string | null; kind: string; status: string; rating: number | null; cover_color: string | null; tags: string[]; notes: string; source_metadata: unknown; progress: ReadingProgress; created_at: string; updated_at: string }
export interface SectionRow { id: string; document_id: string; title: string; order: number; note: string | null; updated_at: string }
export interface PassageRow { id: string; document_id: string; section_id: string; heading: string | null; text: string; page: number | null; location: string | null; order: number; linked: unknown; updated_at: string }
export interface HighlightRow { id: string; document_id: string; passage_id: string; color: string; text: string; start_offset: number; end_offset: number; note: string | null; linked: unknown; updated_at: string }
export interface AnnotationRow { id: string; document_id: string; passage_id: string; text: string; updated_at: string }
export interface CitationRow { id: string; document_id: string; passage_id: string | null; highlight_id: string | null; section_id: string | null; record_kind: string; record_id: string; page: number | null; location: string | null; created_at: string }

export interface ReadingRowSet {
  documents: DocumentRow[];
  sections: SectionRow[];
  passages: PassageRow[];
  highlights: HighlightRow[];
  annotations: AnnotationRow[];
}

// ------------------------------------------------------------- model → rows ----

/**
 * The document's provenance as it should be STORED REMOTELY (LIFEOS-075 C-5).
 *
 * `originalBackup: "uploading" | "failed"` is not a fact about the document; it
 * is a fact about one browser tab that is holding a `File` in memory right now.
 * Because it lived in the same `source_metadata` blob as durable provenance, it
 * synced — so a second device could show "Uploading original…" indefinitely for
 * an upload happening (or long dead) elsewhere, next to a Retry button with no
 * file to retry. Durable facts (`originalStored`, `originalStoragePath`,
 * `originalFileId`, `contentHash`, filename/MIME/size) are untouched; only the
 * in-flight words are dropped on the way out.
 *
 * `"stored"` is kept: it agrees with `originalStored` and describes a settled
 * outcome rather than an operation in progress.
 */
function remoteSourceMetadata(meta: ReadingDocument["sourceMetadata"]): ReadingDocument["sourceMetadata"] {
  const b = meta?.originalBackup;
  if (b !== "uploading" && b !== "failed") return meta;
  const rest = { ...meta };
  delete rest.originalBackup;
  return rest;
}

export function documentToRows(doc: ReadingDocument): ReadingRowSet {
  const documents: DocumentRow[] = [{
    id: doc.id, title: doc.title, subtitle: doc.subtitle ?? null, authors: doc.authors,
    publication: doc.publication ?? null, publication_date: doc.publicationDate ?? null,
    language: doc.language ?? null, description: doc.description ?? null, kind: doc.kind, status: doc.status,
    rating: doc.rating ?? null, cover_color: doc.coverColor ?? null, tags: doc.tags, notes: doc.notes,
    source_metadata: remoteSourceMetadata(doc.sourceMetadata), progress: doc.progress, created_at: doc.createdAt, updated_at: doc.updatedAt,
  }];
  const sections: SectionRow[] = [];
  const passages: PassageRow[] = [];
  const highlights: HighlightRow[] = [];
  const annotations: AnnotationRow[] = [];
  for (const s of doc.sections) {
    sections.push({ id: s.id, document_id: doc.id, title: s.title, order: s.order, note: s.note ?? null, updated_at: doc.updatedAt });
    for (const p of s.passages) {
      passages.push({ id: p.id, document_id: doc.id, section_id: s.id, heading: p.heading ?? null, text: p.text, page: p.page ?? null, location: p.location ?? null, order: p.order, linked: p.linked, updated_at: doc.updatedAt });
      for (const h of p.highlights) highlights.push({ id: h.id, document_id: doc.id, passage_id: p.id, color: h.color, text: h.text, start_offset: h.start, end_offset: h.end, note: h.note ?? null, linked: h.linked, updated_at: h.updatedAt });
      for (const a of p.annotations) annotations.push({ id: a.id, document_id: doc.id, passage_id: p.id, text: a.text, updated_at: a.updatedAt });
    }
  }
  return { documents, sections, passages, highlights, annotations };
}

export function allDocumentRows(docs: ReadingDocument[]): ReadingRowSet {
  const out: ReadingRowSet = { documents: [], sections: [], passages: [], highlights: [], annotations: [] };
  for (const d of docs) {
    const r = documentToRows(d);
    out.documents.push(...r.documents); out.sections.push(...r.sections); out.passages.push(...r.passages);
    out.highlights.push(...r.highlights); out.annotations.push(...r.annotations);
  }
  return out;
}

export function citationToRow(c: Citation): CitationRow {
  return { id: c.id, document_id: c.documentId, passage_id: c.passageId ?? null, highlight_id: c.highlightId ?? null, section_id: c.sectionId ?? null, record_kind: c.recordKind, record_id: c.recordId, page: c.page ?? null, location: c.location ?? null, created_at: c.createdAt };
}

/** The jsonb payload for the atomic `import_reading_document` RPC (new imports). */
export function documentToImportPayload(doc: ReadingDocument): Record<string, unknown> {
  const r = documentToRows(doc);
  return {
    document: { ...r.documents[0], created_at: doc.createdAt, updated_at: doc.updatedAt },
    sections: r.sections,
    passages: r.passages,
    highlights: r.highlights,
    annotations: r.annotations,
  };
}

// ------------------------------------------------------------- rows → model ----

const asArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Rebuild nested documents from flat rows (remote hydration). Deterministic. */
export function rowsToDocuments(
  documents: DocumentRow[], sections: SectionRow[], passages: PassageRow[], highlights: HighlightRow[], annotations: AnnotationRow[],
): ReadingDocument[] {
  const hlByPassage = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const arr = hlByPassage.get(h.passage_id) ?? [];
    arr.push({ id: h.id, passageId: h.passage_id, color: h.color as Highlight["color"], text: h.text, start: h.start_offset, end: h.end_offset, note: h.note ?? undefined, linked: asArr(h.linked), createdAt: h.updated_at, updatedAt: h.updated_at });
    hlByPassage.set(h.passage_id, arr);
  }
  const anByPassage = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const arr = anByPassage.get(a.passage_id) ?? [];
    arr.push({ id: a.id, passageId: a.passage_id, text: a.text, createdAt: a.updated_at, updatedAt: a.updated_at });
    anByPassage.set(a.passage_id, arr);
  }
  const paBySection = new Map<string, Passage[]>();
  for (const p of [...passages].sort((x, y) => x.order - y.order)) {
    const arr = paBySection.get(p.section_id) ?? [];
    arr.push({ id: p.id, sectionId: p.section_id, heading: p.heading ?? undefined, text: p.text, page: p.page ?? undefined, location: p.location ?? undefined, order: p.order, highlights: hlByPassage.get(p.id) ?? [], annotations: anByPassage.get(p.id) ?? [], linked: asArr(p.linked) });
    paBySection.set(p.section_id, arr);
  }
  const secByDoc = new Map<string, DocumentSection[]>();
  for (const s of [...sections].sort((x, y) => x.order - y.order)) {
    const arr = secByDoc.get(s.document_id) ?? [];
    arr.push({ id: s.id, title: s.title, order: s.order, passages: paBySection.get(s.id) ?? [], note: s.note ?? undefined });
    secByDoc.set(s.document_id, arr);
  }
  return documents.map((d): ReadingDocument => ({
    id: d.id, title: d.title, subtitle: d.subtitle ?? undefined, authors: asArr<string>(d.authors),
    publication: d.publication ?? undefined, publicationDate: d.publication_date ?? undefined,
    language: d.language ?? undefined, description: d.description ?? undefined,
    kind: d.kind as ReadingDocument["kind"], status: d.status as ReadingDocument["status"],
    rating: d.rating ?? undefined, coverColor: d.cover_color ?? undefined, tags: asArr<string>(d.tags), notes: d.notes ?? "",
    sections: secByDoc.get(d.id) ?? [],
    progress: normalizeProgress(d.progress),
    sourceMetadata: (d.source_metadata && typeof d.source_metadata === "object" ? d.source_metadata : { importFormat: "plain" }) as ReadingDocument["sourceMetadata"],
    createdAt: d.created_at, updatedAt: d.updated_at,
  }));
}

function normalizeProgress(p: unknown): ReadingProgress {
  const o = (p && typeof p === "object" ? p : {}) as Partial<ReadingProgress>;
  return { status: o.status ?? "not_started", percent: o.percent ?? 0, currentSectionId: o.currentSectionId, currentPassageId: o.currentPassageId, readPassageIds: asArr<string>(o.readPassageIds), lastOpenedAt: o.lastOpenedAt, startedAt: o.startedAt, finishedAt: o.finishedAt };
}

// -------------------------------------------------------------------- diff ----

export interface Diff<T> { upsert: T[]; deleteIds: string[] }

/** Incremental diff by id + deep JSON equality. Stable, order-independent. */
export function diffById<T extends { id: string }>(current: T[], base: T[]): Diff<T> {
  const baseMap = new Map(base.map((r) => [r.id, JSON.stringify(r)]));
  const currentIds = new Set(current.map((r) => r.id));
  const upsert = current.filter((r) => baseMap.get(r.id) !== JSON.stringify(r));
  const deleteIds = base.filter((r) => !currentIds.has(r.id)).map((r) => r.id);
  return { upsert, deleteIds };
}

/** Documents that are brand-new vs base (candidates for the atomic import RPC). */
export function newDocumentIds(current: ReadingDocument[], base: ReadingDocument[]): Set<string> {
  const baseIds = new Set(base.map((d) => d.id));
  return new Set(current.filter((d) => !baseIds.has(d.id)).map((d) => d.id));
}
