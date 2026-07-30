"use client";

/** Change log (LIFEOS-039, Feature 12). Chronological events, filterable. Reuses compact history; no full-content duplication. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { entityRef } from "@/lib/entities/entity";
import { changeLog, eventTypeLabel, eventTypesInRange } from "@/lib/insights/change-log";
import { relativeTime } from "@/lib/entities/timeline";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function ChangeLog() {
  const { ctx, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const [eventType, setEventType] = useState<string>("");
  const types = useMemo(() => eventTypesInRange(index, range), [index, range]);
  const entries = useMemo(() => changeLog(index, range, { eventType: eventType || undefined }), [index, range, eventType]);
  const exportRows = entries.map((e) => ({ at: e.at, type: e.type, kind: e.recordKind, id: e.recordId, project: e.projectId ?? "", detail: e.detail ?? "" }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Change log</h1><p className="mt-0.5 text-sm text-zinc-500">What was recorded in the range, most recent first.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5" data-event-filters>
        <button type="button" data-event-filter="all" aria-current={!eventType ? "true" : undefined} onClick={() => setEventType("")} className={`rounded-full border px-2.5 py-1 text-[11px] ${!eventType ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>All events</button>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} data-event-select aria-label="Filter by event type" className="rounded-md border border-black/10 bg-transparent px-1.5 py-1 text-[11px] dark:border-white/12">
          <option value="">Any type…</option>
          {types.map((t) => <option key={t} value={t}>{eventTypeLabel(t)}</option>)}
        </select>
      </div>
      <CoverageNotice />
      <ExportButtons insight="change-log" range={range} columns={["at", "type", "kind", "id", "project", "detail"]} rows={exportRows} filters={{ eventType }} />
      {entries.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No recorded events in this range.</p> : (
        <ul className="flex flex-col gap-0.5 text-sm" data-change-log>
          {entries.slice(0, 200).map((e, i) => { const ent = entityRef(ctx, e.recordKind, e.recordId); return (
            <li key={`${e.at}:${e.type}:${e.recordId}:${i}`} data-change-entry data-type={e.type} className="flex items-center justify-between gap-2 border-t border-black/[.04] py-1 dark:border-white/[.05]">
              <span className="min-w-0"><span className="text-zinc-400">{eventTypeLabel(e.type)}</span> · <Link href={ent.href} className="hover:underline">{ent.exists ? ent.title : `(${e.recordKind})`}</Link></span>
              <span className="shrink-0 text-[11px] text-zinc-400">{relativeTime(e.at)}</span>
            </li>
          ); })}
        </ul>
      )}
    </main>
  );
}
