"use client";
/**
 * Canonical status notice (LIFEOS-041, Features 22/25/29). A calm inline banner
 * with a REQUIRED text label paired to any status color (never color-only), a
 * role of status/alert for screen readers, and an optional action.
 */
import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "danger" | "neutral";
const TONE: Record<Tone, { cls: string; icon: string; word: string }> = {
  info: { cls: "border-blue-500/30 bg-blue-500/[.05] text-blue-800 dark:text-blue-200", icon: "ℹ", word: "Info" },
  success: { cls: "border-emerald-500/30 bg-emerald-500/[.05] text-emerald-800 dark:text-emerald-200", icon: "✓", word: "Done" },
  warning: { cls: "border-amber-500/30 bg-amber-500/[.05] text-amber-800 dark:text-amber-200", icon: "△", word: "Heads up" },
  danger: { cls: "border-rose-500/30 bg-rose-500/[.05] text-rose-800 dark:text-rose-200", icon: "!", word: "Attention" },
  neutral: { cls: "border-black/[.08] bg-black/[.02] text-zinc-700 dark:border-white/[.1] dark:bg-white/[.03] dark:text-zinc-200", icon: "•", word: "Note" },
};

export default function StatusNotice({ tone = "neutral", title, children, action, assertive }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode; assertive?: boolean }) {
  const t = TONE[tone];
  return (
    <div role={assertive ? "alert" : "status"} data-status-notice={tone} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] ${t.cls}`}>
      <span aria-hidden className="mt-0.5 select-none font-semibold">{t.icon}</span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{t.word}: </span>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-[13px] opacity-90">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
