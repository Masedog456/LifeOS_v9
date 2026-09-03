/**
 * The weekly executive review — one week, composed (LIFEOS-084 §4).
 *
 * ## What this is NOT
 *
 * Not a second week review. `buildWeekReview` already resolves the week,
 * groups the timeline and states its own limitations, and all of that is kept.
 * This adds the four things the audit found missing from the weekly surface,
 * every one of them already computed somewhere else:
 *
 *   moved forward       completed work under a goal        081 + 078
 *   changed direction   goal and rule transitions          081
 *   repeated deferral   recurring-safe, counted            081
 *   unresolved          the attention shortlist            082
 *
 * …plus the one genuinely new synthesis: **carry forward**.
 *
 * ## Historical vs current (§2.H of the audit)
 *
 * The line this file holds:
 *
 *   HISTORICAL  what finished, changed, was deferred, stopped waiting — bounded
 *               by the range, from `buildExecutiveChanges`
 *   CURRENT     what is still waiting, still open, still unresolved — from
 *               present state, because "is this still true on Monday?" is a
 *               question about now
 *
 * Mixing them is how a review claims a resolved thing is still open.
 *
 * ## The review proposes; it never plans (§25, §26)
 *
 * `carryForward` is a list of records with reasons. Nothing in this file writes
 * a date, moves a plan, or touches the store — it is a pure function, and the
 * only way an item reaches next week is a person pressing something.
 *
 * ## No score (§5, §13, §14)
 *
 * There is no momentum, no goal health, no alignment percentage and no
 * ordering by invented importance. Every ordering here is lexicographic over a
 * stated precedence, and every sentence is a count or a recorded transition.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { Goal, NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { ResolvedRange } from "@/lib/insights/range";
import { todayKey } from "@/lib/reviews/dates";
import {
  buildWeekReview, type WeekRangeKind, type WeekReview,
} from "@/lib/memory/week";
import {
  buildExecutiveChanges, repeatedlyPostponed, postponedLine,
  MOVED_FORWARD_KINDS, DIRECTION_KINDS,
  type ExecutiveChange, type PostponedItem,
} from "@/lib/memory/changes";
import {
  buildAttentionShortlist, ATTENTION_MAX_LIMIT, ATTENTION_ORDER,
  type AttentionKind, type ExecutiveAttentionItem,
} from "@/lib/guidance/attention";
import { isMachineProduced } from "@/lib/provenance";
import { isLive } from "@/lib/actions/due";
import { readRule } from "@/lib/time/recurrence";

// ------------------------------------------------------------------ caps ---

/** §12. Enough to recognise the week, not a transcript of it. */
export const MAX_REFLECTIONS = 3;
/** §10. The review is not a backlog dump. */
export const MAX_UNRESOLVED = 3;
/** §16. Default; the maximum is `ATTENTION_MAX_LIMIT`. */
export const CARRY_FORWARD_DEFAULT = 3;
/** §22. Next week's real commitments, kept short. */
export const MAX_SCHEDULED = 5;

// --------------------------------------------------------- carry forward ---

/** Why an item is being offered for next week. */
export type CarryReason =
  | "dated"             // an unresolved commitment with a date that has passed
  | "returned"          // a deferral elapsed and it came back
  | "repeated_deferral" // deferred more than once, recurring work excluded
  | "goal_gap"          // an active goal with no active project
  | "waiting_follow_up"; // a follow-up date that has arrived

/**
 * Which attention signals each reason is made of.
 *
 * This is a mapping, NOT a precedence. The precedence is derived below.
 */
export const CARRY_REASON_SOURCES: Record<CarryReason, readonly AttentionKind[]> = {
  dated: ["overdue", "due_soon", "recurring_due"],
  returned: ["returned_today"],
  repeated_deferral: ["repeated_deferral"],
  goal_gap: ["goal_path_missing"],
  waiting_follow_up: ["follow_up_due"],
};

/**
 * §17's deterministic precedence, **derived from `ATTENTION_ORDER`** rather
 * than restated.
 *
 * Writing this list by hand is how two surfaces come to disagree: the first
 * draft of this file ranked `goal_gap` above `waiting_follow_up`, so the review
 * offered a goal with no project ahead of a follow-up date that had already
 * arrived — while the attention shortlist, computed from the same state one
 * function away, ranked them the other way round. That is LIFEOS-082 §8's
 * prohibition exactly ("do not let a vague long-term signal outrank a concrete
 * deadline"), reintroduced by duplication.
 *
 * A reason ranks at its earliest constituent signal, so changing
 * `ATTENTION_ORDER` moves this too, and there is only ever one precedence in
 * the codebase.
 */
