/**
 * Attention view (LIFEOS-039, Feature 3).
 *
 * Where recorded attention went, grouped by workspace / goal / project /
 * milestone / action / document / entity / focus target. Measures are counts,
 * durations, and dates only. Attention is a **count of recorded activity** — it
 * is never called value, importance, or priority. Pure, derived from the range
 * slice.
 */

import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export type AttentionGrouping =
  | "workspace" | "goal" | "project" | "milestone" | "action" | "document" | "entity" | "focus_target";

export const ATTENTION_GROUPINGS: AttentionGrouping[] = ["project", "goal", "workspace", "milestone", "action", "document", "entity", "focus_target"];

export const ATTENTION_GROUPING_LABEL: Record<AttentionGrouping, string> = {
  workspace: "Workspace", goal: "Goal", project: "Project", milestone: "Milestone",
  action: "Action", document: "Document", entity: "Knowledge entity", focus_target: "Focus target",
};

export interface AttentionRow {
  /** kind:id of the grouped target. */
  kind: string;
  id: string;
  sessionCount: number;
  durationMs: number;
  focusCount: number;
  activityCount: number;
  lastTouched?: string;
}

/** The attribution key an event contributes to for a given grouping. */
function keyFor(e: ActivityEvent, grouping: AttentionGrouping): { kind: string; id: string } | undefined {
  switch (grouping) {
    case "workspace": return e.workspaceId ? { kind: "workspace", id: e.workspaceId } : undefined;
    case "goal": return e.goalId ? { kind: "goal", id: e.goalId } : undefined;
    case "project": return e.projectId ? { kind: "project", id: e.projectId } : undefined;
    case "milestone": return e.milestoneId ? { kind: "milestone", id: e.milestoneId } : undefined;
    case "action": return e.recordKind === "action" ? { kind: "action", id: e.recordId } : undefined;
    case "document": return e.recordKind === "document" ? { kind: "document", id: e.recordId } : undefined;
    case "entity": return (e.recordKind === "concept" || e.recordKind === "belief") ? { kind: e.recordKind, id: e.recordId } : undefined;
    case "focus_target": return (e.type === "focus_started" || e.type === "focus_ended" || e.type === "interruption_logged") ? { kind: e.recordKind, id: e.recordId } : undefined;
    default: return undefined;
  }
}

/**
 * Attention rows for a grouping over a range. Sorted by activity count then last
 * touched (a neutral, stable order — NOT a ranking of value).
 */
export function attentionView(index: ActivityEvent[], range: ResolvedRange, grouping: AttentionGrouping): AttentionRow[] {
  const ev = eventsInRange(index, range);
  const rows = new Map<string, AttentionRow>();
  for (const e of ev) {
    const k = keyFor(e, grouping);
    if (!k) continue;
    const mapKey = `${k.kind}:${k.id}`;
    const row = rows.get(mapKey) ?? { kind: k.kind, id: k.id, sessionCount: 0, durationMs: 0, focusCount: 0, activityCount: 0 };
    row.activityCount++;
    if (e.type === "session_started") row.sessionCount++;
    if (e.type === "session_ended" || e.type === "focus_ended") row.durationMs += e.durationMs ?? 0;
    if (e.type === "focus_started") row.focusCount++;
    if (!row.lastTouched || e.at > row.lastTouched) row.lastTouched = e.at;
    rows.set(mapKey, row);
  }
  return [...rows.values()].sort((a, b) => b.activityCount - a.activityCount || (b.lastTouched || "").localeCompare(a.lastTouched || ""));
}
