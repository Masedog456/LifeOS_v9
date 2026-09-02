/**
 * Goal model & derivations (LIFEOS-031, Features 1 & 8).
 *
 * A Goal is the highest-level organizational object — "what am I trying to
 * accomplish?". It never copies the work it organizes: its projects are looked
 * up by `Project.goalId`, and `linkedWorkspaces`/`linkedKnowledge` are typed
 * references resolved live via the LIFEOS-029 entity API. Pure, deterministic
 * derivations over `StoreState`; no AI, no auto-prioritization.
 */

import type { ExecutionPriority, Goal, GoalStatus, Project, StoreState } from "@/types/mvp";
import { entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { goalProgress } from "@/lib/execution/progress";

export const GOAL_KIND = "goal";

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Active", paused: "Paused", completed: "Completed", abandoned: "Abandoned", someday: "Someday",
  // LIFEOS-078. A distinct outcome, not a synonym for abandoned: the goal is
  // still being pursued, under a truer description.
  replaced: "Replaced",
};
export const PRIORITY_LABEL: Record<ExecutionPriority, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_RANK: Record<ExecutionPriority, number> = { high: 0, medium: 1, low: 2 };

export function goalHref(id: string): string {
  return `/goal/${id}`;
}

export function goalRef(goal: Goal): EntityRef {
  return { kind: GOAL_KIND, id: goal.id, title: goal.title || "Untitled goal", href: goalHref(goal.id), exists: true };
}

export function findGoal(state: StoreState, id: string | undefined): Goal | undefined {
  if (!id) return undefined;
  return (state.goals ?? []).find((g) => g.id === id);
}

/** All goals, highest priority first, then most-recently-updated (stable). */
export function listGoals(state: StoreState): Goal[] {
  return [...(state.goals ?? [])].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.title.localeCompare(b.title),
  );
}

/**
 * Goals a user is still pursuing (not completed, abandoned or replaced).
 *
 * `replaced` is excluded because the pursuit continues in the SUCCESSOR — the
 * predecessor is history. Listing both would show one intention twice.
 */
export function activeGoals(state: StoreState): Goal[] {
  return listGoals(state).filter((g) => g.status !== "completed" && g.status !== "abandoned" && g.status !== "replaced");
}

/** The projects that belong to a goal (references — never copied). */
export function goalProjects(state: StoreState, goalId: string): Project[] {
  return (state.projects ?? []).filter((p) => p.goalId === goalId);
}

/** Which goals reference an entity through their linked knowledge (Feature 8). */
export function entityGoals(state: StoreState, kind: string, id: string): Goal[] {
  return (state.goals ?? []).filter((g) => g.linkedKnowledge.some((r) => r.kind === kind && r.id === id));
}

export function isGoalLinked(goal: Goal, kind: string, id: string): boolean {
  return goal.linkedKnowledge.some((r) => r.kind === kind && r.id === id);
}

/** Live-resolved linked-knowledge references for a goal (existing only). */
export function goalKnowledge(ctx: EntityContext, goal: Goal): EntityRef[] {
  const out: EntityRef[] = [];
  for (const r of goal.linkedKnowledge) {
    const ref = entityRef(ctx, r.kind, r.id);
    if (ref.exists) out.push(ref);
  }
  return out;
}

/**
 * A short deterministic summary line for a goal card.
 *
 * LIFEOS-078: this used to end "· 0% complete" for every goal with no
 * milestones — a measurement of nothing, printed as if something had been
 * measured. It now states the percentage only when one exists.
 */
export function goalSummary(state: StoreState, goal: Goal): string {
  if (goal.description.trim()) return goal.description.trim();
  const n = goalProjects(state, goal.id).length;
  const projects = `${n} project${n === 1 ? "" : "s"}`;
  const pct = goalProgress(goal, state.projects ?? []);
  return pct === null ? projects : `${projects} · ${pct}% complete`;
}
