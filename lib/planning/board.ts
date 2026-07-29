/**
 * Planning board (LIFEOS-037, Feature 2).
 *
 * Deterministic derivation of the five-column board from planning assignments.
 * Pure — viewing changes nothing, and a move changes ONLY the horizon + manual
 * order (never status, deadline, priority, or hierarchy; that is enforced by the
 * store actions, not here). Card metadata is resolved through an injected
 * resolver so this module stays independent of the entity API and testable.
 */

import type { PlanningAssignment, PlanningHorizon, RecordRefLite } from "@/types/mvp";
import { BOARD_COLUMNS, assignmentsIn } from "@/lib/planning/horizon";

/** Resolved display metadata for a planned record (from the entity API at runtime). */
export interface CardMeta {
  title: string;
  kind: string;
  href?: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  context?: string;
  tags?: string[];
  /** False when the referenced record no longer exists (orphaned assignment). */
  exists: boolean;
}

export type CardResolver = (ref: RecordRefLite) => CardMeta;

export interface PlanningCard {
  assignment: PlanningAssignment;
  meta: CardMeta;
}

export interface BoardFilter {
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  kind?: string;
  context?: string;
  tag?: string;
  text?: string;
  /** Hide orphaned (non-existent) references. Default false — they're shown so the user can clean up. */
  hideOrphans?: boolean;
}

export interface BoardColumn {
  horizon: PlanningHorizon;
  cards: PlanningCard[];
}

function matches(meta: CardMeta, f: BoardFilter): boolean {
  if (f.workspaceId && meta.workspaceId !== f.workspaceId) return false;
  if (f.goalId && meta.goalId !== f.goalId) return false;
  if (f.projectId && meta.projectId !== f.projectId) return false;
  if (f.kind && meta.kind !== f.kind) return false;
  if (f.context && meta.context !== f.context) return false;
  if (f.tag && !(meta.tags ?? []).includes(f.tag)) return false;
  if (f.hideOrphans && !meta.exists) return false;
  if (f.text) {
    const q = f.text.trim().toLowerCase();
    if (q && !`${meta.title} ${meta.kind} ${(meta.tags ?? []).join(" ")} ${meta.context ?? ""}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** The full board: five columns of cards in manual order, after filtering. */
export function deriveBoard(assignments: PlanningAssignment[], resolve: CardResolver, filter: BoardFilter = {}): BoardColumn[] {
  return BOARD_COLUMNS.map((horizon) => ({
    horizon,
    cards: assignmentsIn(assignments, horizon)
      .map((assignment) => ({ assignment, meta: resolve(assignment.ref) }))
      .filter((c) => matches(c.meta, filter)),
  }));
}

/** Per-column counts (unfiltered) for headers/badges. */
export function boardCounts(assignments: PlanningAssignment[]): Record<PlanningHorizon, number> {
  const counts: Record<PlanningHorizon, number> = { today: 0, this_week: 0, later: 0, someday: 0, unscheduled: 0 };
  for (const a of assignments) counts[a.horizon] += 1;
  return counts;
}

/**
 * The order value that places a record at the END of a horizon column. Used when
 * a record is first planned or moved into a column (max existing order + 1).
 */
export function nextOrderIn(assignments: PlanningAssignment[], horizon: PlanningHorizon): number {
  const inCol = assignments.filter((a) => a.horizon === horizon);
  return inCol.length ? Math.max(...inCol.map((a) => a.order)) + 1 : 0;
}
