/**
 * Session lifecycle & derivations (LIFEOS-030, Features 2 & 7).
 *
 * Pure, deterministic helpers over `StoreState.sessions`: which session is
 * active (only one ever is), how long it has run, what it produced (derived from
 * its activity timeline — never a second source of truth), and how a workspace's
 * sessions group into Today / Yesterday / This Week / Past for the session
 * timeline. No store mutation, no analytics, no AI. The store owns creation and
 * ending; this module only reads.
 */

import type { SessionType, StoreState, WorkspaceSession } from "@/types/mvp";

export const SESSION_TYPES: SessionType[] = [
  "thinking", "reading", "research", "writing", "planning", "decision", "review", "reflection",
];

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  thinking: "Thinking Session",
  reading: "Reading Session",
  research: "Research Session",
  writing: "Writing Session",
  planning: "Planning Session",
  decision: "Decision Session",
  review: "Review Session",
  reflection: "Reflection Session",
};

export const SESSION_TYPE_ICON: Record<SessionType, string> = {
  thinking: "✷", reading: "❧", research: "⚗", writing: "✍",
  planning: "◷", decision: "⚖", review: "↻", reflection: "❋",
};

export function sessionTypeLabel(type: string): string {
  return SESSION_TYPE_LABEL[type as SessionType] ?? "Session";
}

/** The one active session (endedAt unset), or undefined. */
export function activeSession(state: StoreState): WorkspaceSession | undefined {
  return (state.sessions ?? []).find((s) => !s.endedAt);
}

export function isActive(s: WorkspaceSession): boolean {
  return !s.endedAt;
}

/** All sessions for a workspace, most-recent-first. */
export function sessionsForWorkspace(state: StoreState, workspaceId: string): WorkspaceSession[] {
  return (state.sessions ?? [])
    .filter((s) => s.workspaceId === workspaceId)
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

/** Elapsed/total duration in milliseconds (uses `now` for an active session). */
export function sessionDuration(s: WorkspaceSession, nowMs = Date.now()): number {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : nowMs;
  return Math.max(0, end - start);
}

/** "1h 12m", "5m", "42s" — compact, deterministic. */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "1:04:09" / "12:07" — a live elapsed clock for the banner. */
export function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface SessionOutputs {
  entitiesOpened: number;
  documentsRead: number;
  capturesCreated: number;
  decisionsMade: number;
  events: number;
}

/**
 * A session's outputs, DERIVED from its activity timeline. Unique entities and
 * documents are counted by id so re-opening the same thing isn't double-counted.
 */
export function sessionOutputs(s: WorkspaceSession): SessionOutputs {
  const entities = new Set<string>();
  const docs = new Set<string>();
  let captures = 0;
  let decisions = 0;
  for (const e of s.activity) {
    switch (e.type) {
      case "opened_entity":
      case "inspector":
        if (e.entityId) entities.add(`${e.entityKind}:${e.entityId}`);
        break;
      case "opened_document":
      case "reading":
        if (e.entityId) docs.add(e.entityId);
        break;
      case "capture_created":
        captures += 1;
        break;
      case "decision_edited":
        decisions += 1;
        break;
      default:
        break;
    }
  }
  return {
    entitiesOpened: entities.size,
    documentsRead: docs.size,
    capturesCreated: captures,
    decisionsMade: decisions,
    events: s.activity.length,
  };
}

export type RecencyBucket = "today" | "yesterday" | "thisWeek" | "older";

export interface SessionGroups {
  today: WorkspaceSession[];
  yesterday: WorkspaceSession[];
  thisWeek: WorkspaceSession[];
  older: WorkspaceSession[];
}

/** Which recency bucket a timestamp falls in relative to local midnight. */
export function recencyBucket(iso: string, nowMs = Date.now()): RecencyBucket {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - 86400000) return "yesterday";
  if (t >= startOfToday - 6 * 86400000) return "thisWeek";
  return "older";
}

/** Group a workspace's sessions into Today / Yesterday / This Week / Older. */
export function groupSessionsByRecency(sessions: WorkspaceSession[], nowMs = Date.now()): SessionGroups {
  const groups: SessionGroups = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const s of sessions) groups[recencyBucket(s.startedAt, nowMs)].push(s);
  return groups;
}

/** Total time spent across a set of sessions (ms). */
export function totalDuration(sessions: WorkspaceSession[], nowMs = Date.now()): number {
  return sessions.reduce((sum, s) => sum + sessionDuration(s, nowMs), 0);
}
