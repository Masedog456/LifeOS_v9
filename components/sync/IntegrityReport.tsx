"use client";

/**
 * Integrity report (LIFEOS-033, Feature 11/14).
 *
 * Runs deterministic referential-integrity validation over the current store and
 * lists any issues (duplicate ids, dangling citations, orphan session/project
 * references). Read-only — it reports; it never mutates. Names records by id
 * only (no content).
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { validateIntegrity, integritySummary } from "@/lib/sync/integrity";

export default function IntegrityReport() {
  const state = useStore();
  const result = useMemo(() => validateIntegrity(state), [state]);

  return (
    <section aria-label="Data integrity" className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Data integrity</h2>
        <span className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{integritySummary(result)}</span>
      </div>
      {result.issues.length === 0 ? (
        <p className="text-xs text-zinc-500">All references resolve; no duplicate ids.</p>
      ) : (
        <ul className="max-h-48 space-y-0.5 overflow-auto text-xs">
          {result.issues.slice(0, 50).map((i, idx) => (
            <li key={idx} className={i.severity === "error" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}>
              <span className="font-mono">{i.domain}/{i.recordId}</span> — {i.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
