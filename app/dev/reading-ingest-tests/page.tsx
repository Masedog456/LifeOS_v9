"use client";

/**
 * Reading ingestion + grounded-study self-tests (LIFEOS-047) — developer route.
 *
 * The repo ships no unit-test runner, so the ingestion / page-provenance /
 * duplicate / state-machine / chunking / retrieval / grounded-citation
 * assertions live in `lib/reading/selftest.ts` and are surfaced here for the
 * E2E suite to read. Deterministic and self-contained: it builds its own
 * fixtures and never touches the user's store, network, or any AI provider. A
 * machine-readable summary lives in `#reading-ingest-selftest-summary` for the
 * Playwright suite to assert on.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runReadingIngestSelfTests } from "@/lib/reading/selftest";

export default function ReadingIngestTestsPage() {
  // Run only on the client: the report embeds wall-clock timings, so running it
  // during SSR too would cause a hydration mismatch.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const report = useMemo(() => (mounted ? runReadingIngestSelfTests() : null), [mounted]);

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Reading ingestion self-tests</h1>
        <p className="mt-2 text-sm text-zinc-400">Running…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Reading ingestion self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Deterministic assertions for LIFEOS-047 — format detection, upload validation, duplicate detection by hash, PDF page provenance (never invented), the processing-state machine, honest ingestion of scanned/empty text, document chunking with real source locations, deterministic retrieval, grounded citations, the context budget, summarize scoping, and generated study material.
        </p>
      </header>

      <div
        id="reading-ingest-selftest-summary"
        data-pass={report.pass ? "true" : "false"}
        data-total={report.total}
        data-passed={report.passed}
        data-failed={report.failed}
        className={`mb-5 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}
      >
        <p className="font-medium">
          {report.pass ? "✓ All reading ingestion self-tests pass" : "✗ Some reading ingestion self-tests failed"}
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
              <span className="text-zinc-700 dark:text-zinc-200">{r.name}</span>
              {!r.pass && r.detail ? <span className="ml-1 text-rose-500">— {r.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
