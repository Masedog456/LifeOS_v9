/**
 * Goals, projects & execution self-tests (LIFEOS-031).
 *
 * Fixture-driven, deterministic assertions for the execution engine — goal &
 * project models, milestones, the derived progress engine (never inferring
 * completion), entity↔goal/project relationships, session attribution, search,
 * dashboards, determinism, and a performance budget. Surfaced at
 * `/dev/execution-tests`, asserted by `execution.mjs`. Pure: no store, no
 * localStorage, no AI.
 */

import type {
  Belief, Goal, Milestone, Project, ReadingDocument, StoreState, WorkspaceSession,
} from "@/types/mvp";
import { makeEntityContext } from "@/lib/entities/entity";
import { listGoals, activeGoals, goalProjects, entityGoals, GOAL_KIND } from "@/lib/execution/goals";
import { listProjects, entityProjects, PROJECT_KIND } from "@/lib/execution/projects";
import { milestoneCounts, projectProgress, goalProgress, toggleMilestoneDone } from "@/lib/execution/progress";
import { sortedMilestones, nextOpenMilestone } from "@/lib/execution/milestones";
import { entityExecutionLinks } from "@/lib/execution/relationships";
import { goalSessions, projectSessions, contribution } from "@/lib/execution/tracking";
import { goalDashboard, projectDashboard } from "@/lib/execution/dashboard";
import { buildIndex, searchFlat } from "@/lib/command/search";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
    protocols: [],
    constitutionElements: [],
    constitutionRevisions: [],
  };
}
const belief = (p: Partial<Belief> & { id: string; text: string }): Belief => ({ captureId: "", proposalId: "", status: "accepted", createdAt: iso(40), updatedAt: iso(40), revisions: [], judgments: [], ...p });
const milestone = (p: Partial<Milestone> & { id: string; title: string }): Milestone => ({ status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: iso(10), updatedAt: iso(10), ...p });
const activityEvent = (over: Partial<WorkspaceSession["activity"][number]> & { id: string; type: WorkspaceSession["activity"][number]["type"] }) => ({ at: hoursAgo(1), label: "", ...over });

