/**
 * Deterministic-insights self-tests (LIFEOS-039).
 *
 * Pure in-memory assertions over the insights core — no network, no store, no
 * AI. Ranges use an explicit `offsetMinutes: 0` (UTC) and a fixed `today` so
 * every bound is deterministic. Covers range inclusivity, DST/timezone travel,
 * coverage, the activity index, every view, comparison + zero denominators,
 * dormancy, contributions, record activity, export accuracy, and performance.
 */

import type { StoreState, RecordRefLite } from "@/types/mvp";
import { resolveRange, inRange, previousRange, rangeDays } from "@/lib/insights/range";
import { buildActivityIndex, eventsInRange } from "@/lib/insights/activity";
import { buildCoverage } from "@/lib/insights/coverage";
import { homeMetrics, countType, sumDuration } from "@/lib/insights/metrics";
import { attentionView } from "@/lib/insights/attention";
import { projectActivity } from "@/lib/insights/projects";
import { goalActivity } from "@/lib/insights/goals";
import { actionFlow } from "@/lib/insights/actions";
import { captureFlow } from "@/lib/insights/captures";
import { readingActivity } from "@/lib/insights/reading";
import { knowledgeActivity } from "@/lib/insights/knowledge";
import { reviewActivity } from "@/lib/insights/reviews";
import { focusActivity } from "@/lib/insights/focus";
import { changeLog } from "@/lib/insights/change-log";
import { periodSummary } from "@/lib/insights/period-summary";
import { comparePeriods, comparisonPhrase } from "@/lib/insights/comparison";
import { dormancyView } from "@/lib/insights/dormancy";
import { contributionMap } from "@/lib/insights/contributions";
import { recordActivity } from "@/lib/insights/relationships";
import { exportMetadata, toCSV, toJSON } from "@/lib/insights/export";
import { definition, allDefinitions } from "@/lib/insights/definitions";
import { mergeSavedView, mergeSavedViewSets } from "@/lib/insights/merge-rules";
import type { SavedInsightView } from "@/types/mvp";

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
    protocols: [],
    constitutionElements: [],
    constitutionRevisions: [],
  };
}

// A day at UTC midnight → ISO at noon (safely inside the local UTC day).
const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const OFF = 0; // UTC for deterministic bounds

