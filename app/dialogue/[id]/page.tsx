"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DialogueSession, DialogueStatus, PerspectiveKind } from "@/types/mvp";
import {
  addPerspective,
  dialogueById,
  dialogueToBeliefProposal,
  dialogueToConcept,
  dialogueToDecision,
  dialogueToFramework,
  dialogueToKnowledge,
  dialogueToPrinciple,
  dialogueToResearch,
  markDialogueReviewed,
  removePerspective,
  setDialogueFields,
  useStore,
} from "@/lib/mvpStore";
import { buildDialogueTimeline } from "@/lib/dialogue/timeline";
import { dialogueDeps } from "@/lib/freshness/fingerprint";
import SocraticPrompts from "@/components/SocraticPrompts";
import DialogueThread from "@/components/DialogueThread";
import DialogueGraphContext from "@/components/DialogueGraphContext";
import DialogueTimeline from "@/components/DialogueTimeline";
import DialecticWorkspace from "@/components/DialecticWorkspace";
import FreshnessBadge from "@/components/FreshnessBadge";

const TABS = ["Dialogue", "Perspectives", "Dialectic", "Graph", "Outcomes", "Timeline"] as const;
type Tab = (typeof TABS)[number];
const STATUSES: DialogueStatus[] = ["open", "active", "paused", "concluded", "archived"];

