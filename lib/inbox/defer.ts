/**
 * Defer semantics (LIFEOS-035, Feature 9).
 *
 * A capture can be deferred until a specific LOCAL date, tomorrow, next week, or
 * "someday". Deferred captures leave the active inbox; when their local date
 * arrives they return to the inbox. "Someday" has no date and stays deferred
 * until the user manually restores it. Deterministic local-date handling (reusing
 * LIFEOS-034 `dates.ts`); no notifications, no background workers, no recurrence.
 */

import type { Capture } from "@/types/mvp";
import { todayKey, addDays, weekStartKey, type DayKey } from "@/lib/reviews/dates";

export type DeferOption = "tomorrow" | "next_week" | "someday" | { date: DayKey };

/** The `deferredUntil` key for a defer option (undefined = "someday", no date). */
export function deferKeyFor(option: DeferOption, today: DayKey = todayKey()): DayKey | undefined {
  if (option === "someday") return undefined;
  if (option === "tomorrow") return addDays(today, 1);
  if (option === "next_week") return addDays(weekStartKey(today), 7); // next Monday
  return option.date;
}

/** Is a deferred capture due to return on `today` (date-based, not someday)? */
export function isDue(c: Capture, today: DayKey = todayKey()): boolean {
  return c.processingStatus === "deferred" && typeof c.deferredUntil === "string" && c.deferredUntil <= today;
}

/** Is this a dateless "someday" deferral? */
export function isSomeday(c: Capture): boolean {
  return c.processingStatus === "deferred" && !c.deferredUntil;
}

/** Deferred captures returning today (for the Today card / daily review). */
export function returningToday(captures: Capture[], today: DayKey = todayKey()): Capture[] {
  return captures.filter((c) => c.processingStatus === "deferred" && c.deferredUntil === today);
}

/**
 * Return all DUE deferred captures to the inbox. Pure: yields the next captures
 * array plus the ids that were returned (empty when nothing is due). Someday
 * deferrals are never auto-returned. Called on hydrate and view.
 */
export function returnDueDefers(captures: Capture[], today: DayKey = todayKey()): { captures: Capture[]; returnedIds: string[] } {
  const returnedIds: string[] = [];
  const next = captures.map((c) => {
    if (isDue(c, today)) {
      returnedIds.push(c.id);
      return { ...c, processingStatus: "inbox" as const, deferredUntil: undefined };
    }
    return c;
  });
  return { captures: returnedIds.length ? next : captures, returnedIds };
}

export const DEFER_LABEL: Record<string, string> = {
  tomorrow: "Tomorrow",
  next_week: "Next week",
  someday: "Someday",
};
