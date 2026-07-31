/**
 * Motion system (LIFEOS-041, Feature 31).
 *
 * Motion is sparse and calm: short panel/modal/inspector/row transitions, no
 * bounce, no celebratory animation, no motion for ordinary metric changes.
 * Reduced-motion (OS setting or prefs.ui.reducedMotion) removes all nonessential
 * transitions. Animation never delays interaction.
 */
import { DURATION, EASING } from "@/lib/design/tokens";

export type MotionKind = "panel" | "modal" | "inspector" | "row" | "route" | "focus-mode";

/** Whether motion should be suppressed (OS reduced-motion OR user preference). */
export function prefersReducedMotion(userPref?: boolean): boolean {
  if (userPref) return true;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* ignore */ }
  }
  return false;
}

/** Duration (ms) for a motion kind, or 0 when reduced motion is active. */
export function durationFor(kind: MotionKind, reduced: boolean): number {
  if (reduced) return 0;
  switch (kind) {
    case "modal": case "inspector": return DURATION.base;
    case "route": case "focus-mode": return DURATION.slow;
    default: return DURATION.fast;
  }
}

/** A ready-to-use CSS transition string, empty when reduced. */
export function transitionFor(kind: MotionKind, reduced: boolean, props = "opacity, transform"): string {
  const ms = durationFor(kind, reduced);
  return ms === 0 ? "none" : `${props} ${ms}ms ${EASING.standard}`;
}
