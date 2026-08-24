/**
 * Temporal editing (LIFEOS-065 §1, §2, §6, §7).
 *
 * "The dentist moved to Friday at 3." — say what changed, and the right record
 * changes. No opening the record, no finding the date field, no second screen.
 *
 * ## Understand aggressively · match carefully · mutate conservatively (§2)
 *
 * Creating a record and CHANGING one are different authority problems. A wrong
 * new record is visible and deletable; a wrong mutation silently destroys a date
 * the user is relying on and looks exactly like a record that was always wrong.
 * So this module is generous about reading intent and mean about acting on it:
 * every path that cannot name exactly one record ends in a question, never a
 * write.
 *
 * ## Nothing here mutates
 *
 * This file is pure. It reads state, produces a proposal, and stops.
 * `lib/capture/apply-edit.ts` performs the write through the store setters that
 * already exist — `setActionDueDate`, `setActionDueTime`, `updateEvent`,
 * `deferAction`, `stopActionRecurrence`. **No new update API was added**,
 * because those already enforce the invariants a new one would have to
 * re-derive: a time needs a day, an event's time range must be valid, a
 * recurrence rule must parse.
 *
 * ## No new noun
 *
 * "Temporal edit" is a name for the code, not for the user. On screen this is a
 * confirmation panel that says what will change, and nothing is persisted about
 * the interpretation itself.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { addDays, formatDayKey } from "@/lib/reviews/dates";
import type { LifeEvent, NextAction, StoreState } from "@/types/mvp";
import { extractTemporal, type TemporalFinding } from "@/lib/capture/dates";
import { extractTimeOfDay, extractRecurrence, completeRule } from "@/lib/capture/schedule";
import { formatLocalTime, type LocalTime } from "@/lib/time/localtime";
import { describeRule, readRule, type RecurrenceRule } from "@/lib/time/recurrence";
import { decompose } from "@/lib/capture/decompose";
import { isExternallyOwned } from "@/lib/calendar/external";

/** What the user is asking to change. Each maps to ONE existing store setter. */
export type EditOperation =
  | "move_date"
  | "change_time"
  | "clear_time"
  | "defer"
  | "cancel_event"
  | "change_recurrence"
  | "stop_recurrence"
  // LIFEOS-066 §6, §21. "I finished the deployment" changes an Action that
  // already exists. It lives here rather than in a parallel mutation path so it
  // inherits the whole matching and confirmation model unchanged — one panel,
  // one dispatcher, one set of refusals.
  | "complete";

export const EDIT_OPERATIONS: readonly EditOperation[] = [
  "move_date", "change_time", "clear_time", "defer",
  "cancel_event", "change_recurrence", "stop_recurrence", "complete",
];

/** §8. Who decides which record is meant. */
export type MatchAuthority = "unambiguous" | "ambiguous" | "no_match";

/** A record the edit could apply to, with the schedule it has now. */
export interface EditTarget {
  kind: "action" | "event";
  id: string;
  title: string;
  currentDate?: DayKey;
  currentTime?: LocalTime;
  recurrence?: RecurrenceRule;
  /** Action status. Absent for events, which have no status by design. */
  status?: string;
  /** Set when this record must not be edited. Shown instead of a proposal. */
  blocked?: string;
}

/** Why an otherwise-understood edit will not be applied. */
export interface EditRefusal {
  code:
    | "no_target"
    | "completed_action"
    | "occurrence_not_supported"
    | "no_cancellation_state"
    | "no_date_to_shift"
    | "time_needs_a_day"
    | "recurrence_unsupported"
    // LIFEOS-066 §18. Ticking something twice, and ticking something that has
    // no tick to give.
    | "already_complete"
    | "not_completable"
    // LIFEOS-067 §14. Owned by an external calendar this product only reads.
    | "external_read_only";
  /** Said to the user, in their terms. Never a stack trace. */
  message: string;
}

