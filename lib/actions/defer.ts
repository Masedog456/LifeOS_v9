/**
 * Action defer semantics (LIFEOS-036, Feature 9).
 *
 * An action can be deferred until tomorrow, next week, a specific LOCAL date, or
 * "someday". Deferred actions leave the "Next" queue; when their local date
 * arrives they become eligible for Next again while RETAINING their status
 * history. "Someday" has no date and stays deferred until the user restores it.
 * Reuses LIFEOS-034 `dates.ts` — the same local-date semantics as capture
 * processing and daily reviews. No notifications, no background workers, no
 * recurrence.
 */

import type { NextAction } from "@/types/mvp";
import { todayKey, addDays, weekStartKey, type DayKey } from "@/lib/reviews/dates";
import { makeEvent, appendHistory } from "@/lib/actions/history";

export type DeferOption = "tomorrow" | "next_week" | "someday" | { date: DayKey };

export const DEFER_LABEL: Record<string, string> = {
  tomorrow: "Tomorrow",
  next_week: "Next week",
  someday: "Someday",
};

/** The `deferredUntil` key for a defer option (undefined = "someday"). */
export function deferKeyFor(option: DeferOption, today: DayKey = todayKey()): DayKey | undefined {
  if (option === "someday") return undefined;
  if (option === "tomorrow") return addDays(today, 1);
  if (option === "next_week") return addDays(weekStartKey(today), 7); // next Monday
  return option.date;
}

/** Is a deferred action due to return (date-based, not someday)? */
export function isDue(a: NextAction, today: DayKey = todayKey()): boolean {
  return a.status === "deferred" && typeof a.deferredUntil === "string" && a.deferredUntil <= today;
}

/** Is this a dateless "someday" deferral? */
export function isSomeday(a: NextAction): boolean {
  return a.status === "deferred" && !a.deferredUntil;
}

/** Deferred actions returning today (for the Today card / daily review). */
export function returningToday(actions: NextAction[], today: DayKey = todayKey()): NextAction[] {
  return actions.filter((a) => a.status === "deferred" && a.deferredUntil === today);
}

/**
 * A due deferred action returns to `open` (eligible for Next).
 *
 * ## The return leaves evidence, and it does so HERE
 *
 * Returning clears `deferredUntil` — correctly, because the deferral is over and
 * a stale date would be a lie about the record's current state. That means the
 * ONLY durable trace of the return is the `returned` history event, so this
 * function writes it rather than trusting callers to.
 *
 * LIFEOS-070's audit found why that matters: the store had two return paths, and
 * the manual one appended the event while the HYDRATE one did not. Since hydrate
 * runs on every load, a deferral that came back left no trace at all, and Today's
 * "returned from deferral" signal — which tested the cleared `deferredUntil` —
 * could never fire. Both bugs came from the same shape: evidence written beside
 * the transition instead of by it. Now the branch that could forget does not
 * exist.
 *
 * Pure: yields the next actions array plus the returned ids. Someday deferrals
 * (no date) never auto-return.
 */
export function returnDueActions(
  actions: NextAction[],
  today: DayKey = todayKey(),
  at: string = new Date().toISOString(),
): { actions: NextAction[]; returnedIds: string[] } {
  const returnedIds: string[] = [];
  const next = actions.map((a) => {
    if (!isDue(a, today)) return a;
    returnedIds.push(a.id);
    // `detail` carries the day the deferral was set to return on — the fact that
    // makes "returned from deferral today" checkable against the record later.
    const returned = { ...a, status: "open" as const, deferredUntil: undefined };
    return appendHistory(
      returned,
      makeEvent({ action: "returned", at, fromStatus: "deferred", toStatus: "open", detail: a.deferredUntil }),
    );
  });
  return { actions: returnedIds.length ? next : actions, returnedIds };
}
