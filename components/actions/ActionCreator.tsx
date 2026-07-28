"use client";

/**
 * Action creator (LIFEOS-036, Feature 2). The single creation form used by every
 * entry point. Context can be PRE-FILLED (from a milestone, capture, project,
 * session…) but the user confirms every field. Nothing is auto-classified — size,
 * energy, and context default to "unspecified"/empty until the user chooses.
 */

import { useState } from "react";
import { createAction } from "@/lib/mvpStore";
import type { NewActionInput } from "@/lib/actions/action";
import type { ActionSize, ActionEnergy } from "@/types/mvp";
import { SIZE_LABEL, ENERGY_LABEL, CONTEXT_SUGGESTIONS } from "@/lib/actions/status";
import { toast } from "@/lib/ux/feedback";

const SIZES: ActionSize[] = ["unspecified", "tiny", "small", "medium", "large"];
const ENERGIES: ActionEnergy[] = ["unspecified", "low", "medium", "high"];

export default function ActionCreator({ prefill = {}, onCreated, onCancel, sourceLabel }: {
  prefill?: Partial<NewActionInput>;
  onCreated?: (id: string) => void;
  onCancel?: () => void;
  sourceLabel?: string;
}) {
  const [title, setTitle] = useState(prefill.title ?? "");
  const [description, setDescription] = useState(prefill.description ?? "");
  const [size, setSize] = useState<ActionSize>(prefill.estimatedSize ?? "unspecified");
  const [energy, setEnergy] = useState<ActionEnergy>(prefill.energy ?? "unspecified");
  const [context, setContext] = useState(prefill.context ?? "");
  const [tags, setTags] = useState((prefill.tags ?? []).join(", "));

  const submit = () => {
    if (!title.trim()) { toast({ kind: "error", message: "A next action needs a title" }); return; }
    const input: NewActionInput = {
      ...prefill,
      title: title.trim(),
      description: description.trim(),
      estimatedSize: size,
      energy,
      context: context.trim() || undefined,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const id = createAction(input);
    toast({ kind: "success", message: "Action created" });
    onCreated?.(id);
  };

  return (
    <div className="flex flex-col gap-2" data-action-creator>
      {sourceLabel && <p className="text-[11px] text-zinc-500">Creating from <span className="font-medium">{sourceLabel}</span> — confirm the details.</p>}
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} placeholder="What can you concretely do next?" aria-label="Action title" className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-white/12" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details (optional)" aria-label="Description" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="text-zinc-500">Size
          <select value={size} onChange={(e) => setSize(e.target.value as ActionSize)} aria-label="Estimated size" className="ml-1 rounded-md border border-black/10 bg-transparent px-1.5 py-1 dark:border-white/12">
            {SIZES.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-zinc-500">Energy
          <select value={energy} onChange={(e) => setEnergy(e.target.value as ActionEnergy)} aria-label="Energy" className="ml-1 rounded-md border border-black/10 bg-transparent px-1.5 py-1 dark:border-white/12">
            {ENERGIES.map((s) => <option key={s} value={s}>{ENERGY_LABEL[s]}</option>)}
          </select>
        </label>
        <input list="ctx-suggestions" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context…" aria-label="Context" className="w-28 rounded-md border border-black/10 bg-transparent px-2 py-1 dark:border-white/12" />
        <datalist id="ctx-suggestions">{CONTEXT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma-sep" aria-label="Tags" className="min-w-0 flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 dark:border-white/12" />
      </div>
      <div className="flex items-center justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Cancel</button>}
        <button type="button" onClick={submit} disabled={!title.trim()} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Create action</button>
      </div>
    </div>
  );
}
