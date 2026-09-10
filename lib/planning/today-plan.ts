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

import type { StoreState, RecordRefLite, PlanningAssignment, ReviewFocusItem } from "@/types/mvp";
import { todayKey, addDays, type DayKey } from "@/lib/reviews/dates";
import { assignmentsIn, refKey } from "@/lib/planning/horizon";
import { todayActions } from "@/lib/actions/relationships";
import { isOwnMoveNow } from "@/lib/actions/lifecycle";

/**
 * The focus items a review deliberately chose for `day`, and only those.
 *
 * A review carries the date it was WRITTEN; its `tomorrowFocus` is about the
 * day after. So the review that speaks for today is the one dated yesterday —
 * not "the latest review", which on a day with no review yesterday would reach
 * back arbitrarily far, and which is what let January speak for September.
 */
export function focusChosenFor(state: StoreState, day: DayKey): ReviewFocusItem[] {
  const target = addDays(day, -1);
  const speaking = (state.dailyReviews ?? [])
    .filter((r) => r.date === target)
    // One review per date is the rule; this only orders duplicates from
    // imported data, and it does so by write time rather than array position.
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return speaking.length > 0 ? (speaking[0].tomorrowFocus ?? []) : [];
}

/**
 * Is the record a focus item points at still the user's own move?
 *
 * The same question every other clause in this file already asks through
 * `todayActions`. A focus item is a note about a record; it cannot keep that
 * record on today's plan after the record itself has been finished, handed to
 * someone else, or explicitly put off (LIFEOS-105 §12, §40).
 *
 * Non-action refs — a project, a document, a goal — are left alone: their
 * lifecycle is not `NextAction`'s, and this function has no opinion about them.
 */
export function focusIsStillLive(state: StoreState, ref: RecordRefLite, day: DayKey = todayKey()): boolean {
  if (ref.kind !== "action") return true;
  const a = (state.nextActions ?? []).find((x) => x.id === ref.id);
  // A reference to a record that no longer exists is suppressed rather than
  // guessed at. `planningInbox` already reports these as `focus_ref_missing`.
  if (!a) return false;
  return isOwnMoveNow(a, day);
}

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

  // 3. Tomorrow-focus, from the ONE review that actually targeted today.
  //
  // This clause said "the most recent review whose target is today" and then
  // iterated every review the store has ever held, with no date filter and no
  // lifecycle filter. Measured on the real projection: a focus item chosen on
  // 2026-01-04 still entered the plan eight months later, and a focused record
  // that had since been completed, cancelled, set to waiting or deferred to a
  // later day entered it too — all of them reaching `/today` itself, because
  // the Plan card there renders `todayPlan`.
  //
  // Every other clause above goes through `todayActions`, which drops finished
  // work. This was the one source of five that filtered nothing.
  //
  // "Tomorrow" is the review's own date plus one day: a review written on the
  // 6th is choosing the 7th. When several reviews somehow target the same day,
  // the latest-written one wins — reviews are keyed one-per-date, so this is a
  // tie-break for imported or corrupted data rather than a routine path, and it
  // is stated rather than left to array order.
  for (const f of focusChosenFor(state, today)) {
    if (!f.ref) continue;
    if (!focusIsStillLive(state, f.ref, today)) continue;
    add(f.ref, "tomorrow_focus", DERIVED + 4);
  }

  const items = [...byKey.values()].sort((a, b) => a.order - b.order || refKey(a.ref).localeCompare(refKey(b.ref)));
  return { items, assignedCount: assigned.length };
}
