/**
 * Milestone helpers (LIFEOS-031, Feature 3).
 *
 * Pure helpers over a project's embedded milestones. Completion is MANUAL ONLY —
 * these helpers read and order; the store toggles `status`/`completedDate`. No
 * inference, no AI.
 */

import type { Milestone, Project } from "@/types/mvp";

export const MILESTONE_STATUS_LABEL: Record<Milestone["status"], string> = { open: "Open", done: "Done" };

/** Milestones ordered by target date (undated last), then creation order. */
export function sortedMilestones(project: Project): Milestone[] {
  return [...project.milestones].sort((a, b) => {
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate) return -1;
    if (b.targetDate) return 1;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

/** The next open milestone (by order), if any. */
export function nextOpenMilestone(project: Project): Milestone | undefined {
  return sortedMilestones(project).find((m) => m.status === "open");
}

export function isMilestoneDone(m: Milestone): boolean {
  return m.status === "done";
}

/** Find which project a milestone belongs to. */
export function projectOfMilestone(projects: Project[], milestoneId: string): Project | undefined {
  return projects.find((p) => p.milestones.some((m) => m.id === milestoneId));
}
