/**
 * Calendar reconciliation (LIFEOS-067 §9, §11, §12, §13, §16, §28, §33, §34).
 *
 * ## Nothing here writes
 *
 * `reconcileExternalEvents` is a pure function of (existing events, incoming
 * normalized events, scope). It returns a PLAN. `lib/calendar/apply.ts` performs
 * it through store setters. That separation is what makes every rule below
 * testable against a plain array, before any provider exists to make a mistake
 * with real data.
 *
 * ## Identity is the provider's, never ours (§11)
 *
 * Matching is on `(provider, calendarId, eventId)` and nothing else. Not title,
 * not date, not "looks similar". Titles change and dates change — that is the
 * entire reason a calendar integration is worth building — and two people can
 * have a meeting called "Standup" that is not the same meeting.
 *
 * The consequence is stated plainly in §12: a user who typed "Dentist Friday at
 * 3" by hand and then connects a calendar containing the same appointment gets
 * TWO events. That is a limitation, and it is the right one. A false merge
 * destroys the user's own note and their project link; a duplicate is visible,
 * and they can delete it. `possibleDuplicates` below surfaces the pair as a
 * SUGGESTION so the product can offer a link, and never acts on it.
 *
 * ## Who owns which field (§9, correction 3)
 *
 *   EXTERNAL-OWNED   title · date · startTime · endTime · allDay · recurrence
 *   CONQIFY-OWNED    notes · linkedEntityRefs · sourceCaptureId · local context
 *
 * A refresh may overwrite the first group and must never touch the second. This
 * is enforced by the TYPE of the patch this module emits: `ExternalOwnedPatch`
 * has no member for `notes` or `linkedEntityRefs`, so no amount of future
 * carelessness in the apply layer can clobber a user's annotation.
 *
 * ## What this does NOT do
 *
 * Full local-vs-upstream edit conflict detection is **deferred**.
 * `externalUpdatedAt` says when the PROVIDER changed something. It does not say
 * whether the local copy changed since the last successful sync, because this
 * codebase stores no reconciliation baseline (`external_synced_at` or
 * equivalent). Rather than pretend, the integration is read-only: external-owned
 * fields are not locally editable (see `lib/capture/temporal-edit.ts`), so the
 * conflict this cannot detect is one the product does not let you create.
 *
 * ## Absence is not deletion unless the fetch proves it (§28)
 *
 * A page that failed, a query that was cut short, a provider that errored — none
 * of these mean an event is gone. `scope.complete` is the only thing that
 * licenses removal, and it defaults to false.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { LifeEvent, RecurrenceRule } from "@/types/mvp";
import type { LocalTime } from "@/lib/time/localtime";
import { describeRule } from "@/lib/time/recurrence";
import {
  externalIdentityOf, identityKey, identityProblem,
  type NormalizedExternalEvent, type RejectedExternalEvent,
} from "@/lib/calendar/external";

/**
 * The fields a refresh may change. Deliberately has no `notes` and no
 * `linkedEntityRefs` — see the ownership note above. This is the enforcement.
 */
export interface ExternalOwnedPatch {
  title?: string;
  date?: DayKey;
  startTime?: LocalTime;
  endTime?: LocalTime;
  allDay?: boolean;
  recurrence?: RecurrenceRule;
  /** Provider bookkeeping, carried so the next refresh can skip unchanged rows. */
  externalUpdatedAt?: string;
}

/** A brand-new Event to create, with its identity attached. */
export interface ReconcileCreate {
  title: string;
  date: DayKey;
  startTime?: LocalTime;
  endTime?: LocalTime;
  allDay: boolean;
  recurrence?: RecurrenceRule;
  externalProvider: string;
  externalCalendarId: string;
  externalEventId: string;
  externalUpdatedAt?: string;
  /** Present when the provider rule could not be expressed. Reported, not stored. */
  unsupportedRecurrence?: string;
}

export interface ReconcileUpdate {
  eventId: string;
  patch: ExternalOwnedPatch;
  /** Which fields actually differ, for the report and the tests. */
  changed: string[];
  unsupportedRecurrence?: string;
}

/** An existing Event whose upstream copy is gone, or cancelled. */
export interface ReconcileRemoval {
  eventId: string;
  title: string;
  reason: "absent_upstream" | "cancelled_upstream";
}

/**
 * A local Event that LOOKS like an incoming one but has no external identity.
 *
 * Never acted on (§12). Offered so a surface can ask; a false merge would
 * destroy the user's own note and links, and there is no undo for that.
 */
export interface PossibleDuplicate {
  localEventId: string;
  localTitle: string;
  externalEventId: string;
  externalTitle: string;
  date: DayKey;
}

/** Something ambiguous enough that the reconciler refuses to decide (§34). */
export interface ReconcileConflict {
  kind: "stale_payload" | "malformed_local_identity" | "unsupported_recurrence";
  eventId?: string;
  externalEventId?: string;
  detail: string;
}

