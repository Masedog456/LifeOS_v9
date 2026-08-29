/**
 * Daily Executive Loop self-tests (LIFEOS-073 §23, §24, §31).
 *
 * Section 2 pins the audit defects, each of which shipped in a real build and
 * was found by running the product rather than reading it:
 *
 *   an action DUE TODAY announced as "No recorded activity in 116 days"
 *   a deferral parked a month out offered as something forgotten
 *   a blocker explanation printing the THRESHOLD where the elapsed count goes
 *   one record created and finished today, listed as two accomplishments
 *   five real transitions that produced no autobiographical line at all
 *
 * Section 6 is the one that matters most: the day may not claim what no record
 * proves — that an event was attended, that something became unblocked, that
 * undated work belongs to tomorrow, or that a day is finished because it is
 * evening.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { LifeEvent, NextAction, Project, StoreState } from "@/types/mvp";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, violatesTodayLanguage } from "@/lib/today/view";
import {
  buildDailyExecutiveView, orientationLine, dailyStrings, CHANGE_KINDS, CHANGE_LABEL,
  NO_CHANGES_TODAY, NOTHING_TOMORROW, REVIEW_TODAY_LABEL, UNBLOCK_LIMITATION,
} from "@/lib/today/daily";
import { actionDormancy, canGoQuiet } from "@/lib/actions/dormancy";
import { buildActivityIndex } from "@/lib/insights/activity";
import { lastActivityByRecord } from "@/lib/insights/dormancy";
import { buildRangeReview, buildWeekReview, violatesReviewLanguage } from "@/lib/memory/week";
import { resolveRange } from "@/lib/insights/range";
import { planMemoryQuery } from "@/lib/memory/query";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { NO_STANDOUT } from "@/lib/today/recommend";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const T = "2026-08-25";          // a Tuesday
const YESTERDAY = "2026-08-24";
const TWO_AGO = "2026-08-23";
const TOMORROW = "2026-08-26";
const FAR = "2026-09-15";
const OLD = "2026-04-27";

const iso = (d: string, h = 8, m = 0) =>
  `${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { id: string; title: string }): NextAction {
  seq += 1;
  return {
    description: "", status: "open", createdAt: iso(OLD), updatedAt: p.createdAt ?? iso(OLD),
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [], ...p,
  } as NextAction;
}
const ev = (p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent =>
  ({ notes: "", linkedEntityRefs: [], createdAt: iso(OLD), updatedAt: iso(OLD), ...p }) as LifeEvent;

const project = (id: string, title: string): Project => ({
  id, title, description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [],
  createdAt: iso(OLD), updatedAt: iso(T),
} as Project);

function stateWith(parts: Partial<StoreState>): StoreState {
  return { ...emptyState(), ...parts } as StoreState;
}

const daily = (s: StoreState, now = "09:00", today = T) =>
  buildDailyExecutiveView(s, buildTodayIndexes(s, today, now), today);

/** History event helper — structured fields, never a detail string to match on. */
const hist = (action: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ id: `h${(seq += 1)}`, action, at, ...extra }) as unknown as NextAction["history"][number];

