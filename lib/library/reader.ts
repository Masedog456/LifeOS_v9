/**
 * Reader navigation (LIFEOS-028, Feature 14).
 *
 * Pure helpers for moving through a document: the ordered passage list,
 * previous/next passage, the section a passage belongs to, section jumps, and
 * the progress-bar position. Deterministic; the React reader wires these to
 * J/K/section controls.
 */

import type { DocumentSection, Passage, ReadingDocument } from "@/types/mvp";
import { allPassages } from "@/lib/library/documents";

export interface FlatPassage { passage: Passage; section: DocumentSection; index: number }

/** Ordered passages with their section and global index. */
export function flatten(doc: ReadingDocument): FlatPassage[] {
  const out: FlatPassage[] = [];
  let index = 0;
  for (const section of [...doc.sections].sort((a, b) => a.order - b.order)) {
    for (const passage of [...section.passages].sort((a, b) => a.order - b.order)) {
      out.push({ passage, section, index: index++ });
    }
  }
  return out;
}

export function passageIndex(doc: ReadingDocument, passageId: string | undefined): number {
  if (!passageId) return -1;
  return flatten(doc).findIndex((f) => f.passage.id === passageId);
}

/** The passage after the given one (or the first passage when none is given). */
export function nextPassageId(doc: ReadingDocument, passageId: string | undefined): string | undefined {
  const flat = flatten(doc);
  if (flat.length === 0) return undefined;
  const i = passageIndex(doc, passageId);
  if (i < 0) return flat[0].passage.id;
  return flat[Math.min(i + 1, flat.length - 1)].passage.id;
}

/** The passage before the given one. */
export function prevPassageId(doc: ReadingDocument, passageId: string | undefined): string | undefined {
  const flat = flatten(doc);
  if (flat.length === 0) return undefined;
  const i = passageIndex(doc, passageId);
  if (i < 0) return flat[0].passage.id;
  return flat[Math.max(i - 1, 0)].passage.id;
}

/** The first passage of a section (for section jumps). */
export function firstPassageOfSection(doc: ReadingDocument, sectionId: string): string | undefined {
  const s = doc.sections.find((x) => x.id === sectionId);
  return [...(s?.passages ?? [])].sort((a, b) => a.order - b.order)[0]?.id;
}

export function sectionOfPassage(doc: ReadingDocument, passageId: string): DocumentSection | undefined {
  return doc.sections.find((s) => s.passages.some((p) => p.id === passageId));
}

export function findPassage(doc: ReadingDocument, passageId: string): Passage | undefined {
  return allPassages(doc).find((p) => p.id === passageId);
}

/** 0–100 position of a passage within the document (for the progress bar). */
export function passagePosition(doc: ReadingDocument, passageId: string | undefined): number {
  const flat = flatten(doc);
  if (flat.length === 0) return 0;
  const i = passageIndex(doc, passageId);
  if (i < 0) return 0;
  return Math.round(((i + 1) / flat.length) * 100);
}
