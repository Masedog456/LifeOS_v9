"use client";

/**
 * Living Memory (LIFEOS-026, Feature 1) — the page.
 *
 * A read-only feed of meaningful records the user already owns, resurfaced by
 * deterministic rules: ideas not revisited in a long time, beliefs connected to
 * recent captures, recurring concepts and themes, unfinished dialogues,
 * unresolved tensions, abandoned research, forgotten decisions, anniversaries,
 * and frequently-referenced ideas. Every card explains itself in full. Viewing
 * this page changes nothing — it is a projection, not a store.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildLivingMemory, type MemoryCandidate, type MemoryKind } from "@/lib/memory/living";
import ExplanationDetail from "@/components/ExplanationDetail";

const KIND_LABEL: Record<MemoryKind, string> = {
  not_revisited: "Not revisited",
  related_to_recent_capture: "Connected to recent captures",
  recurring_concept: "Recurring concept",
  unfinished_dialogue: "Unfinished dialogue",
  unresolved_tension: "Unresolved tension",
  abandoned_research: "Abandoned research",
  forgotten_decision: "Forgotten decision",
  recurring_theme: "Recurring theme",
  anniversary: "Anniversary",
  frequently_referenced: "Frequently referenced",
};

export default function MemoryPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const [kind, setKind] = useState<MemoryKind | "all">("all");

  const candidates = useMemo(() => buildLivingMemory(state), [state]);
  const kinds = useMemo(() => {
    const counts = new Map<MemoryKind, number>();
    for (const c of candidates) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [candidates]);
  const shown = kind === "all" ? candidates : candidates.filter((c) => c.kind === kind);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Recalling…</p></main>;
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Living Memory</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Meaningful ideas from your own history, resurfaced by transparent rules. Every item says exactly why it appeared — no opaque suggestions, nothing stored.
        </p>
      </header>

      {candidates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          <p>Nothing to resurface yet. As your beliefs, dialogues, research, and decisions accumulate, Living Memory will bring the meaningful ones back to you.</p>
          <Link href="/" className="mt-2 inline-block rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Capture a thought →</Link>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by rule">
            <FilterChip label={`All (${candidates.length})`} active={kind === "all"} onClick={() => setKind("all")} />
            {kinds.map(([k, n]) => (
              <FilterChip key={k} label={`${KIND_LABEL[k]} (${n})`} active={kind === k} onClick={() => setKind(k)} />
            ))}
          </div>

          <ul className="flex flex-col gap-3">
            {shown.map((c) => <MemoryCard key={c.id} candidate={c} />)}
          </ul>
        </>
      )}
    </main>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${active ? "bg-black/[.08] font-medium dark:bg-white/[.12]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}
    >
      {label}
    </button>
  );
}

function MemoryCard({ candidate }: { candidate: MemoryCandidate }) {
  return (
    <li className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{KIND_LABEL[candidate.kind]}</span>
          <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-100">{candidate.title}</p>
        </div>
        <Link href={candidate.href} className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">
          Open →
        </Link>
      </div>
      <ExplanationDetail explanation={candidate.explanation} />
    </li>
  );
}
