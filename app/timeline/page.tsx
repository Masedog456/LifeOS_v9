"use client";

/**
 * Insight Timeline (LIFEOS-026, Feature 2) — the page.
 *
 * A chronological projection of the user's intellectual evolution: beliefs
 * forming and changing, important captures, accepted syntheses, research and
 * formation milestones, decision outcomes, and dialogue completions — all
 * derived from existing records, newest first. Each event links to the record
 * it came from. Nothing here is stored or inferred beyond what the records say.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildInsightTimeline, type TimelineEntry, type TimelineKind } from "@/lib/memory/timeline";

const KIND_LABEL: Record<TimelineKind, string> = {
  belief_formed: "Belief formed",
  belief_changed: "Belief changed",
  capture: "Capture",
  synthesis: "Synthesis",
  research_milestone: "Research",
  formation_milestone: "Reflection",
  decision_outcome: "Decision",
  dialogue_completed: "Dialogue",
};

const KIND_TONE: Record<TimelineKind, string> = {
  belief_formed: "bg-emerald-400",
  belief_changed: "bg-sky-400",
  capture: "bg-zinc-400",
  synthesis: "bg-violet-400",
  research_milestone: "bg-amber-400",
  formation_milestone: "bg-teal-400",
  decision_outcome: "bg-rose-400",
  dialogue_completed: "bg-indigo-400",
};

function monthLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function dayLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TimelinePage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const [kind, setKind] = useState<TimelineKind | "all">("all");

  const entries = useMemo(() => buildInsightTimeline(state), [state]);
  const kinds = useMemo(() => {
    const counts = new Map<TimelineKind, number>();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const shown = kind === "all" ? entries : entries.filter((e) => e.kind === kind);

  // Group by month (entries already newest-first).
  const groups = useMemo(() => {
    const out: { month: string; items: TimelineEntry[] }[] = [];
    for (const e of shown) {
      const m = monthLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.month === m) last.items.push(e);
      else out.push({ month: m, items: [e] });
    }
    return out;
  }, [shown]);

  if (!mounted) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Assembling your timeline…</p></main>;
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Insight Timeline</h1>
        <p className="mt-1 text-sm text-zinc-500">
          How your thinking has evolved — every belief that formed or changed, every synthesis, milestone, and decision — reconstructed from records you already have.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          Your timeline fills in as you form beliefs, run dialogues, and make decisions. Nothing to show yet.
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
            <FilterChip label={`All (${entries.length})`} active={kind === "all"} onClick={() => setKind("all")} />
            {kinds.map(([k, n]) => (
              <FilterChip key={k} label={`${KIND_LABEL[k]} (${n})`} active={kind === k} onClick={() => setKind(k)} />
            ))}
          </div>

          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.month}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.month}</h2>
                <ol className="relative ml-1 border-l border-black/[.08] dark:border-white/[.10]">
                  {g.items.map((e) => (
                    <li key={e.id} className="relative pb-4 pl-5">
                      <span aria-hidden className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${KIND_TONE[e.kind]}`} />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{KIND_LABEL[e.kind]} · {e.title}</span>
                        <span className="shrink-0 text-[10px] text-zinc-400">{dayLabel(e.at)}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-100">{e.detail}</p>
                      {e.evidence.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {e.evidence.map((v, i) =>
                            v.href ? (
                              <Link key={`${v.id}:${i}`} href={v.href} className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[10px] text-zinc-600 underline-offset-2 hover:underline dark:bg-white/[.06] dark:text-zinc-300" title={v.kind}>
                                {v.kind}
                              </Link>
                            ) : null,
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
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
