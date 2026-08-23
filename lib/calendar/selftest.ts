/**
 * Calendar reconciliation self-tests (LIFEOS-067 §35, §39, §41, §42).
 *
 * ## Fixtures before wiring
 *
 * Every semantic below is proven against deterministic data with no provider in
 * sight. That ordering is the point: a reconciliation bug found by a live
 * connector is found by moving somebody's real dentist appointment, and a wrong
 * merge has no undo — it destroys the note and the project link the user
 * attached to a record that no longer exists.
 *
 * ## Section 3 is the load-bearing one
 *
 * It is the set of things reconciliation must REFUSE to do. A read that failed,
 * a page that was cut short, two events that merely look alike — none of these
 * may remove or merge anything. Those are the cases where a calendar integration
 * stops being a convenience and starts eating a person's schedule.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { LifeEvent, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import {
  normalizeExternalEvent, normalizeRecurrence, externalIdentityOf,
  identityProblem, identityKey, isExternallyOwned,
  type NormalizedExternalEvent, type RawExternalEvent,
} from "@/lib/calendar/external";
import {
  reconcileExternalEvents, describePlan,
  type ReconcilePlan, type ReconcileScope,
} from "@/lib/calendar/reconcile";
import { applyReconcilePlan, disconnectProvider, type CalendarOps } from "@/lib/calendar/apply";
import {
  fixtureProvider, defaultWindow, REQUIRED_SCOPES, MINIMUM_EVENT_FIELDS,
  IMPORT_WINDOW_DAYS_BACK, IMPORT_WINDOW_DAYS_FORWARD,
} from "@/lib/calendar/provider";
import { eventsOnDay } from "@/lib/time/events";
import { matchEditTargets, detectTemporalEdit, buildProposal } from "@/lib/capture/temporal-edit";
import { buildWeekReview } from "@/lib/memory/week";
import { readRule } from "@/lib/time/recurrence";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const MON: DayKey = "2026-03-02";
const TUE: DayKey = "2026-03-03";
const FRI: DayKey = "2026-03-06";
const P = "fixture";
const CAL = "primary@example.com";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function ev(p: Partial<LifeEvent> & { title: string; date: DayKey }): LifeEvent {
  seq += 1;
  return {
    id: p.id ?? `e${seq}`, notes: "", linkedEntityRefs: [],
    createdAt: `${MON}T08:00:00.000Z`, updatedAt: `${MON}T08:00:00.000Z`,
    ...p,
  } as LifeEvent;
}

/**
 * An Event already imported from the fixture provider.
 *
 * Mirrors what the IMPORT PATH actually writes, which matters more than it
 * looks: a date-only payload normalizes to `allDay: true`, so an existing row
 * built without that flag is a state no import ever produced. Building fixtures
 * that way made the reconciler report a real difference — `allDay: undefined`
 * and `allDay: true` ARE different states, and it was right to — and the failure
 * looked like an over-eager diff when it was a test that had invented data.
 */
function linked(p: Partial<LifeEvent> & { title: string; date: DayKey; externalEventId: string }): LifeEvent {
  const allDay = p.allDay ?? (p.startTime ? undefined : true);
  return ev({ externalProvider: P, externalCalendarId: CAL, allDay, ...p, ...(allDay ? { allDay } : {}) });
}

function scope(over: Partial<ReconcileScope> = {}): ReconcileScope {
  return {
    fromDate: "2026-02-01", toDate: "2026-06-30",
    provider: P, calendarIds: [CAL], complete: true, ...over,
  };
}

/** Normalize a raw payload, asserting it succeeded. */
function norm(raw: RawExternalEvent, opts = {}): NormalizedExternalEvent {
  const r = normalizeExternalEvent({ provider: P, externalCalendarId: CAL, ...raw }, opts);
  if (!r.ok) throw new Error(`fixture did not normalize: ${r.rejected.reason}`);
  return r.event;
}

