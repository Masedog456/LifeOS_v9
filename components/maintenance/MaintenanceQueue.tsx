"use client";

/**
 * Knowledge review queue (LIFEOS-038, Feature 5). One deterministic queue of
 * every maintenance candidate. Filterable by reason (Feature 14). Every action —
 * archive, resolve, review, dismiss — is explicit and recorded; nothing is
 * auto-applied.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useStore, archiveRecord, resolveMaintenance, reviewRecord } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { reviewQueue, REVIEW_REASON_LABEL, type ReviewReason } from "@/lib/maintenance/review";
import { dismissedItems, dismissItem } from "@/lib/maintenance/preferences";
import { toast } from "@/lib/ux/feedback";

const REASONS: ReviewReason[] = ["orphan", "duplicate", "stale", "uncited", "broken", "inactive", "archive_candidate", "relationship_issue", "reference_issue", "review_requested"];

export default function MaintenanceQueue() {
  const state = useStore();
  const search = useSearchParams();
  const reasonFilter = search.get("reason") as ReviewReason | null;
  const [, tick] = useState(0);
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const items = useMemo(() => reviewQueue(state, index, { dismissed: dismissedItems() }), [state, index]);
  const shown = reasonFilter ? items.filter((i) => i.reason === reasonFilter) : items;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Everything that may need a maintenance decision — {items.length} item{items.length === 1 ? "" : "s"}. Nothing here changes on its own.</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5" data-filters>
        <Link href="/maintenance/review" data-filter="all" aria-current={!reasonFilter ? "true" : undefined} className={`rounded-full border px-2.5 py-1 text-[11px] ${!reasonFilter ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>All</Link>
        {REASONS.map((r) => (
          <Link key={r} href={`/maintenance/review?reason=${r}`} data-filter={r} aria-current={reasonFilter === r ? "true" : undefined} className={`rounded-full border px-2.5 py-1 text-[11px] ${reasonFilter === r ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-black/[.12] dark:border-white/[.15]"}`}>{REVIEW_REASON_LABEL[r].split(" —")[0]}</Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-center dark:border-white/[.12]" data-empty>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">You&apos;re all caught up.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">This is where LifeOS gently points out possible duplicates, orphaned links, or records that have gone quiet — always as suggestions, never problems. There&apos;s nothing to look at right now.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((i) => {
            const e = entityRef(ctx, i.ref.kind, i.ref.id);
            return (
              <li key={i.id} data-review-item={i.id} data-reason={i.reason} className="flex items-center justify-between gap-2 rounded-xl border border-black/[.05] px-3 py-2 text-sm dark:border-white/[.07]">
                <span className="min-w-0">
                  <Link href={e.href} className="truncate font-medium hover:underline">{e.exists ? e.title : `(missing ${i.ref.kind})`}</Link>
                  <span className="ml-2 text-[11px] text-zinc-400">{REVIEW_REASON_LABEL[i.reason]}{i.detail ? ` · ${i.detail}` : ""}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {i.actions.includes("review") && <button type="button" data-action="review" onClick={() => { reviewRecord(i.ref, i.reason); toast({ kind: "success", message: "Reviewed" }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] dark:border-white/[.15]">Reviewed</button>}
                  {i.actions.includes("archive") && <button type="button" data-action="archive" onClick={() => { archiveRecord(i.ref, i.reason); toast({ kind: "success", message: "Archived" }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] dark:border-white/[.15]">Archive</button>}
                  {(i.actions.includes("resolve")) && <button type="button" data-action="resolve" onClick={() => { resolveMaintenance(i.ref, i.reason); toast({ kind: "success", message: "Resolved" }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] dark:border-white/[.15]">Resolve</button>}
                  <button type="button" data-action="dismiss" onClick={() => { dismissItem(i.id); tick((t) => t + 1); toast({ kind: "info", message: "Dismissed" }); }} className="text-[11px] text-zinc-400 hover:text-zinc-600">Dismiss</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
