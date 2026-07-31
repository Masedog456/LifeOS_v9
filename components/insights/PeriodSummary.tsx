"use client";

/** Period summary (LIFEOS-039, Feature 13). Sectioned from explicit event rules. No prose, no narrative, no recommendations. */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { entityRef } from "@/lib/entities/entity";
import { periodSummary } from "@/lib/insights/period-summary";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";

export default function PeriodSummary() {
  const { ctx, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const sections = useMemo(() => periodSummary(index, range), [index, range]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Period summary</h1><p className="mt-0.5 text-sm text-zinc-500">What happened, by section — generated from explicit event rules, not narrative.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <div className="flex flex-col gap-3" data-period-summary>
        {sections.map((s) => (
          <section key={s.key} data-section={s.key} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{s.label} <span className="text-zinc-300 dark:text-zinc-600">· {s.count}</span></h2>
            {s.count === 0 ? <p className="text-[12px] text-zinc-400">Nothing recorded.</p> : (
              <ul className="flex flex-col gap-0.5 text-sm">{s.items.slice(0, 12).map((it, i) => { const e = entityRef(ctx, it.kind, it.id); return <li key={`${it.id}:${i}`} className="truncate"><Link href={e.href} className="hover:underline">{e.exists ? e.title : `(${it.kind})`}</Link></li>; })}{s.items.length > 12 && <li className="text-[11px] text-zinc-400">+{s.items.length - 12} more</li>}</ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
