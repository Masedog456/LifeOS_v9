/**
 * Deterministic temporal extraction for capture (LIFEOS-060 §8, §19).
 *
 * ## The rule that governs this file
 *
 * **Never invent a date.** A phrase is either resolved to an exact local day
 * key, or it is reported as UNRESOLVED with the reason it could not be stored.
 * There is no third outcome, and there is deliberately no "best guess" path.
 *
 * "Book Mexico flights for October" has no day in it. A parser that picks
 * October 1st has not understood the sentence — it has fabricated a deadline the
 * user will later be reminded about. So `October` comes back as
 * `{ reason: "month_only" }` and the product says so out loud.
 *
 * ## What CAN be stored, and what cannot
 *
 * The only temporal field this sprint may write is `NextAction.dueDate`, a local
 * day key (`yyyy-mm-dd`). That means:
 *
 *   - a day        → resolvable
 *   - a time of day → NOT storable (`time_of_day`) — LIFEOS-061
 *   - a recurrence  → NOT storable (`recurrence`)  — LIFEOS-061
 *   - a bare month  → NOT storable (`month_only`)
 *   - "soon", "end of week", "next month" → NOT storable (`vague`)
 *
 * A day and a time can occur together: "Tuesday at 2:30" yields a resolved
 * Tuesday AND an unresolved `time_of_day`. Both are reported. Keeping the day
 * while announcing that the time was not stored is honest; silently converting
 * the pair into an all-day due date is the failure §19 names.
 *
 * ## Recurrence is checked before weekdays, on purpose
 *
 * "Every Sunday refill my medication box" contains the word Sunday. Testing
 * weekdays first would turn a standing weekly obligation into a single due date
 * on one arbitrary Sunday — the most damaging possible misreading, because it
 * looks correct.
 *
 * ## Pure
 *
 * No state, no clock of its own — `today` is always passed in. Same text and
 * same day in, same findings out, which is what makes the behaviour testable.
 */

import { addDays, type DayKey } from "@/lib/reviews/dates";

/** Why a temporal phrase could not become a `dueDate`. */
export type UnresolvedReason = "time_of_day" | "recurrence" | "month_only" | "vague" | "past";

export const UNRESOLVED_LABEL: Record<UnresolvedReason, string> = {
  time_of_day: "Time of day isn't stored yet",
  recurrence: "Repeating schedules aren't stored yet",
  month_only: "No specific day given",
  vague: "Too vague to pin to a day",
  past: "Refers to the past",
};

/** One temporal phrase found in the text. Exactly one of `dueDate`/`reason` is set. */
export interface TemporalFinding {
  /** The matched text, verbatim, so the UI can quote the user rather than paraphrase. */
  phrase: string;
  /** Resolved local day key, when — and only when — the phrase names a day. */
  dueDate?: DayKey;
  /** Why it could not be resolved. Present iff `dueDate` is absent. */
  reason?: UnresolvedReason;
}

