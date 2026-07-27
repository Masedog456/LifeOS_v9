/**
 * Workspaces & sessions self-tests (LIFEOS-030).
 *
 * Fixture-driven, deterministic assertions for the workspace/session engine —
 * membership, session lifecycle & outputs, activity policy & resume memory,
 * workspace-scoped search, entity↔workspace relationships, the session timeline,
 * the dashboard projection, determinism, and a performance budget. Surfaced at
 * `/dev/workspace-tests`, asserted by the `workspaces.mjs` E2E suite. Pure: no
 * store, no localStorage, no AI.
 */

import type {
  Belief, Capture, Concept, Decision, ReadingDocument, StoreState, Workspace, WorkspaceSession,
} from "@/types/mvp";
import { makeEntityContext } from "@/lib/entities/entity";
import {
  activeWorkspaces, entityWorkspaces, isMember, workspaceEntities, workspaceReferenced,
  workspaceSummary, memberBreakdown,
} from "@/lib/workspaces/workspace";
import {
  activeSession, sessionsForWorkspace, sessionDuration, formatDuration, sessionOutputs,
  groupSessionsByRecency, recencyBucket, SESSION_TYPES,
} from "@/lib/workspaces/sessions";
import { shouldRecord, appendActivity, resumePatchFor, summarizeActivity } from "@/lib/workspaces/activity";
import { mergeResume, resumeTarget, hasResume } from "@/lib/workspaces/resume";
import { workspaceScopeKeys, searchWorkspaceFlat } from "@/lib/workspaces/search";
import { workspaceDashboard } from "@/lib/workspaces/dashboard";
import { buildIndex } from "@/lib/command/search";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [],
  };
}
const belief = (p: Partial<Belief> & { id: string; text: string }): Belief => ({ captureId: "", proposalId: "", status: "accepted", createdAt: iso(40), updatedAt: iso(40), revisions: [], judgments: [], ...p });
const capture = (p: Partial<Capture> & { id: string; text: string }): Capture => ({ createdAt: iso(50), ...p });
const concept = (p: Partial<Concept> & { id: string; name: string }): Concept => ({ aliases: [], definition: "", description: "", relatedBeliefs: [], relatedThreads: [], relatedSources: [], relatedPractices: [], parentConcepts: [], childConcepts: [], relatedConcepts: [], opposingConcepts: [], principleIds: [], questions: [], history: [], status: "active", source: "user", createdAt: iso(45), updatedAt: iso(10), ...p });
const decision = (p: Partial<Decision> & { id: string; title: string }): Decision => ({ question: "", status: "exploring", options: [], criteria: [], ratings: {}, constraints: [], assumptions: [], seedRefs: [], evidence: [], history: [], judgments: [], revisions: [], outcomeReviews: [], aiModel: "mock", source: "mock", coverage: null, partial: false, verified: false, createdAt: iso(30), updatedAt: iso(30), ...p });

const activityEvent = (over: Partial<WorkspaceSession["activity"][number]> & { id: string; type: WorkspaceSession["activity"][number]["type"] }) => ({ at: hoursAgo(1), label: "", ...over });

