/**
 * Capture processing state (LIFEOS-035, Feature 1).
 *
 * Deterministic helpers over a capture's processing metadata. Every existing and
 * new capture defaults to `inbox` with empty links — nothing here classifies,
 * rewrites, or decides meaning. The original `text` is never touched; a
 * clarified working version lives in `workingText`.
 */

import type { Capture, CaptureProcessingStatus, RecordRefLite } from "@/types/mvp";

export const DEFAULT_STATUS: CaptureProcessingStatus = "inbox";

export const STATUS_LABEL: Record<CaptureProcessingStatus, string> = {
  inbox: "Inbox",
  processing: "Processing",
  processed: "Processed",
  deferred: "Deferred",
  archived: "Archived",
  discarded: "Discarded",
};

/** Display order for the queue tabs. */
export const QUEUE_VIEWS = ["inbox", "processing", "deferred", "processed", "archived"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

/** A capture's processing status, defaulting to `inbox`. */
export function captureStatus(c: Capture): CaptureProcessingStatus {
  return c.processingStatus ?? DEFAULT_STATUS;
}

/** The text to work with: the clarified working version if present, else original. */
export function effectiveText(c: Capture): string {
  return (c.workingText ?? c.text) ?? "";
}

/** True when a rewrite exists that differs from the original. */
export function isRewritten(c: Capture): boolean {
  return typeof c.workingText === "string" && c.workingText.trim() !== c.text.trim();
}

/** All direct links on a capture as typed references (never conversions). */
export function captureLinks(c: Capture): RecordRefLite[] {
  return [
    ...(c.linkedWorkspaceIds ?? []).map((id) => ({ kind: "workspace", id })),
    ...(c.linkedGoalIds ?? []).map((id) => ({ kind: "goal", id })),
    ...(c.linkedProjectIds ?? []).map((id) => ({ kind: "project", id })),
    ...(c.linkedEntityRefs ?? []),
  ];
}

/** Whether a capture has any direct link. */
export function isLinked(c: Capture): boolean {
  return captureLinks(c).length > 0;
}

export function captureTags(c: Capture): string[] {
  return c.tags ?? [];
}

/** Records this capture was converted into (from its history). */
export function conversionTargets(c: Capture): RecordRefLite[] {
  const out: RecordRefLite[] = [];
  const seen = new Set<string>();
  for (const e of c.history ?? []) {
    if (e.action !== "convert") continue;
    for (const t of e.targets ?? []) {
      const key = `${t.kind}:${t.id}`;
      if (!seen.has(key)) { seen.add(key); out.push(t); }
    }
  }
  return out;
}

/** Age of a capture in whole days relative to now. */
export function captureAgeDays(c: Capture, now: number = Date.now()): number {
  const t = Date.parse(c.createdAt);
  return Number.isNaN(t) ? 0 : Math.floor((now - t) / 86400000);
}

/**
 * Whether a status transition is allowed (deterministic guard). Discarded and
 * archived are reversible (restore → inbox); processed can be reopened to
 * processing; everything can move to archived/discarded/deferred.
 */
export function canTransition(from: CaptureProcessingStatus, to: CaptureProcessingStatus): boolean {
  if (from === to) return true;
  return true; // all transitions are permitted; the UI decides which to offer.
}
