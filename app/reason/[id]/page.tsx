"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { ReasoningStatus } from "@/types/mvp";
import {
  attachReasoningToThread,
  getStoreSnapshot,
  reasoningById,
  setInquiryStatus,
  setReasoningConclusion,
  setReasoningStatus,
  updateReasoning,
  useStore,
} from "@/lib/mvpStore";
import { rerunReasoning } from "@/lib/reasoning/run";
import { reasoningDeps } from "@/lib/freshness/fingerprint";
import ReasoningResult from "@/components/ReasoningResult";
import FreshnessBadge from "@/components/FreshnessBadge";

const STATUSES: ReasoningStatus[] = ["open", "provisional", "resolved"];

export default function ReasoningDetailPage() {
  const params = useParams<{ id: string }>();
  const state = useStore();
  const query = reasoningById(state, params.id);

  const [conclusion, setConclusion] = useState(query?.provisionalConclusion ?? "");
  const [rerunning, setRerunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [attachTo, setAttachTo] = useState("");
  const [attached, setAttached] = useState<string | null>(null);

  // Inquiries referenced by this reasoning, that could be reopened.
  const reopenable = useMemo(() => {
    if (!query) return [];
    const ids = new Set(query.evidence.map((e) => e.id));
    return state.inquiries.filter((i) => ids.has(i.id) && i.status !== "open");
  }, [query, state.inquiries]);

  if (!query) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Reasoning session not found.</p>
        <Link href="/reason" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Reason</Link>
      </main>
    );
  }

  async function rerun() {
    if (!query) return;
    setRerunning(true);
    try {
      const next = await rerunReasoning(getStoreSnapshot(), query);
      updateReasoning(next);
    } finally {
      setRerunning(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/reason" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Reason</Link>
        <div className="flex items-center gap-4">
          <Link
            href={`/decisions?reasoning=${query.id}&q=${encodeURIComponent(query.question.slice(0, 120))}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Turn into a decision →
          </Link>
          <button type="button" onClick={rerun} disabled={rerunning} className="text-sm text-zinc-500 underline-offset-4 hover:underline disabled:opacity-40">
            {rerunning ? "Re-running…" : "Re-run (keeps history) →"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <FreshnessBadge
          state={state}
          fingerprint={query.fingerprint}
          currentIds={reasoningDeps(query)}
          approxAiCalls={query.verified ? 2 : 1}
          onRerun={async () => {
            const next = await rerunReasoning(getStoreSnapshot(), query);
            updateReasoning(next);
          }}
        />
      </div>

      <div className="mt-4">
        <ReasoningResult query={query} />
      </div>

      {/* Provisional conclusion + status */}
      <section className="mt-10 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Your provisional conclusion</h2>
        <p className="mt-1 text-xs text-zinc-400">Where you land, in your own words. This never changes your beliefs automatically.</p>
        <textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} rows={3} placeholder="For now, I think…"
          className="mt-3 w-full resize-none rounded-lg border border-black/[.12] bg-transparent p-3 text-sm outline-none focus:border-black/[.25] dark:border-white/[.15] dark:focus:border-white/[.30]" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setReasoningConclusion(query.id, conclusion, "provisional")} disabled={!conclusion.trim()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Save conclusion</button>
          <span className="text-xs text-zinc-400">Status:</span>
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setReasoningStatus(query.id, s)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${query.status === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-500 hover:text-zinc-900 dark:border-white/[.12] dark:hover:text-zinc-100"}`}>{s}</button>
          ))}
        </div>
      </section>

      {/* Reopen inquiries + attach to a Megathread */}
      <section className="mt-6 flex flex-col gap-4">
        {reopenable.length > 0 && (
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Reopen an inquiry</h2>
            <ul className="flex flex-col gap-1.5">
              {reopenable.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{i.question}</span>
                  <button type="button" onClick={() => setInquiryStatus(i.id, "open")} className="shrink-0 rounded-full border border-black/[.12] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Reopen</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.megathreads.length > 0 && (
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Attach this result to a Megathread</h2>
            <div className="flex items-center gap-2">
              <select value={attachTo} onChange={(e) => setAttachTo(e.target.value)} className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]">
                <option value="">— choose a thread —</option>
                {state.megathreads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <button type="button" disabled={!attachTo} onClick={() => { attachReasoningToThread(query.id, attachTo); setAttached(attachTo); }}
                className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/[.15]">Attach</button>
            </div>
            {attached && <p className="mt-1 text-xs text-zinc-400">Attached — a note was added to the thread.</p>}
          </div>
        )}
      </section>

      {/* Append-only history */}
      {query.history.length > 0 && (
        <section className="mt-8 border-t border-black/[.05] pt-6 dark:border-white/[.06]">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            {showHistory ? "Hide" : "Show"} prior runs ({query.history.length})
          </button>
          {showHistory && (
            <div className="mt-3 flex flex-col gap-4">
              {[...query.history].reverse().map((h, i) => (
                <div key={i} className="rounded-xl border border-black/[.06] p-4 text-sm dark:border-white/[.08]">
                  <p className="text-xs text-zinc-400">{new Date(h.at).toLocaleString()} · {h.source === "ai" ? "AI" : "mock"}{h.scopeChanged ? " · scope changed" : ""}</p>
                  {h.result.keyFindings.slice(0, 3).map((f, j) => <p key={j} className="mt-1 text-zinc-700 dark:text-zinc-300">• {f.statement}</p>)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
