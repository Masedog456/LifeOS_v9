"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { MegathreadStatus, ThreadMemberType } from "@/types/mvp";
import {
  addThreadMember,
  addThreadQuestion,
  excludeThreadItem,
  megathreadById,
  removeThreadMember,
  setThreadFields,
  setThreadSynthesis,
  setThreadStatus,
  toggleThreadPin,
  toggleThreadQuestion,
  useStore,
} from "@/lib/mvpStore";
import { buildTimeline } from "@/lib/megathread/timeline";
import { candidateMembers, resolveMember } from "@/lib/megathread/membership";
import { estimateThreadSynthesis, runThreadSynthesis } from "@/lib/megathread/run";
import { threadDeps } from "@/lib/freshness/fingerprint";
import ThreadTimeline from "@/components/ThreadTimeline";
import ThreadSynthesis from "@/components/ThreadSynthesis";
import FreshnessBadge from "@/components/FreshnessBadge";

const STATUSES: MegathreadStatus[] = ["active", "dormant", "archived"];
const MEMBER_GROUPS: { type: ThreadMemberType; label: string }[] = [
  { type: "source", label: "Sources" },
  { type: "belief", label: "Beliefs" },
  { type: "comparison", label: "Comparisons" },
  { type: "inquiry", label: "Inquiries" },
  { type: "capture", label: "Captures" },
  { type: "proposal", label: "Proposals" },
];

