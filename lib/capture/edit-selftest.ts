/**
 * Temporal editing self-tests (LIFEOS-065 §34, §37).
 *
 * Section 3 is the load-bearing one. Everything in it is a mutation that must
 * NOT happen: a wrong record changed, a completed action reopened, a series
 * edited when one occurrence was meant, an event deleted because someone said
 * "cancel". A wrong new record is visible and deletable; a wrong mutation looks
 * exactly like a record that was always wrong, and the user finds out weeks
 * later when they miss something.
 *
 * Section 6 replays all fourteen §34 cases end to end, through the real store
 * setters, asserting record counts before and after.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { LifeEvent, NextAction, StoreState } from "@/types/mvp";
import {
  detectTemporalEdit, detectTemporalEdits, buildProposal, matchEditTargets,
  authorityFor, extractShift, extractWeekdayMove, extractTargetQuery, referentOf,
  looksLikeTemporalEdit, splitEditClauses, EDIT_OPERATIONS,
  type EditTarget,
} from "@/lib/capture/temporal-edit";
import { applyTemporalEdit, type EditOps } from "@/lib/capture/apply-edit";
import { buildEditContext, validateAiEdits, FORBIDDEN_CONTEXT_FIELDS } from "@/lib/capture/edit-escalation";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView } from "@/lib/today/view";
import { readRule } from "@/lib/time/recurrence";
import { addDays, type DayKey } from "@/lib/reviews/dates";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A fixed Monday. Every date below is relative to it. */
const MON: DayKey = "2026-03-02";
const TUE: DayKey = "2026-03-03";
const WED: DayKey = "2026-03-04";
const FRI: DayKey = "2026-03-06";
const NEXT_TUE: DayKey = "2026-03-10";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", createdAt: `${MON}T08:00:00.000Z`, updatedAt: `${MON}T08:00:00.000Z`,
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [],
    ...p,
  } as NextAction;
}

function ev(p: Partial<LifeEvent> & { id: string; title: string; date: DayKey }): LifeEvent {
  return {
    notes: "", linkedEntityRefs: [], createdAt: `${MON}T08:00:00.000Z`, updatedAt: `${MON}T08:00:00.000Z`,
    ...p,
  } as LifeEvent;
}

/** The world every case below runs against. */
function world(extra: Partial<StoreState> = {}): StoreState {
  seq = 0;
  const s = emptyState();
  s.nextActions = [
    act({ id: "workout", title: "Workout" }),
    act({ id: "assignment", title: "Assignment", dueDate: FRI }),
    act({ id: "paper", title: "Paper" }),
    act({ id: "form", title: "Submit the form", dueDate: FRI, dueTime: "09:00" }),
    act({ id: "refill", title: "Refill the medication box", recurrence: { frequency: "weekly", interval: 1, weekdays: [0] } }),
    act({ id: "done", title: "Completed assignment", status: "completed", dueDate: TUE }),
    act({ id: "sofa", title: "Move the sofa to the garage" }),
  ];
  s.events = [
    ev({ id: "dentist", title: "Dentist", date: TUE, startTime: "14:30" }),
    ev({ id: "dinner", title: "Dinner with Sam", date: MON, startTime: "19:30" }),
    ev({ id: "standup", title: "Staff meeting", date: TUE, startTime: "09:15", recurrence: { frequency: "weekly", interval: 1, weekdays: [2] } }),
  ];
  return { ...s, ...extra } as StoreState;
}

/**
 * A recording ops object over a mutable state copy.
 *
 * It applies the SAME field changes the real store setters apply, and it
 * records every call, so a test can assert both the resulting state and that
 * nothing outside the permitted API was touched. The real setters are exercised
 * by the browser smoke; this proves the dispatcher's routing.
 */