function snippet(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export default function DialogueSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useStore();
  const session = useMemo(() => dialogueById(state, id), [state, id]);
  const [tab, setTab] = useState<Tab>("Dialogue");
  const [outcomeText, setOutcomeText] = useState("");

  const timeline = useMemo(() => (session ? buildDialogueTimeline(session) : []), [session]);

  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Dialogue not found.</p>
        <Link href="/dialogue" className="text-sm text-zinc-500 underline-offset-4 hover:underline">← Back to Dialogue</Link>
      </main>
    );
  }
  const d: DialogueSession = session;

  function addPerspOf(kind: PerspectiveKind, refId: string, label: string) {
    addPerspective(d.id, kind, label, refId);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/dialogue" className="text-sm text-zinc-400 underline-offset-4 hover:underline">← Dialogue</Link>

      <header className="mb-6 mt-3">
        <input defaultValue={d.title} onBlur={(e) => e.target.value.trim() && e.target.value !== d.title && setDialogueFields(d.id, { title: e.target.value.trim() })} className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none" />
        <p className="mt-1 text-sm text-zinc-500">{d.topic}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STATUSES.map((st) => (
            <button key={st} type="button" onClick={() => setDialogueFields(d.id, { status: st })} className={`rounded-full px-2.5 py-1 text-[11px] ${d.status === st ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}>{st}</button>
          ))}
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-xs transition-colors ${tab === t ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}>{t}</button>
        ))}
      </div>

      {tab === "Dialogue" && (
        <section className="flex flex-col gap-6">
          <div className="rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Socratic prompts</h2>
            <SocraticPrompts session={d} />
          </div>
          <DialogueThread session={d} />
        </section>
      )}

      {tab === "Perspectives" && (
        <section className="flex flex-col gap-5">
          <p className="text-xs text-zinc-400">Bring viewpoints from your own knowledge into the dialogue. Each perspective cites the record it is sourced from.</p>
          {d.participants.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {d.participants.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span><span className="text-[10px] uppercase tracking-wide text-zinc-400">{p.kind.replace(/_/g, " ")} · </span>{p.label}</span>
                  <button type="button" onClick={() => removePerspective(d.id, p.id)} className="text-[11px] text-zinc-400 hover:text-red-500">remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-3">
            <button type="button" onClick={() => addPerspective(d.id, "constitution", "Your current beliefs")} className="self-start rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">+ Your current beliefs</button>
            <PerspGroup label="Frameworks" kind="framework" items={state.frameworks.map((f) => ({ id: f.id, label: f.name }))} onAdd={addPerspOf} />
            <PerspGroup label="Principles" kind="principle" items={state.principles.map((p) => ({ id: p.id, label: snippet(p.statement) }))} onAdd={addPerspOf} />
            <PerspGroup label="Beliefs" kind="belief" items={state.beliefs.filter((b) => b.status !== "rejected").map((b) => ({ id: b.id, label: snippet(b.text) }))} onAdd={addPerspOf} />
            <PerspGroup label="Research projects" kind="research" items={state.researchProjects.map((r) => ({ id: r.id, label: snippet(r.title) }))} onAdd={addPerspOf} />
            <PerspGroup label="Authors (sources)" kind="author" items={state.sources.map((s) => ({ id: s.id, label: snippet(s.author ? `${s.author}: ${s.title}` : s.title) }))} onAdd={addPerspOf} />
          </div>
        </section>
      )}

      {tab === "Dialectic" && <DialecticWorkspace session={d} />}

      {tab === "Graph" && (
        <section>
          <div className="mb-3"><FreshnessBadge state={state} fingerprint={d.fingerprint} currentIds={dialogueDeps(d)} onRerun={() => markDialogueReviewed(d.id)} approxAiCalls={0} /></div>
          <DialogueGraphContext session={d} />
        </section>
      )}

      {tab === "Outcomes" && (
        <section className="flex flex-col gap-5">
          <p className="text-xs text-zinc-400">Turn the conversation into something. Nothing changes automatically — every outcome is an explicit action, and any belief proposals go to your Inbox for review.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { const rid = dialogueToResearch(d.id); if (rid) router.push(`/research/${rid}`); }} className="rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">→ Research project</button>
            <button type="button" onClick={() => { const kid = dialogueToKnowledge(d.id); if (kid) router.push(`/author/${kid}`); }} className="rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">→ Knowledge project</button>
            <button type="button" onClick={() => { const did = dialogueToDecision(d.id); if (did) router.push(`/decisions/${did}`); }} className="rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">→ Decision</button>
          </div>
          <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">From a statement</p>
            <input value={outcomeText} onChange={(e) => setOutcomeText(e.target.value)} placeholder="Text for a belief / concept / principle / framework…" className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <button type="button" onClick={() => { dialogueToBeliefProposal(d.id, outcomeText); setOutcomeText(""); }} disabled={!outcomeText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 disabled:opacity-30 dark:border-white/[.15]">→ Belief proposal (Inbox)</button>
              <button type="button" onClick={() => { dialogueToBeliefProposal(d.id, outcomeText, true); setOutcomeText(""); }} disabled={!outcomeText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 disabled:opacity-30 dark:border-white/[.15]">→ Belief proposal (Inbox)</button>
              <button type="button" onClick={() => { dialogueToConcept(d.id, outcomeText); setOutcomeText(""); }} disabled={!outcomeText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 disabled:opacity-30 dark:border-white/[.15]">→ Concept</button>
              <button type="button" onClick={() => { dialogueToPrinciple(d.id, outcomeText); setOutcomeText(""); }} disabled={!outcomeText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 disabled:opacity-30 dark:border-white/[.15]">→ Principle</button>
              <button type="button" onClick={() => { dialogueToFramework(d.id, outcomeText); setOutcomeText(""); }} disabled={!outcomeText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 disabled:opacity-30 dark:border-white/[.15]">→ Framework</button>
            </div>
          </div>
          {d.outcomes.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Created from this dialogue</h3>
              <ul className="flex flex-col gap-0.5 text-xs text-zinc-500">
                {d.outcomes.map((o, i) => <li key={i}>{new Date(o.at).toLocaleDateString()} — {o.kind}: {o.label}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === "Timeline" && <DialogueTimeline items={timeline} />}
    </main>
  );
}

function PerspGroup({ label, kind, items, onAdd }: { label: string; kind: PerspectiveKind; items: { id: string; label: string }[]; onAdd: (kind: PerspectiveKind, refId: string, label: string) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-zinc-500 underline-offset-4 hover:underline">{open ? "− " : "+ "}{label} ({items.length})</button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {items.map((it) => (
            <button key={it.id} type="button" onClick={() => onAdd(kind, it.id, it.label)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:border-white/[.15] dark:hover:text-zinc-100">{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
