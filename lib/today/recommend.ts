/**
 * Suggested Next (LIFEOS-062 §13, §14, §19, §20, §21).
 *
 * ## One recommendation, or none
 *
 * Not a ranked list. A leaderboard of five is a second decision problem handed
 * back to a person who opened the app because they had one already. If the
 * evidence supports a single next action, say it. If it does not, say that
 * instead — `NO_STANDOUT` exists precisely so the honest answer is available.
 *
 * ## Deterministic, and lexicographic on purpose
 *
 * No weighted sum. `urgency * 0.37 + importance * 0.22` would be a number nobody
 * can defend, tuned by whoever last touched it, and unexplainable to the person
 * it is aimed at. Instead: a fixed sequence of yes/no facts, compared in order,
 * first difference wins. Every comparison is a sentence you could say out loud.
 *
 * ## Urgency is observable. Importance is not.
 *
 * Conqify can see that something is overdue, that a date has passed, that one
 * action blocks another. It cannot see that work matters more than family, or
 * that Project A matters more than Project B — and inferring it would be the
 * product telling a person what their life is about. So the ordering uses only
 * observable facts. There is no priority rule at all — see the note below for
 * why inheriting a project's priority was rejected rather than overlooked.
 *
 * ## Explanation is mandatory
 *
 * `reasons` is never empty for a recommendation. A recommendation with nothing
 * to say for itself is indistinguishable from a guess, and this function does
 * not make guesses — if it cannot explain, it returns `NO_STANDOUT`.
 *
 * ## Derived, never stored
 *
 * The result is a projection recomputed from state on every read. It is not a
 * record, has no id, is never persisted, and acting on it does not make it the
 * user's own (LIFEOS-062 §26).
 *
 * ## Pure
 */

