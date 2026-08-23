/**
 * Applying a reconciliation plan (LIFEOS-067 §16, §17, §33, §37).
 *
 * ## The ops seam
 *
 * The store is a module singleton, so this takes its writers as an argument —
 * the same pattern LIFEOS-065 and LIFEOS-066 use. It makes the whole thing
 * testable against a plain state object, and it makes it impossible for this
 * file to reach a writer it was not handed.
 *
 * ## No storage island (§37)
 *
 * There is no `googleCalendarEvents` domain, no provider cache, and nothing for
 * Today to read except `state.events`. An imported appointment IS a `LifeEvent`
 * from the moment it lands, which is why Today, Week in Review, Capture and
 * Temporal Editing all handle it without knowing calendars exist.
 *
 * ## Ownership is enforced by the type, not by care
 *
 * `applyExternalPatch` takes an `ExternalOwnedPatch`, which has no member for
 * `notes` or `linkedEntityRefs`. A refresh physically cannot overwrite the
 * user's annotation or their project link — not "does not", cannot.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { RecurrenceRule } from "@/types/mvp";
import type { ExternalOwnedPatch, ReconcilePlan } from "@/lib/calendar/reconcile";

/** The store writers this dispatcher may use. Nothing else. */
export interface CalendarOps {
  /** Creates an Event carrying external identity. Returns its id, or null. */
  createExternalEvent(input: {
    title: string; date: DayKey; startTime?: string; endTime?: string; allDay?: boolean;
    recurrence?: RecurrenceRule;
    externalProvider: string; externalCalendarId: string; externalEventId: string;
    externalUpdatedAt?: string;
  }): string | null;
  /** Patches ONLY external-owned fields. Cannot touch notes or links. */
  applyExternalPatch(eventId: string, patch: ExternalOwnedPatch): boolean;
  deleteEvent(eventId: string): void;
  /** Clears external identity, leaving an ordinary local Event (§17). */
  unlinkExternalEvent(eventId: string): boolean;
}

export interface ApplyOutcome {
  created: number;
  updated: number;
  removed: number;
  /** Creates or updates the store refused. Reported, never silently dropped. */
  failed: number;
  /** Said to the user. Plain words. */
  message: string;
}

export interface ApplyOptions {
  /**
   * Whether upstream absence may delete a local Event.
   *
   * Defaults to FALSE even when the plan contains removals. Two independent
   * gates have to agree before anything is deleted: the fetch must have proven
   * completeness (§28, checked in the reconciler) and the caller must opt in
   * here. Deletion is the one irreversible thing this pipeline can do.
   */
  applyRemovals?: boolean;
}

/**
 * Perform a plan. Every write goes through an existing store setter.
 */
export function applyReconcilePlan(
  plan: ReconcilePlan,
  ops: CalendarOps,
  opts: ApplyOptions = {},
): ApplyOutcome {
  let created = 0, updated = 0, removed = 0, failed = 0;

  for (const c of plan.create) {
    const id = ops.createExternalEvent({
      title: c.title, date: c.date, startTime: c.startTime, endTime: c.endTime,
      allDay: c.allDay, recurrence: c.recurrence,
      externalProvider: c.externalProvider, externalCalendarId: c.externalCalendarId,
      externalEventId: c.externalEventId, externalUpdatedAt: c.externalUpdatedAt,
    });
    if (id) created += 1; else failed += 1;
  }

  for (const u of plan.update) {
    if (ops.applyExternalPatch(u.eventId, u.patch)) {
      if (u.changed.length > 0) updated += 1;
    } else {
      failed += 1;
    }
  }

  if (opts.applyRemovals) {
    for (const r of plan.removeOrDeactivate) {
      ops.deleteEvent(r.eventId);
      removed += 1;
    }
  }

  const bits: string[] = [];
  if (created) bits.push(`${created} added`);
  if (updated) bits.push(`${updated} updated`);
  if (removed) bits.push(`${removed} removed`);
  if (failed) bits.push(`${failed} couldn't be applied`);

  return {
    created, updated, removed, failed,
    message: bits.length ? `Calendar refreshed — ${bits.join(", ")}.` : "Calendar refreshed — nothing changed.",
  };
}

/**
 * Disconnect a provider (§17, correction 6).
 *
 * **Keeps every Event as an ordinary local record.** Notes survive, project
 * links survive, and the schedule stays exactly where it was — what stops is
 * synchronisation. After this, the external calendar cannot affect these Events
 * again: a later upstream reschedule or deletion will not reach them, because
 * they no longer carry the identity a refresh matches on.
 *
 * The alternative — deleting imported events on disconnect — was rejected. A
 * user disconnecting an integration is saying "stop talking to Google", not
 * "erase my dentist appointment and the note I wrote on it".
 */
export function disconnectProvider(
  events: Array<{ id: string; externalProvider?: string }>,
  provider: string,
  ops: CalendarOps,
): { unlinked: number } {
  let unlinked = 0;
  for (const e of events) {
    if (e.externalProvider !== provider) continue;
    if (ops.unlinkExternalEvent(e.id)) unlinked += 1;
  }
  return { unlinked };
}
