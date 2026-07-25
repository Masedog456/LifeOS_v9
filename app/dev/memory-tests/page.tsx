"use client";

/**
 * Memory self-tests (LIFEOS-026) — developer route.
 *
 * The repo ships no unit-test runner, so the memory engines' fixture-driven
 * assertions live in `lib/memory/selftest.ts` and are surfaced here for the
 * E2E suite to read. Deterministic and self-contained: it builds its own
 * fixtures and never touches the user's store. A machine-readable summary lives
 * in `#memory-selftest-summary` for the Playwright suite to assert on.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runMemorySelfTests } from "@/lib/memory/selftest";

export default function MemoryTestsPage() {
  // Run only on the client: the report embeds wall-clock timings and generation
  // timestamps, so running it during SSR too would cause a hydration mismatch.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const report = useMemo(() => (mounted ? runMemorySelfTests() : null), [mounted]);

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Memory self-tests</h1>
        <p className="mt-2 text-sm text-zinc-400">Running…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Memory self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Deterministic, fixture-driven assertions for every LIFEOS-026 memory engine — explanation contract, Living Memory, timeline, themes, recommendation explanation, Continue Thinking, reflection prompts, projection purity, and performance.
        </p>
      </header>

      <div
        id="memory-selftest-summary"
        data-pass={report.pass ? "true" : "false"}
        data-total={report.total}
        data-passed={report.passed}
        data-failed={report.failed}
        className={`mb-5 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}
      >
        <p className="font-medium">
          {report.pass ? "✓ All memory self-tests pass" : "✗ Some memory self-tests failed"}
        </p>
        <p className="mt-1 text-zinc-500">
          {report.passed}/{report.total} passed{report.failed > 0 ? ` · ${report.failed} failed` : ""} · {report.ms}ms
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
        {report.results.map((r) => (
          <li key={r.name} className="flex items-start gap-2 py-1.5 text-sm">
            <span className={r.pass ? "text-emerald-500" : "text-rose-500"} aria-hidden>{r.pass ? "✓" : "✗"}</span>
            <span className="min-w-0">
              <span className="text-zinc-800 dark:text-zinc-100">{r.name}</span>
              {r.detail && r.detail !== "ok" && <span className="ml-2 text-[11px] text-zinc-400">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
