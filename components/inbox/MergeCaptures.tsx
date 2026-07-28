"use client";

/**
 * Merge captures (LIFEOS-035, Feature 7). An explicit user operation: select
 * other inbox captures, choose their order (selection order) and a separator,
 * preview the result, and merge. Originals are preserved unless "archive
 * originals" is checked. Never automatic, never used by sync.
 */

import { useMemo, useState } from "react";
import { useStore, mergeCaptures } from "@/lib/mvpStore";
import { capturesForView } from "@/lib/inbox/queue";
import { effectiveText } from "@/lib/inbox/capture-status";
import { planMerge, MERGE_SEPARATORS } from "@/lib/inbox/merge";
import { toast } from "@/lib/ux/feedback";
import type { Capture } from "@/types/mvp";

const snip = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function MergeCaptures({ capture, onMerged }: { capture: Capture; onMerged?: (id: string) => void }) {
  const state = useStore();
  const candidates = useMemo(() => capturesForView(state.captures ?? [], "inbox").filter((c) => c.id !== capture.id), [state, capture.id]);
  const [order, setOrder] = useState<string[]>([capture.id]);
  const [sepKey, setSepKey] = useState("blank");
  const [archive, setArchive] = useState(false);

  const separator = MERGE_SEPARATORS.find((s) => s.key === sepKey)?.value ?? "\n\n";
  const plan = planMerge(state.captures ?? [], order, separator);

  const toggle = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  const doMerge = () => {
    const newId = mergeCaptures(order, separator, { archiveOriginals: archive });
    if (newId) { toast({ kind: "success", message: `Merged ${order.length} captures` }); onMerged?.(newId); }
    else toast({ kind: "error", message: "Select at least two captures" });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">Pick captures to merge (order follows selection). This capture is included first.</p>
      <div className="max-h-40 overflow-auto rounded-lg border border-black/[.08] p-1 dark:border-white/[.10]">
        <label className="flex items-center gap-2 rounded-md px-2 py-1 text-xs opacity-70">
          <input type="checkbox" checked readOnly /> <span className="truncate">1. {snip(effectiveText(capture))}</span>
        </label>
        {candidates.map((c) => {
          const pos = order.indexOf(c.id);
          return (
            <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06]">
              <input type="checkbox" checked={pos >= 0} onChange={() => toggle(c.id)} aria-label={`Include ${snip(effectiveText(c), 30)}`} />
              <span className="truncate">{pos >= 0 ? `${pos + 1}. ` : ""}{snip(effectiveText(c))}</span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-zinc-500">Separator
          <select value={sepKey} onChange={(e) => setSepKey(e.target.value)} aria-label="Separator" className="ml-1 rounded-md border border-black/10 bg-transparent px-1.5 py-1 text-xs dark:border-white/12">
            {MERGE_SEPARATORS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11px] text-zinc-500"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Archive originals</label>
      </div>
      {plan.valid && (
        <div className="rounded-lg border border-black/[.08] p-2 text-xs dark:border-white/[.10]"><p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-400">Preview</p><p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">{plan.text}</p></div>
      )}
      <button type="button" onClick={doMerge} disabled={!plan.valid} className="self-end rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Merge {order.length}</button>
    </div>
  );
}
