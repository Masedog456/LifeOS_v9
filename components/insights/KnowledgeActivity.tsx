"use client";

/** Knowledge activity (LIFEOS-039, Feature 9). Raw counts + most-referenced by backlink count. Never called "important". */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { entityRef } from "@/lib/entities/entity";
import { knowledgeActivity } from "@/lib/insights/knowledge";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function KnowledgeActivity() {
  const { state, ctx, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const a = useMemo(() => knowledgeActivity(state, index, range), [state, index, range]);
  const cards: [string, number][] = [["Entities created", a.entitiesCreated], ["Beliefs created", a.beliefsCreated], ["Beliefs reviewed", a.beliefsReviewed], ["Citations added", a.citationsAdded], ["Relationships added", a.relationshipsAdded], ["Research touched", a.researchTouched], ["Maintenance events", a.maintenanceEvents], ["Merged", a.merged], ["Archived", a.archived]];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Knowledge activity</h1><p className="mt-0.5 text-sm text-zinc-500">Raw knowledge counts in the range. Frequently-referenced records are labelled by count, never called important.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="knowledge" range={range} columns={["metric", "value"]} rows={cards.map(([metric, value]) => ({ metric, value }))} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-knowledge-cards>
        {cards.map(([label, v]) => <div key={label} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="mt-0.5 text-xs text-zinc-500">{label}</p></div>)}
      </div>
      <section data-most-referenced><h2 className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Most referenced (raw backlink count)</h2>
        <ul className="flex flex-col gap-0.5 text-sm">{a.mostReferenced.map((m) => { const e = entityRef(ctx, m.kind, m.id); return <li key={`${m.kind}:${m.id}`} className="flex justify-between gap-2"><Link href={e.href} className="min-w-0 truncate hover:underline">{e.exists ? e.title : `(${m.kind})`}</Link><span className="shrink-0 tabular-nums text-zinc-500">{m.backlinks} backlink{m.backlinks === 1 ? "" : "s"}</span></li>; })}</ul>
      </section>
    </main>
  );
}
