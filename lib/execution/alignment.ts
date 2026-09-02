/**
 * Alignment as evidence, not as a score (LIFEOS-078).
 *
 * ## The rule this module exists to hold
 *
 * There is no alignment percentage, no goal score, no momentum number and no
 * confidence rating. Every field below is a COUNT of records the user created
 * or a DATE something actually happened. If a fact cannot be pointed at in the
 * store, it is not reported.
 *
 * That is not squeamishness about numbers. A number like "72% aligned" reads as
 * a measurement and is really a formula's opinion, and a person deciding what
 * to do with a year deserves to know which it is. "3 active projects, 5 open
 * actions, last worked on Aug 12" is smaller and true.
 *
 * ## What connects a goal to work
 *
 * `Project.goalId` and `NextAction.goalId` — both already exist. An action
 * reaches a goal either directly or through its project, and both routes count,
 * because the user created both links deliberately.
 *
 * Pure and deterministic over `StoreState`; no clock beyond the `today` the
 * caller passes.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import { dayDiff, todayKey, type DayKey } from "@/lib/reviews/dates";

/** Statuses that mean a commitment is still live work. */
const OPEN_ACTION: ReadonlySet<NextAction["status"]> =
  new Set<NextAction["status"]>(["open", "in_progress", "waiting", "deferred"]);

/** How far back "recently completed" looks. Named, not hidden in a comparison. */
export const GOAL_RECENT_WINDOW_DAYS = 30;

export interface GoalAlignmentFacts {
  goalId: string;
  /** Projects linked to this goal, by status. Counts only. */
  projects: { total: number; active: number; completed: number };
  /** Actions reaching this goal directly or through a project. Counts only. */
  actions: { open: number; completedRecently: number };
  /** The most recent date any linked record was created, updated or completed. */
  lastActivityDay?: DayKey;
  /** Days since `lastActivityDay`, when there is one. A count, not a judgement. */
  quietDays?: number;
  /**
   * True when the goal is being pursued and NOTHING active carries it forward.
   * A fact about the records, not a verdict about the person.
   */
  pathMissing: boolean;
}

/** The projects linked to a goal. */
export function goalLinkedProjects(state: StoreState, goalId: string): Project[] {
  return (state.projects ?? []).filter((p) => p.goalId === goalId);
}

/**
 * The actions that reach a goal — directly, or through one of its projects.
 *
 * Deduplicated by id: an action that names both the goal and one of its
 * projects is ONE commitment, and counting it twice would inflate every number
 * on this page.
 */
export function goalLinkedActions(state: StoreState, goalId: string): NextAction[] {
  const projectIds = new Set(goalLinkedProjects(state, goalId).map((p) => p.id));
  const seen = new Set<string>();
  const out: NextAction[] = [];
  for (const a of state.nextActions ?? []) {
    const reaches = a.goalId === goalId || (a.projectId ? projectIds.has(a.projectId) : false);
    if (!reaches || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

const dayOf = (iso: string | undefined): DayKey | undefined =>
  iso && iso.length >= 10 ? (iso.slice(0, 10) as DayKey) : undefined;

/**
 * Everything the store can honestly say about how a goal is being pursued.
 *
 * `pathMissing` is the one derived judgement, and it is deliberately narrow:
 * the goal is `active`, and it has no `active` project. A paused goal is not
 * missing a path — the user paused it. A goal whose only projects are completed
 * is not missing a path either in the sense that matters; it is a goal whose
 * work is done and whose status has simply not been changed, and saying "no
 * active project" about it is still literally true, which is why the wording
 * stays factual rather than becoming "this goal is stuck".
 */
export function goalAlignmentFacts(
  state: StoreState, goal: Goal, today: DayKey = todayKey(),
): GoalAlignmentFacts {
  const projects = goalLinkedProjects(state, goal.id);
  const actions = goalLinkedActions(state, goal.id);

  const activeProjects = projects.filter((p) => p.status === "active");
  const completedProjects = projects.filter((p) => p.status === "completed");

  const open = actions.filter((a) => OPEN_ACTION.has(a.status));
  const completedRecently = actions.filter((a) => {
    if (a.status !== "completed") return false;
    const day = dayOf(a.completedAt ?? a.updatedAt);
    return !!day && day <= today && dayDiff(today, day) <= GOAL_RECENT_WINDOW_DAYS;
  });

  const days: DayKey[] = [];
  for (const p of projects) { const d = dayOf(p.updatedAt); if (d) days.push(d); }
  for (const a of actions) {
    const d = dayOf(a.completedAt ?? a.updatedAt);
    if (d) days.push(d);
  }
  const goalDay = dayOf(goal.updatedAt);
  if (goalDay) days.push(goalDay);
  const lastActivityDay = days.sort().pop();

  return {
    goalId: goal.id,
    projects: { total: projects.length, active: activeProjects.length, completed: completedProjects.length },
    actions: { open: open.length, completedRecently: completedRecently.length },
    lastActivityDay,
    quietDays: lastActivityDay && lastActivityDay < today ? dayDiff(today, lastActivityDay) : undefined,
    pathMissing: goal.status === "active" && activeProjects.length === 0,
  };
}

/**
 * Goals being pursued with nothing active carrying them forward.
 *
 * Distinct from `project_no_next_action`, which asks the same question one
 * level down and is reused unchanged. This one is about the level above: a
 * direction with no work under it at all.
 */
export function goalsMissingPath(state: StoreState, today: DayKey = todayKey()): Goal[] {
  return (state.goals ?? []).filter((g) => goalAlignmentFacts(state, g, today).pathMissing);
}

// ------------------------------------------------------------- Today ancestry

export interface ActionAncestry {
  goal?: Goal;
  project?: Project;
}

/**
 * Which goal (and project) an action serves.
 *
 * Reads the links the user made and nothing else. When an action names a
 * project whose goal was deleted, the project is reported and the goal is
 * absent — the product says what it can verify, and no more.
 */
export function actionAncestry(state: StoreState, action: NextAction): ActionAncestry {
  const project = action.projectId
    ? (state.projects ?? []).find((p) => p.id === action.projectId)
    : undefined;
  const goalId = action.goalId ?? project?.goalId;
  const goal = goalId ? (state.goals ?? []).find((g) => g.id === goalId) : undefined;
  return { goal, project };
}

/**
 * "Supports [Goal] through [Project]" — or nothing at all.
 *
 * Returns undefined when there is no link to state, so a caller cannot render
 * an empty ancestry line. It never mentions a horizon: horizon does not
 * influence what Today suggests, and printing it in an explanation would imply
 * it did.
 */
export function ancestryExplanation(state: StoreState, action: NextAction): string | undefined {
  const { goal, project } = actionAncestry(state, action);
  if (goal && project) return `Supports ${goal.title} through ${project.title}.`;
  if (goal) return `Supports ${goal.title}.`;
  if (project) return `Part of ${project.title}.`;
  return undefined;
}
