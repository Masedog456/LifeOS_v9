"use client";

/**
 * Security + backup self-tests (LIFEOS-040) — developer route. Runs
 * `lib/security/selftest.ts` and `lib/backup/selftest.ts`; machine-readable
 * summaries at `#security-selftest-summary` and `#backup-selftest-summary`.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runSecuritySelfTests } from "@/lib/security/selftest";
import { runBackupSelfTests } from "@/lib/backup/selftest";

function Summary({ id, title, report }: { id: string; title: string; report: ReturnType<typeof runSecuritySelfTests> }) {
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

export default function SecurityTestsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const security = useMemo(() => (mounted ? runSecuritySelfTests() : null), [mounted]);
  const backup = useMemo(() => (mounted ? runBackupSelfTests() : null), [mounted]);
  if (!security || !backup) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><h1 className="text-2xl font-semibold tracking-tight">Security self-tests</h1><p className="mt-2 text-sm text-zinc-400">Running…</p></main>;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Security &amp; backup self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">Safe URLs, input limits, redaction, error sanitization, schema compatibility, storage resilience, multi-tab locks, CSP/headers, dev-route exclusion, RLS/ownership audit, threat model, auth boundaries, health, diagnostics sanitization, XSS hardening; export manifest/checksums, verification, import preview, restore safety, recovery.</p>
      </header>
      <Summary id="security-selftest-summary" title="Security" report={security} />
      <Summary id="backup-selftest-summary" title="Backup / export / restore" report={backup} />
    </main>
  );
}
