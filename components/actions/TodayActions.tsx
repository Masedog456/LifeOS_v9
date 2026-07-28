"use client";

/**
 * Today actions card (LIFEOS-036, Feature 16). Compact and calm: pinned + in
 * progress, due waiting follow-ups, deferred returning today, and the single
 * most-recent incomplete action, with Start-next and Open-queue affordances. No
 * overdue-guilt language, no productivity scores. Hides itself when empty.
 */

import Link from "next/link";
import { useStore, returnDueActionsNow } from "@/lib/mvpStore";
import { useEffect } from "react";
import { todayActions } from "@/lib/actions/relationships";
import type { NextAction } from "@/types/mvp";

function Row({ label, items }: { label: string; items: NextAction[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      {items.slice(0, 4).map((a) => <Link key={a.id} href={`/actions/${a.id}`} className="truncate text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">{a.title || "(untitled action)"}</Link>)}
    </div>
  );
}

export default function TodayActions() {
  const state = useStore();
  useEffect(() => { returnDueActionsNow(); }, []);
  const view = todayActions(state);

  const nothing = view.pinned.length === 0 && view.inProgress.length === 0 && view.waitingDue.length === 0 && view.returningToday.length === 0 && !view.mostRecentIncomplete;
  if (nothing) return null;

  return (
    <section aria-label="Next actions" className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Next actions</h2>
        <span className="text-[11px] text-zinc-400">{view.totalOpen} open</span>
      </header>
      <div className="flex flex-col gap-3">
        <Row label="Pinned" items={view.pinned} />
        <Row label="In progress" items={view.inProgress} />
        <Row label="Follow-ups due" items={view.waitingDue} />
        <Row label="Returning today" items={view.returningToday} />
        {view.pinned.length === 0 && view.inProgress.length === 0 && view.mostRecentIncomplete && (
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Most recent</p>
            <Link href={`/actions/${view.mostRecentIncomplete.id}`} className="truncate text-sm text-zinc-700 underline-offset-4 hover:underline dark:text-zinc-200">{view.mostRecentIncomplete.title || "(untitled action)"}</Link>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {view.next && <Link href={`/actions/${view.next.id}`} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Start next action</Link>}
        <Link href="/actions" className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Open action queue</Link>
      </div>
    </section>
  );
}