function richState(): StoreState {
  const s = emptyState();
  s.beliefs = [belief({ id: "b-attn", text: "Attention is the scarcest resource.", theme: "attention" })];
  s.documents = [{
    id: "doc-1", title: "The Attention Essays", subtitle: "", authors: ["Simone Weil"], kind: "book", status: "reading",
    tags: [], notes: "", sections: [{ id: "sec-1", title: "One", order: 0, passages: [{ id: "p-1", sectionId: "sec-1", text: "Attention is generosity.", order: 0, highlights: [], annotations: [], linked: [] }] }],
    progress: { status: "reading", percent: 40, readPassageIds: [], startedAt: iso(9) }, sourceMetadata: { importFormat: "markdown" }, createdAt: iso(15), updatedAt: iso(6),
  } as ReadingDocument];

  const goalA: Goal = {
    id: "g-thesis", title: "Finish Philosophy Thesis", description: "Attention & freedom.", status: "active", priority: "high",
    targetDate: "2026-12-01", notes: "", tags: ["philosophy"], linkedWorkspaces: [], linkedKnowledge: [{ kind: "belief", id: "b-attn" }],
    createdAt: iso(30), updatedAt: iso(2),
  };
  const goalB: Goal = {
    id: "g-read", title: "Read 100 Books", description: "", status: "active", priority: "low",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], createdAt: iso(25), updatedAt: iso(5),
  };
  const goalDone: Goal = { ...goalB, id: "g-done", title: "Learn Sanskrit basics", status: "completed", priority: "medium" };

  // Project P1: 4 milestones, 2 done → 50%
  const p1: Project = {
    id: "pr-1", title: "Chapter 1 draft", description: "", status: "active", priority: "high",
    goalId: "g-thesis", workspaceId: "ws-1", startDate: "2026-09-01", targetDate: "2026-11-01", notes: "notes",
    milestones: [
      milestone({ id: "m1", title: "Outline", status: "done", completedDate: iso(8), targetDate: "2026-09-10" }),
      milestone({ id: "m2", title: "Draft", status: "done", completedDate: iso(4), targetDate: "2026-09-20" }),
      milestone({ id: "m3", title: "Revise", status: "open", targetDate: "2026-10-15" }),
      milestone({ id: "m4", title: "Cite", status: "open" }),
    ],
    relatedDocuments: [{ kind: "document", id: "doc-1" }], relatedEntities: [{ kind: "belief", id: "b-attn" }],
    createdAt: iso(20), updatedAt: iso(3),
  };
  // Project P2: no milestones, status completed → 100%
  const p2: Project = {
    id: "pr-2", title: "Bibliography", description: "", status: "completed", priority: "medium",
    goalId: "g-thesis", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: iso(18), updatedAt: iso(7),
  };
  // Project P3: manual override 80
  const p3: Project = {
    id: "pr-3", title: "Reading log", description: "", status: "active", priority: "low",
    goalId: "g-read", notes: "", milestones: [], manualProgress: 80, relatedDocuments: [{ kind: "document", id: "doc-1" }], relatedEntities: [],
    createdAt: iso(12), updatedAt: iso(1),
  };

  const session: WorkspaceSession = {
    id: "ses-1", workspaceId: "ws-1", type: "writing", goal: "draft chapter 1", goalId: "g-thesis", projectId: "pr-1",
    notes: "", startedAt: hoursAgo(2), endedAt: hoursAgo(1),
    activity: [
      activityEvent({ id: "a1", type: "opened_entity", entityKind: "belief", entityId: "b-attn", label: "Opened belief" }),
      activityEvent({ id: "a2", type: "reading", entityKind: "document", entityId: "doc-1", label: "Read" }),
      activityEvent({ id: "a3", type: "capture_created", entityKind: "capture", entityId: "cap-x", label: "Captured" }),
    ],
  };

  s.goals = [goalA, goalB, goalDone];
  s.projects = [p1, p2, p3];
  s.sessions = [session];
  return s;
}