export interface TemporalResult {
  /** Every temporal phrase found, in the order they appear. */
  findings: TemporalFinding[];
  /** The first resolvable day, which is what a candidate's `dueDate` becomes. */
  dueDate?: DayKey;
  /** Findings that could not be stored. Surfaced in the UI, never dropped. */
  unresolved: TemporalFinding[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = /\b(?:on\s+|this\s+|next\s+|coming\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_ALIAS: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_ALIAS[m] = i;
  MONTH_ALIAS[m.slice(0, 3)] = i;
});
MONTH_ALIAS["sept"] = 8;

/**
 * Recurrence markers. Detected so they can be REPORTED, never so they can be
 * acted on — nothing in this sprint stores a repeating schedule.
 */
const RECURRENCE_RE =
  /\b(every|each)\s+(day|morning|evening|night|week|month|year|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(daily|weekly|monthly|yearly|nightly)\b|\bevery\s+other\b|\bon\s+(sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays)\b/gi;

/**
 * Time-of-day markers. `\b\d{1,2}(:\d{2})?\s?(am|pm)\b` and the "at N" form.
 * "at 11" is included because "class at 11" is exactly the case §6B names.
 */
const TIME_RE =
  /\b(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b(?:at\s+)?\d{1,2}\s*(?:am|pm)\b|\bat\s+\d{1,2}\b|\b(noon|midnight|tonight|this\s+morning|this\s+afternoon|this\s+evening)\b/gi;

/** Phrases that sound temporal and cannot be pinned to a day without guessing. */
const VAGUE_RE =
  /\b(end\s+of\s+(?:the\s+)?(?:week|month|year)|next\s+(?:week|month|year)|later\s+this\s+(?:week|month)|soon|sometime|someday|eventually|in\s+the\s+future|this\s+week|this\s+month)\b/gi;

/** Explicit day words. */
const TODAY_RE = /\b(today)\b/gi;
const TOMORROW_RE = /\b(tomorrow)\b/gi;
/** Past reference. Recorded as context; never a due date (§8). */
const YESTERDAY_RE = /\b(yesterday|last\s+night)\b/gi;
const IN_N_DAYS_RE = /\bin\s+(\d{1,3}|a|one|two|three|four|five|six|seven|ten)\s+(day|days|week|weeks)\b/gi;
const NUMBER_WORD: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10,
};

/** "August 25", "on Aug 25th", "25 August". */
const MONTH_DAY_RE =
  /\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+of?\s*(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
/** A bare month with no day — reportable, never resolvable. */
const MONTH_ONLY_RE =
  /\b(?:in|for|during|by)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi;
/** "8/25" or "8/25/2026". Day-second, US-style, because the rest of the app is locale-local. */
const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function keyOf(year: number, monthIndex: number, day: number): DayKey {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function partsOf(key: DayKey): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map((n) => Number(n));
  return { y, m: m - 1, d };
}

/** Day of week for a day key, computed in UTC so it never shifts with the host zone. */
function weekdayOf(key: DayKey): number {
  const { y, m, d } = partsOf(key);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/** Is this a real calendar date? Rejects Feb 31 rather than rolling it forward. */
function isRealDate(year: number, monthIndex: number, day: number): boolean {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, monthIndex, day));
  return dt.getUTCMonth() === monthIndex && dt.getUTCDate() === day;
}

/**
 * Resolve a weekday name relative to `today`.
 *
 * `next Friday` is always the Friday of the following week — one week after the
 * plain reading, never "the next Friday that happens", because those two differ
 * and people who write "next" mean the further one.
 *
 * A bare weekday resolves to the SOONEST occurrence including today: someone
 * writing "submit the paperwork Friday" on a Friday means today, and pushing it
 * a week would quietly move a deadline.
 */
function resolveWeekday(name: string, today: DayKey, isNext: boolean): DayKey {
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  const current = weekdayOf(today);
  let delta = (target - current + 7) % 7;
  if (isNext) delta += 7;
  return addDays(today, delta);
}

/**
 * Resolve a month/day pair to the next occurrence that is not in the past.
 *
 * "August 25" written in September means next August, not eight months ago. A
 * date in the past is almost never a deadline, and rolling forward is the only
 * reading that produces a usable due date.
 */
function resolveMonthDay(monthIndex: number, day: number, today: DayKey): DayKey | undefined {
  const { y } = partsOf(today);
  for (const year of [y, y + 1]) {
    if (!isRealDate(year, monthIndex, day)) continue;
    const key = keyOf(year, monthIndex, day);
    if (key >= today) return key;
  }
  return undefined;
}

/** Record a finding once per distinct phrase, preserving the first occurrence. */
function push(out: TemporalFinding[], finding: TemporalFinding): void {
  const seen = out.some((f) => f.phrase.toLowerCase() === finding.phrase.toLowerCase());
  if (!seen) out.push(finding);
}

/**
 * Extract every temporal phrase in `text`.
 *
 * Order matters and is not arbitrary:
 *  1. recurrence — "every Sunday" must never be read as "Sunday"
 *  2. vague      — "next week" must never be read as a weekday
 *  3. explicit days, offsets, and calendar dates
 *  4. weekdays
 *  5. bare months
 *  6. time of day, which is orthogonal and may accompany any of the above
 */
export function extractTemporal(text: string, today: DayKey): TemporalResult {
  const src = text ?? "";
  const findings: TemporalFinding[] = [];
  /** Spans already claimed by a higher-priority rule, so later rules skip them. */
  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) =>
    claimed.some(([s, e]) => start < e && end > s);
  const claim = (start: number, end: number) => claimed.push([start, end]);

  const scan = (re: RegExp, handle: (m: RegExpExecArray) => TemporalFinding | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const finding = handle(m);
      if (finding) {
        claim(start, end);
        push(findings, finding);
      }
    }
  };

