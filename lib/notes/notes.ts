/**
 * Notes — the lightweight keep-it layer (LIFEOS-052).
 *
 * Pure helpers only: this module never creates, mutates, or persists a record.
 * The store owns creation (`lib/mvpStore.ts`), exactly as it does for every
 * other domain.
 *
 * Design rule for everything here: a Note must stay **cheaper to file into than
 * any formal record**. The moment a note acquires a status, a lifecycle, or a
 * required category, it stops being the safe default and the front-door problem
 * returns. So there is no ranking, no scoring, no auto-titling from AI, and no
 * inferred topic.
 */

import type { Note, StoreState, Workspace } from "@/types/mvp";

/** Longest generated title before it is elided. */
export const NOTE_TITLE_MAX = 70;

export interface NewNoteInput {
  title?: string;
  body: string;
  workspaceId?: string;
  sourceCaptureId?: string;
  tags?: string[];
  /** Set when the body is AI-generated text the user chose to keep. */
  fromAiText?: boolean;
}

/**
 * The display title for a note. A note is allowed to be untitled, so this
 * derives one from the body for list rendering WITHOUT storing it — an empty
 * `title` stays empty in the record, and the user is never forced to name a
 * thought before keeping it.
 */
export function noteDisplayTitle(note: Pick<Note, "title" | "body">, max = NOTE_TITLE_MAX): string {
  const explicit = (note.title ?? "").trim();
  if (explicit) return explicit;
  const firstLine = (note.body ?? "").split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  if (!firstLine) return "Untitled note";
  return firstLine.length > max ? firstLine.slice(0, max - 1).trimEnd() + "…" : firstLine;
}

/** A short preview of the body for list rows (never the whole note). */
export function notePreview(note: Pick<Note, "body">, max = 160): string {
  const flat = (note.body ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

/** Live (non-archived) notes, newest first. Deterministic. */
export function activeNotes(state: StoreState): Note[] {
  return (state.notes ?? [])
    .filter((n) => !n.archived)
    .slice()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
}

/** Notes filed under one Topic (workspace). */
export function notesInTopic(state: StoreState, workspaceId: string): Note[] {
  return activeNotes(state).filter((n) => n.workspaceId === workspaceId);
}

/** Notes with no Topic. A note is never required to have one. */
export function notesWithoutTopic(state: StoreState): Note[] {
  return activeNotes(state).filter((n) => !n.workspaceId);
}

/**
 * Deterministic substring search over notes — title, body, and tags.
 *
 * This is a small convenience for the Notes surface itself. It is deliberately
 * NOT a new index: global discovery goes through the existing command palette
 * (`lib/command/records.ts`), which notes are registered with, so the product
 * does not grow a second retrieval island (Gap Audit §20).
 */
export function searchNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => {
    const hay = `${n.title ?? ""} ${n.body ?? ""} ${(n.tags ?? []).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

export interface TopicSummary {
  workspaceId: string;
  name: string;
  count: number;
}

/**
 * Topics that currently hold notes, plus their counts.
 *
 * A "Topic" is a Workspace — no new entity and no discriminator field. See
 * `lib/notes/topics.ts` for why. Workspaces with no notes are not listed here:
 * the Notes surface shows the topics a user actually keeps notes in, rather
 * than every workspace they have ever made.
 */
export function topicsWithNotes(state: StoreState): TopicSummary[] {
  const byId = new Map<string, Workspace>();
  for (const w of state.workspaces ?? []) if (!w.archived) byId.set(w.id, w);
  const counts = new Map<string, number>();
  for (const n of activeNotes(state)) {
    if (n.workspaceId && byId.has(n.workspaceId)) counts.set(n.workspaceId, (counts.get(n.workspaceId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([workspaceId, count]) => ({ workspaceId, name: byId.get(workspaceId)?.name ?? "Topic", count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Normalize a new-note input into the stored shape's field values. */
export function normalizeNewNote(input: NewNoteInput): Pick<Note, "title" | "body" | "workspaceId" | "sourceCaptureId" | "tags" | "fromAiText"> {
  const title = (input.title ?? "").trim();
  return {
    title: title || undefined,
    body: input.body ?? "",
    workspaceId: input.workspaceId || undefined,
    sourceCaptureId: input.sourceCaptureId || undefined,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    fromAiText: input.fromAiText ? true : undefined,
  };
}
