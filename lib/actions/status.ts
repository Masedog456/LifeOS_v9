/**
 * Action status model (LIFEOS-036, Feature 1).
 *
 * Deterministic helpers over a next action's lifecycle status. Nothing here
 * generates, classifies, prioritizes, or schedules — every transition is a
 * response to an explicit user choice. `completed`/`cancelled` are terminal but
 * reversible (reopen / restore); `waiting`/`deferred` remove an action from the
 * "Next" queue without ending it.
 */

import type { NextAction, ActionStatus, ActionSize, ActionEnergy } from "@/types/mvp";

export const STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  deferred: "Deferred",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Queue tab order. "all" is a virtual view, handled by the queue derivation. */
export const ACTION_VIEWS = ["next", "in_progress", "waiting", "deferred", "completed", "cancelled", "all"] as const;
export type ActionView = (typeof ACTION_VIEWS)[number];

export const VIEW_LABEL: Record<ActionView, string> = {
  next: "Next",
  in_progress: "In progress",
  waiting: "Waiting",
  deferred: "Deferred",
  completed: "Completed",
  cancelled: "Cancelled",
  all: "All",
};

export const SIZE_LABEL: Record<ActionSize, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  unspecified: "Unspecified",
};

export const ENERGY_LABEL: Record<ActionEnergy, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  unspecified: "Unspecified",
};

/** Common context suggestions (Feature 1) — the user may also type a custom one. */
export const CONTEXT_SUGGESTIONS = [
  "computer", "phone", "home", "office", "errand", "reading", "writing", "conversation", "anywhere",
] as const;

/**
 * User-facing status phrase (LIFEOS-042A). Presentation only — it combines the
 * stored status with whether the action is currently waiting on prerequisite
 * actions, and never changes the stored status or the planning/action engine.
 * An `open` action with no unfinished prerequisites reads "Ready"; one that is
 * held up by prerequisites reads "Waiting on prerequisites" — so the header can
 * never say "blocked" while the prerequisites panel says the action is free.
 */
export function userFacingStatus(a: NextAction, blockedByPrerequisites: boolean): string {
  switch (a.status) {
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "waiting": return a.waitingOn ? `Waiting on ${a.waitingOn}` : "Waiting on someone";
    case "deferred": return "Scheduled for later";
    case "in_progress": return "In progress";
    case "open": return blockedByPrerequisites ? "Waiting on prerequisites" : "Ready";
  }
}

/** Tone for the user-facing status, so the UI can style it without re-deriving. */
export function statusTone(a: NextAction, blockedByPrerequisites: boolean): "ready" | "active" | "waiting" | "done" | "muted" {
  if (a.status === "completed") return "done";
  if (a.status === "cancelled") return "muted";
  if (a.status === "in_progress") return "active";
  if (a.status === "waiting" || a.status === "deferred") return "waiting";
  return blockedByPrerequisites ? "waiting" : "ready";
}

const OPEN_STATUSES: ActionStatus[] = ["open", "in_progress", "waiting", "deferred"];
const TERMINAL_STATUSES: ActionStatus[] = ["completed", "cancelled"];

export function isOpen(a: NextAction): boolean {
  return OPEN_STATUSES.includes(a.status);
}

export function isTerminal(a: NextAction): boolean {
  return TERMINAL_STATUSES.includes(a.status);
}

export function isCompleted(a: NextAction): boolean {
  return a.status === "completed";
}

export function isCancelled(a: NextAction): boolean {
  return a.status === "cancelled";
}

/**
 * Whether a status transition is one the app offers. This is a guard against
 * nonsensical transitions, NOT an automation — the user still initiates each one.
 */
export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  if (from === to) return false;
  // Any state can be edited to any other via explicit user action; the only
  // rule is that we never invent a transition the UI wouldn't surface. All
  // pairs are permitted because the detail screen exposes each as a manual
  // button (start, complete, defer, wait, cancel, reopen, restore).
  return true;
}