export const CARRY_ORDER: readonly CarryReason[] = (
  Object.keys(CARRY_REASON_SOURCES) as CarryReason[]
).sort((a, b) => carryRankOf(a) - carryRankOf(b));

function carryRankOf(reason: CarryReason): number {
  return Math.min(...CARRY_REASON_SOURCES[reason].map((k) => {
    const i = ATTENTION_ORDER.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }));
}

const CARRY_RANK = new Map<CarryReason, number>(
  (Object.keys(CARRY_REASON_SOURCES) as CarryReason[]).map((r) => [r, carryRankOf(r)]));

/**
 * The reason a signal is carried, or `null` when it is not a carry-forward
 * signal at all.
 *
 * Read off `CARRY_REASON_SOURCES` rather than written out a second time, so a
 * signal cannot be carried under one reason and ranked under another. Signals
 * with no entry — `blocked`, `project_no_next_action` — are deliberately not
 * carried: blocked work is waiting on its blocker, not on next week.
 */
export function carryReasonFor(kind: AttentionKind): CarryReason | null {
  for (const r of Object.keys(CARRY_REASON_SOURCES) as CarryReason[]) {
    if (CARRY_REASON_SOURCES[r].includes(kind)) return r;
  }
  return null;
}

export interface CarryForwardItem {
  /** Stable derived key. */
  id: string;
  entity: RecordRefLite;
  title: string;
  reason: CarryReason;
  /** One factual sentence. Never advice, never a verdict. */
  explanation: string;
  /** The field this traces to. */
  evidence: string;
  /** The attention item behind this, when there is one — carries resolutions. */
  attention?: ExecutiveAttentionItem;
}

/**
 * Something already on next week's calendar (§22).
 *
 * Kept structurally separate from `carryForward`, because a dentist appointment
 * on Monday is not unresolved work — it is a commitment that already has a
 * place. Merging the two would turn a settled week into a to-do list.
 */
export interface ScheduledNext {
  id: string;
  entity: RecordRefLite;
  title: string;
  date: DayKey;
  time?: string;
  kind: "event" | "action";
}

/**
 * A record whose evidence invites a second look (§18).
 *
 * NOT a recommendation to drop anything. The product states what it recorded —
 * "deferred four times, and no due date" — and the person decides. There is no
 * `shouldDrop`, no `staleness`, and no field this could become one through.
 */
export interface ReconsiderItem {
  id: string;
  entity: RecordRefLite;
  title: string;
  /** The facts, joined. Every clause is checkable against the record. */
  explanation: string;
  evidence: string;
}

/** A compact, score-free status line for one active goal (§13). */
export interface GoalReviewLine {
  goal: Goal;
  /** Completed linked work inside the range. The only "moved forward" there is. */
  completedThisWeek: number;
  /** True when no active project is linked. The predicate, not a verdict. */
  noActiveProject: boolean;
  /** Recorded direction changes inside the range. */
  directionChanges: ExecutiveChange[];
  /** Repeated deferrals among work under this goal. */
  repeatedDeferrals: number;
}

export interface WeeklyExecutiveReview {
  /** The underlying LIFEOS-064 review, unchanged and still authoritative. */
  base: WeekReview;
  range: ResolvedRange;
  rangeKind: WeekRangeKind;
  /**
   * True when the range's end is today — the week has not finished (§28).
   *
   * The UI says "so far" rather than presenting a partial week as history.
   */
  partial: boolean;

  // ---- historical, bounded by the range --------------------------------
  /** §7. Completed work linked to a goal or one of its projects. */
  movedForward: ExecutiveChange[];
  /** §8. Recorded transitions. Never called progress. */
  changedDirection: ExecutiveChange[];
  /** §9. Recurring-safe, counted, neutral. */
  repeatedDeferrals: PostponedItem[];
  /** §11. Waits that ENDED inside the range. */
  waitingEnded: ExecutiveChange[];
  /** §12. The user's own words only. */
  reflections: ExecutiveChange[];

