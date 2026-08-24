/**
 * The external calendar provider seam (LIFEOS-067 §5, §6, §10, §24, §25, §27).
 *
 * ## Why a seam and not a Google client
 *
 * There is no live Google Calendar path in this repository, and the reason is
 * architectural rather than missing effort:
 *
 *   1. `signInWithOAuth()` is on the FORBIDDEN list in `scripts/audit-auth.mjs`
 *      — *"creates accounts on first sign-in"* — and `npm run audit:security`
 *      is a release gate. Authentication-as-calendar-linking would fail the
 *      build by design, and that design is correct.
 *   2. Conqify authenticates with email magic-link / OTP only. There is no OAuth
 *      client, no token store, and no server route that could hold a client
 *      secret.
 *
 * A real connector needs an explicit ACCOUNT-LINK flow — separate from sign-in,
 * with its own consent, its own token storage, and read-only scope — which is a
 * sprint of its own. So this file defines the interface that flow will
 * implement, and ships one fixture provider that exercises every path.
 *
 * ## Read-only, least privilege (§15, §23)
 *
 * The interface has no write method. Not "a write method that throws" — no
 * member at all, so a future provider cannot quietly grow one without changing
 * this contract in a reviewable way. `REQUIRED_SCOPES` names read-only access
 * and nothing else: no contacts, no mail, no attendee details, no descriptions.
 *
 * ## Fetch results carry their own completeness (§27, §28)
 *
 * A fetch returns whether it saw everything. An error returns `complete: false`
 * with the events it did get, which reconciliation then refuses to treat as
 * authoritative absence. There is no code path where a failed read can delete
 * a user's schedule.
 */

import type { DayKey } from "@/lib/reviews/dates";
import {
  normalizeExternalEvent,
  type NormalizeOptions, type NormalizedExternalEvent,
  type RawExternalEvent, type RejectedExternalEvent,
} from "@/lib/calendar/external";

/** One calendar the user could choose to import (§24). */
export interface ExternalCalendar {
  id: string;
  /** The provider's display name. Shown in the picker; never a life record. */
  name: string;
  primary?: boolean;
}

/**
 * The minimum event fields a provider may request (§23).
 *
 * Not descriptions, not attendees, not organisers, not conferencing links, not
 * locations. A schedule projection needs to know WHEN something is; it does not
 * need to know who else is coming or what the meeting is about.
 */
export const MINIMUM_EVENT_FIELDS: readonly string[] = [
  "id", "summary", "start", "end", "recurrence", "status", "updated",
];

/** Read-only. A write scope is not requested because write-back does not exist. */
export const REQUIRED_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

export interface FetchWindow {
  fromDate: DayKey;
  toDate: DayKey;
}

export interface FetchResult {
  events: NormalizedExternalEvent[];
  rejected: RejectedExternalEvent[];
  /**
   * Did this fetch see EVERYTHING in the window?
   *
   * False for a partial page, a truncated result, or any error. Reconciliation
   * refuses to remove anything when this is false (§28).
   */
  complete: boolean;
  /** Present when the read failed. Existing events are never touched (§27). */
  error?: string;
}

/**
 * What a calendar provider must supply. **No write method, by construction.**
 */
export interface ExternalCalendarProvider {
  /** Stable transport name stored on the event (`"google"`). */
  readonly id: string;
  /** Shown in Settings. Not a life noun. */
  readonly label: string;
  listCalendars(): Promise<ExternalCalendar[]>;
  fetchEvents(calendarId: string, window: FetchWindow): Promise<FetchResult>;
}

// ------------------------------------------------------------ the window ----

/**
 * How much calendar to import (§25).
 *
 * 30 days back and 90 forward, and both numbers have a reason:
 *
 *   - **Back 30.** Week in Review looks at a week at a time and a user may open
 *     it a few weeks late. A month covers that with room to spare, and it is
 *     what makes an imported schedule useful for remembering rather than only
 *     for planning.
 *   - **Forward 90.** Today and Upcoming need the future, and a quarter covers
 *     the horizon on which people actually schedule appointments. Beyond it,
 *     calendars are mostly recurring rules — which are stored as RULES, not as
 *     occurrences, so a longer window buys almost nothing.
 *
 * Not "everything the API will give us". Ten years of history is a slower app,
 * a bigger export, and more of the user's life sitting in a database than the
 * feature needs.
 */
export const IMPORT_WINDOW_DAYS_BACK = 30;
export const IMPORT_WINDOW_DAYS_FORWARD = 90;

export function defaultWindow(today: DayKey): FetchWindow {
  const shift = (key: DayKey, days: number): DayKey => {
    const [y, m, d] = key.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  };
  return {
    fromDate: shift(today, -IMPORT_WINDOW_DAYS_BACK),
    toDate: shift(today, IMPORT_WINDOW_DAYS_FORWARD),
  };
}

// --------------------------------------------------------------- fixture ----

export interface FixtureCalendarData {
  calendars: ExternalCalendar[];
  /** Raw payloads per calendar id, exactly as a provider would hand them over. */
  events: Record<string, RawExternalEvent[]>;
  /** Simulate a read failure. */
  failWith?: string;
  /** Simulate an incomplete page — the §28 case. */
  partial?: boolean;
  normalizeOptions?: NormalizeOptions;
}

/**
 * A deterministic provider over fixture data.
 *
 * This is a TEST DOUBLE, and it is named one. It never claims a connection, and
 * `lib/calendar/settings.ts` will not present it as a connected account.
 */
export function fixtureProvider(data: FixtureCalendarData, id = "fixture"): ExternalCalendarProvider {
  return {
    id,
    label: "Fixture calendar",
    async listCalendars() { return data.calendars; },
    async fetchEvents(calendarId: string, window: FetchWindow): Promise<FetchResult> {
      if (data.failWith) {
        // §27. A failure returns NOTHING and says so. It does not return an
        // empty list, because an empty list that looks complete is how a read
        // error becomes a deletion.
        return { events: [], rejected: [], complete: false, error: data.failWith };
      }
      const raw = data.events[calendarId] ?? [];
      const events: NormalizedExternalEvent[] = [];
      const rejected: RejectedExternalEvent[] = [];
      for (const r of raw) {
        const result = normalizeExternalEvent(
          { ...r, provider: r.provider ?? id, externalCalendarId: r.externalCalendarId ?? calendarId },
          data.normalizeOptions ?? {},
        );
        if (result.ok) {
          const e = result.event;
          // A provider returns what it was asked for; the window is applied here
          // so fixtures behave like a real bounded query. A recurring event is
          // kept whichever way its anchor falls — the RULE spans the window even
          // when the anchor does not.
          if (e.recurrence || (e.date >= window.fromDate && e.date <= window.toDate)) events.push(e);
        } else {
          rejected.push(result.rejected);
        }
      }
      return { events, rejected, complete: !data.partial };
    },
  };
}
