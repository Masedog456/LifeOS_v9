/**
 * Split a capture (LIFEOS-035, Feature 6).
 *
 * The user defines segment boundaries MANUALLY — there is no semantic or
 * sentence-based automatic splitting. A pure planner validates and previews the
 * resulting captures (no empty segments, deterministic order, source lineage).
 * The original is preserved unless the user explicitly archives it; the store
 * performs the actual creation.
 */

import type { Capture } from "@/types/mvp";
import { effectiveText } from "@/lib/inbox/capture-status";

export interface SplitSegment { index: number; text: string }
export interface SplitPlan {
  valid: boolean;
  segments: SplitSegment[];
  errors: string[];
  sourceId: string;
}

/**
 * A deterministic STARTING suggestion for boundaries: split on blank lines (or
 * single newlines if there are no blank lines). This is a mechanical convenience
 * the user then edits — never a semantic split.
 */
export function suggestSegments(capture: Capture): string[] {
  const text = effectiveText(capture);
  const byBlank = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const byLine = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return byLine.length > 1 ? byLine : [text.trim()];
}

/** Validate + order the user's chosen segments into a plan. */
export function planSplit(capture: Capture, rawSegments: string[]): SplitPlan {
  const errors: string[] = [];
  const cleaned = rawSegments.map((s) => (s ?? "").trim());
  if (cleaned.length < 2) errors.push("A split needs at least two segments.");
  if (cleaned.some((s) => s.length === 0)) errors.push("Segments cannot be empty.");
  const segments: SplitSegment[] = cleaned
    .filter((s) => s.length > 0)
    .map((text, index) => ({ index, text }));
  return { valid: errors.length === 0 && segments.length >= 2, segments, errors, sourceId: capture.id };
}
