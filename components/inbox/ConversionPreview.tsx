"use client";

/**
 * Conversion preview (LIFEOS-035, Feature 5). Pick a canonical target, preview
 * exactly what is copied + what remains on the original, choose the source's
 * fate, and convert (reusing the canonical creators). The source capture is
 * never deleted automatically.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, convertCapture } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { CONVERSION_TARGETS, previewConversion, type ConversionTargetKey } from "@/lib/inbox/conversion";
import EntityPicker from "@/components/reviews/EntityPicker";
import { toast } from "@/lib/ux/feedback";
import type { Capture, RecordRefLite } from "@/types/mvp";

export default function ConversionPreview({ capture, onConverted }: { capture: Capture; onConverted?: (ref: RecordRefLite) => void }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const [target, setTarget] = useState<ConversionTargetKey | "">("");
  const [contextId, setContextId] = useState<string | undefined>();
  const [contextTitle, setContextTitle] = useState("");
  const [after, setAfter] = useState<"inbox" | "processed" | "archive">("processed");

  const targetDef = CONVERSION_TARGETS.find((t) => t.key === target);
  const preview = target ? previewConversion(state, capture, target, contextId) : null;
  const ready = !!preview && (!targetDef?.needsContext || !!contextId);

  const doConvert = () => {
    if (!target || !ready) return;
    const ref = convertCapture(capture.id, target, { contextId, after });
    if (ref) { toast({ kind: "success", message: `Converted to ${targetDef?.label}` }); onConverted?.(ref); }
    else toast({ kind: "error", message: "Couldn’t convert" });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {CONVERSION_TARGETS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTarget(t.key); setContextId(undefined); setContextTitle(""); }}
            className={`rounded-full px-2.5 py-1 text-[11px] ${target === t.key ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>{t.label}</button>
        ))}
      </div>

      {targetDef?.needsContext && (
        <div>
          <p className="mb-1 text-[11px] text-zinc-500">Choose a {targetDef.needsContext} to append to</p>
          {contextId ? <button type="button" onClick={() => { setContextId(undefined); setContextTitle(""); }} className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">{contextTitle} ✕</button>
            : <EntityPicker onPick={(r, title) => { setContextId(r.id); setContextTitle(title); }} placeholder={`Pick a ${targetDef.needsContext}…`} kinds={[targetDef.needsContext]} />}
        </div>
      )}

      {preview && (
        <div className="rounded-lg border border-black/[.08] p-3 text-xs dark:border-white/[.10]">
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-200">New {preview.targetLabel} — copied fields</p>
          <dl className="flex flex-col gap-1">
            {preview.copiedFields.map((f, i) => (
              <div key={i}><dt className="text-[10px] uppercase tracking-wide text-zinc-400">{f.label}</dt><dd className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">{f.value}</dd></div>
            ))}
          </dl>
          {(preview.context.workspaceId || preview.context.projectId) && (
            <p className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-zinc-400">Context:
              {preview.context.projectId && (() => { const r = entityRef(ctx, "project", preview.context.projectId!); return <Link href={r.href} className="text-sky-600 dark:text-sky-400">{r.title}</Link>; })()}
              {preview.context.workspaceId && (() => { const r = entityRef(ctx, "workspace", preview.context.workspaceId!); return <Link href={r.href} className="text-sky-600 dark:text-sky-400">{r.title}</Link>; })()}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-zinc-500">{preview.remainsOnOriginal}</p>
        </div>
      )}

      {preview && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[11px] text-zinc-500">Then the capture:
            <select value={after} onChange={(e) => setAfter(e.target.value as typeof after)} aria-label="After conversion" className="ml-1 rounded-md border border-black/10 bg-transparent px-1.5 py-1 text-xs dark:border-white/12">
              <option value="processed">Mark processed</option>
              <option value="archive">Archive</option>
              <option value="inbox">Keep in inbox</option>
            </select>
          </label>
          <button type="button" onClick={doConvert} disabled={!ready} className="ml-auto rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Convert</button>
        </div>
      )}
    </div>
  );
}
