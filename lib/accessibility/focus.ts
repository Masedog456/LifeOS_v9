/**
 * Focus management (LIFEOS-041, Feature 29).
 *
 * Pure helpers for focus ORDER and TRAPPING used by dialogs/drawers, plus the
 * rule that destructive primary actions are never pre-focused (Feature 26).
 * DOM-agnostic: operate on ordered lists of focusable descriptors so they are
 * unit-testable.
 */

export interface Focusable { id: string; tabindex?: number; disabled?: boolean; destructive?: boolean }

/** The effective tab order: positive tabindex first (ascending), then DOM order. */
export function focusOrder(items: Focusable[]): string[] {
  const enabled = items.filter((i) => !i.disabled);
  const positive = enabled.filter((i) => (i.tabindex ?? 0) > 0).sort((a, b) => (a.tabindex! - b.tabindex!));
  const natural = enabled.filter((i) => (i.tabindex ?? 0) <= 0);
  return [...positive, ...natural].map((i) => i.id);
}

/** Next focus id when Tab (or Shift+Tab) cycles within a trapped container. */
export function nextTrapped(order: string[], currentId: string | null, backward = false): string | null {
  if (!order.length) return null;
  const i = currentId ? order.indexOf(currentId) : -1;
  if (backward) return order[(i <= 0 ? order.length : i) - 1];
  return order[(i + 1) % order.length];
}

/** The element a dialog should focus initially — never a destructive primary. */
export function initialFocus(items: Focusable[]): string | null {
  const order = focusOrder(items);
  for (const id of order) {
    const it = items.find((x) => x.id === id);
    if (it && !it.destructive) return id;
  }
  return order[0] ?? null; // if EVERYTHING is destructive, fall back (shouldn't happen)
}

/** Whether initial focus is safe (not on a destructive control). */
export function initialFocusIsSafe(items: Focusable[]): boolean {
  const id = initialFocus(items);
  const it = items.find((x) => x.id === id);
  return !it?.destructive;
}
