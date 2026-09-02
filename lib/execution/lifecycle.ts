/**
 * A goal's life story — transitions, and what replaced what (LIFEOS-078).
 *
 * ## The gap this closes
 *
 * Goal transitions were not recorded anywhere. `bumpGoal` overwrote `status`
 * and moved `updatedAt`, so the stored data could answer "this goal is
 * abandoned now" and nothing else. "What did I give up on in March, and what
 * did I replace it with?" was unanswerable — and inferring it from `updatedAt`
 * would misattribute a title edit as the moment a goal was abandoned, which is
 * overclaiming rather than remembering.
 *
 * Two facts fix that, and both are stored rather than derived because neither
 * can be recovered afterwards:
 *
 *   `history`           an append-only record of what changed and when
 *   `successorGoalId`   what a replaced goal BECAME
 *
 * ## Append-only means append-only
 *
 * `appendGoalHistory` only ever adds to the end. Nothing in this module edits
 * or removes an entry, and the store has no action that does either. A goal's
 * past is not editable, because a record you can quietly rewrite is not
 * evidence — the same rule the Constitution revisions (0038/0039) already
 * follow.
 *
 * Entries carry compact metadata and the user's own note. They never copy the
 * goal's title, description or notes, matching `ActionHistoryEvent` — history
 * that duplicates the body grows without bound and leaks deleted wording.
 *
 * ## Replacement is one direction
 *
 * The predecessor points at its successor. There is no `predecessorGoalId`,
 * because storing both invites the two halves to disagree; the reverse
 * direction is a lookup, and it is here.
 *
 * Pure and deterministic: no store access, no clock, no ids generated. Callers
 * supply `at` and `id` so every transition is reproducible in a test.
 */

import type { Goal, GoalHistoryEvent, GoalHorizon, GoalStatus, StoreState } from "@/types/mvp";
import { GOAL_HORIZON_LABEL } from "@/lib/execution/horizons";

/**
 * A goal's history, always as an array.
 *
 * Goals persisted before this sprint have no `history` at all, so every read
 * goes through here rather than assuming the field exists.
 */
export function goalHistory(goal: Goal): GoalHistoryEvent[] {
  return Array.isArray(goal.history) ? goal.history : [];
}

/** A goal with one more entry at the end. Never edits or drops an entry. */
export function appendGoalHistory(goal: Goal, event: GoalHistoryEvent): Goal {
  return { ...goal, history: [...goalHistory(goal), event] };
}

// ------------------------------------------------------------ the statuses --

/**
 * `replaced` joins the four statuses a goal already had (LIFEOS-078).
 *
 * It is a distinct outcome, not a synonym for `abandoned`: a goal you replaced
 * is one you are still pursuing under a truer description, and calling that
 * "abandoned" tells the user something false about their own life.
 *
 * `someday` is NOT renamed or migrated. It predates horizons and its rows are
 * real; rewriting them to `horizon = 'life'` would put words in the user's
 * mouth about goals they have not looked at in months. It stays readable and
 * keeps working, and the UI simply stops offering it for new goals.
 */
export const GOAL_LIFECYCLE_LABEL: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Achieved",
  abandoned: "Let go",
  someday: "Someday",
  replaced: "Replaced",
};

/** Statuses a goal is no longer being worked on under. */
const CLOSED: ReadonlySet<GoalStatus> = new Set<GoalStatus>(["completed", "abandoned", "replaced"]);

export function isGoalClosed(goal: Goal): boolean {
  return CLOSED.has(goal.status);
}

/** Statuses offered for a NEW goal. `someday` is deprecated; `replaced` is not chosen, it happens. */
export const GOAL_STATUS_CHOICES: readonly GoalStatus[] = ["active", "paused", "completed", "abandoned"];

// ------------------------------------------------------------- the builders --

export function goalCreatedEvent(id: string, at: string): GoalHistoryEvent {
  return { id, at, kind: "created" };
}

export function goalStatusEvent(
  id: string, at: string, from: GoalStatus, to: GoalStatus, note?: string,
): GoalHistoryEvent {
  return { id, at, kind: "status", fromStatus: from, toStatus: to, ...(note ? { note } : {}) };
}

export function goalHorizonEvent(
  id: string, at: string, from: GoalHorizon | undefined, to: GoalHorizon | undefined, note?: string,
): GoalHistoryEvent {
  return {
    id, at, kind: "horizon",
    ...(from ? { fromHorizon: from } : {}),
    ...(to ? { toHorizon: to } : {}),
    ...(note ? { note } : {}),
  };
}

export function goalReplacedEvent(
  id: string, at: string, from: GoalStatus, successorGoalId: string, note?: string,
): GoalHistoryEvent {
  return {
    id, at, kind: "replaced", fromStatus: from, toStatus: "replaced",
    successorGoalId, ...(note ? { note } : {}),
  };
}

