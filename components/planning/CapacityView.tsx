"use client";

/**
 * Capacity view (LIFEOS-037, Feature 9). Counts only, never a workload score.
 * The user sets soft limits per category; exceeding one shows neutral language
 * and NEVER blocks. Limits persist in prefs.planning.
 */

import { useMemo, useState } from "react";
import { useStore } from "@/lib/mvpStore";
import { capacitySummary, capacityMessage, CAPACITY_LABEL, type CapacityCategory } from "@/lib/planning/capacity";
import { readPlanningMemory, writePlanningMemory } from "@/lib/planning/memory";

export default function CapacityView() {
  const state = useStore();
  const [limits, setLimits] = useState<Partial<Record<CapacityCategory, number>>>(() => readPlanningMemory().capacityLimits);
  const rows = useMemo(() => capacitySummary(state, limits), [state, limits]);

  const setLimit = (cat: CapacityCategory, value: string) => {
    const n = value.trim() === "" ? undefined : Math.max(0, Number(value));
    const next = { ...limits }; if (n === undefined || Number.isNaN(n) || n === 0) delete next[cat]; else next[cat] = n;
    setLimits(next);
    writePlanningMemory({ capacityLimits: next });
  };

  return (
    <section aria-label="Capacity" className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <h2 className="mb-2 text-sm font-semibold">Capacity</h2>
      <p className="mb-3 text-xs text-zinc-500">Counts of what you&apos;ve taken on. Set a preferred limit if you like — it&apos;s a gentle marker, never a block.</p>
      <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
        {rows.map((row) => (
          <li key={row.category} data-capacity={row.category} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-zinc-700 dark:text-zinc-200">{CAPACITY_LABEL[row.category]}</span>
            <span className="flex items-center gap-2">
              <span className={row.exceeded ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"} data-count>{row.exceeded ? capacityMessage(row) : row.count}</span>
              <input type="number" min={0} value={limits[row.category] ?? ""} onChange={(e) => setLimit(row.category, e.target.value)} placeholder="—" aria-label={`Preferred limit for ${CAPACITY_LABEL[row.category]}`} className="w-14 rounded-md border border-black/10 bg-transparent px-1.5 py-0.5 text-right text-xs dark:border-white/12" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
