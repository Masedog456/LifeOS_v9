"use client";

/**
 * Manual interruption log (LIFEOS-037, Feature 8). The user records an
 * interruption by hand — there is NO automatic detection and no scoring.
 * Interruptions stay compact and surface in the daily-review friction step.
 */

import { useState } from "react";
import { logInterruption, resolveInterruption } from "@/lib/mvpStore";
import type { FocusSession, InterruptionCategory } from "@/types/mvp";
import { toast } from "@/lib/ux/feedback";

const CATEGORIES: InterruptionCategory[] = ["external", "internal", "question", "dependency", "technical", "communication", "other"];

export default function InterruptionLog({ focus }: { focus: FocusSession }) {
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState<InterruptionCategory>("external");

  const add = () => {
    if (!desc.trim()) return;
    logInterruption(focus.id, { description: desc.trim(), category: cat });
    setDesc("");
    toast({ kind: "info", message: "Interruption logged" });
  };

  return (
    <div className="flex flex-col gap-2 text-xs" data-interruption-log>
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="What interrupted you?" aria-label="Interruption description" className="min-w-0 flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 dark:border-white/12" />
        <select value={cat} onChange={(e) => setCat(e.target.value as InterruptionCategory)} aria-label="Interruption category" className="rounded-md border border-black/10 bg-transparent px-1.5 py-1 dark:border-white/12">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" onClick={add} className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Log</button>
      </div>
      {focus.interruptions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {[...focus.interruptions].reverse().map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate ${i.resolved ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-200"}`}>{i.description} <span className="text-[10px] text-zinc-400">· {i.category}</span></span>
              <button type="button" onClick={() => resolveInterruption(focus.id, i.id, !i.resolved)} className="shrink-0 text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">{i.resolved ? "reopen" : "resolve"}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
