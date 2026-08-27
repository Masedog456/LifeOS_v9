/**
 * The Daily Executive Loop (LIFEOS-073).
 *
 * ## The day is a loop, not a dashboard
 *
 * Today already held eleven headings, and a user wanting to know what their day
 * looked like had to reconstruct it from all of them. This module composes the
 * three questions that actually start a day —
 *
 *     what is FIXED · what needs ATTENTION · what should I do NEXT
 *
 * — and the ones that close it: what I completed, what changed, what is still
 * open, what is waiting, what is tomorrow, and what I wrote.
 *
 * ## Composed, never re-derived
 *
 * Nothing here is a second engine. `nextAction` is LIFEOS-072's recommender,
 * `attention` is LIFEOS-070's commitment signals, `completedToday` and
 * `changedToday` are LIFEOS-064's autobiographical evidence over a one-day
 * range, and every mutation offered on a row is LIFEOS-071's resolver. If two
 * surfaces disagree about the day, that is a bug in one shared model rather
 * than a difference of opinion between two.
 *
 * ## Nothing is persisted (§1, §28)
 *
 * No daily-summary table, no day-session record, no persisted morning or
 * evening state. Head stays 0042. A function of `(state, indexes, today)`,
 * which is what lets tomorrow's regeneration still be grounded in the same
 * underlying events.
 *
 * ## Fixed is not the same as flexible (§3)
 *
 * An Event happens at a time whether or not the user acts. A due-date action
 * with no time is work they can place anywhere in the day. Presenting the
 * second as though it occupied a calendar slot would be the product inventing a
 * schedule it never made, so the two are separated at the model level and the
 * UI cannot accidentally merge them.
 *
 * ## What this refuses to say
 *
 *   scheduled ≠ attended     — nothing records attendance, so nothing claims it
 *   open      ≠ failed       — "Still open" is a status, not a verdict
 *   evening   ≠ finished     — "Review today", never "your day is complete"
 *   quiet     ≠ tomorrow     — undated open work is never invented into tomorrow
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { todayKey, addDays, formatDayKey } from "@/lib/reviews/dates";
import { resolveRange } from "@/lib/insights/range";
import { isLive, dueKeyOf, sortByDue } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";
import { readRule, describeRule } from "@/lib/time/recurrence";
import { occurrenceFor } from "@/lib/mvpStore";
import { upcomingOccurrences, type EventOccurrence } from "@/lib/time/events";
import {
  buildRangeReview, COVERAGE_NOTE, COMPLETION_KINDS,
  type AutobiographicalEvent, type OpenLine, type RangeReview, type WaitingLine,
} from "@/lib/memory/week";
import { buildCommitmentSignals, type CommitmentSignal } from "@/lib/commitment/signals";
import { recommendNextAction, type RecommendResult } from "@/lib/today/recommend";
import type { TodayIndexes } from "@/lib/today/indexes";

/** Shown at the top of the day. A count of records, never a grade. */
export const DAILY_COVERAGE = COVERAGE_NOTE;

/** Nothing was recorded. Never "you did nothing today" (§22). */
export const NO_CHANGES_TODAY = "No recorded changes today.";

/** Nothing is dated for tomorrow. Never "you're free" (§22). */
export const NOTHING_TOMORROW =
  "Nothing dated for tomorrow stands out from what Conqify has recorded.";

/** The evening entry point. Never "your day is complete" (§20). */
export const REVIEW_TODAY_LABEL = "Review today";

/**
 * A commitment that happens at a time, whether or not the user acts (§3, §7).
 *
 * Only two things qualify: a calendar Event, and an action carrying an explicit
 * due TIME. Everything else is flexible by definition.
 */
export interface FixedItem {
  kind: "event" | "action";
  id: string;
  title: string;
  /** Local wall-clock start, or undefined for an all-day Event. */
  time?: string;
  /** Factual descriptor — "All day", a recurrence rule. Never a judgment. */
  detail?: string;
  event?: EventOccurrence;
  action?: NextAction;
}

/**
 * Work the user can place anywhere in the day (§3).
 *
 * A due date with no time, today's occurrence of a recurring action, work
 * explicitly planned for today, or anything else executable. These do NOT
 * occupy calendar slots and the model never implies they do.
 */
export interface FlexibleItem {
  action: NextAction;
  /** Why it belongs to today. One recorded fact. */
  reason: "due_today" | "recurring_today" | "planned_today" | "in_progress";
  detail: string;
}

