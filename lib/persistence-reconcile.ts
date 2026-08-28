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
 * ## D-24: deletions now propagate to a second client (REPAIRED)
 *
 * "Absent from remote" reads as "new on this device". For a capture typed during
 * sign-in that is right; for a record ANOTHER DEVICE DELETED it was wrong, and
 * the two are indistinguishable without a deletion marker. The marker existed
 * and was never consulted: `sync_tombstones` was written since LIFEOS-033 and
 * never selected, so `lib/sync/tombstones.ts` never ran and a deleted record came
 * back — with its dependency edge and its recurrence completion — was pushed to
 * the server, and was then re-adopted by the very device that deleted it.
 *
 * The repair reads the ledger on the same authoritative path as the snapshot and
 * runs `suppressDeleted` on LOCAL state BEFORE this function sees it, so a stale
 * record is never marked `pushLocalOnly` in the first place. Suppressing after
 * the merge would still write it back for a beat, and temporary resurrection is
 * still resurrection.
 *
 * What did NOT change: the suppression rule itself. `applyTombstones` is called,
 * so a record edited AFTER the delete is still kept as genuine resurrection
 * intent rather than silently discarded.
 *
 * RESIDUAL WINDOW, stated rather than hidden: a delete whose tombstone write
 * failed leaves the domain dirty and retryable, and until that retry lands there
 * is no marker — so a stale client adopting inside that window still resurrects
 * the record. Sync reads "Sync incomplete" throughout, and the retry closes it.
 * Both halves are pinned in `scripts/inject-074-tombstone-gate.cjs`.
 */

import type { StoreState } from "@/types/mvp";
import { applyTombstones, type Tombstone } from "@/lib/sync/tombstones";

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

/**
 * Remove records a tombstone says were deleted elsewhere, BEFORE adoption can
 * treat them as local-only and push them back (LIFEOS-074 D-24 §3).
 *
 * Order is the whole point. Suppressing after the merge would still mark the
 * record `pushLocalOnly`, write it back, and leak its relationships for a beat —
 * temporary resurrection is still resurrection. So this runs on the LOCAL
 * snapshot first and `reconcileAdoption` never sees the stale rows.
 *
 * The rule itself is NOT reimplemented: `applyTombstones` is called, so the
 * existing semantics hold unchanged — including the one that matters most, that
 * a record edited AFTER the delete is a genuine resurrection intent and is kept,
 * surfacing as a normal conflict rather than being silently discarded (§9).
 *
 * `recurrenceCompletions` additionally follow their action. That is not an
 * invented cascade: `recurrence_completions.action_id` references
 * `next_actions` ON DELETE CASCADE since migration 0040, so the row is already
 * gone server-side, and re-adding it is exactly the foreign-key wedge D-10
 * documented. `actionDependencies` deliberately do NOT get an invented cascade —
 * they are soft references with no FK by the 0027 doctrine, they carry their own
 * tombstones when deleted through the store, and an edge that only ever existed
 * on this device is inert debris the projections already tolerate, not a
 * resurrected life fact.
 */
export function suppressDeleted(local: StoreState, tombstones: Tombstone[]): StoreState {
  if (!tombstones.length) return local;
  const out: Record<string, unknown> = { ...(local as unknown as Record<string, unknown>) };
  let changed = false;
  const suppressedActions = new Set<string>();

  for (const key of Object.keys(local) as (keyof StoreState)[]) {
    const arr = local[key] as unknown;
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const domainTombs = tombstones.filter((t) => t.domain === key);
    if (!domainTombs.length) continue;
    const { survivors, suppressed } = applyTombstones(
      key as string,
      arr as { id: string; updatedAt?: string; createdAt?: string }[],
      domainTombs,
    );
    if (!suppressed.length) continue;
    if (key === "nextActions") for (const id of suppressed) suppressedActions.add(id);
    out[key] = survivors;
    changed = true;
  }

  if (suppressedActions.size) {
    const comps = local.recurrenceCompletions ?? [];
    const kept = (out.recurrenceCompletions as typeof comps | undefined) ?? comps;
    const pruned = kept.filter((c) => !suppressedActions.has(c.actionId));
    if (pruned.length !== kept.length) { out.recurrenceCompletions = pruned; changed = true; }
  }

  return changed ? (out as unknown as StoreState) : local;
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
