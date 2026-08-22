/**
 * Simple recurrence (LIFEOS-061 §8, §9, §18, and the continuation brief).
 *
 * ## Occurrences are DERIVED, not stored
 *
 * A recurring item is a standing SOURCE — a rule plus an anchor date. The next
 * occurrence is a pure function of `(rule, anchor, completions, from)`. Nothing
 * writes a future row.
 *
 * Two devices computing the next occurrence compute the SAME value, so there is
 * no materialization race, no dedupe pass, and no cleanup job. **Purity provides
 * the uniqueness guarantee** rather than a constraint enforcing it after the
 * fact. Reloading cannot duplicate an occurrence because reloading recomputes
 * the same answer.
 *
 * What IS persisted is what actually happened: one small completion row per
 * occurrence the user finished, keyed `(actionId, occurrenceDate)`. That is the
 * only durable evidence anyone will ever want ("did I refill it last Sunday?"),
 * and it costs one row per event in the past instead of fifty-two in the future.
 *
 * ## Skipped, never clamped
 *
 * The two edge cases that decide whether a recurrence engine is trustworthy:
 *
 *  - **Monthly on the 31st SKIPS months without a 31st.** February gets no
 *    occurrence. It is not clamped to the 28th, the 29th, or the 30th.
 *  - **Yearly on February 29 occurs ONLY in leap years.** It does not slide to
 *    February 28 or March 1.
 *
 * Clamping is the popular choice and it is a lie: it produces an obligation on a
 * date the user never named. A person who said "the 31st" and sees February 28th
 * has been told something false about their own intention.
 *
 * ## No exceptions ontology
 *
 * No exclusion dates, no "third Thursday", no "end after N". Skipping a single
 * occurrence is **not supported** — see `SKIP_LIMITATION`. Adding exception
 * dates would be a second scheduling ontology, and this sprint deliberately has
 * one small one.
 *
 * ## §10 timezone audit
 *
 * This module constructs `Date` in exactly one place, `weekdayOf`, and only via
 * `Date.UTC(y, m, d)` with `getUTCDay()` — an integer weekday computation whose
 * input and output are both integers. No local-time parsing (`new Date("...")`),
 * no `toISOString`, no timezone conversion. Every date VALUE it returns is built
 * by string arithmetic in `keyOf`. A persisted or displayed date can therefore
 * not shift by a timezone.
 *
 * ## Pure
 */

import type { DayKey } from "@/lib/reviews/dates";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export const FREQUENCIES: readonly Frequency[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * The whole recurrence model. Deliberately four fields.
 *
 * `interval` covers "every other Tuesday" (weekly, interval 2) — supported on
 * purpose rather than silently simplified to weekly, which would double how
 * often the user is asked to do something.
 */
export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N periods. 1 = every period. Positive integer. */
  interval: number;
  /** `weekly` only: days of week, 0 = Sunday. At least one. */
  weekdays?: number[];
  /** `monthly` only: 1–31. Months lacking the day are SKIPPED. */
  dayOfMonth?: number;
  /** `yearly` only: 0 = January. Paired with `dayOfMonth`. */
  month?: number;
}

/** Stated in the UI. Skipping one occurrence is deferred, not silently absent. */
export const SKIP_LIMITATION = "Skipping a single occurrence isn't supported yet.";

/** One recorded completion of one occurrence of a recurring action. */
export interface RecurrenceCompletion {
  id: string;
  actionId: string;
  /** The occurrence that was completed — half of the canonical identity. */
  occurrenceDate: DayKey;
  completedAt: string;
}

// ---------------------------------------------------------------- validation

function isPosInt(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
}

/**
 * Validate a rule that may have come from JSONB, an import, or another device.
 *
 * Structural only — no repair. §9 of the continuation brief: a malformed rule is
 * IGNORED for computation and the underlying record is preserved untouched.
 * Silently "fixing" it would replace what the user stored with what we guessed,
 * and the guess would then look like their own data.
 */