export default function ThreadDetailPage() {
  const params = useParams<{ id: string }>();
  const state = useStore();
  const thread = megathreadById(state, params.id);

  const [editingMeta, setEditingMeta] = useState(false);
  const [title, setTitle] = useState(thread?.title ?? "");
  const [description, setDescription] = useState(thread?.description ?? "");
  const [notes, setNotes] = useState(thread?.notes ?? "");
  const [understanding, setUnderstanding] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [showCandidates, setShowCandidates] = useState(false);

  const timeline = useMemo(() => (thread ? buildTimeline(state, thread) : []), [state, thread]);
  const candidates = useMemo(
    () => (thread && showCandidates ? candidateMembers(state, thread) : []),
    [state, thread, showCandidates],
  );
  const est = useMemo(() => (thread ? estimateThreadSynthesis(state, thread) : null), [state, thread]);

  if (!thread) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Megathread not found.</p>
        <Link href="/threads" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Megathreads</Link>
      </main>
    );
  }

  async function regenerate() {
    if (!thread) return;
    setRegenerating(true);
    try {
      const { synthesis, evidence, source } = await runThreadSynthesis(state, thread);
      setThreadSynthesis(thread.id, synthesis, source, evidence);
    } finally {
      setRegenerating(false);
    }
  }

  function saveUnderstanding() {
    if (!thread?.synthesis) return;
    setThreadSynthesis(thread.id, { ...thread.synthesis, currentUnderstanding: understanding.trim() }, "user", thread.synthesisEvidence);
    setRewriting(false);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/threads" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Megathreads</Link>
        <div className="flex items-center gap-4">
          <Link
            href={`/reason?mode=unresolved_synthesis&thread=${thread.id}&q=${encodeURIComponent(`What is unresolved across ${thread.title}?`)}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Reason across this thread →
          </Link>
          <Link
            href={`/decisions?thread=${thread.id}&title=${encodeURIComponent(thread.title)}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Use in a decision →
          </Link>
          <Link
            href={`/formation?thread=${thread.id}&type=open`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Reflect on this thread →
          </Link>
          <Link
            href={`/world?tab=Concepts&name=${encodeURIComponent(thread.title.slice(0, 40))}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Model as a concept →
          </Link>
          <Link
            href={`/dialogue?thread=${thread.id}&topic=${encodeURIComponent(thread.title)}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Investigate in dialogue →
          </Link>
          <Link
            href={`/author?thread=${thread.id}&title=${encodeURIComponent(thread.title)}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Write from this thread →
          </Link>
          <Link
            href={`/research?thread=${thread.id}&title=${encodeURIComponent(thread.title)}`}
            className="text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Investigate this thread →
          </Link>
        </div>
      </div>

      {/* Title / description */}
      <header className="mt-4 mb-8">
        {editingMeta ? (
          <div className="flex flex-col gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-lg font-semibold outline-none dark:border-white/[.15]" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setThreadFields(thread.id, { title: title.trim() || thread.title, description }); setEditingMeta(false); }} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save</button>
              <button type="button" onClick={() => setEditingMeta(false)} className="rounded-full px-4 py-1.5 text-sm text-zinc-400">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{thread.title}</h1>
              <button type="button" onClick={() => { setTitle(thread.title); setDescription(thread.description ?? ""); setEditingMeta(true); }} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Edit</button>
            </div>
            {thread.description && <p className="mt-1 text-sm text-zinc-500">{thread.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span>Status:</span>
              {STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => setThreadStatus(thread.id, s)} className={`rounded-full px-2.5 py-0.5 transition-colors ${thread.status === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] hover:text-zinc-900 dark:border-white/[.12] dark:hover:text-zinc-100"}`}>{s}</button>
              ))}
            </div>
          </>
        )}
      </header>

      {/* Synthesis */}
      <section className="mb-10">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Synthesis</h2>
          <button type="button" onClick={regenerate} disabled={regenerating} className="rounded-full border border-black/[.12] px-3 py-1 text-xs hover:bg-black/[.04] disabled:opacity-40 dark:border-white/[.15] dark:hover:bg-white/[.06]">
            {regenerating ? "Regenerating…" : thread.synthesis ? "Regenerate" : `Generate (~${est?.calls ?? 1} AI call)`}
          </button>
        </div>
        {est?.partial && <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">⚠︎ {est.coverageNote}</p>}
        {thread.synthesis && (
          <div className="mb-3">
            <FreshnessBadge
              state={state}
              fingerprint={thread.fingerprint}
              currentIds={threadDeps(thread)}
              approxAiCalls={est?.calls ?? 1}
              onRerun={regenerate}
            />
          </div>
        )}
        {thread.synthesis ? (
          <>
            <ThreadSynthesis thread={thread} />
            <div className="mt-3">
              {rewriting ? (
                <div>
                  <textarea value={understanding} onChange={(e) => setUnderstanding(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.15]" />
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={saveUnderstanding} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save my wording</button>
                    <button type="button" onClick={() => setRewriting(false)} className="rounded-full px-4 py-1.5 text-xs text-zinc-400">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => { setUnderstanding(thread.synthesis?.currentUnderstanding ?? ""); setRewriting(true); }} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Rewrite the current understanding in your words →</button>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-400">No synthesis yet. Generate one from the thread&apos;s members — it cites only existing evidence and never changes your beliefs.</p>
        )}
      </section>

      {/* Timeline — central */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Timeline</h2>
        <ThreadTimeline items={timeline} />
      </section>

      {/* Unresolved questions */}
      <section className="mb-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Unresolved questions</h2>
        {thread.unresolvedQuestions.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1.5">
            {thread.unresolvedQuestions.map((q, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.resolved} onChange={() => toggleThreadQuestion(thread.id, i)} />
                <span className={q.resolved ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-200"}>{q.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Add an open question…" className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/[.12]" />
          <button type="button" onClick={() => { addThreadQuestion(thread.id, newQuestion); setNewQuestion(""); }} disabled={!newQuestion.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-40 dark:border-white/[.15]">Add</button>
        </div>
      </section>

      {/* Members */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Members</h2>
        {MEMBER_GROUPS.map(({ type, label }) => {
          const members = thread.members.filter((m) => m.type === type);
          if (members.length === 0) return null;
          return (
            <div key={type} className="mb-4">
              <h3 className="mb-1 text-xs font-medium text-zinc-400">{label}</h3>
              <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                {members.map((m) => {
                  const resolved = resolveMember(state, m);
                  const pinned = thread.pinned.includes(m.id);
                  return (
                    <li key={`${m.type}:${m.id}`} className="flex items-start gap-2 py-2">
                      <span className="flex-1">
                        {resolved?.href ? (
                          <Link href={resolved.href} className="text-sm text-zinc-800 hover:underline dark:text-zinc-200">{resolved.label}</Link>
                        ) : (
                          <span className="text-sm text-zinc-800 dark:text-zinc-200">{resolved?.label ?? m.id}</span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-zinc-400">
                          {m.addedBy === "auto" ? "auto" : "you added"}{m.reason ? ` · ${m.reason}` : ""}
                        </span>
                      </span>
                      <button type="button" onClick={() => toggleThreadPin(thread.id, m.id)} title="Pin/feature" className={`shrink-0 text-xs ${pinned ? "text-amber-500" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>{pinned ? "★" : "☆"}</button>
                      <button type="button" onClick={() => removeThreadMember(thread.id, m.type, m.id)} title="Remove" className="shrink-0 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">remove</button>
                      <button type="button" onClick={() => excludeThreadItem(thread.id, m.id)} title="Exclude (never re-suggest)" className="shrink-0 text-xs text-zinc-400 hover:text-red-500">exclude</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {/* Candidate members */}
        <button type="button" onClick={() => setShowCandidates((v) => !v)} className="mt-2 text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          {showCandidates ? "Hide" : "Suggest"} candidate members
        </button>
        {showCandidates && (
          <div className="mt-2">
            {candidates.length === 0 ? (
              <p className="text-sm text-zinc-400">Nothing to suggest here yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
                {candidates.map((c) => (
                  <li key={`${c.ref.type}:${c.ref.id}`} className="flex items-start gap-2 py-2">
                    <span className="flex-1">
                      <span className="text-sm text-zinc-800 dark:text-zinc-200">{c.label}</span>
                      <span className="mt-0.5 block text-[11px] text-zinc-400">{c.ref.type} · {c.reason}</span>
                    </span>
                    <button type="button" onClick={() => addThreadMember(thread.id, c.ref)} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Add</button>
                    <button type="button" onClick={() => excludeThreadItem(thread.id, c.ref.id)} className="shrink-0 text-xs text-zinc-400 hover:text-red-500">exclude</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="mb-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Thread notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => setThreadFields(thread.id, { notes })}
          rows={3}
          placeholder="Your notes on this thread…"
          className="w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-3 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]"
        />
      </section>
    </main>
  );
}
