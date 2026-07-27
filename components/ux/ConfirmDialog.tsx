"use client";

/**
 * Shared destructive-action confirmation (LIFEOS-032, Feature 3).
 *
 * ONE confirmation pattern for the whole app — never a browser `confirm()`. Any
 * component calls `requestConfirm({ impact, onConfirm })`; a single `<ConfirmHost/>`
 * (mounted in the layout) renders a focus-trapped dialog showing the record name,
 * type, affected children, whether linked external records survive, and whether
 * the action is undoable. High-severity actions require an explicit "I understand"
 * checkbox before the destructive button enables. Focus lands on the SAFEST action
 * (Cancel); Escape cancels; focus is restored on close.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfirmImpact } from "@/lib/ux/confirmations";

export interface ConfirmRequest {
  impact: ConfirmImpact;
  confirmLabel?: string;
  onConfirm: () => void;
}

let current: (ConfirmRequest & { _key: number }) | null = null;
let keySeq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function requestConfirm(req: ConfirmRequest): void { keySeq += 1; current = { ...req, _key: keySeq }; emit(); }
function close(): void { current = null; emit(); }

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function snapshot(): (ConfirmRequest & { _key: number }) | null { return current; }
function useConfirmRequest(): (ConfirmRequest & { _key: number }) | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

export default function ConfirmHost() {
  const req = useConfirmRequest();
  if (!req) return null;
  // Key the dialog to each request so per-request state (acknowledged) resets
  // without a setState-in-effect.
  return <ConfirmDialogInner key={req._key} req={req} />;
}

function ConfirmDialogInner({ req }: { req: ConfirmRequest }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => { restoreRef.current?.focus?.(); };
  }, []);

  const { impact } = req;
  const high = impact.severity === "high";
  const canConfirm = !high || acknowledged;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") {
      // Simple focus trap within the dialog.
      const dialog = e.currentTarget as HTMLElement;
      const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={close}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        className="w-full max-w-md rounded-t-2xl border border-black/10 bg-white p-5 shadow-xl sm:rounded-2xl dark:border-white/12 dark:bg-zinc-900"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <h2 id="confirm-title" className="text-lg font-semibold tracking-tight">
          {impact.verb} {impact.typeLabel.toLowerCase()}?
        </h2>
        <div id="confirm-body" className="mt-2 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
          <p><span className="font-medium text-zinc-900 dark:text-zinc-100">“{impact.name}”</span> ({impact.typeLabel})</p>
          {impact.children.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">This also affects</p>
              <ul className="mt-1 list-inside list-disc">
                {impact.children.map((c) => <li key={c.label}>{c.count} {c.label}{c.count === 1 ? "" : "s"}</li>)}
              </ul>
            </div>
          )}
          {impact.linkedNote && <p className="rounded-lg bg-black/[.04] px-3 py-2 text-[13px] dark:bg-white/[.06]">{impact.linkedNote}</p>}
          <p className="text-[13px] text-zinc-500">{impact.undoable ? "This can be undone." : "This cannot be undone."}</p>
          {high && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} aria-label="I understand this cannot be undone" />
              I understand this {impact.undoable ? "" : "permanently "}affects the records above.
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={close} className="rounded-full px-4 py-2 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]">Cancel</button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => { const fn = req.onConfirm; close(); fn(); }}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {req.confirmLabel ?? impact.verb}
          </button>
        </div>
      </div>
    </div>
  );
}
