/**
 * Highlights (LIFEOS-028, Feature 4).
 *
 * Deterministic highlight helpers — no AI. A highlight is a colored character
 * span over a passage's immutable text plus an optional note and links to any
 * records generated from it. Factory + overlap/merge utilities the store uses.
 */

import type { Highlight, HighlightColor } from "@/types/mvp";

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];
export const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#fde68a", green: "#bbf7d0", blue: "#bfdbfe", pink: "#fbcfe8", orange: "#fed7aa",
};

/** Build a highlight over [start,end) of `passageText`. Clamps to bounds. */
export function makeHighlight(
  passageId: string,
  passageText: string,
  start: number,
  end: number,
  color: HighlightColor,
  ctx: { id: () => string; now: () => string },
  note?: string,
): Highlight | null {
  const a = Math.max(0, Math.min(start, passageText.length));
  const b = Math.max(0, Math.min(end, passageText.length));
  if (b <= a) return null; // empty selection → no highlight
  const at = ctx.now();
  return { id: ctx.id(), passageId, color, text: passageText.slice(a, b), start: a, end: b, note, linked: [], createdAt: at, updatedAt: at };
}

/** Do two spans overlap? (used to prevent exact-duplicate highlights). */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Non-overlapping, sorted highlights for rendering colored spans. */
export function sortHighlights(hs: Highlight[]): Highlight[] {
  return [...hs].sort((x, y) => x.start - y.start || x.end - y.end);
}
