/**
 * The evening close — one day, derived (LIFEOS-091).
 *
 * ## Why this exists when `/today/review` already did
 *
 * The audit found the day running behind the week. LIFEOS-084 shipped
 * `movedForward`, `changedDirection`, `waitingEnded`, a three-item unresolved
 * cap, `carryForward`, a structurally separate `scheduledNext`, per-goal
 * completed counts and a calm arithmetic line — all for the WEEK. The evening
 * surface had none of it, and printed six of the twelve changes LIFEOS-081 can
 * prove for the same day, because LIFEOS-073's `CHANGE_KINDS` is the
 * autobiographical-timeline vocabulary and that vocabulary has no goal or rule
 * kinds. A horizon moving `medium → long` and a standard being adopted were
 * both invisible at the end of the day they happened on.
 *
 * So this is a composition, not an engine. Every fact below comes from a
 * builder that already existed:
 *
 *   buildExecutiveChanges     LIFEOS-081 — what can be proven, with evidence
 *   repeatedlyPostponed       LIFEOS-081 — recurring-safe, counted, neutral
 *   buildAttentionShortlist   LIFEOS-082 — what is unresolved, ranked once
 *   buildCarryForward         LIFEOS-084 — unresolved work that stays valid
 *   buildDailyExecutiveView   LIFEOS-073 — the day's dated evidence
 *   resolutionsForAction      LIFEOS-071/090 — every offered mutation
 *
 * ## What it refuses to do
 *
 *   no persistence      a review is a projection; nothing is written (§4)
 *   no schema           every fact was already recorded (§37)
 *   no score            counts only, never an evaluation (§23, §36)
 *   no narrative        facts are summarized; prose is never generated (§22)
 *   no silent carry     the review proposes, the user decides (§16)
 *
 * ## The three corrections it makes to what it composes
 *
 * 1. A completion is removed from `changed`. `COMPLETION_KINDS` and
 *    `CHANGE_KINDS` overlap, so the old surface printed "Send application"
 *    under Done and again under Changed, directly below itself.
 *
 * 2. Carry-forward subtracts what tomorrow already holds. LIFEOS-084's version
 *    is right for a week — work due next Tuesday IS unresolved work to carry
 *    into next week — and wrong for a day: work due tomorrow is not a candidate
 *    for carrying into tomorrow, it is already there. Offering it is the merge
 *    §14 forbids, and §16 settles which side it falls on.
 *
 * 3. The repeated-deferral count needs two windows at once — "deferred again
 *    today" is the day, "3 recorded deferrals" is the record's whole life —
 *    and neither window alone can say the sentence.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { NextAction, RecordRefLite, StoreState, Goal } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { AutobiographicalEvent } from "@/lib/memory/week";
import { todayKey, addDays, formatDayKey } from "@/lib/reviews/dates";
import { resolveRange } from "@/lib/insights/range";
import {
  buildExecutiveChanges, repeatedlyPostponed,
  MOVED_FORWARD_KINDS, DIRECTION_KINDS,
  type ExecutiveChange, type PostponedItem,
} from "@/lib/memory/changes";
import {
  buildAttentionShortlist, ATTENTION_MAX_LIMIT,
  type ExecutiveAttentionItem,
} from "@/lib/guidance/attention";
import {
  buildCarryForward, MAX_UNRESOLVED, MAX_REFLECTIONS, CARRY_FORWARD_DEFAULT,
  type CarryForwardItem,
} from "@/lib/memory/weekly";
import { buildDailyExecutiveView, type TomorrowItem } from "@/lib/today/daily";
import { isMachineProduced } from "@/lib/provenance";
import { isLive } from "@/lib/actions/due";

// ------------------------------------------------------------- the model ---

/** A goal that had completed linked work today. Counts only — never a score. */
export interface GoalMovement {
  goal: Goal;
  /** Completed work linked to this goal or one of its projects, today. */
  completed: number;
  /** The completions themselves, so a UI can name them. */
  changes: ExecutiveChange[];
}

