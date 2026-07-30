"use client";

/**
 * Duplicate review (LIFEOS-038, Feature 2). Deterministic duplicate CANDIDATES.
 * The user chooses: merge into a chosen primary, or ignore. Never auto-merges.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, ignoreDuplicate, mergeRecords } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { duplicateCandidates, DUPLICATE_REASON_LABEL } from "@/lib/maintenance/duplicates";
import { toast } from "@/lib/ux/feedback";

export default function DuplicateReview() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const candidates = useMemo(() => duplicateCandidates(state, index), [state, index]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Duplicate candidates</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Records that share an exact signal — same title, URL, identifier, or alias. Nothing is merged automatically; choose a record to keep, or ignore the group.</p>
      </header>

      {candidates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No duplicate candidates.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {candidates.map((c) => (
            <section key={c.id} data-duplicate={c.id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{DUPLICATE_REASON_LABEL[c.reason]} · <span className="text-zinc-400">{c.key}</span></p>
              <ul className="flex flex-col gap-1.5">
                {c.members.map((m) => {
                  const e = entityRef(ctx, m.kind, m.id);
                  return (
                    <li key={`${m.kind}:${m.id}`} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={e.href} className="min-w-0 truncate hover:underline">{e.title}</Link>
                      <button type="button" data-merge-into={`${m.kind}:${m.id}`} onClick={() => { mergeRecords(m, c.members.filter((x) => x.id !== m.id || x.kind !== m.kind), c); toast({ kind: "success", message: "Merged — losers archived, evidence preserved" }); }} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Keep this, merge rest</button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex justify-end">
                <button type="button" data-ignore onClick={() => { ignoreDuplicate(c); toast({ kind: "info", message: "Duplicate ignored" }); }} className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Not a duplicate — ignore</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
