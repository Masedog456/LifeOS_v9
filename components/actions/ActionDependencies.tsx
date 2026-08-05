"use client";

/**
 * Action dependencies (LIFEOS-036, Feature 10). Shows what blocks this action and
 * what it blocks, and lets the user add an explicit "blocked by" edge. Cycles
 * (direct or indirect) and duplicates are rejected with a clear message.
 * Completing a blocker makes the blocked action eligible — it never auto-starts.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, addActionDependency, removeActionDependency, type AddDependencyOutcome } from "@/lib/mvpStore";
import { dependencyNeighbours } from "@/lib/actions/relationships";
import { STATUS_LABEL } from "@/lib/actions/status";
import type { NextAction } from "@/types/mvp";
import { toast } from "@/lib/ux/feedback";

const OUTCOME_MSG: Record<Exclude<AddDependencyOutcome, "ok">, string> = {
  self: "An action can't be its own prerequisite",
  cycle: "That would create a loop — two actions can't each wait on the other",
  duplicate: "That prerequisite is already listed",
};

export default function ActionDependencies({ action }: { action: NextAction }) {
  const state = useStore();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const { blockers, blocked } = useMemo(() => dependencyNeighbours(state, action.id), [state, action.id]);

  const candidates = useMemo(() => {
    const linked = new Set([...blockers, ...blocked].map((a) => a.id));
    const ql = q.trim().toLowerCase();
    return (state.nextActions ?? [])
      .filter((a) => a.id !== action.id && !linked.has(a.id) && a.status !== "cancelled")
      .filter((a) => !ql || a.title.toLowerCase().includes(ql))
      .slice(0, 8);
  }, [state.nextActions, action.id, blockers, blocked, q]);

  const addBlocker = (blockerId: string) => {
    const outcome = addActionDependency(blockerId, action.id);
    if (outcome === "ok") { toast({ kind: "success", message: "Prerequisite added" }); setPicking(false); setQ(""); }
    else toast({ kind: "error", message: OUTCOME_MSG[outcome] });
  };

  // An action is only held up if a prerequisite is still unfinished.
  const pending = blockers.filter((b) => b.status !== "completed" && b.status !== "cancelled");

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Needs before starting</p>
        {blockers.length === 0 ? <p className="text-zinc-500">This action is ready to begin — nothing needs to happen first.</p> : (
          <>
            {pending.length === 0 && <p className="mb-1 text-emerald-600 dark:text-emerald-400">All prerequisites are done — this action is ready to begin.</p>}
            <ul className="flex flex-col gap-1">
              {blockers.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <Link href={`/actions/${b.id}`} className={`truncate ${b.status === "completed" ? "text-zinc-400 line-through" : "text-sky-600 dark:text-sky-400"}`}>{b.title} <span className="text-[10px] text-zinc-400">· {STATUS_LABEL[b.status]}</span></Link>
                  <button type="button" onClick={() => { removeActionDependency(b.id, action.id); toast({ kind: "info", message: "Prerequisite removed" }); }} aria-label={`Remove prerequisite ${b.title}`} className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {blocked.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">This action unlocks</p>
          <ul className="flex flex-col gap-1">{blocked.map((b) => <li key={b.id}><Link href={`/actions/${b.id}`} className="truncate text-sky-600 dark:text-sky-400">{b.title}</Link></li>)}</ul>
        </div>
      )}
      {!picking ? (
        <button type="button" onClick={() => setPicking(true)} className="self-start rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">+ Add a prerequisite</button>
      ) : (
        <div className="rounded-lg border border-black/[.08] p-2 dark:border-white/[.10]">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an action that must come first…" aria-label="Find prerequisite" className="mb-1 w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <ul className="max-h-40 overflow-auto">
            {candidates.length === 0 ? <li className="px-1 py-1 text-[11px] text-zinc-400">No matching actions.</li> : candidates.map((a) => (
              <li key={a.id}><button type="button" onClick={() => addBlocker(a.id)} className="w-full truncate rounded-md px-1.5 py-1 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06]">{a.title}</button></li>
            ))}
          </ul>
          <button type="button" onClick={() => { setPicking(false); setQ(""); }} className="mt-1 text-[11px] text-zinc-400">Cancel</button>
        </div>
      )}
    </div>
  );
}
