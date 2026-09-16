"use client";

/**
 * Billing self-tests (LIFEOS-BILLING §25) — developer route.
 *
 * Runs `lib/billing/selftest.ts` and publishes a machine-readable summary at
 * `#billing-selftest-summary`, matching the convention the other dev test
 * pages use so the route smoke can read it.
 *
 * Only the PURE layer runs here. Nothing on this page can reach the Stripe
 * secret or the privileged database connection: those modules carry
 * `import "server-only"`, which makes importing them from a client component a
 * build error. The route behaviour is proved by
 * `scripts/inject-billing-routes.cjs`.
 */

import { useMemo, useSyncExternalStore } from "react";
import { runBillingSelfTests } from "@/lib/billing/selftest";

export default function BillingTestsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const report = useMemo(() => (mounted ? runBillingSelfTests() : null), [mounted]);

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Billing self-tests</h1>
        <p className="mt-2 text-sm text-zinc-400">Running…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing self-tests</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Plan mapping, the entitlement predicate across every Stripe status, the Stripe→canonical projection,
          webhook event routing, and the access-gate policy including its loop-freedom.
        </p>
      </header>

      <div
        id="billing-selftest-summary"
        data-pass={report.pass ? "true" : "false"}
        data-total={report.total}
        data-passed={report.passed}
        data-failed={report.failed}
        className={`mb-4 rounded-2xl border p-4 text-sm ${report.pass ? "border-emerald-500/40 bg-emerald-500/[.06]" : "border-rose-500/40 bg-rose-500/[.06]"}`}
      >
        <p className="font-medium">{report.pass ? "✓ All tests pass" : "✗ Some tests failed"}</p>
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
