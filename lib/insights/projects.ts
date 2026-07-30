/**
 * Project activity (LIFEOS-039, Feature 4).
 *
 * Per-project raw measures for the selected range — sessions, focused time,
 * action transitions, captures linked, documents opened, milestones touched,
 * planning movements, maintenance events, last activity. Comparison is through
 * raw measures ONLY: projects are never auto-ranked and never labelled neglected
 * or successful. Pure.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export interface ProjectActivityRow {
  id: string;
  title: string;
  status: string;
  sessions: number;
  focusMs: number;
  actionsCreated: number;
  actionsStarted: number;
  actionsCompleted: number;
  capturesLinked: number;
  documentsOpened: number;
  milestonesTouched: number;
  planningMovements: number;
  maintenanceEvents: number;
  lastActivity?: string;
}

export function projectActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): ProjectActivityRow[] {
  const ev = eventsInRange(index, range);
  const rows = new Map<string, ProjectActivityRow>();
  for (const p of state.projects ?? []) rows.set(p.id, { id: p.id, title: p.title, status: p.status, sessions: 0, focusMs: 0, actionsCreated: 0, actionsStarted: 0, actionsCompleted: 0, capturesLinked: 0, documentsOpened: 0, milestonesTouched: 0, planningMovements: 0, maintenanceEvents: 0 });

  const milestonesByProject = new Map<string, Set<string>>();
  for (const e of ev) {
    if (!e.projectId) continue;
    const row = rows.get(e.projectId);
    if (!row) continue;
    if (!row.lastActivity || e.at > row.lastActivity) row.lastActivity = e.at;
    switch (e.type) {
      case "session_started": row.sessions++; break;
      case "focus_ended": row.focusMs += e.durationMs ?? 0; break;
      case "action_created": row.actionsCreated++; break;
      case "action_started": row.actionsStarted++; break;
      case "action_completed": row.actionsCompleted++; break;
      case "capture_created": case "capture_processed": row.capturesLinked++; break;
      case "document_opened": row.documentsOpened++; break;
      case "planning_planned": case "planning_moved": case "planning_reordered": row.planningMovements++; break;
    }
    if (e.type.startsWith("maintenance_")) row.maintenanceEvents++;
    if (e.milestoneId) { const set = milestonesByProject.get(e.projectId) ?? new Set(); set.add(e.milestoneId); milestonesByProject.set(e.projectId, set); }
  }
  for (const [pid, set] of milestonesByProject) { const row = rows.get(pid); if (row) row.milestonesTouched = set.size; }
  // Neutral stable order: most-recent activity first, then title. NOT a ranking of merit.
  return [...rows.values()].sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || "") || a.title.localeCompare(b.title));
}
