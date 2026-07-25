"use client";

/**
 * MobileCommandTrigger (LIFEOS-027, Feature 9).
 *
 * A visible, thumb-reachable entry point to the command center on small
 * screens: a large search button plus a quick-capture button, fixed to the
 * bottom of the viewport with safe-area padding and big tap targets. Hidden on
 * ≥sm where the nav search button and ⌘K serve the same role. Never the only
 * way in — desktop keeps the keyboard + nav affordances.
 */

export default function MobileCommandTrigger({ onOpenPalette, onOpenCapture }: { onOpenPalette: () => void; onOpenCapture: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-black/[.06] bg-white/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden dark:border-white/[.10] dark:bg-zinc-900/95">
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Open command palette and search"
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-11 flex-1 items-center gap-2 rounded-full border border-black/[.12] px-4 text-sm text-zinc-500 dark:border-white/[.15]"
      >
        <span aria-hidden>⌕</span> Search or run a command…
      </button>
      <button
        type="button"
        onClick={onOpenCapture}
        aria-label="Quick capture"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-lg text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        ＋
      </button>
    </div>
  );
}
