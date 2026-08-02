/**
 * Acceptance matrix (LIFEOS-042, Feature 35).
 *
 * Renders every release gate with its verification method and status, honestly
 * distinguishing automated passes from credentialed checks still required.
 * Server component — pure render over lib/release/acceptance.
 */

import { ACCEPTANCE_GATES } from "@/lib/release/acceptance";

const STATUS_STYLE: Record<string, string> = {
  "pass": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "partial": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "manual-required": "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

export default function AcceptanceMatrix() {
  return (
    <section data-acceptance-matrix className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="text-sm font-semibold">Acceptance matrix</h2>
      <p className="mt-1 text-[13px] text-zinc-500">How each release gate is verified. A credentialed gate is never marked an automated pass.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-zinc-500">
            <tr className="border-b border-black/[.06] dark:border-white/[.08]"><th className="py-1.5 pr-3 font-medium">Gate</th><th className="py-1.5 pr-3 font-medium">Method</th><th className="py-1.5 pr-3 font-medium">Status</th></tr>
          </thead>
          <tbody>
            {ACCEPTANCE_GATES.map((g) => (
              <tr key={g.id} className="border-b border-black/[.04] align-top dark:border-white/[.05]">
                <td className="py-1.5 pr-3">{g.title}<div className="text-[11px] text-zinc-400">{g.evidence}</div>{g.manualStep && <div className="text-[11px] text-amber-600 dark:text-amber-400">Manual: {g.manualStep}</div>}</td>
                <td className="py-1.5 pr-3 text-zinc-500">{g.method}</td>
                <td className="py-1.5 pr-3"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[g.status]}`}>{g.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
