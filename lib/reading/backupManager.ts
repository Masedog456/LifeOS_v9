"use client";

/**
 * In-session original-file backup manager (LIFEOS-047A).
 *
 * Bridges the tested, pure orchestration in `lib/reading/originals.ts` to the
 * live store and the browser's in-memory File. Text extraction and
 * ReadingDocument creation stay the FAST path; the original binary is uploaded
 * asynchronously afterwards, so the reader opens immediately and never blocks on
 * the network.
 *
 * The picked File cannot be reconstructed after a reload (browsers don't persist
 * it), so we hold it here for the session to power an honest "Retry backup". Once
 * the original is safely stored we drop the File. Across a reload, `originalStored`
 * (which is durable in the document's provenance) tells the truth, and a
 * not-yet-backed-up original simply needs re-adding — we never pretend.
 *
 * Guards against duplicate work from re-renders (an in-flight set), and is a
 * silent no-op when there is no capability (local-only mode or signed out).
 */

import { setDocumentOriginal } from "@/lib/mvpStore";
import {
  backupOriginal, removeOriginalsForDocument, getOriginalsBackend, originalsConfigured,
} from "@/lib/reading/originals";

interface PendingBackup {
  file: File;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
}

// docId -> the picked File + provenance, kept only for this session (for Retry).
const pending = new Map<string, PendingBackup>();
const inFlight = new Set<string>();

/** Whether original-file backup is even possible in this environment. */
export function originalsCapabilityConfigured(): boolean {
  return originalsConfigured();
}

/** Whether a failed backup can be retried right now (the File is still in memory). */
export function canRetryOriginalBackup(docId: string): boolean {
  return pending.has(docId);
}

async function run(docId: string): Promise<void> {
  const p = pending.get(docId);
  if (!p || inFlight.has(docId)) return;
  const backend = await getOriginalsBackend();
  if (!backend) return; // no capability — leave state untouched (nothing to back up to)

  inFlight.add(docId);
  setDocumentOriginal(docId, { originalBackup: "uploading" });
  try {
    const res = await backupOriginal(backend, {
      documentId: docId,
      filename: p.filename,
      contentType: p.contentType,
      sizeBytes: p.sizeBytes,
      checksum: p.checksum,
      data: p.file,
    });
    if (res.ok) {
      setDocumentOriginal(docId, {
        originalStored: true,
        originalBackup: "stored",
        originalStoragePath: res.storagePath,
        originalFileId: res.fileId,
      });
      pending.delete(docId); // safely stored — the in-memory File is no longer needed
    } else if (res.stage === "capability") {
      // Signed out between kickoff and run: nothing to show, nothing stored.
      setDocumentOriginal(docId, { originalBackup: undefined });
      pending.delete(docId);
    } else {
      // Honest, recoverable failure — the ReadingDocument is intact and usable.
      setDocumentOriginal(docId, { originalStored: false, originalBackup: "failed" });
    }
  } finally {
    inFlight.delete(docId);
  }
}

/**
 * Kick off (or, if already registered, restart) an original-file backup for a
 * freshly-created ReadingDocument. Only meaningful for real file uploads; paste
 * and link have no original binary. Fire-and-forget — safe to call then navigate.
 */
export function startOriginalBackup(docId: string, file: File, prov: { filename: string; contentType: string; sizeBytes: number; checksum: string }): void {
  if (!originalsConfigured()) return; // local-only mode: no cloud, nothing to back up
  pending.set(docId, { file, ...prov });
  void run(docId);
}

/** Retry a failed backup using the File still held for this session. */
export function retryOriginalBackup(docId: string): void {
  if (!pending.has(docId)) return; // File gone (e.g. after reload) — cannot retry in place
  void run(docId);
}

/**
 * Remove a document's stored original(s) as part of deleting the document.
 * Returns an honest result so the caller can surface a partial-cleanup state.
 * A no-op (ok) when there is no capability or nothing was ever stored.
 */
export async function removeStoredOriginal(docId: string): Promise<{ ok: boolean; removed: number; reason?: string }> {
  pending.delete(docId);
  if (!originalsConfigured()) return { ok: true, removed: 0 };
  const backend = await getOriginalsBackend();
  if (!backend) return { ok: true, removed: 0 };
  return removeOriginalsForDocument(backend, docId);
}
