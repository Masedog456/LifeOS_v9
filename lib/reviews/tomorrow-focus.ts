/**
 * Tomorrow-focus helpers (LIFEOS-034, Feature 8).
 *
 * A small, user-ordered set of next-focus intentions. LifeOS never assigns
 * priority automatically and never creates deadlines — order is purely the
 * user's manual arrangement. Suggestions are deterministic and optional; the
 * user always chooses.
 */

import type { RecordRefLite, ReviewFocusItem, StoreState } from "@/types/mvp";

/** Re-number a focus list to a clean 0..n-1 order following array position. */
export function normalizeFocusOrder(items: ReviewFocusItem[]): ReviewFocusItem[] {
  return items.map((it, i) => (it.order === i ? it : { ...it, order: i }));
}

/** Items sorted by their manual order (stable). */
export function orderedFocus(items: ReviewFocusItem[]): ReviewFocusItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

/** Move a focus item up/down by one, returning a re-normalized list. */
export function moveFocus(items: ReviewFocusItem[], id: string, dir: -1 | 1): ReviewFocusItem[] {
  const ordered = orderedFocus(items);
  const idx = ordered.findIndex((x) => x.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= ordered.length) return items;
  const next = [...ordered];
  [next[idx], next[to]] = [next[to], next[idx]];
  return normalizeFocusOrder(next);
}

export interface FocusSuggestion { text: string; ref?: RecordRefLite }

/**
 * Deterministic focus suggestions from live work: active projects (most recent),
 * active goals, and in-progress reading. Bounded and de-duplicated by ref.
 */
export function focusSuggestions(state: StoreState, limit = 6): FocusSuggestion[] {
  const out: FocusSuggestion[] = [];
  const seen = new Set<string>();
  const add = (text: string, ref?: RecordRefLite) => {
    const key = ref ? `${ref.kind}:${ref.id}` : text;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text, ref });
  };

  const projects = [...(state.projects ?? [])]
    .filter((p) => p.status === "active")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  for (const p of projects.slice(0, limit)) add(p.title, { kind: "project", id: p.id });

  const goals = [...(state.goals ?? [])]
    .filter((g) => g.status === "active")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  for (const g of goals.slice(0, limit)) add(g.title, { kind: "goal", id: g.id });

  const reading = [...(state.documents ?? [])]
    .filter((d) => d.status === "reading")
    .sort((a, b) => (b.progress?.lastOpenedAt || b.updatedAt || "").localeCompare(a.progress?.lastOpenedAt || a.updatedAt || ""));
  for (const d of reading.slice(0, limit)) add(`Continue reading: ${d.title}`, { kind: "document", id: d.id });

  return out.slice(0, limit);
}
