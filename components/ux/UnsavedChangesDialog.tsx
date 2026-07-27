"use client";

/**
 * Unsaved-changes dialog (LIFEOS-032, Feature 2).
 *
 * A focus-trapped in-app dialog offering Save / Discard / Continue editing when
 * the user tries to leave a dirty form. Used by flows that navigate or close a
 * modal; the `beforeunload` guard (in `lib/ux/dirty-state`) covers full reloads.
 * Focus lands on the safest action (Continue editing).
 */

import { useEffect, useRef } from "react";

export default function UnsavedChangesDialog({
  open, onSave, onDiscard, onCancel, canSave = true,
}: {
  open: boolean;
  onSave?: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  canSave?: boolean;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) requestAnimationFrame(() => continueRef.current?.focus()); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
        className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 shadow-xl dark:border-white/12 dark:bg-zinc-900">
        <h2 id="unsaved-title" className="text-lg font-semibold tracking-tight">Unsaved changes</h2>
        <p className="mt-1 text-sm text-zinc-500">You have unsaved changes. Save them, discard them, or keep editing?</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={continueRef} type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]">Continue editing</button>
          <button type="button" onClick={onDiscard} className="rounded-full border border-black/10 px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Discard</button>
          {onSave && <button type="button" disabled={!canSave} onClick={onSave} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save</button>}
        </div>
      </div>
    </div>
  );
}