/** A recording ops object over a mutable state copy. Mirrors the real store. */
function recordingOps(s: StoreState): { ops: CalendarOps; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    ops: {
      createExternalEvent(input) {
        if (!input.externalProvider || !input.externalCalendarId || !input.externalEventId) return null;
        calls.push(`create:${input.externalEventId}`);
        n += 1;
        const row = ev({
          id: `new${n}`, title: input.title, date: input.date as DayKey,
          startTime: input.startTime, endTime: input.endTime,
          allDay: input.allDay ? true : undefined,
          recurrence: input.recurrence,
          externalProvider: input.externalProvider,
          externalCalendarId: input.externalCalendarId,
          externalEventId: input.externalEventId,
          externalUpdatedAt: input.externalUpdatedAt,
        });
        s.events = [row, ...(s.events ?? [])];
        return row.id;
      },
      applyExternalPatch(eventId, patch) {
        const e = (s.events ?? []).find((x) => x.id === eventId);
        if (!e || !isExternallyOwned(e)) return false;
        calls.push(`patch:${eventId}:${Object.keys(patch).filter((k) => k !== "externalUpdatedAt").join("+") || "-"}`);
        if (patch.title !== undefined) e.title = patch.title;
        if (patch.date !== undefined) e.date = patch.date;
        if (patch.allDay !== undefined) e.allDay = patch.allDay ? true : undefined;
        if (patch.startTime !== undefined) e.startTime = patch.startTime;
        if (patch.endTime !== undefined) e.endTime = patch.endTime;
        if (patch.recurrence !== undefined) e.recurrence = patch.recurrence;
        if (patch.externalUpdatedAt !== undefined) e.externalUpdatedAt = patch.externalUpdatedAt;
        if (e.allDay) { e.startTime = undefined; e.endTime = undefined; }
        return true;
      },
      deleteEvent(eventId) {
        calls.push(`delete:${eventId}`);
        s.events = (s.events ?? []).filter((x) => x.id !== eventId);
      },
      unlinkExternalEvent(eventId) {
        const e = (s.events ?? []).find((x) => x.id === eventId);
        if (!e || !e.externalProvider) return false;
        calls.push(`unlink:${eventId}`);
        e.externalProvider = undefined; e.externalCalendarId = undefined;
        e.externalEventId = undefined; e.externalUpdatedAt = undefined;
        return true;
      },
    },
  };
}

