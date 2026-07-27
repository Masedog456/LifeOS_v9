"use client";

/**
 * Open-loops step (LIFEOS-034, Feature 7). Deterministically DERIVES candidate
 * unfinished threads; the user chooses which belong in the review. Choosing a
 * loop never marks any record complete or incomplete — it only records the
 * user's selection.
 */

import { useMemo, useState } from "react";
import { useStore, addReviewOpenLoop, removeReviewOpenLoop } from "@/lib/mvpStore";
import { deriveOpenLoops } from "@/lib/reviews/open-loops";
import { unresolvedCount } from "@/lib/sync/status-store";
import { getSyncDiagnostics } from "@/lib/persistence";
import type { DailyReview } from "@/types/mvp";

const SOURCE_LABEL: Record<string, string> = {
  milestone: "Milestone", project: "Project", session: "Session", decision: "Decision",
  reading: "Reading", conflict: "Sync", unsynced: "Sync", manual: "Manual",
};

export default function OpenLoopsStep({ review }: { review: DailyReview }) {
  const state = useStore();
  const [manual, setManual] = useState("");

  const candidates = useMemo(() => {
    const live = { unresolvedConflicts: typeof window !== "undefined" ? unresolvedCount() : 0, unsyncedPending: typeof window !== "undefined" ? (getSyncDiagnostics().queued || getSyncDiagnostics().dirtyDomains.length > 0) : false };
    return deriveOpenLoops(state, live);
  }, [state]);

  const chosen = new Set(review.openLoops.map((l) => l.id));
  const toggle = (id: string) => {
    const cand = candidates.find((c) => c.id === id);
    if (chosen.has(id)) removeReviewOpenLoop(review.id, id);
    else if (cand) addReviewOpenLoop(review.id, { id: cand.id, source: cand.source, text: cand.text, ref: cand.ref });
  };
  const addManual = () => {
    if (!manual.trim()) return;
    addReviewOpenLoop(review.id, { id: `manual:${Date.now()}`, source: "manual", text: manual.trim() });
    setManual("");
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">What remains open? Tick the threads worth carrying forward. Nothing is marked done or undone — this only records what you choose.</p>

      {candidates.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {candidates.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 rounded-lg border border-black/[.06] px-3 py-1.5 text-xs dark:border-white/[.08]">
                <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Include: ${c.text}`} />
                <span className="shrink-0 rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{SOURCE_LABEL[c.source] ?? c.source}</span>
                <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{c.text}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-zinc-500">No open loops detected. You can still add one manually below.</p>}

      {/* Manually-added loops not in the candidate set. */}
      {review.openLoops.filter((l) => l.source === "manual").map((l) => (
        <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/[.06] px-3 py-1.5 text-xs dark:border-white/[.08]">
          <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{l.text}</span>
          <button type="button" onClick={() => removeReviewOpenLoop(review.id, l.id)} aria-label="Remove open loop" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-black/[.12] p-2 dark:border-white/[.15]">
        <input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addManual(); }} placeholder="Add an open loop manually…" aria-label="Manual open loop" className="w-full bg-transparent px-1 text-sm outline-none" />
        <button type="button" onClick={addManual} disabled={!manual.trim()} className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Add</button>
      </div>
    </div>
  );
}