  // ---- current state ----------------------------------------------------
  /**
   * §10. Unresolved at week's end, capped at three.
   *
   * NOT a section of its own on the weekly surface. The same commitments are
   * rendered once, under NEXT WEEK, with the reason they are being carried —
   * two lists of the same rows is the duplication this sprint came to remove.
   * This is the shortlist `carryForward` is built from, and the list Memory
   * answers "what remains unresolved?" with.
   */
  unresolved: ExecutiveAttentionItem[];
  /** §11. Still open now. */
  stillWaiting: WeekReview["waiting"];
  /** §13. */
  goalReview: GoalReviewLine[];

  // ---- next week ---------------------------------------------------------
  /** §15. Unresolved work that remains valid. A proposal, never a plan. */
  carryForward: CarryForwardItem[];
  /** §22. Already has a place. Structurally distinct from carry-forward. */
  scheduledNext: ScheduledNext[];
  /** §18. Candidates for a second look. Never "drop this". */
  reconsider: ReconsiderItem[];
  /** §23. One calm arithmetic line, or nothing. */
  leftBehind?: string;
}

// --------------------------------------------------------------- helpers ---

function goalIdFor(state: StoreState, change: ExecutiveChange): string | undefined {
  if (change.entity.kind === "goal") return change.entity.id;
  const a = (state.nextActions ?? []).find((x) => x.id === change.entity.id);
  if (!a) return undefined;
  if (a.goalId) return a.goalId;
  if (a.projectId) return (state.projects ?? []).find((p) => p.id === a.projectId)?.goalId;
  return undefined;
}

/** Actions under a goal, directly or through one of its projects. */
function actionsUnderGoal(state: StoreState, goalId: string): NextAction[] {
  const projectIds = new Set((state.projects ?? []).filter((p) => p.goalId === goalId).map((p) => p.id));
  return (state.nextActions ?? []).filter((a) =>
    a.goalId === goalId || (a.projectId ? projectIds.has(a.projectId) : false));
}

/**
 * Build the weekly executive review.
 *
 * `ix` is passed in because the attention shortlist needs it and the caller
 * already has one — building a second would pay for the index pass twice (§40).
 */
export function buildWeeklyExecutiveReview(
  state: StoreState,
  ix: TodayIndexes,
  rangeKind: WeekRangeKind = "this_week",
  today: DayKey = todayKey(),
): WeeklyExecutiveReview {
  const base = buildWeekReview(state, rangeKind, { today });
  const range = base.range;
  const changes = buildExecutiveChanges(state, range);

  // ---- §7. MOVED FORWARD: completed linked work, and nothing else --------
  //
  // LIFEOS-078 drew this line and 081 restated it. A horizon edit, a target
  // date change and a retitle are recorded transitions; not one of them is a
  // thing getting done. `MOVED_FORWARD_KINDS` holds completions only, and the
  // link to a goal is what makes a completion "forward" rather than merely
  // "done".
  const movedForward = changes.filter((c) =>
    (MOVED_FORWARD_KINDS as string[]).includes(c.kind) && !!goalIdFor(state, c));

  // ---- §8. CHANGED DIRECTION --------------------------------------------
  const changedDirection = changes.filter((c) =>
    (DIRECTION_KINDS as string[]).includes(c.kind)
    || c.kind === "rule_adopted" || c.kind === "rule_revised" || c.kind === "rule_retired");

  // ---- §9. REPEATED DEFERRAL: 081 exactly, recurring already excluded ----
  const repeated = repeatedlyPostponed(state, range);

  // ---- §11. WAITING, split ----------------------------------------------
  const waitingEnded = changes.filter((c) => c.kind === "waiting_ended");

  // ---- §12. REFLECTIONS: the user's own words only -----------------------
  //
  // The audit found the base review's `added` section surfacing an AI-written
  // note. `isMachineProduced` is the same predicate Memory uses to keep "you
  // said" honest, applied here so a model's sentence cannot become a week the
  // person had.
  const reflections = changes
    .filter((c) => c.kind === "reflection_added" || c.kind === "note_added")
    .filter((c) => !isMachineProduced(c.origin))
    .slice(-MAX_REFLECTIONS);

  // ---- §10. UNRESOLVED, from present state -------------------------------
  const shortlist = buildAttentionShortlist(state, ix, today, { limit: ATTENTION_MAX_LIMIT });
  const unresolved = shortlist.slice(0, MAX_UNRESOLVED);

  // ---- §13. GOAL REVIEW --------------------------------------------------
  const goalReview: GoalReviewLine[] = (state.goals ?? [])
    .filter((g) => g.status === "active")
    .map((g) => {
      const projects = (state.projects ?? []).filter((p) => p.goalId === g.id);
      const under = new Set(actionsUnderGoal(state, g.id).map((a) => a.id));
      return {
        goal: g,
        completedThisWeek: movedForward.filter((c) => goalIdFor(state, c) === g.id).length,
        noActiveProject: !projects.some((p) => p.status === "active"),
        directionChanges: changedDirection.filter((c) => c.entity.kind === "goal" && c.entity.id === g.id),
        repeatedDeferrals: repeated.filter((p) => under.has(p.action.id)).length,
      };
    });

  const carryForward = buildCarryForward(state, shortlist, repeated, today);
  const scheduledNext = buildScheduledNext(state, range, today);

  return {
    base,
    range,
    rangeKind,
    // §28. `this_week` ends today by construction, so it is only ever complete
    // in the sense that the days so far are complete.
    partial: rangeKind === "this_week",
    movedForward,
    changedDirection,
    repeatedDeferrals: repeated,
    waitingEnded,
    reflections,
    unresolved,
    stillWaiting: base.waiting,
    goalReview,
    carryForward,
    scheduledNext,
    reconsider: buildReconsider(state, repeated),
    leftBehind: leftBehindLine(state, carryForward, scheduledNext, today),
  };
}

