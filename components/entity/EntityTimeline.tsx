"use client";

/**
 * EntityTimeline (LIFEOS-029, Feature 4) — the inspector "Timeline" tab.
 * A chronological (newest-first) history derived from the record itself:
 * creation, edits, belief revisions/judgments, highlights, annotations,
 * conversions, reading + decision activity.
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext } from "@/lib/entities/entity";
import { entityTimeline } from "@/lib/entities/timeline";

const TONE: Record<string, string> = {
  created: "bg-emerald-400", updated: "bg-zinc-400", revised: "bg-sky-400", judged: "bg-violet-400",
  highlight: "bg-amber-400", annotation: "bg-teal-400", conversion: "bg-indigo-400", reading: "bg-lime-400",
  decision: "bg-rose-400", turn: "bg-cyan-400", concluded: "bg-fuchsia-400",
};

export default function EntityTimeline({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const entries = useMemo(() => entityTimeline(makeEntityContext(state), kind, id), [state, kind, id]);

  if (entries.length === 0) return <p className="p-4 text-sm text-zinc-400">No recorded activity yet.</p>;

  return (
    <ol className="relative ml-5 border-l border-black/[.08] p-4 pl-5 dark:border-white/[.10]">
      {entries.map((e, i) => (
        <li key={`${e.at}:${i}`} className="relative pb-3">
          <span aria-hidden className={`absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ${TONE[e.kind] ?? "bg-zinc-400"}`} />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-zinc-800 dark:text-zinc-100">{e.label}</span>
            <span className="shrink-0 text-[10px] text-zinc-400">{e.relative}</span>
          </div>
          {e.detail && <p className="mt-0.5 text-[11px] text-zinc-500">{e.detail}</p>}
        </li>
      ))}
    </ol>
  );
}
