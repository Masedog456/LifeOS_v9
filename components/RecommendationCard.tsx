"use client";

import Link from "next/link";
import type { Recommendation } from "@/types/mvp";
import {
  acceptRecommendation,
  completeRecommendation,
  dismissRecommendation,
  reopenRecommendation,
  snoozeRecommendation,
  useStore,
} from "@/lib/mvpStore";
import { explainRecommendation } from "@/lib/memory/recommendation";
import ExplanationDetail from "@/components/ExplanationDetail";

const TYPE_LABEL: Record<Recommendation["type"], string> = {
  open_dialogue: "Open a dialogue",
  create_synthesis: "Build a synthesis",
  create_research_question: "Open a research question",
  elevate_concept: "Strengthen a concept",
  merge_duplicate_concepts: "Merge duplicate concepts",
  new_principle: "Possible new principle",
  formation_exercise: "Formation reflection",
  review_belief: "Review a belief",
  import_source: "Import a source",
  unresolved_tension: "Unresolved tension",
  confidence_decline: "Confidence is declining",
  repeat_reflection: "Repeat a reflection",
  revisit_decision: "Revisit a decision",
};

const PRIORITY_TONE: Record<Recommendation["priority"], string> = {
  high: "bg-rose-400",
  medium: "bg-amber-400",
  low: "bg-zinc-400",
};

const SUBSYSTEM_LABEL: Record<Recommendation["subsystem"], string> = {
  belief: "Belief Ledger",
  research: "Research",
  graph: "Graph",
  dialogue: "Dialogue",
  review: "Review",
  formation: "Formation",
  decision: "Decisions",
  world: "World Model",
};

function statusLabel(r: Recommendation): string | null {
  if (r.completed) return "completed";
  if (r.dismissed) return "dismissed";
  if (r.accepted) return "accepted";
  if (r.snoozedUntil && Date.parse(r.snoozedUntil) > Date.now()) return "snoozed";
  return null;
}

export default function RecommendationCard({ rec }: { rec: Recommendation }) {
  const state = useStore();
  const status = statusLabel(rec);
  const settled = rec.completed || rec.dismissed;
  const explanation = explainRecommendation(state, rec);

  return (
    <div className={`rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10] ${settled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${PRIORITY_TONE[rec.priority]}`} title={`${rec.priority} priority`} />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{TYPE_LABEL[rec.type]}</span>
            <span className="text-[10px] text-zinc-400">· {SUBSYSTEM_LABEL[rec.subsystem]}</span>
            <span className="text-[10px] text-zinc-400">· confidence {rec.confidence}</span>
            {status && <span className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.10]">{status}</span>}
          </span>
          <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">{rec.suggestedAction}</p>
        </div>
        <span className="shrink-0 text-[10px] text-zinc-400">{new Date(rec.createdAt).toLocaleDateString()}</span>
      </div>

      {rec.affected.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1">
          {rec.affected.map((a) => (
            <span key={a.id || a.label} className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06]" title={`${a.kind} · ${a.id}`}>{a.label}</span>
          ))}
        </p>
      )}

      <ExplanationDetail explanation={explanation} />

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {rec.actionHref && !settled && (
          <Link href={rec.actionHref} onClick={() => acceptRecommendation(rec.id)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">
            Act on this →
          </Link>
        )}
        {!settled && <button type="button" onClick={() => completeRecommendation(rec.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Done</button>}
        {!settled && <button type="button" onClick={() => snoozeRecommendation(rec.id, 7)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Snooze 7d</button>}
        {!settled && <button type="button" onClick={() => dismissRecommendation(rec.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-400 hover:text-red-500 dark:border-white/[.15]">Dismiss</button>}
        {settled && <button type="button" onClick={() => reopenRecommendation(rec.id)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] dark:border-white/[.15]">Reopen</button>}
      </div>
    </div>
  );
}
