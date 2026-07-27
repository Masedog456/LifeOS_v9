/**
 * Project model & derivations (LIFEOS-031, Features 2 & 8).
 *
 * A Project is concrete work that belongs to a Goal (optional) and lives in a
 * Workspace (optional). It holds Milestones (embedded) and references — never
 * copies — its related documents and entities. Pure, deterministic derivations
 * over `StoreState`; no AI.
 */

import type { ExecProjectStatus, ExecutionPriority, Project, StoreState } from "@/types/mvp";
import { entityRef, type EntityContext, type EntityRef } from "@/lib/entities/entity";
import { projectProgress } from "@/lib/execution/progress";

export const PROJECT_KIND = "project";

export const PROJECT_STATUS_LABEL: Record<ExecProjectStatus, string> = {
  planned: "Planned", active: "Active", paused: "Paused", completed: "Completed", abandoned: "Abandoned",
};
const PRIORITY_RANK: Record<ExecutionPriority, number> = { high: 0, medium: 1, low: 2 };

export function projectHref(id: string): string {
  return `/project/${id}`;
}

export function projectRef(project: Project): EntityRef {
  return { kind: PROJECT_KIND, id: project.id, title: project.title || "Untitled project", href: projectHref(project.id), exists: true };
}

export function findProject(state: StoreState, id: string | undefined): Project | undefined {
  if (!id) return undefined;
  return (state.projects ?? []).find((p) => p.id === id);
}

/** All projects, highest priority first, then most-recently-updated (stable). */
export function listProjects(state: StoreState): Project[] {
  return [...(state.projects ?? [])].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.title.localeCompare(b.title),
  );
}

/** Projects a user is still working on (not completed or abandoned). */
export function activeProjects(state: StoreState): Project[] {
  return listProjects(state).filter((p) => p.status !== "completed" && p.status !== "abandoned");
}

export function projectsForGoal(state: StoreState, goalId: string): Project[] {
  return listProjects(state).filter((p) => p.goalId === goalId);
}

export function projectsForWorkspace(state: StoreState, workspaceId: string): Project[] {
  return listProjects(state).filter((p) => p.workspaceId === workspaceId);
}

/** Which projects reference an entity (as a related entity or document). */
export function entityProjects(state: StoreState, kind: string, id: string): Project[] {
  return (state.projects ?? []).filter(
    (p) =>
      p.relatedEntities.some((r) => r.kind === kind && r.id === id) ||
      p.relatedDocuments.some((r) => r.kind === kind && r.id === id),
  );
}

export function isEntityRelated(project: Project, kind: string, id: string): boolean {
  return (
    project.relatedEntities.some((r) => r.kind === kind && r.id === id) ||
    project.relatedDocuments.some((r) => r.kind === kind && r.id === id)
  );
}

/** Live-resolved related references for a project (existing only, deduped). */
export function projectRelated(ctx: EntityContext, project: Project): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const r of [...project.relatedEntities, ...project.relatedDocuments]) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = entityRef(ctx, r.kind, r.id);
    if (ref.exists) out.push(ref);
  }
  return out;
}

/** A short deterministic summary line for a project card. */
export function projectSummary(project: Project): string {
  if (project.description.trim()) return project.description.trim();
  const pct = projectProgress(project);
  const m = project.milestones.length;
  return `${pct}% · ${m} milestone${m === 1 ? "" : "s"}`;
}
