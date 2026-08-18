"use client";
/** Living Constitution self-tests (LIFEOS-056). Dev-only surface. */
import { useMemo } from "react";
import { runConstitutionSelfTests } from "@/lib/constitution/selftest";

export default function ConstitutionTestsPage() {
  // Pure and synchronous — no effect, no state, no cascading render.
  const report = useMemo(() => runConstitutionSelfTests(), []);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Constitution self-tests</h1>
      <p className="mt-1 text-sm text-zinc-500">{report.passed}/{report.total} passed in {report.ms}ms</p>
      <ul className="mt-4 flex flex-col gap-1">
        {report.results.map((r) => (
          <li key={r.name} className={`text-xs ${r.pass ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {r.pass ? "✓" : "✗"} {r.name}{r.pass ? "" : ` — ${r.detail}`}
          </li>
        ))}
      </ul>
    </main>
  );
}
