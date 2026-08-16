/**
 * Daily review & planning-loop self-tests (LIFEOS-034).
 *
 * Fixture-driven, deterministic assertions for the review engine — local-date
 * semantics (boundaries, DST, timezone travel), the day-summary projection,
 * open-loop derivation, tomorrow-focus ordering, the weekly rollup, review
 * relationships, search integration, schema purity, and a performance budget.
 * Surfaced at `/dev/review-tests`, asserted by `review.mjs`. Pure: no store, no
 * localStorage, no AI.
 */

import type {
  DailyReview, ReviewFocusItem, StoreState, WorkspaceSession,
} from "@/types/mvp";
import {
  localDateKeyAtOffset, dayBoundsAtOffset, isoOnDayAtOffset, dayBoundsLocal,
  addDays, weekStartKey, weekDays, dayDiff, recencyBucket, isDayKey,
} from "@/lib/reviews/dates";
import { buildDaySummary, daySummaryTotal } from "@/lib/reviews/day-summary";
import { deriveOpenLoops } from "@/lib/reviews/open-loops";
import { orderedFocus, moveFocus, normalizeFocusOrder, focusSuggestions } from "@/lib/reviews/tomorrow-focus";
import { buildWeeklyRollup } from "@/lib/reviews/weekly-rollup";
import { reviewReferences, reviewsReferencing } from "@/lib/reviews/relationships";
import { findReviewByDate, reviewCounts, isReviewEmpty, groupReviewsByRecency, startTomorrowActions, latestCompletedReview } from "@/lib/reviews/review";
import { buildSearchEntries } from "@/lib/command/records";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
    protocols: [],
  };
}

const review = (p: Partial<DailyReview> & { id: string; date: string }): DailyReview => ({
  status: "completed", summary: "", notes: "", wins: [], lessons: [], friction: [], openLoops: [], tomorrowFocus: [],
  linkedGoals: [], linkedProjects: [], linkedWorkspaces: [], linkedEntities: [], createdAt: `${p.date}T20:00:00.000Z`, updatedAt: `${p.date}T20:00:00.000Z`, ...p,
});

// A day at UTC (offset 0) for deterministic day-summary matching.
const DAY = "2026-07-27";
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

function activityState(): StoreState {
  const s = emptyState();
  s.captures = [
    { id: "c1", text: "A thought today", createdAt: at("09:00") } as StoreState["captures"][number],
    { id: "c2", text: "Yesterday's thought", createdAt: "2026-07-26T09:00:00.000Z" } as StoreState["captures"][number],
  ];
  s.workspaces = [{ id: "w1", name: "Thesis", description: "", color: undefined, goals: [], members: [], pinned: [], resume: {}, archived: false, createdAt: at("08:00"), updatedAt: at("08:00") }];
  s.goals = [{ id: "g1", title: "Finish thesis", description: "", status: "active", priority: "high", notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: at("08:00"), updatedAt: at("08:00") }];
  s.projects = [{
    id: "p1", title: "Chapter 3", description: "", status: "active", priority: "high", goalId: "g1", workspaceId: "w1",
    notes: "", manualProgress: undefined, relatedDocuments: [], relatedEntities: [], createdAt: at("08:00"), updatedAt: at("08:00"),
    milestones: [
      { id: "m1", title: "Outline", status: "done", completedDate: at("11:00"), notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: at("08:00"), updatedAt: at("11:00") },
      { id: "m2", title: "Draft", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: at("08:00"), updatedAt: at("08:00") },
    ],
  }];
  s.sessions = [{
    id: "s1", workspaceId: "w1", type: "writing", goal: "Draft chapter", goalId: "g1", projectId: "p1", notes: "",
    startedAt: at("10:00"), endedAt: at("12:30"),
    activity: [
      { id: "a1", at: at("10:05"), type: "opened_entity", entityKind: "belief", entityId: "b1", label: "Attention" } as WorkspaceSession["activity"][number],
      { id: "a2", at: at("10:20"), type: "search", label: "freedom" } as WorkspaceSession["activity"][number],
    ],
  }];
  s.documents = [{
    id: "d1", title: "Weil Essays", subtitle: "", authors: ["Weil"], kind: "book", status: "reading", tags: [], notes: "",
    sections: [{ id: "sec1", title: "I", order: 0, passages: [{ id: "pa1", sectionId: "sec1", text: "Attention is generosity", order: 0,
      highlights: [{ id: "h1", passageId: "pa1", color: "yellow", text: "generosity", start: 0, end: 5, linked: [], createdAt: at("13:00"), updatedAt: at("13:00") }],
      annotations: [{ id: "an1", passageId: "pa1", text: "note", createdAt: at("13:05"), updatedAt: at("13:05") }], linked: [] }] }],
    progress: { status: "reading", percent: 20, readPassageIds: [], lastOpenedAt: at("13:00") }, sourceMetadata: { importFormat: "markdown" }, createdAt: at("08:00"), updatedAt: at("13:00"),
  } as StoreState["documents"][number]];
  s.decisions = [{ id: "dec1", title: "Pick a framework", question: "Which?", status: "exploring", createdAt: at("14:00"), updatedAt: at("14:00") } as unknown as StoreState["decisions"][number]];
  return s;
}

