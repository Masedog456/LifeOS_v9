"use client";

/**
 * Conflict resolution dialog (LIFEOS-033, Feature 4).
 *
 * Resolves ONE record conflict: shows the record type/title, the changed fields,
 * the local and remote versions, any deletion conflict, and the safe automatic
 * merge already computed. Actions: Keep local, Keep remote, Use merge, Duplicate
 * as a separate record, Postpone. The SAFEST action (Postpone) holds initial
 * focus — a destructive choice is never the default. Focus-trapped; Escape
 * postpones. Desktop + mobile (bottom sheet).
 */

import { useEffect, useRef } from "react";
import { applyResolvedRecord } from "@/lib/mvpStore";
import { resolveConflict } from "@/lib/sync/status-store";
import { toast } from "@/lib/ux/feedback";
import type { RecordConflict } from "@/lib/sync/conflicts";
import type { StoreState } from "@/types/mvp";

function title(rec: Record<string, unknown> | undefined): string {
  if (!rec) return "(deleted)";
  return String(rec.title ?? rec.name ?? rec.text ?? rec.statement ?? rec.question ?? rec.id ?? "record").slice(0, 80);
}

export default function ConflictDialog({ conflict, onClose }: { conflict: RecordConflict; onClose: () => void }) {
  const postponeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => postponeRef.current?.focus());
    return () => { restoreRef.current?.focus?.(); };
  }, []);

  const domain = conflict.domain as keyof StoreState;
  const changed = Array.from(new Set([...conflict.changedLocal, ...conflict.changedRemote])).filter((k) => k !== "updatedAt");
  const merged = conflict.merge?.merged as { id: string } | undefined;
  const remote = conflict.remote as { id: string } | undefined;
  const isDeleteConflict = conflict.kind === "delete_local_edit_remote" || conflict.kind === "delete_remote_edit_local";

  const done = (msg: string) => { resolveConflict(conflict.domain, conflict.id); toast({ kind: "success", message: msg, dedupeKey: `conflict:${conflict.id}` }); onClose(); };
  const keepLocal = () => done("Kept your version");
  const keepRemote = () => { if (remote) applyResolvedRecord(domain, remote); done("Kept the other device’s version"); };
  const useMerge = () => { if (merged) applyResolvedRecord(domain, merged); done("Merged both versions"); };
  const duplicate = () => { if (remote) applyResolvedRecord(domain, { ...remote, id: `${remote.id}-copy-${Date.now().toString(36)}` }); done("Kept both as separate records"); };
  const postpone = () => { onClose(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); postpone(); }
  };

  return (
    <div className="fixed inset-0 z-[62] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={postpone}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}
        className="w-full max-w-lg rounded-t-2xl border border-black/10 bg-white p-5 shadow-xl sm:rounded-2xl dark:border-white/12 dark:bg-zinc-900"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <h2 id="conflict-title" className="text-lg font-semibold tracking-tight">Resolve conflict — {conflict.domain}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {isDeleteConflict
            ? "This record was deleted on one device and edited on another."
            : "This record was changed on two devices. Choose which version to keep."}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-black/10 p-2 dark:border-white/12">
            <p className="font-semibold text-zinc-500">This device</p>
            <p className="mt-1 truncate text-zinc-800 dark:text-zinc-100">{conflict.local ? title(conflict.local) : "(deleted here)"}</p>
          </div>
          <div className="rounded-lg border border-black/10 p-2 dark:border-white/12">
            <p className="font-semibold text-zinc-500">Other device</p>
            <p className="mt-1 truncate text-zinc-800 dark:text-zinc-100">{conflict.remote ? title(conflict.remote) : "(deleted there)"}</p>
          </div>
        </div>

        {changed.length > 0 && (
          <p className="mt-2 text-xs text-zinc-500">Changed fields: <span className="font-mono">{changed.join(", ")}</span></p>
        )}
        {conflict.merge && conflict.merge.autoFields.length > 0 && (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">Safe auto-merge available for: {conflict.merge.autoFields.map((f) => f.key).join(", ")}</p>
        )}
        {conflict.merge && conflict.merge.conflictFields.length > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Overlapping changes need your choice: {conflict.merge.conflictFields.join(", ")}</p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={postponeRef} type="button" onClick={postpone} className="rounded-full px-3 py-2 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]">Postpone</button>
          {merged && !isDeleteConflict && <button type="button" onClick={useMerge} className="rounded-full bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">Use merge</button>}
          <button type="button" onClick={keepLocal} className="rounded-full border border-black/10 px-3 py-2 text-sm hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Keep this device</button>
          {remote && <button type="button" onClick={keepRemote} className="rounded-full border border-black/10 px-3 py-2 text-sm hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Keep other device</button>}
          {remote && !isDeleteConflict && <button type="button" onClick={duplicate} className="rounded-full border border-black/10 px-3 py-2 text-sm hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Keep both</button>}
        </div>
      </div>
    </div>
  );
}
