"use client";

/**
 * Insights Home (LIFEOS-039, Feature 1). A calm dashboard of range-scoped
 * counts + durations — no composite score, no performance rating. Range picker,
 * coverage disclosure, metric grid, sub-view navigation, and definitions.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useInsights } from "@/components/insights/useInsights";
import { homeMetrics } from "@/lib/insights/metrics";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import MetricCard from "@/components/insights/MetricCard";
import MetricDefinitions from "@/components/insights/MetricDefinitions";

const SUBVIEWS: { href: string; label: string }[] = [
  { href: "/insights/attention", label: "Attention" },
  { href: "/insights/projects", label: "Projects" },
  { href: "/insights/goals", label: "Goals" },
  { href: "/insights/actions", label: "Action flow" },
  { href: "/insights/captures", label: "Capture flow" },
  { href: "/insights/reading", label: "Reading" },
  { href: "/insights/knowledge", label: "Knowledge" },
  { href: "/insights/reviews", label: "Reviews" },
  { href: "/insights/focus", label: "Focus" },
  { href: "/insights/change-log", label: "Change log" },
  { href: "/insights/period", label: "Period summary" },
  { href: "/insights/compare", label: "Compare" },
  { href: "/insights/dormancy", label: "Dormancy" },
  { href: "/insights/contributions", label: "Contributions" },
];

export default function InsightsHome() {
  const { state, index, range, kind, customStart, customEnd, setRange } = useInsights();
  const metrics = useMemo(() => homeMetrics(state, index, range), [state, index, range]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="mt-0.5 text-sm text-zinc-500">A description of what happened in a period you choose — counts and durations, nothing rated or ranked.</p>
      </header>

      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-metric-grid>
        {metrics.map((m) => <MetricCard key={m.key} metric={m} />)}
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 border-t border-black/[.06] pt-4 text-xs dark:border-white/[.08]">
        {SUBVIEWS.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">{s.label}</Link>
        ))}
      </nav>

      <MetricDefinitions />
    </main>
  );
}
