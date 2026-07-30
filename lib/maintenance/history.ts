/**
 * Maintenance history (LIFEOS-038, Feature 16).
 *
 * Compact, append-only events recording every conscious maintenance decision.
 * Events are NEVER edited or deleted — history is never silently lost — and
 * always union on sync. Pure helpers; ids/timestamps are supplied by the caller
 * (the store) so this module stays deterministic and testable.
 */

import type { MaintenanceEvent, MaintenanceEventKind, RecordRefLite } from "@/types/mvp";

export const MAINTENANCE_LABEL: Record<MaintenanceEventKind, string> = {
  reviewed: "Reviewed",
  review_requested: "Marked for review",
  archived: "Archived",
  unarchived: "Unarchived",
  merged: "Merged",
  citation_added: "Citation added",
  citation_removed: "Citation removed",
  relationship_repaired: "Relationship repaired",
  duplicate_ignored: "Duplicate ignored",
  maintenance_resolved: "Resolved",
  dismissed: "Dismissed",
};

export interface NewMaintenanceEvent {
  id: string;
  at: string;
  kind: MaintenanceEventKind;
  ref: RecordRefLite;
  relatedRef?: RecordRefLite;
  detail?: string;
}

/** Construct a normalized maintenance event. */
export function makeMaintenanceEvent(input: NewMaintenanceEvent): MaintenanceEvent {
  const e: MaintenanceEvent = { id: input.id, at: input.at, kind: input.kind, ref: input.ref };
  if (input.relatedRef) e.relatedRef = input.relatedRef;
  if (input.detail) e.detail = input.detail.trim() || undefined;
  return e;
}

/**
 * Append an event to a list, de-duplicating an identical event fired within one
 * second (guards double-clicks) — same kind + ref + relatedRef + detail.
 */
export function appendMaintenanceHistory(list: MaintenanceEvent[], event: MaintenanceEvent): MaintenanceEvent[] {
  const dupe = list.some(
    (e) =>
      e.kind === event.kind &&
      e.ref.kind === event.ref.kind && e.ref.id === event.ref.id &&
      (e.relatedRef?.id ?? "") === (event.relatedRef?.id ?? "") &&
      (e.detail ?? "") === (event.detail ?? "") &&
      Math.abs(Date.parse(e.at) - Date.parse(event.at)) < 1000,
  );
  return dupe ? list : [...list, event];
}

/** Events touching a specific record, most-recent-first. */
export function maintenanceHistoryFor(events: MaintenanceEvent[], ref: RecordRefLite): MaintenanceEvent[] {
  return events
    .filter((e) => (e.ref.kind === ref.kind && e.ref.id === ref.id) || (e.relatedRef?.kind === ref.kind && e.relatedRef?.id === ref.id))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/** Chronologically-sorted copy (oldest first). */
export function sortedMaintenanceHistory(events: MaintenanceEvent[]): MaintenanceEvent[] {
  return [...events].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}
