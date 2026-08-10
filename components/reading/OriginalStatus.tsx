"use client";

/**
 * Original-file status + safe removal (LIFEOS-047A) — a calm, consumer-facing
 * strip in the reader. It shows, only for uploaded readings whose original was
 * actually attempted, whether the ORIGINAL file is safely stored, still
 * uploading, or not backed up (with an in-session Retry). It also owns "Remove
 * from library", which uses the existing impact-preview confirmation and removes
 * the stored original before deleting the reading — never orphaning a file, and
 * never pretending cleanup happened when it didn't.
 *
 * No infrastructure words (bucket / object key / RLS / checksum / Supabase) reach
 * the user — only plain outcomes.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument, useStore } from "@/lib/mvpStore";
import { buildImpact } from "@/lib/ux/confirmations";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { toast } from "@/lib/ux/feedback";
import { canRetryOriginalBackup, removeStoredOriginal, retryOriginalBackup } from "@/lib/reading/backupManager";
import type { ReadingDocument } from "@/types/mvp";

export default function OriginalStatus({ doc }: { doc: ReadingDocument }) {
  const state = useStore();
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const meta = doc.sourceMetadata;
  const isUpload = meta.addMethod === "upload";

  // Backup pill only appears for uploads where a backup was actually attempted
  // (so local-only mode and paste/link show nothing at all).
  const backup: "uploading" | "stored" | "failed" | null =
    !isUpload ? null
      : meta.originalBackup === "uploading" ? "uploading"
      : meta.originalStored || meta.originalBackup === "stored" ? "stored"
      : meta.originalBackup === "failed" ? "failed"
      : null;

  const remove = () => {
    requestConfirm({
      impact: buildImpact(state, "document", doc.id),
      confirmLabel: "Remove from library",
      onConfirm: async () => {
        setRemoving(true);
        // Clean up the stored original FIRST; if it can't be removed right now,
        // keep the reading rather than orphaning the file or faking cleanup.
        const res = await removeStoredOriginal(doc.id);
        if (!res.ok) {
          setRemoving(false);
          toast({ kind: "error", message: "We couldn't remove the stored original just now — your reading wasn't deleted. Please try again." });
          return;
        }
        deleteDocument(doc.id);
        toast({ kind: "success", message: "Removed from your library" });
        router.push("/reading");
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      {backup === "uploading" && (
        <span data-original-status="uploading" className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
          <span aria-hidden className="inline-block animate-pulse">•</span> Uploading original…
        </span>
      )}
      {backup === "stored" && (
        <span data-original-status="stored" className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">✓ Original safely stored</span>
      )}
      {backup === "failed" && (
        <span data-original-status="failed" className="inline-flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          Your reading was added, but the original file wasn’t backed up.
          {canRetryOriginalBackup(doc.id) && (
            <button type="button" onClick={() => { retryOriginalBackup(doc.id); toast({ kind: "info", message: "Retrying backup…" }); }} className="rounded-full border border-current px-2 py-0.5 text-[11px] font-medium">Retry backup</button>
          )}
        </span>
      )}
      <button type="button" disabled={removing} onClick={remove} className="text-[11px] text-zinc-400 hover:text-red-500 disabled:opacity-40">Remove</button>
    </div>
  );
}
