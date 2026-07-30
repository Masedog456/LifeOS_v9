"use client";

/**
 * Planning integration (LIFEOS-038, Feature 15). A compact, non-intrusive hint
 * on the planning board exposing maintenance candidates — archive candidates,
 * inactive projects, and the review-queue size. It only LINKS to maintenance;
 * it NEVER moves a card or changes a plan automatically.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { archiveCandidates } from "@/lib/maintenance/archive";
import { inactiveProjects, reviewQueueCount } from "@/lib/maintenance/review";

export default function PlanningMaintenanceHint() {
  const state = useStore();
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const archive = useMemo(() => archiveCandidates(state, index).length, [state, index]);
  const inactive = useMemo(() => inactiveProjects(state, index).length, [state, index]);
  const review = useMemo(() => reviewQueueCount(state, index), [state, index]);

  if (archive === 0 && inactive === 0 && review === 0) return null;

  return (
    <div data-maintenance-hint className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-black/[.06] px-3 py-2 text-[11px] text-zinc-500 dark:border-white/[.08]">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">Maintenance:</span>
      {review > 0 && <Link href="/maintenance/review" className="hover:underline">{review} to review</Link>}
      {inactive > 0 && <Link href="/maintenance/review?reason=inactive" className="hover:underline">· {inactive} inactive project{inactive === 1 ? "" : "s"}</Link>}
      {archive > 0 && <Link href="/maintenance/archive" className="hover:underline">· {archive} archive candidate{archive === 1 ? "" : "s"}</Link>}
      <span className="text-zinc-400">— nothing here moves your plan.</span>
    </div>
  );
}
