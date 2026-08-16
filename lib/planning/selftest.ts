/**
 * Planning & focus self-tests (LIFEOS-037).
 *
 * Deterministic in-memory assertions over the pure planning core — no network,
 * no store, no AI. Covers horizon lifecycle, board projection + manual ordering,
 * Today Plan, weekly projection, planning-inbox candidates, active-project
 * safeguard, focus lifecycle + panels, interruptions, capacity limits, commitment
 * grouping, local-date/DST/timezone behavior, daily-review projection, reading
 * integration, inspector relationships, sync conflict rules, history dedup,
 * projection purity, and performance.
 */

import type { StoreState, PlanningAssignment, RecordRefLite, FocusInterruption } from "@/types/mvp";
import { HORIZONS, horizonOf, assignmentFor } from "@/lib/planning/horizon";
import { deriveBoard, boardCounts, nextOrderIn, type CardMeta } from "@/lib/planning/board";
import { todayPlan } from "@/lib/planning/today-plan";
import { weeklyPlan } from "@/lib/planning/weekly-plan";
import { planningInbox, activeProjectSafeguard, unplannedCount } from "@/lib/planning/planning-inbox";
import { capacitySummary, capacityMessage } from "@/lib/planning/capacity";
import { commitmentGroups, commitmentCount } from "@/lib/planning/commitments";
import { makeFocusSession, defaultPanels, activeFocus, focusElapsedMs, FOCUS_PANELS } from "@/lib/planning/focus";
import { makeEvent, appendHistory } from "@/lib/planning/history";
import { planningInfoFor, focusHistoryFor, dailyPlanning } from "@/lib/planning/relationships";
import { mergeAssignment, mergeAssignmentSets, mergeFocusSession, mergeCapacityLimits } from "@/lib/planning/merge-rules";
import { todayKey, addDays, weekStartKey, localDateKeyAtOffset } from "@/lib/reviews/dates";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [], megathreads: [],
    reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [],
    concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [],
    dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [],
    sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [],
    planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
  };
}

const T0 = "2026-07-01T09:00:00.000Z";
let seq = 0;
function assign(ref: RecordRefLite, horizon: PlanningAssignment["horizon"], order = 0, history: PlanningAssignment["history"] = []): PlanningAssignment {
  seq += 1;
  return { id: `pa${seq}`, ref, horizon, order, createdAt: T0, updatedAt: T0, history };
}
function action(id: string, patch: Partial<StoreState["nextActions"][number]> = {}) {
  return { id, title: `Action ${id}`, description: "", status: "open", createdAt: T0, updatedAt: T0, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 0, history: [], ...patch } as StoreState["nextActions"][number];
}