export function runInsightsSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });
  const ref = (kind: string, id: string): RecordRefLite => ({ kind, id });
  const today = "2026-07-15";

  // ---- 1. Range model + inclusivity ----
  {
    const r = resolveRange("last_7_days", { today, offsetMinutes: OFF });
    ok("1.1 last_7_days spans 7 inclusive days", r.startKey === "2026-07-09" && r.endKey === "2026-07-15", `${r.startKey}..${r.endKey}`);
    ok("1.2 rangeDays counts inclusive", rangeDays(r) === 7, String(rangeDays(r)));
    ok("1.3 start-of-day included", inRange(at("2026-07-09", 0), r));
    ok("1.4 end-of-day included", inRange(at("2026-07-15", 23), r));
    ok("1.5 day before excluded", !inRange(at("2026-07-08", 23), r));
    const today1 = resolveRange("today", { today, offsetMinutes: OFF });
    ok("1.6 today = single day", today1.startKey === today && today1.endKey === today);
    const thisMonth = resolveRange("this_month", { today, offsetMinutes: OFF });
    ok("1.7 this_month starts on the 1st", thisMonth.startKey === "2026-07-01" && thisMonth.endKey === today);
    const lastMonth = resolveRange("last_month", { today, offsetMinutes: OFF });
    ok("1.8 last_month is full June", lastMonth.startKey === "2026-06-01" && lastMonth.endKey === "2026-06-30");
    const thisYear = resolveRange("this_year", { today, offsetMinutes: OFF });
    ok("1.9 this_year starts Jan 1", thisYear.startKey === "2026-01-01");
    const custom = resolveRange("custom", { customStart: "2026-07-10", customEnd: "2026-07-05", offsetMinutes: OFF });
    ok("1.10 inverted custom range is swapped", custom.startKey === "2026-07-05" && custom.endKey === "2026-07-10");
    const prev = previousRange(resolveRange("last_7_days", { today, offsetMinutes: OFF }));
    ok("1.11 previousRange is contiguous & equal length", prev.endKey === "2026-07-08" && prev.startKey === "2026-07-02");
  }

  // ---- 2. DST + timezone travel ----
  {
    // US spring-forward 2026-03-08. A local range built at offset -300 (EST) vs -240 (EDT).
    const est = resolveRange("today", { today: "2026-03-07", offsetMinutes: -300 });
    ok("2.1 fixed-offset day = 24h at constant offset", est.endMs - est.startMs === 24 * 3600 * 1000);
    // Host-local bounds on a DST day are 23h/25h (dayBoundsLocal handles it); we assert the offset path is deterministic.
    const tokyo = resolveRange("today", { today, offsetMinutes: 540 });
    const utc = resolveRange("today", { today, offsetMinutes: 0 });
    ok("2.2 timezone travel shifts bounds deterministically", tokyo.startMs !== utc.startMs && tokyo.startMs === utc.startMs - 540 * 60000);
  }

  // ---- 3. Activity index + coverage + open-session exclusion ----
  {
    const s = emptyState();
    s.sessions = [
      { id: "s1", workspaceId: "w1", goalId: "g1", projectId: "p1", type: "focus", startedAt: at("2026-07-10", 9), endedAt: at("2026-07-10", 10), activity: [] } as never,
      { id: "s2", workspaceId: "w1", projectId: "p1", type: "focus", startedAt: at("2026-07-11", 9), activity: [] } as never, // open, no end
    ];
    const index = buildActivityIndex(s);
    ok("3.1 index sorted ascending", index.length >= 3 && index[0].at <= index[index.length - 1].at);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const ev = eventsInRange(index, r);
    ok("3.2 session_started counted", countType(ev, "session_started") === 2);
    ok("3.3 open session excluded from duration", sumDuration(ev, "session_ended") === 3600000, String(sumDuration(ev, "session_ended")));
    const cov = buildCoverage(s, index);
    ok("3.4 coverage reports open session", cov.openSessions === 1 && cov.notes.some((n) => /open/.test(n)));
    ok("3.5 coverage reports history start", cov.notes.some((n) => /history begins/.test(n)));
    ok("3.6 empty index → no activity note", buildCoverage(emptyState(), []).notes.some((n) => /No recorded activity/.test(n)));
  }

  // ---- 4. Home metrics + definitions ----
  {
    const s = emptyState();
    s.nextActions = [
      { id: "a1", title: "A", status: "completed", projectId: "p1", createdAt: at("2026-07-10"), updatedAt: at("2026-07-12"), completedAt: at("2026-07-12"), history: [{ id: "h1", at: at("2026-07-12"), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never,
      { id: "a2", title: "B", status: "open", projectId: "p1", createdAt: at("2026-07-11"), updatedAt: at("2026-07-11"), history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 1 } as never,
    ];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const metrics = homeMetrics(s, index, r);
    ok("4.1 actions created = 2", metrics.find((m) => m.key === "actions_created")?.value === 2);
    ok("4.2 actions completed = 1", metrics.find((m) => m.key === "actions_completed")?.value === 1);
    ok("4.3 projects touched = 1", metrics.find((m) => m.key === "projects_touched")?.value === 1);
    ok("4.4 every metric has a definition", metrics.every((m) => !!definition(m.definitionKey)));
    ok("4.5 definitions include focus_duration wording", /sum of recorded focus-session intervals/.test(definition("focus_duration")!.definition));
    ok("4.6 no score/rating metric", !metrics.some((m) => /score|rating|performance/i.test(m.key)));
    ok("4.7 definitions catalogue non-empty", allDefinitions().length >= 15);
  }

  // ---- 5. Attention grouping ----
  {
    const s = emptyState();
    s.sessions = [
      { id: "s1", projectId: "p1", type: "focus", startedAt: at("2026-07-10", 9), endedAt: at("2026-07-10", 10), activity: [] } as never,
      { id: "s2", projectId: "p2", type: "focus", startedAt: at("2026-07-11", 9), endedAt: at("2026-07-11", 11), activity: [] } as never,
      { id: "s3", projectId: "p1", type: "focus", startedAt: at("2026-07-12", 9), endedAt: at("2026-07-12", 10), activity: [] } as never,
    ];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const rows = attentionView(index, r, "project");
    ok("5.1 attention groups by project", rows.length === 2);
    ok("5.2 p1 has 2 sessions", rows.find((x) => x.id === "p1")?.sessionCount === 2);
    ok("5.3 duration accumulated", (rows.find((x) => x.id === "p2")?.durationMs ?? 0) === 7200000);
    ok("5.4 rows carry last touched", rows.every((x) => !!x.lastTouched));
  }

  // ---- 6. Project + goal activity ----
  {
    const s = emptyState();
    s.goals = [{ id: "g1", title: "Ship", status: "active", description: "", notes: "", priority: "high", tags: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never];
    s.projects = [{ id: "p1", title: "Launch", status: "active", goalId: "g1", priority: "high", notes: "", description: "", milestones: [{ id: "m1", title: "M", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") }], relatedDocuments: [], relatedEntities: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never];
    s.nextActions = [{ id: "a1", title: "A", status: "completed", projectId: "p1", goalId: "g1", milestoneId: "m1", createdAt: at("2026-07-10"), updatedAt: at("2026-07-12"), completedAt: at("2026-07-12"), history: [{ id: "h1", at: at("2026-07-12"), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const proj = projectActivity(s, index, r).find((x) => x.id === "p1")!;
    ok("6.1 project actions created", proj.actionsCreated === 1);
    ok("6.2 project actions completed", proj.actionsCompleted === 1);
    ok("6.3 project milestones touched", proj.milestonesTouched === 1);
    const goal = goalActivity(s, index, r).find((x) => x.id === "g1")!;
    ok("6.4 goal projects linked", goal.projectsLinked === 1);
    ok("6.5 goal completions attributed", goal.completions === 1);
    ok("6.6 goal actions linked", goal.actionsLinked === 1);
  }

  // ---- 7. Action flow transitions ----
  {
    const s = emptyState();
    s.nextActions = [{ id: "a1", title: "A", status: "completed", createdAt: at("2026-07-10"), updatedAt: at("2026-07-12"), history: [
      { id: "h1", at: at("2026-07-10", 13), action: "started" }, { id: "h2", at: at("2026-07-11"), action: "deferred" }, { id: "h3", at: at("2026-07-12"), action: "completed" },
    ], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    const index = buildActivityIndex(s);
    const flow = actionFlow(index, resolveRange("last_30_days", { today, offsetMinutes: OFF }));
    ok("7.1 created counted", flow.created === 1);
    ok("7.2 started counted", flow.started === 1);
    ok("7.3 deferred counted", flow.deferred === 1);
    ok("7.4 completed counted", flow.completed === 1);
    ok("7.5 transitions listed chronologically", flow.transitions.length >= 4 && flow.transitions[0].at <= flow.transitions[flow.transitions.length - 1].at);
  }

  // ---- 8. Capture flow + median + zero denominators ----
  {
    const s = emptyState();
    s.captures = [
      { id: "c1", text: "x", createdAt: at("2026-07-10", 9), processedAt: at("2026-07-10", 11), processingStatus: "processed", history: [] } as never,
      { id: "c2", text: "y", createdAt: at("2026-07-11", 9), processingStatus: "inbox", history: [] } as never,
      { id: "c3", text: "z", createdAt: at("2026-07-09", 9), processingStatus: "inbox", history: [] } as never,
    ];
    const index = buildActivityIndex(s);
    const flow = captureFlow(s, index, resolveRange("last_30_days", { today, offsetMinutes: OFF }));
    ok("8.1 created in range", flow.createdInRange === 3);
    ok("8.2 processed in range", flow.processedInRange === 1);
    ok("8.3 outcomes percentages sum ~100", Math.abs(flow.outcomes.reduce((n, o) => n + o.percent, 0) - 100) <= 2);
    ok("8.4 median processing delay = 2h", flow.medianProcessingDelayMs === 7200000, String(flow.medianProcessingDelayMs));
    ok("8.5 oldest unprocessed is c3", flow.oldestUnprocessed?.id === "c3");
    // Zero-denominator safety: empty capture flow.
    const empty = captureFlow(emptyState(), [], resolveRange("today", { today, offsetMinutes: OFF }));
    ok("8.6 empty capture flow safe", empty.createdInRange === 0 && empty.medianProcessingDelayMs === undefined && empty.outcomes.length === 0);

    // 8.7–8.9 Outcome labels must describe what actually happened
    // (LIFEOS-050B, D-2). The map used to carry twelve keys against a six-member
    // status union; the seven unreachable ones included "Converted to action",
    // which no status emits and no conversion target creates.
    ok("8.7 every outcome label is reachable and non-empty", flow.outcomes.every((o) => !!o.label && o.label !== o.key));
    ok("8.8 no outcome claims an action was created", flow.outcomes.every((o) => !/\baction\b/i.test(o.label)));
    ok("8.9 outcome keys are real processing statuses", (() => {
      const STATUSES = ["inbox", "processing", "processed", "deferred", "archived", "discarded"];
      return flow.outcomes.every((o) => STATUSES.includes(o.key));
    })());
  }

  // ---- 9. Reading + knowledge activity ----
  {
    const s = emptyState();
    s.documents = [{ id: "d1", title: "Doc", subtitle: "", authors: [], kind: "book", status: "reading", tags: [], notes: "", sections: [{ id: "sec", title: "s", order: 0, passages: [{ id: "p", sectionId: "sec", text: "t", order: 0, highlights: [{ id: "hl", passageId: "p", color: "yellow", text: "t", start: 0, end: 1, linked: [], createdAt: at("2026-07-10"), updatedAt: at("2026-07-10") }], annotations: [] }] }], progress: { lastOpenedAt: at("2026-07-12") }, sourceMetadata: { importFormat: "plain" }, createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never];
    s.citations = [{ id: "cit", recordKind: "belief", recordId: "b1", documentId: "d1", documentTitle: "Doc", createdAt: at("2026-07-11") } as never];
    s.beliefs = [{ id: "b1", captureId: "", proposalId: "", text: "claim", status: "accepted", createdAt: at("2026-07-10"), updatedAt: at("2026-07-10"), revisions: [], judgments: [{ decision: "accepted", at: at("2026-07-13") }] } as never];
    s.concepts = [{ id: "con", name: "C", aliases: [], definition: "", description: "", relatedBeliefs: ["b1"], relatedThreads: [], relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [], relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [], status: "active", source: "user", createdAt: at("2026-07-09"), updatedAt: at("2026-07-09") } as never];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const rd = readingActivity(s, index, r);
    ok("9.1 documents opened", rd.documentsOpened === 1);
    ok("9.2 highlights counted", rd.highlights === 1);
    ok("9.3 citations created", rd.citationsCreated === 1);
    const kn = knowledgeActivity(s, index, r);
    ok("9.4 beliefs created", kn.beliefsCreated === 1);
    ok("9.5 beliefs reviewed", kn.beliefsReviewed === 1);
    ok("9.6 citations added", kn.citationsAdded === 1);
    ok("9.7 most-referenced by raw backlinks", kn.mostReferenced.some((m) => m.kind === "belief" && m.id === "b1" && m.backlinks >= 1));
  }

  // ---- 10. Review + focus activity ----
  {
    const s = emptyState();
    s.dailyReviews = [{ id: "r1", date: "2026-07-12", status: "completed", summary: "", wins: [], lessons: [], friction: [{ id: "f", text: "x" }], openLoops: [{ id: "o", label: "y" }], tomorrowFocus: [{ id: "tf", label: "z" }], notes: "", linkedGoals: [], linkedProjects: [], linkedWorkspaces: [], linkedEntities: [], createdAt: at("2026-07-12", 20), updatedAt: at("2026-07-12", 20) } as never];
    s.focusSessions = [
      { id: "f1", targetKind: "action", ref: ref("action", "a1"), title: "A", startedAt: at("2026-07-10", 9), endedAt: at("2026-07-10", 10), panels: {}, interruptions: [{ id: "i1", at: at("2026-07-10", 9, ), description: "x", category: "message", resolved: false }], history: [] } as never,
      { id: "f2", targetKind: "action", ref: ref("action", "a2"), title: "B", startedAt: at("2026-07-11", 9), panels: {}, interruptions: [], history: [] } as never, // open
    ];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const rv = reviewActivity(s, index, r);
    ok("10.1 completed reviews", rv.completedReviews.length === 1);
    ok("10.2 friction + loops + focus counted", rv.friction === 1 && rv.openLoops === 1 && rv.tomorrowFocus === 1);
    ok("10.3 interruptions counted", rv.interruptions === 1);
    const fa = focusActivity(s, index, r);
    ok("10.4 focus sessions", fa.sessions === 2);
    ok("10.5 focus total ms excludes open", fa.totalMs === 3600000, String(fa.totalMs));
    ok("10.6 focus ended vs open", fa.endedNormally === 1 && fa.leftOpen === 1);
    ok("10.7 focus interruptions", fa.interruptions === 1);
  }

  // ---- 11. Change log ordering + filter ----
  {
    const s = emptyState();
    s.nextActions = [{ id: "a1", title: "A", status: "completed", projectId: "p1", createdAt: at("2026-07-10", 9), updatedAt: at("2026-07-12"), history: [{ id: "h", at: at("2026-07-12", 9), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    s.captures = [{ id: "c1", text: "x", createdAt: at("2026-07-11", 9), processingStatus: "inbox", history: [] } as never];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const log = changeLog(index, r);
    ok("11.1 change log newest first", log.length >= 3 && log[0].at >= log[log.length - 1].at);
    ok("11.2 filter by record kind", changeLog(index, r, { recordKind: "capture" }).every((e) => e.recordKind === "capture"));
    ok("11.3 filter by event type", changeLog(index, r, { eventType: "action_completed" }).every((e) => e.type === "action_completed"));
    ok("11.4 filter by project", changeLog(index, r, { projectId: "p1" }).every((e) => e.projectId === "p1"));
  }

  // ---- 12. Period summary + comparison ----
  {
    const s = emptyState();
    s.nextActions = [{ id: "a1", title: "A", status: "completed", createdAt: at("2026-07-10"), updatedAt: at("2026-07-12"), history: [{ id: "h1", at: at("2026-07-10", 13), action: "started" }, { id: "h2", at: at("2026-07-12"), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    const index = buildActivityIndex(s);
    const r = resolveRange("last_30_days", { today, offsetMinutes: OFF });
    const summary = periodSummary(index, r);
    ok("12.1 summary has 9 sections", summary.length === 9);
    ok("12.2 completed section populated", (summary.find((x) => x.key === "completed")?.count ?? 0) === 1);
    ok("12.3 started section populated", (summary.find((x) => x.key === "started")?.count ?? 0) >= 1);
    // Comparison: current vs previous (empty previous → undefined pct).
    const cur = resolveRange("custom", { customStart: "2026-07-10", customEnd: "2026-07-12", offsetMinutes: OFF });
    const prev = previousRange(cur);
    const cmp = comparePeriods(s, index, cur, prev);
    const created = cmp.find((c) => c.key === "actions_created")!;
    ok("12.4 comparison current value", created.current === 1);
    ok("12.5 zero previous → undefined pct", created.previous === 0 && created.pctDiff === undefined);
    ok("12.6 comparison phrase neutral", !/improv|declin|better|worse|ahead|behind/i.test(comparisonPhrase(created)));
  }

  // ---- 13. Dormancy ----
  {
    const s = emptyState();
    s.projects = [
      { id: "p1", title: "Active", status: "active", priority: "medium", notes: "", description: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never,
      { id: "p2", title: "Dormant", status: "active", priority: "medium", notes: "", description: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never,
    ];
    // p1 has a recent action event; p2 has none.
    s.nextActions = [{ id: "a1", title: "A", status: "open", projectId: "p1", createdAt: at("2026-07-14"), updatedAt: at("2026-07-14"), history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    const index = buildActivityIndex(s);
    const dormant = dormancyView(s, index, 30, ["project"], today);
    ok("13.1 dormant project surfaced", dormant.some((d) => d.id === "p2"));
    ok("13.2 active project not dormant", !dormant.some((d) => d.id === "p1"));
    ok("13.3 dormancy days computed / infinite", dormant.every((d) => d.inactiveDays >= 30 || d.inactiveDays === Number.POSITIVE_INFINITY));
  }

  // ---- 14. Contributions ----
  {
    const s = emptyState();
    s.goals = [{ id: "g1", title: "G", status: "active", description: "", notes: "", priority: "high", tags: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never];
    s.projects = [{ id: "p1", title: "P", status: "active", goalId: "g1", priority: "high", notes: "", description: "", milestones: [{ id: "m1", title: "M", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") }], relatedDocuments: [], relatedEntities: [], createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") } as never];
    s.nextActions = [{ id: "a1", title: "A", status: "completed", projectId: "p1", milestoneId: "m1", createdAt: at("2026-07-10"), updatedAt: at("2026-07-12"), history: [{ id: "h", at: at("2026-07-12"), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
    const index = buildActivityIndex(s);
    const edges = contributionMap(s, index, resolveRange("last_30_days", { today, offsetMinutes: OFF }));
    ok("14.1 action→milestone edge", edges.some((e) => e.from === "action" && e.to === "milestone" && e.count >= 1));
    ok("14.2 project→goal edge", edges.some((e) => e.from === "project" && e.to === "goal" && e.count >= 1));
    ok("14.3 edges are bounded (<= 8 types)", edges.length <= 8);

    // 14.4–14.6 The capture→action edge must count real actions
    // (LIFEOS-050B, D-2). It previously counted a `capture_converted` event that
    // nothing emits, OR'd with every `capture_processed` event — so merely
    // marking a capture processed asserted an edge to an action that was never
    // created. `a1` above has no `sourceCaptureId`, so there is no such edge.
    ok("14.4 processed capture alone does NOT assert a capture→action edge", (() => {
      const s2 = emptyState();
      s2.captures = [{ id: "c1", text: "call the dentist", createdAt: at("2026-07-10", 9), processedAt: at("2026-07-10", 11), processingStatus: "processed", history: [] } as never];
      const e2 = contributionMap(s2, buildActivityIndex(s2), resolveRange("last_30_days", { today, offsetMinutes: OFF }));
      return !e2.some((e) => e.from === "capture" && e.to === "action");
    })());
    ok("14.5 an action created FROM a capture does assert the edge", (() => {
      const s3 = emptyState();
      s3.captures = [{ id: "c1", text: "call the dentist", createdAt: at("2026-07-10", 9), processingStatus: "inbox", history: [] } as never];
      s3.nextActions = [{ id: "a9", title: "Call the dentist", status: "open", sourceCaptureId: "c1", createdAt: at("2026-07-10", 10), updatedAt: at("2026-07-10", 10), history: [], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never];
      const e3 = contributionMap(s3, buildActivityIndex(s3), resolveRange("last_30_days", { today, offsetMinutes: OFF }));
      return e3.some((e) => e.from === "capture" && e.to === "action" && e.count === 1);
    })());
    ok("14.6 capture→action edge is absent when no action exists", !edges.some((e) => e.from === "capture" && e.to === "action"));
  }

  // ---- 15. Record activity (inspector) ----
  {
    const s = emptyState();
    s.beliefs = [{ id: "b1", captureId: "", proposalId: "", text: "claim", status: "accepted", createdAt: at("2026-07-10"), updatedAt: at("2026-07-13"), revisions: [], judgments: [{ decision: "accepted", at: at("2026-07-13") }] } as never];
    const index = buildActivityIndex(s);
    const ra = recordActivity(index, ref("belief", "b1"), resolveRange("last_30_days", { today, offsetMinutes: OFF }));
    ok("15.1 created captured", ra.created === at("2026-07-10"));
    ok("15.2 last reviewed captured", ra.lastReviewed === at("2026-07-13"));
    ok("15.3 linked activity count", ra.linkedActivityCount >= 2);
    ok("15.4 recent history newest first", ra.recentHistory.length >= 2 && ra.recentHistory[0].at >= ra.recentHistory[ra.recentHistory.length - 1].at);
  }

  // ---- 16. Export accuracy ----
  {
    const r = resolveRange("last_7_days", { today, offsetMinutes: OFF });
    const meta = exportMetadata("home", r, { projectId: "p1" }, "UTC");
    ok("16.1 metadata carries range + tz + filters", meta.startKey === r.startKey && meta.timezone === "UTC" && (meta.filters as { projectId?: string }).projectId === "p1");
    const csv = toCSV(meta, ["key", "value"], [{ key: "sessions", value: 12 }, { key: "note", value: "a,b" }]);
    ok("16.2 CSV has metadata header", csv.startsWith("# insight,home"));
    ok("16.3 CSV escapes commas", csv.includes('"a,b"'));
    ok("16.4 CSV includes rows", csv.includes("sessions,12"));
    const json = JSON.parse(toJSON(meta, { sessions: 12 }));
    ok("16.5 JSON has metadata + data", json.metadata.insight === "home" && json.data.sessions === 12);
  }

  // ---- 17. Performance at scale ----
  {
    const s = emptyState();
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const day = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      s.nextActions.push({ id: `a${i}`, title: `A${i}`, status: "completed", projectId: `p${i % 1000}`, createdAt: at(day, 9), updatedAt: at(day, 10), history: [{ id: `h${i}`, at: at(day, 10), action: "completed" }], tags: [], linkedEntityRefs: [], notes: "", description: "", order: 0 } as never);
    }
    for (let i = 0; i < 5000; i++) { const day = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`; s.sessions.push({ id: `s${i}`, projectId: `p${i % 1000}`, type: "focus", startedAt: at(day, 8), endedAt: at(day, 9), activity: [] } as never); }
    for (let i = 0; i < 10000; i++) { const day = `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`; s.captures.push({ id: `c${i}`, text: "x", createdAt: at(day, 7), processingStatus: "inbox", history: [] } as never); }

    const tIdx = Date.now(); const index = buildActivityIndex(s); const idxMs = Date.now() - tIdx;
    const r = resolveRange("this_year", { today, offsetMinutes: OFF });
    const tH = Date.now(); homeMetrics(s, index, r); const homeMs = Date.now() - tH;
    const tA = Date.now(); attentionView(index, r, "project"); const attnMs = Date.now() - tA;
    const tC = Date.now(); changeLog(index, r); const clMs = Date.now() - tC;
    ok(`17.1 index build < 400ms (${idxMs}ms)`, idxMs < 400, `${idxMs}ms`);
    ok(`17.2 home metrics < 150ms (${homeMs}ms)`, homeMs < 150, `${homeMs}ms`);
    ok(`17.3 attention < 200ms (${attnMs}ms)`, attnMs < 200, `${attnMs}ms`);
    ok(`17.4 change log < 200ms (${clMs}ms)`, clMs < 200, `${clMs}ms`);
    ok("17.5 index has ~35k events", index.length >= 35000, String(index.length));
  }

  // ---- 18. Saved-view sync merge rules ----
  {
    const base: SavedInsightView = { id: "v1", name: "Weekly", insight: "home", rangeKind: "last_7_days", filters: {}, createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") };
    const local: SavedInsightView = { ...base, name: "Weekly (mine)", updatedAt: at("2026-07-02") };
    const remote: SavedInsightView = { ...base, name: "Weekly (theirs)", updatedAt: at("2026-07-03") };
    const conflict = mergeSavedView(base, local, remote);
    ok("18.1 same view edited differently → conflict", !!conflict.conflict);
    const oneSided = mergeSavedView(base, { ...base, name: "Renamed", updatedAt: at("2026-07-02") }, base);
    ok("18.2 one-sided edit auto-merges", !oneSided.conflict && oneSided.merged.name === "Renamed");
    const setMerge = mergeSavedViewSets([base], [local, { ...base, id: "v2", name: "New" }], [remote]);
    ok("18.3 independent views union", setMerge.merged.some((v) => v.id === "v2") && setMerge.merged.some((v) => v.id === "v1"));
    ok("18.4 set merge reports the conflict", setMerge.conflicts.some((c) => c.id === "v1"));
    // Delete-vs-edit: base has v1, local edited it, remote deleted it.
    const delEdit = mergeSavedViewSets([base], [local], []);
    ok("18.5 delete-vs-edit keeps the edit + flags", delEdit.merged.some((v) => v.id === "v1") && delEdit.conflicts.length === 1);
    // Unchanged-vs-delete: honor the delete.
    const cleanDelete = mergeSavedViewSets([base], [base], []);
    ok("18.6 unchanged view honors remote delete", cleanDelete.merged.length === 0 && cleanDelete.conflicts.length === 0);
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
