/**
 * Keyboard shortcuts (LIFEOS-027).
 *
 * A small, coherent, discoverable shortcut system. The DECISION logic here is
 * pure and testable — `resolveKey` turns a keyboard event + context (are we
 * typing? is a chord pending? mac or not?) into an outcome — while the React
 * layer only wires listeners and executes outcomes. Shortcuts NEVER fire while
 * the user is typing in an input/textarea/select/contenteditable (except the
 * modifier-based palette/quick-capture combos, which don't interfere with
 * typing, and Escape). Platform labels are rendered correctly for macOS vs
 * Windows/Linux. Everything is also reachable without shortcuts.
 */

export interface KeyEventInfo {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export type ShortcutOutcome =
  | { type: "palette" }
  | { type: "quick-capture" }
  | { type: "focus-search" }
  | { type: "shortcut-help" }
  | { type: "start-chord" }
  | { type: "goto"; href: string }
  | { type: "none" };

/** "G then X" navigation chords: the second key → route. Discoverable in help. */
export const CHORDS: Record<string, { href: string; label: string }> = {
  t: { href: "/today", label: "Today" },
  m: { href: "/memory", label: "Living Memory" },
  h: { href: "/health", label: "System Health" },
  r: { href: "/research", label: "Research" },
  d: { href: "/dialogue", label: "Dialogue" },
  w: { href: "/world", label: "World Model" },
  c: { href: "/", label: "Capture" },
};

/** True when focus is in a text-entry context where typing must win. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable) return true;
  // Common rich-editor roles.
  const role = node.getAttribute?.("role");
  if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
  return false;
}

/** Detect macOS for correct modifier labeling. Safe on the server (returns false). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator.platform || "") + " " + (navigator.userAgent || "");
  return /Mac|iPhone|iPad|iPod/i.test(p);
}

/** Pick the correct label for the current platform. */
export function platformLabel(mac: string, other: string, isMac: boolean): string {
  return isMac ? mac : other;
}

/**
 * Resolve a keydown into an outcome. Modifier combos (palette, quick capture)
 * are allowed even while typing; single-key shortcuts and chords are suppressed
 * while typing. Chord completion is handled when `chordPending` is set.
 */
export function resolveKey(e: KeyEventInfo, opts: { typing: boolean; chordPending: boolean }): ShortcutOutcome {
  const mod = e.meta || e.ctrl; // Cmd on mac, Ctrl elsewhere
  const k = e.key.toLowerCase();

  // Modifier combos — safe to fire anywhere (do not interfere with typing).
  if (mod && k === "k" && e.shift) return { type: "quick-capture" };
  if (mod && k === "k") return { type: "palette" };

  // A pending chord ("g" was just pressed) completes on the next key — but only
  // when not typing, and only for plain keys (no modifiers).
  if (opts.chordPending && !opts.typing && !mod && !e.alt) {
    const chord = CHORDS[k];
    if (chord) return { type: "goto", href: chord.href };
    return { type: "none" };
  }

  // Remaining single-key shortcuts must never fire while typing.
  if (opts.typing || mod || e.alt) return { type: "none" };

  if (e.key === "/") return { type: "focus-search" };
  if (e.key === "?") return { type: "shortcut-help" };
  if (k === "g") return { type: "start-chord" };
  return { type: "none" };
}

/** The shortcut map, for the help dialog and inline hints. */
export interface ShortcutHint { mac: string; other: string; label: string }
export const SHORTCUTS: ShortcutHint[] = [
  { mac: "⌘K", other: "Ctrl K", label: "Open command palette" },
  { mac: "⇧⌘K", other: "Ctrl ⇧ K", label: "Quick capture" },
  { mac: "/", other: "/", label: "Focus global search" },
  { mac: "?", other: "?", label: "Keyboard shortcuts" },
  { mac: "Esc", other: "Esc", label: "Close palette or modal" },
  { mac: "G then T", other: "G then T", label: "Go to Today" },
  { mac: "G then M", other: "G then M", label: "Go to Living Memory" },
  { mac: "G then R", other: "G then R", label: "Go to Research" },
  { mac: "G then D", other: "G then D", label: "Go to Dialogue" },
  { mac: "G then W", other: "G then W", label: "Go to World Model" },
  { mac: "G then H", other: "G then H", label: "Go to System Health" },
  { mac: "G then C", other: "G then C", label: "Go to Capture" },
];
