/**
 * Time-of-day and recurrence extraction for capture (LIFEOS-061 §11, §12, §14).
 *
 * ## What changed from LIFEOS-060
 *
 * `lib/capture/dates.ts` detects `time_of_day` and `recurrence` phrases and
 * reports them as UNRESOLVED, because there was nowhere to put them. Now there
 * is. This module turns those same phrases into values — and, crucially, keeps
 * reporting the ones it still cannot represent.
 *
 * The unresolved channel does not go away; it narrows. "Twice a week" is still
 * unresolved, because there is no honest answer to *which two days*.
 *
 * ## Event vs Action is decided by INTENT, never by the presence of a time
 *
 * This is the rule §11 and §13 both insist on, and it is easy to get wrong:
 *
 *   "Dinner with Mom Friday at 7"    → Event   — it happens
 *   "Send Mom the form Friday at 7"  → Action  — you finish it
 *
 * Both have a day and a time. What separates them is whether the sentence names
 * a STEP. A leading action verb ("send", "call", "submit") means the person
 * described something to do; an occasion noun or a bare noun phrase with a time
 * means they described something that will occur.
 *
 * Getting this wrong in the Action direction is the worse failure: it puts a
 * checkbox on dinner, and no honest person can tick it.
 *
 * ## Pure
 */

import { parseLocalTime, type LocalTime } from "@/lib/time/localtime";
import { isValidRule, type RecurrenceRule } from "@/lib/time/recurrence";

// ------------------------------------------------------------- time of day

/** `at 2:30 PM`, `2pm`, `at 11`, `noon`, `midnight`. */
const TIME_PHRASE_RE =
  /\b(?:at\s+)?(\d{1,2}:[0-5]\d\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|noon|midnight)\b|\bat\s+(\d{1,2})\b(?!\s*[:/-])/gi;

export interface TimeFinding {
  phrase: string;
  time: LocalTime;
}

/**
 * The first parseable time of day in the text.
 *
 * Only the FIRST: "dinner at 7 at the place on 5th" should not read "5th" as a
 * second time, and a sentence naming two times is describing a range this sprint
 * does not model.
 */
export function extractTimeOfDay(text: string): TimeFinding | null {
  const src = text ?? "";
  TIME_PHRASE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_PHRASE_RE.exec(src)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    const time = parseLocalTime(raw);
    if (time) return { phrase: m[0].trim(), time };
  }
  return null;
}

// -------------------------------------------------------------- recurrence

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sundays: 0, sun: 0,
  monday: 1, mondays: 1, mon: 1,
  tuesday: 2, tuesdays: 2, tue: 2, tues: 2,
  wednesday: 3, wednesdays: 3, wed: 3,
  thursday: 4, thursdays: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fridays: 5, fri: 5,
  saturday: 6, saturdays: 6, sat: 6,
};

const MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Why a recurrence-shaped phrase could not become a rule. */
export type UnsupportedRecurrence = "ambiguous_frequency" | "unsupported_pattern";

export const UNSUPPORTED_RECURRENCE_LABEL: Record<UnsupportedRecurrence, string> = {
  ambiguous_frequency: "Conqify can't tell which days you mean",
  unsupported_pattern: "That repeating pattern isn't supported yet",
};

export interface RecurrenceFinding {
  phrase: string;
  /** Present when the phrase became a rule. */
  rule?: RecurrenceRule;
  /** Present when it did not, and why. */
  unsupported?: UnsupportedRecurrence;
}

/**
 * Patterns that LOOK like a schedule and cannot honestly become one.
 *
 * "Twice a week" names a count, not days — picking Tuesday and Thursday for the
 * user would be inventing their week. "Third Thursday" and "last weekday" are
 * real patterns this model does not express, and pretending otherwise by
 * rounding to "monthly" would fire on the wrong day eleven times a year.
 */
const AMBIGUOUS_RE =
  /\b(twice|three\s+times|3\s+times|a\s+few\s+times|several\s+times|couple\s+of\s+times)\s+(?:a|per|each)\s+(day|week|month|year)\b|\bsometimes\s+on\b|\bnow\s+and\s+(?:then|again)\b|\boccasionally\b|\bregularly\b/i;

