/**
 * Keyboard system (LIFEOS-041, Feature 30).
 *
 * A single documented shortcut model: what each shortcut does, whether it is
 * global, and whether it is suppressed while typing. Includes a CONFLICT
 * detector (no two global shortcuts share a chord; nothing collides with common
 * browser/AT shortcuts) and a text-entry suppression check. Every shortcut-only
 * action is also available visibly (recorded here + enforced by review).
 */

export interface Shortcut {
  id: string;
  keys: string;        // canonical chord, e.g. "mod+k", "g t", "?"
  description: string;
  global: boolean;     // fires anywhere vs only within a surface
  suppressInInput: boolean; // ignored while typing in a field
  visibleAffordance: string; // where the same action is reachable by pointer
}

/** Chords reserved by browsers / assistive tech we must never override. */
export const RESERVED_CHORDS = [
  "mod+t", "mod+w", "mod+n", "mod+q", "mod+r", "mod+l", "mod+d", "mod+p", "mod+s",
  "mod+f", "mod+g", "mod+shift+t", "mod+plus", "mod+minus", "mod+0", "f5", "f6",
  "tab", "shift+tab", "alt+tab",
];

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "capture", keys: "mod+shift+k", description: "Quick capture", global: true, suppressInInput: false, visibleAffordance: "Capture button (nav + mobile bar)" },
  { id: "search", keys: "/", description: "Focus global search", global: true, suppressInInput: true, visibleAffordance: "Search field in the shell" },
  { id: "command", keys: "mod+k", description: "Open command center", global: true, suppressInInput: false, visibleAffordance: "Search/⌘K button in the shell" },
  { id: "today", keys: "g t", description: "Go to Today", global: true, suppressInInput: true, visibleAffordance: "Today in navigation" },
  { id: "process-next", keys: "e", description: "Process next capture", global: false, suppressInInput: true, visibleAffordance: "Process button in the inbox" },
  { id: "new-action", keys: "c", description: "Create next action", global: false, suppressInInput: true, visibleAffordance: "New action button on Actions" },
  { id: "start-focus", keys: "f", description: "Start focus", global: false, suppressInInput: true, visibleAffordance: "Focus button on a target" },
  { id: "end-focus", keys: "escape", description: "End focus / close overlay", global: false, suppressInInput: false, visibleAffordance: "End/close button" },
  { id: "inspector", keys: "i", description: "Open inspector", global: false, suppressInInput: true, visibleAffordance: "Inspect button on a record" },
  { id: "close", keys: "escape", description: "Close modal or drawer", global: false, suppressInInput: false, visibleAffordance: "Close button (×)" },
  { id: "move-horizon", keys: "1 2 3 4 5", description: "Move planning item to a horizon", global: false, suppressInInput: true, visibleAffordance: "Move buttons on the card" },
  { id: "save", keys: "mod+enter", description: "Save / submit", global: false, suppressInInput: false, visibleAffordance: "Save button" },
  { id: "cancel", keys: "escape", description: "Cancel edit", global: false, suppressInInput: false, visibleAffordance: "Cancel button" },
  { id: "help", keys: "?", description: "Keyboard shortcuts & help", global: true, suppressInInput: true, visibleAffordance: "Help in navigation" },
];

function normalize(keys: string): string { return keys.toLowerCase().trim(); }

/** Detect conflicts: duplicate GLOBAL chords, or any GLOBAL chord that is reserved. */
export function detectConflicts(shortcuts: readonly Shortcut[] = SHORTCUTS): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const reserved = new Set(RESERVED_CHORDS.map(normalize));
  for (const s of shortcuts) {
    // `escape` is intentionally shared by close/cancel/end within different
    // surfaces (never two GLOBAL handlers), and single-key chords are surface-
    // scoped. Only global chords must be unique + non-reserved.
    if (!s.global) continue;
    const k = normalize(s.keys);
    if (reserved.has(k)) problems.push(`${s.id} uses reserved chord "${s.keys}"`);
    if (seen.has(k)) problems.push(`global chord "${s.keys}" used by both ${seen.get(k)} and ${s.id}`);
    seen.set(k, s.id);
  }
  return problems;
}

/** Whether an event target is a text-entry context (so global shortcuts suppress). */
export function isTextEntry(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el.getAttribute?.("type") ?? "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "range", "color"].includes(type);
  }
  return false;
}

/** Decide whether a shortcut should fire given the current focus context. */
export function shouldFire(s: Shortcut, inTextEntry: boolean): boolean {
  if (inTextEntry && s.suppressInInput) return false;
  return true;
}

export function validateKeyboard(): { ok: boolean; problems: string[] } {
  const problems = detectConflicts();
  for (const s of SHORTCUTS) if (!s.visibleAffordance) problems.push(`${s.id} has no visible affordance (shortcut-only)`);
  return { ok: problems.length === 0, problems };
}
