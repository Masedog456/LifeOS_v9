"use client";

/**
 * ShortcutHelp (LIFEOS-027, Feature 8).
 *
 * A keyboard-shortcuts reference dialog. Labels are rendered for the current
 * platform (⌘ on macOS, Ctrl elsewhere). Everything it lists is also reachable
 * without the keyboard, so this is an accelerator, not a requirement.
 */

import { SHORTCUTS } from "@/lib/command/shortcuts";

// Mounted only while open (see CommandCenter).
export default function ShortcutHelp({ onClose, isMac }: { onClose: () => void; isMac: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} className="w-full max-w-sm overflow-hidden rounded-2xl border border-black/[.08] bg-white shadow-2xl dark:border-white/[.12] dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close" className="rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 px-2 py-1.5 text-sm">
              <span className="text-zinc-700 dark:text-zinc-200">{s.label}</span>
              <kbd className="shrink-0 rounded border border-black/[.12] px-2 py-0.5 text-[11px] text-zinc-500 dark:border-white/[.15] dark:text-zinc-400">{isMac ? s.mac : s.other}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
