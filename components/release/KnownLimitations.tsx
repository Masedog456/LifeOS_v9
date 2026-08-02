/**
 * Known limitations (LIFEOS-042, Feature 27).
 *
 * Renders the canonical limitations list with impact + workaround + blocker
 * classification. Server component — pure render over lib/release/limitations.
 */

import { LIMITATIONS } from "@/lib/release/limitations";

export default function KnownLimitations() {
  return (
    <section data-known-limitations className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="text-sm font-semibold">Known limitations</h2>
      <p className="mt-1 text-[13px] text-zinc-500">What Version 1 does not do, and how to work around it. None of these block the release candidate.</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {LIMITATIONS.map((l) => (
          <li key={l.id} className="text-[13px]">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">{l.summary}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${l.blocking ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-zinc-500/10 text-zinc-500"}`}>{l.blocking ? "blocking" : "non-blocking"}</span>
            </div>
            <div className="text-zinc-500"><span className="text-zinc-400">Impact:</span> {l.impact} <span className="text-zinc-400">· Workaround:</span> {l.workaround}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
