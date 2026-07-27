"use client";

/**
 * Toast host (LIFEOS-032, Feature 4).
 *
 * Renders the shared feedback queue in a bottom-corner stack with a polite ARIA
 * live region so screen readers announce each toast. Auto-dismisses per the
 * toast's duration (errors/offline/syncing are sticky). Each toast can carry one
 * safe action (e.g. Undo/Retry). Respects reduced motion. Mounted once globally.
 */

import { useEffect } from "react";
import { useToasts, dismissToast, type Toast } from "@/lib/ux/feedback";

const KIND_STYLE: Record<Toast["kind"], string> = {
  success: "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40",
  info: "border-black/10 bg-white dark:border-white/12 dark:bg-zinc-900",
  warning: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/40",
  error: "border-rose-500/50 bg-rose-50 dark:bg-rose-950/40",
  offline: "border-zinc-400/40 bg-zinc-50 dark:bg-zinc-900",
  syncing: "border-blue-500/30 bg-blue-50 dark:bg-blue-950/30",
};
const KIND_ICON: Record<Toast["kind"], string> = {
  success: "✓", info: "ℹ", warning: "⚠", error: "✕", offline: "⚡", syncing: "⟳",
};

function ToastRow({ t }: { t: Toast }) {
  useEffect(() => {
    if (t.duration <= 0) return;
    const timer = setTimeout(() => dismissToast(t.id), t.duration);
    return () => clearTimeout(timer);
  }, [t.id, t.duration]);

  return (
    <div className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg ${KIND_STYLE[t.kind]}`}>
      <span aria-hidden className="mt-0.5 text-xs">{KIND_ICON[t.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{t.message}</p>
        {t.detail && <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{t.detail}</p>}
      </div>
      {t.action && (
        <button type="button" onClick={() => { t.action!.run(); dismissToast(t.id); }} className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline">
          {t.action.label}
        </button>
      )}
      <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="shrink-0 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
    </div>
  );
}

export default function ToastProvider() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-w-sm flex-col gap-2 p-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {toasts.map((t) => <ToastRow key={t.id} t={t} />)}
    </div>
  );
}