const UNSUPPORTED_PATTERN_RE =
  /\b(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekday|weekend)\b|\bevery\s+other\s+(?!sunday|monday|tuesday|wednesday|thursday|friday|saturday|day|week|month|year)\w+/i;

/** "every 3 days", "every other week", "every 2 weeks". */
const INTERVAL_WORDS: Record<string, number> = { other: 2, second: 2, third: 3, fourth: 4 };

function intervalFrom(word: string | undefined): number {
  if (!word) return 1;
  const w = word.toLowerCase().trim();
  if (/^\d+$/.test(w)) return Math.max(1, Math.min(366, Number(w)));
  return INTERVAL_WORDS[w] ?? 1;
}

/**
 * Extract a recurrence rule, or report why one could not be made.
 *
 * Returns `null` when the text is not about repetition at all — the common case,
 * and the one that must be cheap.
 */
export function extractRecurrence(text: string): RecurrenceFinding | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  // Refuse the ambiguous shapes FIRST, before any pattern can partially match
  // them and produce a confident wrong answer. "Twice a week" contains "week".
  const ambiguous = AMBIGUOUS_RE.exec(t);
  if (ambiguous) return { phrase: ambiguous[0].trim(), unsupported: "ambiguous_frequency" };
  const unsupported = UNSUPPORTED_PATTERN_RE.exec(t);
  if (unsupported) return { phrase: unsupported[0].trim(), unsupported: "unsupported_pattern" };

  // Yearly: "every August 14", "yearly on August 14", "every year on August 14".
  const yearly = /\b(?:every|each)\s+(?:year\s+on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b|\byearly\s+on\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i.exec(t);
  if (yearly) {
    const monthName = (yearly[1] ?? yearly[3] ?? "").toLowerCase().replace(/\./g, "");
    const day = Number(yearly[2] ?? yearly[4]);
    const month = MONTH_INDEX[monthName];
    if (month !== undefined && Number.isFinite(day)) {
      const rule: RecurrenceRule = { frequency: "yearly", interval: 1, month, dayOfMonth: day };
      if (isValidRule(rule)) return { phrase: yearly[0].trim(), rule };
      // February 30 and friends: shaped like a schedule, but no such date exists.
      return { phrase: yearly[0].trim(), unsupported: "unsupported_pattern" };
    }
  }

  // Monthly: "on the first of every month", "every month on the 1st",
  // "monthly on the 15th", "every 1st of the month".
  const monthly =
    /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(?:every|each)\s+month\b|\b(?:every|each)\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b|\bmonthly\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(?:on\s+)?the\s+first\s+of\s+(?:every|each)\s+month\b/i.exec(t);
  if (monthly) {
    const dayOfMonth = Number(monthly[1] ?? monthly[2] ?? monthly[3] ?? 1);
    const rule: RecurrenceRule = { frequency: "monthly", interval: 1, dayOfMonth };
    if (isValidRule(rule)) return { phrase: monthly[0].trim(), rule };
    return { phrase: monthly[0].trim(), unsupported: "unsupported_pattern" };
  }

  // Weekly by named days: "every Sunday", "every Monday, Wednesday, and Friday",
  // "every other Tuesday", "on Mondays".
  const weeklyNamed =
    /\b(?:every|each)\s+(other\s+|second\s+|third\s+|\d+\s+)?((?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:s)?(?:\s*(?:,\s*)?(?:and\s+|&\s*)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?)*)\b|\bon\s+((?:sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays)(?:\s*(?:,\s*)?(?:and\s+|&\s*)?(?:sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays))*)\b/i.exec(t);
  if (weeklyNamed) {
    const interval = intervalFrom(weeklyNamed[1]);
    const list = (weeklyNamed[2] ?? weeklyNamed[3] ?? "").toLowerCase();
    const weekdays = Array.from(
      new Set(
        (list.match(/sunday|monday|tuesday|wednesday|thursday|friday|saturday/g) ?? [])
          .map((d) => WEEKDAY_INDEX[d])
          .filter((n): n is number => n !== undefined),
      ),
    ).sort((a, b) => a - b);
    if (weekdays.length > 0) {
      const rule: RecurrenceRule = { frequency: "weekly", interval, weekdays };
      if (isValidRule(rule)) return { phrase: weeklyNamed[0].trim(), rule };
    }
  }

  // Bare periods: "every day", "daily", "every week", "weekly", "every 2 weeks",
  // "every month", "monthly", "every year", "yearly".
  const period =
    /\b(?:every|each)\s+(other\s+|second\s+|third\s+|\d+\s+)?(day|week|month|year)s?\b|\b(daily|weekly|monthly|yearly|nightly)\b/i.exec(t);
  if (period) {
    const unit = (period[2] ?? "").toLowerCase();
    const word = (period[3] ?? "").toLowerCase();
    const interval = intervalFrom(period[1]);
    const frequency =
      unit === "day" || word === "daily" || word === "nightly" ? "daily"
        : unit === "week" || word === "weekly" ? "weekly"
          : unit === "month" || word === "monthly" ? "monthly"
            : unit === "year" || word === "yearly" ? "yearly"
              : null;
    if (frequency === "daily") {
      return { phrase: period[0].trim(), rule: { frequency: "daily", interval } };
    }
    // A bare "every week"/"every month"/"every year" names a period but not WHICH
    // day. The anchor supplies that at materialization time, so the rule is
    // completed by the caller with the anchor's own weekday / day-of-month.
    if (frequency) {
      return { phrase: period[0].trim(), rule: { frequency, interval } };
    }
  }

  return null;
}