/** A deferral made today, carrying the record's whole-life count (§10). */
export interface DeferredToday {
  change: ExecutiveChange;
  action?: NextAction;
  /** Every recorded deferral on this record, not just today's. */
  totalDeferrals: number;
  /** True once the total supports the word "again" (§10). */
  repeated: boolean;
}

/**
 * A carry-forward candidate, and whether Still open already explained it (§41).
 *
 * The two sections answer different questions — §3.7 "what remains open
 * tonight?" and §3.8 "what should consciously carry into tomorrow?" — so a
 * commitment can honestly appear in both. What must not appear twice is the
 * REASON: the first run printed "Was due Sun, Sep 6." under Still open and then
 * "Was due Sun, Sep 6." again four lines lower. The row stays; the sentence
 * does not repeat.
 */
export interface CarryCandidate {
  item: CarryForwardItem;
  /** True when the item is also on the Still-open list above. */
  echoesStillOpen: boolean;
}

/** A wait as it stands tonight (§12). */
export interface WaitingLine {
  action: NextAction;
  waitingOn?: string;
  followUpDate?: DayKey;
  followUpDue: boolean;
}

export interface EveningClose {
  /** The day being closed. Not necessarily today (§26). */
  date: DayKey;
  /** True when `date` is the current local day. */
  isToday: boolean;

  // ---- 1. DONE (§6) ------------------------------------------------------
  /** Factual completions only. Never created, edited or rescheduled. */
  completed: AutobiographicalEvent[];
  /** Waits that ENDED today. §6 files these under done, not under changed. */
  waitingResolved: ExecutiveChange[];
  /** §7, §28. Completed linked work, aggregated per goal. Nothing else. */
  movedForward: GoalMovement[];

  // ---- 2. CHANGED (§8) ---------------------------------------------------
  /** Recorded transitions, with the completions removed (§40, RED 1). */
  changed: ExecutiveChange[];
  /** §9. Kept apart from `rescheduled`, in both directions. */
  deferred: DeferredToday[];
  /** §9. A neutral date change. Never counted as a deferral. */
  rescheduled: ExecutiveChange[];
  /** §8. Goal and rule transitions — direction, never progress. */
  changedDirection: ExecutiveChange[];

  // ---- 3. STILL OPEN (§11, §12, §13) -------------------------------------
  /** The attention shortlist, capped. Not the backlog. */
  stillOpen: ExecutiveAttentionItem[];
  /** Open waits tonight. Separate from the ones that resolved (§12). */
  waitingOpen: WaitingLine[];

  // ---- 4. IN YOUR OWN WORDS (§19) ----------------------------------------
  /** User-authored only, capped at three. Machine prose can never appear. */
  reflections: ExecutiveChange[];

  // ---- 5. TOMORROW (§14, §15) --------------------------------------------
  /** Already has a place. Dated evidence only. */
  tomorrowScheduled: TomorrowItem[];
  /** A proposal, never a plan — and never something already scheduled. */
  carryForward: CarryCandidate[];

  /** §23. Counts, in a day's words. Empty string on a day with no counts. */
  calmSummary: string;
  /** True when the day recorded nothing at all (§24). */
  quiet: boolean;
}

// ------------------------------------------------------------- constants ---

/**
 * Neutral past-tense wording for an `ExecutiveChangeKind` (§8, §22).
 *
 * LIFEOS-073's `CHANGE_LABEL` is keyed by AUTOBIOGRAPHICAL kinds
 * (`action_cancelled`), and 081's changes carry `ExecutiveChangeKind`
 * (`cancelled`). Reusing the first for the second silently fell through to the
 * raw key, and the browser run printed "Apply to the fifth school cancelled" —
 * a database enum shown to a person. Two vocabularies, one lookup.
 */
