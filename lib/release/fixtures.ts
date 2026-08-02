/**
 * Deterministic release-validation fixture (LIFEOS-042, Feature 24).
 *
 * A single, fully-deterministic dataset (fixed IDs and timestamps) that exercises
 * every major record type: workspace, goal, project + two milestones, several
 * next actions + a dependency, an active and a completed session, captures in
 * multiple processing states, a document with sections/passages +
 * highlight/annotation/citation, a belief, a research record, a daily review,
 * planning assignments, a focus session, a maintenance candidate + a resolved
 * event, insight history, archived and discarded records, one conflict, and one
 * tombstone.
 *
 * Every record is tagged with `FIXTURE_TAG` + `fixtureId`, so it is clearly
 * marked, never mistaken for the user's own data, never auto-created, and
 * removable in ONE operation. Used by screenshots, export/restore verification,
 * and the release E2E. Reuses the sample-workspace merge/remove shape.
 */

import type { StoreState } from "@/types/mvp";

export const FIXTURE_TAG = "lifeos-release-fixture";

/** A fixed base instant so the fixture is byte-stable across runs. */
export const FIXTURE_BASE_ISO = "2026-01-15T09:00:00.000Z";

export interface ReleaseFixture {
  fixtureId: string;
  records: Partial<Record<keyof StoreState, unknown[]>>;
  tombstones: unknown[];
  conflicts: unknown[];
}

/** Deterministic id factory: stable, human-readable, collision-free within a fixture. */
function ids(fixtureId: string) {
  let n = 0;
  return (kind: string) => `fx-${fixtureId}-${kind}-${String(++n).padStart(3, "0")}`;
}

/**
 * Build the release fixture. `fixtureId` defaults to a fixed value for full
 * determinism; pass a unique id when creating a removable instance in a real
 * (disposable) account. `now` is the base instant; offsets are hours back.
 */
