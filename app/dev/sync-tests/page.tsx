"use client";

/**
 * Sync integrity self-tests + conflict harness (LIFEOS-033) — developer route.
 *
 * Runs `lib/sync/selftest.ts` and exposes a machine-readable summary at
 * `#sync-selftest-summary`. Also includes a dev-only harness that injects a
 * sample conflict into the reactive sync-status store and renders the real
 * `ConflictCenter`, so the `syncintegrity.mjs` E2E can exercise resolution in a
 * single page (deterministic device simulation). Client-only, self-contained.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runSyncSelfTests } from "@/lib/sync/selftest";
import { setConflicts } from "@/lib/sync/status-store";
import ConflictCenter from "@/components/sync/ConflictCenter";
import type { RecordConflict } from "@/lib/sync/conflicts";
import { threeWayMerge } from "@/lib/sync/merge";

function sampleConflict(): RecordConflict {
  const base = { id: "cap-x", text: "base thought", tags: [] as string[], updatedAt: "2026-12-01T00:00:00Z" };
  const local = { ...base, text: "my edit", updatedAt: "2026-12-01T01:00:00Z" };
  const remote = { ...base, text: "their edit", tags: ["r"], updatedAt: "2026-12-01T02:00:00Z" };
  const merge = threeWayMerge(base, local, remote);
  return { domain: "captures", id: "cap-x", kind: "conflict", needsResolution: true, changedLocal: ["text"], changedRemote: ["text", "tags"], merge, base, local, remote };
}

export default function SyncTestsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const report = useMemo(() => (mounted ? runSyncSelfTests() : null), [mounted]);
  if (!report) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><h1 className="text-2xl font-semibold tracking-tight">Sync self-tests</h1><p className="mt-2 text-sm text-zinc-400">Running…</p></main>;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Sync integrity self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">Three-way merge, conflict detection, tombstones, journal, idempotency, corruption isolation, referential integrity, schema upgrades, the ten cross-device scenarios, and performance.</p>
      </header>

      <div id="sync-selftest-summary" data-pass={report.pass ? "true" : "false"} data-total={report.total} data-passed={report.passed} data-failed={report.failed}
        className={`mb-5 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}>
        <p className="font-medium">{report.pass ? "✓ All sync self-tests pass" : "✗ Some sync self-tests failed"}</p>
        <p className="mt-1 text-zinc-500">{report.passed}/{report.total} passed{report.failed > 0 ? ` · ${report.failed} failed` : ""} · {report.ms}ms</p>
      </div>

      <section className="mb-5 rounded-xl border border-black/10 p-4 dark:border-white/12">
        <h2 className="mb-2 text-sm font-semibold">Conflict harness (dev)</h2>
        <button type="button" onClick={() => setConflicts([sampleConflict()])} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Inject sample conflict</button>
        <div className="mt-3"><ConflictCenter /></div>
      </section>

      <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
        {report.results.map((r) => (
          <li key={r.name} className="flex items-start gap-2 py-1.5 text-sm">
            <span className={r.pass ? "text-emerald-500" : "text-rose-500"} aria-hidden>{r.pass ? "✓" : "✗"}</span>
            <span className="min-w-0"><span className="text-zinc-800 dark:text-zinc-100">{r.name}</span>{r.detail && r.detail !== "ok" && <span className="ml-2 text-[11px] text-zinc-400">{r.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
