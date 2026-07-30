"use client";

/** Contribution map (LIFEOS-039, Feature 16). Bounded edge counts through the hierarchy. Never the whole graph, never causation. */

import { useMemo } from "react";
import { useInsights } from "@/components/insights/useInsights";
import { contributionMap } from "@/lib/insights/contributions";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";

export default function ContributionMap() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const edges = useMemo(() => contributionMap(state, index, range), [state, index, range]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Contribution map</h1><p className="mt-0.5 text-sm text-zinc-500">How recorded activity flowed through the hierarchy in the range — edge counts only. No causation is inferred.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      {edges.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No hierarchical activity recorded in this range.</p> : (
        <ul className="flex flex-col gap-1.5" data-contribution-map>
          {edges.map((e) => (
            <li key={`${e.from}-${e.to}`} data-edge={`${e.from}-${e.to}`} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.06] px-3 py-2 text-sm dark:border-white/[.08]"><span>{e.label}</span><span className="tabular-nums text-zinc-500">{e.count}</span></li>
          ))}
        </ul>
      )}
    </main>
  );
}
