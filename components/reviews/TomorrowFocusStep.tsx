"use client";

/**
 * Tomorrow-focus step (LIFEOS-034, Feature 8). A small, user-ORDERED set of
 * next-focus intentions. No automatic priority, no deadlines. Each item may
 * reference an existing record; suggestions are optional.
 */

import { useMemo, useState } from "react";
import { useStore, addReviewFocus, removeReviewFocus, setReviewFocus } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { orderedFocus, moveFocus, focusSuggestions } from "@/lib/reviews/tomorrow-focus";
import EntityPicker from "@/components/reviews/EntityPicker";
import type { DailyReview, RecordRefLite } from "@/types/mvp";

export default function TomorrowFocusStep({ review }: { review: DailyReview }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const [text, setText] = useState("");
  const [ref, setRef] = useState<RecordRefLite | undefined>();
  const [refTitle, setRefTitle] = useState("");
  const items = orderedFocus(review.tomorrowFocus);
  const suggestions = useMemo(() => focusSuggestions(state), [state]);

  const add = () => { if (!text.trim() && !ref) return; addReviewFocus(review.id, text || refTitle, ref); setText(""); setRef(undefined); setRefTitle(""); };
  const move = (id: string, dir: -1 | 1) => setReviewFocus(review.id, moveFocus(review.tomorrowFocus, id, dir));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">What matters tomorrow? Pick a few and order them yourself — LifeOS never prioritizes for you or sets a deadline.</p>

      {items.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {items.map((f, i) => {
            const r = f.ref ? entityRef(ctx, f.ref.kind, f.ref.id) : undefined;
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-black/[.06] px-3 py-2 text-xs dark:border-white/[.08]">
                <span className="w-4 shrink-0 text-center text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">{f.text}{r && <span className="ml-1 text-[10px] text-zinc-400">· {entityKindLabel(r.kind)}</span>}</span>
                <button type="button" onClick={() => move(f.id, -1)} disabled={i === 0} aria-label="Move up" className="shrink-0 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200">↑</button>
                <button type="button" onClick={() => move(f.id, 1)} disabled={i === items.length - 1} aria-label="Move down" className="shrink-0 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:hover:text-zinc-200">↓</button>
                <button type="button" onClick={() => removeReviewFocus(review.id, f.id)} aria-label="Remove focus" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="rounded-lg border border-dashed border-black/[.12] p-3 dark:border-white/[.15]">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="A focus for tomorrow…" aria-label="New focus" className="w-full bg-transparent text-sm outline-none" />
        {ref && <p className="mt-1"><button type="button" onClick={() => { setRef(undefined); setRefTitle(""); }} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{entityKindLabel(ref.kind)}: {refTitle} ✕</button></p>}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1"><EntityPicker onPick={(r, t) => { setRef(r); setRefTitle(t); if (!text.trim()) setText(t); }} placeholder="Link a goal / project / document (optional)…" kinds={["goal", "project", "milestone", "workspace", "document"]} /></div>
          <button type="button" onClick={add} disabled={!text.trim() && !ref} className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Add focus</button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Suggestions (tap to add)</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => (
              <button key={i} type="button" onClick={() => addReviewFocus(review.id, s.text, s.ref)} className="rounded-full border border-black/[.10] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]">＋ {s.text}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
