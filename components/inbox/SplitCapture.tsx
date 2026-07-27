"use client";

/**
 * Split a capture (LIFEOS-035, Feature 6). The user edits the segment boundaries
 * MANUALLY (seeded from a mechanical blank-line suggestion, never a semantic
 * split), previews the result, and splits. The original is preserved unless the
 * user checks "archive original". Empty segments are prevented.
 */

import { useState } from "react";
import { splitCapture } from "@/lib/mvpStore";
import { planSplit, suggestSegments } from "@/lib/inbox/split";
import { toast } from "@/lib/ux/feedback";
import type { Capture } from "@/types/mvp";

export default function SplitCapture({ capture, onDone }: { capture: Capture; onDone?: () => void }) {
  const [segments, setSegments] = useState<string[]>(() => { const s = suggestSegments(capture); return s.length > 1 ? s : [s[0] ?? "", ""]; });
  const [archiveOriginal, setArchiveOriginal] = useState(false);
  const plan = planSplit(capture, segments);

  const set = (i: number, v: string) => setSegments((arr) => arr.map((s, j) => (j === i ? v : s)));
  const add = () => setSegments((arr) => [...arr, ""]);
  const remove = (i: number) => setSegments((arr) => arr.filter((_, j) => j !== i));

  const doSplit = () => {
    const ids = splitCapture(capture.id, segments, { archiveOriginal });
    if (ids.length) { toast({ kind: "success", message: `Split into ${ids.length} captures` }); onDone?.(); }
    else toast({ kind: "error", message: "Fix the segments first" });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">Edit the boundaries — each segment becomes a new capture. Nothing is split automatically.</p>
      {segments.map((s, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 w-4 shrink-0 text-center text-[10px] text-zinc-400">{i + 1}</span>
          <textarea value={s} onChange={(e) => set(i, e.target.value)} rows={2} aria-label={`Segment ${i + 1}`} className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm outline-none dark:border-white/12" />
          <button type="button" onClick={() => remove(i)} disabled={segments.length <= 2} aria-label="Remove segment" className="mt-1 shrink-0 text-zinc-400 hover:text-rose-500 disabled:opacity-30">✕</button>
        </div>
      ))}
      {plan.errors.length > 0 && <p className="text-[11px] text-rose-600 dark:text-rose-400">{plan.errors.join(" ")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} className="rounded-full border border-black/[.12] px-3 py-1 text-xs dark:border-white/[.15]">＋ Segment</button>
        <label className="flex items-center gap-1 text-[11px] text-zinc-500"><input type="checkbox" checked={archiveOriginal} onChange={(e) => setArchiveOriginal(e.target.checked)} /> Archive the original</label>
        <button type="button" onClick={doSplit} disabled={!plan.valid} className="ml-auto rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Split into {plan.segments.length}</button>
      </div>
    </div>
  );
}
