"use client";
/** Life Architecture Interview self-tests (LIFEOS-058 / 058A). Dev-only surface. */
import { useEffect, useState } from "react";
import { runInterviewSelfTests, type SelfTestReport } from "@/lib/interview/selftest";

export default function InterviewTestsPage() {
  // Async since 058A: the sign-out privacy assertions await the real
  // `authStore.signOut()`, so the report cannot be produced during render.
  const [report, setReport] = useState<SelfTestReport | null>(null);
  useEffect(() => { void runInterviewSelfTests().then(setReport); }, []);

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Interview self-tests</h1>
        <p className="mt-1 text-sm text-zinc-400">Running…</p>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Interview self-tests</h1>
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
