"use client";

/**
 * Planning inbox (LIFEOS-037, Features 11 & 12). Records that may need a manual
 * planning decision. The user chooses whether and where to plan each — nothing
 * is auto-assigned. Active projects with no next action get the safeguard's
 * choices (create / link / leave) without ever being labelled unhealthy.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore, setPlanningHorizon } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { planningInbox, REASON_LABEL } from "@/lib/planning/planning-inbox";
import { BOARD_COLUMNS, HORIZON_LABEL } from "@/lib/planning/horizon";
import { toast } from "@/lib/ux/feedback";

export default function PlanningInbox() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const items = useMemo(() => planningInbox(state), [state]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Planning inbox</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Records that might want a planning decision. You choose whether and where to plan each — nothing is assigned for you.</p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">Nothing needs a planning decision right now.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Planning inbox">
          {items.map((item) => {
            const e = entityRef(ctx, item.ref.kind, item.ref.id);
            return (
              <li key={item.id} data-inbox-item={item.id} data-reason={item.reason} className="flex flex-col gap-1.5 rounded-xl border border-black/[.06] p-3 text-sm dark:border-white/[.08] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {e.exists ? <Link href={e.href} className="truncate font-medium hover:underline">{e.title}</Link> : <span className="truncate text-zinc-500">{e.title} (missing)</span>}
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-zinc-400">
                    <span className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{entityKindLabel(item.ref.kind)}</span>
                    <span>· {REASON_LABEL[item.reason]}{item.detail ? ` · ${item.detail}` : ""}</span>
                  </div>
                </div>
                {item.reason === "project_no_action" ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px]">
                    <span className="text-zinc-500">No next action selected.</span>
                    <Link href={`/project/${item.ref.id}`} className="rounded-full border border-black/[.12] px-2 py-0.5 dark:border-white/[.15]">Create / link</Link>
                  </span>
                ) : (
                  <select defaultValue="" onChange={(ev) => { if (ev.target.value) { setPlanningHorizon(item.ref, ev.target.value as (typeof BOARD_COLUMNS)[number]); toast({ kind: "success", message: `Planned to ${HORIZON_LABEL[ev.target.value as (typeof BOARD_COLUMNS)[number]]}` }); ev.target.value = ""; } }} aria-label={`Plan ${e.title}`} className="shrink-0 rounded-md border border-black/10 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-white/12">
                    <option value="">Plan…</option>
                    {BOARD_COLUMNS.filter((h) => h !== "unscheduled").map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
