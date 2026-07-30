"use client";

/**
 * Coverage notice (LIFEOS-039, Feature 25). Discloses what the view can and
 * cannot see so partial data is never presented as complete.
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { buildActivityIndex } from "@/lib/insights/activity";
import { buildCoverage } from "@/lib/insights/coverage";

export default function CoverageNotice() {
  const state = useStore();
  const index = useMemo(() => buildActivityIndex(state), [state]);
  const coverage = useMemo(() => buildCoverage(state, index), [state, index]);
  return (
    <details data-coverage className="mb-4 rounded-xl border border-black/[.06] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[.08]">
      <summary className="cursor-pointer select-none">Data coverage</summary>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {coverage.notes.map((n, i) => <li key={i}>· {n}</li>)}
      </ul>
    </details>
  );
}
