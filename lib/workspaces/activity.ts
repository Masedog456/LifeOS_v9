/**
 * Session activity tracking policy & summaries (LIFEOS-030, Feature 5).
 *
 * Pure helpers that decide WHAT counts as a session activity event and how to
 * summarize an activity timeline. The store applies `shouldRecord` before
 * appending (so opening the same entity twice in a row, or a rapid duplicate
 * search, doesn't spam the timeline) and reads `resumePatchFor` to keep the
 * workspace's "resume where I left off" memory current. Timeline only — no
 * analytics, no scoring, no AI.
 */

import type {
  RecordRefLite, SessionActivityEvent, SessionActivityKind, WorkspaceResume, WorkspaceSession,
} from "@/types/mvp";

export const ACTIVITY_LABEL: Record<SessionActivityKind, string> = {
  opened_entity: "Opened",
  opened_document: "Opened document",
  search: "Searched",
  capture_created: "Captured",
  belief_edited: "Edited belief",
  reading: "Read",
  inspector: "Inspected",
  command: "Ran command",
  decision_edited: "Worked on decision",
  note: "Note",
  action_activity: "Action",
};

/** How long (ms) an identical event is treated as a duplicate and skipped. */
const DEDUPE_WINDOW_MS = 60_000;

/**
 * Whether a candidate event should be appended to a session. Rejects an exact
 * repeat of the most recent event (same type + entity + label) inside a short
 * window — keeps the timeline a record of distinct activity, not every keystroke.
 * Deterministic given the session and a clock.
 */
export function shouldRecord(session: WorkspaceSession, candidate: Omit<SessionActivityEvent, "id" | "at">, atMs = Date.now()): boolean {
  const last = session.activity[session.activity.length - 1];
  if (!last) return true;
  const sameTarget =
    last.type === candidate.type &&
    last.entityKind === candidate.entityKind &&
    last.entityId === candidate.entityId &&
    last.label === candidate.label;
  if (!sameTarget) return true;
  return atMs - new Date(last.at).getTime() > DEDUPE_WINDOW_MS;
}

/** Append an event, keeping the timeline bounded (oldest trimmed if huge). */
const MAX_EVENTS = 500;
export function appendActivity(session: WorkspaceSession, event: SessionActivityEvent): WorkspaceSession {
  const activity = [...session.activity, event];
  if (activity.length > MAX_EVENTS) activity.splice(0, activity.length - MAX_EVENTS);
  return { ...session, activity };
}

/**
 * The resume-memory patch implied by an activity event (Feature 6). Opening an
 * entity updates lastEntity/lastInspector; opening or reading a document updates
 * lastDocumentId; a search updates lastSearch. Everything else leaves resume
 * untouched. Returns an empty patch when nothing should change.
 */
export function resumePatchFor(event: Omit<SessionActivityEvent, "id" | "at">, atIso: string): Partial<WorkspaceResume> {
  const ref = (): RecordRefLite | undefined =>
    event.entityKind && event.entityId ? { kind: event.entityKind, id: event.entityId } : undefined;
  switch (event.type) {
    case "opened_entity":
      return { lastEntity: ref(), at: atIso };
    case "inspector":
      return { lastInspector: ref(), lastEntity: ref(), at: atIso };
    case "opened_document":
    case "reading":
      return event.entityId ? { lastDocumentId: event.entityId, at: atIso } : {};
    case "search":
      return event.detail ? { lastSearch: event.detail, at: atIso } : {};
    default:
      return {};
  }
}

export interface ActivitySummary {
  total: number;
  byType: { type: SessionActivityKind; label: string; count: number }[];
  uniqueEntities: number;
  uniqueDocuments: number;
}

/** A deterministic summary of an activity timeline (for the dashboard). */
export function summarizeActivity(events: SessionActivityEvent[]): ActivitySummary {
  const counts = new Map<SessionActivityKind, number>();
  const entities = new Set<string>();
  const docs = new Set<string>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    if (e.type === "opened_document" || e.type === "reading") {
      if (e.entityId) docs.add(e.entityId);
    } else if (e.entityId) {
      entities.add(`${e.entityKind}:${e.entityId}`);
    }
  }
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, label: ACTIVITY_LABEL[type], count }))
    .sort((a, b) => b.count - a.count);
  return { total: events.length, byType, uniqueEntities: entities.size, uniqueDocuments: docs.size };
}

/** The most-recent distinct entities touched across a session's activity. */
export function recentEntitiesFromActivity(events: SessionActivityEvent[], limit = 12): RecordRefLite[] {
  const seen = new Set<string>();
  const out: RecordRefLite[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e.entityKind || !e.entityId) continue;
    if (e.type === "opened_document" || e.type === "reading") continue;
    const key = `${e.entityKind}:${e.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: e.entityKind, id: e.entityId });
    if (out.length >= limit) break;
  }
  return out;
}
