"use client";

/**
 * Inspector planning block (LIFEOS-037, Feature 18). Shows a record's horizon,
 * manual order, Today membership, planning + focus history counts, and actions
 * (Move to Today/This Week/Later/Someday · Remove from planning · Start Focus).
 * Reuses the shared entity system; only shown for plannable kinds.
 */

import Link from "next/link";
import { useStore, setPlanningHorizon, removeFromPlanning } from "@/lib/mvpStore";
import { planningInfoFor, focusHistoryFor } from "@/lib/planning/relationships";
import { isPlannable, HORIZON_LABEL, BOARD_COLUMNS } from "@/lib/planning/horizon";
import { toast } from "@/lib/ux/feedback";
import type { FocusTargetKind } from "@/types/mvp";

const KIND_TO_FOCUS: Record<string, FocusTargetKind> = { action: "action", milestone: "milestone", project: "project", document: "document", workspace: "workspace" };

export default function InspectorPlanning({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const ref = { kind, id };
  const info = planningInfoFor(state, ref);
  const focusCount = focusHistoryFor(state, ref).length;
  if (!isPlannable(kind)) return null;

  const focusKind = KIND_TO_FOCUS[kind] ?? "entity";

  return (
    <section aria-label="Planning" data-inspector-planning>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Planning</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div><dt className="text-zinc-400">Horizon</dt><dd className="text-zinc-700 dark:text-zinc-200" data-horizon={info.horizon}>{HORIZON_LABEL[info.horizon]}</dd></div>
        {info.planned && <div><dt className="text-zinc-400">Order</dt><dd className="text-zinc-700 dark:text-zinc-200">{info.order}</dd></div>}
        <div><dt className="text-zinc-400">In Today plan</dt><dd className="text-zinc-700 dark:text-zinc-200">{info.inTodayPlan ? "Yes" : "No"}</dd></div>
        <div><dt className="text-zinc-400">Focus sessions</dt><dd className="text-zinc-700 dark:text-zinc-200">{focusCount}</dd></div>
        {info.history.length > 0 && <div><dt className="text-zinc-400">Plan history</dt><dd className="text-zinc-700 dark:text-zinc-200">{info.history.length}</dd></div>}
      </dl>
      <div className="mt-2 flex flex-wrap gap-1">
        {BOARD_COLUMNS.filter((h) => h !== "unscheduled" && h !== info.horizon).map((h) => (
          <button key={h} type="button" data-plan-move={h} onClick={() => { setPlanningHorizon(ref, h); toast({ kind: "success", message: `Moved to ${HORIZON_LABEL[h]}` }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">→ {HORIZON_LABEL[h]}</button>
        ))}
        {info.planned && <button type="button" onClick={() => { removeFromPlanning(ref); toast({ kind: "info", message: "Removed from planning" }); }} className="rounded-full border border-black/[.12] px-2 py-0.5 text-[10px] text-zinc-500 dark:border-white/[.15]">Unplan</button>}
        <Link href={`/focus?kind=${focusKind}&id=${id}`} className="rounded-full border border-sky-500/40 px-2 py-0.5 text-[10px] text-sky-600 dark:text-sky-400">◉ Focus</Link>
      </div>
    </section>
  );
}
