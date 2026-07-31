/**
 * Change log (LIFEOS-039, Feature 12).
 *
 * A readable, chronological list of recorded events over the range, filterable
 * by record type, workspace, goal, project, event type, and date range. Reuses
 * the compact history events directly — it never duplicates full record
 * contents. Pure; ordering is most-recent-first.
 */

import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export interface ChangeLogFilter {
  recordKind?: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  eventType?: string;
}

/** Human labels for the normalized event types (Feature 12 readability). */
export const EVENT_TYPE_LABEL: Record<string, string> = {
  session_started: "Session started", session_ended: "Session ended",
  focus_started: "Focus started", focus_ended: "Focus ended", interruption_logged: "Interruption logged",
  action_created: "Action created", action_started: "Action started", action_completed: "Action completed",
  action_deferred: "Action deferred", action_waiting: "Action waiting", action_cancelled: "Action cancelled", action_restored: "Action restored",
  planning_planned: "Planned", planning_moved: "Horizon changed", planning_reordered: "Reordered", planning_unplanned: "Unplanned",
  capture_created: "Capture created", capture_processed: "Capture processed",
  document_opened: "Document opened", highlight_created: "Highlight created", annotation_created: "Annotation created",
  citation_added: "Citation added", belief_created: "Belief created", belief_reviewed: "Belief reviewed", belief_revised: "Belief revised",
  entity_created: "Entity created", relationship_added: "Relationship added", research_created: "Research created", research_touched: "Research touched",
  review_completed: "Review completed",
  maintenance_reviewed: "Reviewed", maintenance_archived: "Archived", maintenance_unarchived: "Unarchived",
  maintenance_merged: "Records merged", maintenance_citation_added: "Citation added", maintenance_citation_removed: "Citation removed",
  maintenance_relationship_repaired: "Relationship repaired", maintenance_duplicate_ignored: "Duplicate ignored", maintenance_maintenance_resolved: "Maintenance resolved",
  entity_opened: "Entity opened", search_performed: "Search performed",
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type.replace(/_/g, " ");
}

/** The set of distinct event types present in the range (for the filter UI). */
export function eventTypesInRange(index: ActivityEvent[], range: ResolvedRange): string[] {
  const set = new Set<string>();
  for (const e of eventsInRange(index, range)) set.add(e.type);
  return [...set].sort();
}

/**
 * The filtered, most-recent-first change log. `limit` caps the list for display
 * (the full range is always available to export).
 */
export function changeLog(index: ActivityEvent[], range: ResolvedRange, filter: ChangeLogFilter = {}, limit = 500): ActivityEvent[] {
  const ev = eventsInRange(index, range).filter((e) =>
    (!filter.recordKind || e.recordKind === filter.recordKind) &&
    (!filter.workspaceId || e.workspaceId === filter.workspaceId) &&
    (!filter.goalId || e.goalId === filter.goalId) &&
    (!filter.projectId || e.projectId === filter.projectId) &&
    (!filter.eventType || e.type === filter.eventType),
  );
  ev.reverse(); // index is ascending; show newest first
  return ev.slice(0, limit);
}
