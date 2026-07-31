"use client";

/** Focus activity (LIFEOS-039, Feature 11). Durations + targets + interruptions. No distraction/deep-work score. */

import { useMemo } from "react";
import { useInsights } from "@/components/insights/useInsights";
import { focusActivity } from "@/lib/insights/focus";
import { formatDuration } from "@/lib/insights/metrics";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function FocusActivity() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const a = useMemo(() => focusActivity(state, index, range), [state, index, range]);
  const cards: [string, string][] = [["Focus sessions", String(a.sessions)], ["Total duration", formatDuration(a.totalMs)], ["Median duration", formatDuration(a.medianMs)], ["Targets used", String(a.targetsUsed)], ["Interruptions", String(a.interruptions)], ["Ended normally", String(a.endedNormally)], ["Left open", String(a.leftOpen)], ["Actions completed during focus", String(a.actionsCompletedDuringFocus)], ["Documents opened during focus", String(a.documentsOpenedDuringFocus)]];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Focus activity</h1><p className="mt-0.5 text-sm text-zinc-500">Recorded focus sessions in the range. No distraction score, no deep-work score, no comparison to others.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="focus" range={range} columns={["metric", "value"]} rows={cards.map(([metric, value]) => ({ metric, value }))} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-focus-cards>
        {cards.map(([label, v]) => <div key={label} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="mt-0.5 text-xs text-zinc-500">{label}</p></div>)}
      </div>
    </main>
  );
}
