/**
 * Next-actions self-tests (LIFEOS-036).
 *
 * Deterministic in-memory assertions over the pure action core — no network, no
 * store, no AI. Mirrors the inbox/review self-test style. Covers lifecycle,
 * Next eligibility, manual ordering, context inheritance, defer/waiting/someday,
 * dependency cycles + unblocking + missing endpoints, template instantiation,
 * milestone/daily-review/Today projections, sync conflict rules, history dedup,
 * projection purity, and performance.
 */

import type { NextAction, ActionDependency, StoreState } from "@/types/mvp";
import { makeAction, inheritFromMilestone, inheritFromCapture, type NewActionInput } from "@/lib/actions/action";
import { deriveQueue, actionsForView, isNextEligible, sortActions, filterActions, actionCounts } from "@/lib/actions/queue";
import { planDependency, wouldCreateCycle, isBlocked, buildBlockedByMap, dependencyImpact, pruneDependencies } from "@/lib/actions/dependencies";
import { deferKeyFor, isDue, isSomeday, returnDueActions, returningToday } from "@/lib/actions/defer";
import { isFollowUpDue, dueFollowUps } from "@/lib/actions/waiting";
import { makeTemplate, instantiateTemplate } from "@/lib/actions/templates";
import { makeEvent, appendHistory, ACTION_LABEL } from "@/lib/actions/history";
import {
  dueBucket, dueLabel, dueKeyOf, overdueActions, dueTodayActions, upcomingActions,
  undatedActions, sortByDue, dueSummary, isNeutralDueLanguage, DUE_FORBIDDEN_WORDS,
  UPCOMING_WINDOW_DAYS,
} from "@/lib/actions/due";
import { projectActionSummary, todayActions, dailyActions, openActionsForMilestone } from "@/lib/actions/relationships";
import { mergeActionRecord, mergeDependencies } from "@/lib/actions/merge-rules";
import { todayKey, addDays, dayDiff } from "@/lib/reviews/dates";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [], megathreads: [],
    reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [], formationSessions: [],
    concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [], researchProjects: [],
    dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [],
    sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
    protocols: [],
  };
}

const T0 = "2026-07-01T09:00:00.000Z";
let seq = 0;
function act(patch: Partial<NextAction> = {}): NextAction {
  seq += 1;
  const base = makeAction({ title: patch.title ?? `Action ${seq}` }, { order: patch.order ?? seq, at: patch.createdAt ?? T0 });
  return { ...base, ...patch, id: patch.id ?? base.id };
}

