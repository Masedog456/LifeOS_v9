/**
 * Release status surface (LIFEOS-042).
 *
 * A production-safe, read-only view of the Version 1 release candidate: version
 * identifiers + deterministic readiness, the acceptance matrix (honest about
 * credentialed checks), known limitations, reproducible evidence commands, the
 * production smoke-test guide, and an optional demo workspace. No private data.
 */

import ReleaseStatus from "@/components/release/ReleaseStatus";
import AcceptanceMatrix from "@/components/release/AcceptanceMatrix";
import KnownLimitations from "@/components/release/KnownLimitations";
import ReleaseEvidence from "@/components/release/ReleaseEvidence";
import SmokeTestGuide from "@/components/release/SmokeTestGuide";
import DemoWorkspace from "@/components/release/DemoWorkspace";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function ReleasePage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Release candidate</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Version 1 readiness — versions, acceptance gates, limitations, evidence, and the manual smoke test. Deterministic and sanitized; no record contents.</p>
      </header>
      <SecurityErrorBoundary surface="release">
        <div className="flex flex-col gap-5">
          <ReleaseStatus />
          <AcceptanceMatrix />
          <ReleaseEvidence />
          <KnownLimitations />
          <SmokeTestGuide />
          <DemoWorkspace />
        </div>
      </SecurityErrorBoundary>
    </main>
  );
}
