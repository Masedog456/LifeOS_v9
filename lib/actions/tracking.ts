/**
 * Session ↔ action attribution (LIFEOS-036, Feature 17).
 *
 * Reuses the LIFEOS-030 session-activity timeline — it introduces NO new
 * tracking engine. It reads which sessions contributed to an action (those whose
 * activity references it, or that were the current-action session) and derives a
 * contribution summary. Pure and deterministic.
 */

import type { StoreState, WorkspaceSession, NextAction } from "@/types/mvp";
import { sessionOutputs, type SessionOutputs } from "@/lib/workspaces/sessions";

/**
 * Sessions that contributed to an action: any session whose activity timeline
 * carries an `action_activity` event pointing at this action id. Newest-first.
 */
export function actionSessions(state: StoreState, actionId: string): WorkspaceSession[] {
  return (state.sessions ?? [])
    .filter((s) => (s.activity ?? []).some((e) => e.type === "action_activity" && e.entityId === actionId))
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export interface ActionContribution extends SessionOutputs {
  sessions: number;
  /** Captures created while working (attributed via session activity). */
  capturesWhileActing: number;
}

/** Aggregate contribution across the sessions that touched an action. */
export function actionContribution(sessions: WorkspaceSession[]): ActionContribution {
  const acc: ActionContribution = {
    entitiesOpened: 0, documentsRead: 0, capturesCreated: 0, decisionsMade: 0, events: 0,
    sessions: sessions.length, capturesWhileActing: 0,
  };
  for (const s of sessions) {
    const o = sessionOutputs(s);
    acc.entitiesOpened += o.entitiesOpened;
    acc.documentsRead += o.documentsRead;
    acc.capturesCreated += o.capturesCreated;
    acc.decisionsMade += o.decisionsMade;
    acc.events += o.events;
  }
  acc.capturesWhileActing = acc.capturesCreated;
  return acc;
}

/** The action currently designated on a session (one at a time), if any. */
export function currentActionId(session: WorkspaceSession | undefined): string | undefined {
  return session?.currentActionId;
}

/** The `NextAction` a session is currently working on, if any (resolved). */
export function sessionCurrentAction(state: StoreState, session: WorkspaceSession | undefined): NextAction | undefined {
  const id = currentActionId(session);
  return id ? (state.nextActions ?? []).find((a) => a.id === id) : undefined;
}
