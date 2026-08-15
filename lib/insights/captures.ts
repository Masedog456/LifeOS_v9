/**
 * Capture flow (LIFEOS-039, Feature 7).
 *
 * Where captures went — outcome counts + percentages, median processing delay,
 * the oldest unprocessed capture, and source distribution where explicitly
 * stored. No quality judgments. Pure.
 */

import type { StoreState, CaptureProcessingStatus } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { inRange } from "@/lib/insights/range";

export interface CaptureFlowOutcome { key: CaptureProcessingStatus; label: string; count: number; percent: number }

export interface CaptureFlow {
  createdInRange: number;
  processedInRange: number;
  outcomes: CaptureFlowOutcome[];
  /** Median ms between a capture's creation and processing (processed captures only). */
  medianProcessingDelayMs?: number;
  /** The oldest still-unprocessed capture (id + createdAt). */
  oldestUnprocessed?: { id: string; createdAt: string };
  /** Source distribution where a capture stored an explicit source context. */
  sourceDistribution: { source: string; count: number }[];
}

/**
 * Outcome labels, keyed by the ONLY thing this view actually reads: a capture's
 * `processingStatus`.
 *
 * Typing this as `Record<CaptureProcessingStatus, string>` is the fix, not a
 * tidy-up (LIFEOS-050B, D-2). The map previously carried twelve keys against a
 * six-member union, so seven labels — `rewritten`, `split`, `merged`,
 * `converted`, `linked_project`, `linked_knowledge`, `restored` — could never be
 * emitted: they name capture history ACTIONS, not statuses. The worst of them
 * read "Converted to action", which was false twice over: no status ever
 * produces it, and `convertCapture`'s eleven targets do not create a
 * `NextAction` at all (that path is the processor's separate `→ Next action`
 * control). The exhaustive type now makes a status impossible to add without a
 * label, and a label impossible to invent without a status.
 */
const OUTCOME_LABEL: Record<CaptureProcessingStatus, string> = {
  inbox: "Still in inbox",
  processing: "Being processed",
  processed: "Processed",
  deferred: "Deferred",
  archived: "Archived",
  discarded: "Discarded",
};

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function captureFlow(state: StoreState, index: ActivityEvent[], range: ResolvedRange): CaptureFlow {
  const captures = state.captures ?? [];
  const ev = eventsInRange(index, range).filter((e) => e.recordKind === "capture");
  const createdInRange = ev.filter((e) => e.type === "capture_created").length;
  const processedInRange = ev.filter((e) => e.type === "capture_processed").length;

  // Outcome distribution over captures CREATED in range (deterministic denominator).
  const created = captures.filter((c) => inRange(c.createdAt, range));
  const counts = new Map<CaptureProcessingStatus, number>();
  for (const c of created) {
    const status: CaptureProcessingStatus = c.processingStatus ?? "inbox";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const total = created.length || 1;
  const outcomes: CaptureFlowOutcome[] = [...counts.entries()]
    .map(([key, count]) => ({ key, label: OUTCOME_LABEL[key], count, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);

  // Median processing delay (processed captures with both timestamps).
  const delays = captures
    .filter((c) => c.processedAt && c.createdAt)
    .map((c) => Date.parse(c.processedAt!) - Date.parse(c.createdAt))
    .filter((d) => Number.isFinite(d) && d >= 0);
  const medianProcessingDelayMs = median(delays);

  // Oldest still-unprocessed capture (any time).
  const unprocessed = captures.filter((c) => c.processingStatus !== "processed" && c.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const oldestUnprocessed = unprocessed[0] ? { id: unprocessed[0].id, createdAt: unprocessed[0].createdAt } : undefined;

  // Source distribution where explicitly stored (sourceContext / source).
  const srcCounts = new Map<string, number>();
  for (const c of created) {
    const src = (c as { sourceContext?: { source?: string }; source?: string }).sourceContext?.source || (c as { source?: string }).source;
    if (src) srcCounts.set(src, (srcCounts.get(src) ?? 0) + 1);
  }
  const sourceDistribution = [...srcCounts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

  return { createdInRange, processedInRange, outcomes, medianProcessingDelayMs, oldestUnprocessed, sourceDistribution };
}
