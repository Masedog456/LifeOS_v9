"use client";

/** Action flow (LIFEOS-039, Feature 6). Transition counts. More completions is not "better"; no velocity score. */

import { useMemo } from "react";
import { useInsights } from "@/components/insights/useInsights";
import { actionFlow } from "@/lib/insights/actions";
import RangePicker from "@/components/insights/RangePicker";
import CoverageNotice from "@/components/insights/CoverageNotice";
import ExportButtons from "@/components/insights/ExportButtons";

const KEYS: { key: keyof ReturnType<typeof actionFlow>; label: string }[] = [
  { key: "created", label: "Created" }, { key: "started", label: "Started" }, { key: "waiting", label: "Waiting" },
  { key: "deferred", label: "Deferred" }, { key: "completed", label: "Completed" }, { key: "cancelled", label: "Cancelled" }, { key: "restored", label: "Restored" },
];

export default function ActionFlow() {
  const { index, range, kind, customStart, customEnd, setRange } = useInsights();
  const flow = useMemo(() => actionFlow(index, range), [index, range]);
  const rows = KEYS.map((k) => ({ transition: k.label, count: flow[k.key] as number }));

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4"><h1 className="text-2xl font-semibold tracking-tight">Action flow</h1><p className="mt-0.5 text-sm text-zinc-500">Action transitions in the range. These are counts — more completions is not inherently better.</p></header>
      <RangePicker kind={kind} customStart={customStart} customEnd={customEnd} range={range} onChange={setRange} />
      <CoverageNotice />
      <ExportButtons insight="action-flow" range={range} columns={["transition", "count"]} rows={rows} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-action-flow>
        {KEYS.map((k) => (
          <div key={k.key} data-flow={k.key} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><p className="text-2xl font-semibold tabular-nums" data-flow-count={flow[k.key]}>{flow[k.key] as number}</p><p className="mt-0.5 text-xs text-zinc-500">{k.label}</p></div>
        ))}
      </div>
    </main>
  );
}
