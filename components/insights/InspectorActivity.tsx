"use client";

/**
 * Inspector activity (LIFEOS-039, Feature 21). A compact Activity section for the
 * inspector: created / last edited / last opened / last reviewed / last session,
 * sessions + focus in the range, linked activity count, and recent history —
 * plus links to full activity and the change log. Reuses the shared index.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildActivityIndex } from "@/lib/insights/activity";
import { recordActivity } from "@/lib/insights/relationships";
import { eventTypeLabel } from "@/lib/insights/change-log";
import { formatDuration } from "@/lib/insights/metrics";
import { relativeTime } from "@/lib/entities/timeline";
import { resolveRange } from "@/lib/insights/range";

function fmt(iso?: string): string { return iso ? relativeTime(iso) : "—"; }

export default function InspectorActivity({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const index = useMemo(() => buildActivityIndex(state), [state]);
  const range = resolveRange("last_30_days");
  const a = useMemo(() => recordActivity(index, { kind, id }, range), [index, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section data-inspector-activity>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Activity</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div><dt className="text-zinc-400">Created</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(a.created)}</dd></div>
        <div><dt className="text-zinc-400">Last edited</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(a.lastEdited)}</dd></div>
        {a.lastOpened && <div><dt className="text-zinc-400">Last opened</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(a.lastOpened)}</dd></div>}
        {a.lastReviewed && <div><dt className="text-zinc-400">Last reviewed</dt><dd className="text-zinc-700 dark:text-zinc-200">{fmt(a.lastReviewed)}</dd></div>}
        <div><dt className="text-zinc-400">Sessions (30d)</dt><dd className="text-zinc-700 dark:text-zinc-200" data-sessions-in-range={a.sessionsInRange}>{a.sessionsInRange}</dd></div>
        <div><dt className="text-zinc-400">Focus (30d)</dt><dd className="text-zinc-700 dark:text-zinc-200">{formatDuration(a.focusMs)}</dd></div>
        <div className="col-span-2"><dt className="text-zinc-400">Linked activity</dt><dd className="text-zinc-700 dark:text-zinc-200" data-linked-count={a.linkedActivityCount}>{a.linkedActivityCount} event{a.linkedActivityCount === 1 ? "" : "s"} in 30 days</dd></div>
      </dl>
      {a.recentHistory.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-zinc-500" data-recent-history>
          {a.recentHistory.slice(0, 4).map((e, i) => <li key={`${e.at}:${i}`}>{eventTypeLabel(e.type)} · {relativeTime(e.at)}</li>)}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <Link href={`/insights/change-log`} className="rounded-full border border-black/[.12] px-2.5 py-1 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Open change log</Link>
        <Link href={`/insights`} className="rounded-full border border-black/[.12] px-2.5 py-1 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Open full activity</Link>
      </div>
    </section>
  );
}
