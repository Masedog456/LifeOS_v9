"use client";

/**
 * Project activity (LIFEOS-039, Feature 4). Raw per-project measures. Comparison
 * only through raw values; never ranked, never labelled neglected or successful.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { projectActivity } from "@/lib/insights/projects";
import { formatDuration } from "@/lib/insights/metrics";
import { relativeTime } from "@/lib/entities/timeline";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function ProjectActivity() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const rows = useMemo(() => projectActivity(state, index, range), [state, index, range]);
  const cols = ["id", "title", "status", "sessions", "focusMs", "actionsCreated", "actionsStarted", "actionsCompleted", "capturesLinked", "documentsOpened", "milestonesTouched", "planningMovements", "maintenanceEvents", "lastActivity"];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Project activity</h1><p className="mt-0.5 text-sm text-zinc-500">Raw measures per project for the range. Nothing here is ranked or judged.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="projects" range={range} columns={cols} rows={rows as unknown as Record<string, unknown>[]} />
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No projects.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm" data-project-table>
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-2">Project</th><th className="py-1 pr-2">Sessions</th><th className="py-1 pr-2">Focus</th><th className="py-1 pr-2">Created</th><th className="py-1 pr-2">Started</th><th className="py-1 pr-2">Completed</th><th className="py-1 pr-2">Milestones</th><th className="py-1 pr-2">Plan moves</th><th className="py-1">Last</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-project-row className="border-t border-black/[.05] dark:border-white/[.06]"><td className="py-1.5 pr-2"><Link href={`/project/${r.id}`} className="hover:underline">{r.title}</Link></td><td className="tabular-nums">{r.sessions}</td><td className="tabular-nums">{formatDuration(r.focusMs)}</td><td className="tabular-nums">{r.actionsCreated}</td><td className="tabular-nums">{r.actionsStarted}</td><td className="tabular-nums">{r.actionsCompleted}</td><td className="tabular-nums">{r.milestonesTouched}</td><td className="tabular-nums">{r.planningMovements}</td><td className="text-zinc-500">{r.lastActivity ? relativeTime(r.lastActivity) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </main>
  );
}
