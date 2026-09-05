"use client";

/**
 * Batch action bar (LIFEOS-036, Feature 12). Multi-select operations: link to
 * project/workspace, add tag, set context/energy/size, defer, mark waiting,
 * complete, cancel, restore. NEVER batch title/notes edits; NEVER batch
 * conversion. Destructive/large operations require an impact confirmation.
 */

import { useState } from "react";
import { batchAction, type BatchActionOp } from "@/lib/mvpStore";
import EntityPicker from "@/components/reviews/EntityPicker";
import ReplanPreview from "@/components/planning/ReplanPreview";
import { toast } from "@/lib/ux/feedback";

const LARGE = 10;
const DESTRUCTIVE = new Set<BatchActionOp>(["complete", "cancel"]);

export default function BatchActionBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [mode, setMode] = useState<"" | "link_project" | "link_workspace" | "add_tag" | "set_context">("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<null | { op: BatchActionOp; payload?: Parameters<typeof batchAction>[2]; label: string }>(null);
  /**
   * LIFEOS-090 §18, §19. Deferring a mixed selection is not one mutation.
   *
   * The old button called `batchAction(ids, "defer")` straight through, which
   * the audit measured orphaning a wait and parking a recurring series in the
   * same press. It now opens a preview that judges each item on its own.
   */
  const [replanning, setReplanning] = useState(false);
  if (ids.length === 0) return null;

  const apply = (op: BatchActionOp, payload: Parameters<typeof batchAction>[2] | undefined, label: string) => {
    batchAction(ids, op, payload);
    toast({ kind: "success", message: `${label}: ${ids.length} action${ids.length === 1 ? "" : "s"}` });
    setPending(null); setMode(""); setText(""); onClear();
  };
  const run = (op: BatchActionOp, payload: Parameters<typeof batchAction>[2] | undefined, label: string) => {
    if (ids.length >= LARGE || DESTRUCTIVE.has(op)) setPending({ op, payload, label });
    else apply(op, payload, label);
  };

  if (replanning) {
    return (
      <div className="sticky bottom-0 z-10 rounded-t-2xl border border-black/[.10] bg-white/95 p-3 shadow-lg backdrop-blur dark:border-white/[.12] dark:bg-zinc-900/95">
        <ReplanPreview
          ids={ids}
          onDone={() => { setReplanning(false); onClear(); }}
          onCancel={() => setReplanning(false)}
        />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border border-amber-500/40 bg-amber-50/95 p-3 text-xs shadow-lg dark:bg-amber-950/40">
        <span className="text-amber-800 dark:text-amber-200">This will <strong>{pending.label.toLowerCase()}</strong> {ids.length} action{ids.length === 1 ? "" : "s"}. You can restore them afterwards.</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setPending(null)} className="rounded-full border border-black/[.12] px-3 py-1 dark:border-white/[.15]">Cancel</button>
          <button type="button" onClick={() => apply(pending.op, pending.payload, pending.label)} className="rounded-full bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">Continue</button>
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
          <button type="button" onClick={() => setMode("link_project")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Link project</button>
          <button type="button" onClick={() => setMode("link_workspace")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Link workspace</button>
          <button type="button" onClick={() => setMode("add_tag")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Add tag</button>
          <button type="button" onClick={() => setMode("set_context")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Set context</button>
          <button type="button" onClick={() => run("set_energy", { energy: "high" }, "Energy: high")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Energy: high</button>
          <button type="button" onClick={() => run("set_size", { size: "small" }, "Size: small")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Size: small</button>
          <button type="button" data-batch-not-today onClick={() => setReplanning(true)} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Not today</button>
          <button type="button" onClick={() => run("mark_waiting", { waitingOn: "" }, "Mark waiting")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Mark waiting</button>
          <button type="button" onClick={() => run("complete", undefined, "Complete")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Complete</button>
          <button type="button" onClick={() => run("cancel", undefined, "Cancel")} className="rounded-full border border-rose-500/30 px-3 py-1 text-[11px] text-rose-600 dark:text-rose-400">Cancel</button>
          <button type="button" onClick={() => run("restore", undefined, "Restore")} className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] dark:border-white/[.15]">Restore</button>
        </div>
      ) : mode === "add_tag" || mode === "set_context" ? (
        <div className="flex items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "add_tag" ? "Tag…" : "Context…"} aria-label={mode === "add_tag" ? "Batch tag" : "Batch context"} className="flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <button type="button" onClick={() => { if (text.trim()) run(mode === "add_tag" ? "add_tag" : "set_context", mode === "add_tag" ? { tag: text.trim() } : { context: text.trim() }, mode === "add_tag" ? "Tag" : "Context"); }} className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Apply</button>
          <button type="button" onClick={() => setMode("")} className="text-[11px] text-zinc-400">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1"><EntityPicker onPick={(r) => run(mode, { id: r.id }, "Link")} placeholder={mode === "link_project" ? "Pick a project…" : "Pick a workspace…"} kinds={[mode === "link_project" ? "project" : "workspace"]} /></div>
          <button type="button" onClick={() => setMode("")} className="text-[11px] text-zinc-400">Cancel</button>
        </div>
      )}
    </div>
  );
}
