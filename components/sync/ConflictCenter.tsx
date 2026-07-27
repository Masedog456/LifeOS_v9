"use client";

/**
 * Conflict center (LIFEOS-033, Feature 4).
 *
 * Lists unresolved sync conflicts (from the reactive sync-status store) and opens
 * the shared `ConflictDialog` to resolve each. Renders nothing when there are no
 * conflicts. Automatic field-level merges are applied before a conflict ever
 * reaches this list, so what remains is genuinely user-authored divergence.
 */

import { useState } from "react";
import { useSyncStatus } from "@/lib/sync/status-store";
import ConflictDialog from "@/components/sync/ConflictDialog";
import type { RecordConflict } from "@/lib/sync/conflicts";

export default function ConflictCenter() {
  const { conflicts } = useSyncStatus();
  const [active, setActive] = useState<RecordConflict | null>(null);
  const unresolved = conflicts.filter((c) => c.needsResolution);
  if (unresolved.length === 0) return null;

  return (
    <section aria-label="Sync conflicts" className="rounded-xl border border-rose-500/40 bg-rose-50/60 p-4 dark:bg-rose-950/25">
      <h2 className="text-sm font-semibold tracking-tight text-rose-700 dark:text-rose-300">
        {unresolved.length} conflict{unresolved.length === 1 ? "" : "s"} need your decision
      </h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Two devices changed the same record. Your work is safe — nothing was overwritten.</p>
      <ul className="mt-2 divide-y divide-black/[.06] dark:divide-white/[.08]">
        {unresolved.map((c) => (
          <li key={`${c.domain}:${c.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="truncate">{c.domain} · <span className="font-mono text-xs">{c.id}</span> <span className="text-zinc-400">({c.kind.replace(/_/g, " ")})</span></span>
            <button type="button" onClick={() => setActive(c)} className="shrink-0 rounded-full bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700">Resolve</button>
          </li>
        ))}
      </ul>
      {active && <ConflictDialog conflict={active} onClose={() => setActive(null)} />}
    </section>
  );
}
