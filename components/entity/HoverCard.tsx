"use client";

/**
 * HoverCard (LIFEOS-029, Feature 8).
 *
 * An instant, deterministic preview shown when hovering (or focusing) an entity
 * reference: title, type, summary, relationship + backlink counts, pinned state,
 * last edit, and an Open button that reveals it in the unified inspector. Pure
 * projection via `entityPreview`; no network, no AI.
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext } from "@/lib/entities/entity";
import { entityPreview } from "@/lib/entities/preview";
import { relativeTime } from "@/lib/entities/timeline";
import { isPinned } from "@/lib/command/recent";
import { openInspector } from "@/lib/entities/inspector";

export default function HoverCard({ kind, id, onOpen }: { kind: string; id: string; onOpen?: () => void }) {
  const state = useStore();
  const preview = useMemo(() => entityPreview(makeEntityContext(state), kind, id), [state, kind, id]);
  const pinned = isPinned(kind, id);

  if (!preview.ref.exists) {
    return <div className="w-64 rounded-xl border border-black/[.10] bg-white p-3 text-xs text-zinc-400 shadow-xl dark:border-white/[.12] dark:bg-zinc-900">This record no longer exists.</div>;
  }

  return (
    <div role="dialog" aria-label={`Preview: ${preview.ref.title}`} className="w-72 rounded-xl border border-black/[.10] bg-white p-3 shadow-xl dark:border-white/[.12] dark:bg-zinc-900">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{preview.kindLabel}</span>
        {pinned && <span className="text-amber-500" title="Pinned">★</span>}
        {preview.status && <span className="rounded-full bg-black/[.05] px-1.5 py-0.5 text-[9px] text-zinc-500 dark:bg-white/[.06]">{preview.status}</span>}
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">{preview.ref.title}</p>
      {preview.summary && <p className="mt-1 line-clamp-3 text-[12px] text-zinc-500">{preview.summary}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
        <span>{preview.relationships} relationship{preview.relationships === 1 ? "" : "s"}</span>
        <span>{preview.backlinks} backlink{preview.backlinks === 1 ? "" : "s"}</span>
        {preview.lastActivityAt && <span>edited {relativeTime(preview.lastActivityAt)}</span>}
      </div>
      <button
        type="button"
        onClick={() => { openInspector(kind, id); onOpen?.(); }}
        className="mt-2.5 w-full rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Open in inspector →
      </button>
    </div>
  );
}
