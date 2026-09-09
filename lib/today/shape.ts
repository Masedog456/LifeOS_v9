/**
 * The day's shape (LIFEOS-106).
 *
 * ## The missing denominator
 *
 * Today could say "3 to fit in" and never say what they had to fit into. The
 * audit's overloaded day listed five timed rows spanning 08:00 to 17:30 and
 * three items to place, and nothing on the page related the second number to
 * the first. The user could read the whole surface correctly and still not know
 * whether the day was possible.
 *
 * Every fact needed to say so was already recorded. An Event carries a start
 * and an end because the user entered them; the arithmetic over those was
 * simply never done.
 *
 * ## What it refuses to estimate (§8, and LIFEOS-037's original refusal)
 *
 * A due TIME is a deadline, not a duration. "Send the contract by 2 PM" says
 * when it must be finished and nothing about how long it takes, so a timed
 * ACTION is counted as a commitment and contributes NO occupied minutes.
 * Treating it as a block would be the product inventing an appointment the user
 * never made — the same rule §3 already applies when deciding what is fixed.
 *
 * `estimatedSize` is deliberately not converted into minutes. "medium" is not a
 * number, the field is `unspecified` on most records, and a capacity claim
 * assembled from guesses would be a workload score wearing arithmetic's
 * clothes. LIFEOS-037 refused exactly that and this module keeps the refusal.
 *
 * So the only minutes here come from events that carry BOTH a start and an end.
 * Everything else is counted, named, and left out of the total.
 *
 * ## Overlapping time is counted once
 *
 * Two meetings booked over each other do not occupy the sum of their lengths.
 * Busy intervals are merged before the total is taken, so a double-booked
 * morning cannot inflate the committed figure — and the collision, which the
 * product could never previously see at all, is reported instead.
 *
 * ## Nothing is persisted, nothing is judged
 *
 * A function of the rows Today has already built. No schema, no new state, head
 * unchanged. It states counts and durations; it never says the day is too full,
 * never scores it, and never blocks anything (§21, §44, §45).
 */

import { minutesOf, formatLocalTime, type LocalTime } from "@/lib/time/localtime";

/** One commitment as this module needs to see it. Built from Today's own rows. */
export interface ShapeInput {
  id: string;
  title: string;
  /** Wall-clock start. Absent for an all-day event. */
  time?: LocalTime;
  /** Wall-clock end. Absent for a timed ACTION, which has a deadline, not a span. */
  endTime?: LocalTime;
}

/** A stretch of the day with nothing scheduled in it. */
export interface DayGap {
  start: LocalTime;
  end: LocalTime;
  minutes: number;
}

/** Two commitments booked over each other. A recorded fact, not a judgment. */
export interface DayConflict {
  ids: [string, string];
  titles: [string, string];
  /** How long the two actually overlap. */
  minutes: number;
}

export interface DayShape {
  /** Commitments that name a time today — events and timed actions alike. */
  timed: number;
  /**
   * Minutes today's commitments occupy, counting overlapping time ONCE.
   *
   * Only events carrying a start AND an end contribute. See the header.
   */
  committedMinutes: number;
  /** How many commitments contributed no duration, and why they could not. */
  withoutDuration: number;
  /** First start and last end across everything timed. */
  spanStart?: LocalTime;
  spanEnd?: LocalTime;
  /** Unscheduled stretches BETWEEN commitments, inside the span. */
  gaps: DayGap[];
  /** Unscheduled minutes inside the span. */
  freeMinutes: number;
  /** The longest single uninterrupted stretch inside the span. */
  longestGapMinutes: number;
  /** Commitments booked over each other. */
  conflicts: DayConflict[];
  /** Flexible items the user still has to place around all of this. */
  flexible: number;
  /** True when there is nothing timed to describe. The line is then absent. */
  quiet: boolean;
  /** The arithmetic, as one sentence. Never a verdict. */
  line?: string;
}

/** "4h 30m", "45m", "2h". Never "0h". */
export function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Start/end in minutes, for a row that has real extent. */
function extentOf(c: ShapeInput): { start: number; end: number } | null {
  if (!c.time || !c.endTime) return null;
  const s = minutesOf(c.time);
  const e = minutesOf(c.endTime);
  // An end at or before its start is not a span. `isValidTimeRange` owns that
  // rule at entry; here it simply contributes nothing rather than a negative.
  if (s === null || e === null || e <= s) return null;
  return { start: s, end: e };
}

/**
 * The day's shape, from the rows Today already built.
 *
 * Deliberately a pure function over `ShapeInput[]` rather than another walk of
 * the store: the numbers it prints must be the numbers in the lists beneath it,
 * and the only way to guarantee that is to read the same rows. `flexible` is
 * passed in for the same reason — it is the count the orientation line already
 * says, not a second opinion about what counts as placeable work.
 */
