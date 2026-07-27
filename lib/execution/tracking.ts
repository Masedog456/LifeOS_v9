/**
 * Session ↔ execution attribution (LIFEOS-031, Feature 6).
 *
 * Sessions optionally belong to a Goal and/or a Project (in addition to a
 * Workspace). This module ATTRIBUTES a session's already-tracked activity
 * (LIFEOS-030) to its goal/project and derives a contribution summary. Pure and
 * deterministic — it reads the session link + activity timeline; it never scores,
 * ranks, or calls AI. No new tracking is introduced.
 */

import type { StoreState, WorkspaceSession } from "@/types/mvp";
import { sessionOutputs, type SessionOutputs } from "@/lib/workspaces/sessions";

/** Sessions that contribute to a project (directly linked). */
export function projectSessions(state: StoreState, projectId: string): WorkspaceSession[] {
  return (state.sessions ?? [])
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

/**
 * Sessions that contribute to a goal — those linked to the goal directly, plus
 * those linked to any of the goal's projects. Deduped, newest-first.
 */
export function goalSessions(state: StoreState, goalId: string): WorkspaceSession[] {
  const projectIds = new Set((state.projects ?? []).filter((p) => p.goalId === goalId).map((p) => p.id));
  const seen = new Set<string>();
  const out: WorkspaceSession[] = [];
  for (const s of state.sessions ?? []) {
    if (s.goalId === goalId || (s.projectId && projectIds.has(s.projectId))) {
      if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
  }
  return out.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export interface Contribution extends SessionOutputs {
  /** New knowledge produced this session (captures). */
  knowledgeCreated: number;
  sessions: number;
  totalEvents: number;
}

/** Aggregate contribution across a set of sessions (derived from activity). */
export function contribution(sessions: WorkspaceSession[]): Contribution {
  const acc: Contribution = {
    entitiesOpened: 0, documentsRead: 0, capturesCreated: 0, decisionsMade: 0, events: 0,
    knowledgeCreated: 0, sessions: sessions.length, totalEvents: 0,
  };
  for (const s of sessions) {
    const o = sessionOutputs(s);
    acc.entitiesOpened += o.entitiesOpened;
    acc.documentsRead += o.documentsRead;
    acc.capturesCreated += o.capturesCreated;
    acc.decisionsMade += o.decisionsMade;
    acc.totalEvents += o.events;
  }
  acc.knowledgeCreated = acc.capturesCreated;
  acc.events = acc.totalEvents;
  return acc;
}
