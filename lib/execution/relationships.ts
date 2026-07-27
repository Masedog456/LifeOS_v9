/**
 * Entity ↔ execution relationships (LIFEOS-031, Feature 8).
 *
 * Surfaces, for any entity, the Goals and Projects it contributes to / is
 * related to — and, for a goal or project entity, what it contains. Pure
 * derivations over `StoreState` used by the unified inspector's ContextPanel.
 * No AI.
 */

import type { StoreState } from "@/types/mvp";
import { entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { GOAL_KIND, entityGoals, goalRef, goalProjects } from "@/lib/execution/goals";
import { PROJECT_KIND, entityProjects, projectRef, findProject } from "@/lib/execution/projects";
import { findGoal } from "@/lib/execution/goals";

export interface ExecutionLinks {
  /** Goals this entity contributes to (via linked knowledge). */
  contributesToGoals: EntityRef[];
  /** Projects this entity is related to. */
  relatedProjects: EntityRef[];
  /** For a project/goal entity: the goal it belongs to (project) or nothing. */
  parentGoal?: EntityRef;
  /** For a goal entity: its projects. For a project entity: nothing here. */
  childProjects: EntityRef[];
}

export function entityExecutionLinks(ctx: EntityContext, kind: string, id: string): ExecutionLinks {
  const state: StoreState = ctx.state;
  const links: ExecutionLinks = { contributesToGoals: [], relatedProjects: [], childProjects: [] };

  if (kind === GOAL_KIND) {
    const goal = findGoal(state, id);
    if (goal) links.childProjects = goalProjects(state, id).map(projectRef);
    return links;
  }
  if (kind === PROJECT_KIND) {
    const project = findProject(state, id);
    if (project?.goalId) {
      const g = findGoal(state, project.goalId);
      if (g) links.parentGoal = goalRef(g);
    }
    return links;
  }

  links.contributesToGoals = entityGoals(state, kind, id).map(goalRef);
  links.relatedProjects = entityProjects(state, kind, id).map(projectRef);
  return links;
}

/** Whether an entity has any execution links (for conditional UI). */
export function hasExecutionLinks(ctx: EntityContext, kind: string, id: string): boolean {
  const l = entityExecutionLinks(ctx, kind, id);
  return l.contributesToGoals.length > 0 || l.relatedProjects.length > 0 || Boolean(l.parentGoal) || l.childProjects.length > 0;
}

/** Resolve a mixed reference list to existing entity refs (helper for UI). */
export function resolveRefs(ctx: EntityContext, refs: { kind: string; id: string }[]): EntityRef[] {
  const out: EntityRef[] = [];
  for (const r of refs) {
    const ref = entityRef(ctx, r.kind, r.id);
    if (ref.exists) out.push(ref);
  }
  return out;
}
