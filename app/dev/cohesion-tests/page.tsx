"use client";

/**
 * Product-cohesion self-tests (LIFEOS-041) — developer route. Runs the design,
 * accessibility, and onboarding self-tests; machine-readable summaries at
 * `#design-selftest-summary`, `#accessibility-selftest-summary`,
 * `#onboarding-selftest-summary`.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runDesignSelfTests } from "@/lib/design/selftest";
import { runAccessibilitySelfTests } from "@/lib/accessibility/selftest";
import { runOnboardingSelfTests } from "@/lib/onboarding/selftest";

type Report = ReturnType<typeof runDesignSelfTests>;

function Summary({ id, title, report }: { id: string; title: string; report: Report }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">{title}</h2>
      <div id={id} data-pass={report.pass ? "true" : "false"} data-total={report.total} data-passed={report.passed} data-failed={report.failed}
        className={`mb-4 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}>
        <p className="font-medium">{report.pass ? "✓ All tests pass" : "✗ Some tests failed"}</p>
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
    </section>
  );
}

export default function CohesionTestsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const design = useMemo(() => (mounted ? runDesignSelfTests() : null), [mounted]);
  const a11y = useMemo(() => (mounted ? runAccessibilitySelfTests() : null), [mounted]);
  const onboarding = useMemo(() => (mounted ? runOnboardingSelfTests() : null), [mounted]);
  if (!design || !a11y || !onboarding) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><h1 className="text-2xl font-semibold tracking-tight">Cohesion self-tests</h1><p className="mt-2 text-sm text-zinc-400">Running…</p></main>;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Product-cohesion self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">Design tokens, color contrast, typography, terminology, microcopy, empty/error models, density, motion, responsive behavior, principle traceability, route inventory; keyboard shortcuts, landmarks, focus, audit, confirmation levels; onboarding progression, sample workspace, merge rules, education/help mapping.</p>
      </header>
      <Summary id="design-selftest-summary" title="Design system" report={design} />
      <Summary id="accessibility-selftest-summary" title="Accessibility" report={a11y} />
      <Summary id="onboarding-selftest-summary" title="Onboarding" report={onboarding} />
    </main>
  );
}