// --------------------------------------------------------- carry forward ---

/**
 * What remains valid next week (§15, §16, §17).
 *
 * Every source is an existing signal, and the reason names which. Completed
 * work, retired rules, resolved waits and abandoned goals are excluded by
 * construction: they never enter, because the shortlist that feeds this is
 * built from present unresolved state.
 */
export function buildCarryForward(
  state: StoreState,
  shortlist: ExecutiveAttentionItem[],
  repeated: PostponedItem[],
  today: DayKey,
  limit: number = CARRY_FORWARD_DEFAULT,
): CarryForwardItem[] {
  const out: CarryForwardItem[] = [];
  const seen = new Set<string>();

  const push = (item: CarryForwardItem) => {
    if (seen.has(item.entity.id)) return;
    seen.add(item.entity.id);
    out.push(item);
  };

  for (const a of shortlist) {
    // A completed record can never be carried. Asserted separately, and true by
    // construction because the shortlist is built from live commitments.
    const action = a.entity.kind === "action"
      ? (state.nextActions ?? []).find((x) => x.id === a.entity.id)
      : undefined;
    if (action && !isLive(action)) continue;

    const reason = carryReasonFor(a.kind);
    if (!reason) continue;

    push({
      id: `carry:${reason}:${a.entity.kind}:${a.entity.id}`,
      entity: a.entity,
      title: a.title,
      reason,
      explanation: a.explanation,
      evidence: a.evidence,
      attention: a,
    });
  }

  // A repeated deferral that the shortlist's own cap cut still deserves to be
  // offered — it is exactly the kind of thing a week review exists to surface.
  for (const p of repeated) {
    if (!isLive(p.action)) continue;
    push({
      id: `carry:repeated_deferral:action:${p.action.id}`,
      entity: { kind: "action", id: p.action.id },
      title: p.action.title,
      reason: "repeated_deferral",
      explanation: postponedLine(p),
      evidence: "action.history[].deferred",
    });
  }

  return out
    .sort((x, y) =>
      (CARRY_RANK.get(x.reason) ?? 99) - (CARRY_RANK.get(y.reason) ?? 99)
      || x.title.localeCompare(y.title)
      || x.id.localeCompare(y.id))
    .slice(0, Math.min(Math.max(1, limit), ATTENTION_MAX_LIMIT));
}

// -------------------------------------------------------- scheduled next ---

/** Next week's window: the day after the range ends, through seven days on. */
function nextWeekBounds(range: ResolvedRange): { start: DayKey; end: DayKey } {
  const shift = (day: string, d: number): DayKey => {
    const [y, m, dd] = day.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd));
    dt.setUTCDate(dt.getUTCDate() + d);
    return dt.toISOString().slice(0, 10) as DayKey;
  };
  return { start: shift(range.endKey, 1), end: shift(range.endKey, 7) };
}

/**
 * Commitments that already have a place next week (§22).
 *
 * Events and dated actions, kept apart from `carryForward` because a scheduled
 * appointment is settled — treating it as unresolved would turn a planned week
 * into a backlog.
 */
