"use client";

import { useSyncExternalStore } from "react";
import { getConflicts, subscribeConflicts, type GuardedDomain, type StaleConflict } from "@/lib/sync/conflicts-store";

/**
 * `getConflicts` returns the module's cached array by reference and only
 * replaces it on a real change, so it is already a valid `useSyncExternalStore`
 * snapshot. The server snapshot must be a stable constant — returning a fresh
 * `[]` each call is the classic infinite-render trap this codebase has hit
 * before.
 */
const NONE: StaleConflict[] = [];

export function useConflicts(): StaleConflict[] {
  return useSyncExternalStore(subscribeConflicts, getConflicts, () => NONE);
}

export function useConflictFor(domain: GuardedDomain, id: string): StaleConflict | undefined {
  const all = useConflicts();
  return all.find((c) => c.domain === domain && c.id === id);
}
