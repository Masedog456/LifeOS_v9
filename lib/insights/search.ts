/**
 * Insights search filters (LIFEOS-039, Feature 23).
 *
 * Deterministic ref-key sets for FACTUAL activity filters — touched / untouched
 * within a range, created / completed / reviewed / opened within a range, has
 * sessions, has focus sessions. A search UI can intersect its text results with
 * any of these. No behavioral ranking is introduced. Pure.
 */

import type { StoreState } from "@/types/mvp";
import { buildActivityIndex, eventsInRange, type ActivityEvent } from "@/lib/insights/activity";
import { lastActivityByRecord } from "@/lib/insights/dormancy";
import type { ResolvedRange } from "@/lib/insights/range";

export type ActivityFilter =
  | "touched_in_range" | "untouched_in_range" | "created_in_range" | "completed_in_range"
  | "reviewed_in_range" | "opened_in_range" | "has_sessions" | "has_focus_sessions";

export const ACTIVITY_FILTER_LABEL: Record<ActivityFilter, string> = {
  touched_in_range: "Touched within range", untouched_in_range: "Untouched within range",
  created_in_range: "Created within range", completed_in_range: "Completed within range",
  reviewed_in_range: "Reviewed within range", opened_in_range: "Opened within range",
  has_sessions: "Has sessions", has_focus_sessions: "Has focus sessions",
};

const key = (e: ActivityEvent) => `${e.recordKind}:${e.recordId}`;

/** Ref-key sets per factual activity filter for a range. */
export function activityFilterSets(state: StoreState, range: ResolvedRange, index?: ActivityEvent[]): Record<ActivityFilter, Set<string>> {
  const idx = index ?? buildActivityIndex(state);
  const ev = eventsInRange(idx, range);
  const touched = new Set<string>();
  const created = new Set<string>();
  const completed = new Set<string>();
  const reviewed = new Set<string>();
  const opened = new Set<string>();
  const hasSessions = new Set<string>();
  const hasFocus = new Set<string>();
  for (const e of ev) {
    const k = key(e);
    touched.add(k);
    if (e.type.endsWith("_created")) created.add(k);
    if (e.type === "action_completed") completed.add(k);
    if (e.type === "belief_reviewed" || e.type === "maintenance_reviewed" || e.type === "review_completed") reviewed.add(k);
    if (e.type === "document_opened" || e.type === "entity_opened") opened.add(k);
    if (e.type === "session_started") hasSessions.add(k);
    if (e.type === "focus_started") hasFocus.add(k);
  }
  // Untouched: everything with a last-activity older than the range start (or never).
  const last = lastActivityByRecord(idx);
  const untouched = new Set<string>();
  for (const [k, at] of last) if (Date.parse(at) < range.startMs) untouched.add(k);

  return {
    touched_in_range: touched, untouched_in_range: untouched, created_in_range: created,
    completed_in_range: completed, reviewed_in_range: reviewed, opened_in_range: opened,
    has_sessions: hasSessions, has_focus_sessions: hasFocus,
  };
}
