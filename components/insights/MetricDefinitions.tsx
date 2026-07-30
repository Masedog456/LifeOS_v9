"use client";

/**
 * Metric definitions drawer (LIFEOS-039, Feature 24). Every metric's plain
 * definition, so no metric exists only as undocumented behavior.
 */

import { allDefinitions } from "@/lib/insights/definitions";

export default function MetricDefinitions() {
  return (
    <details data-definitions className="mt-6 rounded-2xl border border-black/[.06] p-4 text-sm dark:border-white/[.08]">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-zinc-400">Metric definitions</summary>
      <dl className="mt-2 flex flex-col gap-2">
        {allDefinitions().map((d) => (
          <div key={d.key} data-definition={d.key}>
            <dt className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{d.label}</dt>
            <dd className="text-[12px] text-zinc-500">{d.definition}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
