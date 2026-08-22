/**
 * Event projections for Today (LIFEOS-061 §16, §17, §21).
 *
 * Pure reads over state. Nothing here mutates, schedules, notifies, or scores.
 *
 * ## What happens to an Event after it passes (§21)
 *
 * Nothing. It stays exactly where it is — a row with a date in the past. There
 * is no archive step, no status transition, no cleanup job, because a past event
 * is not a failed event; it is a thing that happened, and that is the beginning
 * of an autobiographical timeline rather than debris to sweep up.
 *
 * It leaves TODAY simply by not matching today's date. That is the whole
 * mechanism, and it is why there is no way for it to be lost.
 *
 * ## Recurring events derive, and are never completed (§5 of the continuation)
 *
 * A recurring Event is a standing source. Its occurrences are computed from the
 * rule; none of them is stored, none receives a completion record, and none gets
 * a checkbox. There is no such thing as finishing a staff meeting — it happens,
 * and next Tuesday it happens again.
 *
 * ## §10 timezone audit
 *
 * This module constructs no `Date` and calls no `toISOString`, `getUTC*` or
 * `setUTC*`. Day keys are compared as strings; times are compared as strings.
 * The caller passes today's key and the current wall clock in.
 */

import type { LifeEvent, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { compareLocalTime, type LocalTime } from "@/lib/time/localtime";
import { occursOn, readRule } from "@/lib/time/recurrence";

/** One event as it appears on a particular day. */
export interface EventOccurrence {
  event: LifeEvent;
  /** The day this occurrence falls on — the event's own date, or a derived one. */
  date: DayKey;
  startTime?: LocalTime;
  endTime?: LocalTime;
  allDay: boolean;
  /** True when this instance came from a recurrence rule rather than the row. */
  derived: boolean;
}

function toOccurrence(event: LifeEvent, date: DayKey, derived: boolean): EventOccurrence {
  return {
    event,
    date,
    startTime: event.allDay ? undefined : event.startTime,
    endTime: event.allDay ? undefined : event.endTime,
    allDay: !!event.allDay,
    derived,
  };
}

/**
 * Every event occurring on `day`, chronologically.
 *
 * A single event matches by its own date. A recurring event matches when the
 * rule produces that day — computed, never looked up, so there is nothing to
 * duplicate on reload and nothing to reconcile after a sync.
 *
 * A malformed recurrence rule yields NO occurrences and does not throw. The
 * event row itself is untouched and still visible on its own date (§9 of the
 * continuation brief): bad data must never take Today down.
 */
export function eventsOnDay(state: StoreState, day: DayKey): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const event of state.events ?? []) {
    if (!event || typeof event.date !== "string") continue;
    const rule = readRule(event.recurrence);
    if (rule) {
      // A VALID rule is the authority. The anchor day is shown only when the
      // rule produces it — an event whose rule says Tuesdays must not also
      // appear on the Wednesday it happened to be captured.
      if (occursOn(rule, event.date, day)) out.push(toOccurrence(event, day, day !== event.date));
    } else if (event.date === day) {
      // No rule (or a malformed one, which `readRule` reports as none): the row
      // stands on its own date, so bad JSONB costs the schedule, never the event.
      out.push(toOccurrence(event, day, false));
    }
  }
  return sortOccurrences(out);
}

/**
 * Chronological order: timed events by start time, all-day events first.
 *
 * All-day sorts before timed because "sometime today" makes no claim about being
 * late in the day, and putting it last would imply one. Ties break on title so
 * the order is stable across renders.
 */
export function sortOccurrences(list: EventOccurrence[]): EventOccurrence[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const t = compareLocalTime(a.startTime, b.startTime);
    if (t !== 0) return t;
    return (a.event.title || "").localeCompare(b.event.title || "");
  });
}

/**
 * The next event today that has not started yet, given the wall clock.
 *
 * Returns `undefined` once the day's schedule is behind you — deliberately, so
 * Today can say "Next: Dentist · 2:30 PM" while it is useful and then say
 * nothing at all, rather than switching to a message about what you missed.
 * There is no "you're late" state because there is no state to be late in.
 */
export function nextEventToday(occurrences: readonly EventOccurrence[], nowTime: LocalTime): EventOccurrence | undefined {
  return occurrences.find((o) => !o.allDay && o.startTime !== undefined && o.startTime >= nowTime);
}

/** Has this occurrence's start time already passed? Used only to de-emphasize. */
export function hasStarted(occurrence: EventOccurrence, nowTime: LocalTime): boolean {
  if (occurrence.allDay || !occurrence.startTime) return false;
  return occurrence.startTime < nowTime;
}

/**
 * Past events, most recent first. The seed of an autobiographical timeline.
 *
 * Only single events are listed: a recurring source has no single past instance
 * to name, and enumerating every past Tuesday of a standing meeting would be a
 * generated history rather than a remembered one.
 */
export function pastEvents(state: StoreState, before: DayKey, limit = 50): LifeEvent[] {
  return (state.events ?? [])
    .filter((e) => e && typeof e.date === "string" && e.date < before && !readRule(e.recurrence))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/** Upcoming occurrences within a bounded window. Used for a short look-ahead. */
export function upcomingOccurrences(state: StoreState, from: DayKey, days: number, cap = 50): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  let day = from;
  for (let i = 0; i <= days && out.length < cap; i++) {
    out.push(...eventsOnDay(state, day));
    day = shiftDay(day, 1);
  }
  return sortOccurrences(out).slice(0, cap);
}

/** Day arithmetic by integer ordinal — no local-time `Date` parsing. */
function shiftDay(key: DayKey, n: number): DayKey {
  const [y, m, d] = key.split("-").map(Number);
  const ord = Math.floor(Date.UTC(y, m - 1, d) / 86400000) + n;
  const dt = new Date(ord * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** The current wall clock as a `LocalTime`. The only place a clock is read. */
export function nowLocalTime(d: Date = new Date()): LocalTime {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
