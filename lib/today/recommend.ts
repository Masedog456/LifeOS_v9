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
import { dayDiff } from "@/lib/reviews/dates";
import { isLive } from "@/lib/actions/due";
import { minutesOf, type LocalTime } from "@/lib/time/localtime";
import type { TodayIndexes } from "@/lib/today/indexes";

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
    | "follow_up_due"
    | "returned_today"
    | "blocks_other"
    | "due_soon"
    | "planned_today"
    | "fits_before_event"
    | "only_candidate"
    | "linked_constitution";
  /** Plain language, shown as-is. Factual, never a judgment. */
  text: string;
}

export interface Recommendation {
  action: NextAction;
  reasons: Reason[];
}

export interface RecommendResult {
  recommendation: Recommendation | null;
  /** Present when there is no recommendation. Always `NO_STANDOUT`. */
  note?: string;
  /** How many actions were eligible at all. Exposed for tests, not for the UI. */
  consideredCount: number;
}

/** Facts gathered about one candidate, before ordering. */
interface Scored {
  action: NextAction;
  reasons: Reason[];
  overdueDays: number;
  dueToday: boolean;
  followUpDue: boolean;
  returnedToday: boolean;
  blocksCount: number;
  dueSoonDays: number;
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

/** How far ahead "due soon" reaches. Beyond this a date is not a reason. */
const DUE_SOON_DAYS = 3;

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
 */
function isExecutable(a: NextAction, ix: TodayIndexes): boolean {
  if (!isLive(a)) return false;
  if (a.status === "waiting") return false;
  // A recurring action is a standing source; its occurrence is handled by the
  // schedule, not by the next-action recommender.
  if (a.recurrence) return false;
  if (ix.blockedActionIds.has(a.id)) return false;
  return true;
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
function score(a: NextAction, ix: TodayIndexes, today: DayKey): Scored {
  const reasons: Reason[] = [];

  // `dayDiff(a, b)` is a MINUS b. Overdue = today - dueDate.
  const overdueDays = a.dueDate && a.dueDate < today ? dayDiff(today, a.dueDate) : 0;
  if (overdueDays > 0) {
    reasons.push({
      code: "overdue",
      text: `Overdue by ${overdueDays} ${plural(overdueDays, "day", "days")}`,
    });
  }

  const dueToday = a.dueDate === today;
  if (dueToday) {
    reasons.push(
      a.dueTime
        ? { code: "due_at_time", text: `Due today at ${a.dueTime}` }
        : { code: "due_today", text: "Due today" },
    );
  }

  const followUpDue = !!a.followUpDate && a.followUpDate <= today;
  if (followUpDue) reasons.push({ code: "follow_up_due", text: "A follow-up is due" });

  const returnedToday = a.deferredUntil === today;
  if (returnedToday) reasons.push({ code: "returned_today", text: "Comes back today" });

  const blocksCount = ix.blocksMap.get(a.id)?.size ?? 0;
  if (blocksCount > 0) {
    reasons.push({
      code: "blocks_other",
      text: `Blocks ${blocksCount} other ${plural(blocksCount, "action", "actions")}`,
    });
  }

  const dueSoonDays =
    a.dueDate && a.dueDate > today && dayDiff(a.dueDate, today) <= DUE_SOON_DAYS
      ? dayDiff(a.dueDate, today)
      : 0;
  if (dueSoonDays > 0) {
    reasons.push({
      code: "due_soon",
      text: `Due in ${dueSoonDays} ${plural(dueSoonDays, "day", "days")}`,
    });
  }

  const plannedToday = ix.plannedTodayIds.has(a.id);
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
    action: a, reasons, overdueDays, dueToday, followUpDue, returnedToday,
    blocksCount, dueSoonDays, plannedToday, fitsBeforeEvent,
  };
}

/**
 * THE ORDERING. Lexicographic; first difference wins.
 *
 *  1. more overdue                    — a passed deadline is the clearest fact
 *  2. due today                       — a deadline that has not passed yet
 *  3. follow-up due                   — a commitment to someone else
 *  4. returned from deferral today    — the user chose this date themselves
 *  5. blocks more other actions       — unblocking is observably higher leverage
 *  6. sooner due date                 — within the DUE_SOON window only
 *  7. planned for today               — an explicit horizon assignment
 *  8. fits before the next event      — only where the user SIZED the action
 *  9. created earlier                 — stable, arbitrary, and honest about it
 *
 * There is deliberately no "importance" step. See the header.
 */
function compare(a: Scored, b: Scored): number {
  if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
  if (a.dueToday !== b.dueToday) return a.dueToday ? -1 : 1;
  if (a.followUpDue !== b.followUpDue) return a.followUpDue ? -1 : 1;
  if (a.returnedToday !== b.returnedToday) return a.returnedToday ? -1 : 1;
  if (a.blocksCount !== b.blocksCount) return b.blocksCount - a.blocksCount;
  if (a.dueSoonDays !== b.dueSoonDays) {
    // 0 means "no near due date" and must sort LAST, not first.
    if (a.dueSoonDays === 0) return 1;
    if (b.dueSoonDays === 0) return -1;
    return a.dueSoonDays - b.dueSoonDays;
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
  "overdue", "due_today", "due_at_time", "follow_up_due",
  "returned_today", "blocks_other", "due_soon", "planned_today",
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
  const candidates = (state.nextActions ?? []).filter((a) => isExecutable(a, ix));
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

  return { recommendation: { action: best.action, reasons: best.reasons }, consideredCount: candidates.length };
}

/** Do these two differ on any ordering fact other than the stable tie-breaker? */
function indistinguishable(a: Scored, b: Scored): boolean {
  return (
    a.overdueDays === b.overdueDays &&
    a.dueToday === b.dueToday &&
    a.followUpDue === b.followUpDue &&
    a.returnedToday === b.returnedToday &&
    a.blocksCount === b.blocksCount &&
    a.dueSoonDays === b.dueSoonDays &&
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
