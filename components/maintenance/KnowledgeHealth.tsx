"use client";

/**
 * Knowledge Health dashboard (LIFEOS-038, Feature 1). A deterministic summary of
 * what may need maintenance — counts only, each linking to the records behind
 * it. No hidden score, no grade, no "healthy/unhealthy" verdict.
 */

import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { knowledgeHealth } from "@/lib/maintenance/dashboard";
import { readMaintenancePrefs } from "@/lib/maintenance/preferences";

export default function KnowledgeHealth() {
  const state = useStore();
  const dismissed = readMaintenancePrefs().dismissed ?? [];
  const health = knowledgeHealth(state, { dismissed });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge health</h1>
        <p className="mt-0.5 text-sm text-zinc-500">What might need maintenance. These are counts, not a grade — LifeOS surfaces candidates; you decide what to do.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-health-grid>
        {health.metrics.map((m) => (
          <Link key={m.key} href={m.href} data-metric={m.key} className="rounded-2xl border border-black/[.06] p-4 transition-colors hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
            <p className="text-2xl font-semibold tabular-nums" data-metric-count={m.count}>{m.count}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{m.label}</p>
          </Link>
        ))}
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 border-t border-black/[.06] pt-4 text-xs dark:border-white/[.08]">
        <Link href="/maintenance/review" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Review queue →</Link>
        <Link href="/maintenance/duplicates" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Duplicates</Link>
        <Link href="/maintenance/evidence" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Evidence</Link>
        <Link href="/maintenance/relationships" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Relationships</Link>
        <Link href="/maintenance/citations" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Citations</Link>
        <Link href="/maintenance/archive" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Archive</Link>
        <Link href="/maintenance/merge" className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Merge</Link>
      </nav>
    </main>
  );
}
