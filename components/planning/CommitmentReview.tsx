"use client";

/**
 * Commitment review (LIFEOS-037, Feature 10). Groups everything the user is
 * currently committed to. VIEWING mutates nothing; each per-item control
 * (change horizon / remove from planning / open detail) is an explicit action.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, setPlanningHorizon, removeFromPlanning } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { commitmentGroups, commitmentCount } from "@/lib/planning/commitments";
import { BOARD_COLUMNS, HORIZON_LABEL, isPlannable } from "@/lib/planning/horizon";
import CapacityView from "@/components/planning/CapacityView";
import { toast } from "@/lib/ux/feedback";

export default function CommitmentReview() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const groups = useMemo(() => commitmentGroups(state), [state]);
  const total = commitmentCount(groups);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Commitments</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Everything you&apos;re currently committed to — {total} distinct item{total === 1 ? "" : "s"}. Viewing changes nothing; adjust from here when you choose.</p>
      </header>

      <div className="mb-4"><CapacityView /></div>

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">No active commitments.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.key} data-commitment-group={g.key} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.label} <span className="text-zinc-300 dark:text-zinc-600">· {g.refs.length}</span></h2>
              <ul className="flex flex-col gap-1">
                {g.refs.map((r) => {
                  const e = entityRef(ctx, r.kind, r.id);
                  return (
                    <li key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 text-sm">
                      <Link href={e.href} className="min-w-0 truncate hover:underline">{e.title}</Link>
                      {isPlannable(r.kind) && (
                        <span className="flex shrink-0 items-center gap-1">
                          <select defaultValue="" onChange={(ev) => { if (ev.target.value) { setPlanningHorizon(r, ev.target.value as (typeof BOARD_COLUMNS)[number]); toast({ kind: "success", message: `Moved to ${HORIZON_LABEL[ev.target.value as (typeof BOARD_COLUMNS)[number]]}` }); ev.target.value = ""; } }} aria-label={`Plan ${e.title}`} className="rounded-md border border-black/10 bg-transparent px-1 py-0.5 text-[10px] dark:border-white/12">
                            <option value="">Plan…</option>
                            {BOARD_COLUMNS.filter((h) => h !== "unscheduled").map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
                          </select>
                          <button type="button" onClick={() => { removeFromPlanning(r); toast({ kind: "info", message: "Removed from planning" }); }} aria-label="Remove from planning" className="text-zinc-400 hover:text-rose-500">✕</button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