function richState(): StoreState {
  const s = emptyState();
  s.captures = [capture({ id: "cap-1", text: "A thought about attention." }), capture({ id: "cap-2", text: "Idea for the pool business pricing." })];
  s.beliefs = [
    belief({ id: "b-attn", text: "Attention is the scarcest resource.", theme: "attention" }),
    belief({ id: "b-free", text: "Freedom needs discipline." }),
  ];
  s.concepts = [concept({ id: "c-attn", name: "attention", relatedBeliefs: ["b-attn"] })];
  s.decisions = [decision({ id: "dec-1", title: "Quit social media", seedRefs: ["b-attn"] })];
  s.documents = [{
    id: "doc-1", title: "The Attention Essays", subtitle: "", authors: ["Simone Weil"], kind: "book", status: "reading",
    tags: [], notes: "", sections: [{ id: "sec-1", title: "One", order: 0, passages: [{ id: "p-1", sectionId: "sec-1", text: "Attention is generosity.", order: 0, highlights: [], annotations: [], linked: [{ kind: "belief", id: "b-attn" }] }] }],
    progress: { status: "reading", percent: 20, readPassageIds: [], startedAt: iso(9) }, sourceMetadata: { importFormat: "markdown" }, createdAt: iso(15), updatedAt: iso(6),
  } as ReadingDocument];

  const ws: Workspace = {
    id: "ws-1", name: "Philosophy Thesis", description: "Attention & freedom.", color: undefined,
    goals: [{ id: "g-1", text: "Draft chapter 1", done: false, createdAt: iso(5) }, { id: "g-2", text: "Read Weil", done: true, createdAt: iso(6) }],
    members: [
      { kind: "belief", id: "b-attn" }, { kind: "document", id: "doc-1" },
      { kind: "decision", id: "dec-1" }, { kind: "concept", id: "c-attn" },
      { kind: "belief", id: "gone" }, // a deleted member — must be dropped gracefully
    ],
    pinned: [{ kind: "belief", id: "b-attn" }],
    resume: { lastDocumentId: "doc-1", lastEntity: { kind: "belief", id: "b-attn" }, at: hoursAgo(2) },
    archived: false, createdAt: iso(20), updatedAt: iso(1),
  };
  const wsArchived: Workspace = { ...ws, id: "ws-old", name: "Old", members: [], pinned: [], goals: [], resume: {}, archived: true };

  const active: WorkspaceSession = {
    id: "ses-1", workspaceId: "ws-1", type: "thinking", goal: "outline", notes: "", startedAt: hoursAgo(1),
    activity: [
      activityEvent({ id: "a1", type: "opened_entity", entityKind: "belief", entityId: "b-attn", label: "Opened belief" }),
      activityEvent({ id: "a2", type: "opened_document", entityKind: "document", entityId: "doc-1", label: "Opened document" }),
      activityEvent({ id: "a3", type: "reading", entityKind: "document", entityId: "doc-1", label: "Read" }),
      activityEvent({ id: "a4", type: "capture_created", entityKind: "capture", entityId: "cap-1", label: "Captured" }),
      activityEvent({ id: "a5", type: "decision_edited", entityKind: "decision", entityId: "dec-1", label: "Worked on decision" }),
    ],
  };
  const past: WorkspaceSession = { id: "ses-0", workspaceId: "ws-1", type: "reading", goal: "", notes: "notes", startedAt: iso(1.1), endedAt: iso(1.05), activity: [] };
  s.workspaces = [ws, wsArchived];
  s.sessions = [active, past];
  return s;
}