export function buildScheduledNext(state: StoreState, range: ResolvedRange, today: DayKey): ScheduledNext[] {
  const { start, end } = nextWeekBounds(range);
  const out: ScheduledNext[] = [];

  for (const e of state.events ?? []) {
    if (e.date >= start && e.date <= end) {
      out.push({ id: `sched:event:${e.id}`, entity: { kind: "event", id: e.id }, title: e.title, date: e.date, time: e.startTime, kind: "event" });
    }
  }
  for (const a of state.nextActions ?? []) {
    if (!isLive(a) || !a.dueDate) continue;
    if (a.dueDate >= start && a.dueDate <= end) {
      out.push({ id: `sched:action:${a.id}`, entity: { kind: "action", id: a.id }, title: a.title, date: a.dueDate, time: a.dueTime, kind: "action" });
    }
  }
  void today;
  return out
    .sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? "").localeCompare(y.time ?? "") || x.id.localeCompare(y.id))
    .slice(0, MAX_SCHEDULED);
}

// ------------------------------------------------------------ reconsider ---

/** Deferrals past which a second look is worth OFFERING. Not a threshold on a person. */
export const RECONSIDER_DEFERRALS = 4;

/**
 * Records whose own evidence invites a second look (§18).
 *
 * Deliberately narrow, and deliberately not a recommendation. The one shape
 * implemented is §18's own example: deferred several times AND carrying no due
 * date — a thing that keeps moving and has nowhere it is meant to land. The
 * sentence states both facts and stops.
 */
export function buildReconsider(state: StoreState, repeated: PostponedItem[]): ReconsiderItem[] {
  const out: ReconsiderItem[] = [];
  for (const p of repeated) {
    if (p.count < RECONSIDER_DEFERRALS) continue;
    if (!isLive(p.action)) continue;
    if (readRule(p.action.recurrence)) continue;   // a schedule is not drift
    if (p.action.dueDate) continue;                // it has somewhere to land
    out.push({
      id: `reconsider:action:${p.action.id}`,
      entity: { kind: "action", id: p.action.id },
      title: p.action.title,
      explanation: `${postponedLine(p)} It has no due date.`,
      evidence: "action.history[].deferred",
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------ calm ---

/**
 * §23. One arithmetic line, or nothing.
 *
 * Only said when it is literally true: nothing is being carried and nothing is
 * scheduled, yet the week recorded something. It never infers importance and
 * never suggests anything can be ignored.
 */
export function leftBehindLine(
  state: StoreState,
  carry: CarryForwardItem[],
  scheduled: ScheduledNext[],
  today: DayKey,
): string | undefined {
  if (carry.length > 0) return undefined;
  const openCount = (state.nextActions ?? []).filter((a) => isLive(a)).length;
  if (openCount === 0) return undefined;
  const later = (state.nextActions ?? []).filter((a) => isLive(a) && !!a.dueDate && a.dueDate > today).length;
  if (scheduled.length === 0 && later === 0) return undefined;
  return "Everything else recorded this week is completed, resolved, or scheduled later.";
}

// ----------------------------------------------------------------- words ---

export const WEEKLY_HEADINGS = {
  finished: "Finished",
  moved: "Moved and changed",
  open: "Still open",
  words: "In your own words",
  next: "Next week",
} as const;

/** §28. Said when the week has not finished. */
export const PARTIAL_WEEK_NOTE = "This week so far — the week isn't over yet.";

/** §19. Words a weekly review may never use about a person. */
export const WEEKLY_FORBIDDEN_WORDS: readonly string[] = [
  "failed", "failure", "lazy", "discipline problem", "bad week", "good week",
  "neglect", "neglected", "lack of commitment", "unproductive", "productive week",
  "you should have", "behind", "slacking", "momentum", "score", "grade",
  "drop this", "give up on",
];

/** Every string this layer can render, for the sweep. */
export function weeklyStrings(r: WeeklyExecutiveReview): string[] {
  return [
    ...Object.values(WEEKLY_HEADINGS),
    PARTIAL_WEEK_NOTE,
    r.leftBehind ?? "",
    ...r.carryForward.flatMap((c) => [c.title, c.explanation]),
    ...r.reconsider.flatMap((c) => [c.title, c.explanation]),
    ...r.unresolved.flatMap((a) => [a.title, a.explanation]),
    ...r.movedForward.map((c) => c.title),
    ...r.changedDirection.map((c) => c.title),
    ...r.reflections.map((c) => c.title),
  ].filter(Boolean);
}
