/**
 * Deterministic three-way merge (LIFEOS-033, Feature 3).
 *
 * Given the last-synced BASE, the current LOCAL, and the current REMOTE version
 * of a record, produce a field-level merge: fields changed on only one side are
 * taken from that side automatically; child collections (arrays of `{id}`) are
 * unioned by id; fields (or child records) changed on BOTH sides to DIFFERENT
 * values are escalated as conflicts — never auto-concatenated. Pure and
 * deterministic; no clocks, no AI. The store/UI decide what to do with conflicts.
 */

export type Rec = Record<string, unknown> & { id?: string };

/** Canonical, order-independent deep equality (same helper the UX layer uses). */
export function deepEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
function canonical(v: unknown): string {
  const seen = new WeakSet();
  const norm = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x as object)) return null;
    seen.add(x as object);
    if (Array.isArray(x)) return x.map(norm);
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = norm(o[k]); return acc; }, {});
  };
  return JSON.stringify(norm(v));
}

/** Top-level keys whose value differs between two records (union of keys). */
export function changedKeys(base: Rec | undefined, rec: Rec): string[] {
  const keys = new Set<string>([...Object.keys(base ?? {}), ...Object.keys(rec)]);
  const out: string[] = [];
  for (const k of keys) if (!deepEqual((base ?? {})[k], rec[k])) out.push(k);
  return out.sort();
}

/** Is this value an array of objects that carry an `id` (a child collection)? */
function isChildList(v: unknown): v is Rec[] {
  return Array.isArray(v) && v.every((x) => x && typeof x === "object" && "id" in (x as object));
}

export interface ChildMerge { merged: Rec[]; conflictIds: string[] }

/**
 * Merge a child collection by id across base/local/remote. Additions on either
 * side are kept (union); a child edited on both sides differently is kept as the
 * local value and its id reported as a conflict; deletions on one side are
 * honored when the other side didn't edit it.
 */
export function mergeChildList(base: Rec[], local: Rec[], remote: Rec[]): ChildMerge {
  const byId = (arr: Rec[]) => new Map(arr.map((r) => [String(r.id), r]));
  const b = byId(base), l = byId(local), r = byId(remote);
  const ids = new Set<string>([...l.keys(), ...r.keys()]); // union of surviving ids
  const merged: Rec[] = [];
  const conflictIds: string[] = [];
  // Preserve a stable order: local order first, then remote-only additions.
  const order = [...local.map((x) => String(x.id)), ...remote.filter((x) => !l.has(String(x.id))).map((x) => String(x.id))];
  for (const id of order) {
    if (!ids.has(id)) continue;
    const bv = b.get(id), lv = l.get(id), rv = r.get(id);
    if (lv && rv) {
      const lChanged = !deepEqual(bv, lv), rChanged = !deepEqual(bv, rv);
      if (lChanged && rChanged && !deepEqual(lv, rv)) { conflictIds.push(id); merged.push(lv); }
      else merged.push(rChanged ? rv : lv); // take whichever changed; equal if neither
    } else if (lv && !rv) {
      if (!bv) merged.push(lv);                        // local-only addition → keep (union)
      else if (deepEqual(bv, lv)) { /* deleted remotely, unchanged locally → drop */ }
      else { conflictIds.push(id); merged.push(lv); }  // edited locally + deleted remotely → keep + flag
    } else if (!lv && rv) {
      if (!bv) merged.push(rv);                        // remote-only addition → keep (union)
      else if (deepEqual(bv, rv)) { /* deleted locally, unchanged remotely → drop */ }
      else merged.push(rv);                            // remote edited a locally-deleted child → keep remote's edit
    }
  }
  return { merged, conflictIds };
}

export type MergeStatus = "clean" | "auto" | "conflict";
export interface FieldMerge { key: string; from: "local" | "remote" | "both" }
export interface MergeResult {
  status: MergeStatus;
  merged: Rec;
  /** Fields taken automatically (non-overlapping changes). */
  autoFields: FieldMerge[];
  /** Fields (or `key#childId`) needing user resolution. */
  conflictFields: string[];
}

/**
 * Three-way merge of a single record. `status` is "clean" (no changes or
 * identical), "auto" (all divergences merged automatically), or "conflict"
 * (at least one overlapping field/child needs resolution). The `merged` record
 * always reflects the best safe merge, with local kept for conflicting fields.
 */
export function threeWayMerge(base: Rec | undefined, local: Rec, remote: Rec): MergeResult {
  const merged: Rec = { ...local };
  const autoFields: FieldMerge[] = [];
  const conflictFields: string[] = [];
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);

  for (const k of keys) {
    const bv = (base ?? {})[k], lv = local[k], rv = remote[k];
    const lChanged = !deepEqual(bv, lv);
    const rChanged = !deepEqual(bv, rv);
    if (!rChanged) { merged[k] = lv; continue; }         // remote unchanged → keep local
    if (!lChanged) { merged[k] = rv; autoFields.push({ key: k, from: "remote" }); continue; } // only remote changed
    if (deepEqual(lv, rv)) { merged[k] = lv; continue; } // same change on both sides
    // Both changed differently:
    if (isChildList(bv ?? []) && isChildList(lv) && isChildList(rv)) {
      const cm = mergeChildList((bv as Rec[]) ?? [], lv, rv);
      merged[k] = cm.merged;
      if (cm.conflictIds.length) { conflictFields.push(...cm.conflictIds.map((id) => `${k}#${id}`)); }
      autoFields.push({ key: k, from: "both" });
    } else {
      conflictFields.push(k);
      merged[k] = lv; // keep local for the conflicting scalar; never concatenate prose
    }
  }

  const status: MergeStatus = conflictFields.length ? "conflict" : autoFields.length ? "auto" : "clean";
  return { status, merged, autoFields, conflictFields };
}