/**
 * Complete a partially-specified rule using the anchor date.
 *
 * "Every week" starting on a Tuesday means every Tuesday. That is not an
 * invention — it is the only reading the sentence supports, and it comes from
 * the user's own anchor rather than from a default.
 */
export function completeRule(rule: RecurrenceRule, anchor: string): RecurrenceRule {
  const [y, m, d] = anchor.split("-").map(Number);
  if (rule.frequency === "weekly" && (!rule.weekdays || rule.weekdays.length === 0)) {
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { ...rule, weekdays: [weekday] };
  }
  if (rule.frequency === "monthly" && rule.dayOfMonth === undefined) {
    return { ...rule, dayOfMonth: d };
  }
  if (rule.frequency === "yearly" && (rule.dayOfMonth === undefined || rule.month === undefined)) {
    return { ...rule, month: m - 1, dayOfMonth: d };
  }
  return rule;
}

// ------------------------------------------------------- event vs action

/**
 * Verbs that make a timed sentence a STEP rather than an occurrence.
 *
 * "Send Mom the form Friday at 7" is an Action; "Dinner with Mom Friday at 7" is
 * an Event. The list is the discriminator, so it stays tight — a verb here that
 * also reads as a noun would start turning events into tasks.
 */
const STEP_VERBS =
  /^(?:i\s+(?:need|have|want|ought)\s+to\s+|remember\s+to\s+|don'?t\s+forget\s+to\s+)?(call|email|text|message|send|submit|buy|order|pay|renew|file|return|pick\s+up|drop\s+off|finish|complete|update|write|draft|print|sign|mail|reply|respond|confirm|cancel|register|download|upload|book|schedule|refill|restock|pack|ship|deliver|apply|clean|wash|fix|repair|review|check|prepare|practice|study|read|lift|run|water|take\s+out|do)\b/i;

/**
 * Nouns that name something which HAPPENS. Used only as a positive signal —
 * absence of one does not make a sentence an action.
 */
const OCCURRENCE_NOUNS =
  /\b(appointment|meeting|dinner|lunch|breakfast|brunch|class|lecture|session|call\s+with|interview|party|concert|game|match|flight|train|rehearsal|practice\s+with|standup|stand-up|checkup|check-up|ceremony|service|wedding|birthday|anniversary|reunion|conference|workshop|show|screening|visit\s+from)\b/i;

/**
 * Does this segment describe something that HAPPENS (an Event) rather than
 * something to DO (an Action)?
 *
 * Order matters. A leading step verb wins outright: "call with Sarah" is an
 * occurrence noun, but "Call Sarah at 3" starts with a step verb and is a task.
 */
export function looksLikeEvent(text: string): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (STEP_VERBS.test(t)) return false;
  if (OCCURRENCE_NOUNS.test(t)) return true;
  return false;
}
