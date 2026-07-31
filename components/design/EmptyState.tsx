"use client";
/**
 * Canonical empty state (LIFEOS-041, Feature 24). Built from the microcopy
 * model so every empty reads the same: what's absent, why, and one next action.
 * No jokes, no shame, no sales pitch.
 */
import type { ReactNode } from "react";
import { emptyState, type EmptyKind } from "@/lib/design/microcopy";

export default function EmptyState({ kind, subject, action, icon }: { kind: EmptyKind; subject: string; action?: ReactNode; icon?: ReactNode }) {
  const copy = emptyState(kind, subject);
  return (
    <div data-empty-state={kind} className="mx-auto flex max-w-sm flex-col items-center gap-2 rounded-2xl border border-black/[.06] px-6 py-10 text-center dark:border-white/[.08]">
      {icon && <div aria-hidden className="mb-1 text-2xl text-zinc-300 dark:text-zinc-600">{icon}</div>}
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{copy.title}</p>
      <p className="text-[13px] text-zinc-500">{copy.body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
