/**
 * First-run onboarding steps (LIFEOS-041, Feature 9).
 *
 * A calm, skippable, resumable progression that teaches the system through USE —
 * each step teaches one reusable interaction, no long feature tour, no forced
 * demo data, no fake urgency, no confetti. Progress is descriptive, never
 * gamified. This module declares the ordered steps + the current onboarding
 * version; the flow component drives them.
 */

export const ONBOARDING_VERSION = 1;

export interface OnboardingStep {
  id: string;
  title: string;
  /** One-sentence, calm explanation of what this step teaches. */
  teaches: string;
  /** Whether this step requires the user to actually do something (vs read). */
  interactive: boolean;
  /** Whether the step can be satisfied by an existing record (resumable). */
  skippableIfPresent: boolean;
}

export const STEPS: readonly OnboardingStep[] = [
  { id: "welcome", title: "Welcome", teaches: "What LifeOS is: a quiet place to capture, decide, and do.", interactive: false, skippableIfPresent: false },
  { id: "capture", title: "Capture one thing", teaches: "Saving a thought quickly, without deciding what it is yet.", interactive: true, skippableIfPresent: true },
  { id: "decide", title: "Decide what it is", teaches: "Processing a capture into something you can act on.", interactive: true, skippableIfPresent: true },
  { id: "project", title: "Create or pick a project", teaches: "Grouping related work under an outcome.", interactive: true, skippableIfPresent: true },
  { id: "action", title: "Choose one next action", teaches: "Naming the smallest concrete next step.", interactive: true, skippableIfPresent: true },
  { id: "today", title: "See Today", teaches: "Where your current work and decisions gather.", interactive: false, skippableIfPresent: false },
  { id: "focus", title: "A brief focus session", teaches: "Working quietly on one target, logging interruptions by hand.", interactive: true, skippableIfPresent: true },
  { id: "review", title: "Where review lives", teaches: "The daily review — a short, honest look back.", interactive: false, skippableIfPresent: false },
  { id: "privacy", title: "Your data & privacy", teaches: "Exporting everything and the privacy controls that are always available.", interactive: false, skippableIfPresent: false },
  { id: "finish", title: "You're set up", teaches: "An ordinary, usable workspace — nothing invented for you.", interactive: false, skippableIfPresent: false },
];

export const STEP_IDS = STEPS.map((s) => s.id);

export function stepIndex(id: string): number { return STEP_IDS.indexOf(id); }
export function nextStepId(id: string): string | null {
  const i = stepIndex(id);
  return i >= 0 && i < STEP_IDS.length - 1 ? STEP_IDS[i + 1] : null;
}
export function prevStepId(id: string): string | null {
  const i = stepIndex(id);
  return i > 0 ? STEP_IDS[i - 1] : null;
}
