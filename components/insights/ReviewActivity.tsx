"use client";

/** Review activity (LIFEOS-039, Feature 10). Daily-review history. Never a streak, never shame, never failure language. */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { reviewActivity } from "@/lib/insights/reviews";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function ReviewActivity() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const a = useMemo(() => reviewActivity(state, index, range), [state, index, range]);
  const cards: [string, number][] = [["Reviews completed", a.completedReviews.length], ["Open loops surfaced", a.openLoops], ["Tomorrow-focus items", a.tomorrowFocus], ["Friction entries", a.friction], ["Maintenance decisions", a.maintenanceDecisions], ["Interruptions logged", a.interruptions], ["Carried forward", a.carriedForward]];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Review activity</h1><p className="mt-0.5 text-sm text-zinc-500">Daily-review history in the range. A day with no review is simply the absence of a record — nothing more.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="reviews" range={range} columns={["metric", "value"]} rows={cards.map(([metric, value]) => ({ metric, value }))} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-review-cards>
        {cards.map(([label, v]) => <div key={label} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="mt-0.5 text-xs text-zinc-500">{label}</p></div>)}
      </div>
      {a.completedReviews.length > 0 && (
        <section data-completed-reviews><h2 className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Completed reviews</h2><ul className="flex flex-wrap gap-1.5 text-sm">{a.completedReviews.map((r) => <li key={r.id}><Link href={`/daily/${r.date}`} className="rounded-full border border-black/[.10] px-2 py-0.5 text-[11px] hover:underline dark:border-white/[.12]">{r.date}</Link></li>)}</ul></section>
      )}
    </main>
  );
}