export function buildDayShape(
  commitments: ShapeInput[],
  opts: { flexible?: number } = {},
): DayShape {
  const flexible = opts.flexible ?? 0;
  const timedRows = commitments.filter((c) => !!c.time);

  if (timedRows.length === 0) {
    return {
      timed: 0, committedMinutes: 0, withoutDuration: 0,
      gaps: [], freeMinutes: 0, longestGapMinutes: 0, conflicts: [],
      flexible, quiet: true,
    };
  }

  // ---- span ---------------------------------------------------------------
  const starts = timedRows.map((c) => minutesOf(c.time!)).filter((n): n is number => n !== null);
  const withExtent = timedRows
    .map((c) => ({ c, ext: extentOf(c) }))
    .filter((x): x is { c: ShapeInput; ext: { start: number; end: number } } => x.ext !== null);

  const spanStartMin = Math.min(...starts);
  const spanEndMin = Math.max(spanStartMin, ...withExtent.map((x) => x.ext.end), ...starts);

  // ---- conflicts ----------------------------------------------------------
  //
  // Pairwise over rows that have real extent. A row with no end cannot overlap
  // anything: it names an instant, and an instant collides with nothing the
  // product can prove.
  const conflicts: DayConflict[] = [];
  for (let i = 0; i < withExtent.length; i++) {
    for (let j = i + 1; j < withExtent.length; j++) {
      const a = withExtent[i], b = withExtent[j];
      const overlap = Math.min(a.ext.end, b.ext.end) - Math.max(a.ext.start, b.ext.start);
      if (overlap <= 0) continue;
      const [first, second] = a.ext.start <= b.ext.start ? [a, b] : [b, a];
      conflicts.push({
        ids: [first.c.id, second.c.id],
        titles: [first.c.title, second.c.title],
        minutes: overlap,
      });
    }
  }

  // ---- committed time, counting overlaps once -----------------------------
  const merged: { start: number; end: number }[] = [];
  for (const { ext } of [...withExtent].sort((x, y) => x.ext.start - y.ext.start)) {
    const last = merged[merged.length - 1];
    if (last && ext.start <= last.end) last.end = Math.max(last.end, ext.end);
    else merged.push({ ...ext });
  }
  const committedMinutes = merged.reduce((m, iv) => m + (iv.end - iv.start), 0);

  // ---- gaps between commitments, inside the span --------------------------
  const gaps: DayGap[] = [];
  for (let i = 1; i < merged.length; i++) {
    const from = merged[i - 1].end, to = merged[i].start;
    if (to <= from) continue;
    const start = fmtMin(from), end = fmtMin(to);
    if (start && end) gaps.push({ start, end, minutes: to - from });
  }
  const freeMinutes = gaps.reduce((m, g) => m + g.minutes, 0);
  const longestGapMinutes = gaps.reduce((m, g) => Math.max(m, g.minutes), 0);

  const spanStart = fmtMin(spanStartMin);
  const spanEnd = fmtMin(spanEndMin);

  const shape: DayShape = {
    timed: timedRows.length,
    committedMinutes,
    withoutDuration: timedRows.length - withExtent.length,
    spanStart,
    spanEnd,
    gaps,
    freeMinutes,
    longestGapMinutes,
    conflicts,
    flexible,
    quiet: false,
  };
  shape.line = shapeLine(shape);
  return shape;
}

function fmtMin(n: number): LocalTime | undefined {
  const h = Math.floor(n / 60), m = n % 60;
  if (h < 0 || h > 23) return undefined;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The sentence. Clauses with nothing to say are absent (§6's rule for the
 * orientation line, applied again): a day with no committed duration does not
 * print "0m committed", it simply does not mention duration.
 */
export function shapeLine(s: DayShape): string | undefined {
  const parts: string[] = [];
  if (s.committedMinutes > 0 && s.spanStart && s.spanEnd) {
    parts.push(`${durationLabel(s.committedMinutes)} committed between ${formatLocalTime(s.spanStart)} and ${formatLocalTime(s.spanEnd)}`);
  }
  if (s.freeMinutes > 0) {
    parts.push(`${durationLabel(s.freeMinutes)} unscheduled in between`);
  }
  if (s.flexible > 0) {
    parts.push(`${s.flexible} to place around it`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** "Team standup and Client review overlap by 15m." Factual, never a warning. */
export function conflictLine(c: DayConflict): string {
  return `${c.titles[0]} and ${c.titles[1]} overlap by ${durationLabel(c.minutes)}.`;
}

/**
 * The collision note for ONE row, naming the other commitment.
 *
 * Written from the reader's position: they are looking at this row, so the
 * sentence says what it runs into rather than repeating both titles. A row in
 * several collisions names them all, once each, in the order they were found.
 */
export function conflictFor(shape: DayShape, id: string): string | undefined {
  const others = shape.conflicts
    .filter((c) => c.ids[0] === id || c.ids[1] === id)
    .map((c) => {
      const otherIx = c.ids[0] === id ? 1 : 0;
      return `${c.titles[otherIx]} (${durationLabel(c.minutes)})`;
    });
  if (others.length === 0) return undefined;
  return `Overlaps ${others.join(", ")}.`;
}
