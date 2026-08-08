/**
 * Document assembly & library projections (LIFEOS-028).
 *
 * Pure helpers that turn parsed input into a canonical ReadingDocument and
 * derive the reading dashboard (currently reading, unread, completed, recent
 * highlights/notes, continue reading) and the author projection — all
 * deterministic read-only views over the store. No AI, no storage here (the
 * store owns mutations); these are the testable building blocks.
 */

import type {
  Annotation, Highlight, Passage, ReadingDocument, ReadingStatus, StoreState,
} from "@/types/mvp";
import { parseInput, passageCount as parsedPassageCount, type DocumentParser } from "@/lib/library/importer";

export interface NewDocumentInput {
  title: string;
  subtitle?: string;
  authors?: string[];
  publication?: string;
  publicationDate?: string;
  language?: string;
  description?: string;
  kind?: ReadingDocument["kind"];
  tags?: string[];
  rating?: number;
  notes?: string;
  content: string;
  format?: DocumentParser["format"];
}

export interface IdClock { id: () => string; now: () => string }

const COVER_TINTS = ["#fca5a5", "#fdba74", "#fcd34d", "#86efac", "#67e8f9", "#93c5fd", "#c4b5fd", "#f9a8d4"];
/** A deterministic placeholder cover tint from the title (no image storage). */
export function coverTint(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return COVER_TINTS[h % COVER_TINTS.length];
}

