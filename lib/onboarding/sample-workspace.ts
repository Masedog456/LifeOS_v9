/**
 * Optional sample workspace (LIFEOS-041, Feature 36).
 *
 * An explicitly user-created, clearly-marked sample that teaches the product:
 * capture → project → action → focus → review, plus a document, citation,
 * belief, and a maintenance candidate, and enough activity for descriptive
 * insights. It is ordinary user-owned data once created (never auto-created,
 * never claimed to be the user's own real data), and removable in ONE action.
 * Every record carries the `sampleWorkspaceId` so removal is exact.
 */

import type { StoreState } from "@/types/mvp";

export const SAMPLE_TAG = "lifeos-sample";

export interface SampleBuild {
  sampleWorkspaceId: string;
  /** Records to merge into the store, keyed by StoreState domain. */
  records: Partial<Record<keyof StoreState, unknown[]>>;
}

/** Build the sample records. `now`/`id` injectable for deterministic tests. */
export function buildSampleWorkspace(ctx: { id: () => string; now: () => string }): SampleBuild {
  const wsId = ctx.id();
  const iso = ctx.now();
  const back = (h: number) => new Date(Date.parse(iso) - h * 3.6e6).toISOString();
  const mark = { sample: true, sampleWorkspaceId: wsId, tags: [SAMPLE_TAG] };

  const workspaceId = ctx.id();
  const projectId = ctx.id();
  const actionId = ctx.id();
  const docId = ctx.id();
  const beliefId = ctx.id();

  return {
    sampleWorkspaceId: wsId,
    records: {
      workspaces: [{ id: workspaceId, name: "Sample workspace", description: "A small tour of LifeOS. Remove it anytime.", ...mark, createdAt: back(48), updatedAt: back(2) }],
      projects: [{ id: projectId, title: "Read one short essay", status: "active", priority: "medium", notes: "Sample project.", description: "", milestones: [], relatedDocuments: [docId], relatedEntities: [], workspaceId, ...mark, createdAt: back(46), updatedAt: back(2) }],
      captures: [{ id: ctx.id(), text: "Idea: summarize the essay in three sentences.", processingStatus: "processed", processedAt: back(40), linkedProjectIds: [projectId], ...mark, createdAt: back(44), history: [] }],
      nextActions: [{ id: actionId, title: "Write a three-sentence summary", status: "open", projectId, ...mark, createdAt: back(40), updatedAt: back(2), history: [], linkedEntityRefs: [], notes: "", description: "", order: 0 }],
      sessions: [{ id: ctx.id(), workspaceId, projectId, type: "focus", startedAt: back(6), endedAt: back(5), activity: [], ...mark }],
      focusSessions: [{ id: ctx.id(), targetKind: "project", ref: { kind: "project", id: projectId }, title: "Read one short essay", startedAt: back(6), endedAt: back(5), panels: {}, interruptions: [], history: [], ...mark }],
      documents: [{ id: docId, title: "A very short essay (sample)", subtitle: "", authors: ["Sample Author"], kind: "essay", status: "reading", notes: "", sections: [{ id: ctx.id(), title: "Opening", order: 0, passages: [{ id: ctx.id(), sectionId: "s", text: "Attention is the beginning of devotion.", order: 0, highlights: [], annotations: [] }] }], progress: { lastOpenedAt: back(5) }, sourceMetadata: { importFormat: "plain" }, ...mark, createdAt: back(30), updatedAt: back(5) }],
      citations: [{ id: ctx.id(), recordKind: "belief", recordId: beliefId, documentId: docId, documentTitle: "A very short essay (sample)", ...mark, createdAt: back(5) }],
      beliefs: [{ id: beliefId, captureId: "", proposalId: "", text: "Attention is a form of devotion.", status: "accepted", revisions: [], judgments: [{ decision: "accepted", at: back(5) }], ...mark, createdAt: back(28), updatedAt: back(5) }],
      dailyReviews: [{ id: ctx.id(), date: iso.slice(0, 10), status: "completed", summary: "", wins: [], lessons: [], friction: [], openLoops: [], tomorrowFocus: [{ id: ctx.id(), label: "Finish the summary" }], notes: "", linkedGoals: [], linkedProjects: [projectId], linkedWorkspaces: [workspaceId], linkedEntities: [], ...mark, createdAt: back(2), updatedAt: back(2) }],
      // A gentle maintenance candidate: a near-duplicate belief.
      duplicateCandidates: [{ id: `sample-dup-${wsId}`, reason: "normalized-title", members: [{ kind: "belief", id: beliefId }], status: "open", members2: [], history: [], ...mark, createdAt: back(2) }],
    },
  };
}

/** Merge sample records into a state (pure). */
export function addSample(state: StoreState, build: SampleBuild): StoreState {
  const next = { ...state } as unknown as Record<string, unknown[]>;
  for (const [domain, recs] of Object.entries(build.records)) {
    next[domain] = [...((next[domain] as unknown[]) ?? []), ...(recs as unknown[])];
  }
  return next as unknown as StoreState;
}

/** Remove every record carrying a given sampleWorkspaceId (pure, one action). */
export function removeSample(state: StoreState, sampleWorkspaceId: string): StoreState {
  const next = { ...state } as unknown as Record<string, unknown[]>;
  for (const [domain, arr] of Object.entries(next)) {
    if (!Array.isArray(arr)) continue;
    next[domain] = arr.filter((r) => (r as { sampleWorkspaceId?: string }).sampleWorkspaceId !== sampleWorkspaceId);
  }
  return next as unknown as StoreState;
}

/** Count sample records present for an id. */
export function sampleRecordCount(state: StoreState, sampleWorkspaceId: string): number {
  let n = 0;
  for (const arr of Object.values(state as unknown as Record<string, unknown[]>)) {
    if (Array.isArray(arr)) n += arr.filter((r) => (r as { sampleWorkspaceId?: string }).sampleWorkspaceId === sampleWorkspaceId).length;
  }
  return n;
}
