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

/** How long an action has been waiting, in whole days (0 if unknown). */
export function waitingDays(a: NextAction, now: Date = new Date()): number {
  if (a.status !== "waiting" || !a.waitingSince) return 0;
  const since = new Date(a.waitingSince).getTime();
  if (Number.isNaN(since)) return 0;
  return Math.max(0, Math.floor((now.getTime() - since) / 86_400_000));
}