export const EVENING_CHANGE_LABEL: Record<string, string> = {
  created: "Added",
  completed: "Completed",
  recurring_completed: "Done for the day",
  cancelled: "Cancelled",
  deferred: "Deferred",
  returned: "Came back from a deferral",
  restored: "Restored",
  rescheduled: "Date changed",
  due_cleared: "Date removed",
  planned: "Planned",
  prerequisite_removed: "Prerequisite removed",
  waiting_started: "Started waiting",
  waiting_ended: "Stopped waiting",
  goal_created: "Goal added",
  goal_status_changed: "Goal status changed",
  goal_horizon_changed: "Goal horizon changed",
  goal_target_changed: "Goal target date changed",
  goal_replaced: "Goal replaced",
  rule_adopted: "Standard adopted",
  rule_revised: "Standard revised",
  rule_retired: "Standard retired",
  reflection_added: "Reflection added",
  note_added: "Note added",
  capture_added: "Captured",
  decision_recorded: "Decision recorded",
  event_scheduled: "Scheduled",
};

/** §24. A quiet day is a fact about records, never a shortfall. */
export const QUIET_DAY =
  "No completed or changed commitments were recorded today.";

/** §20. Optional, and phrased as an invitation rather than an assignment. */
export const MEMORY_PROMPT = "Anything about today worth remembering?";

/** §20. What the optional prompt is NOT. Shown so the ask reads as optional. */
export const MEMORY_PROMPT_HINT = "One sentence, or nothing at all.";

/** §14. The two tomorrow concepts, named so they cannot be merged in the UI. */
export const TOMORROW_SCHEDULED_HEADING = "Tomorrow already has";
export const CARRY_FORWARD_HEADING = "Possible carry-forward";

/** §16. The review proposes; nothing moves until the user says so. */
export const CARRY_FORWARD_NOTE = "Nothing moves until you choose it.";

/**
 * Words this surface may never use about someone's own day (§22, §23, §36).
 *
 * Swept over every string the model can produce. The list is the evaluation
 * vocabulary — a review that scores a day is not a review, and a review that
 * narrates one is writing the user's diary for them.
 */
export const EVENING_FORBIDDEN_WORDS: readonly string[] = [
  "great job", "well done", "productive day", "challenging but",
  "you struggled", "you seem", "falling behind", "unproductive",
  "score", "grade", "streak", "% complete", "productivity",
  "you should have", "only managed", "failed to",
];

// --------------------------------------------------------------- helpers ---

/** The goal a change belongs to, directly or through its project (§7). */
function goalIdFor(state: StoreState, change: ExecutiveChange): string | undefined {
  if (change.entity.kind === "goal") return change.entity.id;
  const a = (state.nextActions ?? []).find((x) => x.id === change.entity.id);
  if (!a) return undefined;
  if (a.goalId) return a.goalId;
  const p = (state.projects ?? []).find((x) => x.id === a.projectId);
  return p?.goalId;
}

/**
 * A count sentence, or nothing (§23).
 *
 * Zero-count clauses are absent rather than printed as zeroes: a line that
 * lists what did not happen is an appraisal wearing arithmetic's clothes.
 */
export function calmSummaryLine(c: {
  completed: number; deferred: number; rescheduled: number;
  changed: number; stillOpen: number; waitingOpen: number;
}): string {
  const parts: string[] = [];
  const push = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  push(c.completed, "completed", "completed");
  push(c.deferred, "deferred", "deferred");
  push(c.rescheduled, "rescheduled", "rescheduled");
  push(c.changed, "other change", "other changes");
  push(c.stillOpen, "still open", "still open");
  push(c.waitingOpen, "waiting", "waiting");
  return parts.join(" · ");
}

/**
 * The factual repeated-deferral sentence (§10).
 *
 * Two windows, because neither alone can say it: today proves "again", the
 * record's whole life proves the count. Never a warning, never a wall — one
 * sentence attached inline to the row it is about.
 */
export function deferralLine(d: DeferredToday): string {
  return d.repeated
    ? `Deferred again today — ${d.totalDeferrals} recorded deferrals.`
    : "Deferred today.";
}

// ------------------------------------------------------------ the builder --

