/**
 * Applying a temporal edit (LIFEOS-065 §4, §29).
 *
 * ## No new update API
 *
 * Every operation below dispatches to a setter that already exists and already
 * enforces its own invariants: `setActionDueTime` refuses a time with no day,
 * `updateEvent` refuses an invalid time range, `setActionRecurrence` refuses a
 * rule that will not parse, `deferAction` writes the transition into history.
 * A second set of update functions for "the natural-language path" would mean
 * two places where those rules live, and they would drift.
 *
 * ## The ops seam
 *
 * The store is a module singleton, so the dispatcher takes its writers as an
 * argument. That is what makes this testable against a plain state object and
 * what makes it impossible for this file to reach past the API it was given.
 *
 * ## Mutation happens after target resolution, never before
 *
 * `applyTemporalEdit` takes a RESOLVED target and a proposal that already
 * carries any refusal. It re-checks the refusal rather than trusting the caller:
 * the UI is one path to here, and a guard that only exists in the UI is not a
 * guard.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { todayKey } from "@/lib/reviews/dates";
import type { RecurrenceRule } from "@/lib/time/recurrence";
import type { EditProposal } from "@/lib/capture/temporal-edit";

/** The store writers this dispatcher is allowed to use. Nothing else. */
export interface EditOps {
  setActionDueDate(actionId: string, dueDate?: DayKey): void;
  setActionDueTime(actionId: string, dueTime?: string): boolean;
  setActionRecurrence(actionId: string, rule?: RecurrenceRule): boolean;
  stopActionRecurrence(actionId: string, from: DayKey): boolean;
  deferAction(actionId: string, option: { date: DayKey } | "someday"): void;
  updateEvent(eventId: string, patch: {
    date?: DayKey; startTime?: string; endTime?: string; allDay?: boolean; recurrence?: RecurrenceRule;
  }): boolean;
  stopEventRecurrence(eventId: string): void;
  deleteEvent(eventId: string): void;
}

export interface EditOutcome {
  applied: boolean;
  /** Said to the user. Present whether it worked or not. */
  message: string;
  /** The record that changed, so the caller can link to it. */
  ref?: { kind: "action" | "event"; id: string };
}

/**
 * Apply one confirmed proposal.
 *
 * `confirmDestructive` must be passed explicitly for a deletion. §13 is the
 * reason: "cancel" is a word about plans and `deleteEvent` is a word about
 * data, and the gap between them is where a user loses something they meant to
 * keep.
 */
export function applyTemporalEdit(
  proposal: EditProposal,
  ops: EditOps,
  opts: { confirmDestructive?: boolean; today?: DayKey } = {},
): EditOutcome {
  const { target, operation, after } = proposal;
  const today = opts.today ?? todayKey();

  if (proposal.refusal && operation !== "cancel_event") {
    return { applied: false, message: proposal.refusal.message };
  }

  const ref = { kind: target.kind, id: target.id } as const;

  switch (operation) {
    case "move_date":
    case "change_time":
    case "clear_time": {
      if (!after.date && target.kind === "event") {
        return { applied: false, message: "An event needs a day." };
      }
      if (target.kind === "action") {
        // Date first, then time: the store refuses a time until a day exists,
        // and that ordering is the reason it can (LIFEOS-063 R-2).
        if (after.date !== target.currentDate) ops.setActionDueDate(target.id, after.date);
        if (after.time !== target.currentTime) {
          const okTime = ops.setActionDueTime(target.id, after.time);
          if (!okTime && after.time) {
            return { applied: false, message: "Couldn't set that time — the action needs a day first." };
          }
        }
      } else {
        // Clearing an event's time makes it an all-day event. There is no third
        // state, and pretending there is would store a time-less event that
        // still claims to have a time.
        const okEvent = ops.updateEvent(target.id, {
          date: after.date,
          startTime: after.time,
          allDay: after.time ? false : true,
        });
        if (!okEvent) return { applied: false, message: "Couldn't apply that change to the event." };
      }
      return { applied: true, message: `Updated “${target.title}”.`, ref };
    }

    case "defer": {
      // Deliberately NOT a due-date change. `deferAction` writes the transition
      // into the action's history, which is what lets Week in Review say the
      // item was pushed rather than just where it sits now.
      ops.deferAction(target.id, after.deferredUntil ? { date: after.deferredUntil } : "someday");
      return { applied: true, message: `Hidden “${target.title}” until you come back to it.`, ref };
    }

    case "change_recurrence": {
      const rule = proposal.ruleForApply;
      if (!rule) return { applied: false, message: "Couldn't read that schedule." };
      if (target.kind === "action") {
        if (!ops.setActionRecurrence(target.id, rule)) {
          return { applied: false, message: "Couldn't store that schedule." };
        }
        if (after.time && after.time !== target.currentTime) ops.setActionDueTime(target.id, after.time);
      } else {
        if (!ops.updateEvent(target.id, { recurrence: rule, startTime: after.time, allDay: after.time ? false : undefined })) {
          return { applied: false, message: "Couldn't store that schedule." };
        }
      }
      return { applied: true, message: `Updated the schedule for “${target.title}”.`, ref };
    }

    case "stop_recurrence": {
      if (target.kind === "action") {
        // Keeps every completion and leaves the outstanding occurrence as an
        // ordinary dated action — the LIFEOS-061 contract, unchanged.
        if (!ops.stopActionRecurrence(target.id, today)) {
          return { applied: false, message: `“${target.title}” isn't repeating.` };
        }
      } else {
        ops.stopEventRecurrence(target.id);
      }
      return { applied: true, message: `“${target.title}” will stop repeating.`, ref };
    }

    case "cancel_event": {
      if (target.kind !== "event") {
        return { applied: false, message: "Only events can be cancelled this way." };
      }
      if (!opts.confirmDestructive) {
        return {
          applied: false,
          message: proposal.refusal?.message
            ?? `Removing “${target.title}” deletes it. Confirm that you want it gone.`,
        };
      }
      ops.deleteEvent(target.id);
      return { applied: true, message: `Deleted “${target.title}”.`, ref };
    }
  }
}


