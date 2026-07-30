"use client";

/**
 * Archive review (LIFEOS-038, Feature 7). Records that look finished. Archiving
 * requires an explicit click, is reversible, and deletes nothing. Also lists
 * what is already archived, with one-click restore.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, archiveRecord, unarchiveRecord } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { archiveCandidates, archivedItems, ARCHIVE_REASON_LABEL } from "@/lib/maintenance/archive";
import { toast } from "@/lib/ux/feedback";

export default function ArchiveReview() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const candidates = useMemo(() => archiveCandidates(state, index), [state, index]);
  const archived = useMemo(() => archivedItems(state, index), [state, index]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Archive review</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Records that look finished. Archiving is a conscious, reversible choice — nothing is deleted, and you can restore any time.</p>
      </header>

      <section className="mb-6">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Candidates</h2>
        {candidates.length === 0 ? <p className="rounded-xl border border-dashed border-black/[.10] p-4 text-sm text-zinc-500 dark:border-white/[.12]" data-empty-candidates>No archive candidates.</p> : (
          <ul className="flex flex-col gap-1.5">
            {candidates.map((c) => {
              const e = entityRef(ctx, c.ref.kind, c.ref.id);
              return (
                <li key={c.id} data-archive-candidate={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.07]">
                  <span className="min-w-0"><Link href={e.href} className="truncate font-medium hover:underline">{c.title || e.title}</Link><span className="ml-2 text-[11px] text-zinc-400">{ARCHIVE_REASON_LABEL[c.reason]}{c.detail ? ` · ${c.detail}` : ""}</span></span>
                  <button type="button" data-archive onClick={() => { archiveRecord(c.ref, c.reason); toast({ kind: "success", message: "Archived" }); }} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Archive</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Archived · {archived.length}</h2>
        {archived.length === 0 ? <p className="rounded-xl border border-dashed border-black/[.10] p-4 text-sm text-zinc-500 dark:border-white/[.12]">Nothing archived yet.</p> : (
          <ul className="flex flex-col gap-1">
            {archived.map((r) => {
              const e = entityRef(ctx, r.kind, r.id);
              return (
                <li key={`${r.kind}:${r.id}`} data-archived={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={e.href} className="min-w-0 truncate text-zinc-500 hover:underline">{e.exists ? e.title : `(missing ${r.kind})`}</Link>
                  <button type="button" data-restore onClick={() => { unarchiveRecord(r); toast({ kind: "success", message: "Restored" }); }} className="shrink-0 text-[11px] text-zinc-400 hover:text-zinc-600">Restore</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