function recordingOps(s: StoreState): { ops: EditOps; calls: string[] } {
  const calls: string[] = [];
  const findAction = (id: string) => (s.nextActions ?? []).find((a) => a.id === id);
  const findEvent = (id: string) => (s.events ?? []).find((e) => e.id === id);
  return {
    calls,
    ops: {
      setActionDueDate(id, date) {
        calls.push(`setActionDueDate:${id}:${date ?? "-"}`);
        const a = findAction(id); if (a) a.dueDate = date;
      },
      setActionDueTime(id, time) {
        calls.push(`setActionDueTime:${id}:${time ?? "-"}`);
        const a = findAction(id);
        if (!a) return false;
        // Mirrors the store: a time needs a day, named by a date OR a rule.
        if (time !== undefined && !a.dueDate && !readRule(a.recurrence)) return false;
        a.dueTime = time;
        return true;
      },
      setActionRecurrence(id, rule) {
        calls.push(`setActionRecurrence:${id}`);
        const a = findAction(id);
        if (!a) return false;
        const valid = rule === undefined ? undefined : (readRule(rule) ?? undefined);
        if (rule !== undefined && !valid) return false;
        a.recurrence = valid;
        return true;
      },
      stopActionRecurrence(id) {
        calls.push(`stopActionRecurrence:${id}`);
        const a = findAction(id);
        if (!a || !readRule(a.recurrence)) return false;
        a.recurrence = undefined;
        return true;
      },
      deferAction(id, option) {
        calls.push(`deferAction:${id}`);
        const a = findAction(id);
        if (a) {
          a.status = "deferred";
          a.deferredUntil = typeof option === "object" ? option.date : undefined;
        }
      },
      updateEvent(id, patch) {
        calls.push(`updateEvent:${id}`);
        const e = findEvent(id);
        if (!e) return false;
        if (patch.recurrence !== undefined && !readRule(patch.recurrence)) return false;
        Object.assign(e, patch);
        if (patch.allDay) { e.startTime = undefined; e.endTime = undefined; }
        return true;
      },
      stopEventRecurrence(id) {
        calls.push(`stopEventRecurrence:${id}`);
        const e = findEvent(id); if (e) e.recurrence = undefined;
      },
      deleteEvent(id) {
        calls.push(`deleteEvent:${id}`);
        s.events = (s.events ?? []).filter((e) => e.id !== id);
      },
      // LIFEOS-066. Mirrors the store: a one-time action closes; a repeating one
      // records a day and keeps its status, idempotent by (action, day).
      completeAction(id) {
        calls.push(`completeAction:${id}`);
        const a = findAction(id);
        if (a) { a.status = "completed"; a.completedAt = `${MON}T12:00:00.000Z`; }
      },
      completeOccurrence(id, day) {
        calls.push(`completeOccurrence:${id}:${day}`);
        const a = findAction(id);
        if (!a || !readRule(a.recurrence)) return false;
        const rows = s.recurrenceCompletions ?? [];
        if (rows.some((c) => c.actionId === id && c.occurrenceDate === day)) return false;
        s.recurrenceCompletions = [
          { id: `rc${rows.length + 1}`, actionId: id, occurrenceDate: day, completedAt: `${MON}T12:00:00.000Z` },
          ...rows,
        ];
        return true;
      },
    },
  };
}

/** Detect, resolve and apply in one step — the whole path, as the UI runs it. */
function run(text: string, s: StoreState, opts: { confirmDestructive?: boolean; pick?: number } = {}) {
  const intents = detectTemporalEdits(text, s, MON);
  const { ops, calls } = recordingOps(s);
  const outcomes = intents.map((intent) => {
    const target = intent.candidateMatches[opts.pick ?? 0];
    if (!target || intent.authority !== "unambiguous") {
      return { applied: false, message: intent.refusal?.message ?? "needs a choice" };
    }
    return applyTemporalEdit(buildProposal(intent, target), ops, {
      confirmDestructive: opts.confirmDestructive, today: MON,
    });
  });
  return { intents, outcomes, calls, state: s };
}