import type { NextAction, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { isLive, dueLabel, dueKeyOf } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";
import { blockedBy } from "@/lib/actions/dependencies";
import { readRule } from "@/lib/time/recurrence";
import { occurrenceFor } from "@/lib/mvpStore";
import { commitmentFactsFor } from "@/lib/commitment/signals";
import { minutesOf, type LocalTime } from "@/lib/time/localtime";
import type { TodayIndexes } from "@/lib/today/indexes";
import { ancestryExplanation } from "@/lib/execution/alignment";

/** Said verbatim when nothing is grounded enough. Never a filler suggestion. */
export const NO_STANDOUT =
  "No single next action stands out from what Conqify has recorded.";

/** One fact supporting a recommendation. Always shown; never a score. */
export interface Reason {
  /** Machine tag, for tests and for the ordering rules. */
  code:
    | "overdue"
    | "due_today"
    | "due_at_time"
    // `follow_up_due` is deliberately ABSENT (LIFEOS-070 §8). `followUpDate` is
    // written only by `markActionWaiting`, which sets `status: "waiting"`, and
    // `isExecutable` excludes waiting actions — so the reason could never fire
    // for the case it was written for. It read as coverage while being
    // unreachable. A due follow-up is a commitment-awareness signal, and that is
    // where it now lives.
    | "returned_today"
    | "recurring_due"
    | "blocks_other"
    | "due_within_horizon"
    | "planned_today"
    | "fits_before_event"
    | "only_candidate"
    | "linked_constitution"
    // LIFEOS-078. Which goal this action serves, from the links the user made.
    // Deliberately NOT in GROUNDING_CODES and deliberately appended AFTER the
    // ordering has run: ancestry is context, exactly like `linked_constitution`,
    // and horizon never influences what Today suggests.
    | "supports_goal"
    // LIFEOS-079. A conditional rule of the user's that mentions the same
    // thing. Same contract as the two above: context, never rank.
    | "related_rule";
  /** Plain language, shown as-is. Factual, never a judgment. */
  text: string;
}

export interface Recommendation {
  action: NextAction;
  reasons: Reason[];
  /**
   * One short sentence about what this beat (§19).
   *
   * Present only when there WAS a runner-up and the two differed on a fact worth
   * naming. Absent when the recommendation was the only candidate, or when the
   * difference is not something a sentence improves — a counterfactual that says
   * nothing is worse than none, and a narrative is not wanted here.
   */
  counterfactual?: string;
}

export interface RecommendResult {
  recommendation: Recommendation | null;
  /** Present when there is no recommendation. Always `NO_STANDOUT`. */
  note?: string;
  /** How many actions were eligible at all. Exposed for tests, not for the UI. */
  consideredCount: number;
}

/**
 * Facts gathered about one candidate, before ordering.
 *
 * Named for what it holds. It was called `Scored`, which was never true — there
 * is no score in it and never has been — and a type name that implies one is an
 * invitation for someone to add the field it promises (LIFEOS-072 §9).
 */
interface CandidateFacts {
  action: NextAction;
  reasons: Reason[];
  /**
   * A due TIME today that has not yet passed.
   *
   * Ranked above generic overdue (§7, §8): a window still closing beats one that
   * already closed. Deliberately NOT a "near" threshold — no minutes constant is
   * invented, because any number would be indefensible and unexplainable. The
   * fact is binary: today, timed, not yet passed.
   */
  dueTimeAhead: boolean;
  overdueDays: number;
  dueToday: boolean;
  returnedToday: boolean;
  recurringDue: boolean;
  /** Live actions this one unblocks. Dead dependents are not counted. */
  blocksCount: number;
  /** Days until due, WITHIN this recommender's horizon. 0 means "not near". */
  withinHorizonDays: number;
  plannedToday: boolean;
  fitsBeforeEvent: boolean;
}

/** Minutes an action is assumed to take, ONLY where the user sized it. */
const SIZE_MINUTES: Record<string, number> = {
  tiny: 5,
  small: 15,
  medium: 45,
  large: 120,
};

/**
 * How far ahead a due date is still a reason to recommend something NOW.
 *
 * Narrower than Today's Upcoming window (`UPCOMING_WINDOW_DAYS`, 7 days) on
 * purpose, and named for what it is rather than called "due soon" as well
 * (LIFEOS-070 §7). The two windows answer different questions — "worth starting
 * today" is a tighter bar than "approaching" — and the audit found them sharing
 * a name while meaning different ranges, which is how a page ends up quietly
 * contradicting itself. There is now ONE date computation
 * (`commitmentFactsFor().daysUntilDue`) and two explicitly named windows over it.
 */
export const RECOMMENDATION_HORIZON_DAYS = 3;

/**
 * §13 allows "user-marked priority if one already exists". It does not.
 *
 * `NextAction` has no priority field. `Project` and `Goal` do, but inheriting a
 * project's priority onto its actions would let the ordering claim the user
 * prioritised THIS action when what they prioritised was its container — which
 * is precisely the inferred-importance line §21 draws. So no priority rule is
 * included, and this note exists so the absence reads as a decision.
 */

/**
 * Is this action executable RIGHT NOW?
 *
 * Waiting and blocked are both excluded, and for the same reason: neither can be
 * started. Recommending one would be the product telling someone to do something
 * they are unable to do, which is worse than recommending nothing (§16, §17).
 *
 * A FUTURE DEFERRAL is excluded too (LIFEOS-072 §5). `isLive` is true for a
 * deferred action, so this function used to recommend one whose `dueDate` had
 * passed before the user deferred it — the user's later "not now" losing to
 * their earlier deadline. The predicate is shared with the commitment layer
 * rather than restated here; three sprints each wrote their own copy and each
 * copy had this bug.
 *
 * A RECURRING action is eligible only when today's occurrence is actually due
 * and not yet recorded. It used to be excluded outright, which meant a day whose
 * only eligible work was a standing commitment produced no recommendation at all
 * (LIFEOS-072 §5, §15). What is never recommended is the SERIES — see
 * `recurringDueToday`.
 */
function isExecutable(a: NextAction, ix: TodayIndexes, today: DayKey): boolean {
  if (!isLive(a)) return false;
  if (a.status === "waiting") return false;
  if (isDeferredAhead(a, today)) return false;
  if (ix.blockedActionIds.has(a.id)) return false;
  if (readRule(a.recurrence)) return recurringDueToday(a, ix, today);
  return true;
}

/**
 * Is today's occurrence of a recurring action due and still open?
 *
 * Delegates to the existing engine. A completed occurrence moves `occurrenceFor`
 * on to the next date, so a kept commitment stops being recommended with no rule
 * of its own — and a future occurrence never matches today.
 */
function recurringDueToday(a: NextAction, ix: TodayIndexes, today: DayKey): boolean {
  return occurrenceFor(a, today, ix.completions) === today;
}

/**
 * How many currently-relevant actions this one unblocks.
 *
 * Counts only dependents that are still LIVE. The audit found the raw edge count
 * being used, so an action was recommended for unblocking something already
 * completed — a recommendation built on a dead edge, which is §10's "random
 * dependency cleanup" exactly.
 */
function unblocksLiveCount(a: NextAction, ix: TodayIndexes): number {
  const ids = ix.blocksMap.get(a.id);
  if (!ids) return 0;
  let n = 0;
  for (const id of ids) {
    const dependent = ix.actionsById.get(id);
    if (dependent && isLive(dependent)) n += 1;
  }
  return n;
}

/**
 * Was this action put in today's plan TODAY?
 *
 * `PlanningAssignment` carries no date, and `updatedAt` is bumped by reordering
 * within a column, so neither can answer this. The assignment's HISTORY can: a
 * `planned`/`moved` event records `toHorizon` with a timestamp, and nothing but
 * a horizon change writes one. Without this, an action dragged into the "today"
 * column last Tuesday still read as planned-for-today forever (§13).
 */
function plannedTodayOn(ix: TodayIndexes, actionId: string, today: DayKey): boolean {
  if (!ix.plannedTodayIds.has(actionId)) return false;
  const at = ix.plannedTodayAt.get(actionId);
  // No history at all — an older assignment from before the events were written.
  // Treated as NOT planned today rather than as permanently planned: the sticky
  // reading is the one that misleads.
  return !!at && at.slice(0, 10) === today;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Gather the observable facts about one action.
 *
 * Every fact added here is something a person could verify by looking at the
 * record. Nothing is inferred about what the action means.
 */
function score(a: NextAction, ix: TodayIndexes, today: DayKey): CandidateFacts {
  const reasons: Reason[] = [];

  // LIFEOS-070 §4. The FACTS come from the shared commitment layer; this
  // function decides only what they mean for a recommendation. Nothing here
  // recomputes a date comparison that `lib/actions/due.ts` already owns.
  const f = commitmentFactsFor(a, ix, today);

  if (f.overdueDays > 0) {
    // §6. One wording for a passed deadline, and it is `dueLabel`'s: "Was due
    // Sun, Aug 23". The old text here was "Overdue by 3 days" — a count that
    // reads as a reprimand, and a third phrasing for a fact Today already had
    // two of.
    reasons.push({ code: "overdue", text: dueLabel(a, today) });
  }

  // A due TIME today, and whether the clock has passed it. §8: an action due at
  // 09:00 read at 20:00 must not be described as coming up.
  const dueTimeAhead = f.dueToday && !!a.dueTime && minutesOf(a.dueTime)! > (minutesOf(ix.now) ?? 0);
  if (f.dueToday) {
    reasons.push(
      a.dueTime
        ? {
          code: "due_at_time",
          text: dueTimeAhead ? `Due today at ${a.dueTime}` : `Was due at ${a.dueTime} today`,
        }
        : { code: "due_today", text: "Due today" },
    );
  }

  // A follow-up cannot reach this function — waiting actions are not executable
  // — so no reason is emitted for it. See the `Reason["code"]` comment.

  if (f.returnedToday) reasons.push({ code: "returned_today", text: "Came back from deferral today" });

  const recurringDue = !!readRule(a.recurrence) && recurringDueToday(a, ix, today);
  if (recurringDue) reasons.push({ code: "recurring_due", text: "Today's occurrence is due" });

  // Live dependents only — an action that unblocks something already finished
  // has unblocked nothing.
  const blocksCount = unblocksLiveCount(a, ix);
  if (blocksCount > 0) {
    const names = blockedBy(a.id, ix.blocksMap, ix.actionsById).filter(isLive);
    reasons.push({
      code: "blocks_other",
      // Naming the thing it unlocks is the difference between a fact and a
      // statistic — §19's counterfactual in miniature.
      text: names.length === 1
        ? `Unlocks ${names[0].title}`
        : `Unlocks ${blocksCount} other ${plural(blocksCount, "action", "actions")}`,
    });
  }

  // The shared fact is horizon-free; THIS window is the recommender's own.
  const withinHorizonDays =
    f.daysUntilDue !== undefined && f.daysUntilDue <= RECOMMENDATION_HORIZON_DAYS ? f.daysUntilDue : 0;
  if (withinHorizonDays > 0) {
    reasons.push({ code: "due_within_horizon", text: dueLabel(a, today) });
  }

  const plannedToday = plannedTodayOn(ix, a.id, today);
  if (plannedToday) reasons.push({ code: "planned_today", text: "You planned this for today" });

  // §15: a size claim ONLY where the user sized it. Unknown size means no claim.
  let fitsBeforeEvent = false;
  const sizeMins = a.estimatedSize ? SIZE_MINUTES[a.estimatedSize] : undefined;
  if (sizeMins !== undefined && ix.minutesToNextEvent !== undefined) {
    if (sizeMins <= ix.minutesToNextEvent) {
      fitsBeforeEvent = true;
      reasons.push({
        code: "fits_before_event",
        text: `Fits before your next event — you marked it ${a.estimatedSize} and there are ${ix.minutesToNextEvent} minutes`,
      });
    }
  }

  // §18: the Constitution contributes CONTEXT, never rank. It appears as a
  // sentence when an ADOPTED element explicitly links to this action, and it is
  // never compared, weighted or used to order anything.
  const linked = ix.constitutionByAction.get(a.id);
  if (linked) reasons.push({ code: "linked_constitution", text: `Linked to your ${linked}` });

  return {
    action: a, reasons, dueTimeAhead,
    overdueDays: f.overdueDays, dueToday: f.dueToday, returnedToday: f.returnedToday,
    recurringDue, blocksCount, withinHorizonDays, plannedToday, fitsBeforeEvent,
  };
}

/**
 * THE ORDERING. Lexicographic; first difference wins.
 *
 *  1. due at a time today, not yet passed — the only window still closing
 *  2. more overdue                    — a passed deadline is the clearest fact
 *  3. due today                       — a deadline that has not passed yet
 *  4. returned from deferral today    — the user chose this date themselves
 *  5. today's recurring occurrence    — a standing commitment, due now
 *  6. blocks more other LIVE actions  — unblocking is observably higher leverage
 *  7. sooner due date                 — within RECOMMENDATION_HORIZON_DAYS only
 *  8. planned for today               — an explicit horizon assignment, made today
 *  9. fits before the next event      — only where the user SIZED the action
 * 10. created earlier                 — stable, arbitrary, and honest about it
 *
 * Step 1 is new in LIFEOS-072 and is the one ordering change: an action due at
 * 10:30 today, read at 09:00, has a window that is still closing, while an
 * overdue action's window closed already. It needs no "near" threshold — the
 * fact is binary, and any minutes constant would be a number nobody could
 * defend (§8).
 *
 * Step 4 sits BELOW the deadline facts on purpose: returning from a deferral is
 * evidence of renewed availability, not of urgency (§12).
 *
 * The follow-up step is gone because it could never fire (LIFEOS-070 §8), not
 * because follow-ups stopped mattering — they are a commitment signal now.
 *
 * There is deliberately no "importance" step. See the header.
 */
function compare(a: CandidateFacts, b: CandidateFacts): number {
  if (a.dueTimeAhead !== b.dueTimeAhead) return a.dueTimeAhead ? -1 : 1;
  if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
  if (a.dueToday !== b.dueToday) return a.dueToday ? -1 : 1;
  if (a.returnedToday !== b.returnedToday) return a.returnedToday ? -1 : 1;
  if (a.recurringDue !== b.recurringDue) return a.recurringDue ? -1 : 1;
  if (a.blocksCount !== b.blocksCount) return b.blocksCount - a.blocksCount;
  if (a.withinHorizonDays !== b.withinHorizonDays) {
    // 0 means "no near due date" and must sort LAST, not first.
    if (a.withinHorizonDays === 0) return 1;
    if (b.withinHorizonDays === 0) return -1;
    return a.withinHorizonDays - b.withinHorizonDays;
  }
  if (a.plannedToday !== b.plannedToday) return a.plannedToday ? -1 : 1;
  if (a.fitsBeforeEvent !== b.fitsBeforeEvent) return a.fitsBeforeEvent ? -1 : 1;
  // Stable tie-breaker. Arbitrary, deterministic, and never presented as a reason.
  const ca = a.action.createdAt ?? "";
  const cb = b.action.createdAt ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.action.id < b.action.id ? -1 : 1;
}

/** Reason codes that are strong enough to justify a recommendation on their own. */
const GROUNDING_CODES = new Set<Reason["code"]>([
  "overdue", "due_today", "due_at_time",
  "returned_today", "recurring_due", "blocks_other", "due_within_horizon", "planned_today",
]);

/**
 * Recommend at most one next action.
 *
 * Returns `null` with `NO_STANDOUT` when:
 *  - nothing is executable, or
 *  - the best candidate has no GROUNDING reason (a bare "fits before your event"
 *    or a Constitution link is context, not a case), or
 *  - §31E: several candidates are indistinguishable on every ordering rule.
 */
export function recommendNextAction(
  state: StoreState,
  ix: TodayIndexes,
  today: DayKey,
): RecommendResult {
  const candidates = (state.nextActions ?? []).filter((a) => isExecutable(a, ix, today));
  if (candidates.length === 0) {
    return { recommendation: null, note: NO_STANDOUT, consideredCount: 0 };
  }

  const scored = candidates.map((a) => score(a, ix, today)).sort(compare);
  const best = scored[0];

  const grounded = best.reasons.filter((r) => GROUNDING_CODES.has(r.code));
  if (grounded.length === 0) {
    // The only executable action, with nothing to say for itself, is still worth
    // naming — "it is the only thing you could do" is a fact, not a guess.
    if (scored.length === 1) {
      return {
        recommendation: {
          action: best.action,
          reasons: [{ code: "only_candidate", text: "The only action Conqify can see that's ready to start" }],
        },
        consideredCount: candidates.length,
      };
    }
    return { recommendation: null, note: NO_STANDOUT, consideredCount: candidates.length };
  }

  // §31E: a genuine tie. If the runner-up is identical on every ordering fact,
  // picking one would present an arbitrary choice as a judgment. The stable
  // tie-breaker exists to make the ORDER deterministic, not to manufacture a
  // reason — so when it is the only thing separating two actions, say nothing.
  if (scored.length > 1 && indistinguishable(best, scored[1])) {
    return { recommendation: null, note: NO_STANDOUT, consideredCount: candidates.length };
  }

  return {
    recommendation: {
      action: best.action,
      reasons: withRule(ix, best.action, withAncestry(state, best.action, best.reasons)),
      counterfactual: scored.length > 1 ? counterfactualFor(best, scored[1], today) : undefined,
    },
    consideredCount: candidates.length,
  };
}

/**
 * Append "supports [Goal] through [Project]" — after the decision, never before.
 *
 * The ordering has already run by the time this is called, so ancestry cannot
 * move a recommendation up or down, and it is absent from `GROUNDING_CODES` so
 * it can never make an ungrounded action look explainable. It says which
 * direction the work serves, which is the whole of what LIFEOS-078 wanted here.
 */
function withAncestry(state: StoreState, action: NextAction, reasons: Reason[]): Reason[] {
  const text = ancestryExplanation(state, action);
  if (!text) return reasons;
  return [...reasons, { code: "supports_goal", text: text.replace(/\.$/, "") }];
}

/**
 * Append one conditional rule of the user's, when it mentions the same thing.
 *
 * LIFEOS-079 §11. Runs after the ordering, like `withAncestry`, and its code is
 * absent from `GROUNDING_CODES` — so a rule can neither move a recommendation
 * nor make an ungrounded action look explainable. It says what the person
 * already wrote; it does not tell them whether they are keeping it.
 */
function withRule(ix: TodayIndexes, action: NextAction, reasons: Reason[]): Reason[] {
  const rule = ix.protocolByAction.get(action.id);
  if (!rule) return reasons;
  return [...reasons, { code: "related_rule", text: `Your rule: ${rule}` }];
}

/**
 * Why the winner beat the runner-up, in one clause — or nothing (§19).
 *
 * Walks the SAME ordering the comparison used and names the first fact that
 * actually separated them, so the sentence can never disagree with the decision
 * it explains. Compact on purpose: this is a footnote under a recommendation,
 * not an argument.
 */
function counterfactualFor(best: CandidateFacts, next: CandidateFacts, today: DayKey): string | undefined {
  const other = next.action.title;
  if (best.dueTimeAhead && !next.dueTimeAhead) {
    return next.overdueDays > 0
      ? `It's due at ${best.action.dueTime} today, and that time hasn't passed yet — ${other} is already overdue.`
      : `It has a time today that hasn't passed yet; ${other} doesn't.`;
  }
  if (best.overdueDays !== next.overdueDays && best.overdueDays > 0) {
    return next.overdueDays > 0
      ? `Both are past their date; this one's was earlier.`
      : `${dueLabel(best.action, today)}, and ${other} isn't overdue.`;
  }
  if (best.dueToday && !next.dueToday) {
    // "Not due today" is two different facts: dated later, or never dated at
    // all. The §30 claim retest caught this sentence telling the user an
    // UNDATED action was "due later" — a date invented to round off a clause.
    return dueKeyOf(next.action)
      ? `It's due today; ${other} is due later.`
      : `It's due today; ${other} has no date on it.`;
  }
  if (best.returnedToday && !next.returnedToday) {
    // Same trap: by this point `next` is neither overdue nor due today, but it
    // may still carry a date further out. "No date pressing on it" would erase
    // a date the user did record.
    return dueKeyOf(next.action)
      ? `You set it to come back today; ${other} isn't due yet.`
      : `You set it to come back today; ${other} has no date on it.`;
  }
  if (best.recurringDue && !next.recurringDue) {
    return `Today's occurrence is due; ${other} has no date today.`;
  }
  if (best.blocksCount > next.blocksCount && best.blocksCount > 0) {
    // The guard is `greater than`, not `and the other is zero`. Saying the
    // runner-up "doesn't unblock anything" when it unblocks one thing is simply
    // untrue — and it is a count of records either way, never a score.
    return next.blocksCount > 0
      ? `It unblocks more of your unfinished work than ${other} does.`
      : `Finishing it unblocks other work; ${other} doesn't unblock anything.`;
  }
  if (best.withinHorizonDays > 0 && next.withinHorizonDays === 0) {
    return `Its date is close; ${other} has none within the next few days.`;
  }
  if (best.plannedToday && !next.plannedToday) {
    return `You planned it for today; ${other} you didn't.`;
  }
  // Everything above matched. The stable tie-breaker separated them, and that is
  // not a reason — saying so would dress an arbitrary pick as a judgment.
  return undefined;
}

/** Do these two differ on any ordering fact other than the stable tie-breaker? */
function indistinguishable(a: CandidateFacts, b: CandidateFacts): boolean {
  return (
    a.dueTimeAhead === b.dueTimeAhead &&
    a.overdueDays === b.overdueDays &&
    a.dueToday === b.dueToday &&
    a.returnedToday === b.returnedToday &&
    a.recurringDue === b.recurringDue &&
    a.blocksCount === b.blocksCount &&
    a.withinHorizonDays === b.withinHorizonDays &&
    a.plannedToday === b.plannedToday &&
    a.fitsBeforeEvent === b.fitsBeforeEvent
  );
}

/** Minutes from `now` until `next`, or undefined. Integer arithmetic only. */
export function minutesUntil(now: LocalTime, next: LocalTime | undefined): number | undefined {
  if (!next) return undefined;
  const a = minutesOf(now);
  const b = minutesOf(next);
  if (a === null || b === null || b < a) return undefined;
  return b - a;
}
