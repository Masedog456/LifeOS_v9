/**
 * Action relationships & projections (LIFEOS-036).
 *
 * Deterministic read-only derivations connecting actions to their hierarchy,
 * sources, sessions, dependencies, and to the Today / milestone / daily-review
 * surfaces. Pure over `StoreState`. No inference, scoring, or prioritization.
 */

import type { NextAction, StoreState, RecordRefLite } from "@/types/mvp";
import { todayKey, isoOnLocalDay, type DayKey } from "@/lib/reviews/dates";
import { buildBlocksMap, buildBlockedByMap, blockersOf, blockedBy } from "@/lib/actions/dependencies";
import { returningToday, isDue } from "@/lib/actions/defer";
import { dueFollowUps } from "@/lib/actions/waiting";
import { nextToStart } from "@/lib/actions/queue";

export function actionById(state: StoreState, id: string): NextAction | undefined {
  return (state.nextActions ?? []).find((a) => a.id === id);
}

/** Actions linked to a project (directly or via a milestone in that project). */
export function actionsForProject(state: StoreState, projectId: string): NextAction[] {
  return (state.nextActions ?? []).filter((a) => a.projectId === projectId);
}

export function actionsForMilestone(state: StoreState, milestoneId: string): NextAction[] {
  return (state.nextActions ?? []).filter((a) => a.milestoneId === milestoneId);
}

export function actionsForGoal(state: StoreState, goalId: string): NextAction[] {
  return (state.nextActions ?? []).filter((a) => a.goalId === goalId);
}

export function actionsForWorkspace(state: StoreState, workspaceId: string): NextAction[] {
  return (state.nextActions ?? []).filter((a) => a.workspaceId === workspaceId);
}

/** Actions that reference a given record (any kind) via linkedEntityRefs. */
export function actionsReferencing(state: StoreState, kind: string, id: string): NextAction[] {
  return (state.nextActions ?? []).filter((a) => (a.linkedEntityRefs ?? []).some((r) => r.kind === kind && r.id === id));
}

/** A project's action counts by lifecycle bucket, plus how many are blocked. */
export interface ProjectActionSummary {
  open: number; inProgress: number; completed: number; cancelled: number; waiting: number; deferred: number; blocked: number; total: number;
  byMilestone: { milestoneId: string; open: number; completed: number; total: number }[];
  unassigned: number;
}

export function projectActionSummary(state: StoreState, projectId: string): ProjectActionSummary {
  const actions = actionsForProject(state, projectId);
  const map = new Map(actions.map((a) => [a.id, a] as const));
  const blockedBy = buildBlockedByMap(state.actionDependencies ?? []);
  const s: ProjectActionSummary = { open: 0, inProgress: 0, completed: 0, cancelled: 0, waiting: 0, deferred: 0, blocked: 0, total: actions.length, byMilestone: [], unassigned: 0 };
  const perMs = new Map<string, { open: number; completed: number; total: number }>();
  for (const a of actions) {
    if (a.status === "open") s.open += 1;
    else if (a.status === "in_progress") s.inProgress += 1;
    else if (a.status === "completed") s.completed += 1;
    else if (a.status === "cancelled") s.cancelled += 1;
    else if (a.status === "waiting") s.waiting += 1;
    else if (a.status === "deferred") s.deferred += 1;
    // blocked = has an unfinished blocker
    const blockers = blockedBy.get(a.id);
    if (blockers && [...blockers].some((bid) => { const b = map.get(bid) ?? actionById(state, bid); return b && b.status !== "completed" && b.status !== "cancelled"; })) s.blocked += 1;
    if (a.milestoneId) {
      const cur = perMs.get(a.milestoneId) ?? { open: 0, completed: 0, total: 0 };
      cur.total += 1;
      if (a.status === "completed") cur.completed += 1; else if (a.status === "open" || a.status === "in_progress") cur.open += 1;
      perMs.set(a.milestoneId, cur);
    } else s.unassigned += 1;
  }
  s.byMilestone = [...perMs.entries()].map(([milestoneId, v]) => ({ milestoneId, ...v }));
  return s;
}

/** Open actions attached to a milestone (used by milestone-completion confirmation). */
export function openActionsForMilestone(state: StoreState, milestoneId: string): NextAction[] {
  return actionsForMilestone(state, milestoneId).filter((a) => a.status === "open" || a.status === "in_progress" || a.status === "waiting");
}

/** Blocking + blocked neighbours of an action (existing endpoints only). */
export function dependencyNeighbours(state: StoreState, actionId: string): { blockers: NextAction[]; blocked: NextAction[] } {
  const deps = state.actionDependencies ?? [];
  const map = new Map((state.nextActions ?? []).map((a) => [a.id, a] as const));
  return {
    blockers: blockersOf(actionId, buildBlockedByMap(deps), map),
    blocked: blockedBy(actionId, buildBlocksMap(deps), map),
  };
}

/** The source records an action was created from (preserved references). */
export function actionSources(a: NextAction): RecordRefLite[] {
  const out: RecordRefLite[] = [];
  if (a.sourceCaptureId) out.push({ kind: "capture", id: a.sourceCaptureId });
  if (a.sourceReviewId) out.push({ kind: "daily_review", id: a.sourceReviewId });
  return out;
}

/**
 * The Today "Actions" projection (Feature 16): calm and compact — pinned + in
 * progress, due waiting follow-ups, deferred returning today, and the single
 * most-recent incomplete action. No overdue-guilt, no scores.
 */
export interface TodayActionsView {
  pinned: NextAction[];
  inProgress: NextAction[];
  waitingDue: NextAction[];
  returningToday: NextAction[];
  mostRecentIncomplete?: NextAction;
  next?: NextAction;
  totalOpen: number;
}

export function todayActions(state: StoreState, today: DayKey = todayKey()): TodayActionsView {
  const actions = state.nextActions ?? [];
  const incomplete = actions.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  const mostRecentIncomplete = [...incomplete].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return {
    pinned: actions.filter((a) => a.pinned && a.status !== "completed" && a.status !== "cancelled"),
    inProgress: actions.filter((a) => a.status === "in_progress"),
    waitingDue: dueFollowUps(actions, today),
    returningToday: returningToday(actions, today),
    mostRecentIncomplete,
    next: nextToStart(state),
    totalOpen: incomplete.length,
  };
}

/**
 * The daily-review action projection (Feature 14): what happened to actions on a
 * given local day. Reports only; completing a review changes no action.
 */
export interface DailyActionsView {
  createdToday: NextAction[];
  startedToday: NextAction[];
  completedToday: NextAction[];
  deferredToday: NextAction[];
  stillInProgress: NextAction[];
  waitingFollowUps: NextAction[];
  overdueReturns: NextAction[];
}

export function dailyActions(state: StoreState, day: DayKey = todayKey()): DailyActionsView {
  const actions = state.nextActions ?? [];
  const startedOn = (a: NextAction) => a.history.some((e) => e.action === "started" && isoOnLocalDay(e.at, day));
  const deferredOn = (a: NextAction) => a.history.some((e) => e.action === "deferred" && isoOnLocalDay(e.at, day));
  return {
    createdToday: actions.filter((a) => isoOnLocalDay(a.createdAt, day)),
    startedToday: actions.filter(startedOn),
    completedToday: actions.filter((a) => a.completedAt && isoOnLocalDay(a.completedAt, day)),
    deferredToday: actions.filter(deferredOn),
    stillInProgress: actions.filter((a) => a.status === "in_progress"),
    waitingFollowUps: dueFollowUps(actions, day),
    overdueReturns: actions.filter((a) => isDue(a, day)),
  };
}
