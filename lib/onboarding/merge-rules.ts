/**
 * Onboarding & UI-preference sync merge (LIFEOS-041).
 *
 * The prefs blob syncs last-write-wins, but onboarding + dismissed-education must
 * UNION across devices (a step completed anywhere is completed) — UNLESS a later
 * explicit RESET exists (resets are versioned via resetCounter and win). This is
 * applied when adopting remote prefs so two devices never lose completion or
 * un-dismiss a lesson.
 *
 * Conflicts surfaced (not silently resolved): a reset on one device vs continued
 * completion on another (reset wins, flagged); density/inspector-default changed
 * differently (latest updatedAt wins, flagged).
 */

import type { OnboardingState } from "@/lib/onboarding/state";

export interface OnboardingMerge { merged: OnboardingState; conflict: boolean; reason?: string }

/** Merge two onboarding states from different devices. */
export function mergeOnboarding(local: OnboardingState, remote: OnboardingState): OnboardingMerge {
  // A later reset supersedes the other side's progress.
  if (local.resetCounter !== remote.resetCounter) {
    const winner = local.resetCounter > remote.resetCounter ? local : remote;
    const loserHadProgress = (local.resetCounter > remote.resetCounter ? remote : local).completedSteps.length > 0;
    return { merged: { ...winner }, conflict: loserHadProgress, reason: loserHadProgress ? "one device reset onboarding while the other had progress; the reset wins" : undefined };
  }
  // Same reset generation → union completed + skipped steps.
  const completedSteps = union(local.completedSteps, remote.completedSteps);
  const skippedSteps = union(local.skippedSteps, remote.skippedSteps).filter((s) => !completedSteps.includes(s));
  const status = local.status === "completed" || remote.status === "completed" ? "completed"
    : completedSteps.length + skippedSteps.length > 0 ? "in-progress"
    : local.status === "skipped" || remote.status === "skipped" ? "skipped" : "not-started";
  const latest = local.updatedAt >= remote.updatedAt ? local : remote;
  return {
    merged: { ...latest, version: Math.max(local.version, remote.version), status, completedSteps, skippedSteps, resetCounter: local.resetCounter },
    conflict: false,
  };
}

/** Dismissed-education ids union across devices (never un-dismiss on merge). */
export function mergeDismissedEducation(local: string[], remote: string[]): string[] {
  return union(local, remote);
}

export interface UiPrefConflict { field: string; local: unknown; remote: unknown }

/**
 * Merge scalar UI preferences (density, inspectorDefault, navCollapsed, …):
 * latest updatedAt wins per the blob, but we REPORT fields that differ so the
 * user isn't silently overridden.
 */
export function mergeUiPreferences(local: Record<string, unknown>, remote: Record<string, unknown>, localNewer: boolean): { merged: Record<string, unknown>; conflicts: UiPrefConflict[] } {
  const conflicts: UiPrefConflict[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const merged: Record<string, unknown> = {};
  for (const k of keys) {
    const l = local[k], r = remote[k];
    if (l !== undefined && r !== undefined && JSON.stringify(l) !== JSON.stringify(r)) conflicts.push({ field: k, local: l, remote: r });
    merged[k] = localNewer ? (l ?? r) : (r ?? l);
  }
  return { merged, conflicts };
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}
