"use client";

/**
 * Citation integrity (LIFEOS-038, Feature 9). Duplicate citations, missing /
 * deleted targets, invalid owners — with a real repair: remove the broken
 * citation. Never fabricates a citation, never repairs automatically.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, removeCitation } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { citationIssues, CITATION_ISSUE_LABEL } from "@/lib/maintenance/citations";
import { toast } from "@/lib/ux/feedback";

export default function CitationIntegrity() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const issues = useMemo(() => citationIssues(state, index), [state, index]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Citation integrity</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Duplicate, broken, and orphaned citations. Removing a broken citation never touches the underlying document or belief.</p>
      </header>

      {issues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No citation issues.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {issues.map((i) => {
            const owner = entityRef(ctx, i.owner.kind, i.owner.id);
            return (
              <li key={i.id} data-citation-issue={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.07]">
                <span className="min-w-0">
                  <Link href={owner.href} className="truncate font-medium hover:underline">{owner.exists ? owner.title : `(missing ${i.owner.kind})`}</Link>
                  <span className="ml-2 text-[11px] text-zinc-400">{CITATION_ISSUE_LABEL[i.kind]}{i.detail ? ` · ${i.detail}` : ""}</span>
                </span>
                {i.repairs.includes("remove") && (
                  <button type="button" data-remove-citation={i.citationId} onClick={() => { removeCitation(i.citationId); toast({ kind: "success", message: "Citation removed" }); }} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Remove citation</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
