/**
 * The Today projection (LIFEOS-062 §1, §5, §28).
 *
 * ## Today is a projection of recorded life, not a verdict on the person
 *
 * Every number here is a count of records. Nothing is scored, graded, ranked
 * against a target, or compared to other people. The language rules are enforced
 * by a test (`FORBIDDEN_TODAY_WORDS`) rather than left to whoever writes the next
 * card: "neglected", "failing", "behind", "off track" describe a person, and
 * this page describes records.
 *
 * ## Sections disappear when empty
 *
 * A section with nothing in it is not a section — it is a reminder that you have
 * not filled something in. Every group here returns an empty array and the UI
 * renders nothing, so an ordinary day shows three lines rather than a dashboard
 * of eight empty panels.
 *
 * ## Coverage is disclosed
 *
 * `COVERAGE_NOTE` says Today reflects what was RECORDED. No data is not the same
 * as no life activity, and a page that quietly implies otherwise is lying by
 * omission about its own reach.
 *
 * ## Pure — and one index pass
 *
 * A function of `(state, today, now)`. Every index it needs arrives prebuilt from
 * `lib/today/indexes.ts`; nothing here scans the store a second time.
 */

import type { LifeEvent, NextAction, Project, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { dayDiff } from "@/lib/reviews/dates";
import { isLive, overdueActions, dueTodayActions, upcomingActions, sortByDue } from "@/lib/actions/due";
import { blockersOf } from "@/lib/actions/dependencies";
import { occurrenceFor } from "@/lib/mvpStore";
import { readRule, describeRule } from "@/lib/time/recurrence";
import { upcomingOccurrences, type EventOccurrence } from "@/lib/time/events";
import { returnSuggestion, type ReturnSuggestion } from "@/lib/planning/today-signals";
import { recommendNextAction, type RecommendResult } from "@/lib/today/recommend";
import type { TodayIndexes } from "@/lib/today/indexes";

/** Stated on the page. Today reflects records, not a life. */
export const COVERAGE_NOTE = "Today is based on what you've recorded in Conqify.";

/** Shown when there is nothing at all. Points straight back at Capture (§29). */
export const EMPTY_PROMPT = "Tell Conqify what's going on.";

/**
 * Words this page may never use about a person.
 *
 * Asserted across every string Today produces. The list is short because the
 * failure it prevents is specific: a projection that starts characterising the
 * reader has stopped being a projection.
 */
export const FORBIDDEN_TODAY_WORDS: readonly string[] = [
  "neglected", "failing", "failed", "behind in life", "behind schedule", "lazy",
  "off track", "unproductive", "you should already", "you're late", "you are late",
  "crush", "slacking", "procrastinat", "streak", "productivity score", "alignment score",
];

/** One recurring action asking for its occurrence today. */
export interface RecurringToday {
  action: NextAction;
  occurrence: DayKey;
  schedule: string;
}

/** An action blocked by something unfinished. Factual, never a judgment. */
export interface BlockedItem {
  action: NextAction;
  blockers: NextAction[];
}

/** A waiting item, with what it is waiting on and since when. */
export interface WaitingItem {
  action: NextAction;
  /** The user's own string. Never a Person record (§9). */
  waitingOn?: string;
  since?: string;
  /** True when a follow-up date has arrived. */
  followUpDue: boolean;
}

/** A short, factual line about one project. No score, no percentage (§12). */
export interface ProjectPulse {
  project: Project;
  nextAction?: NextAction;
  blockedCount: number;
  waitingCount: number;
  nearestDue?: DayKey;
  /** True when the project has open work but no next action to take. */
  needsNextAction: boolean;
}

export interface UpcomingItem {
  kind: "event" | "action";
  date: DayKey;
  title: string;
  id: string;
  time?: string;
  schedule?: string;
}

export interface TodayView {
  today: DayKey;
  /** NOW — immediate temporal context, or nothing. */
  nowEvent?: EventOccurrence;
  nextEvent?: EventOccurrence;
  minutesToNextEvent?: number;
  /** TODAY */
  occurrences: EventOccurrence[];
  dueToday: NextAction[];
  recurringToday: RecurringToday[];
  /**
   * Open work with no due date that still belongs to today: started, planned
   * for today, or captured today.
   *
   * Without this an errand you just typed has nowhere to land — it is not due,
   * not planned, and not blocked, so every other section correctly ignores it
   * and the thing you told Conqify thirty seconds ago is invisible. Bounded by
   * construction (in progress, or explicitly planned, or created today) so it
   * can never become an undated backlog dumped onto Today.
   */
  alsoToday: NextAction[];
  /** NEEDS ATTENTION */
  overdue: NextAction[];
  returnedToday: NextAction[];
  blocked: BlockedItem[];
  /** WAITING */
  waiting: WaitingItem[];
  /** RETURN */
  returnItem: ReturnSuggestion | null;
  /** UPCOMING */
  upcoming: UpcomingItem[];
  /** PROJECT PULSE */
  pulse: ProjectPulse[];
  /** SUGGESTED NEXT */
  suggestion: RecommendResult;
  /** True when there is genuinely nothing recorded to show. */
  empty: boolean;
}

const UPCOMING_DAYS = 7;
const MAX_UPCOMING = 8;
const MAX_PULSE = 5;

/** Is this event happening right now, by wall clock? */
function isNow(o: EventOccurrence, now: string): boolean {
  if (o.allDay || !o.startTime) return false;
  if (o.startTime > now) return false;
  return o.endTime ? o.endTime >= now : false;
}

export function buildTodayView(state: StoreState, ix: TodayIndexes): TodayView {
  const today = ix.today;
  const actions = state.nextActions ?? [];
  const live = actions.filter(isLive);

  // ---- TODAY -------------------------------------------------------------
  // A recurring action is a standing source: its occurrence is asked for here,
  // and it never appears in the ordinary due list, or it would show twice.
  const recurringToday: RecurringToday[] = [];
  for (const a of live) {
    const rule = readRule(a.recurrence);
    if (!rule) continue;
    if (occurrenceFor(a, today, ix.completions) === today) {
      recurringToday.push({ action: a, occurrence: today, schedule: describeRule(rule) });
    }
  }
  const nonRecurring = live.filter((a) => !readRule(a.recurrence));
  const dueToday = sortByDue(dueTodayActions(nonRecurring, today), today);
  const dueTodayIds = new Set(dueToday.map((a) => a.id));

  const alsoToday = nonRecurring.filter((a) => {
    if (dueTodayIds.has(a.id) || a.status === "waiting") return false;
    if (a.dueDate && a.dueDate !== today) return false;
    if (ix.blockedActionIds.has(a.id)) return false;
    return (
      a.status === "in_progress" ||
      ix.plannedTodayIds.has(a.id) ||
      (a.createdAt ?? "").slice(0, 10) === today
    );
  });

  // ---- NEEDS ATTENTION ---------------------------------------------------
  const overdue = sortByDue(overdueActions(nonRecurring, today), today);
  const returnedToday = nonRecurring.filter((a) => a.deferredUntil === today);

  const blocked: BlockedItem[] = [];
  for (const a of nonRecurring) {
    if (!ix.blockedActionIds.has(a.id)) continue;
    // Only surface blocked items that would otherwise be due — a blocked item
    // with no deadline is not risk, it is just later.
    if (!a.dueDate || a.dueDate > today) continue;
    blocked.push({ action: a, blockers: blockersOf(a.id, ix.blockedByMap, ix.actionsById) });
  }

  // ---- WAITING -----------------------------------------------------------
  const waiting: WaitingItem[] = actions
    .filter((a) => a.status === "waiting")
    .map((a) => ({
      action: a,
      waitingOn: a.waitingOn?.trim() || undefined,
      since: a.waitingSince,
      followUpDue: !!a.followUpDate && a.followUpDate <= today,
    }))
    // Follow-ups that have come due first; then longest-waiting, which is a fact
    // about the record rather than a claim about the person waited on.
    .sort((x, y) => {
      if (x.followUpDue !== y.followUpDue) return x.followUpDue ? -1 : 1;
      return (x.since ?? "").localeCompare(y.since ?? "");
    });

  // ---- UPCOMING ----------------------------------------------------------
  const upcoming: UpcomingItem[] = [];
  for (const o of upcomingOccurrences(state, today, UPCOMING_DAYS)) {
    if (o.date === today) continue;
    upcoming.push({
      kind: "event", id: o.event.id, date: o.date, title: o.event.title,
      time: o.allDay ? undefined : o.startTime,
      schedule: o.event.recurrence ? describeRule(o.event.recurrence) : undefined,
    });
  }
  for (const a of upcomingActions(nonRecurring, today, UPCOMING_DAYS)) {
    if (!a.dueDate || a.dueDate === today) continue;
    upcoming.push({ kind: "action", id: a.id, date: a.dueDate, title: a.title, time: a.dueTime });
  }
  upcoming.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : (a.time ?? "").localeCompare(b.time ?? "")));

  // ---- PROJECT PULSE -----------------------------------------------------
  // Only projects with something USEFUL to say. A project with nothing to
  // report is not a problem to flag; it is a project with nothing to report.
  const pulse: ProjectPulse[] = [];
  for (const project of state.projects ?? []) {
    if (project.status !== "active") continue;
    const mine = live.filter((a) => a.projectId === project.id);
    if (mine.length === 0) continue;
    const executable = mine.filter((a) => a.status !== "waiting" && !ix.blockedActionIds.has(a.id));
    const nextAction = sortByDue(executable, today)[0];
    const blockedCount = mine.filter((a) => ix.blockedActionIds.has(a.id)).length;
    const waitingCount = mine.filter((a) => a.status === "waiting").length;
    const dated = mine.map((a) => a.dueDate).filter((d): d is string => !!d).sort();
    const needsNextAction = executable.length === 0;
    if (!nextAction && blockedCount === 0 && waitingCount === 0 && !needsNextAction) continue;
    pulse.push({ project, nextAction, blockedCount, waitingCount, nearestDue: dated[0], needsNextAction });
  }
  pulse.sort((a, b) => (a.nearestDue ?? "9999").localeCompare(b.nearestDue ?? "9999"));

  const nowEvent = ix.occurrences.find((o) => isNow(o, ix.now));

  const view: TodayView = {
    today,
    nowEvent,
    nextEvent: ix.nextEvent,
    minutesToNextEvent: ix.minutesToNextEvent,
    occurrences: ix.occurrences,
    dueToday,
    recurringToday,
    alsoToday,
    overdue,
    returnedToday,
    blocked,
    waiting,
    returnItem: returnSuggestion(state, ix.activity, undefined, today),
    upcoming: upcoming.slice(0, MAX_UPCOMING),
    pulse: pulse.slice(0, MAX_PULSE),
    suggestion: recommendNextAction(state, ix, today),
    empty: false,
  };

  view.empty =
    ix.occurrences.length === 0 && dueToday.length === 0 && recurringToday.length === 0 &&
    alsoToday.length === 0 &&
    overdue.length === 0 && returnedToday.length === 0 && blocked.length === 0 &&
    waiting.length === 0 && upcoming.length === 0 && pulse.length === 0 &&
    !view.returnItem && !view.suggestion.recommendation;

  return view;
}

/** Days a waiting item has been waiting, or undefined. Factual, never scored. */
export function waitingDays(item: WaitingItem, today: DayKey): number | undefined {
  if (!item.since) return undefined;
  const key = item.since.slice(0, 10);
  // `dayDiff(a, b)` is a MINUS b, so today minus the start date.
  return key < today ? dayDiff(today, key) : 0;
}

/** Does any string Today produces characterise the reader? Used by the suite. */
export function violatesTodayLanguage(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return FORBIDDEN_TODAY_WORDS.filter((w) => low.includes(w));
}

/** Every user-visible string in a view, for the language assertion. */
export function todayStrings(view: TodayView): string[] {
  const out: string[] = [COVERAGE_NOTE, EMPTY_PROMPT];
  for (const r of view.suggestion.recommendation?.reasons ?? []) out.push(r.text);
  if (view.suggestion.note) out.push(view.suggestion.note);
  for (const r of view.recurringToday) out.push(r.schedule);
  for (const u of view.upcoming) if (u.schedule) out.push(u.schedule);
  if (view.returnItem) out.push(view.returnItem.reason);
  return out;
}

/** Kept so a caller can name an event without importing the type twice. */
export type { LifeEvent };
