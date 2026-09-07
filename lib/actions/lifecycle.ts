/**
 * Whose move is it, and is it available now? (LIFEOS-105 §47)
 *
 * ## Why this file exists
 *
 * §47 permits a lifecycle helper "only if it consolidates existing predicates
 * rather than creating a competing lifecycle engine". This consolidates. The
 * same three-clause question was being asked in three places and answered
 * differently in each:
 *
 *   `recommend.ts`  isLive · not waiting · not deferred ahead · not blocked
 *   `signals.ts`    isLive · not deferred ahead            — waiting NOT excluded
 *   `view.ts`       isLive                                  — neither excluded
 *
 * The audit measured what the gaps cost. A waiting record carrying a `dueDate`
 * raised `overdue` and `due_soon` commitment signals — a deadline claim about
 * work whose next move belongs to someone else (§12) — and a deferred action
 * whose date happened to be today stayed in Today's DO list, so Not Today did
 * not hold (§40).
 *
 * There is no new state and no state machine here. This is the question the
 * three readers were already asking, written once.
 */

import type { NextAction } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { todayKey } from "@/lib/reviews/dates";
import { isLive } from "@/lib/actions/due";
import { isDeferredAhead } from "@/lib/actions/defer";

/**
 * Does the next move on this record belong to the PERSON? (§8, §12, §42)
 *
 * Waiting means it does not: the record is real, it is live, and the thing that
 * has to happen next is someone else's. That is why a date on a waiting record
 * is a follow-up rather than a deadline, and why no surface may present one as
 * work that can be started.
 *
 * Blocked is deliberately NOT here. A blocked action's next move is still the
 * person's — it is the blocker — so its deadline is a true claim about their
 * day, which is why LIFEOS-070 raises `overdue` on blocked work and attaches
 * the blocker as the reason.
 */
export function ownsTheNextMove(a: NextAction): boolean {
  return a.status !== "waiting";
}

/**
 * Live, the person's own move, and not parked until a later day (§40).
 *
 * The base every date claim rests on. A surface asking "is this due today / was
 * this due / is this due soon" is asking about the person's own available work,
 * and all three answers are wrong for a wait or for something they have
 * explicitly put off.
 *
 * Blocked work still passes — see `ownsTheNextMove`. Recurrence still passes:
 * whether TODAY's occurrence is due is a separate question that
 * `occurrenceFor` owns, and folding it in here would make one predicate answer
 * two things.
 */
export function isOwnMoveNow(a: NextAction, today: DayKey = todayKey()): boolean {
  return isLive(a) && ownsTheNextMove(a) && !isDeferredAhead(a, today);
}

/**
 * Fields that describe a status, and must go when that status does (§10, §11).
 *
 * LIFEOS-074 §1 established this rule and `transitionAction` applied it; the
 * audit found `completeAction` and `cancelAction` taking a different door out of
 * the same state and leaving different debris. Completing a waiting action left
 * `waitingOn`, `waitingSince` and `followUpDate` set, so the record's CURRENT
 * state said it was still waiting on Maria with a follow-up due — false, and
 * §48's `completed + follow_up_due` invalid combination.
 *
 * §46: nothing needed for history is cleared. The wait is fully recorded in
 * `history[]` — `waiting` with the person's name on the way in, and the
 * transition event on the way out — and that is where a question about what
 * happened belongs (§42).
 */
export function shedStatusFields(
  from: NextAction["status"],
  to: NextAction["status"],
): Partial<NextAction> {
  return {
    ...(from === "waiting" && to !== "waiting"
      ? { waitingOn: undefined, waitingSince: undefined, followUpDate: undefined }
      : {}),
    ...(from === "deferred" && to !== "deferred" ? { deferredUntil: undefined } : {}),
  };
}
