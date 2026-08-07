"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormationSession, FormationSessionStatus } from "@/types/mvp";
import {
  attachFormationToThread,
  formationSessionById,
  getStoreSnapshot,
  sendToInbox,
  setFormationFields,
  setFormationReflection,
  setFormationStatus,
  setFormationSynthesis,
  useStore,
} from "@/lib/mvpStore";
import { estimateFormationSynthesis, runFormationSynthesis } from "@/lib/formation/sessionRun";
import { SESSION_TYPE_LABEL } from "@/lib/formation/prompts";
import { formationDeps } from "@/lib/freshness/fingerprint";
import FormationSynthesisView from "@/components/FormationSynthesisView";
import FreshnessBadge from "@/components/FreshnessBadge";

const STATUSES: FormationSessionStatus[] = ["draft", "reflecting", "synthesized", "closed"];

function snippet(s: string, n = 44): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** A small editor for a user-authored list field (one item per line). */
function ListField({
  label, hint, values, onSave,
}: {
  label: string;
  hint?: string;
  values: string[];
  onSave: (next: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values.join("\n"));

  function save() {
    onSave(draft.split("\n").map((s) => s.trim()).filter(Boolean));
    setEditing(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</h3>
        {!editing && (
          <button type="button" onClick={() => { setDraft(values.join("\n")); setEditing(true); }} className="text-[11px] text-zinc-400 underline-offset-4 hover:underline">
            {values.length ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {hint && !editing && values.length === 0 && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
      {editing ? (
        <div className="mt-1.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus placeholder="One per line…" className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.15]" />
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={save} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-full px-4 py-1.5 text-xs text-zinc-400">Cancel</button>
          </div>
        </div>
      ) : values.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-sm text-zinc-700 dark:text-zinc-300">{values.map((v, i) => <li key={i} className="mb-0.5">{v}</li>)}</ul>
      ) : null}
    </div>
  );
}

export default function FormationSessionPage() {
  const { id } = useParams<{ id: string }>();
  const state = useStore();
  const session = useMemo(() => formationSessionById(state, id), [state, id]);

  const [reflectionDraft, setReflectionDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState("");

  const est = useMemo(() => (session ? estimateFormationSynthesis(state, session) : null), [state, session]);

  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Reflection not found.</p>
        <Link href="/formation" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Reflect</Link>
      </main>
    );
  }

  const s: FormationSession = session;

  function saveReflection() {
    if (!reflectionDraft.trim()) return;
    setFormationReflection(s.id, reflectionDraft);
    setReflectionDraft("");
  }

  async function synthesize() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await runFormationSynthesis(getStoreSnapshot(), s);
      setFormationSynthesis(s.id, r.synthesis, r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Synthesis failed.");
    } finally {
      setRunning(false);
    }
  }

  const threads = state.megathreads.filter((t) => t.status !== "archived");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/formation" className="text-sm text-zinc-400 underline-offset-4 hover:underline">← Reflect</Link>

      <header className="mb-6 mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          {s.type === "custom" && s.customType ? s.customType : SESSION_TYPE_LABEL[s.type]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{s.title}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFormationStatus(s.id, st)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                s.status === st
                  ? "bg-black/[.06] font-medium dark:bg-white/[.10]"
                  : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </header>

      {s.sensitive && (
        <p className="mb-6 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {s.sensitive}
        </p>
      )}

      {/* Prompts from the reflection engine */}
      {s.suggestedPrompts.length > 0 && (
        <section className="mb-6 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Prompts to sit with</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
            {s.suggestedPrompts.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </section>
      )}

      {/* Reflection (immutable once written) */}
      <section className="mb-8">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Your reflection</h2>
        {s.reflection ? (
          <p className="whitespace-pre-wrap rounded-2xl border border-black/[.06] p-4 text-sm leading-relaxed text-zinc-800 dark:border-white/[.08] dark:text-zinc-200">{s.reflection}</p>
        ) : (
          <div>
            <p className="mb-2 text-xs text-zinc-400">Write freely. Once saved, your reflection stays as written — later thinking goes into follow-ups or a new session.</p>
            <textarea
              value={reflectionDraft}
              onChange={(e) => setReflectionDraft(e.target.value)}
              rows={8}
              placeholder={s.prompt}
              className="w-full resize-none rounded-2xl border border-black/[.12] bg-transparent p-4 text-sm leading-relaxed outline-none focus:border-black/[.25] dark:border-white/[.15] dark:focus:border-white/[.30]"
            />
            <button type="button" onClick={saveReflection} disabled={!reflectionDraft.trim()} className="mt-2 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">
              Save reflection
            </button>
          </div>
        )}
      </section>

      {/* Structured capture */}
      {s.reflection && (
        <section className="mb-8 flex flex-col gap-5 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
          <p className="text-xs text-zinc-400">Optional structure — name what you&apos;re taking from this. Belief candidates can later go to your Inbox; nothing is added to your beliefs automatically.</p>
          <ListField label="Lessons" hint="What did this teach you?" values={s.lessons} onSave={(v) => setFormationFields(s.id, { lessons: v })} />
          <ListField label="Unresolved questions" hint="What's still open?" values={s.unresolvedQuestions} onSave={(v) => setFormationFields(s.id, { unresolvedQuestions: v })} />
          <ListField label="Emotional observations" hint="What did you feel, and where?" values={s.emotionalObservations} onSave={(v) => setFormationFields(s.id, { emotionalObservations: v })} />
          <ListField label="Revised assumptions" hint="What do you no longer assume?" values={s.revisedAssumptions} onSave={(v) => setFormationFields(s.id, { revisedAssumptions: v })} />
          <ListField label="Belief candidates" hint="First-person beliefs this reflection suggests." values={s.beliefCandidates} onSave={(v) => setFormationFields(s.id, { beliefCandidates: v })} />
          <ListField label="Follow-up reflections" hint="What should future-you return to?" values={s.followUpReflections} onSave={(v) => setFormationFields(s.id, { followUpReflections: v })} />

          {s.beliefCandidates.length > 0 && (
            <div className="border-t border-black/[.05] pt-4 dark:border-white/[.06]">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Send a belief candidate to your Inbox</h3>
              <ul className="flex flex-col gap-1.5">
                {s.beliefCandidates.map((c, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                    <span>{c}</span>
                    <button type="button" onClick={() => sendToInbox(c, [{ claim: c }], "mock")} className="shrink-0 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">→ Inbox</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Synthesis */}
      {s.reflection && (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={synthesize} disabled={running} className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
              {running ? "Synthesizing…" : s.synthesis ? "Re-synthesize" : `Synthesize (~1 AI · ${est?.evidenceCount ?? 0} evidence)`}
            </button>
            {s.synthesisSource && <span className="text-xs text-zinc-400">Last: {s.synthesisSource === "ai" ? "AI" : "offline (mock)"}</span>}
          </div>
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {s.synthesis && (
            <div className="mb-4">
              <FreshnessBadge
                state={state}
                fingerprint={s.fingerprint}
                currentIds={formationDeps(s)}
                onRerun={synthesize}
                approxAiCalls={1}
              />
            </div>
          )}

          {s.synthesis && <FormationSynthesisView session={s} />}
        </section>
      )}

      {/* Human control: attach to a thread */}
      {s.reflection && threads.length > 0 && (
        <section className="mb-8 rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Carry this forward</h2>
          <p className="mt-1 text-xs text-zinc-400">Attach this reflection to a Megathread, or turn an unresolved question into a new inquiry — your choice, never automatic.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={threadId} onChange={(e) => setThreadId(e.target.value)} className="rounded-lg border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.15]">
              <option value="">Choose a thread…</option>
              {threads.map((t) => <option key={t.id} value={t.id}>{snippet(t.title, 40)}</option>)}
            </select>
            <button type="button" onClick={() => { if (threadId) { attachFormationToThread(s.id, threadId); setThreadId(""); } }} disabled={!threadId} className="rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] disabled:opacity-30 dark:border-white/[.15] dark:hover:bg-white/[.06]">
              Attach
            </button>
          </div>
          {s.unresolvedQuestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {s.unresolvedQuestions.slice(0, 3).map((q, i) => (
                <Link key={i} href={`/inquiry?q=${encodeURIComponent(q)}`} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:border-white/[.15] dark:hover:text-zinc-100">
                  Inquire: “{snippet(q, 32)}” →
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Links */}
      {(s.linkedBeliefs.length + s.linkedDecisions.length + s.linkedThreads.length + s.linkedInquiries.length + s.linkedSources.length) > 0 && (
        <section className="text-xs text-zinc-400">
          <h2 className="mb-1 font-semibold uppercase tracking-wide">Linked</h2>
          <ul className="flex flex-wrap gap-2">
            {s.linkedBeliefs.map((bid) => <li key={bid}>belief: {snippet(state.beliefs.find((b) => b.id === bid)?.text ?? bid, 30)}</li>)}
            {s.linkedDecisions.map((did) => <li key={did}><Link href={`/decisions/${did}`} className="underline-offset-4 hover:underline">decision: {snippet(state.decisions.find((d) => d.id === did)?.title ?? did, 30)}</Link></li>)}
            {s.linkedThreads.map((tid) => <li key={tid}><Link href={`/threads/${tid}`} className="underline-offset-4 hover:underline">thread: {snippet(state.megathreads.find((t) => t.id === tid)?.title ?? tid, 30)}</Link></li>)}
            {s.linkedInquiries.map((iid) => <li key={iid}><Link href={`/inquiry/${iid}`} className="underline-offset-4 hover:underline">inquiry</Link></li>)}
            {s.linkedSources.map((sid) => <li key={sid}><Link href={`/library/${sid}`} className="underline-offset-4 hover:underline">source: {snippet(state.sources.find((x) => x.id === sid)?.title ?? sid, 30)}</Link></li>)}
          </ul>
        </section>
      )}
    </main>
  );
}
