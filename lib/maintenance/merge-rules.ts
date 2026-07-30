/**
 * Sync-conflict rules for knowledge maintenance (LIFEOS-038).
 *
 * Deterministic three-way merge, layered on the LIFEOS-033 engine. Overriding
 * rule: **never silently lose maintenance history.** Append-only events always
 * UNION by id. Duplicate DECISIONS and archive state can genuinely diverge —
 * those are reported as conflicts (local kept until the user resolves), never
 * silently dropped. Pure.
 */

import type { MaintenanceEvent, DuplicateCandidate } from "@/types/mvp";

/** Union maintenance events by id, time-sorted. History is never lost. */
export function mergeMaintenanceEvents(...lists: (MaintenanceEvent[] | undefined)[]): MaintenanceEvent[] {
  const out: MaintenanceEvent[] = [];
  const seen = new Set<string>();
  for (const list of lists) for (const e of list ?? []) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

/** Union dismissed / ignored id lists (safe merge — order-independent set union). */
export function mergeIdSets(...lists: (string[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const list of lists) for (const id of list ?? []) set.add(id);
  return [...set].sort();
}

export interface DuplicateMergeResult { merged: DuplicateCandidate; conflict?: string }

/**
 * Merge one duplicate-candidate decision across devices (same id). History
 * unions. A status that diverged on both sides (e.g. ignored here, merged there)
 * → conflict; local is kept until the user resolves.
 */
export function mergeDuplicateCandidate(base: DuplicateCandidate | undefined, local: DuplicateCandidate, remote: DuplicateCandidate): DuplicateMergeResult {
  const merged: DuplicateCandidate = { ...local };
  merged.history = mergeMaintenanceEvents(base?.history, local.history, remote.history);
  const b = base?.status ?? "open";
  const lChanged = local.status !== b, rChanged = remote.status !== b;
  if (lChanged && rChanged && local.status !== remote.status) {
    merged.status = local.status; // keep local; resolver decides
    merged.updatedAt = local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt;
    return { merged, conflict: `duplicate decided differently (${local.status} vs ${remote.status})` };
  }
  merged.status = lChanged ? local.status : (rChanged ? remote.status : b);
  merged.updatedAt = local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt;
  return { merged };
}

export interface DuplicateSetMergeResult { merged: DuplicateCandidate[]; conflicts: { id: string; reason: string }[] }

/** Merge two device views of duplicate DECISIONS, keyed by their stable id. */
export function mergeDuplicateSets(base: DuplicateCandidate[], local: DuplicateCandidate[], remote: DuplicateCandidate[]): DuplicateSetMergeResult {
  const bm = new Map(base.map((d) => [d.id, d] as const));
  const lm = new Map(local.map((d) => [d.id, d] as const));
  const rm = new Map(remote.map((d) => [d.id, d] as const));
  const merged: DuplicateCandidate[] = [];
  const conflicts: { id: string; reason: string }[] = [];
  for (const id of new Set([...lm.keys(), ...rm.keys()])) {
    const l = lm.get(id), r = rm.get(id);
    if (l && r) { const m = mergeDuplicateCandidate(bm.get(id), l, r); merged.push(m.merged); if (m.conflict) conflicts.push({ id, reason: m.conflict }); }
    else merged.push((l ?? r)!);
  }
  return { merged, conflicts };
}

/**
 * Resolve a record's archive state from the union of both devices' events
 * (latest archived/unarchived wins). Flags a conflict when the two devices'
 * latest decisions disagree (archive vs restore) — both events are always kept.
 */
export function resolveArchiveState(events: MaintenanceEvent[], refKey: string): { archived: boolean; conflict: boolean } {
  const relevant = events
    .filter((e) => `${e.ref.kind}:${e.ref.id}` === refKey && (e.kind === "archived" || e.kind === "unarchived"))
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  if (relevant.length === 0) return { archived: false, conflict: false };
  const last = relevant[relevant.length - 1];
  const prev = relevant[relevant.length - 2];
  const conflict = !!prev && prev.kind !== last.kind && Math.abs(Date.parse(prev.at) - Date.parse(last.at)) < 1000;
  return { archived: last.kind === "archived", conflict };
}
