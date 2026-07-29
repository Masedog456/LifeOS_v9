/**
 * Sync-conflict rules for planning & focus (LIFEOS-037).
 *
 * Deterministic merge, layered on the LIFEOS-033 engine. Overriding rules:
 * **never silently duplicate a planning assignment, and never silently lose
 * focus history.** Pure.
 *
 * Assignment merges are keyed by the RECORD reference (kind:id), not the
 * assignment id — so the same record planned on two devices resolves to ONE
 * assignment, never two.
 */

import type { PlanningAssignment, FocusSession, FocusInterruption, PlanningHistoryEvent } from "@/types/mvp";

const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

const uniqHistory = (...lists: (PlanningHistoryEvent[] | undefined)[]): PlanningHistoryEvent[] => {
  const out: PlanningHistoryEvent[] = []; const seen = new Set<string>();
  for (const list of lists) for (const e of list ?? []) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
};
const uniqInterruptions = (...lists: (FocusInterruption[] | undefined)[]): FocusInterruption[] => {
  const out: FocusInterruption[] = []; const seen = new Set<string>();
  for (const list of lists) for (const e of list ?? []) if (!seen.has(e.id)) { seen.add(e.id); out.push(e); }
  return out.sort((a, b) => a.at.localeCompare(b.at));
};

export interface AssignmentMergeResult { merged: PlanningAssignment; conflicts: string[]; autoMerged: string[] }

/**
 * Merge one record's assignment across devices (same record ref on both sides).
 * History unions; a divergent horizon change → conflict; incompatible order
 * changes → conflict (kept local until resolved).
 */
export function mergeAssignment(base: PlanningAssignment | undefined, local: PlanningAssignment, remote: PlanningAssignment): AssignmentMergeResult {
  const conflicts: string[] = [];
  const autoMerged: string[] = [];
  const merged: PlanningAssignment = { ...local };
  merged.history = uniqHistory(base?.history, local.history, remote.history);
  autoMerged.push("history");

  const bh = base?.horizon;
  const lChanged = changed(bh, local.horizon), rChanged = changed(bh, remote.horizon);
  if (lChanged && rChanged && local.horizon !== remote.horizon) {
    conflicts.push("horizon");
    merged.horizon = local.horizon; // keep local; resolver decides
  } else {
    merged.horizon = lChanged ? local.horizon : (rChanged ? remote.horizon : (bh ?? local.horizon));
    if (lChanged || rChanged) autoMerged.push("horizon");
  }

  const bo = base?.order;
  const loChanged = changed(bo, local.order), roChanged = changed(bo, remote.order);
  if (loChanged && roChanged && local.order !== remote.order) { conflicts.push("order"); merged.order = local.order; }
  else merged.order = loChanged ? local.order : (roChanged ? remote.order : local.order);

  return { merged, conflicts, autoMerged };
}

/**
 * Merge two device views of assignment SETS, de-duplicating by record ref so a
 * record planned on both devices yields exactly one assignment. Per-record
 * conflicts (divergent horizon/order) are reported.
 */
export interface AssignmentSetMergeResult { merged: PlanningAssignment[]; conflicts: { ref: string; fields: string[] }[] }
export function mergeAssignmentSets(base: PlanningAssignment[], local: PlanningAssignment[], remote: PlanningAssignment[]): AssignmentSetMergeResult {
  const key = (a: PlanningAssignment) => `${a.ref.kind}:${a.ref.id}`;
  const bm = new Map(base.map((a) => [key(a), a] as const));
  const lm = new Map(local.map((a) => [key(a), a] as const));
  const rm = new Map(remote.map((a) => [key(a), a] as const));
  const keys = new Set([...lm.keys(), ...rm.keys()]);
  const merged: PlanningAssignment[] = [];
  const conflicts: { ref: string; fields: string[] }[] = [];
  for (const k of keys) {
    const l = lm.get(k), r = rm.get(k), b = bm.get(k);
    if (l && r) { const m = mergeAssignment(b, l, r); merged.push(m.merged); if (m.conflicts.length) conflicts.push({ ref: k, fields: m.conflicts }); }
    else if (l && !r) {
      // Removed remotely but present/edited locally → keep local (never silently drop a plan),
      // unless it was unchanged since base (then honor the remote removal).
      if (b && !changed(b.horizon, l.horizon) && !changed(b.order, l.order)) continue; // removed remotely, untouched locally
      merged.push(l);
      if (b) conflicts.push({ ref: k, fields: ["removed-vs-moved"] });
    }
    else if (r && !l) {
      if (b && !changed(b.horizon, r.horizon) && !changed(b.order, r.order)) continue; // removed locally, untouched remotely
      merged.push(r);
      if (b) conflicts.push({ ref: k, fields: ["removed-vs-moved"] });
    }
  }
  return { merged, conflicts };
}

export interface FocusMergeResult { merged: FocusSession; conflicts: string[]; autoMerged: string[] }

/** Merge a focus session: interruptions + history UNION; end-vs-extend → conflict. */
export function mergeFocusSession(base: FocusSession | undefined, local: FocusSession, remote: FocusSession): FocusMergeResult {
  const conflicts: string[] = [];
  const autoMerged: string[] = [];
  const merged: FocusSession = { ...local };
  merged.interruptions = uniqInterruptions(base?.interruptions, local.interruptions, remote.interruptions);
  merged.history = uniqHistory(base?.history, local.history, remote.history);
  merged.panels = { ...(remote.panels ?? {}), ...(local.panels ?? {}) }; // panel visibility: local wins per key
  autoMerged.push("interruptions", "history", "panels");

  // Focus ended locally but extended remotely (or vice versa) → conflict; keep the ENDED
  // state's history and flag it (never lose the fact that a focus session happened).
  const localEnded = !!local.endedAt, remoteEnded = !!remote.endedAt;
  if (localEnded !== remoteEnded) {
    conflicts.push("ended");
    merged.endedAt = local.endedAt ?? remote.endedAt; // keep whichever ended it
  } else {
    merged.endedAt = local.endedAt ?? remote.endedAt;
  }
  return { merged, conflicts, autoMerged };
}

export interface CapacityMergeResult { merged: Record<string, number>; conflicts: string[] }
/**
 * Merge capacity soft limits: unrelated changes auto-merge; the SAME limit changed
 * differently on both devices → conflict. A key absent on one side means that side
 * has no opinion (not a change), so it never conflicts.
 */
export function mergeCapacityLimits(base: Record<string, number>, local: Record<string, number>, remote: Record<string, number>): CapacityMergeResult {
  const merged: Record<string, number> = {};
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  for (const k of keys) {
    const lChanged = (k in local) && changed(base[k], local[k]);
    const rChanged = (k in remote) && changed(base[k], remote[k]);
    if (lChanged && rChanged && local[k] !== remote[k]) { conflicts.push(k); merged[k] = local[k]; }
    else if (lChanged) merged[k] = local[k];
    else if (rChanged) merged[k] = remote[k];
    else if (k in base) merged[k] = base[k];
    else if (k in local) merged[k] = local[k];
    else if (k in remote) merged[k] = remote[k];
  }
  return { merged, conflicts };
}
