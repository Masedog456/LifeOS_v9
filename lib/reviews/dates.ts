/**
 * Local-date semantics for the daily review (LIFEOS-034, Feature 15).
 *
 * A daily review is keyed by the user's LOCAL calendar date, which must be kept
 * separate from wall-clock timestamps. This module is the single source of truth
 * for turning an instant into a `yyyy-mm-dd` day key and for computing a local
 * day's UTC boundaries.
 *
 * Two layers:
 *  - Runtime helpers (`todayKey`, `localDateKeyOf`, `dayBoundsLocal`) use the JS
 *    engine's own local timezone via `Date`'s local getters/constructor, which is
 *    DST-correct by construction (a spring-forward day is genuinely 23h, a
 *    fall-back day 25h) — we never hardcode a UTC day boundary.
 *  - Pure offset helpers (`localDateKeyAtOffset`, `dayBoundsAtOffset`) take an
 *    explicit "minutes east of UTC" offset so day-summary and the self-tests can
 *    be fully deterministic regardless of the machine's timezone, and so
 *    timezone-travel behaviour can be exercised directly.
 *
 * Duplicate prevention keys on the STORED `date` field, never a recomputed one,
 * so travelling across a timezone (or a clock change) can never fork a second
 * review for a day that already has one.
 */

export type DayKey = string; // "yyyy-mm-dd"

const pad = (n: number) => String(n).padStart(2, "0");

/** Is a value a well-formed yyyy-mm-dd day key (valid calendar date)? */
export function isDayKey(v: unknown): v is DayKey {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ---- Runtime (machine-local timezone; DST-correct) ----

/** The local day key for a Date (defaults to now). Uses local calendar getters. */
export function localDateKeyOf(d: Date = new Date()): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local day key. */
export function todayKey(now: Date = new Date()): DayKey {
  return localDateKeyOf(now);
}

/** The local day key for an ISO timestamp (empty/invalid → ""). */
export function dayKeyFromIso(iso: string | undefined): DayKey | "" {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : localDateKeyOf(new Date(t));
}

/**
 * The [start, end) UTC instants of a local day. Built from the local-midnight
 * constructor so it stays correct across DST transitions (the interval is 23h or
 * 25h on transition days rather than a fixed 24h).
 */
export function dayBoundsLocal(key: DayKey): { start: Date; end: Date } {
  const [y, m, d] = key.split("-").map(Number);
  return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d + 1, 0, 0, 0, 0) };
}

/** Whether an ISO timestamp falls on a given local day. */
export function isoOnLocalDay(iso: string | undefined, key: DayKey): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const { start, end } = dayBoundsLocal(key);
  return t >= start.getTime() && t < end.getTime();
}

// ---- Pure offset variant (deterministic; timezone-travel modelling) ----
//
// `offsetMinutes` = minutes EAST of UTC (ISO +05:30 → +330, US Eastern EST → -300).
// local wall-clock = UTC + offset.

/** The local day key of an instant at a fixed offset (deterministic). */
export function localDateKeyAtOffset(utcMs: number, offsetMinutes: number): DayKey {
  return new Date(utcMs + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/** The [startMs, endMs) UTC millisecond bounds of a local day at a fixed offset. */
export function dayBoundsAtOffset(key: DayKey, offsetMinutes: number): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${key}T00:00:00.000Z`) - offsetMinutes * 60000;
  return { startMs, endMs: startMs + 24 * 3600 * 1000 };
}

/** Whether an ISO timestamp falls on a local day at a fixed offset. */
export function isoOnDayAtOffset(iso: string | undefined, key: DayKey, offsetMinutes: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const { startMs, endMs } = dayBoundsAtOffset(key, offsetMinutes);
  return t >= startMs && t < endMs;
}

/** The offset (minutes east of UTC) in effect for a Date on this machine. */
export function currentOffsetMinutes(d: Date = new Date()): number {
  return -d.getTimezoneOffset(); // getTimezoneOffset is minutes WEST of UTC
}

// ---- Day / week arithmetic on keys (calendar-safe) ----

/** Shift a day key by `n` days (may be negative). */
export function addDays(key: DayKey, n: number): DayKey {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKeyOf(new Date(y, m - 1, d + n));
}

/** The Monday-based week-start key for a day key. */
export function weekStartKey(key: DayKey): DayKey {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(key, -dow);
}

/** The 7 day keys of the week starting at `startKey`. */
export function weekDays(startKey: DayKey): DayKey[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startKey, i));
}

/** Difference in whole days between two keys (a - b). */
export function dayDiff(a: DayKey, b: DayKey): number {
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((ta - tb) / 86400000);
}

/** Human label for a day key (e.g. "Mon, Jul 27"). */
export function formatDayKey(key: DayKey, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

/** Coarse recency bucket of a day key relative to `today`. */
export function recencyBucket(key: DayKey, today: DayKey = todayKey()): "Today" | "Yesterday" | "This Week" | "Earlier" {
  const diff = dayDiff(today, key);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (weekStartKey(key) === weekStartKey(today)) return "This Week";
  return "Earlier";
}
