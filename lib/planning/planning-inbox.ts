/**
 * Planning inbox (LIFEOS-037, Feature 11) + active-project safeguard (Feature 12).
 *
 * A small projection of records that may need a manual planning decision. The
 * user chooses whether and where to plan each — nothing is auto-assigned. Pure.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { todayKey, type DayKey } from "@/lib/reviews/dates";
import { assignmentFor, refKey, assignmentIndex } from "@/lib/planning/horizon";
import { isDue } from "@/lib/actions/defer";

export type PlanningInboxReason =
  | "action_no_horizon" | "project_no_action" | "milestone_no_action"
  | "focus_ref_missing" | "deferred_due" | "open_loop_unresolved" | "orphaned_assignment";

export interface PlanningInboxItem {
  id: string;
  ref: RecordRefLite;
  reason: PlanningInboxReason;
  detail?: string;
}

export const REASON_LABEL: Record<PlanningInboxReason, string> = {
  action_no_horizon: "Open action with no horizon",
  project_no_action: "Active project with no next action",
  milestone_no_action: "Milestone with no open action",
  focus_ref_missing: "Tomorrow-focus reference no longer available",
  deferred_due: "Deferred item whose date has arrived",
  open_loop_unresolved: "Unresolved open loop selected in a review",
  orphaned_assignment: "Planning reference to a missing record",
};

/**
 * Build O(1) existence sets once, so orphan detection over thousands of
 * assignments never rescans the record arrays (indexed maps, not linear scans).
 */
function buildExistence(state: StoreState): (ref: RecordRefLite) => boolean {
  const actionIds = new Set((state.nextActions ?? []).map((a) => a.id));
  const projectIds = new Set((state.projects ?? []).map((p) => p.id));
  const milestoneIds = new Set((state.projects ?? []).flatMap((p) => p.milestones.map((m) => m.id)));
  const documentIds = new Set((state.documents ?? []).map((d) => d.id));
  const goalIds = new Set((state.goals ?? []).map((g) => g.id));
  const workspaceIds = new Set((state.workspaces ?? []).map((w) => w.id));
  return (ref: RecordRefLite): boolean => {
    switch (ref.kind) {
      case "action": return actionIds.has(ref.id);
      case "project": return projectIds.has(ref.id);
      case "milestone": return milestoneIds.has(ref.id);
      case "document": return documentIds.has(ref.id);
      case "goal": return goalIds.has(ref.id);
      case "workspace": return workspaceIds.has(ref.id);
      case "open_loop": return true; // open loops are ephemeral references chosen by the user
      default: return true;
    }
  };
}

export function planningInbox(state: StoreState, today: DayKey = todayKey()): PlanningInboxItem[] {
  const out: PlanningInboxItem[] = [];
  const assignments = state.planningAssignments ?? [];
  const actions = state.nextActions ?? [];
  const index = assignmentIndex(assignments);
  const exists = buildExistence(state);

  // One pass over actions: which projects/milestones have an open action.
  const projectsWithOpen = new Set<string>();
  const milestonesWithOpen = new Set<string>();
  for (const a of actions) {
    if (a.status === "open" || a.status === "in_progress") {
      if (a.projectId) projectsWithOpen.add(a.projectId);
      if (a.milestoneId) milestonesWithOpen.add(a.milestoneId);
    }
  }

  // Open actions with no planning horizon (indexed lookup, not a scan).
  for (const a of actions) {
    if ((a.status === "open" || a.status === "in_progress") && !index.has(refKey({ kind: "action", id: a.id })))
      out.push({ id: `action_no_horizon:${a.id}`, ref: { kind: "action", id: a.id }, reason: "action_no_horizon" });
    if (isDue(a, today)) out.push({ id: `deferred_due:${a.id}`, ref: { kind: "action", id: a.id }, reason: "deferred_due" });
  }
  // Active projects + milestones with no open action (set lookups).
  for (const p of state.projects ?? []) {
    if (p.status !== "active") continue;
    if (!projectsWithOpen.has(p.id)) out.push({ id: `project_no_action:${p.id}`, ref: { kind: "project", id: p.id }, reason: "project_no_action" });
    for (const m of p.milestones ?? []) {
      if (m.status === "done") continue;
      if (!milestonesWithOpen.has(m.id)) out.push({ id: `milestone_no_action:${m.id}`, ref: { kind: "milestone", id: m.id }, reason: "milestone_no_action", detail: p.title });
    }
  }
  // Orphaned planning assignments (referenced record gone — O(1) each).
  for (const a of assignments) if (!exists(a.ref)) out.push({ id: `orphaned:${a.id}`, ref: a.ref, reason: "orphaned_assignment" });
  // Tomorrow-focus references pointing at a now-missing record.
  for (const r of state.dailyReviews ?? []) for (const f of r.tomorrowFocus ?? []) {
    if (f.ref && !exists(f.ref)) out.push({ id: `focus_missing:${f.id}`, ref: f.ref, reason: "focus_ref_missing" });
  }
  return out;
}

export interface ActiveProjectSafeguard {
  needsAction: boolean;
  projectId: string;
}

/**
 * Active-project safeguard (Feature 12): an active project with no open/in-progress
 * action. NEVER labels the project unhealthy/stalled and NEVER creates an action.
 */
export function activeProjectSafeguard(state: StoreState, projectId: string): ActiveProjectSafeguard {
  const p = (state.projects ?? []).find((x) => x.id === projectId);
  if (!p || p.status !== "active") return { needsAction: false, projectId };
  const hasOpen = (state.nextActions ?? []).some((a) => a.projectId === projectId && (a.status === "open" || a.status === "in_progress"));
  return { needsAction: !hasOpen, projectId };
}

/** The subset of the planning inbox that are simple "needs a horizon" candidates. */
export function unplannedCount(state: StoreState): number {
  const assignments = state.planningAssignments ?? [];
  return (state.nextActions ?? []).filter((a) => (a.status === "open" || a.status === "in_progress") && !assignmentFor(assignments, { kind: "action", id: a.id })).length;
}
