"use client";

/** Period comparison (LIFEOS-039, Feature 14). Raw value each period + differences. Neutral language only. */

import { useMemo } from "react";
import { useInsights } from "@/components/insights/useInsights";
import { comparePeriods } from "@/lib/insights/comparison";
import { previousRange } from "@/lib/insights/range";
import { formatDuration } from "@/lib/insights/metrics";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function PeriodComparison() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const previous = useMemo(() => previousRange(range), [range]);
  const rows = useMemo(() => comparePeriods(state, index, range, previous), [state, index, range, previous]);
  const fmt = (v: number, unit: string | undefined) => (unit === "ms" ? formatDuration(v) : String(v));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Compare periods</h1><p className="mt-0.5 text-sm text-zinc-500">This period vs the previous period of equal length. Raw values and their differences only — no judgment about direction.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <p className="mb-3 text-[11px] text-zinc-400" data-compare-ranges>Current {range.startKey}→{range.endKey} vs previous {previous.startKey}→{previous.endKey}</p>
      <CoverageNotice />
      <ExportButtons insight="compare" range={range} columns={["key", "label", "current", "previous", "absDiff", "pctDiff"]} rows={rows as unknown as Record<string, unknown>[]} filters={{ previousStart: previous.startKey, previousEnd: previous.endKey }} />
      <div className="overflow-x-auto"><table className="w-full text-sm" data-comparison-table>
        <thead><tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-3">Metric</th><th className="py-1 pr-3">Current</th><th className="py-1 pr-3">Previous</th><th className="py-1 pr-3">Difference</th><th className="py-1">%</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} data-comparison-row={r.key} className="border-t border-black/[.05] dark:border-white/[.06]"><td className="py-1.5 pr-3">{r.label}</td><td className="tabular-nums" data-current={r.current}>{fmt(r.current, r.unit)}</td><td className="tabular-nums text-zinc-500" data-previous={r.previous}>{fmt(r.previous, r.unit)}</td><td className="tabular-nums" data-absdiff={r.absDiff}>{r.absDiff > 0 ? "+" : ""}{r.unit === "ms" ? formatDuration(Math.abs(r.absDiff)) + (r.absDiff < 0 ? " fewer" : " more") : r.absDiff}</td><td className="tabular-nums text-zinc-500">{r.pctDiff === undefined ? "—" : `${r.pctDiff > 0 ? "+" : ""}${r.pctDiff}%`}</td></tr>
        ))}</tbody>
      </table></div>
    </main>
  );
}
