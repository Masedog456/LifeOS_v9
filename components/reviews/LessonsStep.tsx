"use client";

/**
 * Lessons step (LIFEOS-034, Feature 5). Manual lessons, each linkable to the
 * records they came from, and CONVERTIBLE into an existing canonical record (a
 * capture) — LifeOS never creates a new knowledge subtype merely for lessons.
 */

import { useMemo, useState } from "react";
import { useStore, addReviewLesson, removeReviewLesson, convertLessonToCapture } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { toast } from "@/lib/ux/feedback";
import EntityPicker from "@/components/reviews/EntityPicker";
import type { DailyReview, RecordRefLite } from "@/types/mvp";

export default function LessonsStep({ review }: { review: DailyReview }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const [text, setText] = useState("");
  const [links, setLinks] = useState<RecordRefLite[]>([]);
  const add = () => { if (!text.trim()) return; addReviewLesson(review.id, text, links); setText(""); setLinks([]); };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">What did you learn today? A lesson can be promoted into a capture when you want it to live in your knowledge base.</p>

      {review.lessons.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {review.lessons.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/[.06] px-3 py-2 text-xs dark:border-white/[.08]">
              <div className="min-w-0">
                <p className="text-zinc-800 dark:text-zinc-100">{l.text}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1">
                  {l.links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <span key={`${r.kind}:${r.id}`} className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{entityKindLabel(r.kind)}: {ref.title}</span>; })}
                  {l.convertedTo ? <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">Saved as capture ✓</span>
                    : <button type="button" onClick={() => { convertLessonToCapture(review.id, l.id); toast({ kind: "success", message: "Lesson saved as a capture" }); }} className="rounded-full border border-black/[.12] px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300">Convert to capture</button>}
                </p>
              </div>
              <button type="button" onClick={() => removeReviewLesson(review.id, l.id)} aria-label="Remove lesson" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-black/[.12] p-3 dark:border-white/[.15]">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="A lesson from today…" aria-label="New lesson" className="w-full bg-transparent text-sm outline-none" />
        {links.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{links.map((r) => { const ref = entityRef(ctx, r.kind, r.id); return <button key={`${r.kind}:${r.id}`} type="button" onClick={() => setLinks((l) => l.filter((x) => !(x.kind === r.kind && x.id === r.id)))} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">{entityKindLabel(r.kind)}: {ref.title} ✕</button>; })}</p>}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1"><EntityPicker onPick={(ref) => setLinks((l) => (l.some((x) => x.kind === ref.kind && x.id === ref.id) ? l : [...l, ref]))} placeholder="Link a document / belief / decision…" kinds={["document", "passage", "highlight", "annotation", "belief", "decision", "research_project"]} /></div>
          <button type="button" onClick={add} disabled={!text.trim()} className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Add lesson</button>
        </div>
      </div>
    </div>
  );
}
