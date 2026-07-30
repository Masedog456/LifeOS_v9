/**
 * Time-range model (LIFEOS-039, Feature 2).
 *
 * Canonical local-date range resolution with EXPLICIT start and end keys and
 * deterministic, fully-closed inclusivity: a range covers `[start-of-startKey,
 * end-of-endKey)` — every instant on the start day through every instant on the
 * end day. Built on the LIFEOS-034 local-date engine, so it is DST-safe (a
 * transition day is 23h/25h, never a fixed 24h) and timezone-travel is modelled
 * by an explicit `offsetMinutes` (minutes east of UTC) that the caller supplies
 * for deterministic tests; omitting it uses the host timezone. There are NO
 * hidden rolling-window differences between views — every view resolves the same
 * `{startKey, endKey}` from the same preset. Pure.
 */

import type { InsightRangeKind } from "@/types/mvp";
import { todayKey, addDays, dayBoundsLocal, dayBoundsAtOffset, formatDayKey, type DayKey } from "@/lib/reviews/dates";

export type RangeKind = InsightRangeKind;

export const RANGE_KINDS: RangeKind[] = ["today", "last_7_days", "last_30_days", "this_month", "last_month", "this_year", "custom"];

export const RANGE_LABEL: Record<RangeKind, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  custom: "Custom range",
};

export interface ResolvedRange {
  kind: RangeKind;
  /** Inclusive first local day. */
  startKey: DayKey;
  /** Inclusive last local day. */
  endKey: DayKey;
  /** Half-open UTC bounds: [startMs, endMs) covering the whole closed day range. */
  startMs: number;
  endMs: number;
  /** Human label, e.g. "Mar 1 – Mar 31, 2026". */
  label: string;
  /** The offset used (minutes east of UTC), or undefined for host-local. */
  offsetMinutes?: number;
}

/** First day of the month containing `key`. */
function monthStart(key: DayKey): DayKey {
  return `${key.slice(0, 7)}-01`;
}
/** Last day of the month containing `key` (calendar-safe). */
function monthEnd(key: DayKey): DayKey {
  const [y, m] = key.split("-").map(Number);
  const firstNext = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(firstNext, -1);
}

export interface ResolveOptions {
  today?: DayKey;
  customStart?: DayKey;
  customEnd?: DayKey;
  /** Minutes east of UTC for deterministic bounds; omit for host-local. */
  offsetMinutes?: number;
}

/**
 * Resolve a preset (or custom keys) into an explicit, inclusive `{startKey,
 * endKey}` plus half-open UTC bounds. Deterministic given `today` + offset.
 */
export function resolveRange(kind: RangeKind, opts: ResolveOptions = {}): ResolvedRange {
  const today = opts.today ?? todayKey();
  let startKey: DayKey;
  let endKey: DayKey = today;

  switch (kind) {
    case "today": startKey = today; endKey = today; break;
    case "last_7_days": startKey = addDays(today, -6); break;   // today + 6 prior = 7 days inclusive
    case "last_30_days": startKey = addDays(today, -29); break; // 30 days inclusive
    case "this_month": startKey = monthStart(today); endKey = today; break;
    case "last_month": { const lm = addDays(monthStart(today), -1); startKey = monthStart(lm); endKey = monthEnd(lm); break; }
    case "this_year": startKey = `${today.slice(0, 4)}-01-01`; endKey = today; break;
    case "custom": startKey = opts.customStart || today; endKey = opts.customEnd || today; break;
    default: startKey = today; endKey = today;
  }

  // Guard inverted custom ranges: swap so start <= end (deterministic).
  if (startKey > endKey) { const t = startKey; startKey = endKey; endKey = t; }

  const bounds = (k: DayKey) => (opts.offsetMinutes === undefined
    ? { startMs: dayBoundsLocal(k).start.getTime(), endMs: dayBoundsLocal(k).end.getTime() }
    : dayBoundsAtOffset(k, opts.offsetMinutes));
  const startMs = bounds(startKey).startMs;
  const endMs = bounds(endKey).endMs;

  const label = startKey === endKey
    ? formatDayKey(startKey, { month: "short", day: "numeric", year: "numeric" })
    : `${formatDayKey(startKey, { month: "short", day: "numeric" })} – ${formatDayKey(endKey, { month: "short", day: "numeric", year: "numeric" })}`;

  return { kind, startKey, endKey, startMs, endMs, label, offsetMinutes: opts.offsetMinutes };
}

/** Whether an ISO timestamp falls within a resolved range (half-open UTC bounds). */
export function inRange(iso: string | undefined, range: ResolvedRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= range.startMs && t < range.endMs;
}

/** The number of whole days the range spans (inclusive) — for the "previous" comparison window. */
export function rangeDays(range: ResolvedRange): number {
  return Math.max(1, Math.round((range.endMs - range.startMs) / 86400000));
}

/**
 * The immediately-preceding range of equal length (Feature 14 comparison).
 * For a 7-day range ending yesterday, this is the 7 days before it — contiguous,
 * non-overlapping, same duration.
 */
export function previousRange(range: ResolvedRange): ResolvedRange {
  const days = rangeDays(range);
  const prevEnd = addDays(range.startKey, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return resolveRange("custom", { customStart: prevStart, customEnd: prevEnd, offsetMinutes: range.offsetMinutes });
}
