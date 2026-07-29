/**
 * Planning history (LIFEOS-037, Feature 19).
 *
 * Compact, append-only events on a planning assignment or focus session. Safe
 * metadata only — never a copy of full record contents. Deduped so rapid
 * identical events don't bloat the log.
 */

import type { PlanningHistoryEvent, PlanningHorizon, RecordRefLite } from "@/types/mvp";

export type PlanningEventKind =
  | "planned" | "unplanned" | "moved" | "reordered"
  | "focus_started" | "focus_ended" | "interrupted" | "capacity_limit_changed";

export const PLANNING_LABEL: Record<PlanningEventKind, string> = {
  planned: "Planned",
  unplanned: "Removed from planning",
  moved: "Moved",
  reordered: "Reordered",
  focus_started: "Focus started",
  focus_ended: "Focus ended",
  interrupted: "Interrupted",
  capacity_limit_changed: "Capacity limit changed",
};

let counter = 0;
function eventId(): string {
  counter += 1;
  return `pe_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function makeEvent(input: {
  action: PlanningEventKind;
  at: string;
  ref?: RecordRefLite;
  fromHorizon?: PlanningHorizon;
  toHorizon?: PlanningHorizon;
  detail?: string;
}): PlanningHistoryEvent {
  return {
    id: eventId(),
    at: input.at,
    action: input.action,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.fromHorizon ? { fromHorizon: input.fromHorizon } : {}),
    ...(input.toHorizon ? { toHorizon: input.toHorizon } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

/** Append an event, collapsing an immediate identical duplicate (< 1s, same action + horizons). */
export function appendHistory<T extends { history: PlanningHistoryEvent[] }>(record: T, event: PlanningHistoryEvent): T {
  const last = record.history[record.history.length - 1];
  if (last && last.action === event.action && last.fromHorizon === event.fromHorizon && last.toHorizon === event.toHorizon
    && Math.abs(new Date(last.at).getTime() - new Date(event.at).getTime()) < 1000) {
    return record;
  }
  return { ...record, history: [...record.history, event] };
}

export function sortedHistory(events: PlanningHistoryEvent[]): PlanningHistoryEvent[] {
  return [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