export interface TemporalEditIntent {
  targetType: "action" | "event" | "unknown";
  /** The words that name the record. Used for matching and shown when asking. */
  targetQuery: string;
  operation: EditOperation;
  proposedFields: {
    date?: DayKey;
    time?: LocalTime;
    recurrence?: RecurrenceRule;
    /** Days to shift from the record's CURRENT date. Signed: back is negative. */
    shiftDays?: number;
  };
  sourceText: string;
  confidence: "high" | "likely" | "possible";
  authority: MatchAuthority;
  candidateMatches: EditTarget[];
  unresolved: TemporalFinding[];
  refusal?: EditRefusal;
}

// ------------------------------------------------------------- detection ----

/**
 * Verbs that signal a CHANGE to something that already exists.
 *
 * Note what is missing: "do", "finish", "start". Those describe work, not
 * rescheduling, and including them would turn ordinary capture into a mutation
 * surface — the exact danger §27 names.
 */
const EDIT_VERB_RE =
  /\b(move|moved|moves|reschedul\w*|push|pushed|shift|shifted|bump|bumped|switch|switched|change|changed|make|makes)\b/i;

/** "the dentist is now Friday", "class moved to 1". */
const IS_NOW_RE = /\b(?:is|are|it'?s)\s+now\b/i;

const CANCEL_RE = /\b(cancel|cancelled|canceled|call\s+off|called\s+off)\b/i;
const STOP_RECURRENCE_RE = /\b(stop|end|cancel)\s+(?:the\s+)?(?:\w+\s+){0,2}(recurring|repeat\w*|weekly|daily|monthly|nightly)\b|\b(stop|end)\s+(?:the\s+)?(\w+)\s+(?:recurrence|repeat\w*)\b/i;
const CLEAR_TIME_RE = /\b(remove|clear|drop|take\s+off|get\s+rid\s+of)\s+(?:the\s+)?time\b|\bno\s+(?:specific\s+)?time\b/i;

/** §16. Language that means "hide this until", not "the deadline is now". */
const DEFER_RE =
  /\b(hide|snooze|come\s+back\s+to|deal\s+with\s+(?:it|this|that)\s+later|put\s+(?:it|this|that)\s+off|revisit)\b|\buntil\s+(?:tomorrow|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** §32. "push it back two days", "move it forward a week". */
const SHIFT_RE =
  /\b(back|forward|forwards|earlier|later|out|up)\s+(?:by\s+)?(\d{1,3}|a|an|one|two|three|four|five|six|seven|ten)\s+(day|days|week|weeks)\b|\b(?:by\s+)?(\d{1,3}|a|an|one|two|three|four|five|six|seven|ten)\s+(day|days|week|weeks)\s+(back|forward|forwards|earlier|later)\b/i;

const NUMBER_WORD: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10,
};

/** §15. Wording that names ONE instance of a repeating thing. */
const OCCURRENCE_RE =
  /\b(this\s+week'?s?|next\s+week'?s?|today'?s?|tomorrow'?s?|(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)'s)\s+/i;

/** Words that carry no identity and so can never name a record on their own. */
const PRONOUNS = new Set(["it", "that", "this", "them", "those", "these", "him", "her"]);

/** Filler stripped from a target phrase before matching. */
const STOPWORDS = new Set([
  "the", "my", "our", "a", "an", "to", "on", "at", "for", "with", "of", "and",
  "please", "appointment", "meeting", "session",
  // Words that describe the CHANGE, not the record. "Make the paper due Monday"
  // is about a record called Paper; leaving "due" in the query would look for
  // one called "paper due" and find nothing.
  "due", "deadline", "weekly", "daily", "monthly", "nightly", "yearly",
  "back", "forward", "instead", "now", "then",
]);

function numberFrom(word: string): number {
  const n = Number(word);
  return Number.isFinite(n) ? n : (NUMBER_WORD[word.toLowerCase()] ?? 0);
}

/** The signed day offset in "push it back two days", or undefined. */
export function extractShift(text: string): number | undefined {
  const m = SHIFT_RE.exec(text);
  if (!m) return undefined;
  const dir = (m[1] ?? m[6] ?? "").toLowerCase();
  const amount = numberFrom(m[2] ?? m[4] ?? "");
  const unit = (m[3] ?? m[5] ?? "").toLowerCase();
  if (!amount) return undefined;
  const days = unit.startsWith("week") ? amount * 7 : amount;
  // "back" and "earlier" mean EARLIER in time; "out" and "later" mean later.
  // Getting this backwards silently moves a deadline the wrong way, which is
  // why the confirmation always prints the resulting date rather than the
  // phrase (§30).
  const backwards = dir === "back" || dir === "earlier" || dir === "up";
  return backwards ? -days : days;
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const FROM_TO_RE =
  /\bfrom\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+to\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

/**
 * The weekday a "from X to Y" phrase moves a schedule ONTO.
 *
 * Without this, "move the staff meeting from Tuesday to Wednesday" resolves
 * both weekdays and the generic date parser picks the first one — so the
 * proposal reads "Every Tuesday → Every Tuesday" and confirming it does
 * nothing. The sentence names an old day and a new one, and only the second is
 * the instruction.
 */
export function extractWeekdayMove(text: string): { from: number; to: number } | undefined {
  const m = FROM_TO_RE.exec(text ?? "");
  if (!m) return undefined;
  return { from: WEEKDAY_NAMES.indexOf(m[1].toLowerCase()), to: WEEKDAY_NAMES.indexOf(m[2].toLowerCase()) };
}

/**
 * Pull the words that name the record out of an edit sentence.
 *
 * Everything between the edit verb and the temporal phrase, minus filler. This
 * is deliberately crude: it feeds a matcher that requires a real title hit, so
 * a sloppy query produces NO MATCH rather than a wrong one.
 */
export function extractTargetQuery(text: string, temporalPhrases: string[]): string {
  let t = ` ${text} `;
  for (const p of temporalPhrases) t = t.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  t = t
    .replace(STOP_RECURRENCE_RE, " ")
    // Deferral phrasing describes the change, not the record. "Come back to the
    // assignment tomorrow" is about a record called Assignment.
    .replace(DEFER_RE, " ")
    .replace(EDIT_VERB_RE, " ")
    .replace(IS_NOW_RE, " ")
    .replace(CANCEL_RE, " ")
    .replace(CLEAR_TIME_RE, " ")
    .replace(SHIFT_RE, " ")
    .replace(OCCURRENCE_RE, " ")
    .replace(/\b(stop|end|remove|clear|drop|come|deal|put|revisit)\b/gi, " ")
    .replace(/\b(to|from|back|until|but|keep|the|please)\b/gi, " ")
    // "Tuesday's staff meeting" leaves a bare possessive behind.
    .replace(/'s\b/g, " ")
    .replace(/[.,;:!?'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
    .join(" ")
    .trim();
}

/**
 * What a preceding clause is ABOUT.
 *
 * "I didn't work out today" is about working out. Stripping the subject, the
 * negation and the day leaves the thing itself — which then goes through the
 * same strict matcher as any other query, so a bad guess here produces NO MATCH
 * rather than a wrong record.
 */
export function referentOf(clause: string): string {
  return (clause ?? "")
    .replace(/\b(i|we|you)\b/gi, " ")
    .replace(/\b(did\s*n'?t|didnt|do\s*n'?t|dont|have\s*n'?t|havent|has\s*n'?t|hasnt|never|forgot\s+to|failed\s+to|missed)\b/gi, " ")
    .replace(/\b(today|yesterday|tonight|this\s+morning|this\s+afternoon|this\s+evening|last\s+night)\b/gi, " ")
    .replace(/[.,;:!?'"]/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()) && !PRONOUNS.has(w.toLowerCase()))
    .join(" ")
    .trim();
}

// --------------------------------------------------------------- matching ---

const MIN_QUERY_CHARS = 3;

function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function contentWords(s: string): string[] {
  return norm(s).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function targetOfAction(a: NextAction): EditTarget {
  return {
    kind: "action", id: a.id, title: a.title,
    currentDate: a.dueDate, currentTime: a.dueTime,
    recurrence: readRule(a.recurrence) ?? undefined,
    status: a.status,
    // §18. A finished one-time action is history, not a plan.
    blocked: a.status === "completed"
      ? "This action is already completed."
      : a.status === "cancelled" ? "This action was cancelled." : undefined,
  };
}

function targetOfEvent(e: LifeEvent): EditTarget {
  return {
    kind: "event", id: e.id, title: e.title,
    currentDate: e.date, currentTime: e.startTime,
    recurrence: readRule(e.recurrence) ?? undefined,
    // LIFEOS-067 §14, §31. An externally-owned Event's schedule belongs to the
    // calendar it came from, and this integration is READ-ONLY. Moving it here
    // would change Conqify and not Google, the next refresh would move it back,
    // and in between the user would believe they had rescheduled something they
    // had not. Blocked and SAID, rather than allowed and quietly reverted.
    blocked: isExternallyOwned(e)
      ? `“${e.title}” comes from your ${e.externalProvider} calendar. Conqify reads that calendar but can't write to it, so a change made here wouldn't reach it — and the next refresh would put it back. Change it there instead.`
      : undefined,
  };
}

/**
 * Find the records a query could mean (§7).
 *
 * Deterministic and deliberately narrow: **every content word in the query must
 * appear in the record's title**. "dentist" matches "Dentist appointment";
 * "dentist crown" does not match "Dentist appointment". Fuzzy scoring is what
 * produces a confident wrong mutation, and a wrong mutation is silent.
 */
export function matchEditTargets(
  query: string,
  state: StoreState,
  targetType: TemporalEditIntent["targetType"] = "unknown",
): EditTarget[] {
  const words = contentWords(query);
  if (words.length === 0 || norm(query).length < MIN_QUERY_CHARS) return [];

  // "work out" and "Workout" are the same thing said two ways. Collapsing
  // whitespace on BOTH sides is a bounded normalisation, not fuzzy matching: it
  // can merge words, never substitute them.
  const squash = (x: string) => norm(x).replace(/\s+/g, "");
  const joined = squash(query);
  const covers = (title: string) => {
    const t = norm(title);
    if (words.every((w) => t.includes(w))) return true;
    return joined.length >= MIN_QUERY_CHARS && squash(title).includes(joined);
  };

  const hits: EditTarget[] = [];
  if (targetType !== "event") {
    for (const a of state.nextActions ?? []) if (covers(a.title)) hits.push(targetOfAction(a));
  }
  if (targetType !== "action") {
    for (const e of state.events ?? []) if (covers(e.title)) hits.push(targetOfEvent(e));
  }

  // A record whose title is EXACTLY the query beats one that merely contains it.
  // "Move class to Friday" with both "Class" and "Class rescheduling notes"
  // should not be a coin flip.
  const exact = hits.filter((h) => norm(h.title) === norm(query));
  return exact.length > 0 ? exact : hits;
}

/** §8. Authority follows from the count, never from recency or a tiebreak. */
export function authorityFor(matches: EditTarget[]): MatchAuthority {
  if (matches.length === 0) return "no_match";
  return matches.length === 1 ? "unambiguous" : "ambiguous";
}

// -------------------------------------------------------------- detection ---

/**
 * Is this sentence asking to change something that already exists?
 *
 * Requires BOTH an edit verb AND something temporal to change it to. "Move the
 * sofa to the garage" has the verb and no schedule, so it stays an ordinary
 * capture — which is the discriminator that keeps Capture safe (§27).
 */
export function looksLikeTemporalEdit(text: string, today: DayKey): boolean {
  const t = text ?? "";
  if (CANCEL_RE.test(t) || STOP_RECURRENCE_RE.test(t) || CLEAR_TIME_RE.test(t)) return true;
  // "Come back to the assignment tomorrow" carries no move verb and is still a
  // change to an existing record — it is the deferral half of §16, and leaving
  // it out would send it down the capture path to become a second copy of the
  // thing the user was trying to postpone.
  const hasVerb = EDIT_VERB_RE.test(t) || IS_NOW_RE.test(t) || DEFER_RE.test(t);
  if (!hasVerb) return false;
  if (extractShift(t) !== undefined) return true;
  const temporal = extractTemporal(t, today);
  return !!temporal.dueDate || !!extractTimeOfDay(t) || !!extractRecurrence(t)?.rule;
}

function operationFor(text: string, hasDate: boolean, hasTime: boolean, hasRule: boolean, shift?: number): EditOperation {
  if (STOP_RECURRENCE_RE.test(text)) return "stop_recurrence";
  if (CANCEL_RE.test(text)) return "cancel_event";
  if (CLEAR_TIME_RE.test(text)) return "clear_time";
  // §16. Defer and due date are different concepts and the language separates
  // them. "Come back to this tomorrow" hides it; "move the deadline to
  // tomorrow" changes when it is owed.
  if (DEFER_RE.test(text) && !/\bdeadline|\bdue\b/i.test(text)) return "defer";
  if (hasRule) return "change_recurrence";
  if (shift !== undefined) return "move_date";
  if (hasTime && !hasDate) return "change_time";
  return "move_date";
}

/**
 * Read one sentence as an edit, or return `null`.
 *
 * `priorSegment` carries the words of the clause immediately before this one in
 * the SAME utterance, so "I didn't work out today. Move it to tomorrow."
 * resolves — the referent is in the sentence the user just typed, not in hidden
 * session state (§9). With no prior segment, a pronoun names nothing and the
 * intent comes back unresolved rather than guessing.
 */
export function detectTemporalEdit(
  text: string,
  state: StoreState,
  today: DayKey,
  priorSegment?: string,
  /**
   * A record the SURFACE is currently holding — the one just proposed or just
   * changed. §9 allows this and nothing looser: it is a referent the user can
   * see on screen, not a guess about what they probably meant. Passing anything
   * the user cannot see would make "move it" mean whatever was most recent,
   * which is the invisible global state §9 forbids.
   */
  contextTarget?: EditTarget,
): TemporalEditIntent | null {
  const src = (text ?? "").trim();
  if (!src || !looksLikeTemporalEdit(src, today)) return null;

  const temporal = extractTemporal(src, today);
  const timeFinding = extractTimeOfDay(src);
  const recFinding = extractRecurrence(src);
  let rule = recFinding?.rule ? completeRule(recFinding.rule, temporal.dueDate ?? today) : undefined;
  // "…from Tuesday to Wednesday" is a schedule change whose target is the
  // SECOND weekday. The generic parser cannot know that; the phrase can.
  const weekdayMove = extractWeekdayMove(src);
  if (weekdayMove && weekdayMove.to >= 0) {
    rule = { frequency: "weekly", interval: rule?.interval ?? 1, weekdays: [weekdayMove.to] };
  }
  const shift = extractShift(src);

  const phrases = [
    ...temporal.findings.map((f) => f.phrase),
    timeFinding?.phrase, recFinding?.phrase,
  ].filter((p): p is string => !!p);

  let query = extractTargetQuery(src, phrases);
  // A pronoun names nothing. Look one clause back, in this same utterance — and
  // only there. "I didn't work out today. Move it to tomorrow." carries its own
  // referent; "Move it to tomorrow." on its own does not, and must stay
  // unresolved rather than reach for hidden session state (§9).
  const namesNothing = query.length < MIN_QUERY_CHARS
    || query.split(" ").every((w) => PRONOUNS.has(w.toLowerCase()));
  if (namesNothing) query = priorSegment ? referentOf(priorSegment) : "";

  const useContext = query.length < MIN_QUERY_CHARS && !!contextTarget;

  const operation = weekdayMove
    ? "change_recurrence" as const
    : operationFor(src, !!temporal.dueDate, !!timeFinding, !!rule, shift);
  const targetType: TemporalEditIntent["targetType"] =
    operation === "cancel_event" ? "unknown" : "unknown";
  const matches = useContext ? [contextTarget!] : matchEditTargets(query, state, targetType);
  const authority = authorityFor(matches);

  const intent: TemporalEditIntent = {
    targetType,
    targetQuery: useContext ? contextTarget!.title : query,
    operation,
    proposedFields: {
      date: temporal.dueDate,
      time: timeFinding?.time,
      recurrence: rule,
      shiftDays: shift,
    },
    sourceText: src,
    confidence: authority === "unambiguous" ? "high" : authority === "ambiguous" ? "likely" : "possible",
    authority,
    candidateMatches: matches,
    unresolved: temporal.unresolved,
  };

  intent.refusal = refusalFor(intent, src);
  return intent;
}

/**
 * Why this edit will not be applied, if it will not.
 *
 * Computed once, before anything is shown, so the UI never renders a Confirm
 * button for a change that would then be refused.
 */
export function refusalFor(intent: TemporalEditIntent, text: string): EditRefusal | undefined {
  const only = intent.candidateMatches.length === 1 ? intent.candidateMatches[0] : undefined;

  if (intent.authority === "no_match") {
    return {
      code: "no_target",
      message: intent.targetQuery
        ? `Couldn't find anything called “${intent.targetQuery}” to change.`
        : "Couldn't tell which record you want to change.",
    };
  }

  if (only?.blocked) {
    return {
      code: only.kind === "event"
        // LIFEOS-067 §14. The only thing that blocks an EVENT is external
        // ownership — events have no status to be completed or cancelled.
        ? "external_read_only"
        : intent.operation === "complete" ? "already_complete" : "completed_action",
      message: only.blocked,
    };
  }

  // LIFEOS-066 §18. An Event has no status — it happened or it didn't — so
  // there is nothing to tick, and inventing one would be a new life noun (§35).
  if (intent.operation === "complete" && only && only.kind !== "action") {
    return {
      code: "not_completable",
      message: `“${only.title}” is an event — events aren't checked off, they either happened or they didn't.`,
    };
  }

  // §15. LIFEOS-061 has no recurrence exceptions, so "Tuesday's staff meeting"
  // cannot be moved on its own. Pretending otherwise would either change every
  // Tuesday or quietly do nothing; both are worse than saying so.
  // `complete` is exempt: closing ONE occurrence of a repeating action is the
  // one per-occurrence operation LIFEOS-061 does support (`completeOccurrence`),
  // so refusing it here would deny a capability that exists.
  if (only?.recurrence && OCCURRENCE_RE.test(text)
      && intent.operation !== "stop_recurrence" && intent.operation !== "complete") {
    return {
      code: "occurrence_not_supported",
      message: `“${only.title}” repeats — ${describeRule(only.recurrence)}. Conqify can't move one occurrence on its own yet; it can change the whole schedule.`,
    };
  }

  // §13. An Event has no cancelled state — only deletion. So "cancel" is never
  // silently mapped onto a permanent delete; the consequence is named and the
  // user confirms THAT, not the word they happened to use.
  if (intent.operation === "cancel_event" && only?.kind === "event") {
    return {
      code: "no_cancellation_state",
      message: `Conqify has no “cancelled” state for events — removing “${only.title}” deletes it, and it won't appear in your history.`,
    };
  }

  // §32. A relative shift needs something to shift FROM.
  if (intent.proposedFields.shiftDays !== undefined && only && !only.currentDate) {
    return {
      code: "no_date_to_shift",
      message: `“${only.title}” has no date yet, so there's nothing to move it from.`,
    };
  }

  // §11. A time with no day names no moment — the store refuses it, so this
  // refuses it first, with a sentence instead of a silent no-op.
  if (intent.operation === "change_time" && only?.kind === "action"
      && !only.currentDate && !only.recurrence && !intent.proposedFields.date) {
    return {
      code: "time_needs_a_day",
      message: `“${only.title}” has no date, so a time on its own wouldn't name a moment. Give it a day too.`,
    };
  }

  if (intent.operation === "change_recurrence" && !intent.proposedFields.recurrence) {
    return {
      code: "recurrence_unsupported",
      message: "Conqify can't store that schedule yet.",
    };
  }

  return undefined;
}

// ------------------------------------------------------------- the proposal --

/** The before/after a user confirms. Plain values — never a patch object (§23). */
export interface EditProposal {
  target: EditTarget;
  operation: EditOperation;
  before: { date?: DayKey; time?: LocalTime; recurrence?: string };
  after: { date?: DayKey; time?: LocalTime; recurrence?: string; deleted?: boolean; deferredUntil?: DayKey; completed?: boolean };
  /** One line, in the user's terms, describing the change. */
  summary: string;
  refusal?: EditRefusal;
  /**
   * The rule the apply step will write.
   *
   * `after.recurrence` is a SENTENCE for the user ("Every Wednesday"); this is
   * the value. Keeping them separate stops the display string from ever being
   * parsed back into data, which is how a round-trip loses an interval.
   */
  ruleForApply?: RecurrenceRule;
}

function describeWhen(date?: DayKey, time?: LocalTime): string {
  if (!date && !time) return "no date";
  if (date && time) return `${formatDayKey(date)} · ${formatLocalTime(time)}`;
  if (date) return formatDayKey(date);
  return formatLocalTime(time!);
}

/**
 * Turn an intent plus a chosen record into the exact change (§5, §23).
 *
 * Every field the operation does not touch is carried through unchanged, which
 * is where §10's "do not silently erase time" is enforced: moving a date builds
 * an `after` that still holds the record's current time.
 */
export function buildProposal(intent: TemporalEditIntent, target: EditTarget): EditProposal {
  const before = {
    date: target.currentDate,
    time: target.currentTime,
    recurrence: target.recurrence ? describeRule(target.recurrence) : undefined,
  };
  const p = intent.proposedFields;
  const after: EditProposal["after"] = { ...before };
  let summary = "";

  switch (intent.operation) {
    case "move_date": {
      const next = p.shiftDays !== undefined && target.currentDate
        ? addDays(target.currentDate, p.shiftDays)
        : p.date;
      after.date = next ?? before.date;
      // The stated time survives a date move unless the sentence changed it.
      after.time = p.time ?? before.time;
      summary = `${describeWhen(before.date, before.time)} → ${describeWhen(after.date, after.time)}`;
      break;
    }
    case "change_time": {
      after.date = p.date ?? before.date;
      after.time = p.time;
      summary = `${describeWhen(before.date, before.time)} → ${describeWhen(after.date, after.time)}`;
      break;
    }
    case "clear_time": {
      after.date = p.date ?? before.date;
      after.time = undefined;
      summary = `${describeWhen(before.date, before.time)} → ${describeWhen(after.date, undefined)}`;
      break;
    }
    case "defer": {
      after.deferredUntil = p.date;
      // A deferral does NOT touch the due date. Collapsing the two is §16's
      // whole warning: one hides the item, the other changes what is owed.
      summary = p.date ? `Hidden until ${formatDayKey(p.date)} · due date unchanged` : "Hidden until you come back to it";
      break;
    }
    case "cancel_event": {
      after.deleted = true;
      summary = `“${target.title}” would be deleted`;
      break;
    }
    case "change_recurrence": {
      after.recurrence = p.recurrence ? describeRule(p.recurrence) : before.recurrence;
      after.time = p.time ?? before.time;
      summary = `${before.recurrence ?? "no schedule"} → ${after.recurrence ?? "no schedule"}`;
      break;
    }
    case "stop_recurrence": {
      after.recurrence = undefined;
      summary = `${before.recurrence ?? "repeating"} → stops repeating`;
      break;
    }
    // LIFEOS-066 §6, §18. A recurring action does NOT close when one occurrence
    // does — that is the LIFEOS-061 contract — so the two say different things,
    // and the panel has to show which one is about to happen.
    case "complete": {
      after.completed = true;
      // Only a repeating action has a per-day completion, so only there does the
      // reported day mean anything. On a one-time action the date is untouched.
      if (target.recurrence) after.date = p.date ?? before.date;
      summary = target.recurrence
        ? `${p.date ? formatDayKey(p.date) : "This"} occurrence → done · keeps repeating`
        : `${target.status === "waiting" ? "Waiting" : "Open"} → Completed`;
      break;
    }
  }

  return {
    target, operation: intent.operation, before, after, summary,
    refusal: intent.refusal,
    ruleForApply: intent.operation === "change_recurrence" ? p.recurrence : undefined,
  };
}

// ------------------------------------------------------------- multi-edit ---

/**
 * Break an utterance into clauses that can each be judged as an edit.
 *
 * Sentence terminators first — "I didn't work out today. Move it to tomorrow."
 * is two clauses and the first is the referent for the second. Then " and ",
 * but only when the tail carries a schedule of its own: "Move workout to
 * tomorrow and dentist to Friday at 3" is two changes, while "Move the sofa and
 * the chair to the garage" is one sentence about furniture.
 *
 * A tail that inherits its verb gets it back verbatim ("Move " + "dentist to
 * Friday at 3"), because dropping the verb would make the second half read as a
 * new capture rather than a change.
 */
export function splitEditClauses(text: string): string[] {
  const sentences = (text ?? "")
    .split(/(?<=[.;!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const sentence of sentences) {
    const verb = EDIT_VERB_RE.exec(sentence)?.[0];
    const at = sentence.search(/\s+and\s+/i);
    if (!verb || at < 0) { out.push(sentence); continue; }

    const head = sentence.slice(0, at).trim();
    const tail = sentence.slice(at).replace(/^\s*and\s+/i, "").trim();
    // Split only if BOTH halves name a schedule. Otherwise "and" is joining two
    // objects of one verb, not two instructions.
    const bothTemporal = /\d|\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|noon|midnight|next\s+week)\b/i;
    if (bothTemporal.test(head) && bothTemporal.test(tail) && !EDIT_VERB_RE.test(tail)) {
      out.push(head, `${verb} ${tail}`);
    } else {
      out.push(sentence);
    }
  }
  // `decompose` is still consulted for anything that did not split above, so a
  // shape it already understands is not re-litigated here.
  if (out.length === 1) {
    const segs = decompose(out[0]);
    if (segs.length > 1) return segs.map((x) => x.text);
  }
  return out;
}

/**
 * Read a whole utterance as ZERO OR MORE independent edits (§24).
 *
 * "Move workout to tomorrow and dentist to Friday at 3" is two changes, each
 * confirmed on its own. One atomic all-or-nothing mutation would mean a user who
 * disagrees with the second has to retype the first.
 *
 * `decompose` is reused rather than re-split: it already knows how to break an
 * utterance on intent shape, and having two splitters disagree is how "and" ends
 * up meaning something different in Capture than it does here.
 */
export function detectTemporalEdits(
  text: string,
  state: StoreState,
  today: DayKey,
  contextTarget?: EditTarget,
): TemporalEditIntent[] {
  const src = (text ?? "").trim();
  if (!src) return [];

  const parts = splitEditClauses(src);
  const out: TemporalEditIntent[] = [];
  for (let i = 0; i < parts.length; i++) {
    const intent = detectTemporalEdit(parts[i], state, today, i > 0 ? parts[i - 1] : undefined, contextTarget);
    if (intent) out.push(intent);
  }

  // Nothing split usefully, but the whole sentence reads as one edit.
  if (out.length === 0) {
    const whole = detectTemporalEdit(src, state, today, undefined, contextTarget);
    if (whole) out.push(whole);
  }
  return out;
}
