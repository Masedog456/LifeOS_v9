/**
 * Action queue (LIFEOS-036, Features 3 & 4).
 *
 * Deterministic filtering, sorting, and view derivation over next actions. Pure
 * over `StoreState` — viewing changes nothing. There is NO algorithmic
 * importance, no productivity score, no behavioral reordering.
 *
 * The "Next" view is strictly defined (Feature 4): status open, not deferred
 * into the future, not waiting, not completed/cancelled, and NOT currently
 * blocked by an unfinished dependency. It respects the user's manual ordering,
 * with explicit pins floated to the top. Nothing infers the "best" action.
 */

import type { NextAction, ActionDependency, StoreState, ActionSize, ActionEnergy } from "@/types/mvp";
import { type ActionView } from "@/lib/actions/status";
import { buildBlockedByMap, isBlocked } from "@/lib/actions/dependencies";

export type ActionSort = "manual" | "created" | "updated" | "deferred" | "project" | "context" | "size";

export interface ActionFilter {
  text?: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  milestoneId?: string;
  context?: string;
  energy?: ActionEnergy;
  size?: ActionSize;
  tags?: string[];
  linked?: "linked" | "unlinked";
  source?: "capture" | "review" | "none";
}

const SIZE_ORDER: Record<ActionSize, number> = { tiny: 0, small: 1, medium: 2, large: 3, unspecified: 4 };

function byId(actions: NextAction[]): Map<string, NextAction> {
  const m = new Map<string, NextAction>();
  for (const a of actions) m.set(a.id, a);
  return m;
}

/**
 * Is an action eligible for "Next"? Deterministic; today is a parameter so tests
 * and projections are reproducible. `blocked` is precomputed by the caller for
 * efficiency over large sets.
 */
export function isNextEligible(a: NextAction, blocked: boolean): boolean {
  if (a.status !== "open" && a.status !== "in_progress") return false;
  if (a.status === "in_progress") return !blocked; // an in-progress action is still "next" to resume
  // open:
  if (blocked) return false;
  return true;
}

/** The actions belonging to a queue view (before filtering/sorting). */
export function actionsForView(actions: NextAction[], deps: ActionDependency[], view: ActionView): NextAction[] {
  if (view === "all") return actions;
  if (view === "next") {
    const map = byId(actions);
    const blockedBy = buildBlockedByMap(deps);
    return actions.filter((a) => isNextEligible(a, isBlocked(a, blockedBy, map)));
  }
  if (view === "in_progress") return actions.filter((a) => a.status === "in_progress");
  if (view === "waiting") return actions.filter((a) => a.status === "waiting");
  if (view === "deferred") return actions.filter((a) => a.status === "deferred");
  if (view === "completed") return actions.filter((a) => a.status === "completed");
  if (view === "cancelled") return actions.filter((a) => a.status === "cancelled");
  return actions;
}

/** Per-view counts for the tab badges. */
export function actionCounts(actions: NextAction[], deps: ActionDependency[]): Record<ActionView, number> {
  const map = byId(actions);
  const blockedBy = buildBlockedByMap(deps);
  const counts: Record<ActionView, number> = { next: 0, in_progress: 0, waiting: 0, deferred: 0, completed: 0, cancelled: 0, all: actions.length };
  for (const a of actions) {
    if (a.status === "in_progress") counts.in_progress += 1;
    else if (a.status === "waiting") counts.waiting += 1;
    else if (a.status === "deferred") counts.deferred += 1;
    else if (a.status === "completed") counts.completed += 1;
    else if (a.status === "cancelled") counts.cancelled += 1;
    if (isNextEligible(a, isBlocked(a, blockedBy, map))) counts.next += 1;
  }
  return counts;
}

function hasLinks(a: NextAction): boolean {
  return !!(a.workspaceId || a.goalId || a.projectId || a.milestoneId || (a.linkedEntityRefs?.length));
}

export function filterActions(actions: NextAction[], filter: ActionFilter): NextAction[] {
  const q = filter.text?.trim().toLowerCase();
  return actions.filter((a) => {
    if (filter.workspaceId && a.workspaceId !== filter.workspaceId) return false;
    if (filter.goalId && a.goalId !== filter.goalId) return false;
    if (filter.projectId && a.projectId !== filter.projectId) return false;
    if (filter.milestoneId && a.milestoneId !== filter.milestoneId) return false;
    if (filter.context && a.context !== filter.context) return false;
    if (filter.energy && a.energy !== filter.energy) return false;
    if (filter.size && a.estimatedSize !== filter.size) return false;
    if (filter.tags?.length && !filter.tags.every((t) => a.tags.includes(t))) return false;
    if (filter.linked === "linked" && !hasLinks(a)) return false;
    if (filter.linked === "unlinked" && hasLinks(a)) return false;
    if (filter.source === "capture" && !a.sourceCaptureId) return false;
    if (filter.source === "review" && !a.sourceReviewId) return false;
    if (filter.source === "none" && (a.sourceCaptureId || a.sourceReviewId)) return false;
    if (q) {
      const hay = `${a.title} ${a.description} ${a.notes} ${a.waitingOn ?? ""} ${a.context ?? ""} ${a.tags.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortActions(actions: NextAction[], sort: ActionSort): NextAction[] {
  const arr = [...actions];
  // Pins always float to the top of any sort (explicit user intent).
  const pin = (a: NextAction) => (a.pinned ? 0 : 1);
  const cmp = (a: NextAction, b: NextAction): number => {
    const p = pin(a) - pin(b);
    if (p !== 0) return p;
    switch (sort) {
      case "manual": return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
      case "created": return b.createdAt.localeCompare(a.createdAt);
      case "updated": return b.updatedAt.localeCompare(a.updatedAt);
      case "deferred": return (a.deferredUntil ?? "9999").localeCompare(b.deferredUntil ?? "9999");
      case "project": return (a.projectId ?? "").localeCompare(b.projectId ?? "") || a.order - b.order;
      case "context": return (a.context ?? "~").localeCompare(b.context ?? "~") || a.order - b.order;
      case "size": return SIZE_ORDER[a.estimatedSize] - SIZE_ORDER[b.estimatedSize] || a.order - b.order;
      default: return a.order - b.order;
    }
  };
  return arr.sort(cmp);
}

export interface DerivedQueue {
  items: NextAction[];
  counts: Record<ActionView, number>;
}

/** The full derived queue for a view + filter + sort. */
export function deriveQueue(state: StoreState, opts: { view: ActionView; sort: ActionSort; filter: ActionFilter }): DerivedQueue {
  const actions = state.nextActions ?? [];
  const deps = state.actionDependencies ?? [];
  const inView = actionsForView(actions, deps, opts.view);
  const filtered = filterActions(inView, opts.filter);
  const sorted = sortActions(filtered, opts.sort);
  return { items: sorted, counts: actionCounts(actions, deps) };
}

/** The first eligible Next action (respecting pins + manual order). */
export function nextToStart(state: StoreState): NextAction | undefined {
  return deriveQueue(state, { view: "next", sort: "manual", filter: {} }).items[0];
}
