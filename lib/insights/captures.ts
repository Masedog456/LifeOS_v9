/**
 * Capture flow (LIFEOS-039, Feature 7).
 *
 * Where captures went — outcome counts + percentages, median processing delay,
 * the oldest unprocessed capture, and source distribution where explicitly
 * stored. No quality judgments. Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { inRange } from "@/lib/insights/range";

export interface CaptureFlowOutcome { key: string; label: string; count: number; percent: number }

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

const OUTCOME_LABEL: Record<string, string> = {
  inbox: "Still in inbox", rewritten: "Rewritten", split: "Split", merged: "Merged",
  converted: "Converted to action", linked_project: "Linked to project", linked_knowledge: "Linked to knowledge",
  deferred: "Deferred", archived: "Archived", discarded: "Discarded", restored: "Restored", processed: "Processed",
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
  const counts = new Map<string, number>();
  for (const c of created) {
    const status = c.processingStatus === "processed" ? "processed" : c.processingStatus === "inbox" || !c.processingStatus ? "inbox" : c.processingStatus;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const total = created.length || 1;
  const outcomes: CaptureFlowOutcome[] = [...counts.entries()]
    .map(([key, count]) => ({ key, label: OUTCOME_LABEL[key] ?? key, count, percent: Math.round((count / total) * 100) }))
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