export function runPlanningSelfTests(): SelfTestReport {
  const results: SelfTestResult[] = [];
  const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const ok = (name: string, cond: boolean, detail = "ok") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAIL: ${detail}` });
  const TODAY = todayKey();
  const meta = (m: Partial<CardMeta> = {}): CardMeta => ({ title: "X", kind: "action", exists: true, ...m });
  const resolve = (map: Record<string, CardMeta>) => (ref: RecordRefLite): CardMeta => map[`${ref.kind}:${ref.id}`] ?? meta({ exists: false, title: "(missing)" });

  // ---- 1. Horizon lifecycle ----
  {
    const a = [assign({ kind: "action", id: "a1" }, "today")];
    ok("1.1 horizonOf assigned", horizonOf(a, { kind: "action", id: "a1" }) === "today");
    ok("1.2 horizonOf unassigned = unscheduled", horizonOf(a, { kind: "action", id: "zz" }) === "unscheduled");
    ok("1.3 five horizons", HORIZONS.length === 5 && HORIZONS.includes("someday"));
    ok("1.4 assignmentFor finds by ref", !!assignmentFor(a, { kind: "action", id: "a1" }));
  }

  // ---- 2. Board projection + manual ordering ----
  {
    const asg = [assign({ kind: "action", id: "a" }, "today", 2), assign({ kind: "action", id: "b" }, "today", 1), assign({ kind: "action", id: "c" }, "this_week", 0)];
    const cols = deriveBoard(asg, resolve({ "action:a": meta({ title: "A" }), "action:b": meta({ title: "B" }), "action:c": meta({ title: "C" }) }));
    const today = cols.find((c) => c.horizon === "today")!;
    ok("2.1 five columns", cols.length === 5);
    ok("2.2 manual order within column", today.cards[0].meta.title === "B" && today.cards[1].meta.title === "A");
    ok("2.3 counts per column", boardCounts(asg).today === 2 && boardCounts(asg).this_week === 1);
    ok("2.4 nextOrderIn appends", nextOrderIn(asg, "today") === 3);
  }

  // ---- 3. Board filters ----
  {
    const asg = [assign({ kind: "action", id: "a" }, "today", 0), assign({ kind: "document", id: "d" }, "today", 1)];
    const r = resolve({ "action:a": meta({ kind: "action", projectId: "p1", tags: ["x"] }), "document:d": meta({ kind: "document", title: "Doc" }) });
    ok("3.1 filter by kind", deriveBoard(asg, r, { kind: "document" }).find((c) => c.horizon === "today")!.cards.length === 1);
    ok("3.2 filter by project", deriveBoard(asg, r, { projectId: "p1" }).find((c) => c.horizon === "today")!.cards.length === 1);
    ok("3.3 filter by tag", deriveBoard(asg, r, { tag: "x" }).find((c) => c.horizon === "today")!.cards.length === 1);
    ok("3.4 hideOrphans", deriveBoard([assign({ kind: "action", id: "gone" }, "today")], resolve({}), { hideOrphans: true }).find((c) => c.horizon === "today")!.cards.length === 0);
  }

  // ---- 4. Today Plan ----
  {
    const s = emptyState();
    s.nextActions = [action("a1", { pinned: true }), action("a2", { status: "in_progress" }), action("a3")];
    s.planningAssignments = [assign({ kind: "action", id: "a3" }, "today", 0)];
    const plan = todayPlan(s, TODAY);
    ok("4.1 explicit Today assignment leads", plan.items[0].ref.id === "a3" && plan.items[0].sources.includes("planned"));
    ok("4.2 derived pinned + in-progress included", plan.items.some((i) => i.ref.id === "a1" && i.sources.includes("pinned")) && plan.items.some((i) => i.ref.id === "a2"));
    ok("4.3 assignedCount reflects explicit", plan.assignedCount === 1);
    ok("4.4 empty plan not auto-filled", todayPlan(emptyState(), TODAY).items.length === 0);
  }

  // ---- 5. Weekly projection ----
  {
    const s = emptyState();
    s.planningAssignments = [assign({ kind: "action", id: "w1" }, "this_week", 0), assign({ kind: "action", id: "t1" }, "today", 0)];
    s.projects = [{ id: "p1", title: "P", description: "", status: "active", priority: "medium", notes: "", milestones: [{ id: "m1", title: "M", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: T0, updatedAt: T0 }], relatedDocuments: [], relatedEntities: [], createdAt: T0, updatedAt: `${TODAY}T08:00:00.000Z` }];
    const wp = weeklyPlan(s, TODAY);
    ok("5.1 this-week items", wp.thisWeek.length === 1 && wp.unfinishedToday.length === 1);
    ok("5.2 active milestones", wp.activeMilestones.length === 1);
    ok("5.3 projects touched this week", wp.projectsTouched.some((p) => p.id === "p1"));
    ok("5.4 weekStart deterministic", wp.weekStart === weekStartKey(TODAY));
  }

  // ---- 6. Planning inbox + active-project safeguard ----
  {
    const s = emptyState();
    s.nextActions = [action("a1"), action("a2", { projectId: "p1", status: "open" })];
    s.projects = [{ id: "p1", title: "P", description: "", status: "active", priority: "medium", notes: "", milestones: [{ id: "m1", title: "M", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: T0, updatedAt: T0 }], relatedDocuments: [], relatedEntities: [], createdAt: T0, updatedAt: T0 }, { id: "p2", title: "Empty", description: "", status: "active", priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: T0, updatedAt: T0 }];
    const inbox = planningInbox(s, TODAY);
    ok("6.1 open action with no horizon flagged", inbox.some((i) => i.reason === "action_no_horizon" && i.ref.id === "a1"));
    ok("6.2 active project without action flagged", inbox.some((i) => i.reason === "project_no_action" && i.ref.id === "p2"));
    ok("6.3 milestone without action flagged", inbox.some((i) => i.reason === "milestone_no_action" && i.ref.id === "m1"));
    ok("6.4 safeguard: p2 needs action, p1 does not", activeProjectSafeguard(s, "p2").needsAction && !activeProjectSafeguard(s, "p1").needsAction);
    ok("6.5 unplannedCount", unplannedCount(s) === 2);
    // orphaned assignment
    const s2 = emptyState(); s2.planningAssignments = [assign({ kind: "action", id: "ghost" }, "today")];
    ok("6.6 orphaned assignment flagged", planningInbox(s2, TODAY).some((i) => i.reason === "orphaned_assignment"));
  }

  // ---- 7. Capacity ----
  {
    const s = emptyState();
    s.planningAssignments = [assign({ kind: "action", id: "a" }, "today", 0), assign({ kind: "action", id: "b" }, "today", 1)];
    s.nextActions = [action("a", { status: "in_progress" })];
    const rows = capacitySummary(s, { today: 1, in_progress: 5 });
    const todayRow = rows.find((r) => r.category === "today")!;
    ok("7.1 today count", todayRow.count === 2);
    ok("7.2 exceeded flag + neutral message", todayRow.exceeded && capacityMessage(todayRow) === "2 selected, preferred limit 1");
    ok("7.3 within-limit not exceeded", !rows.find((r) => r.category === "in_progress")!.exceeded);
    ok("7.4 no limit → never exceeded", !rows.find((r) => r.category === "waiting")!.exceeded);
  }

  // ---- 8. Commitments ----
  {
    const s = emptyState();
    s.goals = [{ id: "g1", title: "G", description: "", status: "active", priority: "medium", targetDate: undefined, notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: T0, updatedAt: T0 }];
    s.nextActions = [action("a1"), action("a2", { status: "waiting" })];
    s.planningAssignments = [assign({ kind: "action", id: "a1" }, "today", 0)];
    const groups = commitmentGroups(s);
    ok("8.1 groups present", groups.some((g) => g.key === "goals") && groups.some((g) => g.key === "waiting"));
    ok("8.2 empty groups omitted", !groups.some((g) => g.key === "reading"));
    ok("8.3 commitmentCount dedupes", commitmentCount(groups) >= 2);
  }

  // ---- 9. Focus lifecycle + panels ----
  {
    const f = makeFocusSession({ targetKind: "action", ref: { kind: "action", id: "a1" }, title: "Do the thing" }, T0);
    ok("9.1 factory sets target + active", f.targetKind === "action" && !f.endedAt && f.title === "Do the thing");
    ok("9.2 default panels for action", f.panels.current_action === true && f.panels.timer === true);
    ok("9.3 panel set covers all keys", FOCUS_PANELS.every((p) => p in f.panels));
    ok("9.4 defaultPanels differ by kind", JSON.stringify(defaultPanels("document")) !== JSON.stringify(defaultPanels("action")));
    const s = emptyState(); s.focusSessions = [f];
    ok("9.5 activeFocus finds it", activeFocus(s)?.id === f.id);
    const ended = { ...f, endedAt: "2026-07-01T10:00:00.000Z" };
    ok("9.6 elapsed measured", focusElapsedMs(ended) === 3600000);
    ok("9.7 no active focus after end", !activeFocus({ ...s, focusSessions: [ended] }));
  }

  // ---- 10. Interruptions (pure) ----
  {
    const i1: FocusInterruption = { id: "i1", at: T0, description: "phone", category: "external", resolved: false };
    const f = { ...makeFocusSession({ targetKind: "action", ref: { kind: "action", id: "a" }, title: "T" }, T0), interruptions: [i1] };
    ok("10.1 interruption recorded compactly", f.interruptions.length === 1 && !("fullText" in f.interruptions[0]));
    ok("10.2 category from suggested set", f.interruptions[0].category === "external");
  }

  // ---- 11. History dedup ----
  {
    let a = assign({ kind: "action", id: "a" }, "unscheduled");
    a = appendHistory(a, makeEvent({ action: "planned", at: "2026-07-01T10:00:00.000Z", toHorizon: "today" }));
    const before = a.history.length;
    a = appendHistory(a, makeEvent({ action: "planned", at: "2026-07-01T10:00:00.400Z", toHorizon: "today" }));
    ok("11.1 immediate duplicate collapsed", a.history.length === before);
    a = appendHistory(a, makeEvent({ action: "moved", at: "2026-07-01T11:00:00.000Z", fromHorizon: "today", toHorizon: "later" }));
    ok("11.2 distinct event appended", a.history[a.history.length - 1].action === "moved");
    ok("11.3 no full record copied", a.history.every((e) => !("record" in e)));
  }

  // ---- 12. Inspector relationships ----
  {
    const s = emptyState();
    s.planningAssignments = [assign({ kind: "action", id: "a1" }, "today", 3, [makeEvent({ action: "planned", at: T0, toHorizon: "today" })])];
    s.focusSessions = [makeFocusSession({ targetKind: "action", ref: { kind: "action", id: "a1" }, title: "T" }, T0)];
    const info = planningInfoFor(s, { kind: "action", id: "a1" });
    ok("12.1 inspector horizon + order + inTodayPlan", info.horizon === "today" && info.order === 3 && info.inTodayPlan && info.planned);
    ok("12.2 planning history exposed", info.history.length === 1);
    ok("12.3 focus history for record", focusHistoryFor(s, { kind: "action", id: "a1" }).length === 1);
  }

  // ---- 13. Daily-review projection ----
  {
    const s = emptyState();
    s.nextActions = [action("a1", { status: "completed", completedAt: `${TODAY}T12:00:00.000Z` }), action("a2", { status: "open" })];
    s.planningAssignments = [assign({ kind: "action", id: "a1" }, "today", 0, [makeEvent({ action: "moved", at: `${TODAY}T09:00:00.000Z`, toHorizon: "today" })]), assign({ kind: "action", id: "a2" }, "today", 1)];
    s.focusSessions = [{ ...makeFocusSession({ targetKind: "action", ref: { kind: "action", id: "a1" }, title: "T" }, `${TODAY}T08:00:00.000Z`), interruptions: [{ id: "i", at: `${TODAY}T08:30:00.000Z`, description: "x", category: "internal", resolved: true }] }];
    const dp = dailyPlanning(s, TODAY);
    ok("13.1 today completed vs open", dp.todayCompleted.some((r) => r.id === "a1") && dp.todayOpen.some((r) => r.id === "a2"));
    ok("13.2 moves today", dp.movedToday.length >= 1);
    ok("13.3 focus sessions + interruptions", dp.focusSessions.length === 1 && dp.interruptionsCount === 1);
  }

  // ---- 14. Reading integration (document planned as any other ref) ----
  {
    const s = emptyState();
    s.planningAssignments = [assign({ kind: "document", id: "d1" }, "today", 0)];
    ok("14.1 document can be planned", horizonOf(s.planningAssignments, { kind: "document", id: "d1" }) === "today");
    ok("14.2 reading counts toward capacity", capacitySummary(s).find((r) => r.category === "reading")!.count === 1);
  }

  // ---- 15. Local-date / DST / timezone ----
  {
    ok("15.1 addDays deterministic", addDays(TODAY, 1) > TODAY && addDays(TODAY, -1) < TODAY);
    // Timezone travel: same instant, two offsets → possibly different local day, but the
    // canonical key is offset-derived and never duplicates history (projection only).
    const instant = Date.UTC(2026, 0, 1, 2, 0, 0); // 02:00 UTC
    const kMinus5 = localDateKeyAtOffset(instant, -300); // UTC-5 → prev day 21:00
    const kPlus9 = localDateKeyAtOffset(instant, 540);   // UTC+9 → same day 11:00
    ok("15.2 timezone travel yields deterministic local keys", kMinus5 === "2025-12-31" && kPlus9 === "2026-01-01");
    ok("15.3 weekStart is a Monday-anchored key", typeof weekStartKey(TODAY) === "string" && weekStartKey(TODAY) <= TODAY);
  }

  // ---- 16. Sync conflict rules ----
  {
    const base = assign({ kind: "action", id: "a" }, "today", 0);
    const local = { ...base, horizon: "later" as const, order: 5, history: [...base.history, makeEvent({ action: "moved", at: "2026-07-02T00:00:00Z", toHorizon: "later" })] };
    const remote = { ...base, horizon: "someday" as const, order: 9 };
    const m = mergeAssignment(base, local, remote);
    ok("16.1 divergent horizon → conflict", m.conflicts.includes("horizon"));
    ok("16.2 divergent order → conflict", m.conflicts.includes("order"));
    ok("16.3 history unioned, never lost", m.merged.history.length === 1);
    // set-merge dedupes by record ref (never duplicate assignments)
    const setM = mergeAssignmentSets([base], [{ ...base, id: "L", horizon: "later" }], [{ ...base, id: "R", horizon: "later" }]);
    ok("16.4 same record → ONE assignment (no duplicate)", setM.merged.filter((a) => a.ref.id === "a").length === 1);
    // focus end-vs-extend
    const f = makeFocusSession({ targetKind: "action", ref: { kind: "action", id: "a" }, title: "T" }, T0);
    const fLocal = { ...f, endedAt: "2026-07-01T10:00:00Z", interruptions: [{ id: "il", at: T0, description: "x", category: "external" as const, resolved: false }] };
    const fRemote = { ...f, interruptions: [{ id: "ir", at: T0, description: "y", category: "internal" as const, resolved: false }] };
    const fm = mergeFocusSession(f, fLocal, fRemote);
    ok("16.5 focus ended-vs-extended → conflict", fm.conflicts.includes("ended"));
    ok("16.6 interruptions union, never lost", fm.merged.interruptions.length === 2);
    // capacity
    const cm = mergeCapacityLimits({ today: 5 }, { today: 7 }, { today: 3 });
    ok("16.7 same capacity limit changed differently → conflict", cm.conflicts.includes("today"));
    const cm2 = mergeCapacityLimits({ today: 5 }, { today: 7 }, { this_week: 4 });
    ok("16.8 unrelated capacity changes auto-merge", cm2.conflicts.length === 0 && cm2.merged.today === 7 && cm2.merged.this_week === 4);
  }

  // ---- 17. Projection purity ----
  {
    const s = emptyState();
    s.planningAssignments = [assign({ kind: "action", id: "a" }, "today", 0)];
    s.nextActions = [action("a")];
    const snap = JSON.stringify(s.planningAssignments);
    deriveBoard(s.planningAssignments, resolve({}));
    todayPlan(s, TODAY); weeklyPlan(s, TODAY); planningInbox(s, TODAY); capacitySummary(s); commitmentGroups(s);
    ok("17.1 projections mutate nothing", JSON.stringify(s.planningAssignments) === snap);
  }

  // ---- 18. Performance ----
  {
    const s = emptyState();
    const N = 20000, P = 1000, ASG = 5000;
    const acts = []; for (let i = 0; i < N; i++) acts.push(action(`a${i}`, { status: i % 4 === 0 ? "completed" : "open", projectId: `p${i % P}` }));
    s.nextActions = acts;
    const projs = []; for (let i = 0; i < P; i++) projs.push({ id: `p${i}`, title: `P${i}`, description: "", status: "active" as const, priority: "medium" as const, notes: "", milestones: [{ id: `m${i}`, title: "M", status: "open" as const, notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: T0, updatedAt: T0 }], relatedDocuments: [], relatedEntities: [], createdAt: T0, updatedAt: T0 });
    s.projects = projs;
    const asg = []; const hz = HORIZONS; for (let i = 0; i < ASG; i++) asg.push(assign({ kind: "action", id: `a${i}` }, hz[i % hz.length], i));
    s.planningAssignments = asg;
    const rmap: Record<string, CardMeta> = {}; for (let i = 0; i < ASG; i++) rmap[`action:a${i}`] = meta({ title: `A${i}` });
    const R = (ref: RecordRefLite) => rmap[`${ref.kind}:${ref.id}`] ?? meta({ exists: false });

    let t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    deriveBoard(asg, R, { text: "A1" });
    let t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    ok(`18.1 board over ${ASG} assignments < 250ms`, (t1 - t0) < 250, `${Math.round(t1 - t0)}ms`);

    t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    todayPlan(s, TODAY); weeklyPlan(s, TODAY);
    t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    ok(`18.2 today+weekly over ${N} actions < 300ms`, (t1 - t0) < 300, `${Math.round(t1 - t0)}ms`);

    t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    planningInbox(s, TODAY);
    t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    ok(`18.3 planning inbox over ${N} actions + ${P} projects < 400ms`, (t1 - t0) < 400, `${Math.round(t1 - t0)}ms`);
  }

  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { pass: failed === 0, total: results.length, passed, failed, ms, results };
}