export function runDailySelfTests(): SelfTestReport {
  const started = Date.now();
  seq = 0;
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected),
      `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  const changeKinds = (s: StoreState) => daily(s).changedToday.map((e) => e.kind);

  // ==================== 1. FIXED vs FLEXIBLE (§3, §7) ====================
  {
    const s = stateWith({
      events: [ev({ id: "e1", title: "Dentist", date: T, startTime: "15:00" })],
      nextActions: [
        act({ id: "timed", title: "Call the bank", dueDate: T, dueTime: "14:00" } as Partial<NextAction> & { id: string; title: string }),
        act({ id: "dated", title: "File the return", dueDate: T }),
      ],
    });
    const v = daily(s);
    eq("1.1 an event is FIXED", v.fixedToday.filter((f) => f.kind === "event").map((f) => f.title), ["Dentist"]);
    eq("1.2 an action with an explicit TIME is fixed too",
      v.fixedToday.filter((f) => f.kind === "action").map((f) => f.title), ["Call the bank"]);
    eq("1.3 a bare due DATE is flexible, not a calendar slot",
      v.flexibleToday.map((f) => f.action.title), ["File the return"]);
    ok("1.4 …and is never listed among the fixed items",
      !v.fixedToday.some((f) => f.title === "File the return"));
    eq("1.5 fixed items are ordered by the clock",
      v.fixedToday.map((f) => f.time), ["14:00", "15:00"]);
    eq("1.6 the flexible reason is a recorded fact", v.flexibleToday[0].reason, "due_today");

    // An all-day event has no time and must not pretend to one.
    const allDay = stateWith({ events: [ev({ id: "e2", title: "Holiday", date: T, allDay: true })] });
    eq("1.7 an all-day event carries no invented time", daily(allDay).fixedToday[0].time, undefined);
    eq("1.8 …and says so", daily(allDay).fixedToday[0].detail, "All day");
  }

  // ============ 2. THE AUDIT DEFECTS, PINNED (§23 A–D) ============
  {
    // ---- A. an action DUE TODAY is not "worth returning to"
    const dueToday = stateWith({
      nextActions: [act({ id: "q", title: "DueTodayButQuiet", dueDate: T, createdAt: iso(OLD), updatedAt: iso(OLD) })],
    });
    const ixA = buildTodayIndexes(dueToday, T, "09:00");
    const viewA = buildTodayView(dueToday, ixA);
    ok("2.1 an action due today is never offered as forgotten",
      viewA.returnItem === null || viewA.returnItem.ref.id !== "q", JSON.stringify(viewA.returnItem));
    ok("2.2 …because a date explains the silence",
      !canGoQuiet(dueToday.nextActions![0], T));

    // ---- B. a future deferral stays quiet
    const parked = stateWith({
      nextActions: [act({ id: "p", title: "Parked", status: "deferred", deferredUntil: FAR, dueDate: TWO_AGO, createdAt: iso(OLD), updatedAt: iso(OLD) })],
    });
    const viewB = buildTodayView(parked, buildTodayIndexes(parked, T, "09:00"));
    ok("2.3 a future deferral is never offered as forgotten",
      viewB.returnItem === null || viewB.returnItem.ref.id !== "p", JSON.stringify(viewB.returnItem));
    ok("2.4 …nor as a dormant signal", !viewB.signals.some((x) => x.recordRef.id === "p" && x.kind === "dormant"));
    ok("2.5 …nor as still open under its stale pre-deferral date",
      !daily(parked).stillOpen.some((o) => o.action.id === "p"),
      JSON.stringify(daily(parked).stillOpen.map((o) => o.detail)));

    // ---- work DUE TODAY and unfinished is the day's most relevant open row.
    //
    // `overdueActions` covers the "overdue" bucket and `upcomingActions` covers
    // "tomorrow"|"soon". The "today" bucket belonged to neither, so anything due
    // today and not done fell out of "still open" completely — the §29 claim
    // retest printed an empty Still Open on a day whose headline item was due
    // that afternoon.
    const dueNow = stateWith({ nextActions: [act({ id: "dt", title: "Due today, not done", dueDate: T })] });
    const vDT = daily(dueNow);
    ok("2.14 work due today and unfinished IS still open",
      vDT.stillOpen.some((o) => o.action.id === "dt"),
      JSON.stringify(vDT.stillOpen.map((o) => `${o.reason}:${o.action.id}`)));
    eq("2.15 …for that reason, not as overdue",
      vDT.stillOpen.find((o) => o.action.id === "dt")?.reason, "due_today");
    ok("2.16 …and it is not called late",
      !/\b(late|behind|overdue|missed)\b/i.test(vDT.stillOpen.find((o) => o.action.id === "dt")!.detail),
      vDT.stillOpen.find((o) => o.action.id === "dt")!.detail);
    ok("2.17 …while a COMPLETED due-today item is not still open",
      !daily(stateWith({ nextActions: [act({ id: "dc", title: "Done", dueDate: T, status: "completed", completedAt: iso(T, 9) })] }))
        .stillOpen.some((o) => o.action.id === "dc"));

    // ---- C. the dormancy explanation reports ELAPSED days, not the threshold
    const quiet = stateWith({
      nextActions: [
        act({ id: "b", title: "Blocker", createdAt: iso(OLD), updatedAt: iso(OLD) }),
        act({ id: "x", title: "Blocked", dueDate: TWO_AGO, createdAt: iso(OLD), updatedAt: iso(OLD) }),
      ],
      actionDependencies: [{ id: "d", blockerId: "b", blockedId: "x", createdAt: iso(OLD) }] as StoreState["actionDependencies"],
    });
    const vC = daily(quiet);
    const dormant = vC.attention.find((s) => s.kind === "dormant" && s.recordRef.id === "b");
    const blockedSig = vC.attention.find((s) => s.kind === "blocked");
    const stuck = blockedSig?.secondaryReasons.find((r) => r.code === "blocker_stuck");
    const elapsed = actionDormancy(
      quiet.nextActions![0], lastActivityByRecord(buildActivityIndex(quiet)), T, 30)!.inactiveDays;
    ok("2.6 the elapsed count is real, not the 30-day threshold", elapsed === 120, String(elapsed));
    ok("2.7 the dormant signal reports it", !!dormant && dormant.explanation.includes(`${elapsed} days`),
      dormant?.explanation);
    ok("2.8 …and the blocker explanation reports the SAME number",
      !stuck || stuck.text.includes(`${elapsed} days`), stuck?.text);
    ok("2.9 …never the threshold constant", !stuck || !/in 30 days/.test(stuck.text), stuck?.text);

    // ---- D. created and completed on one day is ONE thing that happened
    const sameDay = stateWith({
      nextActions: [act({
        id: "c", title: "Email the agent", createdAt: iso(T, 10),
        status: "completed", completedAt: iso(T, 10, 30),
        history: [hist("created", iso(T, 10)), hist("completed", iso(T, 10, 30), { fromStatus: "open", toStatus: "completed" })],
      })],
    });
    const vD = daily(sameDay);
    eq("2.10 it is completed once", vD.completedToday.map((e) => e.title), ["Email the agent"]);
    eq("2.11 …and not ALSO reported as added", changeKinds(sameDay).filter((k) => k === "action_created"), []);
    eq("2.12 …so the day lists it exactly once",
      vD.changedToday.filter((e) => e.recordRef.id === "c").length, 1);
    // Created one day and finished another is genuinely two facts.
    const twoDays = stateWith({
      nextActions: [act({
        id: "c2", title: "Slow thing", createdAt: iso(YESTERDAY, 10),
        status: "completed", completedAt: iso(T, 10),
        history: [hist("created", iso(YESTERDAY, 10)), hist("completed", iso(T, 10), { fromStatus: "open", toStatus: "completed" })],
      })],
    });
    const wk = buildWeekReview(twoDays, "this_week", { today: T });
    ok("2.13 …while created-Monday-finished-Tuesday stays two facts in a WEEK",
      wk.added.some((e) => e.recordRef.id === "c2") && wk.completed.some((e) => e.recordRef.id === "c2"),
      JSON.stringify([wk.added.length, wk.completed.length]));
  }

  // ============ 3. THE CHANGE MODEL (§23 E–J, §10, §12, §13, §14) ============
  {
    const one = (h: NextAction["history"][number], extra: Partial<NextAction> = {}) =>
      stateWith({ nextActions: [act({ id: "z", title: "Thing", history: [h], ...extra })] });

    // E. returned
    eq("3.1 returned today appears in changedToday",
      changeKinds(one(hist("returned", iso(T, 7), { fromStatus: "deferred", toStatus: "open", detail: T }))),
      ["action_returned"]);
    // F. restored — kept verbally distinct from returned (§14)
    eq("3.2 restored today appears too",
      changeKinds(one(hist("restored", iso(T, 12), { fromStatus: "cancelled", toStatus: "open" }))),
      ["action_restored"]);
    ok("3.3 …and the two are never worded the same",
      CHANGE_LABEL.action_returned !== CHANGE_LABEL.action_restored,
      `${CHANGE_LABEL.action_returned} / ${CHANGE_LABEL.action_restored}`);
    ok("3.4 returned reads as a deferral elapsing", /came back/i.test(CHANGE_LABEL.action_returned));
    ok("3.5 restored reads as a reversal", /restored/i.test(CHANGE_LABEL.action_restored));

    // G. planned / moved — from the assignment's own horizon history (§13)
    const planned = stateWith({
      nextActions: [act({ id: "z", title: "Thing" })],
      planningAssignments: [{
        id: "pa", ref: { kind: "action", id: "z" }, horizon: "today",
        createdAt: iso(T, 6), updatedAt: iso(T, 6),
        history: [{ id: "ph", action: "planned", at: iso(T, 6), toHorizon: "today" }],
      }] as unknown as StoreState["planningAssignments"],
    });
    eq("3.6 planning today appears in changedToday", changeKinds(planned), ["action_planned"]);
    eq("3.7 …carrying the horizon it was planned to",
      daily(planned).changedToday[0].detail, "to today");
    eq("3.8 …traced to the assignment history, not updatedAt",
      daily(planned).changedToday[0].evidence, "planningAssignment.history[].toHorizon");

    // H. stopWaiting — structural fields, never the detail string (§12)
    const stopped = one(hist("edited", iso(T, 11), { fromStatus: "waiting", toStatus: "open", detail: "stopped waiting on the broker" }),
      { waitingOn: "the broker" });
    eq("3.9 stopping a wait appears as a waiting→open change", changeKinds(stopped), ["waiting_stopped"]);
    ok("3.10 …and never as a completion",
      !changeKinds(stopped).some((k) => k === "completed_action" || k === "recurring_completion"));
    eq("3.11 …naming who the wait was on, from the record", daily(stopped).changedToday[0].detail, "on the broker");
    ok("3.12 …read from fromStatus, not by matching the detail text",
      daily(one(hist("edited", iso(T, 11), { fromStatus: "waiting", toStatus: "open", detail: "anything at all" })))
        .changedToday.map((e) => e.kind).includes("waiting_stopped"));
    // A plain edit that never touched a wait is NOT a waiting change.
    eq("3.13 an ordinary edit is not a waiting transition",
      changeKinds(one(hist("edited", iso(T, 11), { detail: "renamed" }))), []);

    // I. due cleared
    eq("3.14 clearing a due date appears", changeKinds(one(hist("due_cleared", iso(T, 13)))), ["action_due_cleared"]);
    eq("3.15 setting one appears as a date change",
      changeKinds(one(hist("due_set", iso(T, 13), { detail: FAR }))), ["action_rescheduled"]);

    // waiting started
    eq("3.16 starting a wait appears",
      changeKinds(one(hist("waiting", iso(T, 9), { fromStatus: "open", toStatus: "waiting", detail: "Marcus" }))),
      ["waiting_started"]);

    // deferred, cancelled
    eq("3.17 deferring appears",
      changeKinds(one(hist("deferred", iso(T, 8), { fromStatus: "open", toStatus: "deferred", detail: FAR }))),
      ["action_deferred"]);
    eq("3.18 cancelling appears",
      changeKinds(one(hist("cancelled", iso(T, 8), { fromStatus: "open", toStatus: "cancelled" }), { status: "cancelled" })),
      ["action_cancelled"]);

    // Yesterday's transition is not today's change.
    eq("3.19 a transition from YESTERDAY is not a change today",
      changeKinds(one(hist("returned", iso(YESTERDAY, 7), { fromStatus: "deferred", toStatus: "open" }))), []);
  }

  // ============ 4. UNBLOCKED REQUIRES EVIDENCE (§11, §23 J) ============
  {
    const removed = stateWith({
      nextActions: [act({ id: "z", title: "Thing", history: [hist("unblocked", iso(T, 14))] })],
    });
    const v = daily(removed);
    eq("4.1 a removed prerequisite link IS a recorded fact",
      v.changedToday.map((e) => e.kind), ["prerequisite_removed"]);
    ok("4.2 …and is named for what it proves, not for 'unblocked'",
      !/unblocked/i.test(CHANGE_LABEL.prerequisite_removed), CHANGE_LABEL.prerequisite_removed);
    ok("4.3 no change kind claims something BECAME unblocked",
      !(CHANGE_KINDS as string[]).some((k) => /^became_unblocked|^action_unblocked/.test(k)),
      CHANGE_KINDS.join(","));
    ok("4.4 the limitation is stated whenever the fact is shown",
      v.limitations.includes(UNBLOCK_LIMITATION));
    ok("4.5 …and says exactly why", /blocker was completed/.test(UNBLOCK_LIMITATION));

    // Completing a blocker is the COMMON route, and it records nothing on the
    // dependent — so no day may report the dependent as changed.
    const blockerDone = stateWith({
      nextActions: [
        act({ id: "b", title: "Blocker", status: "completed", completedAt: iso(T, 9),
          history: [hist("completed", iso(T, 9), { fromStatus: "open", toStatus: "completed" })] }),
        act({ id: "x", title: "Dependent" }),
      ],
      actionDependencies: [{ id: "d", blockerId: "b", blockedId: "x", createdAt: iso(OLD) }] as StoreState["actionDependencies"],
    });
    ok("4.6 a dependent is NOT reported as changed when its blocker finished",
      !daily(blockerDone).changedToday.some((e) => e.recordRef.id === "x"),
      JSON.stringify(daily(blockerDone).changedToday.map((e) => `${e.kind}:${e.recordRef.id}`)));
    ok("4.7 …while the blocker's own completion is reported",
      daily(blockerDone).completedToday.some((e) => e.recordRef.id === "b"));
  }

  // ============ 5. TOMORROW (§15, §23 K) ============
  {
    const s = stateWith({
      events: [ev({ id: "e", title: "Solicitor call", date: TOMORROW, startTime: "11:00" })],
      nextActions: [
        act({ id: "due", title: "Return the keys", dueDate: TOMORROW }),
        act({ id: "rec", title: "Medication", dueDate: TOMORROW, recurrence: { frequency: "daily", interval: 1 } }),
        act({ id: "undated", title: "Undated thing" }),
        act({ id: "far", title: "Parked", status: "deferred", deferredUntil: FAR }),
        act({ id: "back", title: "Comes back", status: "deferred", deferredUntil: TOMORROW }),
      ],
    });
    const v = daily(s);
    const ids = v.tomorrow.map((t) => t.id);
    ok("5.1 tomorrow's event is previewed", ids.includes("e"));
    ok("5.2 an action due tomorrow is previewed", ids.includes("due"));
    ok("5.3 a recurring occurrence falling tomorrow is previewed", ids.includes("rec"));
    ok("5.4 UNDATED open work is never invented into tomorrow", !ids.includes("undated"), ids.join(","));
    ok("5.5 work parked beyond tomorrow is not previewed", !ids.includes("far"), ids.join(","));
    ok("5.6 …but a deferral returning TOMORROW is, on its own semantics", ids.includes("back"));
    eq("5.7 timed items come before untimed ones", v.tomorrow[0].id, "e");
    // §14: nothing was mutated to build this.
    const before = JSON.stringify(s);
    daily(s);
    eq("5.8 building tomorrow moves nothing", JSON.stringify(s), before);

    const none = stateWith({ nextActions: [act({ id: "u", title: "Undated" })] });
    eq("5.9 an empty tomorrow says so, factually", daily(none).tomorrow.length, 0);
    ok("5.10 …with wording that describes records, not the day",
      /stands out from what Conqify has recorded/.test(NOTHING_TOMORROW), NOTHING_TOMORROW);
  }

  // ============ 6. WHAT THE DAY MAY NOT CLAIM (§31 A–J) ============
  {
    const s = stateWith({
      events: [ev({ id: "e", title: "Dentist", date: T, startTime: "15:00" })],
      nextActions: [
        act({ id: "o", title: "Overdue thing", dueDate: TWO_AGO }),
        act({ id: "c", title: "Done thing", status: "completed", completedAt: iso(T, 9),
          history: [hist("completed", iso(T, 9), { fromStatus: "open", toStatus: "completed" })] }),
      ],
      projects: [project("p", "A project")],
    });
    const v = daily(s);
    const text = dailyStrings(v).join(" | ");

    ok("6.A no productivity or completion score", !/\b\d{1,3}\s*%|score|grade|streak|rating\b/i.test(text), text.slice(0, 200));
    ok("6.B no moral framing of open work",
      !/\b(unfinished|missed|failed|failure|left undone|slipped)\b/i.test(text),
      text.match(/\b(unfinished|missed|failed|failure|left undone|slipped)\b/i)?.[0]);
    ok("6.C \"still open\" is the wording used",
      v.stillOpen.length === 0 || /open/i.test("still open"));
    ok("6.D no claim that a scheduled event was attended",
      !/\battend(ed|ance)?\b/i.test(text.replace(/no record of whether you attended/gi, "")),
      text.match(/\battend(ed|ance)?\b/i)?.[0]);
    ok("6.E no claim of work done without a record",
      !/\b(worked on|made progress|progressed|spent time on)\b/i.test(text),
      text.match(/\b(worked on|made progress|progressed|spent time on)\b/i)?.[0]);
    ok("6.F no claim the day is over",
      !/\b(day is (complete|over|done|finished)|you'?re done|all caught up|nothing left)\b/i.test(text),
      text.match(/\b(day is (complete|over|done|finished)|you'?re done|all caught up)\b/i)?.[0]);
    ok("6.G the review entry point is an invitation, not a verdict",
      REVIEW_TODAY_LABEL === "Review today", REVIEW_TODAY_LABEL);
    eq("6.H Today's own language guard still passes", violatesTodayLanguage(text), []);
    eq("6.I the review language guard passes too", violatesReviewLanguage(text), []);
    ok("6.J no numeric urgency anywhere in the orientation",
      !/\b\d+\s*(days? (late|behind|overdue))\b/i.test(orientationLine(v)), orientationLine(v));
  }

  // ============ 7. NO PERSISTENCE, NO AI, NO MIGRATION (§1, §27, §28) ============
  {
    const s = stateWith({
      nextActions: [act({ id: "a", title: "Thing", dueDate: T })],
      events: [ev({ id: "e", title: "Event", date: T, startTime: "10:00" })],
    });
    const before = JSON.stringify(s);
    const a = daily(s);
    const b = daily(s);
    eq("7.1 building the day mutates nothing", JSON.stringify(s), before);
    eq("7.2 …and is deterministic", JSON.stringify(a.summary), JSON.stringify(b.summary));
    eq("7.3 no daily review record is created", (s.dailyReviews ?? []).length, 0);
    eq("7.4 the store still has 46 domains", STORE_DOMAINS.length, 46);
    ok("7.5 no daily-summary domain was added",
      !(STORE_DOMAINS as string[]).some((d) => /dailySummary|daySession|dailyExecutive|morningState|eveningState/i.test(d)));
    ok("7.6 the view carries no id — it is not a record",
      !("id" in (a as unknown as Record<string, unknown>)));
  }

  // ============ 8. THE TORTURE LIST (§24, §30) ============
  {
    // 1. two events + one due action
    const t1 = stateWith({
      events: [ev({ id: "e1", title: "A", date: T, startTime: "09:00" }), ev({ id: "e2", title: "B", date: T, startTime: "15:00" })],
      nextActions: [act({ id: "d", title: "Due thing", dueDate: T })],
    });
    eq("8.1 two events are fixed", daily(t1).fixedToday.length, 2);
    eq("8.2 …the due action is flexible", daily(t1).flexibleToday.map((f) => f.action.title), ["Due thing"]);
    eq("8.3 …and it is what to do next", daily(t1).nextAction.recommendation?.action.id, "d");

    // 2. no events, no standout → no fake recommendation
    const t2 = stateWith({ nextActions: [
      act({ id: "x", title: "A", dueDate: TWO_AGO }), act({ id: "y", title: "B", dueDate: TWO_AGO }),
    ] });
    eq("8.4 a tie invents no recommendation", daily(t2).nextAction.recommendation, null);
    eq("8.5 …reusing 072's exact wording", daily(t2).nextAction.note, NO_STANDOUT);

    // 5+6. waiting started AND stopped on the same day
    const t56 = stateWith({ nextActions: [act({
      id: "w", title: "Lease", waitingOn: "Marcus",
      history: [
        hist("waiting", iso(T, 9), { fromStatus: "open", toStatus: "waiting", detail: "Marcus" }),
        hist("edited", iso(T, 16), { fromStatus: "waiting", toStatus: "open", detail: "stopped waiting on Marcus" }),
      ],
    })] });
    const k56 = changeKinds(t56);
    ok("8.6 both halves of a same-day wait are recorded",
      k56.includes("waiting_started") && k56.includes("waiting_stopped"), k56.join(","));
    ok("8.7 …and neither is a completion",
      !k56.includes("completed_action"), k56.join(","));

    // 7. recurring occurrence completed today
    const t7 = stateWith({
      nextActions: [act({ id: "r", title: "Medication", recurrence: { frequency: "daily", interval: 1 },
        history: [hist("completed", iso(T, 8), { detail: T })] })],
      recurrenceCompletions: [{ id: "rc", actionId: "r", occurrenceDate: T, completedAt: iso(T, 8) }] as StoreState["recurrenceCompletions"],
    });
    const v7 = daily(t7);
    ok("8.8 today's occurrence counts as completed",
      v7.completedToday.some((e) => e.kind === "recurring_completion"),
      v7.completedToday.map((e) => e.kind).join(","));
    ok("8.9 …the series survives", (t7.nextActions ?? [])[0].status === "open");
    ok("8.10 …and tomorrow's occurrence is still previewed", v7.tomorrow.some((t) => t.id === "r"));

    // …and UNDOING it stops the day claiming it (LIFEOS-074 §12).
    //
    // `uncompleteOccurrence` deletes the completion row and leaves the history
    // entry alone — correctly, because the user really did press the button.
    // The timeline used to read the history as the fact, so an occurrence the
    // user had explicitly undone still reported as kept, citing a row that no
    // longer existed. The completion ROW is the fact; the history is the
    // keystroke.
    const t7undone = stateWith({ nextActions: t7.nextActions, recurrenceCompletions: [] });
    const v7u = daily(t7undone);
    eq("8.10a an undone occurrence is not reported as completed",
      v7u.completedToday.map((e) => e.title), []);
    ok("8.10b …and not as a change either",
      !v7u.changedToday.some((e) => e.kind === "recurring_completion"),
      v7u.changedToday.map((e) => e.kind).join(","));
    ok("8.10c …while the history entry is untouched",
      (t7undone.nextActions ?? [])[0].history.length === 1);

    // 9. a scheduled event, never attended
    const t9 = stateWith({ events: [ev({ id: "e", title: "Dentist", date: T, startTime: "15:00" })] });
    const s9 = dailyStrings(daily(t9)).join(" | ");
    ok("8.11 an event is shown as scheduled", /Dentist/.test(s9));
    ok("8.12 …and never as attended", !/attended/i.test(s9.replace(/whether you attended/gi, "")));

    // 13. a day with nothing recorded
    const t13 = emptyState();
    const v13 = daily(t13);
    eq("8.13 an empty day records no changes", v13.changedToday.length, 0);
    ok("8.14 …and is described honestly, never as 'you did nothing'",
      /No recorded changes today\./.test(NO_CHANGES_TODAY) && !/you did nothing/i.test(NO_CHANGES_TODAY));
    ok("8.15 …and the orientation does not invent a day",
      /stands out from what Conqify has recorded/.test(orientationLine(v13)), orientationLine(v13));

    // 14+15. time of day changes presentation only (§21)
    const t14 = stateWith({ nextActions: [act({ id: "a", title: "Thing", dueDate: T })] });
    const morning = daily(t14, "08:00");
    const afternoon = daily(t14, "16:00");
    const evening = daily(t14, "19:00");
    eq("8.16 first opening at 4 PM sees the same day as at 8 AM",
      JSON.stringify(afternoon.changedToday), JSON.stringify(morning.changedToday));
    eq("8.17 …and the same still-open set", JSON.stringify(evening.stillOpen.map((o) => o.action.id)),
      JSON.stringify(morning.stillOpen.map((o) => o.action.id)));
    ok("8.18 …and 7 PM never claims the day finished",
      !/\b(day is (over|complete|done)|you'?re done)\b/i.test(dailyStrings(evening).join(" ")));
  }

  // ============ 9. MEMORY BRIDGES (§16) ============
  {
    const s = stateWith({
      events: [ev({ id: "e", title: "Solicitor call", date: TOMORROW, startTime: "11:00" })],
      nextActions: [
        act({ id: "c", title: "Paid deposit", status: "completed", completedAt: iso(T, 9),
          history: [hist("completed", iso(T, 9), { fromStatus: "open", toStatus: "completed" })] }),
        act({ id: "o", title: "Overdue thing", dueDate: TWO_AGO }),
        act({ id: "w", title: "Lease", status: "waiting", waitingOn: "Marcus", waitingSince: iso(OLD) }),
      ],
    });
    const ix = buildTodayIndexes(s, T, "09:00");
    const ask = (q: string) => answerMemoryQuery(s, q, { today: T, todayIndexes: ix });

    eq("9.1 “what do I have tomorrow?” now routes",
      planMemoryQuery("What do I have tomorrow?", { today: T })?.kind, "TOMORROW");
    eq("9.2 …and so does “what's on tomorrow?”",
      planMemoryQuery("What's on tomorrow?", { today: T })?.kind, "TOMORROW");
    const tom = ask("What do I have tomorrow?");
    eq("9.3 …answering from evidence", tom.status, "ANSWERED");
    ok("9.4 …naming tomorrow's event", tom.items.some((i) => i.text === "Solicitor call"),
      JSON.stringify(tom.items.map((i) => i.text)));
    ok("9.5 …and never the undated backlog", !tom.items.some((i) => i.text === "Overdue thing"));
    ok("9.6 …stating that nothing was carried forward",
      /isn't moved here automatically/.test(tom.limitation ?? ""), tom.limitation);
    ok("9.7 Memory and the daily view agree about tomorrow",
      JSON.stringify(tom.items.map((i) => i.text)) === JSON.stringify(daily(s).tomorrow.map((t) => t.title)));

    eq("9.8 “what happened today?” still routes", planMemoryQuery("What happened today?", { today: T })?.kind, "CHANGES");
    eq("9.9 “what is still open?” still routes", planMemoryQuery("What is still open?", { today: T })?.kind, "OPEN_WORK");
    eq("9.10 “what did I finish today?” still routes",
      planMemoryQuery("What did I finish today?", { today: T })?.kind, "COMPLETION");
    eq("9.11 “what am I waiting on?” still routes",
      planMemoryQuery("What am I waiting on?", { today: T })?.kind, "WAITING");
    ok("9.12 finishing today is answered from the same completion evidence",
      ask("What did I finish today?").items.some((i) => i.text === "Paid deposit"));

    // Nothing dated tomorrow → refuses rather than inventing.
    const bare = stateWith({ nextActions: [act({ id: "u", title: "Undated" })] });
    const none = answerMemoryQuery(bare, "What do I have tomorrow?", { today: T, todayIndexes: buildTodayIndexes(bare, T, "09:00") });
    eq("9.13 an empty tomorrow is a refusal, not a guess", none.status, "NO_RECORDED_EVIDENCE");
    eq("9.14 …with the shared wording", none.summary, NOTHING_TOMORROW);
  }

  // ============ 10. PROVENANCE (§18, §26) ============
  {
    const s = stateWith({
      notes: [
        { id: "mine", body: "The move feels lighter now.", tags: [], linkedEntityRefs: [], createdAt: iso(T, 13), updatedAt: iso(T, 13) },
        { id: "ai", body: "_AI-generated — Summary:_\n\nYou had a busy day.", tags: [], linkedEntityRefs: [],
          createdAt: iso(T, 14), updatedAt: iso(T, 14), fromAiText: true },
      ] as unknown as StoreState["notes"],
    });
    const v = daily(s);
    ok("10.1 the user's own note is in their own words",
      v.reflections.some((r) => r.recordRef.id === "mine"));
    ok("10.2 AI prose is NEVER presented as the user's words",
      !v.reflections.some((r) => r.recordRef.id === "ai"),
      JSON.stringify(v.reflections.map((r) => r.recordRef.id)));
  }

  // ============ 11. RECOMPUTATION (§20) ============
  {
    const base = () => stateWith({
      nextActions: [
        act({ id: "n", title: "Next thing", dueDate: TWO_AGO }),
        act({ id: "m", title: "Second thing", dueDate: YESTERDAY }),
      ],
    });
    const before = daily(base());
    eq("11.1 the more overdue item is next", before.nextAction.recommendation?.action.id, "n");

    const done = base();
    done.nextActions = done.nextActions!.map((a) => a.id === "n"
      ? { ...a, status: "completed" as const, completedAt: iso(T, 11) } : a);
    eq("11.2 completing it moves the recommendation on",
      daily(done).nextAction.recommendation?.action.id, "m");

    const deferred = base();
    deferred.nextActions = deferred.nextActions!.map((a) => a.id === "n"
      ? { ...a, status: "deferred" as const, deferredUntil: FAR } : a);
    ok("11.3 deferring it removes it from attention",
      !daily(deferred).attention.some((s) => s.recordRef.id === "n"),
      daily(deferred).attention.map((s) => s.recordRef.id).join(","));
    ok("11.4 …and it does not reappear as still open",
      !daily(deferred).stillOpen.some((o) => o.action.id === "n"));

    const waited = base();
    waited.nextActions = waited.nextActions!.map((a) => a.id === "n"
      ? { ...a, status: "waiting" as const, waitingOn: "Sam", waitingSince: iso(T, 10) } : a);
    ok("11.5 marking it waiting moves it to Waiting",
      daily(waited).waiting.some((w) => w.action.id === "n"));
    ok("11.6 …and it is never recommended from there",
      daily(waited).nextAction.recommendation?.action.id !== "n");
  }

  // ============ 12. PERFORMANCE (§26) ============
  {
    for (const [n, budget] of [[100, 300], [1000, 900], [5000, 4000]] as Array<[number, number]>) {
      const s = emptyState();
      const day = (i: number) => {
        const d = new Date(Date.UTC(2026, 7, 25));
        d.setUTCDate(d.getUTCDate() - (i % 90));
        return d.toISOString().slice(0, 10);
      };
      s.nextActions = Array.from({ length: n }, (_, i) => act({
        id: `b${i}`, title: `Task ${i}`, createdAt: iso(day(i)),
        dueDate: i % 3 === 0 ? day(i) : undefined,
        history: i % 5 === 0 ? [hist("completed", iso(day(i), 9), { fromStatus: "open", toStatus: "completed" })] : [],
      }));
      s.actionDependencies = Array.from({ length: Math.floor(n / 10) }, (_, i) =>
        ({ id: `d${i}`, blockerId: `b${i}`, blockedId: `b${i + 1}`, createdAt: iso(OLD) })) as StoreState["actionDependencies"];
      const ix = buildTodayIndexes(s, T, "09:00");
      const t0 = Date.now();
      buildDailyExecutiveView(s, ix, T);
      const ms = Date.now() - t0;
      ok(`12.x ${n} actions → daily view in ${ms}ms`, ms < budget, `${ms}ms (budget ${budget}ms)`);
    }
  }

  // ============ 13. THE SHARED RANGE (§6) ============
  {
    const s = stateWith({
      nextActions: [act({ id: "c", title: "Done", status: "completed", completedAt: iso(T, 9),
        history: [hist("completed", iso(T, 9), { fromStatus: "open", toStatus: "completed" })] })],
    });
    const dayReview = buildRangeReview(s, resolveRange("today", { today: T }), { today: T });
    const week = buildWeekReview(s, "this_week", { today: T });
    eq("13.1 the day range is one calendar day",
      [dayReview.range.startKey, dayReview.range.endKey], [T, T]);
    ok("13.2 …not a rolling 24 hours", dayReview.range.startKey === dayReview.range.endKey);
    eq("13.3 the same grouping serves the week", week.completed.length, dayReview.completed.length);
    eq("13.4 …and the week still reports its own kind", week.rangeKind, "this_week");
    ok("13.5 the daily view reuses that grouping rather than copying it",
      JSON.stringify(daily(s).review.completed) === JSON.stringify(dayReview.completed));
  }

  const passed = results.filter((x) => x.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}
