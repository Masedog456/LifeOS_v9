"use client";

/**
 * Day summary panel (LIFEOS-034, Feature 2).
 *
 * Renders the deterministic day projection: counts plus the underlying source
 * records, each linking back to its own page. It infers no meaning. Live sync
 * signals (unresolved conflicts / unsynced changes) come from the runtime.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildDaySummary, formatDuration, daySummaryTotal } from "@/lib/reviews/day-summary";
import { unresolvedCount } from "@/lib/sync/status-store";
import { getSyncDiagnostics } from "@/lib/persistence";
import type { DayKey } from "@/lib/reviews/dates";

export default function DaySummary({ date }: { date: DayKey }) {
  const state = useStore();
  const conflicts = typeof window !== "undefined" ? unresolvedCount() : 0;
  const diag = typeof window !== "undefined" ? getSyncDiagnostics() : { dirtyDomains: [] as string[], queued: false };
  const live = { unresolvedConflicts: conflicts, unsyncedPending: diag.queued || diag.dirtyDomains.length > 0 };
  const summary = buildDaySummary(state, date, { live });
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const total = daySummaryTotal(summary);

  return (
    <section aria-label="Day summary" className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Today at a glance</h2>
        <span className="text-[11px] text-zinc-400">{summary.sessionCount} session{summary.sessionCount === 1 ? "" : "s"} · {formatDuration(summary.totalSessionMs)} · {total} item{total === 1 ? "" : "s"}</span>
      </div>

      {(summary.live.unresolvedConflicts > 0 || summary.live.unsyncedPending) && (
        <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-50/60 px-3 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/25 dark:text-amber-300">
          {summary.live.unresolvedConflicts > 0 && <>{summary.live.unresolvedConflicts} unresolved sync conflict{summary.live.unresolvedConflicts === 1 ? "" : "s"}. </>}
          {summary.live.unsyncedPending && <>Local changes not yet synced. </>}
          <Link href="/health" className="underline underline-offset-4">Open System Health</Link>
        </p>
      )}

      {total === 0 ? (
        <p className="text-xs text-zinc-500">No recorded activity for this day. The review is still yours to write — nothing here is required.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {summary.groups.map((g) => (
            <details key={g.key} className="rounded-lg border border-black/[.05] px-3 py-2 dark:border-white/[.06]">
              <summary className="cursor-pointer text-xs font-medium text-zinc-700 marker:text-zinc-400 dark:text-zinc-200">{g.label} <span className="text-zinc-400">· {g.count}</span></summary>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {g.items.slice(0, 12).map((it) => {
                  const ref = entityRef(ctx, it.kind, it.id);
                  const inner = <><span className="min-w-0 truncate">{it.label || ref.title}</span>{it.detail && <span className="ml-1 shrink-0 text-[10px] text-zinc-400">· {it.detail}</span>}</>;
                  return (
                    <li key={`${it.kind}:${it.id}`} className="flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                      {ref.exists && ref.href !== "/" ? <Link href={ref.href} className="flex min-w-0 items-center gap-1 underline-offset-4 hover:underline">{inner}</Link> : <span className="flex min-w-0 items-center gap-1">{inner}</span>}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
