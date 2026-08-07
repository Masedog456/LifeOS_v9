"use client";

import { useMemo, useState } from "react";
import type { Synthesis, Tension } from "@/types/mvp";
import {
  acceptSynthesis,
  addSynthesisFromCandidate,
  addUserSynthesis,
  continueDialogueFromSynthesis,
  rejectSynthesis,
  reviseSynthesis,
  synthesisToBeliefProposal,
  synthesisToConcept,
  synthesisToPrinciple,
  synthesisToResearch,
  useStore,
} from "@/lib/mvpStore";
import { generateSyntheses } from "@/lib/dialectic/synthesis";
import ConfidenceMeter from "@/components/ConfidenceMeter";

const CANDIDATE_LABEL: Record<string, string> = {
  integration: "Higher-order integration",
  scoped: "Scoped resolution",
  deferral: "Preserve the tension",
};

const STATUS_TONE: Record<Synthesis["status"], string> = {
  candidate: "text-zinc-500",
  accepted: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-zinc-400 line-through",
  superseded: "text-zinc-400",
};

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      <ul className="mt-0.5 list-disc pl-4 text-xs text-zinc-600 dark:text-zinc-300">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function SynthesisCard({ s }: { s: Synthesis }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.statement);
  const [showIntegrate, setShowIntegrate] = useState(false);
  const [conceptName, setConceptName] = useState("");

  return (
    <div className="rounded-xl border border-black/[.08] p-3 dark:border-white/[.10]">
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[s.status]}`}>
          {s.status} · {s.origin === "user" ? "yours" : "generated"}
        </span>
        {s.revisions.length > 1 && <span className="text-[10px] text-zinc-400">{s.revisions.length} revisions</span>}
      </div>

      {editing ? (
        <div className="mt-1">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="w-full rounded-lg border border-black/[.10] bg-transparent px-2 py-1.5 text-sm outline-none dark:border-white/[.12]" />
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => { reviseSynthesis(s.id, { statement: draft, note: "Revised" }); setEditing(false); }} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Save revision</button>
            <button type="button" onClick={() => { setDraft(s.statement); setEditing(false); }} className="text-[11px] text-zinc-400">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">{s.statement}</p>
      )}

      <div className="mt-2 flex flex-col gap-2 rounded-lg bg-black/[.02] p-2 dark:bg-white/[.03]">
        <List title="Preserved insights" items={s.preservedInsights} />
        <List title="Discarded assumptions" items={s.discardedAssumptions} />
        <List title="Common ground" items={s.commonGround} />
        <List title="Remaining uncertainty" items={s.remainingUncertainty} />
      </div>

      <div className="mt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Confidence (four axes, never averaged)</p>
        <ConfidenceMeter confidence={s.confidence} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.status !== "accepted" && <button type="button" onClick={() => acceptSynthesis(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-emerald-500/10 dark:border-white/[.15]">Accept</button>}
        {s.status !== "rejected" && <button type="button" onClick={() => rejectSynthesis(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-rose-500/10 dark:border-white/[.15]">Reject</button>}
        {!editing && <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Revise</button>}
        <button type="button" onClick={() => continueDialogueFromSynthesis(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Continue dialogue from here</button>
        <button type="button" onClick={() => setShowIntegrate((v) => !v)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Integrate…</button>
      </div>

      {showIntegrate && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-dashed border-black/[.12] p-2 dark:border-white/[.15]">
          <p className="text-[11px] text-zinc-500">Integration is always an explicit action. Belief/Constitution proposals go to your Inbox — nothing is added to any record automatically.</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <button type="button" onClick={() => synthesisToBeliefProposal(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 dark:border-white/[.15]">→ Belief proposal (Inbox)</button>
            <button type="button" onClick={() => synthesisToPrinciple(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 dark:border-white/[.15]">→ Principle (Knowledge)</button>
            <button type="button" onClick={() => synthesisToResearch(s.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 dark:border-white/[.15]">→ Research project</button>
          </div>
          <div className="flex gap-1.5">
            <input value={conceptName} onChange={(e) => setConceptName(e.target.value)} placeholder="Concept name…" className="min-w-0 flex-1 rounded-lg border border-black/[.10] bg-transparent px-2 py-1 text-[11px] outline-none dark:border-white/[.12]" />
            <button type="button" onClick={() => { if (conceptName.trim()) { synthesisToConcept(s.id, conceptName); setConceptName(""); } }} disabled={!conceptName.trim()} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] disabled:opacity-30 dark:border-white/[.15]">→ Concept</button>
          </div>
        </div>
      )}

      {s.outcomes.length > 0 && (
        <p className="mt-2 text-[10px] text-zinc-400">Integrated into: {s.outcomes.map((o) => o.kind).join(", ")}</p>
      )}
    </div>
  );
}

export default function SynthesisPanel({ tension }: { tension: Tension }) {
  const state = useStore();
  const syntheses = useMemo(() => state.syntheses.filter((s) => s.tensionIds.includes(tension.id)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [state.syntheses, tension.id]);
  const candidates = useMemo(() => generateSyntheses(tension), [tension]);
  const [showCandidates, setShowCandidates] = useState(false);
  const [ownText, setOwnText] = useState("");

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Syntheses</h4>
        <button type="button" onClick={() => setShowCandidates((v) => !v)} className="text-[11px] text-zinc-500 underline-offset-4 hover:underline">{showCandidates ? "Hide" : "Suggest"} candidates</button>
      </div>

      {showCandidates && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-zinc-500">Starting points — a synthesis is never a compromise or a winner. Add one to work on it, or write your own.</p>
          {candidates.map((c) => (
            <div key={c.kind} className="rounded-xl border border-dashed border-black/[.12] p-3 dark:border-white/[.15]">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{CANDIDATE_LABEL[c.kind]}</p>
              <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-200">{c.statement}</p>
              <p className="mt-1 text-[11px] text-zinc-400">{c.rationale}</p>
              <button type="button" onClick={() => addSynthesisFromCandidate(tension.dialogueId, tension.id, c)} className="mt-1.5 rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Add this candidate</button>
            </div>
          ))}
        </div>
      )}

      {syntheses.map((s) => <SynthesisCard key={s.id} s={s} />)}

      <div className="flex gap-1.5">
        <input value={ownText} onChange={(e) => setOwnText(e.target.value)} placeholder="Write your own synthesis…" className="min-w-0 flex-1 rounded-lg border border-black/[.10] bg-transparent px-2 py-1.5 text-sm outline-none dark:border-white/[.12]" />
        <button type="button" onClick={() => { if (ownText.trim()) { addUserSynthesis(tension.dialogueId, [tension.id], { statement: ownText, preservedInsights: [`From the thesis: ${tension.thesis}`, `From the antithesis: ${tension.antithesis}`], remainingUncertainty: tension.unresolvedQuestions }); setOwnText(""); } }} disabled={!ownText.trim()} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs disabled:opacity-30 dark:border-white/[.15]">Add</button>
      </div>
    </div>
  );
}
