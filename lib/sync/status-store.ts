/**
 * Reactive sync status (LIFEOS-033, Features 4/10/11/13).
 *
 * A tiny module-level store (like the inspector store) holding the transient,
 * cross-cutting sync state the UI needs: unresolved conflicts awaiting
 * resolution, whether the app is in recovery mode, the last recovery report, and
 * a one-shot restore ROLLBACK snapshot. Not a second source of truth for domain
 * data — it references conflicts and holds a single rollback buffer that is
 * cleared on the next explicit mutation or dismissal.
 */

import { useSyncExternalStore } from "react";
import type { StoreState } from "@/types/mvp";
import type { RecordConflict } from "@/lib/sync/conflicts";
import type { RecoveryReport } from "@/lib/sync/recovery";

export interface SyncStatusState {
  conflicts: RecordConflict[];
  recoveryMode: boolean;
  recovery: RecoveryReport | null;
  /** A snapshot to roll back to after a restore, until the next mutation. */
  rollback: { label: string; state: StoreState } | null;
}

let state: SyncStatusState = { conflicts: [], recoveryMode: false, recovery: null, rollback: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(next: Partial<SyncStatusState>) { state = { ...state, ...next }; emit(); }

export function setConflicts(conflicts: RecordConflict[]): void { set({ conflicts }); }
export function resolveConflict(domain: string, id: string): void {
  set({ conflicts: state.conflicts.filter((c) => !(c.domain === domain && c.id === id)) });
}
export function clearConflicts(): void { set({ conflicts: [] }); }
export function unresolvedCount(): number { return state.conflicts.filter((c) => c.needsResolution).length; }

export function setRecovery(report: RecoveryReport | null): void {
  set({ recovery: report, recoveryMode: report?.recoveryMode ?? false });
}

/** Stash a rollback snapshot after a restore (cleared on next mutation). */
export function setRollback(label: string, snapshot: StoreState): void { set({ rollback: { label, state: snapshot } }); }
export function clearRollback(): void { if (state.rollback) set({ rollback: null }); }
export function getRollback(): { label: string; state: StoreState } | null { return state.rollback; }

export function getSyncStatus(): SyncStatusState { return state; }

// ---- React binding ----
function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
const SERVER: SyncStatusState = { conflicts: [], recoveryMode: false, recovery: null, rollback: null };
export function useSyncStatus(): SyncStatusState {
  return useSyncExternalStore(subscribe, getSyncStatus, () => SERVER);
}
