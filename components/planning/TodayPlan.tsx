"use client";

/**
 * Today Plan (LIFEOS-037, Feature 3). A deterministic list assembled from the
 * user's explicit selections + existing signals. The user may reorder (via the
 * board) and remove items; empty plans are never auto-filled.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, removeFromPlanning } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { todayPlan } from "@/lib/planning/today-plan";
import { toast } from "@/lib/ux/feedback";

const SOURCE_LABEL: Record<string, string> = {
  planned: "planned", pinned: "pinned", in_progress: "in progress", waiting_due: "follow-up due", returning_today: "returning", tomorrow_focus: "tomorrow focus",
};

export default function TodayPlan() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const plan = useMemo(() => todayPlan(state), [state]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today Plan</h1>
          <p className="mt-0.5 text-sm text-zinc-500">What you have deliberately chosen for today. Nothing here is inferred or auto-filled.</p>
        </div>
        <Link href="/plan" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Board →</Link>
      </header>

      {plan.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">Nothing planned for today yet. Add items from the board, an action, or the inspector — the plan stays empty until you choose.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Today plan">
          {plan.items.map((item) => {
            const ref = entityRef(ctx, item.ref.kind, item.ref.id);
            const key = `${item.ref.kind}:${item.ref.id}`;
            return (
              <li key={key} data-plan-item={key} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.06] p-3 text-sm dark:border-white/[.08]">
                <div className="min-w-0">
                  {ref.exists ? <Link href={ref.href} className="truncate font-medium hover:underline">{ref.title}</Link> : <span className="truncate text-zinc-500">{ref.title} (missing)</span>}
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-zinc-400">
                    <span className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{entityKindLabel(item.ref.kind)}</span>
                    {item.sources.map((s) => <span key={s}>· {SOURCE_LABEL[s] ?? s}</span>)}
                  </div>
                </div>
                {item.sources.includes("planned") && <button type="button" onClick={() => { removeFromPlanning(item.ref); toast({ kind: "info", message: "Removed from Today" }); }} aria-label="Remove from Today" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