export interface ReconcileScope {
  /**
   * The window this fetch covered. Removal is only ever considered for existing
   * events INSIDE it — an event next year was not missing from a 90-day fetch,
   * it was simply not asked for.
   */
  fromDate: DayKey;
  toDate: DayKey;
  /** Which calendars this fetch actually covered. */
  provider: string;
  calendarIds: string[];
  /**
   * Did the fetch return EVERYTHING in scope?
   *
   * Defaults to false, and false means no removals. §28: a partial page, a
   * truncated result, or an error must never be read as authoritative absence.
   */
  complete: boolean;
}

export interface ReconcilePlan {
  create: ReconcileCreate[];
  update: ReconcileUpdate[];
  unchanged: string[];
  removeOrDeactivate: ReconcileRemoval[];
  conflicts: ReconcileConflict[];
  possibleDuplicates: PossibleDuplicate[];
  /** Payloads that never became normalized events, passed through for reporting. */
  rejected: RejectedExternalEvent[];
  /** True when removals were suppressed because the fetch was not complete. */
  removalsSuppressed: boolean;
}

const EMPTY_PLAN: ReconcilePlan = {
  create: [], update: [], unchanged: [], removeOrDeactivate: [],
  conflicts: [], possibleDuplicates: [], rejected: [], removalsSuppressed: false,
};

/** Is this day inside the fetched window? Day keys compare as strings. */
function inScope(date: string, scope: ReconcileScope): boolean {
  return date >= scope.fromDate && date <= scope.toDate;
}

function sameRule(a?: RecurrenceRule, b?: RecurrenceRule): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return describeRule(a) === describeRule(b) && a.interval === b.interval;
}

/**
 * Reconcile a fetch against the current store. **Pure — nothing is written.**
 *
 * Linear in the number of events on both sides: incoming events are indexed by
 * identity key once, and existing events are visited once (§39). There is no
 * title comparison in the matching path at all, so there is nothing that could
 * become O(n²) — the duplicate SUGGESTION pass is bounded by a date+title index
 * built in one sweep.
 */
