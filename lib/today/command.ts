/**
 * The daily command view — one day, composed (LIFEOS-083 §5, §22).
 *
 * ## What this is NOT
 *
 * Not a third derivation of the day. `buildTodayView` already produces the
 * schedule, the waiting list and the recommendation, and `buildDailyExecutiveView`
 * already composes the review. This adds the two things the audit found missing
 * from the daily surface and nothing else:
 *
 *   - the LIFEOS-082 attention shortlist, which shipped reachable only through
 *     Memory — its own report said so
 *   - LIFEOS-081's "since yesterday", which no daily surface reads at all
 *
 * …plus the dedup precedence that lets both appear without saying one thing
 * three times.
 *
 * ## The dedup rule (§22, §23)
 *
 * The audit's finding was that an overdue action can legitimately belong to
 * Today (it has a date), to Next (it is the recommendation) and to Attention
 * (it is overdue). Three cards for one task is the guilt wall §16 forbids.
 *
 * So the precedence is:
 *
 *   1. **NEXT wins** the primary recommended action.
 *   2. **FIXED wins** anything with a place on the schedule.
 *   3. **ATTENTION suppresses its own card** when the entity is already shown
 *      by either — and its explanation moves onto that row as an INLINE REASON.
 *
 * The third clause is what makes this safe: §23 warns against hiding useful
 * evidence, and nothing is hidden. "Overdue since yesterday" appears on the row
 * the user is already looking at instead of on a second card below it. The
 * reason travels; only the duplicate card goes.
 *
 * ## No new ranking (§2)
 *
 * Nothing here orders anything. `buildTodayView` ordered the schedule,
 * `recommendNextAction` chose the recommendation, `buildAttentionShortlist`
 * ordered and capped the shortlist. This composes their outputs and suppresses
 * duplicates. There is no score in this file and no way to add one without
 * writing a comparator that does not currently exist.
 *
 * ## Pure
 *
 * A function of `(state, ix, view, today)`. No store writes, no clock of its
 * own, no network, no AI (§26).
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { TodayView } from "@/lib/today/view";
import { resolveRange } from "@/lib/insights/range";
import {
  buildAttentionShortlist, ATTENTION_DEFAULT_LIMIT,
  type ExecutiveAttentionItem,
} from "@/lib/guidance/attention";
import { buildExecutiveChanges, type ExecutiveChange, type ExecutiveChangeKind } from "@/lib/memory/changes";
import { isLive } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";

/**
 * Changes worth putting on the daily surface (§11).
 *
 * A deliberately short list. §11 says "do not show typo edits" — the executive
 * change model already refuses those — but it also means not everything the
 * model can prove belongs on a morning screen. Adding a task yesterday is not
 * news; finishing one is. Deferring is not news on the day-after; it is already
 * represented by the item still being open.
 *
 * So: things that FINISHED, waits that ENDED, and changes of DIRECTION. Those
 * are §11's own four examples, and nothing else earns the space.
 */
export const SINCE_YESTERDAY_KINDS: readonly ExecutiveChangeKind[] = [
  "completed",
  "recurring_completed",
  "waiting_ended",
  "goal_status_changed",
  "goal_horizon_changed",
  "goal_target_changed",
  "goal_replaced",
  "rule_adopted",
  "rule_revised",
  "rule_retired",
];

/** §11's cap. Three is a glance; ten is a changelog. */
export const SINCE_YESTERDAY_LIMIT = 3;

/** Why an attention card was not rendered. Kept so tests can assert the rule. */
export interface SuppressedAttention {
  /** The attention item's stable id. */
  id: string;
  entityId: string;
  /** `next` or `fixed` — which section already shows this entity. */
  because: "next" | "fixed";
}

export interface DailyCommandView {
  today: DayKey;
  /**
   * The shortlist, minus anything already prominent elsewhere.
   *
   * Capped by `buildAttentionShortlist` before suppression, so suppressing a
   * duplicate does not promote a fourth item into its place — the cap is about
   * how much a person is asked to hold, not about filling three slots.
   */
  attention: ExecutiveAttentionItem[];
  /**
   * Entity id → the one-sentence reason that would have been its attention card.
   *
   * Rendered inline on the Today or Next row for that entity (§23). This is how
   * suppression loses no evidence.
   */
  inlineReasons: Record<string, string>;
  /** Cards that were suppressed, and which section won. For tests and the report. */
  suppressed: SuppressedAttention[];
  /** §11. What actually moved since yesterday. */
  sinceYesterday: ExecutiveChange[];
  /**
   * §14. One calm, grounded line — or nothing.
   *
   * Never "you can ignore X", and never a low-priority score. Only two
   * sentences are possible and both are arithmetic over records.
   */
  canWait?: string;
}

