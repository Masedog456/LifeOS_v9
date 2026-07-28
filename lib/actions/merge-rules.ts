/**
 * Sync-conflict rules for next actions (LIFEOS-036).
 *
 * Deterministic three-way merge of an action's fields, layered on the LIFEOS-033
 * sync engine. Overriding rule: NEVER lose completion history or dependencies
 * silently. Additive, order-independent fields (tags, links, history) UNION;
 * genuine decision divergence ESCALATES as a conflict for the shared resolver.
 *
 * Encoded cases (from the sprint spec):
 *  - local tag add + remote note edit        → auto-merge
 *  - different linked entities added          → union
 *  - different history events added           → union
 *  - completed locally + cancelled remotely   → conflict (terminal divergence)
 *  - deferred locally + started remotely      → conflict
 *  - project reassigned on both devices       → conflict
 *  - divergent title/description edits         → conflict
 *  - action completed on both with different notes → conflict
 *
 * Dependencies are separate edge records: additions union; a removal on one side
 * while the same edge is otherwise untouched applies; see `mergeDependencies`.
 */

import type { NextAction, ActionDependency, ActionHistoryEvent, RecordRefLite } from "@/types/mvp";

const uniqRefs = (...lists: (RecordRefLite[] | undefined)[]): RecordRefLite[] => {
  const out: RecordRefLite[] = []; const seen = new Set<string>();
  for (const list of lists) for (const r of list ?? []) { const k = `${r.kind}:${r.id}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
};
const uniqStrs = (...lists: (string[] | undefined)[]): string[] => {
  const out: string[] = []; const seen = new Set<string>();
  for (const list of lists) for (const s of list ?? []) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out;
};
const uniqHistory = (...lists: (ActionHistoryEvent[] | undefined)[]): ActionHistoryEvent[] => {
  const out: ActionHistoryEvent[] = []; const seen = new Set<string>();
  for (const list of lists) for (const e of list ?? []) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
};
const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

const TERMINAL = new Set(["completed", "cancelled"]);

export interface ActionMergeResult { merged: NextAction; conflicts: string[]; autoMerged: string[] }

export function mergeActionRecord(base: NextAction, local: NextAction, remote: NextAction): ActionMergeResult {
  const conflicts: string[] = [];
  const autoMerged: string[] = [];
  const merged: NextAction = { ...local };

  // Union additive fields — never lose links, tags, or history.
  merged.tags = uniqStrs(base.tags, local.tags, remote.tags);
  merged.linkedEntityRefs = uniqRefs(base.linkedEntityRefs, local.linkedEntityRefs, remote.linkedEntityRefs);
  merged.history = uniqHistory(base.history, local.history, remote.history);
  autoMerged.push("tags", "links", "history");

  // Status transitions.
  const bs = base.status, ls = local.status, rs = remote.status;
  const localChanged = ls !== bs, remoteChanged = rs !== bs;
  if (localChanged && remoteChanged && ls !== rs) {
    // Divergent transitions (e.g. completed vs cancelled, deferred vs started).
    conflicts.push("status");
    merged.status = ls; // keep local; resolver decides
  } else {
    merged.status = localChanged ? ls : rs;
    if (localChanged || remoteChanged) autoMerged.push("status");
  }
  // Terminal-with-different-completion-notes → conflict even if both "completed".
  if (TERMINAL.has(ls) && TERMINAL.has(rs) && ls === rs && changed(local.notes, remote.notes)) {
    conflicts.push("completion-notes");
  }
  // Carry the owning side's timestamps for the resulting status.
  const owner = merged.status === rs && remoteChanged && !localChanged ? remote : local;
  merged.completedAt = owner.completedAt ?? local.completedAt ?? remote.completedAt;
  merged.cancelledAt = owner.cancelledAt ?? local.cancelledAt ?? remote.cancelledAt;
  merged.deferredUntil = owner.deferredUntil;
  merged.waitingOn = owner.waitingOn;
  merged.waitingSince = owner.waitingSince;
  merged.followUpDate = owner.followUpDate;

  // Title / description: divergent edits → conflict; else take the changed side.
  for (const field of ["title", "description"] as const) {
    const lc = changed(base[field], local[field]);
    const rc = changed(base[field], remote[field]);
    if (lc && rc && changed(local[field], remote[field])) { conflicts.push(field); merged[field] = local[field]; }
    else merged[field] = lc ? local[field] : (rc ? remote[field] : base[field]);
  }

  // Notes: divergent edits → conflict; else take the changed side (union-ish).
  {
    const lc = changed(base.notes, local.notes), rc = changed(base.notes, remote.notes);
    if (lc && rc && changed(local.notes, remote.notes)) { conflicts.push("notes"); merged.notes = local.notes; }
    else merged.notes = lc ? local.notes : (rc ? remote.notes : base.notes);
  }

  // Project reassignment on both devices → conflict.
  {
    const lc = changed(base.projectId, local.projectId), rc = changed(base.projectId, remote.projectId);
    if (lc && rc && local.projectId !== remote.projectId) { conflicts.push("projectId"); merged.projectId = local.projectId; }
    else merged.projectId = lc ? local.projectId : (rc ? remote.projectId : base.projectId);
    // Milestone/goal/workspace follow the same take-the-changed-side rule (no conflict escalation).
    merged.goalId = changed(base.goalId, local.goalId) ? local.goalId : remote.goalId ?? base.goalId;
    merged.milestoneId = changed(base.milestoneId, local.milestoneId) ? local.milestoneId : remote.milestoneId ?? base.milestoneId;
    merged.workspaceId = changed(base.workspaceId, local.workspaceId) ? local.workspaceId : remote.workspaceId ?? base.workspaceId;
  }

  return { merged, conflicts, autoMerged };
}

export interface DependencyMergeResult { merged: ActionDependency[]; autoMerged: number; conflicts: string[] }

/**
 * Merge dependency edge-sets. Additions on either side union in (safe when they
 * don't create a cycle). A removal that also has a diverging edit elsewhere is a
 * conflict handled at the action level; here, an edge present in exactly one of
 * local/remote but not base is treated as an addition and kept; an edge removed
 * on BOTH is dropped. Cycles are re-validated by the store on apply.
 */
export function mergeDependencies(base: ActionDependency[], local: ActionDependency[], remote: ActionDependency[]): DependencyMergeResult {
  const key = (d: ActionDependency) => `${d.blockerId}->${d.blockedId}`;
  const baseSet = new Set(base.map(key));
  const localMap = new Map(local.map((d) => [key(d), d] as const));
  const remoteMap = new Map(remote.map((d) => [key(d), d] as const));
  const allKeys = new Set([...localMap.keys(), ...remoteMap.keys(), ...baseSet]);
  const merged: ActionDependency[] = [];
  let autoMerged = 0;
  for (const k of allKeys) {
    const inLocal = localMap.has(k), inRemote = remoteMap.has(k), inBase = baseSet.has(k);
    // Removed on both (present in base, absent both sides) → drop.
    if (inBase && !inLocal && !inRemote) continue;
    // Removed on one side only (present in base + other side) → keep the removal? No:
    // never silently discard a dependency — keep it unless BOTH removed it.
    const edge = localMap.get(k) ?? remoteMap.get(k);
    if (edge) { merged.push(edge); if (!inBase) autoMerged += 1; }
  }
  return { merged, autoMerged, conflicts: [] };
}
