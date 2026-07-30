"use client";

/** Reading activity (LIFEOS-039, Feature 8). Opens, highlights, citations, links. No comprehension inference. */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { readingActivity } from "@/lib/insights/reading";
import { relativeTime } from "@/lib/entities/timeline";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function ReadingActivity() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const a = useMemo(() => readingActivity(state, index, range), [state, index, range]);
  const cards: [string, number][] = [["Documents opened", a.documentsOpened], ["Highlights", a.highlights], ["Annotations", a.annotations], ["Citations created", a.citationsCreated], ["Entities linked", a.entitiesLinked], ["Beliefs linked", a.beliefsLinked]];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Reading activity</h1><p className="mt-0.5 text-sm text-zinc-500">Recorded reading events in the range. Comprehension is never inferred.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="reading" range={range} columns={["metric", "value"]} rows={cards.map(([metric, value]) => ({ metric, value }))} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-reading-cards>
        {cards.map(([label, v]) => <div key={label} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="mt-0.5 text-xs text-zinc-500">{label}</p></div>)}
      </div>
      {a.unfinishedPlanned.length > 0 && (
        <section className="mb-4"><h2 className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Unfinished reading you selected in planning</h2><ul data-unfinished-planned className="flex flex-col gap-0.5 text-sm">{a.unfinishedPlanned.map((d) => <li key={d.id}><Link href={`/document/${d.id}`} className="hover:underline">{d.title}</Link></li>)}</ul></section>
      )}
      {a.lastOpened.length > 0 && (
        <section><h2 className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Last opened</h2><ul className="flex flex-col gap-0.5 text-sm">{a.lastOpened.slice(0, 10).map((d) => <li key={d.id} className="flex justify-between gap-2"><Link href={`/document/${d.id}`} className="min-w-0 truncate hover:underline">{d.title}</Link><span className="shrink-0 text-zinc-500">{relativeTime(d.at)}</span></li>)}</ul></section>
      )}
    </main>
  );
}
