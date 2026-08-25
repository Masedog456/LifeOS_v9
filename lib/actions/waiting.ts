/**
 * Waiting semantics (LIFEOS-036, Feature 8).
 *
 * An action can be marked "waiting" on someone/something, optionally with a
 * follow-up date. Waiting actions leave the "Next" queue. When a follow-up date
 * arrives it is SURFACED in the queue (a due follow-up) but the status is NEVER
 * changed automatically — the user decides what to do. No notifications.
 */

import type { NextAction } from "@/types/mvp";
import { todayKey, type DayKey } from "@/lib/reviews/dates";

/** Common "waiting on" suggestions — the user may also type their own. */
export const WAITING_SUGGESTIONS = [
  "a person", "a client", "a document", "a supplier", "a decision", "a reply",
] as const;

/** Is this a waiting action whose follow-up date has arrived (or passed)? */
export function isFollowUpDue(a: NextAction, today: DayKey = todayKey()): boolean {
  return a.status === "waiting" && typeof a.followUpDate === "string" && a.followUpDate <= today;
}

/** Waiting actions with a follow-up due on/before today (for queue + Today + review). */
export function dueFollowUps(actions: NextAction[], today: DayKey = todayKey()): NextAction[] {
  return actions.filter((a) => isFollowUpDue(a, today));
}

/**
 * Move the NEXT follow-up date, preserving everything about the wait itself
 * (LIFEOS-071 §13).
 *
 * Pure, and separate from the store for the same reason `returnDueActions` is:
 * the rule worth testing is which fields survive, not how the store applies it.
 *
 * `waitingSince` is deliberately untouched. `markActionWaiting` — the only other
 * writer of `followUpDate` — resets it to now, which is correct when a wait
 * BEGINS and falsifying when a date is merely pushed: how long the wait has run
 * is the one dated fact the waiting signal rests on.
 *
 * Returns `null` when the action is not waiting, so the caller reports a refusal
 * instead of writing a follow-up date onto a record nothing would read it from.
 */
export function withNextFollowUp(a: NextAction, followUpDate?: DayKey): NextAction | null {
  if (a.status !== "waiting") return null;
  const key = typeof followUpDate === "string" && followUpDate.trim() ? followUpDate.trim() : undefined;
  return { ...a, followUpDate: key };
}

/**
 * End a wait because the user says it is resolved (LIFEOS-071 §14).
 *
 * Returns to `open` and clears every field that described the wait. It does NOT
 * complete: "they finally replied" and "the work is done" are different claims,
 * and merging them turns a waiting item into a fake completion in Week in
 * Review and in Memory.
 */
export function withoutWaiting(a: NextAction): NextAction | null {
  if (a.status !== "waiting") return null;
  return {
    ...a,
    status: "open",
    waitingOn: undefined,
    waitingSince: undefined,
    followUpDate: undefined,
    // Left untouched on purpose — completion is a different operation, and this
    // one must never be mistaken for it.
    completedAt: a.completedAt,
  };
}

/** How long an action has been waiting, in whole days (0 if unknown). */
export function waitingDays(a: NextAction, now: Date = new Date()): number {
  if (a.status !== "waiting" || !a.waitingSince) return 0;
  const since = new Date(a.waitingSince).getTime();
  if (Number.isNaN(since)) return 0;
  return Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
}
