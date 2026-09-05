"use client";

/**
 * The one binding from LIFEOS-090's replanning layer to the store (§33).
 *
 * `planReplan` decides and `applyReplan` writes, but something has to hand
 * `applyReplan` the actual primitives. That binding was written once inside
 * `ReplanPreview`, which was fine while the batch preview was the only caller —
 * and stopped being fine the moment a second surface wanted to move work.
 *
 * LIFEOS-091's evening close is that second surface. Its "Carry to tomorrow"
 * button called `deferAction` directly, and deferring a WAIT is exactly the
 * defect 090 existed to remove: the record became `status: "deferred"` while
 * `waitingOn: "Marcus"` stayed on it, so every surface that asks "what am I
 * waiting on?" lost it while the person was still owed a reply. Measured, in
 * the browser, on a carry press.
 *
 * Every member here is an existing primitive. Nothing sets a field directly.
 */

import {
  completeAction, completeOccurrence, deferAction, setActionDueDate,
  setNextFollowUpDate, stopWaiting, createAction, reopenAction,
  uncompleteOccurrence, cancelAction,
} from "@/lib/mvpStore";
import type { ReplanOps } from "@/lib/planning/replan";

export const storeReplanOps: ReplanOps = {
  completeAction: (id) => completeAction(id),
  completeOccurrence: (id, day) => completeOccurrence(id, day),
  deferAction: (id, option) => deferAction(id, option),
  setActionDueDate: (id, d) => setActionDueDate(id, d),
  setNextFollowUpDate: (id, d) => setNextFollowUpDate(id, d),
  stopWaiting: (id) => stopWaiting(id),
  createAction: (input) => createAction({ title: input.title, projectId: input.projectId }),
  reopenAction: (id) => reopenAction(id),
  uncompleteOccurrence: (id, day) => uncompleteOccurrence(id, day),
  cancelAction: (id) => cancelAction(id),
};