export function runWorkspaceSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  const state = richState();
  const ctx = makeEntityContext(state);
  const ws = state.workspaces[0];

  // --- Workspace model & membership (Feature 1, 10) ---
  ok("1. activeWorkspaces excludes archived", activeWorkspaces(state).length === 1 && activeWorkspaces(state)[0].id === "ws-1");
  ok("2. entityWorkspaces finds membership", entityWorkspaces(state, "belief", "b-attn").some((w) => w.id === "ws-1"));
  ok("3. entityWorkspaces empty for non-member", entityWorkspaces(state, "belief", "b-free").length === 0);
  ok("4. isMember true/false", isMember(ws, "document", "doc-1") && !isMember(ws, "belief", "b-free"));
  ok("5. workspaceEntities drops deleted members", workspaceEntities(ctx, ws).length === 4, `got ${workspaceEntities(ctx, ws).length}`);
  ok("6. workspaceSummary non-empty", workspaceSummary(ctx, ws).length > 0);
  const bd = memberBreakdown(ctx, ws);
  ok("7. memberBreakdown counts by kind", bd.reduce((n, b) => n + b.count, 0) === 4 && bd.length === 4);

  // --- Session lifecycle & outputs (Feature 2, 7) ---
  ok("8. activeSession is the unended one", activeSession(state)?.id === "ses-1");
  ok("9. sessionsForWorkspace newest-first", sessionsForWorkspace(state, "ws-1").map((s) => s.id).join(",") === "ses-1,ses-0");
  ok("10. active session duration > 0", sessionDuration(state.sessions[0], NOW) > 0);
  ok("11. ended session duration bounded", sessionDuration(state.sessions[1], NOW) > 0 && sessionDuration(state.sessions[1], NOW) < 86400000);
  ok("12. formatDuration compact", formatDuration(3720000) === "1h 2m", formatDuration(3720000));
  ok("13. SESSION_TYPES has 8 modes", SESSION_TYPES.length === 8);
  const out = sessionOutputs(state.sessions[0]);
  ok("14. sessionOutputs derives from activity", out.entitiesOpened === 1 && out.documentsRead === 1 && out.capturesCreated === 1 && out.decisionsMade === 1, JSON.stringify(out));

  // --- Session timeline recency (Feature 7) ---
  ok("15. recencyBucket today vs yesterday", recencyBucket(hoursAgo(1), NOW) === "today" && recencyBucket(iso(1.1), NOW) === "yesterday");
  const groups = groupSessionsByRecency(sessionsForWorkspace(state, "ws-1"), NOW);
  ok("16. groupSessionsByRecency splits buckets", groups.today.length === 1 && groups.yesterday.length === 1);

  // --- Activity policy & resume (Feature 5, 6) ---
  const s0 = state.sessions[0];
  const dupCandidate = { type: "opened_entity" as const, entityKind: "decision", entityId: "dec-1", label: "Worked on decision" };
  // Last event is a decision_edited with same label but different type → still recordable.
  ok("17. shouldRecord allows a distinct event", shouldRecord(s0, dupCandidate, NOW));
  const sameAsLast = { type: "decision_edited" as const, entityKind: "decision", entityId: "dec-1", label: "Worked on decision" };
  ok("18. shouldRecord rejects an immediate duplicate", !shouldRecord(s0, sameAsLast, new Date(s0.activity[s0.activity.length - 1].at).getTime() + 1000));
  const appended = appendActivity(s0, { id: "x", at: hoursAgo(0), type: "note", label: "note" });
  ok("19. appendActivity is immutable + appends", appended.activity.length === s0.activity.length + 1 && s0.activity.length === 5);
  ok("20. resumePatchFor(opened_entity) sets lastEntity", resumePatchFor({ type: "opened_entity", entityKind: "belief", entityId: "b-attn", label: "" }, hoursAgo(0)).lastEntity?.id === "b-attn");
  ok("21. resumePatchFor(search) sets lastSearch", resumePatchFor({ type: "search", label: "", detail: "attention" }, hoursAgo(0)).lastSearch === "attention");
  ok("22. mergeResume never clobbers with undefined", mergeResume({ lastSearch: "keep" }, { lastEntity: { kind: "belief", id: "x" } }).lastSearch === "keep");
  const summary = summarizeActivity(s0.activity);
  ok("23. summarizeActivity counts uniques", summary.uniqueDocuments === 1 && summary.uniqueEntities >= 1 && summary.total === 5);

  // --- Resume target (Feature 6) ---
  ok("24. hasResume true when memory present", hasResume(ws) && !hasResume(state.workspaces[1]));
  const target = resumeTarget(ctx, ws);
  ok("25. resumeTarget prefers last document", target.href === "/document/doc-1", target.href);

  // --- Workspace search (Feature 9) ---
  const keys = workspaceScopeKeys(state, ws);
  ok("26. workspaceScopeKeys includes members + passages", keys.has("belief:b-attn") && keys.has("passage:p-1") && !keys.has("belief:b-free"));
  const index = buildIndex(state);
  const inScope = searchWorkspaceFlat(index, state, ws, "attention", 20);
  const bFree = searchWorkspaceFlat(index, state, ws, "freedom discipline", 20);
  ok("27. workspace search finds in-scope matches", inScope.length > 0);
  ok("28. workspace search excludes out-of-scope", !bFree.some((r) => r.entry.id === "b-free"));

  // --- Referenced frontier (Feature 10) ---
  const referenced = workspaceReferenced(ctx, ws, 20);
  const memberKeys = new Set(ws.members.map((m) => `${m.kind}:${m.id}`));
  ok("29. referenced excludes members", referenced.every((r) => !memberKeys.has(`${r.ref.kind}:${r.ref.id}`)));

  // --- Dashboard projection (Feature 4) ---
  const dash = workspaceDashboard(ctx, ws, NOW);
  ok("30. dashboard overview counts members", dash.overview.memberCount === 4 && dash.overview.openGoals === 1);
  ok("31. dashboard groups reading + themes + decisions", dash.reading.length === 1 && dash.themes.length === 1 && dash.recentDecisions.length === 1);
  ok("32. dashboard pinned resolved", dash.pinned.length === 1 && dash.pinned[0].id === "b-attn");
  ok("33. dashboard session timeline populated", dash.sessions.today.length === 1);

  // --- Determinism ---
  ok("34. dashboard is deterministic", JSON.stringify(workspaceDashboard(ctx, ws, NOW)) === JSON.stringify(workspaceDashboard(makeEntityContext(richState()), richState().workspaces[0], NOW)));

  // --- Performance budget ---
  const big = richState();
  for (let i = 0; i < 200; i++) big.workspaces.push({ ...big.workspaces[0], id: `w${i}`, name: `WS ${i}` });
  const bigCtx = makeEntityContext(big);
  const p0 = Date.now();
  for (const w of activeWorkspaces(big)) workspaceDashboard(bigCtx, w, NOW);
  const perfMs = Date.now() - p0;
  ok("35. 200 workspace dashboards under budget", perfMs < 1500, `${perfMs}ms`);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