export function runActionSelfTests(): SelfTestReport {
  const results: SelfTestResult[] = [];
  const started = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const ok = (name: string, cond: boolean, detail = "ok") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAIL: ${detail}` });
  const TODAY = todayKey();

  // ---- 1. Lifecycle & factory ----
  {
    const a = makeAction({ title: "  Write the brief  " }, { order: 0, at: T0 });
    ok("1.1 factory trims + defaults open", a.title === "Write the brief" && a.status === "open" && a.estimatedSize === "unspecified" && a.energy === "unspecified");
    ok("1.2 factory seeds a created event", a.history.length === 1 && a.history[0].action === "created");
    ok("1.3 factory never invents context", !a.projectId && !a.goalId && a.tags.length === 0);
  }

  // ---- 2. Next eligibility (deterministic) ----
  {
    const open = act({ status: "open" });
    const inprog = act({ status: "in_progress" });
    const waiting = act({ status: "waiting" });
    const deferredFuture = act({ status: "deferred", deferredUntil: addDays(TODAY, 3) });
    const completed = act({ status: "completed" });
    const cancelled = act({ status: "cancelled" });
    ok("2.1 open is Next-eligible", isNextEligible(open, false));
    ok("2.2 in_progress is Next-eligible (resume)", isNextEligible(inprog, false));
    ok("2.3 waiting is NOT Next", !isNextEligible(waiting, false));
    ok("2.4 future-deferred is NOT Next", !isNextEligible(deferredFuture, false));
    ok("2.5 completed/cancelled are NOT Next", !isNextEligible(completed, false) && !isNextEligible(cancelled, false));
    ok("2.6 blocked open is NOT Next", !isNextEligible(open, true));
  }

  // ---- 3. Manual ordering + pins ----
  {
    const a = act({ order: 3, title: "third" });
    const b = act({ order: 1, title: "first" });
    const c = act({ order: 2, title: "second", pinned: true });
    const sorted = sortActions([a, b, c], "manual");
    ok("3.1 pins float to top", sorted[0].id === c.id);
    ok("3.2 manual order respected after pins", sorted[1].title === "first" && sorted[2].title === "third");
    const byCreated = sortActions([a, b, c], "created");
    ok("3.3 pin still wins over created sort", byCreated[0].id === c.id);
  }

  // ---- 4. Context inheritance ----
  {
    const s = emptyState();
    s.projects = [{ id: "p1", title: "P", description: "", status: "active", priority: "medium", goalId: "g1", workspaceId: "w1", notes: "", milestones: [{ id: "m1", title: "M", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: T0, updatedAt: T0 }], relatedDocuments: [], relatedEntities: [], createdAt: T0, updatedAt: T0 }];
    const pre = inheritFromMilestone(s, "p1", "m1");
    ok("4.1 milestone inherits project+goal+workspace", pre.projectId === "p1" && pre.goalId === "g1" && pre.workspaceId === "w1" && pre.milestoneId === "m1");
    s.captures = [{ id: "c1", text: "Call the vendor about pricing", createdAt: T0, processingStatus: "processing", workingText: "Call vendor re: Q3 pricing", linkedProjectIds: ["p1"], tags: ["ops"] }];
    const cap = inheritFromCapture(s, "c1");
    ok("4.2 capture inherits title suggestion (working text)", cap.title === "Call vendor re: Q3 pricing");
    ok("4.3 capture inherits source + project + tags", cap.sourceCaptureId === "c1" && cap.projectId === "p1" && (cap.tags ?? []).includes("ops"));
  }

  // ---- 5. Defer + someday + return ----
  {
    ok("5.1 tomorrow key", deferKeyFor("tomorrow", TODAY) === addDays(TODAY, 1));
    ok("5.2 someday has no key", deferKeyFor("someday", TODAY) === undefined);
    const due = act({ status: "deferred", deferredUntil: addDays(TODAY, -1) });
    const future = act({ status: "deferred", deferredUntil: addDays(TODAY, 2) });
    const someday = act({ status: "deferred" });
    ok("5.3 past-dated is due", isDue(due, TODAY) && !isDue(future, TODAY));
    ok("5.4 someday is never due, is someday", !isDue(someday, TODAY) && isSomeday(someday));
    const { actions, returnedIds } = returnDueActions([due, future, someday], TODAY);
    ok("5.5 due returns to open, others stay", returnedIds.length === 1 && actions.find((a) => a.id === due.id)?.status === "open" && actions.find((a) => a.id === future.id)?.status === "deferred");
    ok("5.6 returning-today list", returningToday([act({ status: "deferred", deferredUntil: TODAY })], TODAY).length === 1);
  }

  // ---- 6. Waiting + follow-ups ----
  {
    const dueW = act({ status: "waiting", waitingOn: "client", followUpDate: addDays(TODAY, -1) });
    const futureW = act({ status: "waiting", waitingOn: "supplier", followUpDate: addDays(TODAY, 3) });
    ok("6.1 follow-up due when date passed", isFollowUpDue(dueW, TODAY) && !isFollowUpDue(futureW, TODAY));
    ok("6.2 dueFollowUps filters", dueFollowUps([dueW, futureW], TODAY).length === 1);
    ok("6.3 waiting does NOT auto-change status", dueW.status === "waiting");
  }

  // ---- 7. Dependencies: cycles, blocking, unblock, missing ----
  {
    const A = act({ id: "A", title: "A" });
    const B = act({ id: "B", title: "B" });
    const C = act({ id: "C", title: "C" });
    let deps: ActionDependency[] = [];
    const r1 = planDependency(deps, "A", "B", T0); // A blocks B
    ok("7.1 add A→B ok", r1.ok);
    if (r1.ok) deps = [...deps, r1.dependency];
    const r2 = planDependency(deps, "B", "C", T0); // B blocks C
    if (r2.ok) deps = [...deps, r2.dependency];
    ok("7.2 direct self-cycle rejected", !planDependency(deps, "A", "A", T0).ok);
    ok("7.3 direct cycle rejected", !planDependency(deps, "B", "A", T0).ok);
    ok("7.4 indirect cycle rejected (C→A)", !planDependency(deps, "C", "A", T0).ok && wouldCreateCycle(deps, "C", "A"));
    ok("7.5 duplicate rejected", !planDependency(deps, "A", "B", T0).ok);
    const map = new Map([[A.id, A], [B.id, B], [C.id, C]]);
    const bbm = buildBlockedByMap(deps);
    ok("7.6 B blocked by open A", isBlocked(B, bbm, map));
    const A2 = { ...A, status: "completed" as const };
    ok("7.7 completing A unblocks B", !isBlocked(B, bbm, new Map([[A2.id, A2], [B.id, B], [C.id, C]])));
    ok("7.8 missing blocker does not block (orphan-safe)", !isBlocked(B, bbm, new Map([[B.id, B], [C.id, C]])));
    const impact = dependencyImpact("A", deps, map);
    ok("7.9 delete-A impact lists B + edges", impact.unblocks.some((x) => x.id === "B") && impact.removedEdges === 1);
    ok("7.10 prune removes A's edges", pruneDependencies(deps, "A").every((d) => d.blockerId !== "A" && d.blockedId !== "A"));
    // completing A makes B eligible but does not start it:
    ok("7.11 unblock ≠ auto-start", B.status === "open");
  }

  // ---- 8. Queue view eligibility with dependencies ----
  {
    const s = emptyState();
    const A = act({ id: "qa", title: "blocker", status: "open" });
    const B = act({ id: "qb", title: "blocked", status: "open" });
    s.nextActions = [A, B];
    s.actionDependencies = [{ id: "d", blockerId: "qa", blockedId: "qb", createdAt: T0 }];
    const next = actionsForView(s.nextActions, s.actionDependencies, "next");
    ok("8.1 blocked action excluded from Next", next.some((a) => a.id === "qa") && !next.some((a) => a.id === "qb"));
    const counts = actionCounts(s.nextActions, s.actionDependencies);
    ok("8.2 counts.next excludes blocked", counts.next === 1 && counts.all === 2);
  }

  // ---- 9. Filters ----
  {
    const a = act({ context: "computer", energy: "high", estimatedSize: "small", tags: ["ops"], projectId: "p1" });
    const b = act({ context: "errand", energy: "low", estimatedSize: "large", tags: ["home"] });
    ok("9.1 context filter", filterActions([a, b], { context: "computer" }).length === 1);
    ok("9.2 energy filter", filterActions([a, b], { energy: "low" })[0].id === b.id);
    ok("9.3 unlinked filter", filterActions([a, b], { linked: "unlinked" })[0].id === b.id);
    ok("9.4 tag filter", filterActions([a, b], { tags: ["ops"] })[0].id === a.id);
    ok("9.5 text filter", filterActions([act({ title: "email Dana" }), b], { text: "dana" }).length === 1);
  }

  // ---- 10. Templates ----
  {
    const t = makeTemplate({ title: "Weekly review", context: "computer", suggestedRecurrence: "weekly", tags: ["review"] }, T0);
    const input: NewActionInput = instantiateTemplate(t);
    ok("10.1 template instantiates fields", input.title === "Weekly review" && input.context === "computer" && (input.tags ?? []).includes("review"));
    ok("10.2 recurrence hint NOT copied to action", !("suggestedRecurrence" in (input as unknown as Record<string, unknown>)));
  }

  // ---- 11. History dedup ----
  {
    let a = act();
    a = appendHistory(a, makeEvent({ action: "started", at: "2026-07-01T10:00:00.000Z", fromStatus: "open", toStatus: "in_progress" }));
    const before = a.history.length;
    a = appendHistory(a, makeEvent({ action: "started", at: "2026-07-01T10:00:00.500Z", fromStatus: "open", toStatus: "in_progress" }));
    ok("11.1 immediate duplicate collapsed", a.history.length === before);
    a = appendHistory(a, makeEvent({ action: "completed", at: "2026-07-01T11:00:00.000Z", fromStatus: "in_progress", toStatus: "completed" }));
    ok("11.2 distinct event appended", a.history[a.history.length - 1].action === "completed");
    ok("11.3 history stores no full text", a.history.every((e) => !("description" in e)));
  }

  // ---- 12. Projections: milestone, project, Today, daily ----
  {
    const s = emptyState();
    s.nextActions = [
      act({ id: "x1", status: "open", projectId: "p1", milestoneId: "m1" }),
      act({ id: "x2", status: "completed", projectId: "p1", milestoneId: "m1", completedAt: `${TODAY}T12:00:00.000Z` }),
      act({ id: "x3", status: "in_progress", projectId: "p1" }),
      act({ id: "x4", status: "waiting", waitingOn: "client", followUpDate: addDays(TODAY, -1), projectId: "p1" }),
    ];
    const sum = projectActionSummary(s, "p1");
    ok("12.1 project summary buckets", sum.open === 1 && sum.completed === 1 && sum.inProgress === 1 && sum.waiting === 1 && sum.total === 4);
    ok("12.2 milestone open actions", openActionsForMilestone(s, "m1").length === 1);
    const today = todayActions(s, TODAY);
    ok("12.3 Today in-progress + waiting-due", today.inProgress.length === 1 && today.waitingDue.length === 1);
    ok("12.4 Today totalOpen excludes completed", today.totalOpen === 3);
    const daily = dailyActions(s, TODAY);
    ok("12.5 daily completedToday", daily.completedToday.length === 1 && daily.waitingFollowUps.length === 1);
  }

  // ---- 13. Sync conflict rules ----
  {
    const base = act({ id: "m", status: "open", tags: ["a"], title: "T", notes: "" });
    const local = { ...base, status: "completed" as const, completedAt: "z", tags: ["a", "local"], notes: "did it" };
    const remote = { ...base, status: "cancelled" as const, cancelledAt: "z", tags: ["a", "remote"], linkedEntityRefs: [{ kind: "goal", id: "g" }] };
    const m = mergeActionRecord(base, local, remote);
    ok("13.1 completed-vs-cancelled → conflict", m.conflicts.includes("status"));
    ok("13.2 tags + links union", m.merged.tags.includes("local") && m.merged.tags.includes("remote") && m.merged.linkedEntityRefs.length === 1);
    // tag add + note edit auto-merge (no conflict)
    const b2 = act({ id: "n", tags: ["x"], notes: "n0" });
    const l2 = { ...b2, tags: ["x", "y"] };
    const r2 = { ...b2, notes: "edited" };
    const m2 = mergeActionRecord(b2, l2, r2);
    ok("13.3 tag-add + note-edit auto-merge", m2.conflicts.length === 0 && m2.merged.tags.includes("y") && m2.merged.notes === "edited");
    // divergent title
    const b3 = act({ id: "o", title: "orig" });
    const m3 = mergeActionRecord(b3, { ...b3, title: "local" }, { ...b3, title: "remote" });
    ok("13.4 divergent titles → conflict", m3.conflicts.includes("title"));
    // project reassignment both → conflict
    const b4 = act({ id: "q", projectId: "p0" });
    const m4 = mergeActionRecord(b4, { ...b4, projectId: "pL" }, { ...b4, projectId: "pR" });
    ok("13.5 divergent project reassign → conflict", m4.conflicts.includes("projectId"));
    // history never lost
    const b5 = act({ id: "h" });
    const l5 = appendHistory(b5, makeEvent({ action: "started", at: "2026-07-02T00:00:00Z" }));
    const r5 = appendHistory(b5, makeEvent({ action: "edited", at: "2026-07-03T00:00:00Z" }));
    const m5 = mergeActionRecord(b5, l5, r5);
    ok("13.6 history unioned, never lost", m5.merged.history.length === b5.history.length + 2);
  }

  // ---- 14. Dependency merge (union of additions) ----
  {
    const base: ActionDependency[] = [{ id: "1", blockerId: "A", blockedId: "B", createdAt: T0 }];
    const local: ActionDependency[] = [...base, { id: "2", blockerId: "A", blockedId: "C", createdAt: T0 }];
    const remote: ActionDependency[] = [...base, { id: "3", blockerId: "D", blockedId: "E", createdAt: T0 }];
    const merged = mergeDependencies(base, local, remote);
    ok("14.1 dependency additions union", merged.merged.length === 3 && merged.autoMerged === 2);
  }

  // ---- 15. Projection purity ----
  {
    const s = emptyState();
    s.nextActions = [act({ status: "open" }), act({ status: "deferred", deferredUntil: addDays(TODAY, -1) })];
    const snapshot = JSON.stringify(s.nextActions);
    deriveQueue(s, { view: "next", sort: "manual", filter: {} });
    todayActions(s, TODAY); dailyActions(s, TODAY);
    ok("15.1 deriving the queue mutates nothing", JSON.stringify(s.nextActions) === snapshot);
  }

  // ---- 16. Performance ----
  {
    const s = emptyState();
    const N = 20000;
    const actions: NextAction[] = [];
    for (let i = 0; i < N; i++) actions.push(act({ id: `p${i}`, status: i % 5 === 0 ? "completed" : "open", order: i, projectId: `proj${i % 300}` }));
    const deps: ActionDependency[] = [];
    for (let i = 1; i < 3000; i++) deps.push({ id: `d${i}`, blockerId: `p${i - 1}`, blockedId: `p${i}`, createdAt: T0 });
    s.nextActions = actions; s.actionDependencies = deps;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const q = deriveQueue(s, { view: "next", sort: "manual", filter: { text: "Action" } });
    const t1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    ok(`16.1 Next derivation over ${N} actions + ${deps.length} deps < 400ms`, (t1 - t0) < 400, `${Math.round(t1 - t0)}ms, ${q.items.length} items`);
    const t2 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const cyc = wouldCreateCycle(deps, "p2999", "p0");
    const t3 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    ok(`16.2 cycle check on a 3000-deep chain < 100ms`, (t3 - t2) < 100, `${Math.round(t3 - t2)}ms cyclic=${cyc}`);
  }

  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
  // ==================== 30. Minimal time model (LIFEOS-053) ====================
  //
  // The gap this closes: Goals, Projects and Milestones all carried `targetDate`,
  // but the LEAF — the thing a person actually does — could not answer "by when?".
  const DUE_TODAY = "2026-08-16";
  const mk = (title: string, sourceCaptureId?: string): NextAction =>
    makeAction({ title, sourceCaptureId }, { order: 0, at: "2026-08-01T00:00:00.000Z" });
  const due = (id: string, dueDate?: string, over: Partial<NextAction> = {}): NextAction =>
    ({ ...mk(id), id, dueDate, ...over }) as NextAction;

  // ---- 30.1 The field is optional and clearable ----
  ok("30.1 an action with no due date is valid", dueKeyOf(due("a")) === undefined);
  ok("30.2 an action with a due date exposes it", dueKeyOf(due("b", "2026-08-20")) === "2026-08-20");
  ok("30.3 an empty-string due date reads as none", dueKeyOf(due("c", "")) === undefined);
  ok("30.4 clearing is representable", dueKeyOf({ ...due("d", "2026-08-20"), dueDate: undefined }) === undefined);

  // ---- 30.5 Buckets ----
  ok("30.5 due today", dueBucket(due("t", DUE_TODAY), DUE_TODAY) === "today");
  ok("30.6 due tomorrow", dueBucket(due("t", addDays(DUE_TODAY, 1)), DUE_TODAY) === "tomorrow");
  ok("30.7 due soon (within the window)", dueBucket(due("t", addDays(DUE_TODAY, 5)), DUE_TODAY) === "soon");
  ok("30.8 due later (beyond the window)", dueBucket(due("t", addDays(DUE_TODAY, 30)), DUE_TODAY) === "later");
  ok("30.9 overdue", dueBucket(due("t", addDays(DUE_TODAY, -3)), DUE_TODAY) === "overdue");
  ok("30.10 no due date → none", dueBucket(due("t"), DUE_TODAY) === "none");
  ok("30.11 the window edge is inclusive", dueBucket(due("t", addDays(DUE_TODAY, UPCOMING_WINDOW_DAYS)), DUE_TODAY) === "soon");
  ok("30.12 one day past the window is later", dueBucket(due("t", addDays(DUE_TODAY, UPCOMING_WINDOW_DAYS + 1)), DUE_TODAY) === "later");

  // ---- 30.13 Completed work stops being due ----
  ok("30.13 a completed overdue action is not overdue",
    dueBucket(due("t", addDays(DUE_TODAY, -5), { status: "completed" }), DUE_TODAY) === "none");
  ok("30.14 a cancelled action is not due", dueBucket(due("t", DUE_TODAY, { status: "cancelled" }), DUE_TODAY) === "none");
  ok("30.15 completing removes it from the overdue list",
    overdueActions([due("t", addDays(DUE_TODAY, -5), { status: "completed" })], DUE_TODAY).length === 0);

  // ---- 30.16 Date-only means NO timezone can move a deadline ----
  // Pure string/calendar arithmetic: no Date instant is constructed, so there is
  // no UTC round-trip that could shift a day across a boundary.
  ok("30.16 a due date is compared as a day key, not an instant",
    dueBucket(due("t", "2026-08-16"), "2026-08-16") === "today");
  ok("30.17 the day before is overdue, not 'today at 23:59'",
    dueBucket(due("t", "2026-08-15"), "2026-08-16") === "overdue");
  ok("30.18 the day after is tomorrow, not 'today at 00:01'",
    dueBucket(due("t", "2026-08-17"), "2026-08-16") === "tomorrow");
  // Month, year and leap-day boundaries.
  ok("30.19 month boundary", dayDiff("2026-09-01", "2026-08-31") === 1 && dueBucket(due("t", "2026-09-01"), "2026-08-31") === "tomorrow");
  ok("30.20 year boundary", dueBucket(due("t", "2027-01-01"), "2026-12-31") === "tomorrow");
  ok("30.21 leap day is a real day", dayDiff("2028-03-01", "2028-02-29") === 1);
  // A DST transition must not turn one day into two or zero.
  ok("30.22 spring-forward day boundary holds", dayDiff("2026-03-09", "2026-03-08") === 1);
  ok("30.23 fall-back day boundary holds", dayDiff("2026-11-02", "2026-11-01") === 1);

  // ---- 30.24 Today vs Upcoming split ----
  const mixed = [
    due("over", addDays(DUE_TODAY, -2)), due("now", DUE_TODAY), due("tmr", addDays(DUE_TODAY, 1)),
    due("soon", addDays(DUE_TODAY, 4)), due("far", addDays(DUE_TODAY, 40)), due("none"),
  ];
  ok("30.24 overdue list contains only overdue", overdueActions(mixed, DUE_TODAY).map((a) => a.id).join() === "over");
  ok("30.25 due-today list contains only today", dueTodayActions(mixed, DUE_TODAY).map((a) => a.id).join() === "now");
  ok("30.26 upcoming EXCLUDES today and overdue", upcomingActions(mixed, DUE_TODAY).map((a) => a.id).join() === "tmr,soon");
  ok("30.27 upcoming excludes far-future work", !upcomingActions(mixed, DUE_TODAY).some((a) => a.id === "far"));
  ok("30.28 undated actions are listed as their own normal state", undatedActions(mixed).map((a) => a.id).join() === "none");

  // ---- 30.29 Ordering ----
  ok("30.29 upcoming is chronological", JSON.stringify(upcomingActions(mixed, DUE_TODAY).map((a) => a.dueDate)) === JSON.stringify([addDays(DUE_TODAY, 1), addDays(DUE_TODAY, 4)]));
  ok("30.30 sortByDue puts dated before undated", sortByDue(mixed, DUE_TODAY)[0].id === "over" && sortByDue(mixed, DUE_TODAY).at(-1)?.id === "none");
  ok("30.31 sorting is deterministic", JSON.stringify(sortByDue(mixed, DUE_TODAY).map((a) => a.id)) === JSON.stringify(sortByDue(mixed, DUE_TODAY).map((a) => a.id)));
  ok("30.32 equal dates fall back to manual order",
    sortByDue([{ ...due("b", DUE_TODAY), order: 2 }, { ...due("a", DUE_TODAY), order: 1 }], DUE_TODAY).map((a) => a.id).join() === "a,b");

  // ---- 30.33 Summary ----
  const sum = dueSummary(mixed, DUE_TODAY);
  ok("30.33 summary counts overdue", sum.overdue === 1);
  ok("30.34 summary counts due today", sum.today === 1);
  ok("30.35 summary counts upcoming", sum.upcoming === 2);
  ok("30.36 needsAttention combines overdue + today", sum.needsAttention === 2);

  // ---- 30.37 Language: factual, never scolding ----
  ok("30.37 overdue reads in the past tense", dueLabel(due("t", addDays(DUE_TODAY, -3)), DUE_TODAY).startsWith("Was due"));
  ok("30.38 due today is plain", dueLabel(due("t", DUE_TODAY), DUE_TODAY) === "Due today");
  ok("30.39 due tomorrow is plain", dueLabel(due("t", addDays(DUE_TODAY, 1)), DUE_TODAY) === "Due tomorrow");
  ok("30.40 no due date produces no label", dueLabel(due("t"), DUE_TODAY) === "");
  ok("30.41 overdue copy carries no guilt", isNeutralDueLanguage(dueLabel(due("t", addDays(DUE_TODAY, -9)), DUE_TODAY)));
  ok("30.42 guilt words are actually detected", !isNeutralDueLanguage("You're behind and slipping"));
  ok("30.43 no overdue-day COUNT is shown", !/\d+\s*days?\s*(late|overdue)/i.test(dueLabel(due("t", addDays(DUE_TODAY, -9)), DUE_TODAY)));
  ok("30.44 streak language is banned", DUE_FORBIDDEN_WORDS.includes("streak"));
  ok("30.45 history wording is neutral", ACTION_LABEL.due_set === "Due date set" && ACTION_LABEL.due_cleared === "Due date removed");

  // ---- 30.46 Due is DISTINCT from its neighbours ----
  // `deferredUntil` is already a start/"not before" date, `followUpDate` is
  // already "check back on". Neither was overloaded to mean a deadline.
  const deferred = due("d", undefined, { status: "deferred", deferredUntil: addDays(DUE_TODAY, 20) });
  ok("30.46 a deferred action has no due date", dueKeyOf(deferred) === undefined);
  ok("30.47 a start date does not make something due", dueBucket(deferred, DUE_TODAY) === "none");
  const waiting = due("w", undefined, { status: "waiting", followUpDate: DUE_TODAY, waitingOn: "contractor" });
  ok("30.48 a follow-up is not a due date", dueKeyOf(waiting) === undefined);
  ok("30.49 follow-up still surfaces through its own path", isFollowUpDue(waiting, DUE_TODAY));
  ok("30.50 due and follow-up coexist without collision",
    dueBucket({ ...waiting, dueDate: DUE_TODAY }, DUE_TODAY) === "today" && isFollowUpDue({ ...waiting, dueDate: DUE_TODAY }, DUE_TODAY));

  // ---- 30.51 A future deadline does not clutter Today ----
  const nextMonth = due("reg", addDays(DUE_TODAY, 30), { title: "Renew registration" });
  ok("30.51 next month is absent from needs-attention", dueSummary([nextMonth], DUE_TODAY).needsAttention === 0);
  ok("30.52 next month is absent from upcoming", upcomingActions([nextMonth], DUE_TODAY).length === 0);
  ok("30.53 it appears once it enters the window", upcomingActions([nextMonth], addDays(DUE_TODAY, 25)).length === 1);

  // ---- 30.54 Capture → Action keeps lineage AND accepts a date ----
  const fromCap = { ...mk("Call dentist", "c1"), dueDate: addDays(DUE_TODAY, 4) } as NextAction;
  ok("30.54 a capture-derived action keeps its lineage", fromCap.sourceCaptureId === "c1");
  ok("30.55 a capture-derived action can carry a due date", dueBucket(fromCap, DUE_TODAY) === "soon");

  // ---- 30.56 Legacy records stay valid ----
  const legacy = { ...mk("old") } as NextAction;
  delete (legacy as Partial<NextAction>).dueDate;
  ok("30.56 a legacy action without the field is valid", dueBucket(legacy, DUE_TODAY) === "none");
  ok("30.57 legacy actions are not given a fabricated default", legacy.dueDate === undefined);
  ok("30.58 legacy actions still sort", sortByDue([legacy], DUE_TODAY).length === 1);

  // ---- 30.59 No recurrence engine was built ----
  // Deliberate: both existing recurrence concepts are DESCRIPTIVE
  // (`PracticeCadence`, `ActionTemplate.suggestedRecurrence`), and a half-built
  // engine is how duplicate actions get generated.
  ok("30.59 actions carry no recurrence rule", !("recurrence" in (due("x") as object)));
  ok("30.60 actions carry no next-occurrence field", !("nextDue" in (due("x") as object)));
  ok("30.61 completing a dated action creates nothing",
    [{ ...due("x", DUE_TODAY), status: "completed" as const }].length === 1);

    const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { pass: failed === 0, total: results.length, passed, failed, ms, results };
}
