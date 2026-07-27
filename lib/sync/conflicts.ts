/**
 * Deterministic conflict detection (LIFEOS-033, Feature 2).
 *
 * Compares the last-synced BASE against current LOCAL and REMOTE snapshots (per
 * domain, per record id) and classifies each record: unchanged, one-sided
 * (auto-applied), auto-mergeable, delete-vs-edit, or a true conflict needing
 * resolution. Never silently applies last-write-wins to records both sides
 * authored. Pure — the store/UI act on the result. Server timestamps are
 * preferred as `updatedAt` when the adapter supplies them; client clocks are
 * never the sole basis for a conflict decision (structural diff is).
 */

import type { StoreState } from "@/types/mvp";
import { deepEqual, threeWayMerge, changedKeys, type Rec, type MergeResult } from "@/lib/sync/merge";

export type ConflictKind =
  | "unchanged" | "local_only" | "remote_only" | "auto_merged"
  | "delete_local_edit_remote" | "delete_remote_edit_local" | "conflict";

export interface RecordConflict {
  domain: string;
  id: string;
  kind: ConflictKind;
  /** Whether the user must resolve this (true only for conflict + delete-vs-edit). */
  needsResolution: boolean;
  changedLocal: string[];
  changedRemote: string[];
  merge?: MergeResult;
  base?: Rec;
  local?: Rec;
  remote?: Rec;
}

const byId = (arr: Rec[]) => new Map(arr.map((r) => [String(r.id), r]));

/** Classify one record given its base/local/remote presence + content. */
export function classifyRecord(domain: string, id: string, base: Rec | undefined, local: Rec | undefined, remote: Rec | undefined): RecordConflict {
  const changedLocal = local ? changedKeys(base, local) : [];
  const changedRemote = remote ? changedKeys(base, remote) : [];
  const base0 = base;

  // Deletions.
  if (base && !local && remote) {
    // Deleted locally; remote still present. Conflict only if remote edited it.
    const remoteEdited = !deepEqual(base, remote);
    return { domain, id, kind: "delete_local_edit_remote", needsResolution: remoteEdited, changedLocal, changedRemote, base: base0, remote };
  }
  if (base && local && !remote) {
    const localEdited = !deepEqual(base, local);
    return { domain, id, kind: "delete_remote_edit_local", needsResolution: localEdited, changedLocal, changedRemote, base: base0, local };
  }
  if (!local && !remote) return { domain, id, kind: "unchanged", needsResolution: false, changedLocal, changedRemote };

  const lChanged = local ? !deepEqual(base, local) : false;
  const rChanged = remote ? !deepEqual(base, remote) : false;

  if (!base && local && !remote) return { domain, id, kind: "local_only", needsResolution: false, changedLocal, changedRemote, local };
  if (!base && remote && !local) return { domain, id, kind: "remote_only", needsResolution: false, changedLocal, changedRemote, remote };

  if (local && remote) {
    if (!lChanged && !rChanged) return { domain, id, kind: "unchanged", needsResolution: false, changedLocal, changedRemote, base: base0, local, remote };
    if (lChanged && !rChanged) return { domain, id, kind: "local_only", needsResolution: false, changedLocal, changedRemote, base: base0, local, remote };
    if (!lChanged && rChanged) return { domain, id, kind: "remote_only", needsResolution: false, changedLocal, changedRemote, base: base0, local, remote };
    // Both changed.
    const merge = threeWayMerge(base, local, remote);
    return {
      domain, id, kind: merge.status === "conflict" ? "conflict" : "auto_merged",
      needsResolution: merge.status === "conflict", changedLocal, changedRemote, merge, base: base0, local, remote,
    };
  }
  return { domain, id, kind: "unchanged", needsResolution: false, changedLocal, changedRemote };
}

/** Detect conflicts across one domain's base/local/remote arrays. */
export function detectDomainConflicts(domain: string, base: Rec[], local: Rec[], remote: Rec[]): RecordConflict[] {
  const b = byId(base), l = byId(local), r = byId(remote);
  const ids = new Set<string>([...b.keys(), ...l.keys(), ...r.keys()]);
  const out: RecordConflict[] = [];
  for (const id of ids) {
    const c = classifyRecord(domain, id, b.get(id), l.get(id), r.get(id));
    // Only surface interesting outcomes (skip plain unchanged/one-sided-noop).
    if (c.kind === "unchanged") continue;
    out.push(c);
  }
  return out.sort((a, b2) => (a.needsResolution === b2.needsResolution ? a.id.localeCompare(b2.id) : a.needsResolution ? -1 : 1));
}

export interface ConflictReport {
  total: number;
  needsResolution: number;
  autoMerged: number;
  byDomain: Record<string, RecordConflict[]>;
}

const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

/**
 * Detect conflicts across the whole state. `base` is the last-synced snapshot;
 * `local` and `remote` are the two divergent snapshots. Domains not present in
 * all three are compared with empty arrays as needed.
 */
export function detectConflicts(base: Partial<StoreState> | null, local: StoreState, remote: Partial<StoreState>): ConflictReport {
  const domains = Object.keys(local) as (keyof StoreState)[];
  const byDomain: Record<string, RecordConflict[]> = {};
  let needsResolution = 0, autoMerged = 0, total = 0;
  for (const d of domains) {
    const cs = detectDomainConflicts(String(d), arr((base ?? {})[d]), arr(local[d]), arr(remote[d]));
    if (cs.length) {
      byDomain[String(d)] = cs;
      total += cs.length;
      needsResolution += cs.filter((c) => c.needsResolution).length;
      autoMerged += cs.filter((c) => c.kind === "auto_merged" && !c.needsResolution).length;
    }
  }
  return { total, needsResolution, autoMerged, byDomain };
}