export function isValidRule(v: unknown): v is RecurrenceRule {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (!FREQUENCIES.includes(r.frequency as Frequency)) return false;
  if (!isPosInt(r.interval, 366)) return false;

  switch (r.frequency) {
    case "weekly": {
      const w = r.weekdays;
      if (!Array.isArray(w) || w.length === 0 || w.length > 7) return false;
      if (!w.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)) return false;
      if (new Set(w).size !== w.length) return false;
      return true;
    }
    case "monthly":
      return isPosInt(r.dayOfMonth, 31);
    case "yearly": {
      if (!isPosInt(r.dayOfMonth, 31)) return false;
      if (typeof r.month !== "number" || !Number.isInteger(r.month) || r.month < 0 || r.month > 11) return false;
      // Static impossibility: February 30, April 31. February 29 IS valid — it
      // simply occurs only in leap years, which is a scheduling fact, not a
      // malformed rule.
      return r.dayOfMonth <= DAYS_IN_MONTH_MAX[r.month];
    }
    case "daily":
    default:
      return true;
  }
}

/** Longest possible length of each month — February is 29 because leap years exist. */
const DAYS_IN_MONTH_MAX = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Read a rule off a record, returning `null` for anything malformed. */
export function readRule(v: unknown): RecurrenceRule | null {
  return isValidRule(v) ? (v as RecurrenceRule) : null;
}

// ------------------------------------------------------------ date internals

function pad(n: number): string { return String(n).padStart(2, "0"); }
function keyOf(y: number, m: number, d: number): DayKey { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function partsOf(key: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = (key ?? "").split("-").map(Number);
  return { y, m: m - 1, d };
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return m === 1 ? (isLeap(y) ? 29 : 28) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
}

/**
 * Weekday for a day key. The ONE `Date` in this module.
 *
 * Built from integers via `Date.UTC` and read via `getUTCDay()`, so the host's
 * timezone cannot influence it and no date VALUE passes through a `Date`.
 */
function weekdayOf(key: DayKey): number {
  const { y, m, d } = partsOf(key);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/** Day difference, by integer day-count. No `Date`, no milliseconds. */
function toOrdinal(key: DayKey): number {
  const { y, m, d } = partsOf(key);
  return Math.floor(Date.UTC(y, m, d) / 86400000);
}

// ------------------------------------------------------------- computation

/** Hard ceiling on the search, so a pathological rule cannot loop forever. */
const MAX_SEARCH_DAYS = 366 * 8;

/**
 * The first occurrence on or after `from`.
 *
 * `anchor` is the recurrence's start date — the phase for interval arithmetic.
 * "Every other Tuesday" starting Aug 4 means Aug 4, Aug 18, Sep 1; the anchor is
 * what makes that deterministic rather than dependent on when you ask.
 *
 * Returns `null` when no occurrence exists within the search horizon, which for
 * a valid rule means only one thing: the rule is `yearly` on February 29 and the
 * horizon holds no leap year. Never throws, never loops unbounded.
 */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, anchor: DayKey, from: DayKey): DayKey | null {
  if (!isValidRule(rule)) return null;
  const start = from < anchor ? anchor : from;
  const interval = Math.max(1, Math.floor(rule.interval));

  switch (rule.frequency) {
    case "daily": {
      const delta = toOrdinal(start) - toOrdinal(anchor);
      if (delta < 0) return anchor;
      // Round up to the next multiple of `interval` days from the anchor.
      const steps = Math.ceil(delta / interval);
      return addDaysKey(anchor, steps * interval);
    }

    case "weekly": {
      const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
      if (days.length === 0) return null;
      // Weeks are counted from the anchor's own week, so interval phase is
      // stable regardless of which weekday the anchor happens to fall on.
      const anchorWeekStart = addDaysKey(anchor, -weekdayOf(anchor));
      for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
        const day = addDaysKey(start, i);
        if (!days.includes(weekdayOf(day))) continue;
        const weekStart = addDaysKey(day, -weekdayOf(day));
        const weeksApart = Math.round((toOrdinal(weekStart) - toOrdinal(anchorWeekStart)) / 7);
        if (weeksApart >= 0 && weeksApart % interval === 0) return day;
      }
      return null;
    }

    case "monthly": {
      const dom = rule.dayOfMonth ?? 1;
      const a = partsOf(anchor);
      const s = partsOf(start);
      let monthsApart = (s.y - a.y) * 12 + (s.m - a.m);
      // Step back one month when the start day precedes this month's target, so
      // an occurrence later THIS month is not skipped.
      if (s.d <= dom) monthsApart -= 1;
      let step = Math.max(0, Math.ceil(monthsApart / interval) * interval);
      for (let guard = 0; guard < 200; guard++, step += interval) {
        const y = a.y + Math.floor((a.m + step) / 12);
        const m = (a.m + step) % 12;
        // THE RULE: a month without the day is SKIPPED, never clamped.
        if (dom > daysInMonth(y, m)) continue;
        const candidate = keyOf(y, m, dom);
        if (candidate >= start) return candidate;
      }
      return null;
    }

    case "yearly": {
      const dom = rule.dayOfMonth ?? 1;
      const mon = rule.month ?? 0;
      const s = partsOf(start);
      const a = partsOf(anchor);
      for (let y = Math.max(s.y, a.y), guard = 0; guard < 12; y += interval, guard++) {
        if ((y - a.y) % interval !== 0) { y += (interval - ((y - a.y) % interval)) - interval; continue; }
        // THE RULE: February 29 exists only in leap years. It is not moved.
        if (dom > daysInMonth(y, mon)) continue;
        const candidate = keyOf(y, mon, dom);
        if (candidate >= start) return candidate;
      }
      return null;
    }
  }
}

