/**
 * Capacity view (LIFEOS-037, Feature 9).
 *
 * A deterministic capacity SUMMARY — counts only, never a workload score. The
 * user may set soft limits per category; exceeding one shows neutral language
 * ("7 selected, preferred limit 5") and NEVER blocks the user. No estimation.
 */

import type { StoreState, PlanningHorizon } from "@/types/mvp";

export type CapacityCategory =
  | "today" | "this_week" | "in_progress" | "waiting" | "active_projects"
  | "active_milestones" | "reading" | "open_loops";

export const CAPACITY_LABEL: Record<CapacityCategory, string> = {
  today: "Today items",
  this_week: "This Week items",
  in_progress: "In-progress actions",
  waiting: "Waiting actions",
  active_projects: "Active projects",
  active_milestones: "Active milestones",
  reading: "Selected reading",
  open_loops: "Open loops",
};

export interface CapacityRow {
  category: CapacityCategory;
  count: number;
  /** Soft limit (0/undefined = no limit). */
  limit?: number;
  /** True when count > limit (a preference, not a block). */
  exceeded: boolean;
}

/** Deterministic counts per category. `limits` are the user's soft preferences. */
export function capacitySummary(state: StoreState, limits: Partial<Record<CapacityCategory, number>> = {}): CapacityRow[] {
  const assignments = state.planningAssignments ?? [];
  const inHorizon = (h: PlanningHorizon) => assignments.filter((a) => a.horizon === h).length;
  const actions = state.nextActions ?? [];
  const readingSelected = assignments.filter((a) => a.ref.kind === "document").length;
  const openLoopsSelected = assignments.filter((a) => a.ref.kind === "open_loop").length;

  const counts: Record<CapacityCategory, number> = {
    today: inHorizon("today"),
    this_week: inHorizon("this_week"),
    in_progress: actions.filter((a) => a.status === "in_progress").length,
    waiting: actions.filter((a) => a.status === "waiting").length,
    active_projects: (state.projects ?? []).filter((p) => p.status === "active").length,
    active_milestones: (state.projects ?? []).flatMap((p) => (p.status === "active" ? p.milestones : [])).filter((m) => m.status !== "done").length,
    reading: readingSelected,
    open_loops: openLoopsSelected,
  };

  return (Object.keys(counts) as CapacityCategory[]).map((category) => {
    const limit = limits[category];
    const count = counts[category];
    return { category, count, limit, exceeded: typeof limit === "number" && limit > 0 && count > limit };
  });
}

/** Neutral over-limit message ("7 selected, preferred limit 5"). Empty when within limit. */
export function capacityMessage(row: CapacityRow): string {
  if (!row.exceeded || !row.limit) return "";
  return `${row.count} selected, preferred limit ${row.limit}`;
}
