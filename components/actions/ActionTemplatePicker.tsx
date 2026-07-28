"use client";

/**
 * Action template picker (LIFEOS-036, Feature 11). Lists reusable templates and
 * lets the user explicitly instantiate one (opening the creator pre-filled) or
 * create a new template. There is NO background recurrence — `suggestedRecurrence`
 * is only a human hint shown on the card.
 */

import { useState } from "react";
import { useStore, createActionTemplate, deleteActionTemplate } from "@/lib/mvpStore";
import { instantiateTemplate } from "@/lib/actions/templates";
import type { NewActionInput } from "@/lib/actions/action";
import { toast } from "@/lib/ux/feedback";

export default function ActionTemplatePicker({ onInstantiate }: { onInstantiate: (prefill: NewActionInput) => void }) {
  const state = useStore();
  const templates = state.actionTemplates ?? [];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [recurrence, setRecurrence] = useState("");

  const create = () => {
    if (!title.trim()) return;
    createActionTemplate({ title: title.trim(), suggestedRecurrence: recurrence.trim() || undefined });
    toast({ kind: "success", message: "Template saved" });
    setTitle(""); setRecurrence(""); setCreating(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Templates</p>
        <button type="button" onClick={() => setCreating((v) => !v)} className="text-[11px] text-sky-600 dark:text-sky-400">{creating ? "Close" : "+ New template"}</button>
      </div>
      {creating && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-black/[.08] p-2 dark:border-white/[.10]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Template title (e.g. Weekly review)" aria-label="Template title" className="rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="Suggested recurrence (e.g. weekly) — a note, not a schedule" aria-label="Suggested recurrence" className="rounded-md border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <button type="button" onClick={create} disabled={!title.trim()} className="self-end rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save template</button>
        </div>
      )}
      {templates.length === 0 ? <p className="text-xs text-zinc-500">No templates yet.</p> : (
        <ul className="flex flex-col gap-1.5">
          {templates.map((t) => (
            <li key={t.id} data-template-id={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/[.06] p-2 text-xs dark:border-white/[.08]">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.title}</p>
                {t.suggestedRecurrence && <p className="text-[10px] text-zinc-400">suggested: {t.suggestedRecurrence}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => onInstantiate(instantiateTemplate(t))} className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Use</button>
                <button type="button" onClick={() => { deleteActionTemplate(t.id); toast({ kind: "info", message: "Template deleted" }); }} aria-label={`Delete ${t.title}`} className="text-zinc-400 hover:text-rose-500">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
