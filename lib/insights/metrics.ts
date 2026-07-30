/**
 * Shared metric helpers + Insights Home (LIFEOS-039, Feature 1).
 *
 * Counts, durations, and transparent arithmetic only — no composite score, no
 * "performance" rating. Every metric carries a `definitionKey` so the UI can
 * show exactly how it was computed. Pure projections over the range-bounded
 * activity index.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export interface Metric {
  key: string;
  label: string;
  value: number;
  /** "count" (default) | "ms" (duration) | "percent". */
  unit?: "count" | "ms" | "percent";
  definitionKey: string;
}

/** Count events of a given type in a slice. */
export function countType(events: ActivityEvent[], type: string): number {
  let n = 0;
  for (const e of events) if (e.type === type) n++;
  return n;
}

/** Sum recorded durations for a given event type (ms). */
export function sumDuration(events: ActivityEvent[], type: string): number {
  let ms = 0;
  for (const e of events) if (e.type === type && e.durationMs) ms += e.durationMs;
  return ms;
}

/** Distinct record ids that appear with a given attribution key present. */
export function distinctBy(events: ActivityEvent[], field: keyof ActivityEvent): Set<string> {
  const set = new Set<string>();
  for (const e of events) { const v = e[field]; if (typeof v === "string" && v) set.add(v); }
  return set;
}

/** Format a duration (ms) as "1h 20m" / "45m" / "0m". */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * The Insights Home summary for a range. Distinct projects/milestones "touched"
 * = at least one attributed event. All values are raw counts or ms durations.
 */
export function homeMetrics(state: StoreState, index: ActivityEvent[], range: ResolvedRange): Metric[] {
  const ev = eventsInRange(index, range);
  const m = (key: string, label: string, value: number, unit: Metric["unit"] = "count"): Metric => ({ key, label, value, unit, definitionKey: key });
  return [
    m("sessions", "Sessions", countType(ev, "session_started")),
    m("session_duration", "Session duration", sumDuration(ev, "session_ended"), "ms"),
    m("focus_sessions", "Focus sessions", countType(ev, "focus_started")),
    m("focus_duration", "Focused duration", sumDuration(ev, "focus_ended"), "ms"),
    m("actions_created", "Actions created", countType(ev, "action_created")),
    m("actions_completed", "Actions completed", countType(ev, "action_completed")),
    m("captures_created", "Captures created", countType(ev, "capture_created")),
    m("captures_processed", "Captures processed", countType(ev, "capture_processed")),
    m("projects_touched", "Projects touched", distinctBy(ev, "projectId").size),
    m("milestones_touched", "Milestones touched", distinctBy(ev, "milestoneId").size),
    m("documents_opened", "Documents opened", new Set(ev.filter((e) => e.type === "document_opened" || e.type === "highlight_created" || e.type === "annotation_created").map((e) => e.recordId)).size),
    m("reading_progress", "Reading events", countType(ev, "highlight_created") + countType(ev, "annotation_created")),
    m("beliefs_reviewed", "Beliefs reviewed", countType(ev, "belief_reviewed")),
    m("maintenance_events", "Maintenance events", ev.filter((e) => e.type.startsWith("maintenance_")).length),
    m("daily_reviews", "Daily reviews completed", countType(ev, "review_completed")),
  ];
}