export interface EveningCloseOptions {
  /** The day to close. Defaults to today; §26's previous-day support. */
  date?: DayKey;
  /** The current local day, for `isToday`. Injected for determinism. */
  today?: DayKey;
  /** Fixed offset east of UTC, for deterministic day bounds (§25). */
  offsetMinutes?: number;
}

/**
 * One day, closed from what was recorded (§4).
 *
 * `resolveRange("custom", { customStart: date, customEnd: date })` is the
 * existing local-day implementation, reused rather than reimplemented (§25).
 * Passing a `date` other than today is all §26 needs: the same builders, a
 * different day, and no "previous 24 hours" window anywhere.
 */
export function buildEveningClose(
  state: StoreState,
  ix: TodayIndexes,
  opts: EveningCloseOptions = {},
): EveningClose {
  const today = opts.today ?? todayKey();
  const date = opts.date ?? today;
  const isToday = date === today;

  const day = resolveRange("custom", {
    customStart: date, customEnd: date, offsetMinutes: opts.offsetMinutes,
  });
  const changes = buildExecutiveChanges(state, day);

  // ---- 1. DONE ------------------------------------------------------------
  const daily = buildDailyExecutiveView(state, ix, date);
  const completed = daily.completedToday;
  const waitingResolved = changes.filter((c) => c.kind === "waiting_ended");

  // §7. A completion is "forward" only when it is linked to a goal. The link is
  // what makes it movement rather than merely done — and `MOVED_FORWARD_KINDS`
  // holds completions only, so a horizon edit can never enter here.
  const forwardChanges = changes.filter((c) =>
    (MOVED_FORWARD_KINDS as string[]).includes(c.kind) && !!goalIdFor(state, c));
  const byGoal = new Map<string, ExecutiveChange[]>();
  for (const c of forwardChanges) {
    const gid = goalIdFor(state, c);
    if (!gid) continue;
    byGoal.set(gid, [...(byGoal.get(gid) ?? []), c]);
  }
  const movedForward: GoalMovement[] = [];
  for (const [gid, list] of byGoal) {
    const goal = (state.goals ?? []).find((g) => g.id === gid);
    if (!goal) continue;
    movedForward.push({ goal, completed: list.length, changes: list });
  }
  movedForward.sort((a, b) => b.completed - a.completed || a.goal.title.localeCompare(b.goal.title));

  // ---- 2. CHANGED ---------------------------------------------------------
  //
  // RED 1. A completion is already the whole of DONE. Printing it again here,
  // two inches lower, under the word "Completed", is one fact rendered as two.
  const completedIds = new Set(completed.map((e) => `${e.recordRef.id}`));
  const isDirection = (k: ExecutiveChange["kind"]) =>
    (DIRECTION_KINDS as string[]).includes(k)
    || k === "rule_adopted" || k === "rule_revised" || k === "rule_retired";
  const changed = changes.filter((c) => {
    if ((MOVED_FORWARD_KINDS as string[]).includes(c.kind) && completedIds.has(c.entity.id)) return false;
    // A resolved wait leads DONE (§6); it is not also a change.
    if (c.kind === "waiting_ended") return false;
    // Deferrals and reschedules get their own typed lists below, so leaving
    // them here too would be the same duplication under a different name.
    if (c.kind === "deferred" || c.kind === "rescheduled") return false;
    // The user's own words are §19's section, not a change.
    if (c.kind === "reflection_added" || c.kind === "note_added") return false;
    // …and neither is a direction change, which has its own list. The first
    // run of this builder printed the horizon change, the achieved goal and the
    // adopted rule in BOTH — RED 1's disease, reintroduced one function later,
    // and double-counted in the calm line as "7 other changes" when there were
    // four. Every kind belongs to exactly one list.
    if (isDirection(c.kind)) return false;
    return true;
  });

  // §9, §10. Deferrals today, each carrying its own whole-life count.
  //
  // The wide window starts at the record's own beginning rather than at some
  // arbitrary lookback: a deferral from two months ago is still a deferral, and
  // choosing a cutoff would make the count depend on when you asked.
  const wide = resolveRange("custom", {
    customStart: "1970-01-01", customEnd: date, offsetMinutes: opts.offsetMinutes,
  });
  const allPostponed = repeatedlyPostponed(state, wide, 1);
  const countFor = new Map<string, PostponedItem>(allPostponed.map((p) => [p.action.id, p]));
  const deferred: DeferredToday[] = changes
    .filter((c) => c.kind === "deferred")
    .map((c) => {
      const action = (state.nextActions ?? []).find((a) => a.id === c.entity.id);
      const total = countFor.get(c.entity.id)?.count ?? 1;
      return { change: c, action, totalDeferrals: total, repeated: total > 1 };
    });

  const rescheduled = changes.filter((c) => c.kind === "rescheduled");

  const changedDirection = changes.filter((c) => isDirection(c.kind));

  // ---- 3. STILL OPEN ------------------------------------------------------
  //
  // §11. The shortlist, capped. Not the backlog: the dense-day fixture put 45
  // items through the attention layer and 8 through the old still-open list.
  const shortlist = buildAttentionShortlist(state, ix, date, { limit: ATTENTION_MAX_LIMIT });
  const stillOpen = shortlist.slice(0, MAX_UNRESOLVED);

  // §12. Open tonight, and structurally apart from the ones that resolved.
  const waitingOpen: WaitingLine[] = (state.nextActions ?? [])
    .filter((a) => a.status === "waiting" && isLive(a))
    .map((a) => ({
      action: a,
      waitingOn: a.waitingOn,
      followUpDate: a.followUpDate,
      followUpDue: !!a.followUpDate && a.followUpDate <= date,
    }))
    .sort((x, y) => Number(y.followUpDue) - Number(x.followUpDue)
      || x.action.title.localeCompare(y.action.title));

  // ---- 4. IN YOUR OWN WORDS ----------------------------------------------
  //
  // §19. `isMachineProduced` over `classifyOrigin` is the same predicate Memory
  // uses to keep "you said" honest. An AI note carries its attribution in its
  // own text, so the filter survives export, re-import and sync.
  const reflections = changes
    .filter((c) => c.kind === "reflection_added" || c.kind === "note_added")
    .filter((c) => !isMachineProduced(c.origin))
    .slice(-MAX_REFLECTIONS);

  // ---- 5. TOMORROW --------------------------------------------------------
  //
  // §14. Dated evidence — events, work due, occurrences, and a deferral whose
  // own return date is tomorrow. LIFEOS-073 already derives exactly this.
  const tomorrowScheduled = daily.tomorrow;

  // §15, §16. And the candidates, MINUS everything tomorrow already holds.
  // The weekly builder is right for a week and wrong for a day: it proposed
  // carrying "Submit the second application", which is due tomorrow — already
  // there, and offering it is the merge §14 forbids.
  const scheduledIds = new Set(tomorrowScheduled.map((t) => t.id));
  const tomorrowKey = addDays(date, 1);
  const actionById = new Map((state.nextActions ?? []).map((a) => [a.id, a]));
  const carryItems = buildCarryForward(state, shortlist, allPostponed, date, ATTENTION_MAX_LIMIT)
    // Already has a place tomorrow. Offering to move it there is offering to do
    // what is already done, and §14 forbids merging the two lists.
    .filter((c) => !scheduledIds.has(c.entity.id))
    // §15, verbatim: "Do not include future work already scheduled later than
    // tomorrow." The first run proposed carrying the dentist appointment — the
    // one the user had DELIBERATELY moved to Friday that same afternoon. A
    // review that asks you to undo the decision you just made is not helping
    // you replan; it is arguing with you. Work dated beyond tomorrow is
    // scheduled, not unresolved.
    .filter((c) => {
      const a = actionById.get(c.entity.id);
      return !(a?.dueDate && a.dueDate > tomorrowKey);
    })
    // Only work can be carried into a day. LIFEOS-084's `goal_gap` reason — "no
    // active project is linked to this goal" — is a sensible thing to raise
    // about a WEEK and meaningless as "bring this into tomorrow": a goal is not
    // a commitment with a date. The browser found this the loud way: pressing
    // Carry on the goal candidate changed nothing in the store and still
    // announced "Open the clinic — back tomorrow", which is the product
    // claiming a mutation it never made.
    .filter((c) => c.entity.kind === "action" && actionById.has(c.entity.id))
    .slice(0, CARRY_FORWARD_DEFAULT);

  const stillOpenIds = new Set(stillOpen.map((a) => a.entity.id));
  const carryForward: CarryCandidate[] = carryItems.map((item) => ({
    item, echoesStillOpen: stillOpenIds.has(item.entity.id),
  }));

  // ---- the calm line ------------------------------------------------------
  const calmSummary = calmSummaryLine({
    completed: completed.length + waitingResolved.length,
    deferred: deferred.length,
    rescheduled: rescheduled.length,
    changed: changed.length + changedDirection.length,
    stillOpen: stillOpen.length,
    waitingOpen: waitingOpen.length,
  });

  const quiet = completed.length === 0 && waitingResolved.length === 0
    && changed.length === 0 && changedDirection.length === 0
    && deferred.length === 0 && rescheduled.length === 0
    && reflections.length === 0;

  return {
    date, isToday,
    completed, waitingResolved, movedForward,
    changed, deferred, rescheduled, changedDirection,
    stillOpen, waitingOpen,
    reflections,
    tomorrowScheduled, carryForward,
    calmSummary, quiet,
  };
}

