/**
 * Onboarding state (LIFEOS-041, Feature 37).
 *
 * Persists onboarding VERSION, completed/skipped steps, dismissed education, and
 * the sample-workspace id — in `prefs.onboarding` (local + synced via user_prefs).
 * Completed steps UNION across devices unless a later explicit RESET exists
 * (resets are versioned + visible). This module owns the pure state transitions;
 * merge-rules.ts owns cross-device merge.
 */

import { useSyncExternalStore } from "react";
import { readPrefs, writePrefs } from "@/lib/prefs";
import { ONBOARDING_VERSION, STEP_IDS } from "@/lib/onboarding/steps";

export interface OnboardingState {
  version: number;
  status: "not-started" | "in-progress" | "completed" | "skipped";
  completedSteps: string[];
  skippedSteps: string[];
  /** Monotonic counter, bumped on an explicit reset (later reset wins on merge). */
  resetCounter: number;
  currentStep?: string;
  updatedAt: string;
}

export function emptyOnboarding(): OnboardingState {
  return { version: ONBOARDING_VERSION, status: "not-started", completedSteps: [], skippedSteps: [], resetCounter: 0, updatedAt: new Date(0).toISOString() };
}

export function readOnboarding(): OnboardingState {
  const p = readPrefs() as { onboardingV2?: OnboardingState; onboarding?: string };
  if (p.onboardingV2) return { ...emptyOnboarding(), ...p.onboardingV2 };
  // Migrate the legacy flag (LIFEOS-025) forward.
  const legacy = p.onboarding;
  if (legacy === "done") return { ...emptyOnboarding(), status: "completed", completedSteps: [...STEP_IDS] };
  if (legacy === "skipped") return { ...emptyOnboarding(), status: "skipped" };
  return emptyOnboarding();
}

function persist(next: OnboardingState): OnboardingState {
  const stamped = { ...next, updatedAt: new Date().toISOString() };
  writePrefs({ onboardingV2: stamped } as never);
  cached = stamped;
  listeners.forEach((l) => l());
  return stamped;
}

// ---- Reactive store (hydration-safe) so components read onboarding without a
// setState-in-effect. SERVER snapshot is the stable empty state; after mount the
// hook adopts the persisted value, then updates on every persist().
const SERVER_SNAPSHOT = emptyOnboarding();
let cached: OnboardingState | null = null;
const listeners = new Set<() => void>();
function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function snapshot(): OnboardingState { if (cached === null) cached = readOnboarding(); return cached; }

/** Subscribe a component to onboarding state (empty on the server, live after mount). */
export function useOnboarding(): OnboardingState {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
}

export function startOnboarding(): OnboardingState {
  const s = readOnboarding();
  if (s.status === "not-started") return persist({ ...s, status: "in-progress", currentStep: STEP_IDS[0] });
  return s;
}

export function completeStep(stepId: string): OnboardingState {
  const s = readOnboarding();
  if (!STEP_IDS.includes(stepId)) return s;
  const completedSteps = s.completedSteps.includes(stepId) ? s.completedSteps : [...s.completedSteps, stepId];
  const allDone = STEP_IDS.every((id) => completedSteps.includes(id) || s.skippedSteps.includes(id));
  return persist({ ...s, status: allDone ? "completed" : "in-progress", completedSteps, currentStep: stepId });
}

export function skipStep(stepId: string): OnboardingState {
  const s = readOnboarding();
  const skippedSteps = s.skippedSteps.includes(stepId) ? s.skippedSteps : [...s.skippedSteps, stepId];
  return persist({ ...s, status: "in-progress", skippedSteps });
}

export function skipOnboarding(): OnboardingState {
  return persist({ ...readOnboarding(), status: "skipped" });
}

export function completeOnboardingAll(): OnboardingState {
  const s = readOnboarding();
  return persist({ ...s, status: "completed", completedSteps: [...STEP_IDS] });
}

/** Explicit, versioned reset — bumps resetCounter so it wins on cross-device merge. */
export function resetOnboarding(): OnboardingState {
  const s = readOnboarding();
  return persist({ ...emptyOnboarding(), resetCounter: s.resetCounter + 1, status: "in-progress", currentStep: STEP_IDS[0] });
}

export function isOnboardingActive(s: OnboardingState = readOnboarding()): boolean {
  return s.status === "not-started" || s.status === "in-progress";
}
export function onboardingProgress(s: OnboardingState = readOnboarding()): { done: number; total: number } {
  const done = STEP_IDS.filter((id) => s.completedSteps.includes(id) || s.skippedSteps.includes(id)).length;
  return { done, total: STEP_IDS.length };
}
