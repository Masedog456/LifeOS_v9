"use client";

/**
 * Protocols (LIFEOS-054) — conditional intentions you want to remember.
 *
 * Two things this surface deliberately does NOT do:
 *
 *  - **It does not schedule.** There is no cadence control, no next-occurrence,
 *    no reminder. A protocol has a condition, not a frequency; that distinction
 *    is the entire reason it is not a Practice.
 *  - **It does not score.** No streak, no compliance rate, no "you followed this
 *    4 of 7 times". A protocol is a remembered intention, and turning it into a
 *    metric would make the product an auditor of the user's behaviour.
 */

import { useMemo, useState } from "react";
import { useStore, createProtocol, updateProtocol, setProtocolStatus, deleteProtocol } from "@/lib/mvpStore";
import { extractConditional } from "@/lib/capture/classify";
import { toast } from "@/lib/ux/feedback";
import type { Protocol, ProtocolStatus } from "@/types/mvp";

const STATUS_LABEL: Record<ProtocolStatus, string> = { active: "Active", paused: "Paused", retired: "Retired" };

export default function ProtocolsPage({ initialId }: { initialId?: string }) {
  const state = useStore();
  const [trigger, setTrigger] = useState("");
  const [response, setResponse] = useState("");
  const [paste, setPaste] = useState("");
  const [filter, setFilter] = useState<ProtocolStatus | "all">("active");

  const protocols = useMemo(() => {
    const all = (state.protocols ?? []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return filter === "all" ? all : all.filter((p) => p.status === filter);
  }, [state, filter]);

  /** Offer a split of pasted "when X, do Y" text — the user still edits and confirms. */
  const trySplit = (text: string) => {
    const cond = extractConditional(text);
    if (cond) { setTrigger(cond.trigger); setResponse(cond.response); setPaste(""); }
    else toast({ kind: "info", message: "Write it as “when …, …” and it will split itself." });
  };

  const add = () => {
    if (!trigger.trim() || !response.trim()) return;
    createProtocol({ trigger, response });
    setTrigger(""); setResponse("");
    toast({ kind: "success", message: "Protocol saved" });
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Protocols</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Things you want to remember to do <em>when something happens</em> — not on a schedule.
          Nothing here is timed, tracked, or scored; it is written down so you can find it again.
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <div className="flex flex-col gap-2">
          <div>
            <label htmlFor="p-when" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">When / if</label>
            <input id="p-when" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="my child is overwhelmed"
              className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          </div>
          <div>
            <label htmlFor="p-then" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Then</label>
            <input id="p-then" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="give him physical space"
              className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={add} disabled={!trigger.trim() || !response.trim()}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save protocol</button>
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste “when X, do Y” to split it"
              className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1.5 text-xs outline-none dark:border-white/12" />
            <button type="button" onClick={() => trySplit(paste)} disabled={!paste.trim()}
              className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/[.15]">Split</button>
          </div>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["active", "paused", "retired", "all"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${filter === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 dark:border-white/[.12] dark:text-zinc-300"}`}>
            {f === "all" ? "All" : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {protocols.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/[.12] p-6 text-center text-sm text-zinc-500 dark:border-white/[.14]">
          No protocols yet. Try: <em>when I notice myself procrastinating, work for five minutes</em>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {protocols.map((p) => <Row key={p.id} protocol={p} highlight={p.id === initialId} />)}
        </ul>
      )}
    </main>
  );
}

function Row({ protocol, highlight }: { protocol: Protocol; highlight?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(protocol.trigger);
  const [r, setR] = useState(protocol.response);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className={`rounded-xl border p-3 ${highlight ? "border-sky-500/50 bg-sky-500/[.04]" : "border-black/[.08] dark:border-white/[.10]"}`}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <input value={t} onChange={(e) => setT(e.target.value)} aria-label="When" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
          <input value={r} onChange={(e) => setR(e.target.value)} aria-label="Then" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { updateProtocol(protocol.id, { trigger: t, response: r }); setEditing(false); toast({ kind: "success", message: "Saved" }); }}
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save</button>
            <button type="button" onClick={() => { setT(protocol.trigger); setR(protocol.response); setEditing(false); }} className="text-xs text-zinc-500">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-800 dark:text-zinc-100">
            <span className="text-zinc-500">When</span> {protocol.trigger} <span className="text-zinc-500">→</span> {protocol.response}
          </p>
          {protocol.reason && <p className="mt-0.5 text-xs text-zinc-500">{protocol.reason}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-zinc-500 dark:bg-white/[.08]">{STATUS_LABEL[protocol.status]}</span>
            {protocol.fromAiText && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">From AI — kept, not written by you</span>}
            <button type="button" onClick={() => setEditing(true)} className="text-zinc-500 underline underline-offset-2">Edit</button>
            {protocol.status !== "active" && <button type="button" onClick={() => setProtocolStatus(protocol.id, "active")} className="text-zinc-500 underline underline-offset-2">Make active</button>}
            {protocol.status === "active" && <button type="button" onClick={() => setProtocolStatus(protocol.id, "paused")} className="text-zinc-500 underline underline-offset-2">Pause</button>}
            {protocol.status !== "retired" && <button type="button" onClick={() => setProtocolStatus(protocol.id, "retired")} className="text-zinc-500 underline underline-offset-2">Retire</button>}
            {!confirmDelete
              ? <button type="button" onClick={() => setConfirmDelete(true)} className="text-rose-600 underline underline-offset-2 dark:text-rose-400">Delete</button>
              : <span className="flex items-center gap-1"><span className="text-rose-600 dark:text-rose-400">Delete permanently?</span>
                  <button type="button" onClick={() => { deleteProtocol(protocol.id); toast({ kind: "info", message: "Deleted" }); }} className="rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">Yes</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-400">No</button></span>}
          </div>
        </>
      )}
    </li>
  );
}
