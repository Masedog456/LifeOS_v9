"use client";

/**
 * Product-polish UX self-tests (LIFEOS-032) — developer route.
 *
 * Runs `lib/ux/selftest.ts` and exposes a machine-readable summary at
 * `#ux-selftest-summary` for the `ux.mjs` E2E suite. Client-only, self-contained.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runUxSelfTests } from "@/lib/ux/selftest";

export default function UxTestsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const report = useMemo(() => (mounted ? runUxSelfTests() : null), [mounted]);
  if (!report) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><h1 className="text-2xl font-semibold tracking-tight">UX self-tests</h1><p className="mt-2 text-sm text-zinc-400">Running…</p></main>;
  }
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Product-polish self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">Dirty-state, confirmation impact, toast dedup, backup serialization, restore validation/preview/merge, diagnostics sanitization, and performance budgets.</p>
      </header>
      <div id="ux-selftest-summary" data-pass={report.pass ? "true" : "false"} data-total={report.total} data-passed={report.passed} data-failed={report.failed}
        className={`mb-5 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}>
        <p className="font-medium">{report.pass ? "✓ All UX self-tests pass" : "✗ Some UX self-tests failed"}</p>
        <p className="mt-1 text-zinc-500">{report.passed}/{report.total} passed{report.failed > 0 ? ` · ${report.failed} failed` : ""} · {report.ms}ms</p>
      </div>
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