/** Add days to a key by integer arithmetic on the ordinal. */
function addDaysKey(key: DayKey, n: number): DayKey {
  const ord = toOrdinal(key) + n;
  const ms = ord * 86400000;
  const d = new Date(ms);
  return keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The occurrence a recurring action is currently ASKING FOR.
 *
 * The first occurrence on or after `from` that has not been completed. Completion
 * history is therefore what advances the schedule — there is no cursor to keep in
 * sync, no "last generated" pointer to drift, and completing the same occurrence
 * twice is a no-op because the second attempt finds it already done.
 *
 * Deliberately bounded: it walks forward at most `MAX_SKIPS` completed
 * occurrences. A user who completed a year of Sundays in advance is not a case
 * worth an unbounded loop for.
 */
const MAX_SKIPS = 400;

export function currentOccurrence(
  rule: RecurrenceRule,
  anchor: DayKey,
  from: DayKey,
  completedDates: readonly DayKey[],
): DayKey | null {
  const done = new Set(completedDates);
  let cursor = from;
  for (let i = 0; i < MAX_SKIPS; i++) {
    const next = nextOccurrenceOnOrAfter(rule, anchor, cursor);
    if (!next) return null;
    if (!done.has(next)) return next;
    cursor = addDaysKey(next, 1);
  }
  return null;
}

/**
 * Occurrences in a window. For tests and for a bounded look-ahead.
 *
 * Capped so a caller cannot ask for a decade of dailies and stall a render.
 */
export function occurrencesBetween(rule: RecurrenceRule, anchor: DayKey, from: DayKey, to: DayKey, cap = 200): DayKey[] {
  const out: DayKey[] = [];
  if (!isValidRule(rule) || to < from) return out;
  let cursor = from;
  for (let i = 0; i < cap; i++) {
    const next = nextOccurrenceOnOrAfter(rule, anchor, cursor);
    if (!next || next > to) break;
    out.push(next);
    cursor = addDaysKey(next, 1);
  }
  return out;
}

/** Does this rule produce an occurrence on exactly this day? */
export function occursOn(rule: RecurrenceRule, anchor: DayKey, day: DayKey): boolean {
  return nextOccurrenceOnOrAfter(rule, anchor, day) === day;
}

// ------------------------------------------------------------------ display

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Plain-language description. Shown wherever a rule is shown. */
export function describeRule(rule: unknown): string {
  const r = readRule(rule);
  if (!r) return "";
  const every = r.interval === 1 ? "Every" : r.interval === 2 ? "Every other" : `Every ${ordinal(r.interval)}`;
  switch (r.frequency) {
    case "daily":
      return r.interval === 1 ? "Every day" : `${every} day`;
    case "weekly": {
      const names = [...(r.weekdays ?? [])].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
      return `${every} ${names.join(", ")}`;
    }
    case "monthly":
      return `${every} month on the ${ordinal(r.dayOfMonth ?? 1)}`;
    case "yearly":
      return `${every} year on ${MONTH_NAMES[r.month ?? 0]} ${r.dayOfMonth ?? 1}`;
  }
}
