/**
 * Workspace dashboard projection (LIFEOS-030, Feature 4).
 *
 * Assembles everything a workspace dashboard shows — overview, goals, pinned,
 * recent work / documents / decisions / captures, themes, session timeline,
 * reading, and a graph-neighbor frontier — as ONE deterministic projection over
 * the store, the LIFEOS-029 entity API, and the session helpers. Pure and
 * offline: no AI, no recommendations, no analytics. Every list is references to
 * existing records resolved live, never copies.
 */

import type { ReadingDocument, StoreState, Workspace } from "@/types/mvp";
import { describeEntity, entityRef, type EntityContext, type Entity, type EntityRef } from "@/lib/entities/entity";
import {
  memberBreakdown, workspaceEntities, workspacePinned, workspaceReferenced, type WorkspaceReference,
} from "@/lib/workspaces/workspace";
import {
  activeSession, groupSessionsByRecency, sessionsForWorkspace, totalDuration, type SessionGroups,
} from "@/lib/workspaces/sessions";
import { recentEntitiesFromActivity } from "@/lib/workspaces/activity";

export interface ReadingProgressItem { ref: EntityRef; percent: number; status: string }

export interface WorkspaceDashboard {
  workspace: Workspace;
  overview: {
    memberCount: number;
    breakdown: { kind: string; count: number }[];
    openGoals: number;
    sessionCount: number;
    totalMs: number;
    hasActiveSession: boolean;
  };
  goals: Workspace["goals"];
  pinned: EntityRef[];
  recentWork: Entity[];
  recentDocuments: Entity[];
  recentDecisions: Entity[];
  recentCaptures: Entity[];
  themes: Entity[];
  sessions: SessionGroups;
  reading: ReadingProgressItem[];
  referenced: WorkspaceReference[];
}

/** Members of a given kind, resolved to entities, newest-first. */
function membersOfKind(ctx: EntityContext, ws: Workspace, kind: string, limit = 8): Entity[] {
  const out: Entity[] = [];
  for (const m of ws.members) {
    if (m.kind !== kind) continue;
    const e = describeEntity(ctx, m.kind, m.id);
    if (e.ref.exists) out.push(e);
  }
  out.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  return out.slice(0, limit);
}

export function workspaceDashboard(ctx: EntityContext, ws: Workspace, nowMs = Date.now()): WorkspaceDashboard {
  const state: StoreState = ctx.state;
  const sessions = sessionsForWorkspace(state, ws.id);
  const active = activeSession(state);
  const hasActive = Boolean(active && active.workspaceId === ws.id);

  // Recent work: entities from the most recent session activity, then any other
  // members by recency — deduped, existing only.
  const recentRefs = sessions.length ? recentEntitiesFromActivity(sessions[0].activity, 12) : [];
  const seen = new Set<string>();
  const recentWork: Entity[] = [];
  for (const r of recentRefs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    const e = describeEntity(ctx, r.kind, r.id);
    if (!e.ref.exists) continue;
    seen.add(key);
    recentWork.push(e);
  }
  for (const ref of workspaceEntities(ctx, ws)) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentWork.push(describeEntity(ctx, ref.kind, ref.id));
    if (recentWork.length >= 12) break;
  }
  recentWork.sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));

  // Reading: member documents with live progress.
  const reading: ReadingProgressItem[] = [];
  for (const m of ws.members) {
    if (m.kind !== "document") continue;
    const doc: ReadingDocument | undefined = state.documents.find((d) => d.id === m.id);
    if (!doc) continue;
    reading.push({ ref: entityRef(ctx, "document", doc.id), percent: doc.progress.percent ?? 0, status: doc.progress.status });
  }

  return {
    workspace: ws,
    overview: {
      memberCount: workspaceEntities(ctx, ws).length,
      breakdown: memberBreakdown(ctx, ws),
      openGoals: ws.goals.filter((g) => !g.done).length,
      sessionCount: sessions.length,
      totalMs: totalDuration(sessions, nowMs),
      hasActiveSession: hasActive,
    },
    goals: ws.goals,
    pinned: workspacePinned(ctx, ws),
    recentWork: recentWork.slice(0, 8),
    recentDocuments: membersOfKind(ctx, ws, "document"),
    recentDecisions: membersOfKind(ctx, ws, "decision"),
    recentCaptures: membersOfKind(ctx, ws, "capture"),
    themes: membersOfKind(ctx, ws, "concept"),
    sessions: groupSessionsByRecency(sessions, nowMs),
    reading,
    referenced: workspaceReferenced(ctx, ws, 18),
  };
}
