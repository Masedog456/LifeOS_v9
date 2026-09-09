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
 * ## Two numbers, never added together (the review's correction)
 *
 * The first draft called the measurable part "committed" and stopped there. A
 * day of four meetings plus "call the dentist at 2" and "submit the form at 5"
 * printed "4h 30m committed · 4h unscheduled in between" — and the two
 * commitments it could not measure appeared nowhere, so the reader was invited
 * to infer four free hours that in fact contained both of them.
 *
 * The measurable part is now named for what it measures:
 *
 *   scheduledMinutes   time inside blocks with a known start AND end
 *   withoutDuration    commitments at a set time whose length is unknown
 *
 * Both are stated. Neither is folded into the other, and no duration is
 * invented for the second to make one tidy figure.
 *
 * ## "Between blocks", never "free"
 *
 * `betweenMinutes` is the gap between known blocks inside the observed span.
 * It is deliberately not called free time, remaining capacity, or availability:
 * a durationless commitment can sit inside one of those gaps without shortening
 * it, and LifeOS has no working-hours model that would let it claim otherwise.
 *
 * ## Overlapping time is counted once
 *
 * Two meetings booked over each other do not occupy the sum of their lengths.
 * Busy intervals are merged before the total is taken, so a double-booked
 * morning cannot inflate the scheduled figure — and the collision, which the
 * product could never previously see at all, is reported instead. One record
 * rendered twice is not a collision: identity is canonical, never the title.
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
   * Minutes inside blocks that have a known start AND end, overlaps counted ONCE.
   *
   * Named `scheduled`, not `committed`: it is the measurable part of the day's
   * commitments, and `withoutDuration` counts the rest. The two must never be
   * added together or presented as one figure.
   */
  scheduledMinutes: number;
  /**
   * Timed commitments whose LENGTH is unknown — a `dueTime` with no end.
   *
   * This is the number the first draft computed and never showed. A day of four
   * meetings plus "call the dentist at 2" and "submit the form at 5" reported
   * "4h 30m committed" and left the reader to infer the rest of the day was
   * free. The count is now disclosed in the sentence.
   */
  withoutDuration: number;
  /** First start and last end across everything timed. */
  spanStart?: LocalTime;
  spanEnd?: LocalTime;
  /** Stretches between the known blocks, inside the span. */
  gaps: DayGap[];
  /**
   * Minutes BETWEEN known blocks. Deliberately not called `free`.
   *
   * It is an observable gap in the known schedule, not available capacity:
   * LifeOS has no working-hours model, and a durationless commitment can sit
   * inside one of these gaps without shortening it — which is exactly why the
   * count of those is disclosed beside this number rather than hidden.
   */
  betweenMinutes: number;
  /** The longest single uninterrupted stretch between blocks. */
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

/**
 * Start/end in minutes, for a row that has real extent.
 *
 * Three kinds of row return null here, and each is deliberate:
 *
 *   no end            a `dueTime` names an instant, not a span
 *   end === start     a zero-length event, which `isValidTimeRange` PERMITS
 *                     (it rejects only `end < start`), so this is a record the
 *                     product can really hold. Zero minutes is zero minutes.
 *   end < start       an event running past midnight. The writer refuses these
 *                     — "Events that run past midnight aren't supported yet" —
 *                     so this is defence against a record canonical state
 *                     cannot contain, not a feature gap being papered over. It
 *                     contributes nothing rather than a negative, and is
 *                     counted among the commitments whose length is unknown.
 *
 * An unparseable time string returns null the same way. Nothing here throws,
 * fabricates minutes, or invents a collision.
 */