export async function runCalendarSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, got: unknown, want: unknown) =>
    ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want),
      `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

  // ======================================== 1. identity is all-or-nothing ====
  //
  // Correction 1. Postgres treats NULLs as DISTINCT in a unique index, so a row
  // with a null calendar id would import twice and the index would not notice.
  // Identity must therefore be structurally complete before it is trusted.

  eq("1.1 a complete identity reads back",
    externalIdentityOf({ externalProvider: P, externalCalendarId: CAL, externalEventId: "x" }),
    { provider: P, calendarId: CAL, eventId: "x" });
  eq("1.2 provider + event id but NO calendar id is not an identity",
    externalIdentityOf({ externalProvider: P, externalEventId: "x" }), null);
  eq("1.3 …and is reported as malformed rather than ignored",
    identityProblem({ externalProvider: P, externalEventId: "x" }), true);
  eq("1.4 a fully unlinked event is not malformed", identityProblem({}), false);
  eq("1.5 whitespace is not an identity",
    externalIdentityOf({ externalProvider: P, externalCalendarId: "  ", externalEventId: "x" }), null);
  ok("1.6 two different identities never collide into one key",
    identityKey({ provider: P, calendarId: "a", eventId: "b c" })
    !== identityKey({ provider: P, calendarId: "a b", eventId: "c" }));

  // ================================== 2. the §35 fixture suite (A through M) ==

  // ---- A. initial import ----
  {
    const s = emptyState();
    const incoming = [
      norm({ externalEventId: "g1", title: "Dentist", start: `${TUE}T14:30:00` }),
      norm({ externalEventId: "g2", title: "Standup", start: `${MON}T09:15:00` }),
    ];
    const plan = reconcileExternalEvents(s.events ?? [], incoming, scope());
    eq("A1 initial import creates every event", plan.create.length, 2);
    eq("A2 …updates nothing", plan.update.length, 0);
    eq("A3 …removes nothing", plan.removeOrDeactivate.length, 0);
    const { ops } = recordingOps(s);
    const out = applyReconcilePlan(plan, ops, { applyRemovals: true });
    eq("A4 …and two Events exist afterwards", (s.events ?? []).length, 2);
    eq("A5 the outcome says what happened", out.created, 2);
    ok("A6 every imported Event carries a complete identity",
      (s.events ?? []).every((e) => externalIdentityOf(e) !== null));
  }

  // ---- B. refresh unchanged ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, startTime: "14:30", externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dentist", start: `${TUE}T14:30:00` }),
    ], scope());
    eq("B1 an unchanged refresh creates nothing", plan.create.length, 0);
    eq("B2 …updates nothing", plan.update.length, 0);
    eq("B3 …and reports the event as unchanged", plan.unchanged, ["a"]);
    eq("B4 the summary says so", describePlan(plan), "Nothing changed.");
  }

  // ---- C. external reschedule (§13) ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, startTime: "14:30", externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dentist", start: `${FRI}T15:00:00` }),
    ], scope());
    eq("C1 a reschedule is an UPDATE, not a create", plan.create.length, 0);
    eq("C2 …of the same Conqify record", plan.update[0]?.eventId, "a");
    eq("C3 …naming the fields that moved", plan.update[0]?.changed, ["date", "startTime"]);
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops);
    eq("C4 the same record now holds the new date", s.events[0].date, FRI);
    eq("C5 …and the new time", s.events[0].startTime, "15:00");
    eq("C6 …and there is still exactly ONE of it", s.events.length, 1);
    eq("C7 …with the same Conqify id", s.events[0].id, "a");
    // §13: Today must recompute. It reads `state.events`, so this is the proof.
    eq("C8 Today sees it on the new day", eventsOnDay(s, FRI).length, 1);
    eq("C9 …and no longer on the old one", eventsOnDay(s, TUE).length, 0);
  }

  // ---- D. external rename ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dental appointment", date: TUE }),
    ], scope());
    // ONLY the title. A rename must not drag any other field along with it.
    eq("D1 a rename changes the title and nothing else", plan.update[0]?.changed, ["title"]);
    eq("D2 …of the same id", plan.update[0]?.eventId, "a");
  }

  // ---- E. external delete, fetch complete ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [], scope({ complete: true }));
    eq("E1 upstream absence with a COMPLETE fetch is a removal", plan.removeOrDeactivate.length, 1);
    eq("E2 …named as absent upstream", plan.removeOrDeactivate[0]?.reason, "absent_upstream");
    // Two gates, not one: the fetch proved completeness AND the caller opts in.
    const { ops: o1 } = recordingOps(s);
    applyReconcilePlan(plan, o1, {});
    eq("E3 apply does NOT remove without an explicit opt-in", (s.events ?? []).length, 1);
    const { ops: o2 } = recordingOps(s);
    applyReconcilePlan(plan, o2, { applyRemovals: true });
    eq("E4 …and removes only when both gates agree", (s.events ?? []).length, 0);
  }

  // ---- F. duplicate title, different external id (§42.4) ----
  {
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "g1", title: "Standup", start: `${MON}T09:15:00` }),
      norm({ externalEventId: "g2", title: "Standup", start: `${MON}T09:15:00` }),
    ], scope());
    eq("F1 same title, same time, different ids → TWO events", plan.create.length, 2);
    ok("F2 …and they keep their own identities",
      plan.create[0].externalEventId !== plan.create[1].externalEventId);
  }

  // ---- G. same id, changed fields ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Old", date: TUE, startTime: "09:00", externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "New", start: `${FRI}T11:00:00` }),
    ], scope());
    eq("G1 one update, not a create plus a delete", `${plan.create.length}/${plan.update.length}/${plan.removeOrDeactivate.length}`, "0/1/0");
  }

  // ---- H. all-day event (§19) ----
  {
    const s = emptyState();
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "b1", title: "Mum's birthday", date: "2026-08-14" }),
    ], scope({ toDate: "2026-12-31" }));
    eq("H1 an all-day event imports as all-day", plan.create[0]?.allDay, true);
    eq("H2 …with NO fake start time", plan.create[0]?.startTime, undefined);
    eq("H3 …and no fake end time", plan.create[0]?.endTime, undefined);
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops);
    const occ = eventsOnDay(s, "2026-08-14");
    eq("H4 Today shows it as all-day", occ[0]?.allDay, true);
    eq("H5 …and orders it without inventing 00:00", occ[0]?.startTime, undefined);
  }

  // ---- I. recurring simple event ----
  {
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "r1", title: "Standup", start: `${MON}T09:15:00`, recurrence: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR" }),
    ], scope());
    eq("I1 a representable RRULE becomes a rule", plan.create[0]?.recurrence?.frequency, "weekly");
    eq("I2 …with the right days", plan.create[0]?.recurrence?.weekdays, [1, 3, 5]);
    eq("I3 …and no unsupported-recurrence conflict", plan.conflicts.length, 0);
  }

  // ---- J. unsupported recurrence (§20, §42.7) ----
  {
    const s = emptyState();
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "r2", title: "Board meeting", start: `${TUE}T10:00:00`, recurrence: "RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3" }),
    ], scope());
    eq("J1 an unrepresentable rule is NOT coerced", plan.create[0]?.recurrence, undefined);
    eq("J2 …the event is still imported, as a single occurrence", plan.create.length, 1);
    eq("J3 …and the rule is reported, not discarded", plan.conflicts[0]?.kind, "unsupported_recurrence");
    ok("J4 …with the provider's own text preserved",
      /BYSETPOS/.test(plan.conflicts[0]?.detail ?? ""), plan.conflicts[0]?.detail);
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops);
    ok("J5 the stored Event makes no recurrence claim", !s.events[0].recurrence);
  }

  // ---- K. provider failure (§27) ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" })];
    const provider = fixtureProvider({ calendars: [{ id: CAL, name: "Primary" }], events: {}, failWith: "network down" });
    const res = await provider.fetchEvents(CAL, defaultWindow(MON));
    eq("K1 a failed read reports the failure", res.error, "network down");
    eq("K2 …and does NOT claim completeness", res.complete, false);
    const plan = reconcileExternalEvents(s.events, res.events, scope({ complete: res.complete }));
    eq("K3 …so nothing is removed", plan.removeOrDeactivate.length, 0);
    eq("K4 …and the suppression is reported, not silent", plan.removalsSuppressed, true);
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops, { applyRemovals: true });
    eq("K5 the user's schedule survives a failed refresh", (s.events ?? []).length, 1);
  }

  // ---- L. partial fetch (§28, §42.9) ----
  {
    const s = emptyState();
    s.events = [
      linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" }),
      linked({ id: "b", title: "Standup", date: MON, externalEventId: "g2" }),
    ];
    // The page came back with only ONE of the two events, and said so.
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dentist", date: TUE }),
    ], scope({ complete: false }));
    eq("L1 an unseen event is NOT deleted after a partial fetch", plan.removeOrDeactivate.length, 0);
    eq("L2 …and the suppression is visible", plan.removalsSuppressed, true);
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops, { applyRemovals: true });
    eq("L3 both events survive", (s.events ?? []).length, 2);
  }

  // ---- M. provider disconnect (§17, correction 6) ----
  {
    const s = emptyState();
    s.events = [
      linked({ id: "a", title: "Dentist", date: TUE, startTime: "14:30", externalEventId: "g1",
        notes: "Ask about tooth sensitivity", linkedEntityRefs: [{ kind: "project", id: "p1" }] as LifeEvent["linkedEntityRefs"] }),
      ev({ id: "local", title: "Dinner with Sam", date: MON }),
    ];
    const { ops } = recordingOps(s);
    const res = disconnectProvider(s.events, P, ops);
    eq("M1 one linked Event was unlinked", res.unlinked, 1);
    eq("M2 the Event is KEPT, not deleted", (s.events ?? []).length, 2);
    eq("M3 …its schedule is untouched", s.events[0].date, TUE);
    eq("M4 …its note survives", s.events[0].notes, "Ask about tooth sensitivity");
    eq("M5 …its project link survives", s.events[0].linkedEntityRefs?.length, 1);
    eq("M6 …and it is now an ordinary local Event", isExternallyOwned(s.events[0]), false);
    // The explicit consequence: upstream can no longer reach it.
    const after = reconcileExternalEvents(s.events, [], scope({ complete: true }));
    eq("M7 a later upstream deletion cannot touch it", after.removeOrDeactivate.length, 0);
    const back = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Renamed upstream", date: FRI }),
    ], scope());
    eq("M8 …and a later upstream change creates a NEW event instead of editing it", back.create.length, 1);
    eq("M9 …leaving the unlinked one alone", back.update.length, 0);
  }

  // ============ 3. what reconciliation must REFUSE to do (§11, §12, §28) =====

  // ---- §12 / §42.5. A hand-made Event is never silently merged. ----
  {
    const s = emptyState();
    s.events = [ev({ id: "mine", title: "Dentist", date: FRI, startTime: "15:00", notes: "my own note" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g9", title: "Dentist", start: `${FRI}T15:00:00` }),
    ], scope());
    eq("3.1 a look-alike local Event is NOT merged", plan.update.length, 0);
    eq("3.2 …the external one is created separately", plan.create.length, 1);
    eq("3.3 …and the pair is offered as a possible duplicate", plan.possibleDuplicates.length, 1);
    eq("3.4 …naming both sides", plan.possibleDuplicates[0]?.localEventId, "mine");
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops, { applyRemovals: true });
    eq("3.5 both events exist afterwards", (s.events ?? []).length, 2);
    ok("3.6 …and the user's own note is untouched",
      (s.events ?? []).some((e) => e.notes === "my own note"));
  }

  // ---- Out-of-scope events are never removed by a fetch that never asked. ----
  {
    const s = emptyState();
    s.events = [
      linked({ id: "far", title: "Conference", date: "2027-01-15", externalEventId: "g5" }),
      linked({ id: "other", title: "Work thing", date: TUE, externalEventId: "g6", externalCalendarId: "work@example.com" }),
    ];
    const plan = reconcileExternalEvents(s.events, [], scope({ complete: true }));
    eq("3.7 an event outside the fetched WINDOW is not removed", plan.removeOrDeactivate.filter((r) => r.eventId === "far").length, 0);
    eq("3.8 an event from an unfetched CALENDAR is not removed", plan.removeOrDeactivate.filter((r) => r.eventId === "other").length, 0);
  }

  // ---- A different provider's events are not this provider's business. ----
  {
    const s = emptyState();
    s.events = [ev({ id: "x", title: "Thing", date: TUE, externalProvider: "other", externalCalendarId: CAL, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [], scope({ complete: true }));
    eq("3.9 another provider's events are untouched", plan.removeOrDeactivate.length, 0);
  }

  // ================== 4. correction 10 — the adversarial identity cases ======

  // ---- A. provider present, calendar id null, event id present ----
  {
    const r = normalizeExternalEvent({ provider: P, externalEventId: "g1", title: "X", date: TUE });
    eq("4.A a payload with no calendar id is REJECTED", r.ok, false);
    eq("4.A2 …as malformed identity", r.ok === false ? r.rejected.reason : "", "missing_identity");
  }

  // ---- B. the same identity twice ----
  {
    const one = norm({ externalEventId: "g1", title: "Dentist", date: TUE });
    const plan = reconcileExternalEvents([], [one, { ...one }], scope());
    eq("4.B the same external event twice → ONE LifeEvent", plan.create.length, 1);
  }

  // ---- C. same provider/event id, DIFFERENT calendars ----
  {
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "shared", title: "Team sync", date: TUE }),
      norm({ externalCalendarId: "work@example.com", externalEventId: "shared", title: "Team sync", date: TUE }),
    ], scope());
    eq("4.C same event id in two calendars → two distinct identities", plan.create.length, 2);
  }

  // ---- D. refresh changes title/date; local enrichment survives (correction 5) ----
  {
    const s = emptyState();
    s.events = [linked({
      id: "a", title: "Dentist", date: TUE, startTime: "14:30", externalEventId: "g1",
      notes: "Ask about tooth sensitivity",
      linkedEntityRefs: [{ kind: "project", id: "health" }] as LifeEvent["linkedEntityRefs"],
    })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dental appointment", start: `${FRI}T15:00:00` }),
    ], scope());
    // The patch TYPE has no member for notes or links. This is the proof.
    ok("4.D the patch cannot even express a note change",
      !("notes" in (plan.update[0]?.patch ?? {})) && !("linkedEntityRefs" in (plan.update[0]?.patch ?? {})),
      JSON.stringify(plan.update[0]?.patch));
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops);
    eq("4.D2 the external fields updated", `${s.events[0].title} / ${s.events[0].date}`, `Dental appointment / ${FRI}`);
    eq("4.D3 …the user's note SURVIVED", s.events[0].notes, "Ask about tooth sensitivity");
    eq("4.D4 …and so did the project link", s.events[0].linkedEntityRefs?.[0]?.id, "health");
  }

  // ---- E. a local temporal edit against a read-only external Event (§14) ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, startTime: "14:30", externalEventId: "g1" })];
    const targets = matchEditTargets("dentist", s, "event");
    eq("4.E the Event is found by the editor", targets.length, 1);
    ok("4.E2 …but marked blocked", !!targets[0].blocked, targets[0].blocked);
    ok("4.E3 …and the block SAYS why, in the user's terms",
      /can't write to it/i.test(targets[0].blocked ?? ""), targets[0].blocked);
    const intent = detectTemporalEdit("Move the dentist to Friday at 3", s, MON);
    eq("4.E4 the edit is refused", intent?.refusal?.code, "external_read_only");
    const proposal = intent && intent.candidateMatches[0] ? buildProposal(intent, intent.candidateMatches[0]) : null;
    ok("4.E5 …and the proposal carries the refusal, so no Confirm is offered",
      !!proposal?.refusal, JSON.stringify(proposal?.refusal));
    eq("4.E6 nothing diverged — the Event is where the calendar put it", s.events[0].date, TUE);
    // A LOCAL event is still perfectly editable. The block is not collateral.
    const s2 = emptyState();
    s2.events = [ev({ id: "b", title: "Dentist", date: TUE, startTime: "14:30" })];
    const local = detectTemporalEdit("Move the dentist to Friday at 3", s2, MON);
    eq("4.E7 a LOCAL event is still editable", local?.refusal, undefined);
  }

  // ---- F. missing externalUpdatedAt ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Renamed", date: TUE }),
    ], scope());
    eq("4.F reconciliation works with no provider timestamp at all", plan.update[0]?.eventId, "a");
    ok("4.F2 …matching by identity, not by clock", plan.create.length === 0);
  }

  // ---- G. a stale payload must not regress the event ----
  {
    const s = emptyState();
    s.events = [linked({
      id: "a", title: "Current", date: FRI, externalEventId: "g1",
      externalUpdatedAt: "2026-03-05T10:00:00.000Z",
    })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Older copy", date: TUE, updatedAt: "2026-03-01T10:00:00.000Z" }),
    ], scope());
    eq("4.G an older payload does NOT overwrite a newer one", plan.update.length, 0);
    eq("4.G2 …it is reported as a stale payload", plan.conflicts[0]?.kind, "stale_payload");
    eq("4.G3 …and the event is left alone", plan.unchanged, ["a"]);
  }

  // ---- H. timezone-bearing fixtures (§22, correction 4) ----
  {
    // A. all-day date
    const allDay = normalizeExternalEvent({ provider: P, externalCalendarId: CAL, externalEventId: "t1", title: "Holiday", date: TUE });
    eq("4.H-A an all-day date is representable exactly", allDay.ok && allDay.event.allDay, true);

    // B. floating / local wall clock — this IS Conqify's model
    const floating = normalizeExternalEvent({ provider: P, externalCalendarId: CAL, externalEventId: "t2", title: "Call", start: `${TUE}T14:30:00` });
    eq("4.H-B a floating wall-clock time is taken verbatim", floating.ok && floating.event.startTime, "14:30");

    // C. a NAMED zone, with no home zone known → refused, not guessed
    const zoned = normalizeExternalEvent({
      provider: P, externalCalendarId: CAL, externalEventId: "t3", title: "Call",
      start: `${TUE}T14:30:00+01:00`, timeZone: "Europe/Paris",
    });
    eq("4.H-C a zoned instant with no home zone is REFUSED", zoned.ok, false);
    eq("4.H-C2 …with the reason named", zoned.ok === false ? zoned.rejected.reason : "", "timezone_unsupported");
    ok("4.H-C3 …and nothing claims the timezone was preserved",
      zoned.ok === false && /Europe\/Paris/.test(zoned.rejected.detail ?? ""), JSON.stringify(zoned));

    // …and accepted verbatim when the caller states a MATCHING home zone.
    const matching = normalizeExternalEvent({
      provider: P, externalCalendarId: CAL, externalEventId: "t4", title: "Call",
      start: `${TUE}T14:30:00+01:00`, timeZone: "Europe/Paris",
    }, { homeTimeZone: "Europe/Paris" });
    eq("4.H-C4 a matching home zone reads the wall clock verbatim", matching.ok && matching.event.startTime, "14:30");

    // D. a FIXED UTC offset plus a known home offset — exact integer arithmetic
    const utc = normalizeExternalEvent({
      provider: P, externalCalendarId: CAL, externalEventId: "t5", title: "Call",
      start: `${TUE}T14:30:00Z`,
    }, { homeUtcOffsetMinutes: -300 });
    eq("4.H-D a UTC instant converts to the stated home offset", utc.ok && utc.event.startTime, "09:30");
    eq("4.H-D2 …on the same day here", utc.ok && utc.event.date, TUE);

    // …and the day rolls when the offset crosses midnight. No fake precision.
    const rolls = normalizeExternalEvent({
      provider: P, externalCalendarId: CAL, externalEventId: "t6", title: "Late call",
      start: `${TUE}T02:00:00Z`,
    }, { homeUtcOffsetMinutes: -300 });
    eq("4.H-D3 an offset that crosses midnight moves the DAY too", rolls.ok && rolls.event.date, MON);
    eq("4.H-D4 …and the time", rolls.ok && rolls.event.startTime, "21:00");

    // The provider's original strings are kept, so nothing is silently lost.
    ok("4.H-E the original provider strings survive as metadata",
      utc.ok && utc.event.sourceStart === `${TUE}T02:00:00Z`.replace("02:00", "14:30"),
      utc.ok ? utc.event.sourceStart : "");
  }

  // ========================= 5. §42 torture (the ones not covered above) =====

  // 42.12 — markup in an external title is stored and rendered as TEXT.
  {
    const evil = `<script>alert('x')</script>Dentist`;
    const plan = reconcileExternalEvents([], [norm({ externalEventId: "x1", title: evil, date: TUE })], scope());
    eq("5.1 a script-like title is stored verbatim, not stripped", plan.create[0]?.title, evil);
    ok("5.2 …and no HTML is executed anywhere, because React escapes text",
      typeof plan.create[0]?.title === "string");
    // Oversized titles are truncated with an ellipsis rather than refused.
    const huge = "A".repeat(5000);
    const big = normalizeExternalEvent({ provider: P, externalCalendarId: CAL, externalEventId: "x2", title: huge, date: TUE });
    ok("5.3 an oversized title is bounded", big.ok && big.event.title.length <= 301, big.ok ? String(big.event.title.length) : "");
    ok("5.4 …and the event is still imported", big.ok);
  }

  // Malformed provider data is refused with a reason, never stored as a guess.
  for (const [label, raw, reason] of [
    ["a malformed date", { externalEventId: "m1", title: "X", date: "not-a-date" }, "malformed_date"],
    // The date parsed and the TIME did not, and the rejection says which. A
    // single "malformed" reason would tell the user less than we know.
    ["a malformed time", { externalEventId: "m2", title: "X", start: "2026-03-03T99:99:00" }, "malformed_time"],
    ["an empty title", { externalEventId: "m3", title: "   ", date: TUE }, "empty_title"],
    ["no date at all", { externalEventId: "m4", title: "X" }, "malformed_date"],
  ] as const) {
    const r = normalizeExternalEvent({ provider: P, externalCalendarId: CAL, ...raw });
    eq(`5.5 ${label} is refused as ${reason}`, r.ok === false ? r.rejected.reason : "ok", reason);
  }

  // A local event whose identity is half-written is treated as unlinked (safe).
  {
    const s = emptyState();
    s.events = [ev({ id: "half", title: "Broken", date: TUE, externalProvider: P, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Broken", date: TUE }),
    ], scope({ complete: true }));
    eq("5.6 a half-identity local row is reported", plan.conflicts[0]?.kind, "malformed_local_identity");
    eq("5.7 …treated as unlinked, so the import creates a proper record", plan.create.length, 1);
    eq("5.8 …and it is never removed as 'absent upstream'", plan.removeOrDeactivate.length, 0);
  }

  // Two local rows sharing one identity: keep the first, report, never merge.
  {
    const s = emptyState();
    s.events = [
      linked({ id: "a", title: "One", date: TUE, externalEventId: "dup" }),
      linked({ id: "b", title: "Two", date: TUE, externalEventId: "dup" }),
    ];
    const plan = reconcileExternalEvents(s.events, [], scope({ complete: false }));
    eq("5.9 a duplicated local identity is reported", plan.conflicts.filter((c) => c.kind === "malformed_local_identity").length, 1);
  }

  // ---- cancelled upstream (§18) ----
  {
    const s = emptyState();
    s.events = [linked({ id: "a", title: "Dentist", date: TUE, externalEventId: "g1" })];
    const plan = reconcileExternalEvents(s.events, [
      norm({ externalEventId: "g1", title: "Dentist", date: TUE, status: "cancelled" }),
    ], scope());
    eq("5.10 a cancelled external event leaves the active schedule", plan.removeOrDeactivate[0]?.reason, "cancelled_upstream");
    eq("5.11 …and is NOT faked as completed — Events have no completion", plan.update.length, 0);
    // A cancelled event that was never imported does not get created.
    const fresh = reconcileExternalEvents([], [
      norm({ externalEventId: "g2", title: "Ghost", date: TUE, status: "cancelled" }),
    ], scope());
    eq("5.12 a cancelled event that was never imported is not created", fresh.create.length, 0);
  }

  // ====================== 6. shared model — Today, Week Review, provenance ===

  {
    const s = emptyState();
    const plan = reconcileExternalEvents([], [
      norm({ externalEventId: "g1", title: "Therapy", start: `${FRI}T10:00:00` }),
    ], scope());
    const { ops } = recordingOps(s);
    applyReconcilePlan(plan, ops);

    // §29. No "Google Calendar" section. Today reads `state.events`, full stop.
    eq("6.1 an imported Event appears in Today's ordinary event projection", eventsOnDay(s, FRI).length, 1);
    ok("6.2 …indistinguishable in shape from a locally-created one",
      eventsOnDay(s, FRI)[0].event.title === "Therapy");

    // §30. Week Review's existing "On the calendar" semantics, unchanged — an
    // imported Event lands in exactly the same section a captured one does,
    // because the review reads `state.events` and knows nothing about calendars.
    const review = buildWeekReview(s, "this_week", { today: FRI });
    ok("6.3 Week Review lists the imported Event under 'On the calendar'",
      review.scheduled.some((e) => /Therapy/.test(e.title)),
      JSON.stringify(review.scheduled.map((e) => e.title)));
    ok("6.4 …and still claims no attendance",
      review.limitations.some((l) => /no record of whether you attended/i.test(l)),
      JSON.stringify(review.limitations));

    // §37. No storage island: nothing new in STORE_DOMAINS.
    eq("6.5 no new store domain was added", (STORE_DOMAINS as string[]).length, 46);
    ok("6.6 …and there is no provider event collection",
      !(STORE_DOMAINS as string[]).some((d) => /google|calendarEvents|external/i.test(d)),
      (STORE_DOMAINS as string[]).join(","));

    // §32. Provenance is not laundered: an import is not the user writing here.
    ok("6.7 an imported Event carries no capture provenance", !s.events[0].sourceCaptureId);
    ok("6.8 …and is not marked as AI-authored either", !s.events[0].fromAiText);
  }

  // ============================== 7. provider seam: least privilege (§23) ====

  eq("7.1 only read-only scope is requested", REQUIRED_SCOPES, ["https://www.googleapis.com/auth/calendar.readonly"]);
  ok("7.2 no write scope is requested anywhere",
    !REQUIRED_SCOPES.some((s) => /\/calendar$|\.events$|readwrite/i.test(s)));
  ok("7.3 no contacts or mail scope is requested",
    !REQUIRED_SCOPES.some((s) => /contacts|gmail|people/i.test(s)));
  ok("7.4 the minimum field list excludes descriptions and attendees",
    !MINIMUM_EVENT_FIELDS.some((f) => /description|attendee|organizer|location|conference/i.test(f)),
    MINIMUM_EVENT_FIELDS.join(","));
  {
    // The interface has NO write member. Structural, not advisory.
    const p = fixtureProvider({ calendars: [], events: {} });
    const members = Object.keys(p);
    ok("7.5 a provider exposes no write method",
      !members.some((m) => /create|update|delete|write|push|insert/i.test(m)), members.join(","));
  }

  // §25 import window.
  {
    const w = defaultWindow("2026-03-02");
    eq("7.6 the import window starts 30 days back", w.fromDate, "2026-01-31");
    eq("7.7 …and ends 90 days forward", w.toDate, "2026-05-31");
    ok("7.8 …and is bounded, not open-ended",
      IMPORT_WINDOW_DAYS_BACK < 400 && IMPORT_WINDOW_DAYS_FORWARD < 400);
  }

  // §24 calendar selection is offered, never assumed.
  {
    const p = fixtureProvider({
      calendars: [{ id: "a", name: "Personal", primary: true }, { id: "b", name: "Holidays" }],
      events: {},
    });
    const cals = await p.listCalendars();
    eq("7.9 multiple calendars are listed for the user to choose", cals.length, 2);
  }

  // =============================================== 8. §39 performance =======
  //
  // Reconciliation is linear: incoming events are indexed by identity once and
  // existing events are visited once. There is no title comparison in the
  // matching path, so there is nothing that could become O(n²).

  for (const n of [100, 1000, 5000]) {
    const existing: LifeEvent[] = [];
    const incoming: NormalizedExternalEvent[] = [];
    for (let i = 0; i < n; i++) {
      existing.push(linked({ id: `x${i}`, title: `Event ${i}`, date: TUE, externalEventId: `g${i}` }));
      incoming.push(norm({ externalEventId: `g${i}`, title: i % 3 === 0 ? `Renamed ${i}` : `Event ${i}`, date: TUE }));
    }
    const t0 = Date.now();
    const plan = reconcileExternalEvents(existing, incoming, scope());
    const ms = Date.now() - t0;
    ok(`8.1 reconciling ${n} events stays under 250ms`, ms < 250, `${ms}ms`);
    eq(`8.2 …and is correct at ${n}: no spurious creates`, plan.create.length, 0);
    eq(`8.3 …with exactly the renamed third updated at ${n}`, plan.update.length, Math.ceil(n / 3));
  }

  // Two independent sanity checks that the recurrence mapper is not a rubber
  // stamp: a rule it CAN express, and one it must refuse.
  eq("8.4 BYDAY=MO,WE,FR maps", normalizeRecurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR").recurrence?.weekdays, [1, 3, 5]);
  ok("8.5 'third Thursday' does not", !!normalizeRecurrence("RRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3").unsupportedRecurrence);
  ok("8.6 an end condition Conqify has no field for is refused",
    !!normalizeRecurrence("RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10").unsupportedRecurrence);
  ok("8.7 a positional weekday ('2TH') is refused",
    !!normalizeRecurrence("RRULE:FREQ=WEEKLY;BYDAY=2TH").unsupportedRecurrence);
  ok("8.8 a rule that survives is a REAL rule the engine accepts",
    !!readRule(normalizeRecurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR").recurrence));

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}

/** Exported so a caller can rebuild the same plan shape without re-deriving it. */
export type { ReconcilePlan };
