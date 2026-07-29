/**
 * Planning horizons (LIFEOS-037, Feature 1).
 *
 * A horizon expresses *when the user has chosen to work on something* — it is
 * NOT a deadline, due date, or priority, and nothing ever moves a record between
 * horizons automatically. Deterministic helpers over `PlanningAssignment[]`;
 * a record has at most one assignment (its current horizon).
 */

import type { PlanningAssignment, PlanningHorizon, RecordRefLite } from "@/types/mvp";

export const HORIZONS: PlanningHorizon[] = ["today", "this_week", "later", "someday", "unscheduled"];

export const HORIZON_LABEL: Record<PlanningHorizon, string> = {
  today: "Today",
  this_week: "This Week",
  later: "Later",
  someday: "Someday",
  unscheduled: "Unscheduled",
};

/** Board column order (unscheduled last — it's the "not yet placed" bucket). */
export const BOARD_COLUMNS: PlanningHorizon[] = ["today", "this_week", "later", "someday", "unscheduled"];

/** Record kinds that may carry a planning horizon (Features 1, 14, 15). */
export const PLANNABLE_KINDS = new Set(["action", "milestone", "project", "document", "open_loop", "capture"]);

export function isPlannable(kind: string): boolean {
  return PLANNABLE_KINDS.has(kind);
}

/** A stable string key for a record reference (dedupe / lookup). */
export function refKey(ref: RecordRefLite): string {
  return `${ref.kind}:${ref.id}`;
}

/** The assignment for a given record, if any. */
export function assignmentFor(assignments: PlanningAssignment[], ref: RecordRefLite): PlanningAssignment | undefined {
  return assignments.find((a) => a.ref.kind === ref.kind && a.ref.id === ref.id);
}

/** The horizon a record currently sits in (`unscheduled` when unassigned). */
export function horizonOf(assignments: PlanningAssignment[], ref: RecordRefLite): PlanningHorizon {
  return assignmentFor(assignments, ref)?.horizon ?? "unscheduled";
}

/** All assignments in a horizon, in manual order. */
export function assignmentsIn(assignments: PlanningAssignment[], horizon: PlanningHorizon): PlanningAssignment[] {
  return assignments
    .filter((a) => a.horizon === horizon)
    .sort((x, y) => x.order - y.order || x.createdAt.localeCompare(y.createdAt));
}

/** Build a fast ref-key → assignment index (for large boards). */
export function assignmentIndex(assignments: PlanningAssignment[]): Map<string, PlanningAssignment> {
  const m = new Map<string, PlanningAssignment>();
  for (const a of assignments) m.set(refKey(a.ref), a);
  return m;
}
