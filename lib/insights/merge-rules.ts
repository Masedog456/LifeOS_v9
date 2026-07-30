/**
 * Sync-conflict rules for saved insight views (LIFEOS-039).
 *
 * Deterministic three-way merge on the LIFEOS-033 engine. Saved views created
 * independently union; the SAME view edited differently (name/range/grouping/
 * filters), or deleted on one device and edited on the other, is a CONFLICT
 * (local kept until resolved). A saved-view merge NEVER touches source activity
 * records, and the same view id is never duplicated. Pure.
 */

import type { SavedInsightView } from "@/types/mvp";

const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

export interface ViewMergeResult { merged: SavedInsightView; conflict?: string }

/** Merge one saved view (same id) across devices. Latest `updatedAt` wins on a clean edit. */
export function mergeSavedView(base: SavedInsightView | undefined, local: SavedInsightView, remote: SavedInsightView): ViewMergeResult {
  const fields: (keyof SavedInsightView)[] = ["name", "insight", "rangeKind", "customStart", "customEnd", "grouping", "filters"];
  const lChanged = fields.some((f) => changed(base?.[f], local[f]));
  const rChanged = fields.some((f) => changed(base?.[f], remote[f]));
  const diverged = fields.some((f) => changed(local[f], remote[f]));
  if (lChanged && rChanged && diverged) {
    // Both edited the same view differently → conflict; keep local, flag.
    return { merged: { ...local, updatedAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt }, conflict: "saved view edited differently on two devices" };
  }
  // Otherwise take whichever side changed (last-write by updatedAt as tiebreak).
  const winner = rChanged && !lChanged ? remote : local.updatedAt >= remote.updatedAt ? local : remote;
  return { merged: winner };
}

export interface ViewSetMergeResult { merged: SavedInsightView[]; conflicts: { id: string; reason: string }[] }

/**
 * Merge two device views of the saved-view set, keyed by id. Views present on
 * only one side are kept; a delete-vs-edit divergence is a conflict (the edited
 * view is kept, flagged). The same id is never duplicated.
 */
export function mergeSavedViewSets(base: SavedInsightView[], local: SavedInsightView[], remote: SavedInsightView[]): ViewSetMergeResult {
  const bm = new Map(base.map((v) => [v.id, v] as const));
  const lm = new Map(local.map((v) => [v.id, v] as const));
  const rm = new Map(remote.map((v) => [v.id, v] as const));
  const merged: SavedInsightView[] = [];
  const conflicts: { id: string; reason: string }[] = [];
  for (const idv of new Set([...lm.keys(), ...rm.keys()])) {
    const l = lm.get(idv), r = rm.get(idv), b = bm.get(idv);
    if (l && r) { const m = mergeSavedView(b, l, r); merged.push(m.merged); if (m.conflict) conflicts.push({ id: idv, reason: m.conflict }); }
    else if (l && !r) {
      // Present locally, absent remotely. If it existed in base and is unchanged → honor the remote delete.
      if (b && !changed(b, l)) continue;
      merged.push(l);
      if (b) conflicts.push({ id: idv, reason: "saved view deleted on one device but edited on the other" });
    } else if (r && !l) {
      if (b && !changed(b, r)) continue;
      merged.push(r);
      if (b) conflicts.push({ id: idv, reason: "saved view deleted on one device but edited on the other" });
    }
  }
  return { merged, conflicts };
}
