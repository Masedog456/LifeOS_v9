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
 * Whether a project's progress rests on something countable (LIFEOS-078).
 *
 * Milestones, an explicit completion, or the user's own override. Anything else
 * makes `projectProgress` return 0 meaning "nothing recorded", which is the
 * absence of evidence rather than a measurement of zero.
 */
export function projectProgressMeasurable(project: Project): boolean {
  return typeof project.manualProgress === "number"
    || milestoneCounts(project).total > 0
    || project.status === "completed";
}

/**
 * A goal's progress (0–100), or `null` when it cannot be measured.
 *
 * Manual override wins. Otherwise it is the average of the goal's live
 * (non-abandoned) projects — the same arithmetic as before — but ONLY when
 * every one of them is measurable.
 *
 * The `null` is the LIFEOS-078 change, and it covers two cases that were both
 * fabrication:
 *
 *  1. A goal with no projects rendered as "0% complete" with a bar at zero.
 *     Nothing had been measured; the absence of evidence was being reported as
 *     a measurement, in the one place a person looks to ask whether their life
 *     is moving.
 *  2. An UNMEASURABLE project inside the average was worth zero. A goal with a
 *     finished project and a fresh one with no milestones came out at "50%",
 *     and half of that number was the same fabrication hiding inside a mean.
 *
 * Averaging only the measurable projects was rejected as the fix: it would
 * report that same goal as 100%, which overstates in the other direction. When
 * part of the picture is genuinely unknown, the honest answer is that the whole
 * is unknown — the counts on the goal page carry what IS known.
 *
 * A goal whose status is explicitly "completed" is still 100 with no projects,
 * because the user said so — that is a recorded fact, not a derivation.
 */
export function goalProgress(goal: Goal, projects: Project[]): number | null {
  if (typeof goal.manualProgress === "number") return clampPct(goal.manualProgress);
  const live = projects.filter((p) => p.goalId === goal.id && p.status !== "abandoned");
  if (live.length === 0 || !live.every(projectProgressMeasurable)) {
    return goal.status === "completed" ? 100 : null;
  }
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
