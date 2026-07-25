/**
 * Reading progress (LIFEOS-028, Feature 8).
 *
 * Pure transforms over a ReadingProgress: mark passages read/unread, recompute
 * the percentage deterministically from the fraction of passages read, estimate
 * remaining reading (by word count at a fixed WPM), and derive the status. The
 * store applies these; nothing here mutates the source text.
 */

import type { ReadingDocument, ReadingProgress, ReadingStatus } from "@/types/mvp";
import { allPassages } from "@/lib/library/documents";

const WORDS_PER_MINUTE = 220;

export const READING_STATUSES: ReadingStatus[] = ["not_started", "reading", "paused", "completed", "abandoned"];
export const STATUS_LABEL: Record<ReadingStatus, string> = {
  not_started: "Not started", reading: "Reading", paused: "Paused", completed: "Completed", abandoned: "Abandoned",
};

/** Recompute percent from the number of distinct read passages over the total. */
export function recomputePercent(readIds: string[], totalPassages: number): number {
  if (totalPassages <= 0) return 0;
  const read = new Set(readIds).size;
  return Math.max(0, Math.min(100, Math.round((read / totalPassages) * 100)));
}

/** Mark a passage read (or unread) and recompute percent. Pure. */
export function withPassageRead(progress: ReadingProgress, passageId: string, read: boolean, totalPassages: number, now: string): ReadingProgress {
  const set = new Set(progress.readPassageIds);
  if (read) set.add(passageId); else set.delete(passageId);
  const readPassageIds = [...set];
  const percent = recomputePercent(readPassageIds, totalPassages);
  let status = progress.status;
  let startedAt = progress.startedAt;
  let finishedAt = progress.finishedAt;
  if (readPassageIds.length > 0 && (status === "not_started")) { status = "reading"; startedAt = startedAt ?? now; }
  if (percent >= 100) { status = "completed"; finishedAt = finishedAt ?? now; }
  else if (status === "completed") { status = "reading"; finishedAt = undefined; }
  return { ...progress, readPassageIds, percent, status, startedAt, finishedAt };
}

/** Explicitly set the reading status, stamping start/finish dates as needed. */
export function withStatus(progress: ReadingProgress, status: ReadingStatus, now: string): ReadingProgress {
  return {
    ...progress,
    status,
    startedAt: progress.startedAt ?? (status === "reading" ? now : progress.startedAt),
    finishedAt: status === "completed" ? (progress.finishedAt ?? now) : (status === "reading" || status === "paused" ? undefined : progress.finishedAt),
  };
}

/** Move the reading position and stamp lastOpened. */
export function withPosition(progress: ReadingProgress, sectionId: string | undefined, passageId: string | undefined, now: string): ReadingProgress {
  const status = progress.status === "not_started" ? "reading" : progress.status;
  return { ...progress, currentSectionId: sectionId ?? progress.currentSectionId, currentPassageId: passageId ?? progress.currentPassageId, status, startedAt: progress.startedAt ?? now, lastOpenedAt: now };
}

/** Estimated minutes remaining, from the words in unread passages at a fixed WPM. */
export function estimatedMinutesRemaining(doc: ReadingDocument): number {
  const read = new Set(doc.progress.readPassageIds);
  let words = 0;
  for (const p of allPassages(doc)) if (!read.has(p.id)) words += p.text.trim() ? p.text.trim().split(/\s+/).length : 0;
  return Math.ceil(words / WORDS_PER_MINUTE);
}
