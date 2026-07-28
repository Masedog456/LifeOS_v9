/**
 * Processing helpers (LIFEOS-035, Feature 3).
 *
 * Deterministic "what actions are available for this capture?" — the system may
 * SUGGEST actions based on record shape/context, but never decides meaning. Pure.
 */

import type { Capture } from "@/types/mvp";
import { captureStatus, isLinked, isRewritten } from "@/lib/inbox/capture-status";

export type ProcessingAction =
  | "convert" | "link" | "rewrite" | "split" | "merge"
  | "defer" | "archive" | "discard" | "mark_processed" | "restore";

export const ACTION_LABEL: Record<ProcessingAction, string> = {
  convert: "Convert", link: "Link", rewrite: "Rewrite", split: "Split", merge: "Merge",
  defer: "Defer", archive: "Archive", discard: "Discard", mark_processed: "Mark processed", restore: "Restore to inbox",
};

/**
 * The actions worth offering for a capture, given its status/shape. Suggestions
 * only — every action stays available in the UI; this just orders sensibly.
 */
export function suggestedActions(c: Capture): ProcessingAction[] {
  const status = captureStatus(c);
  if (status === "archived" || status === "discarded") return ["restore", "link"];
  const out: ProcessingAction[] = ["convert", "link", "rewrite", "split"];
  if (isLinked(c) || isRewritten(c)) out.push("mark_processed");
  out.push("defer", "archive", "discard");
  if (status === "processed" || status === "deferred") out.unshift("restore");
  return out;
}
