/**
 * Current-workspace pointer (LIFEOS-030, Features 11 & 12).
 *
 * A tiny module-level reactive store (like the inspector store) holding which
 * workspace the user is currently "in", plus recently-visited and pinned
 * workspace ids for the selector and command center. Backed by `prefs.workspace`
 * so it follows the user across devices. This is UI navigation memory only — the
 * workspaces and sessions themselves are durable domain data in `mvpStore`.
 */

import { useSyncExternalStore } from "react";
import { readPrefs, writePrefs } from "@/lib/prefs";

export interface WorkspacePointer {
  current?: string;
  recent: string[];
  pinned: string[];
}

const RECENT_CAP = 8;

function read(): WorkspacePointer {
  const w = readPrefs().workspace ?? {};
  return { current: w.current, recent: w.recent ?? [], pinned: w.pinned ?? [] };
}

let snapshot: WorkspacePointer = { current: undefined, recent: [], pinned: [] };
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commit(next: WorkspacePointer) {
  snapshot = next;
  writePrefs({ workspace: { current: next.current, recent: next.recent, pinned: next.pinned } });
  emit();
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  snapshot = read();
  emit();
}

/** Set (or clear) the current workspace, recording it in recent history. */
export function setCurrentWorkspace(id: string | undefined): void {
  ensureHydrated();
  const recent = id ? [id, ...snapshot.recent.filter((r) => r !== id)].slice(0, RECENT_CAP) : snapshot.recent;
  commit({ ...snapshot, current: id, recent });
}

export function currentWorkspaceId(): string | undefined {
  ensureHydrated();
  return snapshot.current;
}

/** Pin/unpin a workspace for quick access in the selector & command center. */
export function toggleWorkspacePinned(id: string): void {
  ensureHydrated();
  const pinned = snapshot.pinned.includes(id)
    ? snapshot.pinned.filter((p) => p !== id)
    : [...snapshot.pinned, id];
  commit({ ...snapshot, pinned });
}

export function isWorkspacePinned(id: string): boolean {
  ensureHydrated();
  return snapshot.pinned.includes(id);
}

/** Drop a workspace from all pointers (called when a workspace is deleted). */
export function forgetWorkspace(id: string): void {
  ensureHydrated();
  commit({
    current: snapshot.current === id ? undefined : snapshot.current,
    recent: snapshot.recent.filter((r) => r !== id),
    pinned: snapshot.pinned.filter((p) => p !== id),
  });
}

// ---- React binding ----
function subscribe(l: () => void): () => void {
  ensureHydrated();
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot(): WorkspacePointer { return snapshot; }
const SERVER: WorkspacePointer = { current: undefined, recent: [], pinned: [] };
export function useWorkspacePointer(): WorkspacePointer {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
}