/**
 * The movement sentence for one goal (§28).
 *
 * "2 linked actions completed" — a count of records, with no momentum, no
 * percentage and no verdict about the goal's health.
 */
export function movementLine(m: GoalMovement): string {
  return `${m.completed} linked action${m.completed === 1 ? "" : "s"} completed`;
}

/** The day's heading. A date, never a judgement about the day (§22, §24). */
export function eveningHeading(c: EveningClose): string {
  return c.isToday ? "Today" : formatDayKey(c.date, { weekday: "long", month: "short", day: "numeric" });
}

/** Yesterday, for the previous-day control (§26). */
export function previousDay(date: DayKey): DayKey {
  return addDays(date, -1);
}

/** Every string the close can produce, for the language guards to sweep. */
export function eveningStrings(c: EveningClose): string[] {
  return [
    c.calmSummary, QUIET_DAY, MEMORY_PROMPT, MEMORY_PROMPT_HINT,
    CARRY_FORWARD_NOTE, TOMORROW_SCHEDULED_HEADING, CARRY_FORWARD_HEADING,
    eveningHeading(c),
    ...c.completed.map((e) => e.title),
    ...c.waitingResolved.map((e) => `${e.title} ${e.detail ?? ""}`),
    ...c.movedForward.map((m) => `${m.goal.title} ${movementLine(m)}`),
    ...c.changed.map((e) => `${e.title} ${e.from ?? ""} ${e.to ?? ""}`),
    ...c.deferred.map((d) => `${d.change.title} ${deferralLine(d)}`),
    ...c.rescheduled.map((e) => `${e.title} ${e.detail ?? ""}`),
    ...c.changedDirection.map((e) => `${e.title} ${e.from ?? ""} ${e.to ?? ""}`),
    ...c.stillOpen.map((a) => `${a.title} ${a.explanation}`),
    ...c.waitingOpen.map((w) => `${w.action.title} ${w.waitingOn ?? ""}`),
    ...c.tomorrowScheduled.map((t) => `${t.title} ${t.detail ?? ""}`),
    ...c.carryForward.map((f) => `${f.item.title} ${f.echoesStillOpen ? "" : f.item.explanation}`),
  ];
}

/** A record ref for a carry-forward candidate, so a UI can key and link it. */
export function carryRef(c: CarryCandidate): RecordRefLite {
  return c.item.entity;
}
