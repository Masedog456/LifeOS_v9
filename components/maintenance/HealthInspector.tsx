"use client";

/**
 * Health inspector (LIFEOS-038, Feature 11). The inspector's maintenance
 * surface for one record: health indicators, staleness, review & maintenance
 * history, citation + relationship integrity, archive status, duplicate
 * candidates, and manual maintenance actions. Pure projection; every action is
 * explicit.
 */

import { useMemo } from "react";
import { useStore, reviewRecord, requestReview, archiveRecord, unarchiveRecord } from "@/lib/mvpStore";
import { recordHealth } from "@/lib/maintenance/record";
import { reviewedLabel } from "@/lib/maintenance/staleness";
import { MAINTENANCE_LABEL } from "@/lib/maintenance/history";
import { toast } from "@/lib/ux/feedback";

export default function HealthInspector({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const ref = { kind, id };
  const health = useMemo(() => recordHealth(state, ref), [state, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const issueCount = health.citationIssues.length + health.relationshipIssues.length + health.duplicates.length;

  return (
    <section data-health-inspector>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Maintenance</h3>
      <p className="text-[12px] text-zinc-600 dark:text-zinc-300" data-staleness>{reviewedLabel(health.staleness)}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div><dt className="text-zinc-400">Archive status</dt><dd className="text-zinc-700 dark:text-zinc-200">{health.archived ? "Archived" : "Active"}</dd></div>
        <div><dt className="text-zinc-400">Integrity</dt><dd className="text-zinc-700 dark:text-zinc-200" data-issue-count={issueCount}>{issueCount === 0 ? "No issues" : `${issueCount} issue${issueCount === 1 ? "" : "s"}`}</dd></div>
        {health.duplicates.length > 0 && <div><dt className="text-zinc-400">Duplicates</dt><dd className="text-amber-600 dark:text-amber-400">{health.duplicates.length} candidate{health.duplicates.length === 1 ? "" : "s"}</dd></div>}
        {health.citationIssues.length > 0 && <div><dt className="text-zinc-400">Citations</dt><dd className="text-amber-600 dark:text-amber-400">{health.citationIssues.length} to check</dd></div>}
        {health.relationshipIssues.length > 0 && <div><dt className="text-zinc-400">Relationships</dt><dd className="text-amber-600 dark:text-amber-400">{health.relationshipIssues.length} to check</dd></div>}
      </dl>

      {health.history.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[11px] text-zinc-500" data-maintenance-history>
          {health.history.slice(0, 4).map((e) => (
            <li key={e.id}>{MAINTENANCE_LABEL[e.kind]} · {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" data-review onClick={() => { reviewRecord(ref); toast({ kind: "success", message: "Marked reviewed" }); }} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Mark reviewed</button>
        <button type="button" data-request-review onClick={() => { requestReview(ref); toast({ kind: "info", message: "Flagged for review" }); }} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Flag for review</button>
        {health.archived
          ? <button type="button" data-unarchive onClick={() => { unarchiveRecord(ref); toast({ kind: "success", message: "Restored" }); }} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Restore</button>
          : <button type="button" data-archive onClick={() => { archiveRecord(ref); toast({ kind: "success", message: "Archived" }); }} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Archive</button>}
      </div>
    </section>
  );
}
