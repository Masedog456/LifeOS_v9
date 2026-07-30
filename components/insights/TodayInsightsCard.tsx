"use client";

/**
 * Today insights card (LIFEOS-039, Feature 18). A small, factual snapshot of
 * today — sessions, focus time, actions completed, captures processed — with a
 * link to full Insights. Deliberately tiny; Today is not an analytics dashboard.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildActivityIndex } from "@/lib/insights/activity";
import { homeMetrics, formatDuration } from "@/lib/insights/metrics";
import { resolveRange } from "@/lib/insights/range";

export default function TodayInsightsCard() {
  const state = useStore();
  const index = useMemo(() => buildActivityIndex(state), [state]);
  const metrics = useMemo(() => homeMetrics(state, index, resolveRange("today")), [state, index]);
  const val = (k: string) => metrics.find((m) => m.key === k)?.value ?? 0;

  const items: [string, string][] = [
    ["Sessions", String(val("sessions"))],
    ["Focus time", formatDuration(val("focus_duration"))],
    ["Actions completed", String(val("actions_completed"))],
    ["Captures processed", String(val("captures_processed"))],
  ];
  const anything = items.some(([, v]) => v !== "0" && v !== "0m");
  if (!anything) return null;

  return (
    <section data-today-insights className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Today so far</h2>
        <Link href="/insights" className="text-[11px] text-sky-600 hover:underline dark:text-sky-400">Open Insights →</Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        {items.map(([label, v]) => <div key={label}><dt className="text-[11px] text-zinc-400">{label}</dt><dd className="font-medium tabular-nums">{v}</dd></div>)}
      </dl>
    </section>
  );
}
