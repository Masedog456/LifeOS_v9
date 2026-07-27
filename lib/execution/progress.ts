/**
 * Deterministic progress engine (LIFEOS-031, Feature 7).
 *
 * Progress is DERIVED, never inferred as complete. A project's progress comes
 * from its completed milestones (or its explicit status when it has none); a
 * goal's progress is the average of its projects' progress. An optional
 * `manualProgress` (0–100) always wins when the user has set one. Nothing here
 * ever flips a status to "completed" — completion is always a manual act. Pure,
 * offline, no AI, no auto-planning.
 */

import type { Goal, Milestone, Project } from "@/types/mvp";

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export interface MilestoneCounts { total: number; done: number; open: number }

export function milestoneCounts(project: Project): MilestoneCounts {
  const total = project.milestones.length;
  const done = project.milestones.filter((m) => m.status === "done").length;
  return { total, done, open: total - done };
}

/**
 * A project's progress (0–100). Manual override wins; otherwise derived from
 * completed milestones; a project with no milestones is 100 only when its status
 * is explicitly "completed", else 0. Status is never changed here.
 */
export function projectProgress(project: Project): number {
  if (typeof project.manualProgress === "number") return clampPct(project.manualProgress);
  const { total, done } = milestoneCounts(project);
  if (total > 0) return clampPct((done / total) * 100);
  return project.status === "completed" ? 100 : 0;
}

/** Whether a project counts as "done" for goal roll-up (explicit status only). */
export function isProjectComplete(project: Project): boolean {
  return project.status === "completed";
}

/**
 * A goal's progress (0–100). Manual override wins; otherwise the average of its
 * (non-abandoned) projects' progress. A goal with no live projects is 100 only
 * when its status is explicitly "completed", else 0.
 */
export function goalProgress(goal: Goal, projects: Project[]): number {
  if (typeof goal.manualProgress === "number") return clampPct(goal.manualProgress);
  const live = projects.filter((p) => p.goalId === goal.id && p.status !== "abandoned");
  if (live.length === 0) return goal.status === "completed" ? 100 : 0;
  const sum = live.reduce((acc, p) => acc + projectProgress(p), 0);
  return clampPct(sum / live.length);
}

/** Aggregate milestone counts across a goal's projects (for its dashboard). */
export function goalMilestoneCounts(goal: Goal, projects: Project[]): MilestoneCounts {
  return projects
    .filter((p) => p.goalId === goal.id)
    .reduce<MilestoneCounts>(
      (acc, p) => {
        const c = milestoneCounts(p);
        return { total: acc.total + c.total, done: acc.done + c.done, open: acc.open + c.open };
      },
      { total: 0, done: 0, open: 0 },
    );
}

/** Project completion counts for a goal (explicit-status roll-up). */
export function goalProjectCounts(goal: Goal, projects: Project[]): { total: number; completed: number } {
  const owned = projects.filter((p) => p.goalId === goal.id);
  return { total: owned.length, completed: owned.filter(isProjectComplete).length };
}

/** A newly-toggled milestone list with the completedDate stamped/cleared. */
export function toggleMilestoneDone(m: Milestone, nowIso: string): Milestone {
  const done = m.status !== "done";
  return { ...m, status: done ? "done" : "open", completedDate: done ? nowIso : undefined, updatedAt: nowIso };
}