export function runExecutionSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  const state = richState();
  const ctx = makeEntityContext(state);
  const goal = state.goals[0];
  const p1 = state.projects[0];

  // --- Goal & project models (Features 1, 2) ---
  ok("1. listGoals sorts by priority (high first)", listGoals(state)[0].id === "g-thesis", listGoals(state)[0].id);
  ok("2. activeGoals excludes completed", !activeGoals(state).some((g) => g.status === "completed"));
  ok("3. goalProjects finds a goal's projects", goalProjects(state, "g-thesis").length === 2);
  ok("4. entityGoals resolves linked knowledge", entityGoals(state, "belief", "b-attn").some((g) => g.id === "g-thesis"));
  ok("5. listProjects sorts by priority", listProjects(state)[0].priority === "high");
  ok("6. entityProjects resolves related entities", entityProjects(state, "belief", "b-attn").some((p) => p.id === "pr-1"));

  // --- Milestones (Feature 3) ---
  const mc = milestoneCounts(p1);
  ok("7. milestoneCounts: 2 of 4 done", mc.total === 4 && mc.done === 2 && mc.open === 2, JSON.stringify(mc));
  ok("8. sortedMilestones by target date (dated first)", sortedMilestones(p1)[0].id === "m1");
  ok("9. nextOpenMilestone is the first open", nextOpenMilestone(p1)?.id === "m3", nextOpenMilestone(p1)?.id);
  const toggled = toggleMilestoneDone(p1.milestones[2], iso(0));
  ok("10. toggleMilestoneDone stamps completedDate", toggled.status === "done" && Boolean(toggled.completedDate));
  ok("11. toggle again clears completedDate", toggleMilestoneDone(toggled, iso(0)).completedDate === undefined);

  // --- Progress engine (Feature 7 — deterministic, never inferred) ---
  ok("12. project progress from milestones (50%)", projectProgress(p1) === 50, `${projectProgress(p1)}`);
  ok("13. completed project, no milestones → 100%", projectProgress(state.projects[1]) === 100);
  ok("14. manual override wins (80%)", projectProgress(state.projects[2]) === 80);
  ok("15. goal progress = avg of live projects", goalProgress(goal, state.projects) === Math.round((50 + 100) / 2), `${goalProgress(goal, state.projects)}`);
  ok("16. goal with no projects + completed → 100", goalProgress(state.goals[2], state.projects) === 100);
  ok("17. active goal with no live projects → 0", goalProgress({ ...state.goals[1], id: "g-empty" }, []) === 0);
  ok("18. progress never flips status (100% but still active)", state.projects[2].status === "active" && projectProgress(state.projects[2]) === 80);

  // --- Relationships (Feature 8) ---
  const links = entityExecutionLinks(ctx, "belief", "b-attn");
  ok("19. entity links: contributes to goal + related project", links.contributesToGoals.some((r) => r.id === "g-thesis") && links.relatedProjects.some((r) => r.id === "pr-1"));
  ok("20. goal entity → child projects", entityExecutionLinks(ctx, GOAL_KIND, "g-thesis").childProjects.length === 2);
  ok("21. project entity → parent goal", entityExecutionLinks(ctx, PROJECT_KIND, "pr-1").parentGoal?.id === "g-thesis");

  // --- Session attribution (Feature 6) ---
  ok("22. goalSessions include project-linked sessions", goalSessions(state, "g-thesis").some((s) => s.id === "ses-1"));
  ok("23. projectSessions direct link", projectSessions(state, "pr-1").length === 1);
  const contrib = contribution(projectSessions(state, "pr-1"));
  ok("24. contribution derives captures + reading from activity", contrib.knowledgeCreated === 1 && contrib.documentsRead === 1, JSON.stringify(contrib));

  // --- Search (Feature 11) ---
  const index = buildIndex(state);
  ok("25. goals are searchable", searchFlat(index, "Philosophy Thesis", 10).some((r) => r.entry.kind === "goal"));
  ok("26. projects are searchable", searchFlat(index, "Chapter 1 draft", 10).some((r) => r.entry.kind === "project"));
  ok("27. milestones are searchable", searchFlat(index, "Outline", 10).some((r) => r.entry.kind === "milestone"));

  // --- Dashboards (Features 4, 5) ---
  const gd = goalDashboard(ctx, goal, NOW);
  ok("28. goal dashboard: progress + project/milestone rollup", gd.progress === 75 && gd.projects.length === 2 && gd.overview.milestones.total === 4);
  ok("29. goal dashboard: sessions + next milestones", gd.overview.sessionCount === 1 && gd.nextMilestones.length >= 1);
  const pd = projectDashboard(ctx, p1, NOW);
  ok("30. project dashboard: progress + goal + reading", pd.progress === 50 && pd.goal?.id === "g-thesis" && pd.reading.length === 1);
  ok("31. project dashboard: milestones + related entities", pd.milestones.total === 4 && pd.recentEntities.length >= 1);

  // --- Determinism ---
  ok("32. goal dashboard deterministic", JSON.stringify(goalDashboard(ctx, goal, NOW)) === JSON.stringify(goalDashboard(makeEntityContext(richState()), richState().goals[0], NOW)));

  // --- Performance ---
  const big = richState();
  for (let i = 0; i < 200; i++) big.goals.push({ ...big.goals[0], id: `g${i}`, title: `Goal ${i}` });
  const bigCtx = makeEntityContext(big);
  const p0 = Date.now();
  for (const g of listGoals(big)) goalDashboard(bigCtx, g, NOW);
  const perfMs = Date.now() - p0;
  ok("33. 200 goal dashboards under budget", perfMs < 1500, `${perfMs}ms`);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
