/**
 * Goal activity (LIFEOS-039, Feature 5).
 *
 * Per-goal raw measures — linked projects/milestones/actions, sessions, focus
 * sessions, completions, captures, reading, knowledge references, last activity.
 * No goal score, no predicted completion, no health status. Pure. Activity is
 * attributed to a goal directly (`goalId`) or via a project that advances it.
 */

import type { StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";

export interface GoalActivityRow {
  id: string;
  title: string;
  status: string;
  projectsLinked: number;
  milestonesLinked: number;
  actionsLinked: number;
  sessions: number;
  focusSessions: number;
  completions: number;
  captures: number;
  reading: number;
  knowledgeRefs: number;
  lastActivity?: string;
}

export function goalActivity(state: StoreState, index: ActivityEvent[], range: ResolvedRange): GoalActivityRow[] {
  const projects = state.projects ?? [];
  const actions = state.nextActions ?? [];
  const goalProjects = new Map<string, Set<string>>(); // goalId -> projectIds
  for (const p of projects) if (p.goalId) { const s = goalProjects.get(p.goalId) ?? new Set(); s.add(p.id); goalProjects.set(p.goalId, s); }

  const rows = new Map<string, GoalActivityRow>();
  for (const g of state.goals ?? []) {
    const pids = goalProjects.get(g.id) ?? new Set<string>();
    let milestones = 0;
    for (const p of projects) if (pids.has(p.id)) milestones += (p.milestones ?? []).length;
    const actionsLinked = actions.filter((a) => a.goalId === g.id || (a.projectId && pids.has(a.projectId))).length;
    rows.set(g.id, { id: g.id, title: g.title, status: g.status, projectsLinked: pids.size, milestonesLinked: milestones, actionsLinked, sessions: 0, focusSessions: 0, completions: 0, captures: 0, reading: 0, knowledgeRefs: 0 });
  }

  const ev = eventsInRange(index, range);
  for (const e of ev) {
    // Resolve which goal(s) this event contributes to.
    const goalIds = new Set<string>();
    if (e.goalId && rows.has(e.goalId)) goalIds.add(e.goalId);
    if (e.projectId) for (const [gid, pids] of goalProjects) if (pids.has(e.projectId)) goalIds.add(gid);
    for (const gid of goalIds) {
      const row = rows.get(gid);
      if (!row) continue;
      if (!row.lastActivity || e.at > row.lastActivity) row.lastActivity = e.at;
      if (e.type === "session_started") row.sessions++;
      else if (e.type === "focus_started") row.focusSessions++;
      else if (e.type === "action_completed") row.completions++;
      else if (e.type === "capture_created" || e.type === "capture_processed") row.captures++;
      else if (e.type === "document_opened" || e.type === "highlight_created" || e.type === "annotation_created") row.reading++;
      else if (e.type === "citation_added" || e.type === "entity_created" || e.type === "relationship_added") row.knowledgeRefs++;
    }
  }
  return [...rows.values()].sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || "") || a.title.localeCompare(b.title));
}