/** One factual line for tomorrow. Dated evidence only (§15). */
export interface TomorrowItem {
  kind: "event" | "action" | "recurring";
  id: string;
  title: string;
  time?: string;
  detail?: string;
}

export interface DailyExecutiveView {
  date: DayKey;
  /** Happens at a time whether or not you act (§3). */
  fixedToday: FixedItem[];
  /** Yours to place. Never implied to occupy a slot (§3). */
  flexibleToday: FlexibleItem[];
  /** LIFEOS-070's signals, unchanged — not a second attention model (§2). */
  attention: CommitmentSignal[];
  /** LIFEOS-072's recommender, unchanged — not a second recommender (§2). */
  nextAction: RecommendResult;
  waiting: WaitingLine[];
  /** Autobiographical evidence for TODAY (§5, §12). */
  completedToday: AutobiographicalEvent[];
  changedToday: AutobiographicalEvent[];
  stillOpen: OpenLine[];
  tomorrow: TomorrowItem[];
  /** The user's own words only — machine prose is filtered upstream (§18). */
  reflections: AutobiographicalEvent[];
  /** Arithmetic over the above. Never an evaluation (§21). */
  summary: string;
  coverage: string;
  limitations: string[];
  /** True when the day holds nothing recorded at all. */
  empty: boolean;
  /** The underlying one-day review, for surfaces that want the raw grouping. */
  review: RangeReview;
}

/**
 * Kinds that answer "what changed today?" (§10, §25).
 *
 * Every member is a recorded transition. There is deliberately no
 * `action_worked_on` and no `became_unblocked`, and §25 excludes exactly those.
 * Nothing records the second at all. For the first, `started`/`resumed` history
 * events do exist — but they mark picking a task up, not effort spent on it,
 * and there is no autobiographical kind for that; calling a start "worked on"
 * would be the timeline claiming more than its source.
 */
export const CHANGE_KINDS: readonly AutobiographicalEvent["kind"][] = [
  "completed_action", "recurring_completion", "action_created", "action_cancelled",
  "action_deferred", "action_returned", "action_restored", "action_rescheduled",
  "action_due_cleared", "action_planned", "waiting_started", "waiting_stopped",
  "prerequisite_removed",
];

/** Neutral, past-tense wording for a change line. Never a verdict (§13, §19). */
export const CHANGE_LABEL: Record<string, string> = {
  completed_action: "Completed",
  recurring_completion: "Done for the day",
  action_created: "Added",
  action_cancelled: "Cancelled",
  action_deferred: "Deferred",
  action_returned: "Came back from a deferral",
  action_restored: "Restored",
  action_rescheduled: "Date changed",
  action_due_cleared: "Date removed",
  action_planned: "Planned",
  waiting_started: "Started waiting",
  waiting_stopped: "Stopped waiting",
  prerequisite_removed: "Prerequisite removed",
};

/**
 * The limitation that must travel with any "what changed" claim (§11).
 *
 * `removeActionDependency` writes an `unblocked` history event for EVERY edge
 * removal, whether or not other blockers remain, and the commonest route to
 * being unblocked — the blocker being completed — writes nothing on the
 * dependent at all. So the product can say a prerequisite link was removed and
 * cannot say when something became unblocked. Stating that is the honest move;
 * inferring the transition from present state is not.
 */
export const UNBLOCK_LIMITATION =
  "Conqify records when a prerequisite link is removed, but not when an item became unblocked because its blocker was completed — so “unblocked today” is not something it can tell you.";

function timeOf(a: NextAction): string | undefined {
  const t = (a as { dueTime?: string }).dueTime;
  return t && /^\d{2}:\d{2}$/.test(t) ? t : undefined;
}

/**
 * Everything the day needs, from indexes the page already built (§26).
 *
 * `ix` carries the dependency maps, occurrences and completions; `ix.activity`
 * carries the flattened history. Neither is rebuilt here, so adding this view
 * to Today costs one grouping pass rather than a second scan of the store.
 */
