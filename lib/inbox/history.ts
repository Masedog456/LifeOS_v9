/**
 * Processing history (LIFEOS-035, Feature 12).
 *
 * A compact, append-only log of what happened to a capture — action, timestamp,
 * status transition, and references to records created/linked. It NEVER stores
 * the full capture text (privacy + size); `detail` carries only short,
 * non-content metadata. Pure helpers.
 */

import type { Capture, CaptureProcessingEvent, CaptureProcessingStatus, RecordRefLite } from "@/types/mvp";

let seq = 0;
function eventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `evt_${Date.now()}_${seq++}`;
}

export function makeEvent(input: {
  action: string;
  at: string;
  fromStatus?: CaptureProcessingStatus;
  toStatus?: CaptureProcessingStatus;
  targets?: RecordRefLite[];
  detail?: string;
}): CaptureProcessingEvent {
  return { id: eventId(), at: input.at, action: input.action, fromStatus: input.fromStatus, toStatus: input.toStatus, targets: input.targets, detail: input.detail };
}

/** Append an event to a capture's history, returning a new capture. */
export function appendHistory(capture: Capture, event: CaptureProcessingEvent): Capture {
  return { ...capture, history: [...(capture.history ?? []), event] };
}

/** A capture's history, newest first. */
export function captureHistory(c: Capture): CaptureProcessingEvent[] {
  return [...(c.history ?? [])].sort((a, b) => b.at.localeCompare(a.at));
}

export const ACTION_LABEL: Record<string, string> = {
  rewrite: "Rewrote", convert: "Converted", split: "Split", merge: "Merged",
  defer: "Deferred", archive: "Archived", discard: "Discarded", restore: "Restored",
  link: "Linked", unlink: "Unlinked", mark_processed: "Marked processed", tag: "Tagged",
  revert: "Reverted rewrite", note: "Noted",
};
