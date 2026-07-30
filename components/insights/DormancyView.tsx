"use client";

/** Dormancy view (LIFEOS-039, Feature 15). Records with no recorded activity in a chosen window. Neutral wording only. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildActivityIndex } from "@/lib/insights/activity";
import { dormancyView, dormancyPhrase, DORMANCY_KINDS, DORMANCY_KIND_LABEL, type DormancyKind } from "@/lib/insights/dormancy";
import { rememberedDormancyDays, rememberDormancyDays } from "@/lib/insights/memory";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";
import { resolveRange } from "@/lib/insights/range";

export default function DormancyView() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildActivityIndex(state), [state]);
  const [days, setDays] = useState<number>(rememberedDormancyDays());
  const [kinds, setKinds] = useState<DormancyKind[]>([...DORMANCY_KINDS]);
  const rows = useMemo(() => dormancyView(state, index, days, kinds), [state, index, days, kinds]);
  const range = resolveRange("today");
  const exportRows = rows.map((r) => ({ kind: r.kind, id: r.id, title: entityRef(ctx, r.kind, r.id).title, inactive_days: r.inactiveDays === Infinity ? "" : r.inactiveDays, last_activity: r.lastActivity ?? "" }));
  const toggle = (k: DormancyKind) => setKinds((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Dormancy</h1><p className="mt-0.5 text-sm text-zinc-500">Records with no recorded activity in a window you choose. A factual absence of events — not a judgment.</p></header>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1">No activity in <input type="number" min={1} value={days} data-threshold onChange={(e) => { const d = Math.max(1, Number(e.target.value) || 1); setDays(d); try { rememberDormancyDays(d); } catch { /* prefs optional */ } }} className="w-16 rounded-md border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/12" /> days</label>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" data-dormancy-kinds>
        {DORMANCY_KINDS.map((k) => <button key={k} type="button" data-kind={k} aria-pressed={kinds.includes(k)} onClick={() => toggle(k)} className={`rounded-full border px-2.5 py-1 text-[11px] ${kinds.includes(k) ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>{DORMANCY_KIND_LABEL[k]}</button>)}
      </div>
      <CoverageNotice />
      <ExportButtons insight="dormancy" range={range} columns={["kind", "id", "title", "inactive_days", "last_activity"]} rows={exportRows} filters={{ thresholdDays: days }} />
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No records match this window.</p> : (
        <ul className="flex flex-col gap-1 text-sm" data-dormancy-list>
          {rows.slice(0, 200).map((r) => { const e = entityRef(ctx, r.kind, r.id); return (
            <li key={`${r.kind}:${r.id}`} data-dormant-row className="flex items-center justify-between gap-2 border-t border-black/[.05] py-1 dark:border-white/[.06]"><span className="min-w-0"><Link href={e.href} className="truncate hover:underline">{e.exists ? e.title : `(${r.kind})`}</Link> <span className="text-[10px] uppercase text-zinc-400">{r.kind}</span></span><span className="shrink-0 text-[11px] text-zinc-400">{dormancyPhrase(r)}</span></li>
          ); })}
        </ul>
      )}
    </main>
  );
}