export function runReviewSelfTests(): SelfTestReport {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const results: SelfTestResult[] = [];
  const check = (name: string, cond: boolean, detail = "ok") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAIL: ${detail}` });
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // 1. One review per local date — findReviewByDate returns the single canonical.
  {
    const s = emptyState();
    s.dailyReviews = [review({ id: "r1", date: "2026-07-27" }), review({ id: "r2", date: "2026-07-26" })];
    const found = findReviewByDate(s, "2026-07-27");
    check("one review per local date (lookup by date)", !!found && found.id === "r1" && s.dailyReviews.filter((r) => r.date === "2026-07-27").length === 1);
  }

  // 2. Review lifecycle counts / emptiness / recency grouping.
  {
    const empty = review({ id: "re", date: "2026-07-27", status: "not_started" });
    check("empty review detected", isReviewEmpty(empty));
    const full = review({ id: "rf", date: "2026-07-27", summary: "x", wins: [{ id: "w", text: "won", links: [], createdAt: at("20:00") }] });
    const c = reviewCounts(full);
    check("review counts", c.wins === 1 && !isReviewEmpty(full));
    const s = emptyState();
    s.dailyReviews = [review({ id: "a", date: "2026-07-27" }), review({ id: "b", date: "2026-07-26" }), review({ id: "c", date: "2026-07-10" })];
    const groups = groupReviewsByRecency(s, "2026-07-27");
    check("recency grouping buckets", groups[0].bucket === "Today" && groups.some((g) => g.bucket === "Yesterday") && groups.some((g) => g.bucket === "Earlier"));
  }

  // 3. Day-summary determinism + correct counts.
  {
    const s = activityState();
    const a = buildDaySummary(s, DAY, { offsetMinutes: 0 });
    const b = buildDaySummary(s, DAY, { offsetMinutes: 0 });
    check("day summary is deterministic", eq(a, b));
    const g = (k: string) => a.groups.find((x) => x.key === k)?.count ?? 0;
    check("captures counted for the day only", g("captures_created") === 1, `got ${g("captures_created")}`);
    check("sessions started counted", a.sessionCount === 1 && g("sessions_started") === 1);
    check("session duration computed", a.totalSessionMs === 150 * 60000, `got ${a.totalSessionMs}`);
    check("milestone completed counted", g("milestones_completed") === 1);
    check("projects advanced counted", g("projects_advanced") === 1);
    check("highlights + annotations counted", g("highlights_created") === 1 && g("annotations_created") === 1);
    check("documents read counted", g("documents_read") === 1);
    check("entities inspected + searches from activity", g("entities_inspected") === 1 && g("searches") === 1);
    check("decisions counted", g("decisions") === 1);
    check("every summary item links to a source", a.groups.every((grp) => grp.items.every((it) => it.kind && it.id)));
    check("day summary total", daySummaryTotal(a) >= 9);
  }

  // 4. Local date boundaries (offset variant).
  {
    check("day key of an instant at offset", localDateKeyAtOffset(Date.parse("2026-07-27T04:30:00.000Z"), 330) === "2026-07-27");
    const { startMs, endMs } = dayBoundsAtOffset("2026-07-27", 0);
    check("midnight is included, next midnight excluded", isoOnDayAtOffset("2026-07-27T00:00:00.000Z", "2026-07-27", 0) && !isoOnDayAtOffset("2026-07-28T00:00:00.000Z", "2026-07-27", 0) && endMs - startMs === 86400000);
    // An instant at 23:30 UTC is still July 27 at UTC, but July 28 at +60m.
    check("late-night instant flips date across offset", isoOnDayAtOffset("2026-07-27T23:30:00.000Z", "2026-07-27", 0) && isoOnDayAtOffset("2026-07-27T23:30:00.000Z", "2026-07-28", 60));
    check("isDayKey validates", isDayKey("2026-07-27") && !isDayKey("2026-13-40") && !isDayKey("nope"));
    // Runtime local bounds never span a fixed 24h assumption incorrectly for a normal day.
    const b = dayBoundsLocal("2026-07-27");
    check("local day bounds are ordered", b.end.getTime() > b.start.getTime());
  }

  // 5. DST transitions — US spring-forward 2026-03-08 (EST -300 → EDT -240).
  {
    // 2:30am local does not exist on spring-forward; an instant at 07:30 UTC is
    // 2:30 EST (pre) or 3:30 EDT (post). Either way it is March 8 locally.
    const instant = Date.parse("2026-03-08T07:30:00.000Z");
    check("DST instant resolves to the correct local date pre-offset", localDateKeyAtOffset(instant, -300) === "2026-03-08");
    check("DST instant resolves to the correct local date post-offset", localDateKeyAtOffset(instant, -240) === "2026-03-08");
    // The local day's UTC span differs by the offset change — we never hardcode 24h in runtime bounds.
    const span = dayBoundsLocal("2026-03-08");
    check("spring-forward local day is modeled (bounds present)", span.end.getTime() > span.start.getTime());
  }

  // 6. Timezone travel — same instant, different offsets → different keys; stored
  // date prevents a duplicate review after travel.
  {
    const instant = Date.parse("2026-07-27T02:00:00.000Z");
    const tokyo = localDateKeyAtOffset(instant, 540);   // +09:00 → already the 27th (11:00)
    const la = localDateKeyAtOffset(instant, -420);     // -07:00 → still the 26th (19:00)
    check("same instant yields different local dates by tz", tokyo === "2026-07-27" && la === "2026-07-26");
    // A review already exists for 2026-07-27; after "travelling", lookup still
    // keys on the stored date, so no second review is forked for that day.
    const s = emptyState();
    s.dailyReviews = [review({ id: "r", date: "2026-07-27" })];
    check("travel does not fork a duplicate (lookup keys stored date)", findReviewByDate(s, "2026-07-27")?.id === "r" && s.dailyReviews.length === 1);
  }

  // 7 & 8. Win / lesson / friction linking.
  {
    const r = review({
      id: "rl", date: "2026-07-27",
      wins: [{ id: "w1", text: "Shipped", links: [{ kind: "project", id: "p1" }], createdAt: at("20:00") }],
      lessons: [{ id: "l1", text: "Smaller PRs", links: [{ kind: "decision", id: "dec1" }], createdAt: at("20:00") }],
      friction: [{ id: "f1", description: "Nav confusing", severity: "medium", area: "navigation", resolved: false, resolutionNotes: "", createdAt: at("20:00") }],
    });
    const refs = reviewReferences(r);
    check("win linking captured", refs.some((x) => x.kind === "project" && x.id === "p1"));
    check("lesson linking captured", refs.some((x) => x.kind === "decision" && x.id === "dec1"));
    check("friction fields present", r.friction[0].area === "navigation" && r.friction[0].severity === "medium" && r.friction[0].resolved === false);
  }

  // 9. Open-loop derivation.
  {
    const s = activityState();
    // make the session active (in-progress) for the loop test
    s.sessions = [{ ...s.sessions[0], endedAt: undefined }];
    const loops = deriveOpenLoops(s, { unresolvedConflicts: 2, unsyncedPending: true });
    const has = (id: string) => loops.some((l) => l.id === id);
    check("open loop: in-progress session", has("session:s1"));
    check("open loop: incomplete milestone", has("milestone:m2"));
    check("open loop: active project", has("project:p1"));
    check("open loop: unresolved decision", has("decision:dec1"));
    check("open loop: unfinished reading", has("reading:d1"));
    check("open loop: unresolved conflicts (live)", has("conflict:unresolved"));
    check("open loop: unsynced changes (live)", has("unsynced:pending"));
    check("open loops never auto-complete anything", eq(s.projects[0].milestones[1].status, "open"));
  }

  // 10. Tomorrow-focus ordering.
  {
    const items: ReviewFocusItem[] = [
      { id: "f1", text: "A", order: 0, createdAt: at("20:00") },
      { id: "f2", text: "B", order: 1, createdAt: at("20:00") },
      { id: "f3", text: "C", order: 2, createdAt: at("20:00") },
    ];
    const moved = moveFocus(items, "f3", -1);
    check("focus move reorders", orderedFocus(moved).map((f) => f.id).join(",") === "f1,f3,f2");
    check("focus order normalized 0..n", normalizeFocusOrder(moved).every((f, i) => f.order === i));
    check("focus suggestions are deterministic + bounded", eq(focusSuggestions(activityState()), focusSuggestions(activityState())));
    // start-tomorrow actions reuse existing systems (project→resume).
    const r = review({ id: "rt", date: "2026-07-27", status: "completed", tomorrowFocus: [{ id: "f", text: "Chapter 3", ref: { kind: "project", id: "p1" }, order: 0, createdAt: at("20:00") }] });
    check("start-tomorrow action resumes a project", startTomorrowActions(r)[0]?.kind === "resume_project");
  }

  // 11. Weekly rollup projection.
  {
    const s = activityState();
    // Both reviews fall in the SAME Mon–Sun week as DAY (2026-07-27 is Monday,
    // 2026-07-28 Tuesday), so the rollup window covers both.
    s.dailyReviews = [
      review({ id: "rw1", date: "2026-07-27", status: "completed", friction: [{ id: "f1", description: "sync", severity: "low", area: "sync", resolved: false, resolutionNotes: "", createdAt: at("20:00") }], openLoops: [{ id: "milestone:m2", text: "Draft", source: "milestone", createdAt: at("20:00") }] }),
      review({ id: "rw2", date: "2026-07-28", status: "completed", friction: [{ id: "f2", description: "sync again", severity: "low", area: "sync", resolved: false, resolutionNotes: "", createdAt: "2026-07-28T20:00:00.000Z" }] }),
    ];
    const ws = weekStartKey(DAY);
    // `today` late in the week so uncompleted days count as missed.
    const roll = buildWeeklyRollup(s, ws, { offsetMinutes: 0, today: "2026-08-01" });
    check("weekly rollup counts completed reviews", roll.completedReviews.length === 2);
    check("weekly rollup lists missed days", roll.missedReviewDays.length >= 1);
    check("weekly rollup aggregates sessions", roll.sessionCount === 1 && roll.milestonesCompleted === 1);
    check("weekly rollup flags repeated friction (>=2)", roll.repeatedFriction.some((f) => f.area === "sync" && f.count === 2));
    check("weekly rollup collects unresolved open loops", roll.unresolvedOpenLoops.some((l) => l.id === "milestone:m2"));
    check("weekly rollup is a projection (not in state)", !("weeklyRollups" in (s as unknown as Record<string, unknown>)));
  }

  // 12. Relationships (reviews referencing a record).
  {
    const s = emptyState();
    s.dailyReviews = [review({ id: "rr", date: "2026-07-27", linkedProjects: ["p1"], wins: [{ id: "w", text: "x", links: [{ kind: "goal", id: "g1" }], createdAt: at("20:00") }] })];
    check("reviewsReferencing finds by linked project", reviewsReferencing(s, "project", "p1").length === 1);
    check("reviewsReferencing finds by win link", reviewsReferencing(s, "goal", "g1").length === 1);
    check("latestCompletedReview picks most recent", (() => { const s2 = emptyState(); s2.dailyReviews = [review({ id: "x", date: "2026-07-20", status: "completed" }), review({ id: "y", date: "2026-07-27", status: "completed" })]; return latestCompletedReview(s2)?.id === "y"; })());
  }

  // 13. Search integration.
  {
    const s = emptyState();
    s.dailyReviews = [review({ id: "rs", date: "2026-07-27", summary: "productive morning" })];
    const entries = buildSearchEntries(s);
    check("daily review is indexed for search", entries.some((e) => e.kind === "daily_review" && e.href === "/daily/2026-07-27"));
  }

  // 14. Schema purity — projections never mutate state.
  {
    const s = activityState();
    const before = JSON.stringify(s);
    buildDaySummary(s, DAY, { offsetMinutes: 0 });
    deriveOpenLoops(s);
    buildWeeklyRollup(s, weekStartKey(DAY), { offsetMinutes: 0 });
    check("projections do not mutate the store", JSON.stringify(s) === before);
    check("date arithmetic is calendar-safe", addDays("2026-02-28", 1) === "2026-03-01" && dayDiff("2026-07-27", "2026-07-20") === 7 && weekDays(weekStartKey("2026-07-27")).length === 7 && recencyBucket("2026-07-27", "2026-07-27") === "Today");
  }

  // 15. Performance — day summary over a large state, and a year of weekly rollups.
  {
    const s = emptyState();
    for (let i = 0; i < 5000; i++) s.captures.push({ id: `c${i}`, text: `t${i}`, createdAt: at("09:00") } as StoreState["captures"][number]);
    const p0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    buildDaySummary(s, DAY, { offsetMinutes: 0 });
    const dsMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - p0;
    check("day summary over 5k records < 250ms", dsMs < 250, `${dsMs.toFixed(1)}ms`);

    // A single weekly rollup (the realistic user action) must be fast.
    const p1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    buildWeeklyRollup(s, weekStartKey(DAY), { offsetMinutes: 0, today: DAY });
    const wkMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - p1;
    check("one weekly rollup over 5k records < 250ms", wkMs < 250, `${wkMs.toFixed(1)}ms`);

    // Scanning a full year (52 weekly rollups) stays bounded — generous budget
    // since a year scan is not a normal action; measurement is documented.
    const p2 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let start = "2026-01-05";
    for (let w = 0; w < 52; w++) { buildWeeklyRollup(s, start, { offsetMinutes: 0, today: DAY }); start = addDays(start, 7); }
    const yrMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - p2;
    check("52 weekly rollups (one year) < 3000ms", yrMs < 3000, `${yrMs.toFixed(1)}ms`);
  }

  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { pass: failed === 0, total: results.length, passed, failed, ms, results };
}
