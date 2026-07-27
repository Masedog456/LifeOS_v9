"use client";

/**
 * Wins step (LIFEOS-034, Feature 4). Manual only — the day summary SUGGESTS
 * sources but a win is never auto-written. A win may link to any record.
 */

import { useMemo, useState } from "react";
import { useStore, addReviewWin, removeReviewWin } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { buildDaySummary } from "@/lib/reviews/day-summary";
import EntityPicker from "@/components/reviews/EntityPicker";
import type { DailyReview, RecordRefLite } from "@/types/mvp";

export default function WinsStep({ review }: { review: DailyReview }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const [text, setText] = useState("");
  const [links, setLinks] = useState<RecordRefLite[]>([]);

  const suggestions = useMemo(() => {
    const s = buildDaySummary(state, review.date);
    const items = s.groups.filter((g) => ["milestones_completed", "decisions", "projects_advanced"].includes(g.key)).flatMap((g) => g.items);
    return items.slice(0, 5);
  }, [state, review.date]);

  const add = () => { if (!text.trim()) return; addReviewWin(review.id, text, links); setText(""); setLinks([]); };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">What moved forward or went well today? Add wins in your own words — LifeOS never writes them for you.</p>

      {review.wins.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {review.wins.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/[.06] px-3 py-2 text-xs dark:border-white/[.08]">
              <div className="min-w-0">
                <p className="text-zinc-800 dark:text-zinc-100">{w.text}</p>
                {w.links.length > 0 && <p className="mt-0.5 flex flex-wrap gap-1">{w.links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <span key={`${r.kind}:${r.id}`} className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{entityKindLabel(r.kind)}: {ref.title}</span>; })}</p>}
              </div>
              <button type="button" onClick={() => removeReviewWin(review.id, w.id)} aria-label="Remove win" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-black/[.12] p-3 dark:border-white/[.15]">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="A win from today…" aria-label="New win" className="w-full bg-transparent text-sm outline-none" />
        {links.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <button key={`${r.kind}:${r.id}`} type="button" onClick={() => setLinks((l) => l.filter((x) => !(x.kind === r.kind && x.id === r.id)))} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{entityKindLabel(r.kind)}: {ref.title} ✕</button>; })}</p>}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1"><EntityPicker onPick={(ref) => setLinks((l) => (l.some((x) => x.kind === ref.kind && x.id === ref.id) ? l : [...l, ref]))} placeholder="Link a record (optional)…" /></div>
          <button type="button" onClick={add} disabled={!text.trim()} className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Add win</button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Suggested from today (tap to prefill — nothing is added automatically)</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((it) => (
              <button key={`${it.kind}:${it.id}`} type="button" onClick={() => { setText(it.label); setLinks([{ kind: it.kind, id: it.id }]); }} className="rounded-full border border-black/[.10] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]">＋ {it.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