export function buildReleaseFixture(opts: { fixtureId?: string; now?: string } = {}): ReleaseFixture {
  const fixtureId = opts.fixtureId ?? "v1";
  const iso = opts.now ?? FIXTURE_BASE_ISO;
  const id = ids(fixtureId);
  const back = (h: number) => new Date(Date.parse(iso) - h * 3.6e6).toISOString();
  const mark = { fixture: true, fixtureId, tags: [FIXTURE_TAG] };

  const wsId = id("workspace");
  const goalId = id("goal");
  const projectId = id("project");
  const docId = id("document");
  const beliefId = id("belief");
  const researchId = id("research");
  const actionA = id("action");
  const actionB = id("action");
  const actionC = id("action");
  const sectionId = id("section");
  const passageId = id("passage");
  const focusId = id("focus");

  return {
    fixtureId,
    records: {
      workspaces: [{ id: wsId, name: "Release fixture workspace", description: "Deterministic V1 acceptance fixture. Remove in one action.", ...mark, createdAt: back(200), updatedAt: back(2) }],
      goals: [{ id: goalId, title: "Understand one idea deeply", status: "active", horizon: "quarter", notes: "", description: "", projectIds: [projectId], relatedEntities: [], workspaceId: wsId, ...mark, createdAt: back(198), updatedAt: back(4) }],
      projects: [{ id: projectId, title: "Read and summarize a short essay", status: "active", priority: "high", notes: "Fixture project.", description: "", goalId, workspaceId: wsId, relatedDocuments: [docId], relatedEntities: [], milestones: [
        { id: id("milestone"), title: "Finish reading", status: "completed", order: 0, completedAt: back(20) },
        { id: id("milestone"), title: "Write summary", status: "open", order: 1 },
      ], ...mark, createdAt: back(196), updatedAt: back(3) }],
      captures: [
        { id: id("capture"), text: "Raw thought: attention precedes understanding.", processingStatus: "unprocessed", ...mark, createdAt: back(50), history: [] },
        { id: id("capture"), text: "Idea to develop into the summary.", processingStatus: "processing", ...mark, createdAt: back(48), history: [] },
        { id: id("capture"), text: "Processed into the project.", processingStatus: "processed", processedAt: back(40), linkedProjectIds: [projectId], ...mark, createdAt: back(46), history: [] },
        { id: id("capture"), text: "An archived stray note.", processingStatus: "archived", archivedAt: back(30), ...mark, createdAt: back(44), history: [] },
        { id: id("capture"), text: "A discarded duplicate note.", processingStatus: "discarded", discardedAt: back(30), ...mark, createdAt: back(43), history: [] },
      ],
      nextActions: [
        { id: actionA, title: "Re-read the opening section", status: "done", projectId, completedAt: back(20), ...mark, createdAt: back(45), updatedAt: back(20), history: [], linkedEntityRefs: [], notes: "", description: "", order: 0 },
        { id: actionB, title: "Draft three-sentence summary", status: "open", projectId, ...mark, createdAt: back(40), updatedAt: back(4), history: [], linkedEntityRefs: [], notes: "", description: "", order: 1 },
        { id: actionC, title: "Cite the key passage", status: "waiting", projectId, ...mark, createdAt: back(38), updatedAt: back(4), history: [], linkedEntityRefs: [], notes: "", description: "", order: 2 },
      ],
      actionDependencies: [{ id: id("dependency"), fromActionId: actionC, toActionId: actionB, kind: "blocks", ...mark, createdAt: back(38) }],
      sessions: [
        { id: id("session"), workspaceId: wsId, projectId, type: "focus", startedAt: back(6), endedAt: back(5), activity: [], ...mark },
        { id: id("session"), workspaceId: wsId, projectId, type: "reading", startedAt: back(2), endedAt: null, activity: [], ...mark },
      ],
      focusSessions: [{ id: focusId, targetKind: "project", ref: { kind: "project", id: projectId }, title: "Read and summarize a short essay", startedAt: back(6), endedAt: back(5), panels: {}, interruptions: [{ id: id("interruption"), at: back(5.5), note: "phone" }], history: [], ...mark }],
      planningAssignments: [
        { id: id("plan"), ref: { kind: "action", id: actionB }, horizon: "today", ...mark, createdAt: back(4), updatedAt: back(4) },
        { id: id("plan"), ref: { kind: "action", id: actionC }, horizon: "week", ...mark, createdAt: back(4), updatedAt: back(4) },
      ],
      documents: [{ id: docId, title: "A very short essay (fixture)", subtitle: "", authors: ["Fixture Author"], kind: "essay", status: "reading", notes: "", sections: [{ id: sectionId, title: "Opening", order: 0, passages: [{ id: passageId, sectionId, text: "Attention is the beginning of devotion.", order: 0,
        highlights: [{ id: id("highlight"), color: "yellow", passageId, createdAt: back(25) }],
        annotations: [{ id: id("annotation"), passageId, text: "The thesis in one line.", createdAt: back(25) }],
      }] }], progress: { lastOpenedAt: back(2), percent: 60 }, sourceMetadata: { importFormat: "plain" }, ...mark, createdAt: back(60), updatedAt: back(2) }],
      citations: [{ id: id("citation"), recordKind: "belief", recordId: beliefId, documentId: docId, documentTitle: "A very short essay (fixture)", sectionId, passageId, ...mark, createdAt: back(24) }],
      beliefs: [{ id: beliefId, captureId: "", proposalId: "", text: "Attention is a form of devotion.", status: "accepted", revisions: [{ at: back(24), text: "Attention is a form of devotion.", note: "initial" }], judgments: [{ decision: "accepted", at: back(24) }], ...mark, createdAt: back(58), updatedAt: back(24) }],
      researchProjects: [{ id: researchId, title: "How attention shapes memory", status: "open", questions: [{ id: id("question"), text: "Does sustained attention improve recall?" }], hypotheses: [], arguments: [], evidence: [], notes: "", ...mark, createdAt: back(120), updatedAt: back(10) }],
      dailyReviews: [{ id: id("review"), date: iso.slice(0, 10), status: "completed", summary: "Read the essay; drafted next steps.", wins: ["Finished reading"], lessons: ["Summarize sooner"], friction: [], openLoops: [{ id: id("loop"), label: "Write the summary" }], tomorrowFocus: [{ id: id("focusItem"), label: "Draft summary" }], notes: "", linkedGoals: [goalId], linkedProjects: [projectId], linkedWorkspaces: [wsId], linkedEntities: [], ...mark, createdAt: back(4), updatedAt: back(4) }],
      maintenanceEvents: [{ id: id("maintenance"), kind: "citation-repair", status: "resolved", targetKind: "citation", targetId: "", note: "Repaired a citation pointer.", resolvedAt: back(12), history: [], ...mark, createdAt: back(14) }],
      duplicateCandidates: [{ id: id("dupe"), reason: "normalized-title", members: [{ kind: "belief", id: beliefId }], status: "open", members2: [], history: [], ...mark, createdAt: back(10) }],
      savedInsightViews: [{ id: id("insightView"), name: "Fixture · last 30 days", view: "attention", range: { kind: "relative", days: 30 }, filters: {}, ...mark, createdAt: back(8), updatedAt: back(8) }],
    },
    // One tombstone (a deleted capture) and one conflict (a same-field edit).
    tombstones: [{ id: id("tombstone"), domain: "captures", recordId: id("deleted-capture"), deletedAt: back(15), fixtureId, tags: [FIXTURE_TAG] }],
    conflicts: [{ id: id("conflict"), domain: "beliefs", recordId: beliefId, field: "text", localValue: "Attention is a form of devotion.", remoteValue: "Attention is devotion.", status: "unresolved", detectedAt: back(9), fixtureId, tags: [FIXTURE_TAG] }],
  };
}