function extentOf(c: ShapeInput): { start: number; end: number } | null {
  if (!c.time || !c.endTime) return null;
  const s = minutesOf(c.time);
  const e = minutesOf(c.endTime);
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
      timed: 0, scheduledMinutes: 0, withoutDuration: 0,
      gaps: [], betweenMinutes: 0, longestGapMinutes: 0, conflicts: [],
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
      // A record cannot collide with itself. Two rows carrying one canonical id
      // are the SAME commitment rendered twice, and reporting that as a
      // double-booking would turn a rendering bug into a fact about the day.
      // Matched on id, never on title — two meetings really can share a name.
      if (a.c.id === b.c.id) continue;
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
  const scheduledMinutes = merged.reduce((m, iv) => m + (iv.end - iv.start), 0);

  // ---- gaps between commitments, inside the span --------------------------
  const gaps: DayGap[] = [];
  for (let i = 1; i < merged.length; i++) {
    const from = merged[i - 1].end, to = merged[i].start;
    if (to <= from) continue;
    const start = fmtMin(from), end = fmtMin(to);
    if (start && end) gaps.push({ start, end, minutes: to - from });
  }
  const betweenMinutes = gaps.reduce((m, g) => m + g.minutes, 0);
  const longestGapMinutes = gaps.reduce((m, g) => Math.max(m, g.minutes), 0);

  const spanStart = fmtMin(spanStartMin);
  const spanEnd = fmtMin(spanEndMin);

  const shape: DayShape = {
    timed: timedRows.length,
    scheduledMinutes,
    withoutDuration: timedRows.length - withExtent.length,
    spanStart,
    spanEnd,
    gaps,
    betweenMinutes,
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

  // What is actually measurable: time inside blocks with a known start and end.
  // "in scheduled blocks", not "committed" — the day holds commitments this
  // figure does not measure, and the next clause is what says so.
  if (s.scheduledMinutes > 0 && s.spanStart && s.spanEnd) {
    parts.push(`${durationLabel(s.scheduledMinutes)} in scheduled blocks between ${formatLocalTime(s.spanStart)} and ${formatLocalTime(s.spanEnd)}`);
  }

  /**
   * The disclosure that makes the rest of the sentence honest.
   *
   * "Call the dentist at 2 PM" is a real commitment with an unknown length. The
   * first draft counted it, printed nothing about it, and let the reader infer
   * the gaps were free. Saying how many there are costs one clause and is the
   * difference between a measurement and a claim.
   *
   * It appears only alongside another clause: on its own it would restate the
   * schedule immediately below it, which is noise rather than orientation.
   */
  const hasOther = parts.length > 0 || s.flexible > 0;
  if (s.withoutDuration > 0 && hasOther) {
    const more = s.scheduledMinutes > 0 ? "more " : "";
    parts.push(`${s.withoutDuration} ${more}at a set time`);
  }

  // Gaps BETWEEN the known blocks. Never "free": a durationless commitment can
  // sit inside one of these without shortening it, which the clause above has
  // just disclosed, and LifeOS has no working-hours model to call anything free.
  if (s.betweenMinutes > 0) {
    parts.push(`${durationLabel(s.betweenMinutes)} between blocks`);
  }

  // "to place", not "to place around it": with no scheduled clause there was no
  // antecedent, and the day with only timed actions read "3 to place around it"
  // with nothing for "it" to refer to.
  if (s.flexible > 0) {
    parts.push(`${s.flexible} to place`);
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
  /**
   * Two are named; beyond that the row says how many.
   *
   * A row in four collisions reading "Overlaps A (1h), B (30m), C (45m), D
   * (20m)." is a paragraph inside a list item, and the titles stop being the
   * useful part once there are that many — the fact worth carrying is that this
   * slot is contested. The two named are the ones the reader can act on first.
   */
  if (others.length > NAMED_CONFLICTS) {
    return `Overlaps ${others.slice(0, NAMED_CONFLICTS).join(", ")} and ${others.length - NAMED_CONFLICTS} more.`;
  }
  return `Overlaps ${others.join(", ")}.`;
}

/** How many colliding titles one row names before it switches to a count. */
export const NAMED_CONFLICTS = 2;