export function reconcileExternalEvents(
  existing: LifeEvent[],
  incoming: NormalizedExternalEvent[],
  scope: ReconcileScope,
  rejected: RejectedExternalEvent[] = [],
): ReconcilePlan {
  const plan: ReconcilePlan = { ...EMPTY_PLAN, create: [], update: [], unchanged: [], removeOrDeactivate: [], conflicts: [], possibleDuplicates: [], rejected: [...rejected], removalsSuppressed: false };

  // ---- index existing linked events by identity, once ----
  const linked = new Map<string, LifeEvent>();
  const unlinkedByDay = new Map<string, LifeEvent[]>();
  for (const e of existing) {
    const id = externalIdentityOf(e);
    if (id) {
      // A duplicate identity in local state should be impossible — the database
      // has a unique index. If one appears anyway (a restore of a bad archive,
      // a hand-edited export), keep the FIRST and report rather than picking
      // silently or merging them.
      const key = identityKey(id);
      if (linked.has(key)) {
        plan.conflicts.push({
          kind: "malformed_local_identity", eventId: e.id,
          detail: `two local events share the external identity ${key}`,
        });
        continue;
      }
      linked.set(key, e);
      continue;
    }
    if (identityProblem(e)) {
      // Half an identity. Treated as unlinked (safe) and reported, because the
      // unique index cannot protect a row whose calendar id is null.
      plan.conflicts.push({
        kind: "malformed_local_identity", eventId: e.id,
        detail: "incomplete external identity — provider, calendar id and event id must all be present",
      });
    }
    const bucket = unlinkedByDay.get(e.date);
    if (bucket) bucket.push(e); else unlinkedByDay.set(e.date, [e]);
  }

  const seen = new Set<string>();

  for (const x of incoming) {
    const key = identityKey({ provider: x.provider, calendarId: x.externalCalendarId, eventId: x.externalEventId });

    // §42.1. The same external event twice in one payload is ONE event. Without
    // this, a provider that paginates badly would create a duplicate on import.
    if (seen.has(key)) continue;
    seen.add(key);

    if (x.unsupportedRecurrence) {
      // Reported, never coerced (§20). The event is still imported — as a single
      // dated occurrence — because the appointment is real; what is refused is
      // claiming Conqify understands the rule.
      plan.conflicts.push({
        kind: "unsupported_recurrence", externalEventId: x.externalEventId,
        detail: x.unsupportedRecurrence,
      });
    }

    const current = linked.get(key);

    // ---- cancelled upstream (§18) ----
    // `LifeEvent` has no cancellation state and this sprint does not invent one.
    // A cancelled occurrence is simply absent from the active schedule, which is
    // exactly what an upstream deletion means — so it takes the same path.
    if (x.status === "cancelled") {
      if (current) {
        plan.removeOrDeactivate.push({ eventId: current.id, title: current.title, reason: "cancelled_upstream" });
      }
      continue;
    }

    if (!current) {
      plan.create.push({
        title: x.title, date: x.date, startTime: x.startTime, endTime: x.endTime,
        allDay: x.allDay, recurrence: x.recurrence,
        externalProvider: x.provider, externalCalendarId: x.externalCalendarId,
        externalEventId: x.externalEventId, externalUpdatedAt: x.externalUpdatedAt,
        unsupportedRecurrence: x.unsupportedRecurrence,
      });

      // §12. Does a hand-made Event look like this one? Offered, never merged.
      for (const local of unlinkedByDay.get(x.date) ?? []) {
        if (local.title.trim().toLowerCase() !== x.title.trim().toLowerCase()) continue;
        plan.possibleDuplicates.push({
          localEventId: local.id, localTitle: local.title,
          externalEventId: x.externalEventId, externalTitle: x.title, date: x.date,
        });
      }
      continue;
    }

    // ---- stale response guard (§10.G) ----
    // A provider (or a cache, or a retry that raced) can hand back an older copy
    // than the one already stored. Applying it would silently move the user's
    // appointment BACK. Only possible when both timestamps exist; a missing
    // timestamp degrades to reconcile-by-identity, which still works.
    if (x.externalUpdatedAt && current.externalUpdatedAt && x.externalUpdatedAt < current.externalUpdatedAt) {
      plan.conflicts.push({
        kind: "stale_payload", eventId: current.id, externalEventId: x.externalEventId,
        detail: `incoming ${x.externalUpdatedAt} is older than stored ${current.externalUpdatedAt}`,
      });
      plan.unchanged.push(current.id);
      continue;
    }

    // ---- diff the EXTERNAL-OWNED fields only ----
    const patch: ExternalOwnedPatch = {};
    const changed: string[] = [];
    if (x.title !== current.title) { patch.title = x.title; changed.push("title"); }
    if (x.date !== current.date) { patch.date = x.date; changed.push("date"); }
    if (x.allDay !== !!current.allDay) { patch.allDay = x.allDay; changed.push("allDay"); }
    if ((x.startTime ?? undefined) !== (current.startTime ?? undefined)) {
      patch.startTime = x.startTime; changed.push("startTime");
    }
    if ((x.endTime ?? undefined) !== (current.endTime ?? undefined)) {
      patch.endTime = x.endTime; changed.push("endTime");
    }
    if (!sameRule(x.recurrence, current.recurrence)) { patch.recurrence = x.recurrence; changed.push("recurrence"); }

    if (changed.length === 0) {
      // Bookkeeping only: a newer provider timestamp with identical content is
      // still worth storing so the NEXT refresh can skip this row.
      if (x.externalUpdatedAt && x.externalUpdatedAt !== current.externalUpdatedAt) {
        plan.update.push({
          eventId: current.id, patch: { externalUpdatedAt: x.externalUpdatedAt }, changed: [],
        });
      } else {
        plan.unchanged.push(current.id);
      }
      continue;
    }

    // An all-day event has no times, and a timed one is not all-day. Send both
    // sides of the transition so the store never sees a contradictory pair.
    if (patch.allDay === true) { patch.startTime = undefined; patch.endTime = undefined; }
    patch.externalUpdatedAt = x.externalUpdatedAt;
    plan.update.push({ eventId: current.id, patch, changed, unsupportedRecurrence: x.unsupportedRecurrence });
  }

  // ---- absence (§16, §28) ----
  //
  // Only ever considered when the fetch PROVED it saw everything in scope. This
  // is the single most destructive thing reconciliation can do, and the default
  // is to do nothing.
  if (!scope.complete) {
    plan.removalsSuppressed = linked.size > 0;
  } else {
    const calendars = new Set(scope.calendarIds);
    for (const [key, e] of linked) {
      if (seen.has(key)) continue;
      const id = externalIdentityOf(e)!;
      // Not this provider, not a calendar we fetched, or outside the window:
      // absence says nothing about it.
      if (id.provider !== scope.provider) continue;
      if (!calendars.has(id.calendarId)) continue;
      if (!inScope(e.date, scope)) continue;
      plan.removeOrDeactivate.push({ eventId: e.id, title: e.title, reason: "absent_upstream" });
    }
  }

  return plan;
}

/** A one-line, plain-language summary of a plan. No scores, no percentages. */
export function describePlan(plan: ReconcilePlan): string {
  const bits: string[] = [];
  if (plan.create.length) bits.push(`${plan.create.length} added`);
  if (plan.update.filter((u) => u.changed.length > 0).length) {
    bits.push(`${plan.update.filter((u) => u.changed.length > 0).length} updated`);
  }
  if (plan.removeOrDeactivate.length) bits.push(`${plan.removeOrDeactivate.length} removed`);
  if (bits.length === 0) return "Nothing changed.";
  return `${bits.join(", ")}.`;
}
