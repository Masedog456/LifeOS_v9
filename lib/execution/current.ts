/**
 * Current goal/project pointers (LIFEOS-031, Features 9 & 10).
 *
 * A tiny module-level reactive store (like the workspace pointer) holding which
 * goal and project the user is currently focused on, plus recent ids for the
 * selector and command center. Backed by `prefs.execution` so it follows the
 * user across devices. UI navigation memory only — the goals/projects themselves
 * are durable domain data in `mvpStore`.
 */

import { useSyncExternalStore } from "react";
import { readPrefs, writePrefs } from "@/lib/prefs";

export interface ExecutionPointer {
  currentGoal?: string;
  currentProject?: string;
  recentGoals: string[];
  recentProjects: string[];
}

const RECENT_CAP = 8;

function read(): ExecutionPointer {
  const e = readPrefs().execution ?? {};
  return {
    currentGoal: e.currentGoal,
    currentProject: e.currentProject,
    recentGoals: e.recentGoals ?? [],
    recentProjects: e.recentProjects ?? [],
  };
}

let snapshot: ExecutionPointer = { currentGoal: undefined, currentProject: undefined, recentGoals: [], recentProjects: [] };
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commit(next: ExecutionPointer) {
  snapshot = next;
  writePrefs({ execution: { currentGoal: next.currentGoal, currentProject: next.currentProject, recentGoals: next.recentGoals, recentProjects: next.recentProjects } });
  emit();
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  snapshot = read();
  emit();
}

export function setCurrentGoal(id: string | undefined): void {
  ensureHydrated();
  const recentGoals = id ? [id, ...snapshot.recentGoals.filter((r) => r !== id)].slice(0, RECENT_CAP) : snapshot.recentGoals;
  commit({ ...snapshot, currentGoal: id, recentGoals });
}

export function setCurrentProject(id: string | undefined): void {
  ensureHydrated();
  const recentProjects = id ? [id, ...snapshot.recentProjects.filter((r) => r !== id)].slice(0, RECENT_CAP) : snapshot.recentProjects;
  commit({ ...snapshot, currentProject: id, recentProjects });
}

export function currentGoalId(): string | undefined { ensureHydrated(); return snapshot.currentGoal; }
export function currentProjectId(): string | undefined { ensureHydrated(); return snapshot.currentProject; }

export function forgetGoal(id: string): void {
  ensureHydrated();
  commit({ ...snapshot, currentGoal: snapshot.currentGoal === id ? undefined : snapshot.currentGoal, recentGoals: snapshot.recentGoals.filter((r) => r !== id) });
}
export function forgetProject(id: string): void {
  ensureHydrated();
  commit({ ...snapshot, currentProject: snapshot.currentProject === id ? undefined : snapshot.currentProject, recentProjects: snapshot.recentProjects.filter((r) => r !== id) });
}

// ---- React binding ----
function subscribe(l: () => void): () => void { ensureHydrated(); listeners.add(l); return () => listeners.delete(l); }
function getSnapshot(): ExecutionPointer { return snapshot; }
const SERVER: ExecutionPointer = { currentGoal: undefined, currentProject: undefined, recentGoals: [], recentProjects: [] };
export function useExecutionPointer(): ExecutionPointer {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
}
