/**
 * Local↔remote adoption reconciliation (LIFEOS capture-persistence fix).
 *
 * When an authenticated session is established, the persistence facade loads the
 * remote snapshot and decides how to reconcile it with whatever is already on
 * this device. The previous logic adopted the remote snapshot by REPLACING local
 * state wholesale — which silently rolled back any local record created during
 * the (asynchronous) remote load, e.g. a Capture typed in the moment right after
 * sign-in. That is a data-loss bug for a local-first app.
 *
 * This module isolates the decision as a PURE function so it can be unit-tested
 * without Supabase, and guarantees the core invariant:
 *
 *   Adopting remote data must NEVER drop a local record that remote doesn't have.
 *
 * Remote stays the source of truth for records it already knows (same id →
 * remote wins), but any local-only record (a just-created capture, or offline
 * work) is preserved AND flagged to be pushed up. Wrong-user safety is kept:
 * local data belonging to a different account is never merged into this one.
 *
 * ## KNOWN DEFECT — D-24: deletions do not propagate to a second client (P1)
 *
 * "Absent from remote" is read here as "new on this device". For a capture typed
 * during sign-in that is exactly right. For a record ANOTHER DEVICE DELETED it is
 * exactly wrong, and the two are indistinguishable without consulting a deletion
 * marker. Nothing consults one.
 *
 * Driven end-to-end (LIFEOS-074 tombstone gate), not inferred: device A deletes a
 * record, the remote row is really removed, then a client still holding it adopts
 * — the record is merged back, flagged `pushLocalOnly`, and written back into the
 * database. Its dependency edges and recurrence completions come back with it.
 * The device that performed the delete then adopts the resurrection in turn, so
 * the deletion is undone rather than merely delayed. `INITIAL_SESSION` drives
 * adoption on every app load, so this does not wait for a fresh sign-in.
 *
 * The tombstone layer that exists to stop this is NEVER CONSULTED:
 * `lib/sync/tombstones.ts` is correct and fully tested, `applyTombstones` has no
 * production caller, and `loadState` never reads `sync_tombstones` — the table is
 * written and never read. A tombstone that WRITES SUCCESSFULLY prevents nothing,
 * which was proved as the control case. So the earlier reading of the swallowed
 * tombstone write as the hazard was wrong: the swallow is not the cause and
 * repairing it would fix nothing.
 *
 * SCOPE, stated precisely: a single client is unaffected — local is authoritative,
 * the delete lands locally and remotely, and the next load agrees. This needs a
 * second client (or the same account in another browser/profile) holding state
 * from before the delete.
 *
 * NOT REPAIRED HERE. Wiring a deletion marker into adoption changes what "adopt"
 * means and touches load, merge and push together; it was reported for a decision
 * rather than attempted inside an audit. Pinned by assertions 55-57 in
 * `lib/sync/selftest.ts`, written to FAIL once a marker is honoured.
 */

import type { StoreState } from "@/types/mvp";

/** A record with an id — every synced domain row has one. */
type Ided = { id?: string };

/**
 * Union any LOCAL-ONLY records (by id, per domain) into the remote snapshot.
 * Remote wins for ids present on both sides. Domains with no local-only records
 * keep the exact remote array reference (so a downstream reference-diff flags
 * only the domains that actually gained records). Returns the SAME `remote`
 * reference when nothing was added, so callers can cheaply detect "no change".
 */
export function mergeLocalOnly(remote: StoreState, local: StoreState): StoreState {
  let changed = false;
  const out: Record<string, unknown> = { ...(remote as unknown as Record<string, unknown>) };
  for (const key of Object.keys(remote) as (keyof StoreState)[]) {
    const r = remote[key] as unknown;
    const l = local[key] as unknown;
    if (!Array.isArray(r) || !Array.isArray(l) || l.length === 0) continue;
    const remoteIds = new Set((r as Ided[]).map((x) => x?.id).filter(Boolean) as string[]);
    const localOnly = (l as Ided[]).filter((x) => x && x.id && !remoteIds.has(x.id));
    if (localOnly.length) {
      // Local-only first so newly-created records (e.g. the just-made capture)
      // stay at the top of the list, matching in-app insertion order.
      out[key] = [...localOnly, ...(r as unknown[])];
      changed = true;
    }
  }
  return changed ? (out as unknown as StoreState) : remote;
}

export type AdoptionAction = "adopt" | "adopt-merge" | "migrate-local" | "start-clean";

export interface AdoptionDecision {
  action: AdoptionAction;
  /** The state to install locally and show the user. */
  state: StoreState;
  /** The confirmed-synced baseline to diff future remote pushes against. */
  baseline: StoreState;
  /** True when `state` holds local records not yet on remote → they must be pushed. */
  pushLocalOnly: boolean;
}

/**
 * Decide how to reconcile local and remote at sign-in. Pure and deterministic.
 *
 *  - remote has data              → adopt remote, but MERGE in local-only records
 *                                   (never drop a local capture); push those up.
 *  - remote empty, local is ours  → keep local (this user owns it) and push it up.
 *  - remote empty, local is else's → start clean for this user (nothing deleted
 *                                     from remote; their data lives elsewhere).
 */
export function reconcileAdoption(input: {
  remote: StoreState;
  local: StoreState;
  remoteHasData: boolean;
  localHasData: boolean;
  migratedFor: string | null;
  userId: string;
  empty: StoreState;
}): AdoptionDecision {
  const { remote, local, remoteHasData, localHasData, migratedFor, userId, empty } = input;
  const localIsOurs = !migratedFor || migratedFor === userId;

  if (remoteHasData) {
    const merged = localIsOurs && localHasData ? mergeLocalOnly(remote, local) : remote;
    const addedLocal = merged !== remote;
    return {
      action: addedLocal ? "adopt-merge" : "adopt",
      state: merged,
      baseline: remote,
      pushLocalOnly: addedLocal,
    };
  }
  if (localIsOurs) {
    return { action: "migrate-local", state: local, baseline: empty, pushLocalOnly: localHasData };
  }
  return { action: "start-clean", state: empty, baseline: empty, pushLocalOnly: false };
}
