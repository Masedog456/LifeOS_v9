/**
 * Running a resolution (LIFEOS-071 §8, §9, §21, §22).
 *
 * ## Every mutation goes through an existing primitive
 *
 * Nothing here sets a status field. `completeAction`, `completeOccurrence`,
 * `deferAction`, `setActionDueDate`, `setNextFollowUpDate`, `stopWaiting` and
 * `createAction` already own their own history-writing, their own idempotency
 * and their own refusals; this module chooses which one to call and reports what
 * it said. A UI that reached past them would be a second source of truth for
 * what "done" means.
 *
 * ## Failure is reported, never smoothed over
 *
 * `completeOccurrence` returns `false` when that day is already recorded;
 * `setNextFollowUpDate` and `stopWaiting` return `false` when the action is no
 * longer waiting. §22: the signal stays visible, the message is factual, and
 * the affordance is not lost. A resolution that quietly did nothing while the
 * row disappeared would be the worst outcome available here.
 *
 * ## Injected ops, so the whole thing is testable without a store
 *
 * Same seam LIFEOS-065 used for temporal edits. The self-tests drive real
 * outcomes through a fake, and the browser smoke drives the real store.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { formatDayKey } from "@/lib/reviews/dates";
import type { RecordRefLite } from "@/types/mvp";
import type { ResolutionAction, ResolutionChoice } from "@/lib/commitment/resolve";

/** The store operations a resolution may use. Deliberately a short list. */
export interface ResolutionOps {
  completeAction(actionId: string): void;
  completeOccurrence(actionId: string, day: DayKey): boolean;
  deferAction(actionId: string, option: { date: DayKey } | "tomorrow" | "next_week" | "someday"): void;
  setActionDueDate(actionId: string, dueDate?: DayKey): void;
  setNextFollowUpDate(actionId: string, followUpDate?: DayKey): boolean;
  stopWaiting(actionId: string): boolean;
  createAction(input: { title: string; projectId?: string }): string;
  /**
   * Undo hooks. Present so `auto_with_undo` is a real offer rather than a word
   * in a toast — LIFEOS-060's gradient promises undo, and a promise the code
   * cannot keep is worse than not making it.
   */
  reopenAction(actionId: string): void;
  uncompleteOccurrence(actionId: string, day: DayKey): void;
}

export interface ResolutionOutcome {
  applied: boolean;
  /** Said to the user, whether it worked or not. */
  message: string;
  /** The record that changed, so the caller can link to it. */
  ref?: RecordRefLite;
  /** Present when the operation is reversible. Wired to the toast's undo. */
  undo?: { label: string; run: () => void };
}

export interface ApplyInput {
  action: ResolutionAction;
  /** The selected preset, for `defer` / `reschedule` / `set_follow_up`. */
  choice?: ResolutionChoice;
  /** The user's text, for `create_project_next_action`. */
  text?: string;
  today: DayKey;
}

/**
 * Run one resolution the user selected.
 *
 * Returns an outcome; throws nothing. A caller renders the message either way.
 */
export function applyResolution(input: ApplyInput, ops: ResolutionOps): ResolutionOutcome {
  const { action, choice, text, today } = input;
  const id = action.recordRef.id;
  const ref = action.recordRef;

  if (!action.enabled) {
    return { applied: false, message: action.explanation ?? "That isn't available right now.", ref };
  }

  switch (action.kind) {
    case "complete_action": {
      ops.completeAction(id);
      return {
        applied: true, message: "Done.", ref,
        undo: { label: "Undo", run: () => ops.reopenAction(id) },
      };
    }

    case "complete_occurrence": {
      const ok = ops.completeOccurrence(id, today);
      // §22 in one branch: the store is idempotent by (action, day) and says so
      // rather than reporting a second completion that did not happen.
      if (!ok) {
        return { applied: false, message: "Today's occurrence was already recorded.", ref };
      }
      return {
        applied: true,
        // §10, restated at the moment it matters most.
        message: "Done for today. The repeat stays.",
        ref,
        undo: { label: "Undo", run: () => ops.uncompleteOccurrence(id, today) },
      };
    }

    case "defer": {
      if (!choice) return { applied: false, message: "Pick when it should come back.", ref };
      if (choice.id === "someday") {
        ops.deferAction(id, "someday");
        return { applied: true, message: "Set aside. It stays out of the way until you bring it back.", ref };
      }
      if (choice.id === "next_week") {
        ops.deferAction(id, "next_week");
        return { applied: true, message: "Deferred to next week.", ref };
      }
      if (!choice.day) return { applied: false, message: "Pick when it should come back.", ref };
      ops.deferAction(id, { date: choice.day });
      return { applied: true, message: `Deferred until ${choice.day}.`, ref };
    }

    /**
     * LIFEOS-090 §5, §28. The same store operation as `defer`, reached by the
     * intent rather than the mechanism — and the choices are wider, so a bare
     * weekday from `notTodayChoices` lands here as a dated deferral.
     *
     * It is a DEFERRAL, not a due-date change: the user intended to do this and
     * is pushing it forward, which is the fact `history[].deferred` records and
     * the one LIFEOS-081 counts (§4, §26).
     */
    case "not_today": {
      if (!choice) return { applied: false, message: "Pick when it should come back.", ref };
      if (choice.id === "someday") {
        ops.deferAction(id, "someday");
        return { applied: true, message: "Set aside. It stays out of the way until you bring it back.", ref };
      }
      if (choice.id === "next_week") {
        ops.deferAction(id, "next_week");
        return { applied: true, message: "Not today — back next week.", ref };
      }
      if (!choice.day) return { applied: false, message: "Pick when it should come back.", ref };
      ops.deferAction(id, { date: choice.day });
      return { applied: true, message: `Not today — back ${formatDayKey(choice.day)}.`, ref };
    }

    case "reschedule": {
      if (!choice?.day) return { applied: false, message: "Pick a new date.", ref };
      ops.setActionDueDate(id, choice.day);
      return { applied: true, message: `Due date moved to ${choice.day}.`, ref };
    }

    case "set_follow_up": {
      if (!choice?.day) return { applied: false, message: "Pick the next follow-up date.", ref };
      const ok = ops.setNextFollowUpDate(id, choice.day);
      if (!ok) {
        return { applied: false, message: "This isn't waiting on anyone any more, so there's no follow-up to move.", ref };
      }
      // The message says exactly what changed and, by omission and by the
      // second sentence, what did not.
      return { applied: true, message: `Next follow-up set for ${choice.day}. Still waiting.`, ref };
    }

    case "stop_waiting": {
      const ok = ops.stopWaiting(id);
      if (!ok) return { applied: false, message: "This isn't waiting on anyone any more.", ref };
      return { applied: true, message: "No longer waiting. It's back in your open work — not marked complete.", ref };
    }

    case "create_project_next_action": {
      const title = (text ?? "").trim();
      // §16. No title, no action. Conqify does not write the commitment.
      if (!title) return { applied: false, message: "Write the next action first.", ref };
      const newId = ops.createAction({ title, projectId: ref.id });
      return { applied: true, message: "Added.", ref: { kind: "action", id: newId } };
    }

    case "open_record":
    case "open_blocker":
      // Navigation is not a mutation. Handled by the link, never here.
      return { applied: false, message: "", ref };

    default:
      return { applied: false, message: "That isn't something Conqify can do here.", ref };
  }
}
