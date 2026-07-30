"use client";

/** Goal activity (LIFEOS-039, Feature 5). Raw per-goal measures. No score, no prediction, no health status. */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { goalActivity } from "@/lib/insights/goals";
import { relativeTime } from "@/lib/entities/timeline";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

export default function GoalActivity() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const rows = useMemo(() => goalActivity(state, index, range), [state, index, range]);
  const cols = ["id", "title", "projectsLinked", "milestonesLinked", "actionsLinked", "sessions", "focusSessions", "completions", "captures", "reading", "knowledgeRefs", "lastActivity"];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Goal activity</h1><p className="mt-0.5 text-sm text-zinc-500">Raw measures per goal. No goal score, no predicted completion, no health status.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="goals" range={range} columns={cols} rows={rows as unknown as Record<string, unknown>[]} />
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No goals.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-sm" data-goal-table>
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-2">Goal</th><th className="py-1 pr-2">Projects</th><th className="py-1 pr-2">Actions</th><th className="py-1 pr-2">Sessions</th><th className="py-1 pr-2">Focus</th><th className="py-1 pr-2">Completions</th><th className="py-1 pr-2">Captures</th><th className="py-1 pr-2">Knowledge</th><th className="py-1">Last</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-goal-row className="border-t border-black/[.05] dark:border-white/[.06]"><td className="py-1.5 pr-2"><Link href={`/goal/${r.id}`} className="hover:underline">{r.title}</Link></td><td className="tabular-nums">{r.projectsLinked}</td><td className="tabular-nums">{r.actionsLinked}</td><td className="tabular-nums">{r.sessions}</td><td className="tabular-nums">{r.focusSessions}</td><td className="tabular-nums">{r.completions}</td><td className="tabular-nums">{r.captures}</td><td className="tabular-nums">{r.knowledgeRefs}</td><td className="text-zinc-500">{r.lastActivity ? relativeTime(r.lastActivity) : "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </main>
  );
}
