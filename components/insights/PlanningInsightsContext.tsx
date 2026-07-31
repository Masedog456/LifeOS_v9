"use client";

/**
 * Planning insights context (LIFEOS-039, Feature 20). A read-only factual line
 * on the planning board — planned items now, plus sessions and completed actions
 * in the last 7 days — linking to Insights. It NEVER reorders the board, alters
 * a horizon, or recommends what to plan.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildActivityIndex } from "@/lib/insights/activity";
import { homeMetrics } from "@/lib/insights/metrics";
import { resolveRange } from "@/lib/insights/range";

export default function PlanningInsightsContext() {
  const state = useStore();
  const index = useMemo(() => buildActivityIndex(state), [state]);
  const metrics = useMemo(() => homeMetrics(state, index, resolveRange("last_7_days")), [state, index]);
  const val = (k: string) => metrics.find((m) => m.key === k)?.value ?? 0;
  const plannedCount = (state.planningAssignments ?? []).length;

  return (
    <div data-planning-insights className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-black/[.06] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[.08]">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">Context:</span>
      <span>{plannedCount} planned item{plannedCount === 1 ? "" : "s"}</span>
      <span>· {val("sessions")} session{val("sessions") === 1 ? "" : "s"} (7d)</span>
      <span>· {val("actions_completed")} completed (7d)</span>
      <Link href="/insights" className="hover:underline">Open Insights →</Link>
      <span className="text-zinc-400">— facts only; nothing here changes your plan.</span>
    </div>
  );
}
