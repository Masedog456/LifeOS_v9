/**
 * Literal time arithmetic (LIFEOS-058 §13).
 *
 * ## The only claim this module makes
 *
 * Addition. If a person has written down "two hours of meditation daily" and
 * "three hours of study daily", the sum is five hours, and saying so is a fact
 * about their sentences — not an assessment of them.
 *
 *   MAY SAY:  "These commitments total about 17 hours before sleep, meals,
 *              transportation, or other responsibilities."
 *   MAY NOT:  "You lack discipline."  /  "This is unrealistic."  /  any score.
 *
 * ## Why nothing is estimated
 *
 * The brief is explicit: "Do not invent time estimates the user did not
 * provide." So a commitment with no stated duration contributes NOTHING to the
 * total and is not counted, guessed at, or assigned a default. A statement like
 * "exercise regularly" is invisible here, and that is correct — the alternative
 * is a number the user never supplied being presented back to them as their own.
 *
 * The disclosure line says how many commitments were counted and how many were
 * skipped for having no stated duration, so the total is never mistaken for a
 * complete picture of a day.
 *
 * ## Why there is no feasibility score
 *
 * "No generalized feasibility score" — and beyond the brief's instruction, a
 * score would require knowing how long the rest of a life takes, which Conqify
 * does not know and must not pretend to. The arithmetic stops at the sum.
 */

/** One commitment with a duration the user actually stated. */
export interface TimedCommitment {
  /** The statement the duration was read out of. The user's own words. */
  statement: string;
  /** Minutes per day, as literally stated. */
  minutesPerDay: number;
  /** The phrase the duration was read from, so the user can check our reading. */
  matched: string;
}

export interface TimeTotals {
  commitments: TimedCommitment[];
  /** Statements that named no duration and are therefore not counted at all. */
  untimedCount: number;
  totalMinutesPerDay: number;
}

/** "2 hours", "90 minutes", "1.5 hrs", "45 mins". */
const DURATION = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;

/**
 * Daily cadence. Weekly cadences are deliberately NOT converted to a daily
 * average: "three hours on Saturday" is not "26 minutes a day", and presenting
 * it that way would be exactly the invented estimate the brief rules out.
 */
const DAILY = /\b(daily|every ?day|each day|a day|per day|\/ ?day|each morning|every morning|each evening|every evening|each night|every night)\b/i;

function toMinutes(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return Math.round(value * 60);
  return Math.round(value);
}

/**
 * Read a per-day duration out of one statement, or `undefined` if it does not
 * state one.
 *
 * Requires BOTH a duration and a daily cadence. "I want to read for an hour" has
 * a duration but no cadence, and treating it as daily would be an assumption
 * about frequency the user never made.
 */
export function readDailyMinutes(statement: string): { minutes: number; matched: string } | undefined {
  const s = statement ?? "";
  if (!DAILY.test(s)) return undefined;
  const m = DURATION.exec(s);
  if (!m) return undefined;
  const minutes = toMinutes(Number(m[1]), m[2]);
  if (!Number.isFinite(minutes) || minutes <= 0) return undefined;
  return { minutes, matched: m[0] };
}

/** Sum the stated daily durations across a set of statements. */
export function totalDailyTime(statements: readonly string[]): TimeTotals {
  const commitments: TimedCommitment[] = [];
  let untimedCount = 0;
  for (const statement of statements) {
    const read = readDailyMinutes(statement);
    if (!read) {
      untimedCount += 1;
      continue;
    }
    commitments.push({ statement, minutesPerDay: read.minutes, matched: read.matched });
  }
  return {
    commitments,
    untimedCount,
    totalMinutesPerDay: commitments.reduce((n, c) => n + c.minutesPerDay, 0),
  };
}

/** The threshold below which the arithmetic is not worth showing at all. */
const MIN_COMMITMENTS = 2;

/**
 * The observation sentence, or `undefined` when there is nothing to observe.
 *
 * Returns nothing unless at least two commitments carried a stated duration —
 * one number added to itself is not an observation, and showing it would make
 * the feature feel like surveillance of a single sentence.
 *
 * The wording carries its own caveat ("before sleep, meals, transportation, or
 * other responsibilities") because the total is genuinely incomplete, and a
 * number presented without that clause invites the user to read a verdict into
 * it that the number cannot support.
 */
export function timeObservation(totals: TimeTotals): string | undefined {
  if (totals.commitments.length < MIN_COMMITMENTS) return undefined;
  const hours = totals.totalMinutesPerDay / 60;
  const rounded = hours >= 1 ? Math.round(hours * 10) / 10 : hours;
  const amount = hours >= 1 ? `about ${rounded} hours` : `${totals.totalMinutesPerDay} minutes`;
  return `The ${totals.commitments.length} commitments that name a daily duration total ${amount} before sleep, meals, transportation, or other responsibilities.`;
}

/**
 * The disclosure that keeps the total honest.
 *
 * Without this line, a user with eight commitments — two of them timed — would
 * see a four-hour total and reasonably read it as their whole day.
 */
export function timeCoverageNote(totals: TimeTotals): string | undefined {
  if (totals.commitments.length < MIN_COMMITMENTS) return undefined;
  if (totals.untimedCount === 0) return "Every commitment here names a daily duration.";
  return `${totals.untimedCount} other commitment${totals.untimedCount === 1 ? "" : "s"} named no duration, so ${totals.untimedCount === 1 ? "it is" : "they are"} not counted here.`;
}