export function goalTargetDateEvent(id: string, at: string, note?: string): GoalHistoryEvent {
  return { id, at, kind: "target_date", ...(note ? { note } : {}) };
}

// ------------------------------------------------------------- the reading --

/**
 * One factual sentence for a history entry.
 *
 * States what changed. It does not say whether that was good, does not
 * congratulate, and does not count how long anything took — the date is
 * rendered separately by the caller, from `at`.
 *
 * `titleOf` resolves a successor's title; when the successor has been deleted
 * it returns undefined and the sentence degrades to "Replaced by a goal that
 * has since been deleted" rather than printing an id or inventing a name.
 */
export function describeGoalHistoryEvent(
  event: GoalHistoryEvent,
  titleOf?: (goalId: string) => string | undefined,
): string {
  switch (event.kind) {
    case "created":
      return "Goal created.";
    case "status": {
      const to = event.toStatus ? GOAL_LIFECYCLE_LABEL[event.toStatus] : undefined;
      const from = event.fromStatus ? GOAL_LIFECYCLE_LABEL[event.fromStatus] : undefined;
      if (!to) return "Status changed.";
      return from ? `${from} → ${to}.` : `Marked ${to.toLowerCase()}.`;
    }
    case "horizon": {
      const to = event.toHorizon ? GOAL_HORIZON_LABEL[event.toHorizon] : undefined;
      const from = event.fromHorizon ? GOAL_HORIZON_LABEL[event.fromHorizon] : undefined;
      if (!to) return from ? `Horizon cleared (was ${from}).` : "Horizon cleared.";
      return from ? `Horizon ${from} → ${to}.` : `Horizon set to ${to}.`;
    }
    case "replaced": {
      const title = event.successorGoalId ? titleOf?.(event.successorGoalId) : undefined;
      if (title) return `Replaced by “${title}”.`;
      return "Replaced by a goal that has since been deleted.";
    }
    case "target_date":
      return "Target date changed.";
    default:
      return "Changed.";
  }
}

// -------------------------------------------------------------- succession --

const byId = (state: StoreState): Map<string, Goal> =>
  new Map((state.goals ?? []).map((g) => [g.id, g]));

/** The goal this one was replaced by, when it still exists. */
export function successorOf(state: StoreState, goal: Goal): Goal | undefined {
  if (!goal.successorGoalId) return undefined;
  return (state.goals ?? []).find((g) => g.id === goal.successorGoalId);
}

/**
 * The goal that was replaced BY this one, when there is one.
 *
 * A lookup rather than a stored field. If two goals somehow claim the same
 * successor — which nothing in the store does, but imported data could — the
 * first in state order wins and the other is simply not reported, rather than
 * the product asserting a chain it cannot verify.
 */
export function predecessorOf(state: StoreState, goal: Goal): Goal | undefined {
  return (state.goals ?? []).find((g) => g.successorGoalId === goal.id);
}

/**
 * The whole replacement chain a goal belongs to, oldest first.
 *
 * Walks back to the earliest predecessor, then forward through every successor.
 * Cycle-safe: a chain that loops (only reachable through corrupted or imported
 * data) stops at the first repeat instead of hanging. A dangling
 * `successorGoalId` simply ends the chain — the predecessor keeps its history
 * entry saying it was replaced, and the reader is told the successor is gone.
 */
export function goalLineage(state: StoreState, goalId: string): Goal[] {
  const index = byId(state);
  const start = index.get(goalId);
  if (!start) return [];

  const back: Goal[] = [];
  const seenBack = new Set<string>([start.id]);
  let cursor = predecessorOf(state, start);
  while (cursor && !seenBack.has(cursor.id)) {
    seenBack.add(cursor.id);
    back.unshift(cursor);
    cursor = predecessorOf(state, cursor);
  }

  const forward: Goal[] = [];
  const seenFwd = new Set<string>([start.id, ...seenBack]);
  let next = successorOf(state, start);
  while (next && !seenFwd.has(next.id)) {
    seenFwd.add(next.id);
    forward.push(next);
    next = successorOf(state, next);
  }

  return [...back, start, ...forward];
}

/**
 * The goal at the END of the replacement chain — the one the user is actually
 * pursuing now.
 *
 * Returns the goal itself when it was never replaced, and when its successor
 * has been deleted: the chain the product can VERIFY ends there.
 */
export function canonicalGoal(state: StoreState, goalId: string): Goal | undefined {
  const chain = goalLineage(state, goalId);
  if (chain.length === 0) return undefined;
  const startIdx = chain.findIndex((g) => g.id === goalId);
  return chain[chain.length - 1] ?? chain[startIdx];
}
