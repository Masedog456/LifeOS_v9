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

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument, useStore } from "@/lib/mvpStore";
import { buildImpact } from "@/lib/ux/confirmations";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { toast } from "@/lib/ux/feedback";
import {
  canRetryOriginalBackup, ownsOriginalBackup, removeStoredOriginal, resolveStoredOriginal,
  retryOriginalBackup, type OriginalAvailability,
} from "@/lib/reading/backupManager";
import { getSemanticIndexBackend, removeIndexForDocument } from "@/lib/reading/semanticIndex";
import type { ReadingDocument } from "@/types/mvp";

export default function OriginalStatus({ doc }: { doc: ReadingDocument }) {
  const state = useStore();
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [opening, setOpening] = useState(false);
  const meta = doc.sourceMetadata;
  const isUpload = meta.addMethod === "upload";

  /**
   * Transient upload states belong to the session holding the File, not to the
   * document (LIFEOS-075 C-5). `originalBackup` used to be trusted verbatim, so
   * a second device — or the same device after a reload — showed "Uploading
   * original…" for an operation it was not running and could not finish.
   */
  const ownsUpload = ownsOriginalBackup(doc.id);
  const stored = Boolean(isUpload && (meta.originalStored || meta.originalBackup === "stored"));

  const backup: "uploading" | "stored" | "failed" | null =
    !isUpload ? null
      : meta.originalBackup === "uploading" && ownsUpload ? "uploading"
      : stored ? "stored"
      : meta.originalBackup === "failed" ? "failed"
      : null;

  /**
   * "Original safely stored" was a claim about a remote object that nothing had
   * ever checked (LIFEOS-075 §4). After C-2, a resurrected document could carry
   * `originalStored: true` pointing at bytes another device had already deleted
   * — metadata without a blob, presented as safety.
   *
   * So the claim is now verified before it is made: one short-lived signed URL
   * is resolved on open. The URL is deliberately DISCARDED — it lives 60
   * seconds, and "Open original" resolves a fresh one — so nothing
   * credential-bearing is held in component state or written to the store.
   */
  // The probe result is stored WITH the identity it describes, and "checking" is
  // derived rather than assigned — so switching documents shows "checking"
  // immediately, on the render itself, with no setState inside the effect and
  // no window in which one document displays another's answer.
  const probeKey = `${doc.id}|${meta.originalStoragePath ?? ""}`;
  const [probe, setProbe] = useState<{ key: string; value: OriginalAvailability } | null>(null);
  const avail: OriginalAvailability | "checking" = probe?.key === probeKey ? probe.value : "checking";

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    void resolveStoredOriginal(doc.id, meta.originalStoragePath).then((r) => {
      if (!cancelled) setProbe({ key: probeKey, value: r.availability });
    });
    return () => { cancelled = true; };
  }, [doc.id, stored, meta.originalStoragePath, probeKey]);

  const openOriginal = useCallback(async () => {
    setOpening(true);
    try {
      const r = await resolveStoredOriginal(doc.id, meta.originalStoragePath);
      setProbe({ key: probeKey, value: r.availability });
      if (r.availability === "available" && r.url) {
        window.open(r.url, "_blank", "noopener,noreferrer");
        return;
      }
      toast({
        kind: "error",
        message: r.availability === "missing"
          ? "That original isn’t in storage any more. Your reading and notes are unaffected."
          : "We couldn’t open the original just now. Please try again.",
      });
    } finally {
      setOpening(false);
    }
  }, [doc.id, meta.originalStoragePath, probeKey]);

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
        // Also drop the reading's semantic index (LIFEOS-049). Best-effort and
        // non-blocking for deletion: the index holds only numbers derived from
        // text we are deleting anyway, and it is re-derivable.
        try {
          const idx = await getSemanticIndexBackend();
          if (idx) await removeIndexForDocument(idx, doc.id);
        } catch { /* index cleanup is best-effort */ }
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
      {backup === "stored" && avail === "checking" && (
        <span data-original-status="checking" className="inline-flex items-center gap-1 text-[11px] text-zinc-500">Checking the original…</span>
      )}
      {backup === "stored" && avail === "available" && (
        <span data-original-status="stored" className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          ✓ Original safely stored
          <button
            type="button"
            data-original-open
            disabled={opening}
            onClick={() => void openOriginal()}
            className="rounded-full border border-current px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
          >
            {opening ? "Opening…" : "Open original"}
          </button>
        </span>
      )}
      {backup === "stored" && avail === "missing" && (
        <span data-original-status="missing" className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          The original file is no longer in storage. Your reading and notes are unaffected.
        </span>
      )}
      {backup === "stored" && avail === "unknown" && (
        <span data-original-status="unknown" className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
          We couldn’t check the original just now.
        </span>
      )}
      {backup === "stored" && avail === "no-capability" && (
        <span data-original-status="signed-out" className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
          Sign in to open the original.
        </span>
      )}
      {backup === "failed" && (
        <span data-original-status="failed" className="inline-flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          {canRetryOriginalBackup(doc.id)
            ? "Your reading was added, but the original file wasn’t backed up."
            : "Your reading was added, but the original file isn’t stored. Add the file again to store it."}
          {canRetryOriginalBackup(doc.id) && (
            <button type="button" onClick={() => { retryOriginalBackup(doc.id); toast({ kind: "info", message: "Retrying backup…" }); }} className="rounded-full border border-current px-2 py-0.5 text-[11px] font-medium">Retry backup</button>
          )}
        </span>
      )}
      <button type="button" disabled={removing} onClick={remove} className="text-[11px] text-zinc-400 hover:text-red-500 disabled:opacity-40">Remove</button>
    </div>
  );
}
