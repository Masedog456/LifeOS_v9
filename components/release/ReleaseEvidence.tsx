/**
 * Release evidence summary (LIFEOS-042, Feature 35).
 *
 * Lists the deterministic evidence sources (audits/scripts) and the resolved
 * inventory counts. Points to where the automated proof lives — it does not
 * fabricate results. Server component.
 */

import { buildInventory } from "@/lib/release/inventory";
import { manualChecksStillRequired } from "@/lib/release/acceptance";

const EVIDENCE_COMMANDS: readonly { label: string; cmd: string }[] = [
  { label: "Release audit (schema/version/inventory)", cmd: "npm run release:audit" },
  { label: "Migration rehearsal (Postgres 0001→0031)", cmd: "npm run release:migrations" },
  { label: "Export/restore verification", cmd: "npm run release:export" },
  { label: "Release checklist", cmd: "npm run release:checklist" },
  { label: "Security (rls+secrets+routes+deps)", cmd: "npm run audit:security" },
  { label: "Route smoke (running build)", cmd: "npm run release:routes" },
  { label: "Visual regression (running build)", cmd: "npm run release:visual" },
  { label: "Browser matrix (chromium)", cmd: "npm run release:browsers" },
];

export default function ReleaseEvidence() {
  const inv = buildInventory();
  const manual = manualChecksStillRequired();
  return (
    <section data-release-evidence className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="text-sm font-semibold">Release evidence</h2>
      <p className="mt-1 text-[13px] text-zinc-500">Reproducible commands that produce the evidence. No claim exceeds what these prove.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
        <div><div className="text-2xl font-semibold tabular-nums">{inv.routeCount}</div><div className="text-zinc-500">routes</div></div>
        <div><div className="text-2xl font-semibold tabular-nums">{inv.dataDomainCount}</div><div className="text-zinc-500">data domains</div></div>
        <div><div className="text-2xl font-semibold tabular-nums">{inv.migrationCount}</div><div className="text-zinc-500">migrations</div></div>
        <div><div className="text-2xl font-semibold tabular-nums">54</div><div className="text-zinc-500">RLS tables</div></div>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
        {EVIDENCE_COMMANDS.map((e) => (
          <li key={e.cmd} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="text-zinc-600 dark:text-zinc-300">{e.label}</span>
            <code className="rounded bg-black/[.04] px-1.5 py-0.5 text-[12px] dark:bg-white/[.06]">{e.cmd}</code>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Manual, credentialed checks still required ({manual.length})</p>
        <ul className="mt-1 list-disc pl-5 text-[12px] text-zinc-500">
          {manual.map((m) => <li key={m.id}>{m.title}</li>)}
        </ul>
      </div>
    </section>
  );
}
