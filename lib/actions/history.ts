/**
 * Compact action history (LIFEOS-036, Feature 20).
 *
 * Append-only events carrying safe metadata only — never a copy of the full
 * description/notes into every event. Deduped so rapid identical events don't
 * bloat the log. Used by the detail screen, inspector, and daily-review
 * projections.
 */

import type { NextAction, ActionHistoryEvent, ActionStatus, RecordRefLite } from "@/types/mvp";

export type ActionEventKind =
  | "created" | "edited" | "started" | "paused" | "resumed" | "completed"
  | "reopened" | "deferred" | "returned" | "waiting" | "unblocked"
  | "cancelled" | "restored" | "linked" | "unlinked"
  | "due_set" | "due_cleared";

export const ACTION_LABEL: Record<ActionEventKind, string> = {
  // Neutral, past-tense wording — the history records what happened, never a
  // verdict on the user's timeliness (LIFEOS-053).
  due_set: "Due date set",
  due_cleared: "Due date removed",
  created: "Created",
  edited: "Edited",
  started: "Started",
  paused: "Paused",
  resumed: "Resumed",
  completed: "Completed",
  reopened: "Reopened",
  deferred: "Deferred",
  returned: "Returned to Next",
  waiting: "Marked waiting",
  unblocked: "Unblocked",
  cancelled: "Cancelled",
  restored: "Restored",
  linked: "Linked",
  unlinked: "Unlinked",
};

let counter = 0;
function eventId(): string {
  counter += 1;
  return `ae_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function makeEvent(input: {
  action: ActionEventKind;
  at: string;
  fromStatus?: ActionStatus;
  toStatus?: ActionStatus;
  ref?: RecordRefLite;
  detail?: string;
}): ActionHistoryEvent {
  return {
    id: eventId(),
    at: input.at,
    action: input.action,
    ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
    ...(input.toStatus ? { toStatus: input.toStatus } : {}),
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

/**
 * Append an event, collapsing an immediate duplicate (same action + same
 * from/to within the same second) so start/pause churn doesn't duplicate. Never
 * mutates the input.
 */
export function appendHistory(a: NextAction, event: ActionHistoryEvent): NextAction {
  const last = a.history[a.history.length - 1];
  if (last && last.action === event.action && last.fromStatus === event.fromStatus && last.toStatus === event.toStatus
    && Math.abs(new Date(last.at).getTime() - new Date(event.at).getTime()) < 1000) {
    return a;
  }
  return { ...a, history: [...a.history, event] };
}

export function actionHistory(a: NextAction): ActionHistoryEvent[] {
  return [...a.history].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}
