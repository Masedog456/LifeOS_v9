"use client";

/**
 * Attention view (LIFEOS-039, Feature 3). Where recorded attention went, by a
 * chosen grouping. Neutral counts/durations — never called value or importance.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { entityRef } from "@/lib/entities/entity";
import { attentionView, ATTENTION_GROUPINGS, ATTENTION_GROUPING_LABEL, type AttentionGrouping } from "@/lib/insights/attention";
import { formatDuration } from "@/lib/insights/metrics";
import { relativeTime } from "@/lib/entities/timeline";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";
import { useState } from "react";

export default function AttentionView() {
  const { ctx, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const [grouping, setGrouping] = useState<AttentionGrouping>("project");
  const rows = useMemo(() => attentionView(index, range, grouping), [index, range, grouping]);
  const exportRows = rows.map((r) => ({ kind: r.kind, id: r.id, title: entityRef(ctx, r.kind, r.id).title, sessions: r.sessionCount, focus: r.focusCount, duration_ms: r.durationMs, activity: r.activityCount, last_touched: r.lastTouched ?? "" }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Attention</h1><p className="mt-0.5 text-sm text-zinc-500">Where recorded activity went — a count of sessions and events, not a measure of value or priority.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <div className="mb-3 flex flex-wrap gap-1.5" data-groupings>
        {ATTENTION_GROUPINGS.map((g) => (
          <button key={g} type="button" data-grouping={g} aria-current={grouping === g ? "true" : undefined} onClick={() => setGrouping(g)} className={`rounded-full border px-2.5 py-1 text-[11px] ${grouping === g ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>{ATTENTION_GROUPING_LABEL[g]}</button>
        ))}
      </div>
      <CoverageNotice />
      <ExportButtons insight="attention" range={range} columns={["kind", "id", "title", "sessions", "focus", "duration_ms", "activity", "last_touched"]} rows={exportRows} filters={{ grouping }} />
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No recorded activity for this grouping in the range.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm" data-attention-table>
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-3">Target</th><th className="py-1 pr-3">Sessions</th><th className="py-1 pr-3">Focus</th><th className="py-1 pr-3">Duration</th><th className="py-1 pr-3">Activity</th><th className="py-1">Last touched</th></tr></thead>
          <tbody>{rows.map((r) => { const e = entityRef(ctx, r.kind, r.id); return (
            <tr key={`${r.kind}:${r.id}`} data-attention-row className="border-t border-black/[.05] dark:border-white/[.06]"><td className="py-1.5 pr-3"><Link href={e.href} className="hover:underline">{e.exists ? e.title : `(${r.kind})`}</Link></td><td className="tabular-nums">{r.sessionCount}</td><td className="tabular-nums">{r.focusCount}</td><td className="tabular-nums">{formatDuration(r.durationMs)}</td><td className="tabular-nums">{r.activityCount}</td><td className="text-zinc-500">{r.lastTouched ? relativeTime(r.lastTouched) : "—"}</td></tr>
          ); })}</tbody>
        </table></div>
      )}
    </main>
  );
}
