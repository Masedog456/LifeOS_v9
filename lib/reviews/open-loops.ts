/**
 * Open-loop derivation (LIFEOS-034, Feature 7).
 *
 * Deterministically SUGGESTS unfinished threads from existing state — the user
 * decides which ones belong in a review. This never marks anything complete or
 * incomplete; it only reads. Live-only signals (unresolved conflicts, unsynced
 * changes) are passed in by the caller since they are not part of `StoreState`.
 */

import type { OpenLoopSource, RecordRefLite, StoreState } from "@/types/mvp";

export interface OpenLoopCandidate {
  /** Stable id so the same loop de-dupes across renders (e.g. "milestone:abc"). */
  id: string;
  source: OpenLoopSource;
  text: string;
  ref?: RecordRefLite;
  /** A recency hint (ISO) used only for ordering, never shown as a deadline. */
  at?: string;
}

export interface OpenLoopLive {
  unresolvedConflicts?: number;
  unsyncedPending?: boolean;
}

const snip = (s: string | undefined, n = 70): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/**
 * All open-loop candidates, most-recently-relevant first. Deterministic and
 * bounded (each source contributes at most a sensible number). The returned
 * `id`s are stable and used to de-dupe against loops already chosen in a review.
 */
export function deriveOpenLoops(state: StoreState, live: OpenLoopLive = {}): OpenLoopCandidate[] {
  const out: OpenLoopCandidate[] = [];

  // In-progress sessions.
  for (const s of state.sessions ?? []) {
    if (!s.endedAt) out.push({ id: `session:${s.id}`, source: "session", text: `Active session${s.goal ? `: ${snip(s.goal, 50)}` : ""}`, ref: s.workspaceId ? { kind: "workspace", id: s.workspaceId } : undefined, at: s.startedAt });
  }

  // Incomplete milestones in live projects.
  for (const p of state.projects ?? []) {
    if (p.status === "completed" || p.status === "abandoned") continue;
    for (const m of p.milestones ?? []) {
      if (m.status !== "done") out.push({ id: `milestone:${m.id}`, source: "milestone", text: `${snip(p.title, 40)} — ${snip(m.title, 40)}`, ref: { kind: "milestone", id: m.id }, at: m.updatedAt });
    }
  }

  // Active projects (that have no open milestones of their own get surfaced too).
  for (const p of state.projects ?? []) {
    if (p.status === "active") out.push({ id: `project:${p.id}`, source: "project", text: snip(p.title, 60), ref: { kind: "project", id: p.id }, at: p.updatedAt });
  }

  // Unresolved decisions.
  for (const d of state.decisions ?? []) {
    const status = (d as { status?: string }).status ?? "";
    if (status !== "decided" && status !== "abandoned") {
      const title = (d as { title?: string; question?: string }).title || (d as { question?: string }).question;
      out.push({ id: `decision:${d.id}`, source: "decision", text: snip(title, 60), ref: { kind: "decision", id: d.id }, at: (d as { updatedAt?: string }).updatedAt });
    }
  }

  // Unfinished reading.
  for (const doc of state.documents ?? []) {
    if (doc.status === "reading" || doc.status === "paused") out.push({ id: `reading:${doc.id}`, source: "reading", text: snip(doc.title, 60), ref: { kind: "document", id: doc.id }, at: doc.progress?.lastOpenedAt || doc.updatedAt });
  }

  // Unprocessed capture backlog (LIFEOS-035) — a SINGLE aggregate candidate the
  // user may choose; we never add every inbox item as its own loop.
  const inboxCount = (state.captures ?? []).filter((c) => (c.processingStatus ?? "inbox") === "inbox").length;
  if (inboxCount > 0) out.push({ id: "inbox:backlog", source: "manual", text: `${inboxCount} unprocessed capture${inboxCount === 1 ? "" : "s"} in the inbox` });

  // Live sync signals (not derivable from StoreState).
  if (live.unresolvedConflicts && live.unresolvedConflicts > 0) {
    out.push({ id: "conflict:unresolved", source: "conflict", text: `${live.unresolvedConflicts} unresolved sync conflict${live.unresolvedConflicts === 1 ? "" : "s"}`, ref: undefined });
  }
  if (live.unsyncedPending) {
    out.push({ id: "unsynced:pending", source: "unsynced", text: "Local changes not yet synced", ref: undefined });
  }

  // Most-recent first (stable), undated last.
  return out.sort((a, b) => (b.at || "").localeCompare(a.at || "") || a.id.localeCompare(b.id));
}
