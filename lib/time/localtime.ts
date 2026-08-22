/**
 * Local time of day (LIFEOS-061 §7, §10).
 *
 * ## The representation, and why
 *
 * `HH:mm`, 24-hour, zero-padded, validated. Chosen over `minutesSinceMidnight`
 * for three reasons:
 *
 *  1. **It sorts lexicographically.** `"09:00" < "14:30" < "19:00"` is a string
 *     compare, so Today orders a day's schedule without parsing anything in the
 *     render path.
 *  2. **It is readable where it lives** — in the database, in an export, in a
 *     backup someone opens in a text editor five years from now.
 *  3. **It invites no arithmetic.** An integer minute count begs to be added to
 *     a timestamp, and that is the first step toward the timezone logic this
 *     sprint explicitly does not have.
 *
 * ## No timezone, anywhere
 *
 * A `LocalTime` is a WALL-CLOCK reading, not an instant. "2:30 PM" means what the
 * clock on the wall says, wherever the person is. It is never converted to UTC,
 * never combined with a date to make a `Date`, and never adjusted for DST.
 *
 * That is not a limitation being deferred — it is the correct model for a
 * local-first personal product. An appointment at 2:30 does not move because you
 * travelled; it is at 2:30 where you are.
 *
 * **§10 audit:** this module constructs no `Date` and calls no `toISOString`,
 * `getUTC*` or `setUTC*`. All arithmetic is integer arithmetic on hours and
 * minutes.
 *
 * ## Pure
 */

/** A wall-clock time of day, `HH:mm`, 24-hour. Never an instant. */
export type LocalTime = string;

/** Matches 00:00 through 23:59. `24:00` is deliberately NOT valid (§11). */
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Is this a valid local time?
 *
 * `24:00` is rejected rather than normalised to `00:00`. The two mean different
 * days, and quietly picking one would be exactly the kind of invented precision
 * this sprint forbids. A caller who means midnight writes `00:00`; a caller who
 * means end-of-day writes `23:59`.
 */
export function isLocalTime(v: unknown): v is LocalTime {
  return typeof v === "string" && LOCAL_TIME_RE.test(v);
}

/** Parse to minutes since midnight, or `null`. Used only for comparison. */
export function minutesOf(t: LocalTime): number | null {
  const m = LOCAL_TIME_RE.exec(t ?? "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Build a validated `LocalTime` from integers, or `null` if impossible. */
export function makeLocalTime(hours: number, minutes: number): LocalTime | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Chronological comparison. Lexicographic on the canonical form, which is why
 * the canonical form is zero-padded.
 */
export function compareLocalTime(a: LocalTime | undefined, b: LocalTime | undefined): number {
  // An untimed item sorts before a timed one: "sometime today" is not a claim
  // about being late in the day, and putting it last would imply one.
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Human display, e.g. `14:30` → `2:30 PM`.
 *
 * 12-hour because that is how the product's other copy reads. The STORED value
 * is always 24-hour; this is presentation only, and nothing round-trips through
 * it.
 */
export function formatLocalTime(t: LocalTime): string {
  const mins = minutesOf(t);
  if (mins === null) return "";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Parse a human time phrase into a `LocalTime`.
 *
 * Handles the forms §14 names: `2 PM`, `2:30 PM`, `14:30`, `noon`, `midnight`,
 * and the bare `at 11` that "class at 11" produces.
 *
 * ## The no-meridiem rule
 *
 * "at 7" and "at 7:30" with no meridiem are ambiguous, and the honest options are to refuse it
 * or to adopt a stated convention. Refusing loses the most common way people
 * write times in a hurry, so this adopts a convention and states it: **a bare
 * hour from 1 to 7 is read as PM, 8 to 12 as AM** — with or without minutes.
 * "Dinner at 7" is 19:00, "at 2:30" is 14:30, "class at 11" is 11:00. The convention is documented, tested, and the parsed
 * time is always shown back to the user before anything is created — so a wrong
 * reading is visible and one tap from being fixed, never silent.
 */
export function parseLocalTime(phrase: string): LocalTime | null {
  const t = (phrase ?? "").toLowerCase().replace(/\s+/g, " ").trim().replace(/^at\s+/, "");
  if (!t) return null;

  if (/^noon|^12\s*(?:noon)$/.test(t)) return "12:00";
  if (/^midnight$/.test(t)) return "00:00";

  // 14:30 / 2:30 pm / 2:30
  const withMinutes = /^(\d{1,2}):([0-5]\d)\s*(am|pm)?$/.exec(t);
  if (withMinutes) {
    let h = Number(withMinutes[1]);
    const m = Number(withMinutes[2]);
    const mer = withMinutes[3];
    if (mer) {
      if (h < 1 || h > 12) return null;
      h = mer === "pm" ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    } else if (h > 23) {
      return null;
    } else if (h >= 1 && h <= 7) {
      // Same convention as a bare hour, and for the same reason: "at 2:30" means
      // the afternoon. Applying the rule to bare integers but not to H:MM would
      // read "at 7" as 19:00 and "at 7:30" as 07:30 — inconsistent, and wrong
      // twelve hours out of twenty-four.
      h += 12;
    }
    return makeLocalTime(h, m);
  }

  // 2 pm / 2pm
  const withMeridiem = /^(\d{1,2})\s*(am|pm)$/.exec(t);
  if (withMeridiem) {
    let h = Number(withMeridiem[1]);
    if (h < 1 || h > 12) return null;
    h = withMeridiem[2] === "pm" ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    return makeLocalTime(h, 0);
  }

  // A bare hour — see the convention above.
  const bare = /^(\d{1,2})$/.exec(t);
  if (bare) {
    const h = Number(bare[1]);
    if (h < 1 || h > 12) return null;
    return makeLocalTime(h >= 1 && h <= 7 ? h + 12 : h === 12 ? 12 : h, 0);
  }

  return null;
}

/**
 * Is an end time valid for a start time on the same day?
 *
 * Same-day only. An event running 23:00 → 01:00 crosses midnight and this sprint
 * has no model for that, so it is REJECTED rather than silently reordered into
 * 01:00 → 23:00 (a 22-hour event nobody asked for). The limitation is stated in
 * the UI and deferred honestly (§12).
 */
export function isValidTimeRange(start: LocalTime | undefined, end: LocalTime | undefined): boolean {
  if (!end) return true;
  if (!isLocalTime(end)) return false;
  if (!start) return false; // an end with no start describes nothing
  if (!isLocalTime(start)) return false;
  return end >= start;
}

/** Why a start/end pair was refused. Shown to the user, never swallowed. */
export function timeRangeError(start: LocalTime | undefined, end: LocalTime | undefined): string | null {
  if (!end) return null;
  if (!isLocalTime(end)) return "That end time isn't a valid time.";
  if (!start) return "An end time needs a start time.";
  if (!isLocalTime(start)) return "That start time isn't a valid time.";
  if (end < start) return "Events that run past midnight aren't supported yet.";
  return null;
}
