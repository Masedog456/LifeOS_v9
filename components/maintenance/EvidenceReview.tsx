"use client";

/**
 * Evidence review (LIFEOS-038, Feature 4 & 10). Beliefs without citations,
 * claims whose citations are gone, research without sources, unreferenced
 * documents, notes without context — plus research-integrity notes. Per-item
 * actions: link evidence, archive, or ignore. No credibility scores.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, archiveRecord, resolveMaintenance } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { evidenceReview, researchIntegrity, EVIDENCE_ISSUE_LABEL, RESEARCH_ISSUE_LABEL } from "@/lib/maintenance/evidence";
import { toast } from "@/lib/ux/feedback";

export default function EvidenceReview() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const issues = useMemo(() => evidenceReview(state, index), [state, index]);
  const research = useMemo(() => researchIntegrity(state, index), [state, index]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Evidence review</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Where evidentiary support may have thinned. No credibility scores — link evidence, archive, or ignore, as you judge.</p>
      </header>

      <section className="mb-6">
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Claims &amp; documents</h2>
        {issues.length === 0 ? <p className="rounded-xl border border-dashed border-black/[.10] p-4 text-sm text-zinc-500 dark:border-white/[.12]" data-empty-evidence>Nothing needs evidence review.</p> : (
          <ul className="flex flex-col gap-1.5">
            {issues.map((i) => {
              const e = entityRef(ctx, i.ref.kind, i.ref.id);
              return (
                <li key={i.id} data-evidence={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.07]">
                  <span className="min-w-0"><Link href={e.href} className="truncate font-medium hover:underline">{e.title}</Link><span className="ml-2 text-[11px] text-zinc-400">{EVIDENCE_ISSUE_LABEL[i.kind]}</span></span>
                  <span className="flex shrink-0 gap-1">
                    <Link href={e.href} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] dark:border-white/[.15]">Link evidence</Link>
                    <button type="button" data-archive onClick={() => { archiveRecord(i.ref); toast({ kind: "success", message: "Archived" }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] dark:border-white/[.15]">Archive</button>
                    <button type="button" data-ignore onClick={() => { resolveMaintenance(i.ref, i.kind); toast({ kind: "info", message: "Ignored" }); }} className="text-[11px] text-zinc-400 hover:text-zinc-600">Ignore</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Research integrity</h2>
        {research.length === 0 ? <p className="rounded-xl border border-dashed border-black/[.10] p-4 text-sm text-zinc-500 dark:border-white/[.12]">All research looks complete.</p> : (
          <ul className="flex flex-col gap-1">
            {research.map((i) => (
              <li key={i.id} data-research={i.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={entityRef(ctx, i.ref.kind, i.ref.id).href} className="min-w-0 truncate hover:underline">{i.title}</Link>
                <span className="shrink-0 text-[11px] text-zinc-400">{RESEARCH_ISSUE_LABEL[i.kind]}{i.detail ? ` · ${i.detail}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
