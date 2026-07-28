"use client";

/**
 * Batch action bar (LIFEOS-035, Feature 11). Multi-select actions — link to
 * workspace/project, add a tag, defer, archive, mark processed, restore. NEVER
 * batch conversion (each conversion needs individual review). Shows an impact
 * summary before large actions.
 */

import { useState } from "react";
import { batchCaptureAction, type BatchCaptureAction } from "@/lib/mvpStore";
import EntityPicker from "@/components/reviews/EntityPicker";
import { toast } from "@/lib/ux/feedback";

const LARGE = 10;

export default function BatchActionBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [mode, setMode] = useState<"" | "link_workspace" | "link_project" | "add_tag">("");
  const [tag, setTag] = useState("");
  const [pending, setPending] = useState<null | { action: BatchCaptureAction; payload?: Parameters<typeof batchCaptureAction>[2]; label: string }>(null);
  if (ids.length === 0) return null;

  const apply = (action: BatchCaptureAction, payload: Parameters<typeof batchCaptureAction>[2] | undefined, label: string) => {
    batchCaptureAction(ids, action, payload);
    toast({ kind: "success", message: `${label}: ${ids.length} capture${ids.length === 1 ? "" : "s"}` });
    setPending(null);
    onClear();
  };
  const run = (action: BatchCaptureAction, payload: Parameters<typeof batchCaptureAction>[2] | undefined, label: string) => {
    if (ids.length >= LARGE) setPending({ action, payload, label }); // impact summary first
    else apply(action, payload, label);
  };

  if (pending) {
    return (
      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border border-amber-500/40 bg-amber-50/95 p-3 text-xs shadow-lg dark:bg-amber-950/40">
        <span className="text-amber-800 dark:text-amber-200">This will <strong>{pending.label.toLowerCase()}</strong> {ids.length} captures. You can restore them afterwards.</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setPending(null)} className="rounded-full border border-black/[.12] px-3 py-1 dark:border-white/[.15]">Cancel</button>
          <button type="button" onClick={() => apply(pending.action, pending.payload, pending.label)} className="rounded-full bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">Continue</button>
        </span>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-t-2xl border border-black/[.10] bg-white/95 p-3 shadow-lg backdrop-blur dark:border-white/[.12] dark:bg-zinc-900/95">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{ids.length} selected</span>
        <button type="button" onClick={onClear} className="text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Clear</button>
      </div>
      {mode === "" ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setMode("link_workspace")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Link workspace</button>
          <button type="button" onClick={() => setMode("link_project")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Link project</button>
          <button type="button" onClick={() => setMode("add_tag")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Add tag</button>
          <button type="button" onClick={() => run("defer", { option: "tomorrow" }, "Defer")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Defer</button>
          <button type="button" onClick={() => run("mark_processed", undefined, "Mark processed")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Mark processed</button>
          <button type="button" onClick={() => run("archive", undefined, "Archive")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Archive</button>
          <button type="button" onClick={() => run("restore", undefined, "Restore")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Restore</button>
        </div>
      ) : mode === "add_tag" ? (
        <div className="flex items-center gap-2">
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag…" aria-label="Batch tag" className="flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <button type="button" onClick={() => { if (tag.trim()) run("add_tag", { tag: tag.trim() }, "Tag"); setTag(""); }} className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Add</button>
          <button type="button" onClick={() => setMode("")} className="text-[11px] text-zinc-400">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1"><EntityPicker onPick={(r) => { run(mode, { id: r.id }, "Link"); setMode(""); }} placeholder={mode === "link_workspace" ? "Pick a workspace…" : "Pick a project…"} kinds={[mode === "link_workspace" ? "workspace" : "project"]} /></div>
          <button type="button" onClick={() => setMode("")} className="text-[11px] text-zinc-400">Cancel</button>
        </div>
      )}
    </div>
  );
}