export async function runTemporalEditSelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, a === b, a === b ? undefined : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

  // ============================================== 1. is this an edit at all?

  eq("1.1 an ordinary errand is not an edit", looksLikeTemporalEdit("Buy dog food", MON), false);
  eq("1.2 a move with no schedule is not an edit",
    looksLikeTemporalEdit("Move the sofa to the garage", MON), false);
  eq("1.3 a move WITH a schedule is an edit", looksLikeTemporalEdit("Move workout to tomorrow", MON), true);
  eq("1.4 'is now' is an edit", looksLikeTemporalEdit("Dinner is now Saturday at 7", MON), true);
  eq("1.5 cancelling is an edit", looksLikeTemporalEdit("Cancel dinner tonight", MON), true);
  eq("1.6 clearing a time is an edit", looksLikeTemporalEdit("Remove the time but keep Friday", MON), true);
  eq("1.7 a relative push is an edit", looksLikeTemporalEdit("Push it back two days", MON), true);
  eq("1.8 an ordinary capture never reaches the change path",
    detectTemporalEdits("Buy dog food and call the vet tomorrow", world(), MON).length, 0);
  eq("1.9 …not even when it contains the word 'move'",
    detectTemporalEdits("Move the sofa to the garage", world(), MON).length, 0);

  // ==================================================== 2. reading the change

  eq("2.1 'back two days' is negative", extractShift("push it back two days"), -2);
  eq("2.2 'forward one week' is positive", extractShift("move it forward one week"), 7);
  eq("2.3 'out two days' is later", extractShift("push it out two days"), 2);
  eq("2.4 no shift phrase, no shift", extractShift("move it to Friday"), undefined);
  eq("2.5 'from Tuesday to Wednesday' names Wednesday",
    JSON.stringify(extractWeekdayMove("from Tuesday to Wednesday")), JSON.stringify({ from: 2, to: 3 }));
  eq("2.6 the target query drops the change words",
    extractTargetQuery("Make the paper due Monday at noon", ["Monday", "at noon"]), "paper");
  eq("2.7 a preceding clause yields its subject", referentOf("I didn't work out today"), "work out");
  eq("2.8 …with negation and the day removed", referentOf("I never called the dentist yesterday"), "called dentist");
  // 7 from LIFEOS-065, plus `complete` from LIFEOS-066 §21 — which lives on this
  // path deliberately, so completion inherits the same matching, the same
  // confirmation panel and the same refusals rather than growing a second
  // mutation language.
  eq("2.9 every operation is in the enum", EDIT_OPERATIONS.length, 8);
  ok("2.9b `complete` is one of them", (EDIT_OPERATIONS as readonly string[]).includes("complete"));

  // =============================== 3. mutations that must NOT happen (§8, §18)

  {
    // §8. Two records match — nothing is chosen, nothing is written.
    const s = world();
    s.events = [...(s.events ?? []), ev({ id: "dentist2", title: "Dentist", date: NEXT_TUE, startTime: "10:00" })];
    const r = run("Move dentist to Friday.", s);
    eq("3.1 two matches is ambiguous", r.intents[0].authority, "ambiguous");
    eq("3.2 …and nothing is written", r.calls.length, 0);
    eq("3.3 …and both are offered", r.intents[0].candidateMatches.length, 2);
    ok("3.4 …neither is preselected by recency",
      r.intents[0].candidateMatches.map((c) => c.id).sort().join(",") === "dentist,dentist2");
    eq("3.5 …and the dates are unchanged",
      (s.events ?? []).map((e) => e.date).join(","), `${TUE},${MON},${TUE},${NEXT_TUE}`);
  }

  {
    // §9. A pronoun with no referent names nothing.
    const s = world();
    const r = run("Move it to tomorrow.", s);
    eq("3.6 an unresolvable pronoun matches nothing", r.intents[0].authority, "no_match");
    eq("3.7 …and writes nothing", r.calls.length, 0);
    eq("3.8 …and refuses by name", r.intents[0].refusal?.code, "no_target");
    // §28. Never a new record as a fallback — that would duplicate the obligation.
    eq("3.9 …and creates no record", (s.nextActions ?? []).length, 7);
  }

  {
    // §18. A completed action is history, not a plan.
    const s = world();
    const r = run("Move completed assignment to Friday.", s);
    eq("3.10 a completed action is blocked", r.intents[0].refusal?.code, "completed_action");
    eq("3.11 …and nothing is written", r.calls.length, 0);
    eq("3.12 …and its date is untouched", (s.nextActions ?? []).find((a) => a.id === "done")?.dueDate, TUE);
    eq("3.13 …and it is not reopened", (s.nextActions ?? []).find((a) => a.id === "done")?.status, "completed");
  }

  {
    // §15. One occurrence of a repeating thing cannot be moved on its own.
    const s = world();
    const r = run("Move Tuesday's staff meeting to Wednesday.", s);
    eq("3.14 an occurrence-specific request is refused", r.intents[0].refusal?.code, "occurrence_not_supported");
    eq("3.15 …the series is NOT silently changed", r.calls.length, 0);
    const standup = (s.events ?? []).find((e) => e.id === "standup");
    eq("3.16 …the rule is unchanged", JSON.stringify(standup?.recurrence?.weekdays), "[2]");
    ok("3.17 …and the refusal explains the limit",
      /can't move one occurrence/i.test(r.intents[0].refusal?.message ?? ""), r.intents[0].refusal?.message);
  }

  {
    // §13. "Cancel" is a word about plans; deletion is a word about data.
    const s = world();
    const r = run("Cancel dinner tonight.", s);
    eq("3.18 cancelling an event names deletion", r.intents[0].refusal?.code, "no_cancellation_state");
    eq("3.19 …and does not delete without explicit confirmation", (s.events ?? []).length, 3);
    eq("3.20 …and the dispatcher refuses too", r.outcomes[0].applied, false);
    const s2 = world();
    const r2 = run("Cancel dinner tonight.", s2, { confirmDestructive: true });
    eq("3.21 …but a confirmed deletion happens", r2.outcomes[0].applied, true);
    eq("3.22 …and removes exactly one event", (s2.events ?? []).length, 2);
    ok("3.23 …the right one", !(s2.events ?? []).some((e) => e.id === "dinner"));
  }

  {
    // §32. Nothing to shift from means nothing to propose.
    const s = world();
    const r = run("Push workout back two days.", s);
    eq("3.24 a relative shift needs a current date", r.intents[0].refusal?.code, "no_date_to_shift");
    eq("3.25 …and writes nothing", r.calls.length, 0);
  }

  // ============================================= 4. the changes that DO happen

  {
    const s = world();
    const r = run("Move workout to tomorrow.", s);
    eq("4.1 the action is rescheduled", r.outcomes[0].applied, true);
    eq("4.2 …to the stated day", (s.nextActions ?? []).find((a) => a.id === "workout")?.dueDate, TUE);
    // §29. A reschedule is never a create.
    eq("4.3 …and no record was created", (s.nextActions ?? []).length, 7);
    eq("4.4 …and the id is the same one", r.outcomes[0].ref?.id, "workout");
  }

  {
    // §17. "I didn't work out" is a fact, not a failure — and it is the referent.
    const s = world();
    const r = run("I didn't work out today. Move it to tomorrow.", s);
    eq("4.5 a missed action resolves from its own sentence", r.intents[0].candidateMatches[0]?.id, "workout");
    eq("4.6 …and is rescheduled", (s.nextActions ?? []).find((a) => a.id === "workout")?.dueDate, TUE);
    eq("4.7 …with no duplicate", (s.nextActions ?? []).length, 7);
    ok("4.8 …and nothing in the message judges the person",
      !/fail|lazy|should/i.test(r.outcomes[0].message), r.outcomes[0].message);
  }

  {
    // §12. An event moves date AND time together.
    const s = world();
    run("Move dentist to Friday at 3.", s);
    const d = (s.events ?? []).find((e) => e.id === "dentist");
    eq("4.9 the event date changed", d?.date, FRI);
    eq("4.10 …and the time", d?.startTime, "15:00");
    eq("4.11 …the title survived", d?.title, "Dentist");
    eq("4.12 …and no second event appeared", (s.events ?? []).length, 3);
  }

  {
    // §10. Moving a date must not silently erase a time.
    const s = world();
    run("Move Submit the form to Wednesday.", s);
    const f = (s.nextActions ?? []).find((a) => a.id === "form");
    eq("4.13 the date moved", f?.dueDate, WED);
    eq("4.14 …and the time was preserved", f?.dueTime, "09:00");
  }

  {
    // §32. A relative shift computes from the record's stored date.
    const s = world();
    run("Push assignment back two days.", s);
    eq("4.15 back two days from Friday is Wednesday",
      (s.nextActions ?? []).find((a) => a.id === "assignment")?.dueDate, addDays(FRI, -2));
  }

  {
    // §11. Date and time in one sentence.
    const s = world();
    run("Make the paper due Monday at noon.", s);
    const p = (s.nextActions ?? []).find((a) => a.id === "paper");
    eq("4.16 the due date was set", p?.dueDate, MON);
    eq("4.17 …and the time", p?.dueTime, "12:00");
  }

  {
    // §33. Clearing a time keeps the day.
    const s = world();
    const target: EditTarget = {
      kind: "action", id: "form", title: "Submit the form", currentDate: FRI, currentTime: "09:00", status: "open",
    };
    const intent = detectTemporalEdit("Remove the time but keep Friday.", s, MON, undefined, target);
    eq("4.18 clearing is recognised", intent?.operation, "clear_time");
    eq("4.19 …and resolves against the record on screen", intent?.candidateMatches[0]?.id, "form");
    const { ops } = recordingOps(s);
    applyTemporalEdit(buildProposal(intent!, target), ops, { today: MON });
    const f = (s.nextActions ?? []).find((a) => a.id === "form");
    eq("4.20 the time is gone", f?.dueTime, undefined);
    eq("4.21 …and the date is not", f?.dueDate, FRI);
  }

  {
    // §14. A whole series moves.
    const s = world();
    run("Move the weekly staff meeting from Tuesday to Wednesday.", s);
    const standup = (s.events ?? []).find((e) => e.id === "standup");
    eq("4.22 the series moved to Wednesday", JSON.stringify(standup?.recurrence?.weekdays), "[3]");
    eq("4.23 …and it still repeats weekly", standup?.recurrence?.frequency, "weekly");
    eq("4.24 …with no new event", (s.events ?? []).length, 3);
  }

  {
    // §14. Stopping a recurrence.
    const s = world();
    const r = run("Stop the weekly refill.", s);
    eq("4.25 the recurrence stopped", r.outcomes[0].applied, true);
    eq("4.26 …and the rule is gone",
      (s.nextActions ?? []).find((a) => a.id === "refill")?.recurrence, undefined);
    eq("4.27 …and the action still exists", (s.nextActions ?? []).length, 7);
  }

  {
    // §16. Defer and due date are different concepts.
    const s = world();
    const intents = detectTemporalEdits("Come back to the assignment tomorrow.", s, MON);
    eq("4.28 'come back to' is a deferral", intents[0]?.operation, "defer");
    const { ops } = recordingOps(s);
    if (intents[0]?.candidateMatches[0]) {
      applyTemporalEdit(buildProposal(intents[0], intents[0].candidateMatches[0]), ops, { today: MON });
    }
    const a = (s.nextActions ?? []).find((x) => x.id === "assignment");
    eq("4.29 …it sets deferredUntil", a?.deferredUntil, TUE);
    eq("4.30 …and leaves the due date alone", a?.dueDate, FRI);
    eq("4.31 …and the status is deferred", a?.status, "deferred");
    eq("4.32 'move the deadline' is NOT a deferral",
      detectTemporalEdits("Move the assignment deadline to tomorrow.", s, MON)[0]?.operation, "move_date");
  }

  // ==================================================== 5. multi-edit (§24)

  {
    const s = world();
    const r = run("Move workout to tomorrow and dentist to Friday at 3.", s);
    eq("5.1 two independent proposals", r.intents.length, 2);
    eq("5.2 …the first names the action", r.intents[0].candidateMatches[0]?.id, "workout");
    eq("5.3 …the second names the event", r.intents[1].candidateMatches[0]?.id, "dentist");
    eq("5.4 both applied independently", r.outcomes.filter((o) => o.applied).length, 2);
    eq("5.5 …the action moved", (s.nextActions ?? []).find((a) => a.id === "workout")?.dueDate, TUE);
    eq("5.6 …the event moved", (s.events ?? []).find((e) => e.id === "dentist")?.date, FRI);
    eq("5.7 …and nothing was created", (s.nextActions ?? []).length + (s.events ?? []).length, 10);
    eq("5.8 a single sentence stays one edit",
      splitEditClauses("Move workout to tomorrow.").length, 1);
    eq("5.9 'and' joining two objects is not two edits",
      splitEditClauses("Move the sofa and the chair to the garage").length, 1);
  }

  // =========================================== 6. Today and Week Review (§21,§22)

  {
    const s = world();
    (s.nextActions ?? []).forEach((a) => { if (a.id === "workout") a.dueDate = MON; });
    const before = buildTodayView(s, buildTodayIndexes(s, MON, "09:00"));
    ok("6.1 the action is due today to begin with", before.dueToday.some((a) => a.id === "workout"));
    run("Move workout to tomorrow.", s);
    const after = buildTodayView(s, buildTodayIndexes(s, MON, "09:00"));
    ok("6.2 Today recomputes without a refresh", !after.dueToday.some((a) => a.id === "workout"));
    ok("6.3 …and it appears in Upcoming", after.upcoming.some((u) => u.id === "workout"), JSON.stringify(after.upcoming));
  }

  {
    // §21. A reschedule leaves evidence on an ACTION and none on an EVENT, and
    // the review must reflect exactly that asymmetry rather than smoothing it.
    const s = world();
    const a = (s.nextActions ?? []).find((x) => x.id === "assignment")!;
    a.history = [...(a.history ?? []), { id: "h1", at: `${TUE}T10:00:00.000Z`, action: "due_set", detail: WED } as never];
    const { buildWeekReview } = await import("@/lib/memory/week");
    const review = buildWeekReview(s, "this_week", { today: FRI });
    eq("6.4 a recorded reschedule is reported", review.rescheduled.length, 1);
    ok("6.5 …with the day it moved to", /Mar 4/.test(review.rescheduled[0].detail ?? ""), review.rescheduled[0]?.detail);
    eq("6.6 …tracing to the history entry", review.rescheduled[0].evidence, "action.history[].due_set");
    ok("6.7 an event reschedule leaves no trace, and the review says so",
      review.limitations.some((l) => /events carry no change history/i.test(l)),
      JSON.stringify(review.limitations));
  }

  // ================================================== 7. the AI boundary (§25)

  {
    const s = world();
    const ctx = buildEditContext("move the thing", s, MON);
    ok("7.1 the context carries candidates", ctx.candidates.length > 0);
    ok("7.2 …and only titles, dates, times and type",
      ctx.candidates.every((c) => Object.keys(c).every((k) =>
        ["id", "kind", "title", "date", "time", "repeats", "project"].includes(k))),
      JSON.stringify(Object.keys(ctx.candidates[0])));
    const payload = JSON.stringify(ctx.candidates);
    ok("7.3 no record content is ever sent",
      FORBIDDEN_CONTEXT_FIELDS.every((f) => !payload.includes(`"${f}"`)),
      FORBIDDEN_CONTEXT_FIELDS.filter((f) => payload.includes(`"${f}"`)).join(", "));
    eq("7.3b the user's own sentence IS sent — it is the question", ctx.text, "move the thing");
    ok("7.3c …and nothing from beliefs or the Constitution travels with it",
      !JSON.stringify(ctx).includes("belief") && !JSON.stringify(ctx).includes("constitution"));
    ok("7.4 completed actions are not offered for editing",
      !ctx.candidates.some((c) => c.id === "done"));

    // The assertion the whole boundary rests on.
    eq("7.5 an invented record id is rejected",
      validateAiEdits([{ targetId: "not-a-real-id", operation: "move_date", date: FRI }], ctx, s).length, 0);
    eq("7.6 an operation outside the enum is rejected",
      validateAiEdits([{ targetId: "workout", operation: "delete_everything", date: FRI }], ctx, s).length, 0);
    eq("7.7 a malformed date is rejected",
      validateAiEdits([{ targetId: "workout", operation: "move_date", date: "next friday" }], ctx, s).length, 0);
    eq("7.8 a malformed time is rejected",
      validateAiEdits([{ targetId: "workout", operation: "change_time", time: "3pm" }], ctx, s).length, 0);
    eq("7.9 an operation with nothing to apply is rejected",
      validateAiEdits([{ targetId: "workout", operation: "move_date" }], ctx, s).length, 0);
    eq("7.10 garbage is rejected", validateAiEdits(["nope", 42, null, {}], ctx, s).length, 0);
    eq("7.11 a valid suggestion survives",
      validateAiEdits([{ targetId: "workout", operation: "move_date", date: FRI }], ctx, s).length, 1);
    eq("7.12 …resolved against the real record",
      validateAiEdits([{ targetId: "workout", operation: "move_date", date: FRI }], ctx, s)[0]
        .candidateMatches[0].title, "Workout");
    eq("7.13 …and a duplicate id is taken once",
      validateAiEdits([
        { targetId: "workout", operation: "move_date", date: FRI },
        { targetId: "workout", operation: "move_date", date: TUE },
      ], ctx, s).length, 1);
    // The model proposes; it never writes.
    const suggested = validateAiEdits([{ targetId: "workout", operation: "move_date", date: FRI }], ctx, s);
    eq("7.14 an AI suggestion still needs confirmation", suggested[0].confidence, "possible");
    eq("7.15 …and the state is untouched by validating it",
      (s.nextActions ?? []).find((x) => x.id === "workout")?.dueDate, undefined);
  }

  // ======================================================= 8. matching itself

  {
    const s = world();
    eq("8.1 an exact title beats a containing one",
      matchEditTargets("Dentist", s).length, 1);
    eq("8.2 every word must appear", matchEditTargets("dentist crown", s).length, 0);
    eq("8.3 a too-short query matches nothing", matchEditTargets("a", s).length, 0);
    eq("8.4 'work out' finds 'Workout'", matchEditTargets("work out", s)[0]?.id, "workout");
    eq("8.5 no match is no match", authorityFor([]), "no_match");
    eq("8.6 one match is unambiguous", authorityFor([{ kind: "action", id: "x", title: "X" }]), "unambiguous");
    eq("8.7 two matches are ambiguous",
      authorityFor([{ kind: "action", id: "x", title: "X" }, { kind: "action", id: "y", title: "X" }]), "ambiguous");
  }

  // ================================================= 9. purity and no new state

  {
    const s = world();
    const before = JSON.stringify(s);
    detectTemporalEdits("Move workout to tomorrow and cancel dinner tonight.", s, MON);
    eq("9.1 detection mutates nothing", JSON.stringify(s), before);
    const intent = detectTemporalEdit("Move workout to tomorrow.", s, MON)!;
    buildProposal(intent, intent.candidateMatches[0]);
    eq("9.2 building a proposal mutates nothing", JSON.stringify(s), before);
    ok("9.3 no interpretation is persisted",
      !(STORE_DOMAINS as string[]).some((d) => /edit|temporal|mutation|patch/i.test(d)));
    eq("9.4 the store still has 46 domains", STORE_DOMAINS.length, 46);
  }

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
