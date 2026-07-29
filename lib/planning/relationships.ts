/**
 * Planning relationships & projections (LIFEOS-037).
 *
 * Deterministic read-only derivations connecting planning assignments and focus
 * sessions to records and to the inspector / daily-review surfaces. Pure over
 * `StoreState`. No inference, scoring, or prioritization.
 */

import type { StoreState, RecordRefLite, FocusSession, PlanningHistoryEvent } from "@/types/mvp";
import { todayKey, isoOnLocalDay, type DayKey } from "@/lib/reviews/dates";
import { assignmentFor, horizonOf } from "@/lib/planning/horizon";

/** The inspector planning block for a record (Feature 18). */
export interface PlanningInspectorInfo {
  horizon: ReturnType<typeof horizonOf>;
  order?: number;
  planned: boolean;
  history: PlanningHistoryEvent[];
  inTodayPlan: boolean;
}

export function planningInfoFor(state: StoreState, ref: RecordRefLite): PlanningInspectorInfo {
  const assignments = state.planningAssignments ?? [];
  const a = assignmentFor(assignments, ref);
  return {
    horizon: horizonOf(assignments, ref),
    order: a?.order,
    planned: !!a,
    history: a?.history ?? [],
    inTodayPlan: a?.horizon === "today",
  };
}

/** Focus sessions whose target is a given record (Feature 18 focus history). */
export function focusHistoryFor(state: StoreState, ref: RecordRefLite): FocusSession[] {
  return (state.focusSessions ?? [])
    .filter((f) => f.ref.kind === ref.kind && f.ref.id === ref.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The daily-review planning projection (Feature 13). Reports only; changes nothing. */
export interface DailyPlanningView {
  todayCompleted: RecordRefLite[];
  todayOpen: RecordRefLite[];
  movedToday: PlanningHistoryEvent[];
  focusSessions: FocusSession[];
  interruptionsCount: number;
}

export function dailyPlanning(state: StoreState, day: DayKey = todayKey()): DailyPlanningView {
  const assignments = state.planningAssignments ?? [];
  const actions = state.nextActions ?? [];
  const todayRefs = assignments.filter((a) => a.horizon === "today").map((a) => a.ref);
  const isComplete = (ref: RecordRefLite): boolean => {
    if (ref.kind === "action") { const a = actions.find((x) => x.id === ref.id); return a?.status === "completed"; }
    if (ref.kind === "milestone") { for (const p of state.projects ?? []) { const m = p.milestones.find((x) => x.id === ref.id); if (m) return m.status === "done"; } }
    return false;
  };
  const movedToday: PlanningHistoryEvent[] = [];
  for (const a of assignments) for (const e of a.history) if ((e.action === "moved" || e.action === "planned") && isoOnLocalDay(e.at, day)) movedToday.push(e);
  const focusSessions = (state.focusSessions ?? []).filter((f) => isoOnLocalDay(f.startedAt, day));
  const interruptionsCount = focusSessions.reduce((n, f) => n + (f.interruptions?.length ?? 0), 0);

  return {
    todayCompleted: todayRefs.filter(isComplete),
    todayOpen: todayRefs.filter((r) => !isComplete(r)),
    movedToday,
    focusSessions,
    interruptionsCount,
  };
}
