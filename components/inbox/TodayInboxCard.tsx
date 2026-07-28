"use client";

/**
 * Today inbox card (LIFEOS-035, Feature 13).
 *
 * A compact, non-judgmental entry point: inbox count, oldest capture age,
 * deferred items returning today, and the two primary actions. No streaks, no
 * scores, no guilt copy.
 */

import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { queueCounts, capturesForView, nextToProcess } from "@/lib/inbox/queue";
import { captureAgeDays } from "@/lib/inbox/capture-status";
import { returningToday } from "@/lib/inbox/defer";

export default function TodayInboxCard() {
  const state = useStore();
  const counts = queueCounts(state.captures ?? []);
  if (counts.inbox === 0 && counts.deferred === 0) return null;

  const inbox = capturesForView(state.captures ?? [], "inbox");
  const oldest = inbox.reduce((m, c) => Math.max(m, captureAgeDays(c)), 0);
  const returning = returningToday(state.captures ?? []).length;
  const next = nextToProcess(state, "oldest");

  return (
    <section aria-label="Capture inbox" className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Capture inbox</h2>
        <Link href="/process" className="text-[11px] text-zinc-400 underline-offset-4 hover:underline">Open inbox →</Link>
      </div>
      <p className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-100">
        {counts.inbox} capture{counts.inbox === 1 ? "" : "s"} to process
        {oldest > 0 && <span className="text-zinc-400"> · oldest {oldest}d</span>}
      </p>
      {returning > 0 && <p className="mt-0.5 text-[11px] text-zinc-500">{returning} deferred item{returning === 1 ? "" : "s"} returned today.</p>}
      {next && (
        <Link href={`/process/${next.id}`} className="mt-2 inline-block rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">Process next →</Link>
      )}
    </section>
  );
}
