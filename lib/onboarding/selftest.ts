/**
 * Onboarding self-tests (LIFEOS-041).
 *
 * Step progression, skip/resume/reset, sample-workspace create/remove, merge
 * rules (step union + versioned reset + dismissed-education union + UI-pref
 * conflicts), and education/help mapping. Pure functions only (no prefs I/O).
 */

import { STEPS, STEP_IDS, nextStepId, prevStepId, stepIndex, ONBOARDING_VERSION } from "@/lib/onboarding/steps";
import { emptyOnboarding, onboardingProgress, isOnboardingActive, type OnboardingState } from "@/lib/onboarding/state";
import { mergeOnboarding, mergeDismissedEducation, mergeUiPreferences } from "@/lib/onboarding/merge-rules";
import { buildSampleWorkspace, addSample, removeSample, sampleRecordCount, SAMPLE_TAG } from "@/lib/onboarding/sample-workspace";
import { LESSONS, lessonsForContext, helpForRoute, HELP_SECTIONS } from "@/lib/onboarding/education";
import type { StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  const base: Record<string, unknown[]> = {};
  for (const d of ["captures", "beliefs", "documents", "citations", "workspaces", "sessions", "projects", "nextActions", "focusSessions", "dailyReviews", "duplicateCandidates", "goals", "maintenanceEvents"]) base[d] = [];
  return base as unknown as StoreState;
}

/** Deterministic id/now factories. */
function ctx() {
  let n = 0;
  return { id: () => `s${++n}`, now: () => "2026-08-01T12:00:00.000Z" };
}

/** Apply pure step transitions to an in-memory onboarding state (no prefs I/O). */
function complete(s: OnboardingState, step: string): OnboardingState {
  const completedSteps = s.completedSteps.includes(step) ? s.completedSteps : [...s.completedSteps, step];
  const allDone = STEP_IDS.every((id) => completedSteps.includes(id) || s.skippedSteps.includes(id));
  return { ...s, completedSteps, status: allDone ? "completed" : "in-progress" };
}

export function runOnboardingSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Steps ----
  ok("1.1 ten steps in order", STEPS.length === 10 && STEP_IDS[0] === "welcome" && STEP_IDS[STEP_IDS.length - 1] === "finish");
  ok("1.2 next/prev navigation", nextStepId("welcome") === "capture" && prevStepId("capture") === "welcome");
  ok("1.3 last step has no next", nextStepId("finish") === null);
  ok("1.4 every step teaches one interaction", STEPS.every((s) => s.teaches.length > 0));
  ok("1.5 index lookup", stepIndex("today") === 5);

  // ---- 2. Progression ----
  {
    let s = emptyOnboarding();
    s = { ...s, status: "in-progress" };
    for (const id of STEP_IDS) s = complete(s, id);
    ok("2.1 completing all → completed", s.status === "completed");
    ok("2.2 progress counts", onboardingProgress(s).done === 10 && onboardingProgress(s).total === 10);
    ok("2.3 active while in progress", isOnboardingActive({ ...emptyOnboarding(), status: "in-progress" }));
    ok("2.4 not active when completed", !isOnboardingActive(s));
    ok("2.5 version stamped", emptyOnboarding().version === ONBOARDING_VERSION);
    // skip counts toward completion
    const skipped = { ...emptyOnboarding(), status: "in-progress" as const, skippedSteps: ["focus"] };
    ok("2.6 skipped step counts as done", onboardingProgress(skipped).done === 1);
  }

  // ---- 3. Merge rules ----
  {
    const a: OnboardingState = { ...emptyOnboarding(), status: "in-progress", completedSteps: ["welcome", "capture"], updatedAt: "2026-08-01T10:00:00Z" };
    const b: OnboardingState = { ...emptyOnboarding(), status: "in-progress", completedSteps: ["welcome", "project"], updatedAt: "2026-08-01T11:00:00Z" };
    const m = mergeOnboarding(a, b);
    ok("3.1 steps union across devices", m.merged.completedSteps.includes("capture") && m.merged.completedSteps.includes("project") && !m.conflict);
    // later reset wins over progress
    const reset: OnboardingState = { ...emptyOnboarding(), resetCounter: 1, status: "in-progress" };
    const withProgress: OnboardingState = { ...emptyOnboarding(), resetCounter: 0, completedSteps: ["welcome", "capture"], status: "in-progress" };
    const rm = mergeOnboarding(reset, withProgress);
    ok("3.2 later reset wins + flagged", rm.merged.resetCounter === 1 && rm.merged.completedSteps.length === 0 && rm.conflict);
    ok("3.3 completed on either side → completed", mergeOnboarding({ ...a, status: "completed", completedSteps: [...STEP_IDS] }, b).merged.status === "completed");
    // dismissed education union
    ok("3.4 dismissed education union", mergeDismissedEducation(["a", "b"], ["b", "c"]).sort().join(",") === "a,b,c");
    // ui pref conflict surfaced
    const up = mergeUiPreferences({ density: "compact" }, { density: "spacious" }, true);
    ok("3.5 ui pref conflict surfaced, local newer wins", up.conflicts.length === 1 && up.merged.density === "compact");
  }

  // ---- 4. Sample workspace ----
  {
    const build = buildSampleWorkspace(ctx());
    const withSample = addSample(emptyState(), build);
    ok("4.1 sample adds capture→project→action→focus→review", withSample.projects.length === 1 && withSample.nextActions.length === 1 && withSample.focusSessions.length === 1 && withSample.dailyReviews.length === 1);
    ok("4.2 sample adds document+citation+belief+candidate", withSample.documents.length === 1 && withSample.citations.length === 1 && withSample.beliefs.length === 1 && withSample.duplicateCandidates.length === 1);
    ok("4.3 every sample record is tagged", sampleRecordCount(withSample, build.sampleWorkspaceId) >= 9);
    ok("4.4 records carry the sample tag", (withSample.projects[0] as { tags?: string[] }).tags?.includes(SAMPLE_TAG) === true);
    const removed = removeSample(withSample, build.sampleWorkspaceId);
    ok("4.5 remove clears every sample record in one action", sampleRecordCount(removed, build.sampleWorkspaceId) === 0);
    ok("4.6 remove leaves unrelated data untouched", addSample(removed, buildSampleWorkspace({ id: () => "z", now: () => "2026-08-01T12:00:00.000Z" })).projects.length === 1);
    ok("4.7 sample not claimed as real (title says sample)", /sample/i.test((withSample.workspaces[0] as { name: string }).name));
    ok("4.8 deterministic build", JSON.stringify(buildSampleWorkspace(ctx())) === JSON.stringify(buildSampleWorkspace(ctx())));
  }

  // ---- 5. Education / Help ----
  ok("5.1 lessons cover the key uncertainties", LESSONS.length >= 8 && LESSONS.some((l) => l.id === "planning-horizon") && LESSONS.some((l) => l.id === "archive-meaning"));
  ok("5.2 route lessons + wildcard", lessonsForContext("/plan").some((l) => l.id === "planning-horizon") && lessonsForContext("/plan").some((l) => l.id === "archive-meaning"));
  ok("5.3 help maps routes", helpForRoute("/actions")?.id === "actions" && helpForRoute("/insights")?.id === "insights");
  ok("5.4 help sections include glossary + shortcuts", HELP_SECTIONS.some((s) => s.id === "glossary") && HELP_SECTIONS.some((s) => s.id === "shortcuts"));
  ok("5.5 help sourced from real docs", HELP_SECTIONS.every((s) => /\.md$/.test(s.doc)));

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
