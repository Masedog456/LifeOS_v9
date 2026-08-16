/**
 * Due dates (LIFEOS-053) — the minimal time model.
 *
 * Pure and deterministic: this module classifies and orders, it never mutates,
 * never schedules, and never notifies. Every function takes `today` explicitly so
 * day-boundary behavior is testable rather than dependent on when the suite runs.
 *
 * ## Date-only, on purpose
 *
 * A due date is a `DayKey` ("yyyy-mm-dd") compared with the same local-date
 * helpers Capture deferral and Daily Review already use (`lib/reviews/dates.ts`).
 * Two consequences worth stating, because both are behaviors and not accidents:
 *
 *  - **String comparison is date comparison.** `"2026-08-14" < "2026-08-16"` is
 *    true lexicographically and chronologically, so no parsing happens on the hot
 *    path and no `Date` object is constructed to answer "is this overdue?".
 *  - **No timezone shift can move a deadline by a day.** Nothing here converts to
 *    UTC or back. A due date set on the 22nd is the 22nd in Denver, in Tokyo, and
 *    across a DST transition, because it is never an instant to begin with.
 *
 * ## What this module refuses to do
 *
 * It does not change an action's status when a date arrives. An overdue action is
 * still `open`; the user decides what happens next. This mirrors the rule
 * `waiting.ts` already established for follow-ups — surface, never act.
 */

import type { NextAction } from "@/types/mvp";
import { todayKey, dayDiff, formatDayKey, type DayKey } from "@/lib/reviews/dates";

/**
 * How near a due date is, relative to a given day.
 *
 * `overdue` is a factual bucket, not a verdict — see `DUE_LABEL`. The product
 * says "Due Friday" and "Was due Friday", never "you are behind".
 */
export type DueBucket = "overdue" | "today" | "tomorrow" | "soon" | "later" | "none";

/** Days ahead that still count as "soon" (the Upcoming window). */
export const UPCOMING_WINDOW_DAYS = 7;

/** Is an action still live? Completed/cancelled work is never due or overdue. */
export function isLive(a: NextAction): boolean {
  return a.status !== "completed" && a.status !== "cancelled";
}

/** A live action's due date, or undefined. Completed work has no due date. */
export function dueKeyOf(a: NextAction): DayKey | undefined {
  if (!isLive(a)) return undefined;
  const d = a.dueDate;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

/**
 * Classify how near an action's due date is.
 *
 * Completed and cancelled actions always classify as `none`: finishing something
 * late should remove it from view, not leave it accusing the user forever.
 */
export function dueBucket(a: NextAction, today: DayKey = todayKey(), windowDays = UPCOMING_WINDOW_DAYS): DueBucket {
  const due = dueKeyOf(a);
  if (!due) return "none";
  const delta = dayDiff(due, today);
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  if (delta === 1) return "tomorrow";
  if (delta <= windowDays) return "soon";
  return "later";
}

/**
 * Plain-language wording for a bucket.
 *
 * "Was due" rather than "overdue by 4 days!" is the whole point: the fact is
 * stated once, in the past tense, without an exclamation or a count that reads
 * as a scolding. The product's calm premise has to survive contact with
 * deadlines, which is exactly where most tools abandon it.
 */
export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Was due",
  today: "Due today",
  tomorrow: "Due tomorrow",
  soon: "Due soon",
  later: "Due later",
  none: "",
};

/** A short, human due label for one action ("Due today", "Was due Mon, Aug 10"). */
export function dueLabel(a: NextAction, today: DayKey = todayKey()): string {
  const due = dueKeyOf(a);
  if (!due) return "";
  const bucket = dueBucket(a, today);
  if (bucket === "today" || bucket === "tomorrow") return DUE_BUCKET_LABEL[bucket];
  if (bucket === "overdue") return `Was due ${formatDayKey(due)}`;
  return `Due ${formatDayKey(due)}`;
}

/** Live actions that are overdue, soonest-first. */
export function overdueActions(actions: NextAction[], today: DayKey = todayKey()): NextAction[] {
  return sortByDue(actions.filter((a) => dueBucket(a, today) === "overdue"), today);
}

/** Live actions due exactly today. */
export function dueTodayActions(actions: NextAction[], today: DayKey = todayKey()): NextAction[] {
  return sortByDue(actions.filter((a) => dueBucket(a, today) === "today"), today);
}

/**
 * Live actions due within the upcoming window, EXCLUDING today and anything
 * overdue — those need attention now and belong to Today, not to a preview of
 * what is coming. Keeping them out is what stops Upcoming from restating Today.
 */
export function upcomingActions(
  actions: NextAction[],
  today: DayKey = todayKey(),
  windowDays = UPCOMING_WINDOW_DAYS,
): NextAction[] {
  return sortByDue(
    actions.filter((a) => {
      const b = dueBucket(a, today, windowDays);
      return b === "tomorrow" || b === "soon";
    }),
    today,
  );
}

/** Live actions with no due date at all — a normal and common state. */
export function undatedActions(actions: NextAction[]): NextAction[] {
  return actions.filter((a) => isLive(a) && !dueKeyOf(a));
}

/**
 * Order by due date ascending, then by the action's manual order, then id.
 *
 * Undated actions sort last rather than first: a date is a stronger signal than
 * its absence, but the absence is not a defect. The `order` tiebreak preserves
 * the user's own arrangement within a single day, so adding dates never silently
 * reshuffles a queue the user arranged by hand.
 */
export function sortByDue(actions: NextAction[], today: DayKey = todayKey()): NextAction[] {
  void today;
  return actions.slice().sort((a, b) => {
    const da = dueKeyOf(a), db = dueKeyOf(b);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
  });
}

export interface DueSummary {
  overdue: number;
  today: number;
  upcoming: number;
  /** Combined count needing attention now (overdue + due today). */
  needsAttention: number;
}

/** Counts for the Today surface. Pure; nothing here is stored. */
export function dueSummary(
  actions: NextAction[],
  today: DayKey = todayKey(),
  windowDays = UPCOMING_WINDOW_DAYS,
): DueSummary {
  const overdue = overdueActions(actions, today).length;
  const dueToday = dueTodayActions(actions, today).length;
  return {
    overdue,
    today: dueToday,
    upcoming: upcomingActions(actions, today, windowDays).length,
    needsAttention: overdue + dueToday,
  };
}

/**
 * Words that must never describe a due or overdue item.
 *
 * A deadline is the easiest place for a calm product to start nagging, so the
 * ban established for Return (LIFEOS-052) is extended here and asserted by tests.
 * "Was due" is a fact. "You're behind" is a judgment.
 */
export const DUE_FORBIDDEN_WORDS = [
  "you're behind", "you are behind", "failed", "neglected", "shame",
  "you forgot", "don't break", "streak", "late again", "slipping",
];

/** True when copy is free of scolding language. */
export function isNeutralDueLanguage(text: string): boolean {
  const lower = (text ?? "").toLowerCase();
  return !DUE_FORBIDDEN_WORDS.some((w) => lower.includes(w));
}
