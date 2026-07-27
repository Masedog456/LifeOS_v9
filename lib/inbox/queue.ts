/**
 * Processing queue (LIFEOS-035, Feature 2).
 *
 * Deterministic filtering, sorting and view derivation over captures. Pure over
 * `StoreState.captures` — no graph rebuild, no AI. The queue is a projection;
 * viewing it changes nothing (deferred returns are applied by the store on
 * hydrate/view, not here).
 */

import type { Capture, StoreState } from "@/types/mvp";
import { captureStatus, effectiveText, captureTags, captureAgeDays, isLinked, type QueueView } from "@/lib/inbox/capture-status";

export type QueueSort = "newest" | "oldest" | "source" | "workspace" | "project" | "deferred";

export interface QueueFilter {
  text?: string;
  tags?: string[];
  sourceId?: string;
  workspaceId?: string;
  goalId?: string;
  projectId?: string;
  linked?: "linked" | "unlinked";
  /** Only captures at least this many days old. */
  minAgeDays?: number;
}

/** Captures belonging to a queue view (by processing status). */
export function capturesForView(captures: Capture[], view: QueueView): Capture[] {
  return captures.filter((c) => captureStatus(c) === view);
}

/** Per-view counts (for the tabs + Today card). */
export function queueCounts(captures: Capture[]): Record<QueueView, number> {
  const counts: Record<QueueView, number> = { inbox: 0, processing: 0, deferred: 0, processed: 0, archived: 0 };
  for (const c of captures) {
    const s = captureStatus(c);
    if (s in counts) counts[s as QueueView]++;
  }
  return counts;
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase();

/** Apply filters (deterministic, allocation-light). */
export function filterCaptures(captures: Capture[], filter: QueueFilter, now = Date.now()): Capture[] {
  const q = norm(filter.text).trim();
  return captures.filter((c) => {
    if (q && !norm(effectiveText(c)).includes(q) && !norm(c.text).includes(q)) return false;
    if (filter.tags && filter.tags.length) {
      const tags = captureTags(c);
      if (!filter.tags.every((t) => tags.includes(t))) return false;
    }
    if (filter.sourceId && c.sourceId !== filter.sourceId) return false;
    if (filter.workspaceId && !(c.linkedWorkspaceIds ?? []).includes(filter.workspaceId) && c.sourceContext?.workspaceId !== filter.workspaceId) return false;
    if (filter.goalId && !(c.linkedGoalIds ?? []).includes(filter.goalId) && c.sourceContext?.goalId !== filter.goalId) return false;
    if (filter.projectId && !(c.linkedProjectIds ?? []).includes(filter.projectId) && c.sourceContext?.projectId !== filter.projectId) return false;
    if (filter.linked === "linked" && !isLinked(c)) return false;
    if (filter.linked === "unlinked" && isLinked(c)) return false;
    if (filter.minAgeDays && captureAgeDays(c, now) < filter.minAgeDays) return false;
    return true;
  });
}

/** Sort a capture list (stable). */
export function sortCaptures(captures: Capture[], sort: QueueSort): Capture[] {
  const arr = [...captures];
  switch (sort) {
    case "oldest": return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "source": return arr.sort((a, b) => norm(a.sourceId).localeCompare(norm(b.sourceId)) || b.createdAt.localeCompare(a.createdAt));
    case "workspace": return arr.sort((a, b) => norm(a.linkedWorkspaceIds?.[0] ?? a.sourceContext?.workspaceId).localeCompare(norm(b.linkedWorkspaceIds?.[0] ?? b.sourceContext?.workspaceId)) || b.createdAt.localeCompare(a.createdAt));
    case "project": return arr.sort((a, b) => norm(a.linkedProjectIds?.[0] ?? a.sourceContext?.projectId).localeCompare(norm(b.linkedProjectIds?.[0] ?? b.sourceContext?.projectId)) || b.createdAt.localeCompare(a.createdAt));
    case "deferred": return arr.sort((a, b) => norm(a.deferredUntil).localeCompare(norm(b.deferredUntil)) || b.createdAt.localeCompare(a.createdAt));
    case "newest":
    default: return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export interface QueueRequest { view: QueueView; sort?: QueueSort; filter?: QueueFilter }
export interface QueueResult { items: Capture[]; counts: Record<QueueView, number>; total: number }

/** Derive a queue view: filtered + sorted items plus per-view counts. */
export function deriveQueue(state: StoreState, req: QueueRequest, now = Date.now()): QueueResult {
  const all = state.captures ?? [];
  const inView = capturesForView(all, req.view);
  const filtered = filterCaptures(inView, req.filter ?? {}, now);
  const items = sortCaptures(filtered, req.sort ?? (req.view === "deferred" ? "deferred" : "newest"));
  return { items, counts: queueCounts(all), total: inView.length };
}

/** The next capture to process (oldest un-processed inbox item), or undefined. */
export function nextToProcess(state: StoreState, order: "oldest" | "newest" = "oldest"): Capture | undefined {
  const inbox = capturesForView(state.captures ?? [], "inbox");
  if (!inbox.length) return undefined;
  return sortCaptures(inbox, order === "oldest" ? "oldest" : "newest")[0];
}

/** Captures near a given one (same source/session context), for the processor. */
export function nearbyCaptures(state: StoreState, capture: Capture, limit = 5): Capture[] {
  const all = (state.captures ?? []).filter((c) => c.id !== capture.id);
  const sameContext = all.filter((c) =>
    (capture.sourceId && c.sourceId === capture.sourceId) ||
    (capture.sourceContext?.sessionId && c.sourceContext?.sessionId === capture.sourceContext.sessionId) ||
    (capture.sourceContext?.workspaceId && c.sourceContext?.workspaceId === capture.sourceContext.workspaceId));
  const pool = sameContext.length ? sameContext : all;
  return sortCaptures(pool, "newest").slice(0, limit);
}
