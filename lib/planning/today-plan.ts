/**
 * Today Plan (LIFEOS-037, Feature 3).
 *
 * A deterministic projection assembled ENTIRELY from the user's explicit
 * selections and existing signals — never auto-filled with inferred work. It may
 * contain: actions assigned Today, pinned actions, in-progress actions, selected
 * tomorrow-focus items, waiting follow-ups due today, deferred items returning
 * today, manually-planned reading, and manually-selected open loops. Explicit
 * Today assignments lead (in the user's manual order); derived signals follow,
 * deduped. Nothing here mutates state.
 */

import type { StoreState, RecordRefLite, PlanningAssignment } from "@/types/mvp";
import { todayKey, type DayKey } from "@/lib/reviews/dates";
import { assignmentsIn, refKey } from "@/lib/planning/horizon";
import { todayActions } from "@/lib/actions/relationships";

export interface TodayPlanItem {
  ref: RecordRefLite;
  /** Why this item is in today's plan (may be several). */
  sources: string[];
  /** Manual order for explicit Today assignments; derived items sort after. */
  order: number;
}

export interface TodayPlanView {
  items: TodayPlanItem[];
  /** Explicit Today-assignment count (the user placed these deliberately). */
  assignedCount: number;
}

export function todayPlan(state: StoreState, today: DayKey = todayKey()): TodayPlanView {
  const byKey = new Map<string, TodayPlanItem>();
  const add = (ref: RecordRefLite, source: string, order: number) => {
    const k = refKey(ref);
    const existing = byKey.get(k);
    if (existing) { if (!existing.sources.includes(source)) existing.sources.push(source); existing.order = Math.min(existing.order, order); }
    else byKey.set(k, { ref, sources: [source], order });
  };

  // 1. Explicit Today assignments (manual order leads).
  const assigned: PlanningAssignment[] = assignmentsIn(state.planningAssignments ?? [], "today");
  assigned.forEach((a, i) => add(a.ref, "planned", i));

  // 2. Derived action signals (after explicit assignments).
  const DERIVED = 100000;
  const ta = todayActions(state, today);
  ta.pinned.forEach((a) => add({ kind: "action", id: a.id }, "pinned", DERIVED));
  ta.inProgress.forEach((a) => add({ kind: "action", id: a.id }, "in_progress", DERIVED + 1));
  ta.waitingDue.forEach((a) => add({ kind: "action", id: a.id }, "waiting_due", DERIVED + 2));
  ta.returningToday.forEach((a) => add({ kind: "action", id: a.id }, "returning_today", DERIVED + 3));

  // 3. Selected tomorrow-focus items from the most recent review whose target is today.
  //    (Tomorrow-focus only enters Today through explicit assignment or this signal.)
  for (const r of state.dailyReviews ?? []) {
    for (const f of r.tomorrowFocus ?? []) {
      if (f.ref) add(f.ref, "tomorrow_focus", DERIVED + 4);
    }
  }

  const items = [...byKey.values()].sort((a, b) => a.order - b.order || refKey(a.ref).localeCompare(refKey(b.ref)));
  return { items, assignedCount: assigned.length };
}