  // 1. Recurrence — reported, never resolved. Claims its span so "every Sunday"
  //    cannot then be re-read as the weekday Sunday.
  scan(RECURRENCE_RE, (m) => ({ phrase: m[0].trim(), reason: "recurrence" }));

  // 2. Vague windows. "next week" would otherwise be picked apart by later rules.
  scan(VAGUE_RE, (m) => ({ phrase: m[0].trim(), reason: "vague" }));

  // 3a. Explicit relative days.
  scan(TODAY_RE, (m) => ({ phrase: m[0].trim(), dueDate: today }));
  scan(TOMORROW_RE, (m) => ({ phrase: m[0].trim(), dueDate: addDays(today, 1) }));
  // Yesterday is context, never a deadline (§8).
  scan(YESTERDAY_RE, (m) => ({ phrase: m[0].trim(), reason: "past" }));

  // 3b. "in three days" / "in 2 weeks".
  scan(IN_N_DAYS_RE, (m) => {
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORD[raw];
    if (!n || !Number.isFinite(n)) return null;
    const days = m[2].toLowerCase().startsWith("week") ? n * 7 : n;
    if (days > 365) return { phrase: m[0].trim(), reason: "vague" };
    return { phrase: m[0].trim(), dueDate: addDays(today, days) };
  });

  // 3c. Calendar dates: "August 25", "25 August".
  scan(MONTH_DAY_RE, (m) => {
    const monthName = (m[1] ?? m[4] ?? "").toLowerCase().replace(/\./g, "");
    const dayRaw = m[2] ?? m[3];
    const monthIndex = MONTH_ALIAS[monthName];
    const day = Number(dayRaw);
    if (monthIndex === undefined || !Number.isFinite(day)) return null;
    const key = resolveMonthDay(monthIndex, day, today);
    // An impossible date ("February 31") is reported, not silently rolled.
    return key ? { phrase: m[0].trim(), dueDate: key } : { phrase: m[0].trim(), reason: "vague" };
  });

  // 3d. "8/25".
  scan(NUMERIC_DATE_RE, (m) => {
    const monthIndex = Number(m[1]) - 1;
    const day = Number(m[2]);
    const yearRaw = m[3];
    if (yearRaw) {
      const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
      if (!isRealDate(year, monthIndex, day)) return null;
      return { phrase: m[0].trim(), dueDate: keyOf(year, monthIndex, day) };
    }
    const key = resolveMonthDay(monthIndex, day, today);
    return key ? { phrase: m[0].trim(), dueDate: key } : null;
  });

  // 4. Weekdays.
  scan(WEEKDAY_RE, (m) => {
    const isNext = /\bnext\s/i.test(m[0]);
    return { phrase: m[0].trim(), dueDate: resolveWeekday(m[1], today, isNext) };
  });

  // 5. A bare month with no day. Named explicitly so the UI can say WHY.
  scan(MONTH_ONLY_RE, (m) => ({ phrase: m[0].trim(), reason: "month_only" }));

  // 6. Time of day — orthogonal, and always unresolved in this sprint.
  scan(TIME_RE, (m) => ({ phrase: m[0].trim(), reason: "time_of_day" }));

  const resolved = findings.find((f) => f.dueDate);
  return {
    findings,
    dueDate: resolved?.dueDate,
    unresolved: findings.filter((f) => !f.dueDate),
  };
}

/**
 * Remove resolved temporal phrases from a title.
 *
 * "Call advisor tomorrow" becomes "Call advisor" with `dueDate` set — the date
 * is now a field, and repeating it in the title would let the two drift apart
 * the moment the user edits one.
 *
 * UNRESOLVED phrases are deliberately left in the text. "Book Mexico flights for
 * October" keeps its October, because that word is the only place the intent
 * still lives until LIFEOS-061 gives it a home.
 */
export function stripResolvedTemporal(text: string, result: TemporalResult): string {
  let out = text ?? "";
  for (const f of result.findings) {
    if (!f.dueDate) continue;
    const escaped = f.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\s*\\b${escaped}\\b`, "i"), " ");
  }
  return out.replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim().replace(/[,;:]+$/, "").trim();
}
