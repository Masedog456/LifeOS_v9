"use client";

/** Capture flow (LIFEOS-039, Feature 7). Outcomes + percentages + median delay + oldest unprocessed. No quality judgments. */

import { useMemo } from "react";
import { useInsights } from "@/components/insights/useInsights";
import { captureFlow } from "@/lib/insights/captures";
import { formatDuration } from "@/lib/insights/metrics";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function CaptureFlow() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const flow = useMemo(() => captureFlow(state, index, range), [state, index, range]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Capture flow</h1><p className="mt-0.5 text-sm text-zinc-500">Where captures went in the range. Counts and percentages only.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="capture-flow" range={range} columns={["key", "label", "count", "percent"]} rows={flow.outcomes as unknown as Record<string, unknown>[]} />
      <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><dt className="text-[11px] text-zinc-400">Created in range</dt><dd className="text-xl font-semibold tabular-nums" data-created>{flow.createdInRange}</dd></div>
        <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><dt className="text-[11px] text-zinc-400">Processed in range</dt><dd className="text-xl font-semibold tabular-nums" data-processed>{flow.processedInRange}</dd></div>
        <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><dt className="text-[11px] text-zinc-400">Median processing delay</dt><dd className="text-sm" data-median-delay>{flow.medianProcessingDelayMs === undefined ? "—" : formatDuration(flow.medianProcessingDelayMs)}</dd></div>
        <div className="rounded-xl border border-black/[.06] p-3 dark:border-white/[.08]"><dt className="text-[11px] text-zinc-400">Oldest unprocessed</dt><dd className="text-sm" data-oldest>{flow.oldestUnprocessed ? new Date(flow.oldestUnprocessed.createdAt).toLocaleDateString() : "—"}</dd></div>
      </dl>
      {flow.outcomes.length > 0 && (
        <ul className="flex flex-col gap-1" data-outcomes>
          {flow.outcomes.map((o) => <li key={o.key} data-outcome={o.key} className="flex items-center justify-between gap-2 text-sm"><span>{o.label}</span><span className="tabular-nums text-zinc-500">{o.count} · {o.percent}%</span></li>)}
        </ul>
      )}
      {flow.sourceDistribution.length > 0 && (
        <div className="mt-4"><h2 className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Source distribution</h2><ul className="flex flex-col gap-0.5 text-sm">{flow.sourceDistribution.map((s) => <li key={s.source} className="flex justify-between"><span>{s.source}</span><span className="tabular-nums text-zinc-500">{s.count}</span></li>)}</ul></div>
      )}
    </main>
  );
}