export function buildDailyExecutiveView(
  state: StoreState,
  ix: TodayIndexes,
  today: DayKey = todayKey(),
): DailyExecutiveView {
  const actions = state.nextActions ?? [];
  const live = actions.filter((a) => isLive(a) && !isDeferredAhead(a, today));

  // ---- FIXED: things that happen at a time (§3, §7) -----------------------
  const fixedToday: FixedItem[] = [];
  for (const o of ix.occurrences) {
    fixedToday.push({
      kind: "event", id: o.event.id, title: o.event.title,
      time: o.allDay ? undefined : o.startTime,
      detail: o.allDay || !o.startTime ? "All day" : undefined,
      event: o,
    });
  }
  // An action is fixed ONLY when it carries an explicit time. A bare due date
  // is a day's worth of latitude, and calling it fixed would be the product
  // inventing an appointment the user never made.
  //
  // A RECURRENCE RULE names the day just as a due date does — the rule
  // LIFEOS-063 R-2 established and 0043 taught the database. "Take the
  // medication every day at 8" is a commitment at 08:00, and it was landing in
  // `flexibleToday` as "yours to place", dropping the time the user had
  // explicitly given (LIFEOS-074 §3). Whether the day is named by a date or by a
  // rule, a time on it is a time.
  for (const a of live) {
    const t = timeOf(a);
    if (!t) continue;
    const namedToday = readRule(a.recurrence)
      ? occurrenceFor(a, today, ix.completions) === today
      : dueKeyOf(a) === today;
    if (!namedToday) continue;
    fixedToday.push({ kind: "action", id: a.id, title: a.title, time: t, action: a });
  }
  fixedToday.sort((x, y) => (x.time ?? "").localeCompare(y.time ?? ""));

  // ---- FLEXIBLE: work the user places (§3) --------------------------------
  const flexible: FlexibleItem[] = [];
  const seenFlexible = new Set<string>();
  const pushFlexible = (a: NextAction, reason: FlexibleItem["reason"], detail: string) => {
    if (seenFlexible.has(a.id)) return;
    seenFlexible.add(a.id);
    flexible.push({ action: a, reason, detail });
  };
  for (const a of sortByDue(live.filter((a) => dueKeyOf(a) === today && !timeOf(a) && !readRule(a.recurrence)), today)) {
    pushFlexible(a, "due_today", "Due today");
  }
  for (const a of live) {
    const rule = readRule(a.recurrence);
    if (!rule) continue;
    if (occurrenceFor(a, today, ix.completions) !== today) continue;
    // …unless it named a time, in which case it is already fixed above and
    // listing it here would show one commitment twice, in two different senses.
    if (timeOf(a)) continue;
    pushFlexible(a, "recurring_today", describeRule(rule));
  }
  for (const a of live) {
    if (!ix.plannedTodayIds.has(a.id)) continue;
    if (ix.blockedActionIds.has(a.id) || a.status === "waiting") continue;
    pushFlexible(a, "planned_today", "Planned for today");
  }
  for (const a of live) {
    if (a.status !== "in_progress") continue;
    pushFlexible(a, "in_progress", "In progress");
  }

  // ---- ATTENTION and NEXT: the existing engines, unchanged (§2) -----------
  const attention = buildCommitmentSignals(state, ix, { today });
  const nextAction = recommendNextAction(state, ix, today);

  // ---- the day as autobiographical evidence (§5, §6, §12) ----------------
  const review = buildRangeReview(state, resolveRange("today", { today }), { today, index: ix.activity });
  const completedToday = review.timeline.filter((e) => (COMPLETION_KINDS as string[]).includes(e.kind));
  // §7. The same rule the `added` grouping applies, applied here too: a record
  // created AND finished today is one thing the user did. Filtering the review's
  // `added` list alone missed this, because `changedToday` reads the raw
  // timeline — so the first real run still printed "Added: Email the agent"
  // directly above "Completed: Email the agent".
  const finishedToday = new Set(completedToday.map((e) => `${e.recordRef.id}:${e.day}`));
  const changedToday = review.timeline.filter((e) => {
    if (!(CHANGE_KINDS as string[]).includes(e.kind)) return false;
    if (e.kind === "action_created" && finishedToday.has(`${e.recordRef.id}:${e.day}`)) return false;
    return true;
  });

  // ---- TOMORROW: dated evidence only (§15) -------------------------------
  //
  // Events tomorrow, actions DUE tomorrow, occurrences falling tomorrow. No
  // undated open work, no carry-forward, and a future deferral appears only if
  // its own return date is actually tomorrow — the record's semantics decide,
  // never a wish to fill the section.
  const tomorrowKey = addDays(today, 1);
  const tomorrow: TomorrowItem[] = [];
  for (const o of upcomingOccurrences(state, tomorrowKey, 0)) {
    tomorrow.push({
      kind: "event", id: o.event.id, title: o.event.title,
      time: o.allDay ? undefined : o.startTime,
      detail: o.allDay || !o.startTime ? "All day" : undefined,
    });
  }
  for (const a of actions) {
    if (!isLive(a)) continue;
    const rule = readRule(a.recurrence);
    if (rule) {
      if (occurrenceFor(a, tomorrowKey, ix.completions) === tomorrowKey) {
        tomorrow.push({ kind: "recurring", id: a.id, title: a.title, detail: describeRule(rule) });
      }
      continue;
    }
    // A deferral returning tomorrow is dated evidence; one parked further out
    // is not, and neither is undated open work.
    if (a.status === "deferred") {
      if (a.deferredUntil === tomorrowKey) {
        tomorrow.push({ kind: "action", id: a.id, title: a.title, detail: "Comes back tomorrow" });
      }
      continue;
    }
    if (dueKeyOf(a) === tomorrowKey) {
      tomorrow.push({ kind: "action", id: a.id, title: a.title, time: timeOf(a), detail: `Due ${formatDayKey(tomorrowKey)}` });
    }
  }
  // "99:99" sorts untimed items last. `localeCompare` against a punctuation
  // sentinel does NOT — it put every untimed row above an 11:00 appointment on
  // the first real run, because locale collation ranks punctuation below digits.
  tomorrow.sort((x, y) =>
    (x.time ?? "99:99").localeCompare(y.time ?? "99:99") || x.title.localeCompare(y.title));

  // ---- STILL OPEN, for a DAY (§19, §22) ----------------------------------
  //
  // The shared grouping's window is deliberately generous — a week review
  // wants the next seven days. For one day that pulls in two rows the closure
  // already shows elsewhere: a wait (its own section) and something due
  // tomorrow (the tomorrow preview). Repeating them adds no fact, so the daily
  // view narrows to what is genuinely open in TODAY's context. Nothing is
  // hidden — both records are still on the page, once each.
  const tomorrowIds = new Set(tomorrow.map((t) => t.id));
  const stillOpen = review.stillOpen.filter(
    (o) => o.reason !== "waiting" && !tomorrowIds.has(o.action.id),
  );

  const limitations = [...review.limitations];
  if (changedToday.some((e) => e.kind === "prerequisite_removed")) limitations.push(UNBLOCK_LIMITATION);

  return {
    date: today,
    fixedToday,
    flexibleToday: flexible,
    attention,
    nextAction,
    waiting: review.waiting,
    completedToday,
    changedToday,
    stillOpen,
    tomorrow,
    reflections: review.reflections,
    summary: review.summary,
    coverage: DAILY_COVERAGE,
    limitations,
    empty: review.timeline.length === 0 && attention.length === 0
      && fixedToday.length === 0 && flexible.length === 0,
    review,
  };
}