/** Merge fixture records into a state (pure). Tombstones/conflicts stay separate. */
export function addFixture(state: StoreState, fx: ReleaseFixture): StoreState {
  const next = { ...state } as unknown as Record<string, unknown[]>;
  for (const [domain, recs] of Object.entries(fx.records)) {
    next[domain] = [...((next[domain] as unknown[]) ?? []), ...(recs as unknown[])];
  }
  return next as unknown as StoreState;
}

/** Remove every record carrying a given fixtureId (pure, one action). */
export function removeFixture(state: StoreState, fixtureId: string): StoreState {
  const next = { ...state } as unknown as Record<string, unknown[]>;
  for (const [domain, arr] of Object.entries(next)) {
    if (!Array.isArray(arr)) continue;
    next[domain] = arr.filter((r) => (r as { fixtureId?: string }).fixtureId !== fixtureId);
  }
  return next as unknown as StoreState;
}

/** Count fixture records present for an id (records only, not tombstones/conflicts). */
export function fixtureRecordCount(state: StoreState, fixtureId: string): number {
  let n = 0;
  for (const arr of Object.values(state as unknown as Record<string, unknown[]>)) {
    if (Array.isArray(arr)) n += arr.filter((r) => (r as { fixtureId?: string }).fixtureId === fixtureId).length;
  }
  return n;
}

/** The domains the fixture is required (Feature 24) to populate. */
export const FIXTURE_REQUIRED_DOMAINS: readonly (keyof StoreState)[] = [
  "workspaces", "goals", "projects", "captures", "nextActions", "actionDependencies",
  "sessions", "focusSessions", "planningAssignments", "documents", "citations", "beliefs",
  "researchProjects", "dailyReviews", "maintenanceEvents", "duplicateCandidates", "savedInsightViews",
];

export interface FixtureReport { ok: boolean; problems: string[]; recordCount: number }

/** Verify the built fixture covers every required domain and marks every record. */
export function validateFixture(fx: ReleaseFixture): FixtureReport {
  const problems: string[] = [];
  for (const d of FIXTURE_REQUIRED_DOMAINS) {
    const arr = fx.records[d];
    if (!arr || arr.length === 0) problems.push(`fixture missing required domain: ${String(d)}`);
  }
  let count = 0;
  for (const [domain, arr] of Object.entries(fx.records)) {
    for (const r of arr as { fixtureId?: string; tags?: string[] }[]) {
      count++;
      if (r.fixtureId !== fx.fixtureId) problems.push(`record in ${domain} missing fixtureId`);
      if (!r.tags?.includes(FIXTURE_TAG)) problems.push(`record in ${domain} missing ${FIXTURE_TAG} tag`);
    }
  }
  if (fx.tombstones.length < 1) problems.push("fixture must include one tombstone");
  if (fx.conflicts.length < 1) problems.push("fixture must include one conflict");
  // Two milestones on the project.
  const project = (fx.records.projects?.[0] ?? {}) as { milestones?: unknown[] };
  if (!project.milestones || project.milestones.length < 2) problems.push("fixture project must have two milestones");
  return { ok: problems.length === 0, problems, recordCount: count };
}