/** Normalize an author name for de-duplication (case/space-insensitive). */
export function normalizeAuthor(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Assemble a canonical ReadingDocument from new-document input. Deterministic. */
export function assembleDocument(input: NewDocumentInput, ctx: IdClock): ReadingDocument {
  const at = ctx.now();
  const { parsed, format } = parseInput(input.content, input.format);
  const sections = parsed.sections.map((s, si) => {
    const sectionId = ctx.id();
    return {
      id: sectionId,
      title: s.title || `Section ${si + 1}`,
      order: si,
      passages: s.passages.map((p, pi): Passage => ({
        id: ctx.id(),
        sectionId,
        heading: p.heading,
        text: p.text,
        page: p.page,
        location: p.location,
        order: pi,
        highlights: [],
        annotations: [],
        linked: [],
      })),
    };
  });
  // De-dupe author names (case-insensitive), keep first spelling.
  const seenAuthors = new Set<string>();
  const authors = (input.authors ?? []).map((a) => a.trim()).filter((a) => {
    if (!a) return false;
    const key = normalizeAuthor(a);
    if (seenAuthors.has(key)) return false;
    seenAuthors.add(key);
    return true;
  });

  const firstPassage = sections.find((s) => s.passages.length > 0)?.passages[0];
  return {
    id: ctx.id(),
    title: input.title.trim() || "Untitled document",
    subtitle: input.subtitle?.trim() || undefined,
    authors,
    publication: input.publication?.trim() || undefined,
    publicationDate: input.publicationDate?.trim() || undefined,
    language: input.language?.trim() || undefined,
    description: input.description?.trim() || undefined,
    kind: input.kind ?? "book",
    status: "not_started",
    rating: input.rating,
    coverColor: coverTint(input.title || "Untitled"),
    tags: input.tags ?? [],
    notes: input.notes ?? "",
    sections,
    progress: { status: "not_started", percent: 0, readPassageIds: [], currentSectionId: sections[0]?.id, currentPassageId: firstPassage?.id },
    sourceMetadata: { importFormat: format, originalLength: input.content.length },
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Assemble a canonical ReadingDocument from an ALREADY-PARSED structure
 * (LIFEOS-047) — used by upload ingestion so per-passage page provenance from a
 * PDF is preserved (the string-based `assembleDocument` re-parses and would lose
 * it). Same ReadingDocument output; not a parallel model.
 */
export function assembleDocumentFromParsed(
  input: { title: string; authors?: string[]; kind?: ReadingDocument["kind"]; notes?: string; tags?: string[]; sourceMetadata: ReadingDocument["sourceMetadata"] },
  parsed: { sections: { title: string; passages: { heading?: string; text: string; page?: number; location?: string }[] }[] },
  ctx: IdClock,
): ReadingDocument {
  const at = ctx.now();
  const sections = parsed.sections.map((s, si) => {
    const sectionId = ctx.id();
    return {
      id: sectionId,
      title: s.title || `Section ${si + 1}`,
      order: si,
      passages: s.passages.map((p, pi): Passage => ({
        id: ctx.id(), sectionId, heading: p.heading, text: p.text, page: p.page, location: p.location,
        order: pi, highlights: [], annotations: [], linked: [],
      })),
    };
  });
  const seenAuthors = new Set<string>();
  const authors = (input.authors ?? []).map((a) => a.trim()).filter((a) => {
    if (!a) return false; const key = normalizeAuthor(a); if (seenAuthors.has(key)) return false; seenAuthors.add(key); return true;
  });
  const firstPassage = sections.find((s) => s.passages.length > 0)?.passages[0];
  return {
    id: ctx.id(),
    title: input.title.trim() || "Untitled document",
    authors,
    kind: input.kind ?? "book",
    status: "not_started",
    coverColor: coverTint(input.title || "Untitled"),
    tags: input.tags ?? [],
    notes: input.notes ?? "",
    sections,
    progress: { status: "not_started", percent: 0, readPassageIds: [], currentSectionId: sections[0]?.id, currentPassageId: firstPassage?.id },
    sourceMetadata: input.sourceMetadata,
    createdAt: at,
    updatedAt: at,
  };
}

/** Flatten a document's passages in reading order. */
export function allPassages(doc: ReadingDocument): Passage[] {
  return doc.sections.flatMap((s) => s.passages);
}

export interface DocumentStats { sections: number; passages: number; highlights: number; annotations: number; words: number; linked: number }
export function documentStats(doc: ReadingDocument): DocumentStats {
  let highlights = 0, annotations = 0, words = 0, linked = 0;
  for (const s of doc.sections) for (const p of s.passages) {
    highlights += p.highlights.length;
    annotations += p.annotations.length;
    linked += p.linked.length;
    words += p.text.trim() ? p.text.trim().split(/\s+/).length : 0;
  }
  return { sections: doc.sections.length, passages: allPassages(doc).length, highlights, annotations, words, linked };
}

export function parsedPassages(content: string, format?: DocumentParser["format"]): number {
  return parsedPassageCount(parseInput(content, format).parsed);
}

// ---------------------------------------------------------------- dashboard ----

export interface RecentHighlight extends Highlight { documentId: string; documentTitle: string }
export interface RecentAnnotation extends Annotation { documentId: string; documentTitle: string }

export interface ReadingDashboard {
  currentlyReading: ReadingDocument[];
  continueReading: ReadingDocument[];
  unread: ReadingDocument[];
  completed: ReadingDocument[];
  recentlyRead: ReadingDocument[];
  recentHighlights: RecentHighlight[];
  recentAnnotations: RecentAnnotation[];
  streakDays: number;
  total: number;
}

const byUpdatedDesc = (a: ReadingDocument, b: ReadingDocument) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
const lastOpened = (d: ReadingDocument) => d.progress.lastOpenedAt ?? d.updatedAt;

/** Deterministic reading streak: consecutive days (ending today) with any doc opened. */
export function readingStreak(docs: ReadingDocument[], now = Date.now()): number {
  const days = new Set<string>();
  for (const d of docs) {
    const t = d.progress.lastOpenedAt;
    if (t && !Number.isNaN(Date.parse(t))) days.add(new Date(t).toISOString().slice(0, 10));
  }
  if (days.size === 0) return 0;
  let streak = 0;
  for (let i = 0; ; i++) {
    const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
    if (days.has(day)) streak++;
    else if (i === 0) continue; // today with no activity yet doesn't break a prior streak
    else break;
  }
  return streak;
}

export function readingDashboard(state: StoreState, now = Date.now()): ReadingDashboard {
  const docs = state.documents;
  const of = (s: ReadingStatus) => docs.filter((d) => d.status === s);
  const currentlyReading = of("reading").sort((a, b) => (lastOpened(a) < lastOpened(b) ? 1 : -1));
  const continueReading = docs.filter((d) => d.status === "reading" || d.status === "paused").sort((a, b) => (lastOpened(a) < lastOpened(b) ? 1 : -1));
  const completed = of("completed").sort((a, b) => ((a.progress.finishedAt ?? a.updatedAt) < (b.progress.finishedAt ?? b.updatedAt) ? 1 : -1));

  const highlights: RecentHighlight[] = [];
  const annotations: RecentAnnotation[] = [];
  for (const d of docs) for (const s of d.sections) for (const p of s.passages) {
    for (const h of p.highlights) highlights.push({ ...h, documentId: d.id, documentTitle: d.title });
    for (const a of p.annotations) annotations.push({ ...a, documentId: d.id, documentTitle: d.title });
  }
  highlights.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  annotations.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    currentlyReading,
    continueReading,
    unread: of("not_started").sort(byUpdatedDesc),
    completed,
    recentlyRead: completed.slice(0, 6),
    recentHighlights: highlights.slice(0, 8),
    recentAnnotations: annotations.slice(0, 8),
    streakDays: readingStreak(docs, now),
    total: docs.length,
  };
}

// ------------------------------------------------------------------ authors ----

export interface AuthorView { name: string; documentIds: string[]; documentCount: number }

/** All distinct authors across the library, most-documents first. */
export function authors(state: StoreState): AuthorView[] {
  const map = new Map<string, { name: string; ids: string[] }>();
  for (const d of state.documents) for (const a of d.authors) {
    const key = normalizeAuthor(a);
    if (!key) continue;
    const entry = map.get(key) ?? { name: a, ids: [] };
    entry.ids.push(d.id);
    map.set(key, entry);
  }
  return [...map.values()].map((e) => ({ name: e.name, documentIds: e.ids, documentCount: e.ids.length })).sort((a, b) => b.documentCount - a.documentCount || a.name.localeCompare(b.name));
}

export function documentsByAuthor(state: StoreState, name: string): ReadingDocument[] {
  const key = normalizeAuthor(name);
  return state.documents.filter((d) => d.authors.some((a) => normalizeAuthor(a) === key));
}

export function documentById(state: StoreState, id: string): ReadingDocument | undefined {
  return state.documents.find((d) => d.id === id);
}