/**
 * Compose the day.
 *
 * `view` is passed in rather than rebuilt: `TodayCommandCenter` already has one,
 * and building a second would pay for the whole index pass twice on every
 * render (§35).
 */
export function buildDailyCommandView(
  state: StoreState,
  ix: TodayIndexes,
  view: TodayView,
  today: DayKey,
): DailyCommandView {
  const shortlist = buildAttentionShortlist(state, ix, today, { limit: ATTENTION_DEFAULT_LIMIT });

  // ---- who already has a prominent row? (§22) -----------------------------
  const nextId = view.suggestion.recommendation?.action.id;
  const fixedIds = new Set<string>([
    ...view.dueToday.map((a) => a.id),
    ...view.recurringToday.map((r) => r.action.id),
    ...view.alsoToday.map((a) => a.id),
  ]);

  const attention: ExecutiveAttentionItem[] = [];
  const inlineReasons: Record<string, string> = {};
  const suppressed: SuppressedAttention[] = [];

  for (const item of shortlist) {
    const id = item.entity.id;
    const because: SuppressedAttention["because"] | null =
      id === nextId ? "next" : fixedIds.has(id) ? "fixed" : null;

    if (because) {
      suppressed.push({ id: item.id, entityId: id, because });
      // The reason travels to the row that won (§23). Nothing is lost.
      inlineReasons[id] = item.explanation;
      continue;
    }
    attention.push(item);
  }

  // ---- §11: what moved since yesterday -----------------------------------
  //
  // Yesterday 00:00 through the end of today, so a morning opener sees
  // yesterday's evening and an evening opener sees the whole of both.
  const range = resolveRange("custom", { today, customStart: shiftDay(today, -1), customEnd: today });
  const sinceYesterday = buildExecutiveChanges(state, range)
    .filter((c) => SINCE_YESTERDAY_KINDS.includes(c.kind))
    // Most recent first: on a daily surface the newest change is the one being
    // caught up on. (The change model orders oldest-first for a timeline, which
    // is right there and wrong here.)
    .reverse()
    .slice(0, SINCE_YESTERDAY_LIMIT);

  return {
    today,
    attention,
    inlineReasons,
    suppressed,
    sinceYesterday,
    canWait: calmLine(state, view, today),
  };
}

/**
 * The one grounded calming line, or nothing (§14).
 *
 * Two sentences are possible, both arithmetic:
 *
 *   "Nothing else is due today."        — when the schedule is clear
 *   "N open items are scheduled later." — when it is not empty, just not now
 *
 * There is no third. In particular there is no sentence that names something
 * the user could skip: §14 forbids inferring "you can ignore X", and this
 * function has no access to a notion of importance with which to try.
 */
export function calmLine(state: StoreState, view: TodayView, today: DayKey): string | undefined {
  const scheduledLater = (state.nextActions ?? []).filter((a) => {
    if (!isLive(a)) return false;
    const due = a.dueDate;
    if (due && due > today) return true;
    // A deferral to a later day is a scheduling decision the user made, and it
    // is exactly what "scheduled later" means.
    return isDeferredAhead(a, today);
  }).length;

  const fixedCount = view.occurrences.length + view.dueToday.length + view.recurringToday.length;
  if (fixedCount === 0 && view.overdue.length === 0) {
    return scheduledLater > 0
      ? `Nothing is due today. ${scheduledLater} open ${scheduledLater === 1 ? "item is" : "items are"} scheduled later.`
      : "Nothing is due today.";
  }
  if (scheduledLater > 0) {
    return `${scheduledLater} open ${scheduledLater === 1 ? "item is" : "items are"} scheduled later.`;
  }
  return undefined;
}

function shiftDay(day: DayKey, delta: number): DayKey {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10) as DayKey;
}

/** Section heading for recent change. Plain, and not a greeting (§20). */
export const SINCE_YESTERDAY_HEADING = "Since yesterday";

/** Every string this layer can render, for the language sweep. */
export function commandStrings(v: DailyCommandView): string[] {
  return [
    SINCE_YESTERDAY_HEADING,
    v.canWait ?? "",
    ...Object.values(v.inlineReasons),
    ...v.attention.flatMap((a) => [a.title, a.explanation]),
    ...v.sinceYesterday.map((c) => c.title),
  ].filter(Boolean);
}
