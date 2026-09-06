"use client";

/**
 * Quick capture — the global doorway into the ONE capture system (LIFEOS-100).
 *
 * ## What this was, and what the audit found
 *
 * LIFEOS-027 built this overlay before the Capture stack existed, and it stayed
 * as it was written: a textarea, a Title field, comma-separated Tags folded into
 * the text as `#tags`, a reading-Source dropdown, and `addCapture(text)`.
 *
 * That is a SECOND capture implementation. It never called `interpret`, never
 * called `authorityFor`, never called `suggestContext`, never called
 * `commitCapture`. Measured with one sentence through both doorways against the
 * same store — "Email Marcus about the lease tomorrow":
 *
 *   Home     captures 1→2   actions 5→6   unprocessed 0→0
 *            "SAVED AS ACTION · Email Marcus about the lease"
 *   here     captures 1→2   actions 5→5   unprocessed 0→1
 *            "Captured. It can become a belief in the Inbox."
 *
 * One keystroke apart: Home created the commitment and named it back, this
 * dropped a raw row into an inbox and told the person to process it later. The
 * sprint's job was never reachability — ⇧⌘K already worked from every surface —
 * it was that the doorway led somewhere else.
 *
 * ## So this is a frame, not a form
 *
 * Everything below the header is `CaptureComposer`, unchanged and unwrapped: the
 * same interpreter, the same authority boundary, the same 089 context
 * suggestions, the same 095 auto-finish, the same 096 outcome wording, the same
 * 097 correction sheet, the same commit path. There is no second interpreter and
 * no second write path, because there is no second anything — this file now
 * contains no capture logic at all.
 *
 * ## What it deliberately does NOT do
 *
 *   no context inference   §12-§17, §42. Opening this from a Project does not
 *                          make the capture belong to that Project. The route is
 *                          not passed in, and there is nowhere for it to enter:
 *                          the composer derives context from the capture's own
 *                          words through `suggestContext`, exactly as on Home.
 *   no recent list         §25. Home keeps that. A doorway shows the thing that
 *                          just happened and nothing else.
 *   no route change        §34. Opening and closing changes no URL.
 *   no persistence         §26. `CommandCenter` owns the open/closed state as
 *                          ordinary React state and it dies with the overlay.
 *
 * ## Dialog, and correctly so (§33)
 *
 * This has a backdrop, blocks the page beneath it, and closes on click-out — so
 * `role="dialog"` and `aria-modal` are the honest description. That is the
 * opposite of LIFEOS-099's finding about the correction sheet, which only looked
 * modal and was given disclosure semantics instead. §33 asks for the choice to
 * follow behaviour; the behaviour here says dialog.
 */

import { useEffect, useRef } from "react";
import CaptureComposer from "@/components/capture/CaptureComposer";

/**
 * The old overlay's draft key, cleared once on mount.
 *
 * LIFEOS-027 preserved unsaved text here across accidental closes.
 * `CaptureComposer` has no draft mechanism, and §27 says to reuse preservation
 * only where the composer already supports it and to build none from scratch —
 * so the behaviour goes, and this removes the orphan rather than leaving a key
 * in every existing user's storage that nothing will ever read again.
 */
const LEGACY_DRAFT_KEY = "lifeos.quickcapture.draft.v1";

export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.removeItem(LEGACY_DRAFT_KEY); } catch { /* private mode */ }
  }, []);

  /**
   * §29, §30. Focus the capture input on open.
   *
   * `CommandCenter` already restores focus to the opener on close — it captures
   * `document.activeElement` before opening any overlay — so only the entry half
   * belongs here. The composer's own textarea carries `id="capture"`, which is
   * the same input Home focuses, so this cannot drift from it.
   */
  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLElement>("#capture");
    el?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-capture-heading"
        ref={panelRef}
        onKeyDown={(e) => {
          // §28. Escape closes. Stopped here so it does not also reach a control
          // inside the composer that treats Escape as its own cancel.
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-black/[.08] bg-white shadow-2xl dark:border-white/[.12] dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
          <h2 id="quick-capture-heading" className="text-sm font-semibold">Quick capture</h2>
          {/*
            §32, §56. 44px on a phone and released above it, the same rule
            LIFEOS-099 applied to every other control rather than a new one.
          */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick capture"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-zinc-500 hover:text-zinc-700 sm:min-h-0 sm:min-w-0 sm:px-1 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <div className="px-4 pb-4">
          {/*
            §10. The same component Home renders. `onFinished` is Home's own
            coordination with its recent-captures list (095 §18) and there is no
            list here, so it is deliberately not passed.
          */}
          <CaptureComposer />
        </div>
      </div>
    </div>
  );
}