/**
 * The compact orientation line (§6).
 *
 * Counts of records, assembled from the clauses that have a non-zero count. A
 * line that lists what did NOT happen is an appraisal wearing a count's
 * clothes, so zero-count clauses are simply absent.
 */
export function orientationLine(v: DailyExecutiveView): string {
  const parts: string[] = [];
  const events = v.fixedToday.filter((f) => f.kind === "event").length;
  if (events) parts.push(`${events} event${events === 1 ? "" : "s"}`);
  const timed = v.fixedToday.filter((f) => f.kind === "action").length;
  if (timed) parts.push(`${timed} timed commitment${timed === 1 ? "" : "s"}`);
  if (v.flexibleToday.length) parts.push(`${v.flexibleToday.length} to fit in`);
  if (v.attention.length) parts.push(`${v.attention.length} item${v.attention.length === 1 ? "" : "s"} needing attention`);
  if (parts.length === 0) return "Nothing dated for today stands out from what Conqify has recorded.";
  return parts.join(" · ");
}

/** Every string the day produces, for the language guards to sweep. */
export function dailyStrings(v: DailyExecutiveView): string[] {
  return [
    orientationLine(v), v.summary, v.coverage, ...v.limitations,
    ...v.fixedToday.map((f) => `${f.title} ${f.detail ?? ""}`),
    ...v.flexibleToday.map((f) => `${f.action.title} ${f.detail}`),
    ...v.attention.map((s) => `${s.title} ${s.explanation}`),
    ...v.stillOpen.map((o) => `${o.action.title} ${o.detail}`),
    ...v.tomorrow.map((t) => `${t.title} ${t.detail ?? ""}`),
    ...v.changedToday.map((e) => `${CHANGE_LABEL[e.kind] ?? e.kind} ${e.title}`),
  ];
}
