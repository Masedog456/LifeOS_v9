"use client";

/**
 * Metric card (LIFEOS-039). A single raw value with its label and a definition
 * tooltip. Counts and durations only — never a score.
 */

import type { Metric } from "@/lib/insights/metrics";
import { formatDuration } from "@/lib/insights/metrics";
import { definition } from "@/lib/insights/definitions";

export default function MetricCard({ metric }: { metric: Metric }) {
  const def = definition(metric.definitionKey);
  const value = metric.unit === "ms" ? formatDuration(metric.value) : String(metric.value);
  return (
    <div data-metric={metric.key} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" title={def?.definition}>
      <p className="text-2xl font-semibold tabular-nums" data-metric-value={metric.value}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{metric.label}</p>
    </div>
  );
}
