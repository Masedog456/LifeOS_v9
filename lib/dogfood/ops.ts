/**
 * The store adapter the dogfood replay drives (LIFEOS-063 §7).
 *
 * ## Every call here is a real product operation
 *
 * `commitCapture`, `completeAction`, `deferAction`, `markActionWaiting`,
 * `completeOccurrence`, `stopActionRecurrence`, `addActionDependency`,
 * `createProject`, `updateAction` — all of them are the same functions the UI
 * calls. Nothing in this file reimplements a rule, and nothing writes a record
 * directly. If the replay's answer differs from the product's, the replay is
 * wrong, because they are the same code.
 *
 * ## The guard is the point
 *
 * `realDogfoodOps()` refuses to construct in a browser. The replay begins by
 * wiping the store, and in a browser that store holds a real person's life.
 * A comment saying "don't run this in the browser" is a convention; a throw is
 * a fence. In Node the same store is a plain in-memory object — `saveState`
 * and `clearState` both no-op without `window` — so there is nothing to lose
 * and nothing to mock.
 */

import type { StoreState, RecordRefLite as RefLite } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import type { DeferOption } from "@/lib/actions/defer";
import type { CommitCandidate } from "@/lib/capture/commit";
import {
  addActionDependency,
  commitCapture,
  completeAction,
  completeOccurrence,
  createProject,
  deferAction,
  getStoreSnapshot,
  markActionWaiting,
  resetStore,
  stopActionRecurrence,
  updateAction,
} from "@/lib/mvpStore";

/** Thrown when the replay is asked to run somewhere it could destroy data. */
export const BROWSER_REFUSAL =
  "The dogfood replay wipes the store and must never run in a browser.";

export interface DogfoodOps {
  reset(): void;
  snapshot(): StoreState;
  commit(raw: string, candidates: CommitCandidate[]): { captureId: string; created: RefLite[] };
  complete(actionId: string): void;
  defer(actionId: string, option: DeferOption): void;
  waitOn(actionId: string, person: string, followUp?: DayKey): void;
  completeOccurrence(actionId: string, on: DayKey): boolean;
  stopRecurrence(actionId: string, from: DayKey): boolean;
  dependency(blockerId: string, blockedId: string): unknown;
  project(title: string): string;
  fileUnder(actionId: string, projectId: string): void;
}

export function realDogfoodOps(): DogfoodOps {
  if (typeof window !== "undefined") throw new Error(BROWSER_REFUSAL);
  return {
    reset: () => resetStore(),
    snapshot: () => getStoreSnapshot(),
    commit: (raw, candidates) => commitCapture(raw, candidates),
    complete: (id) => completeAction(id),
    defer: (id, option) => deferAction(id, option),
    waitOn: (id, person, followUp) => markActionWaiting(id, person, followUp),
    completeOccurrence: (id, on) => completeOccurrence(id, on),
    stopRecurrence: (id, from) => stopActionRecurrence(id, from),
    dependency: (blockerId, blockedId) => addActionDependency(blockerId, blockedId),
    project: (title) => createProject({ title }),
    fileUnder: (actionId, projectId) => updateAction(actionId, { projectId }),
  };
}
