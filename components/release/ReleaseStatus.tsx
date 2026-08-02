/**
 * Release status summary (LIFEOS-042, Feature 35).
 *
 * A calm, read-only snapshot of the release version identifiers and the
 * deterministic readiness verdict. Honest by construction: it shows the tag as
 * NOT ready while manual credentialed checks remain, and never implies GA.
 * Server component — pure render over the deterministic release model.
 */

import { releaseVersions } from "@/lib/release/versions";
import { gatherEvidence, readinessLine } from "@/lib/release/evidence";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-1.5 text-[13px]"><span className="text-zinc-500">{k}</span><span className="tabular-nums text-zinc-800 dark:text-zinc-100">{v}</span></div>;
}

export default function ReleaseStatus() {
  const v = releaseVersions();
  const e = gatherEvidence(v.migrationCount);
  return (
    <section data-release-status className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="text-sm font-semibold">Release candidate</h2>
      <p className="mt-1 text-[13px] text-zinc-500">Version identifiers and the deterministic readiness verdict. Credentialed checks are tracked separately and gate general availability.</p>
      <div className="mt-3 border-t border-black/[.06] pt-2 dark:border-white/[.08]">
        <Row k="Release tag" v={<span data-release-tag>{v.releaseTag}</span>} />
        <Row k="App version" v={v.appVersion} />
        <Row k="Migration version" v={v.migrationVersion} />
        <Row k="Migration count" v={v.migrationCount} />
        <Row k="Local state version" v={v.stateVersion} />
        <Row k="Export archive version" v={v.exportArchiveVersion} />
        <Row k="Supported migration range" v={v.supportedMigrationRange.join("–")} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${e.deterministicGatesPass ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"}`} data-release-gates>
          Deterministic gates {e.deterministicGatesPass ? "pass" : "fail"}
        </span>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[12px] text-amber-700 dark:text-amber-300" data-release-manual>
          {e.manualChecksRequired} manual checks required
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] ${e.tagReady ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`} data-release-tagready>
          Tag {e.tagReady ? "ready" : "held"}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-zinc-400">{readinessLine(e)}</p>
    </section>
  );
}
