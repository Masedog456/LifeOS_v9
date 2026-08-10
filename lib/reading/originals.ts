/**
 * Private original-file persistence for Reading uploads (LIFEOS-047A).
 *
 * LIFEOS-047 extracts an uploaded file's text on-device and stores the parsed
 * ReadingDocument (durable, per-user, RLS-protected). What was missing was a
 * private home for the ORIGINAL binary. This module completes that lifecycle
 * against the infrastructure migration 0032 already created — the private
 * `reading-originals` bucket and the `reading_document_files` metadata table —
 * WITHOUT building a second file-storage system.
 *
 * The logic is split into:
 *   - a small BACKEND SEAM (`OriginalsBackend`) describing exactly the storage +
 *     metadata operations we need, so the orchestration is pure and testable
 *     against a fake backend that simulates per-user RLS isolation; and
 *   - a real backend built from the authenticated Supabase browser client.
 *
 * Ordering & honesty guarantees (see backupOriginal / removeOriginalsForDocument):
 *   - A successful text extraction / ReadingDocument is NEVER destroyed because
 *     original backup failed.
 *   - `originalStored` is only ever true after BOTH the object and its metadata
 *     row are persisted.
 *   - Objects live at a deterministic per-user path `<uid>/<documentId>/<file>`,
 *     so a retry overwrites in place (no orphan accumulation) and deletion is
 *     scoped to one document's own folder — it can never remove another
 *     document's or another user's file.
 *   - Private access only: downloads use short-lived signed URLs, never public
 *     URLs.
 */

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { safeFilename } from "@/lib/reading/ingest";

/** The private bucket + metadata table provisioned by migration 0032. */
export const ORIGINALS_BUCKET = "reading-originals";
export const ORIGINALS_TABLE = "reading_document_files";
/** Signed-URL lifetime for private original downloads (seconds). Short by design. */
export const SIGNED_URL_TTL_SECONDS = 60;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `f_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** The folder that holds one document's original(s): `<uid>/<documentId>`. */
export function folderPrefixFor(userId: string, documentId: string): string {
  return `${userId}/${documentId}`;
}
/** The deterministic object path for a document's original. Stable across retries. */
export function storagePathFor(userId: string, documentId: string, filename: string): string {
  return `${folderPrefixFor(userId, documentId)}/${safeFilename(filename)}`;
}

/** One reading_document_files row (metadata only — never the file's text). */
export interface OriginalFileRow {
  id: string;
  user_id: string;
  document_id: string;
  storage_path: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  processing_state: string;
}

export interface OpResult { ok: boolean; error?: string }
export interface ListResult { ok: boolean; names: string[]; error?: string }
export interface RowsResult { ok: boolean; rows: OriginalFileRow[]; error?: string }
export interface SignedUrlResult { ok: boolean; url?: string; error?: string }

/**
 * The narrow set of storage + metadata operations original-file persistence
 * needs. The real implementation talks to Supabase; tests provide a fake that
 * enforces per-user isolation, so failure/ordering behavior is verified without
 * a live backend. `userId` is the authenticated user's id, or null when there is
 * no capability (local-only mode or signed out) — every orchestration checks it.
 */
export interface OriginalsBackend {
  readonly userId: string | null;
  uploadObject(path: string, data: Blob | ArrayBuffer | Uint8Array, contentType: string): Promise<OpResult>;
  removeObjects(paths: string[]): Promise<OpResult>;
  listFolder(prefix: string): Promise<ListResult>;
  insertMetadata(row: OriginalFileRow): Promise<OpResult>;
  deleteMetadataForDocument(documentId: string): Promise<OpResult>;
  metadataForDocument(documentId: string): Promise<RowsResult>;
  signedUrl(path: string, ttlSeconds: number): Promise<SignedUrlResult>;
}

export interface BackupInput {
  documentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  data: Blob | ArrayBuffer | Uint8Array;
}
export type BackupResult =
  | { ok: true; fileId: string; storagePath: string }
  | { ok: false; stage: "capability" | "upload" | "metadata"; reason: string };

/**
 * Persist one uploaded original: upload the bytes, then write the metadata row.
 * Only reports success once BOTH succeed. If the metadata write fails after a
 * successful upload, the just-written object is removed so no orphan is left
 * (a later retry re-uploads to the same deterministic path). Never throws.
 */
export async function backupOriginal(backend: OriginalsBackend, input: BackupInput): Promise<BackupResult> {
  const userId = backend.userId;
  if (!userId) return { ok: false, stage: "capability", reason: "not-signed-in" };
  const storagePath = storagePathFor(userId, input.documentId, input.filename);

  const up = await backend.uploadObject(storagePath, input.data, input.contentType);
  if (!up.ok) return { ok: false, stage: "upload", reason: up.error ?? "upload-failed" };

  const row: OriginalFileRow = {
    id: newId(),
    user_id: userId,
    document_id: input.documentId,
    storage_path: storagePath,
    filename: safeFilename(input.filename),
    content_type: input.contentType || null,
    size_bytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : null,
    checksum: input.checksum || null,
    processing_state: "ready",
  };
  const meta = await backend.insertMetadata(row);
  if (!meta.ok) {
    // Avoid an orphaned object: best-effort cleanup (ignore the result — a retry
    // would overwrite the same path anyway; folder-scoped delete is the backstop).
    await backend.removeObjects([storagePath]).catch(() => undefined);
    return { ok: false, stage: "metadata", reason: meta.error ?? "metadata-failed" };
  }
  return { ok: true, fileId: row.id, storagePath };
}

export interface RemoveResult { ok: boolean; removed: number; reason?: string }

/**
 * Remove a document's original(s): every object under this user's own
 * `<uid>/<documentId>/` folder (covering any orphaned partial upload) plus the
 * metadata rows for that document. Path- and RLS-scoped, so it can never touch
 * another document's or another user's file. Reports an honest partial result
 * rather than pretending cleanup completed. Never throws.
 */
export async function removeOriginalsForDocument(backend: OriginalsBackend, documentId: string): Promise<RemoveResult> {
  const userId = backend.userId;
  if (!userId) return { ok: false, removed: 0, reason: "not-signed-in" };
  const prefix = folderPrefixFor(userId, documentId);

  const listed = await backend.listFolder(prefix);
  const paths = (listed.names ?? []).map((n) => `${prefix}/${n}`);
  let objectsOk = listed.ok;
  if (paths.length) {
    const rm = await backend.removeObjects(paths);
    objectsOk = objectsOk && rm.ok;
  }
  const del = await backend.deleteMetadataForDocument(documentId);
  const ok = objectsOk && del.ok;
  return {
    ok,
    removed: paths.length,
    reason: ok ? undefined : (listed.error ?? del.error ?? "cleanup-incomplete"),
  };
}

/**
 * Resolve a short-lived, private download URL for a document's own original.
 * Prefers a known storage path (from the document's provenance); otherwise looks
 * the document up in the metadata table (cross-device resolution). RLS ensures a
 * user can only ever resolve their own file.
 */
export async function resolveOriginalUrl(
  backend: OriginalsBackend,
  input: { documentId: string; storagePath?: string },
): Promise<SignedUrlResult> {
  if (!backend.userId) return { ok: false, error: "not-signed-in" };
  let path = input.storagePath;
  if (!path) {
    const rows = await backend.metadataForDocument(input.documentId);
    if (!rows.ok) return { ok: false, error: rows.error ?? "lookup-failed" };
    path = rows.rows[0]?.storage_path;
    if (!path) return { ok: false, error: "not-found" };
  }
  return backend.signedUrl(path, SIGNED_URL_TTL_SECONDS);
}

// --------------------------------------------------------------- real backend --

/** Whether original-file backup is possible right now (Supabase configured). */
export function originalsConfigured(): boolean {
  return isSupabaseConfigured();
}

/**
 * Build the real Supabase-backed backend for the current session, or null when
 * there is no capability (local-only mode, or signed out). Resolving the user id
 * up front lets every path be namespaced by the owner and lets the seam stay
 * synchronous per-op.
 */
export async function getOriginalsBackend(): Promise<OriginalsBackend | null> {
  const client = getSupabaseClient();
  if (!client) return null; // local-only mode
  const { data, error } = await client.auth.getUser();
  const userId = error ? null : data.user?.id ?? null;
  if (!userId) return null; // signed out — no remote identity, nothing to store

  const bucket = client.storage.from(ORIGINALS_BUCKET);
  return {
    userId,
    async uploadObject(path, dataBytes, contentType) {
      const { error } = await bucket.upload(path, dataBytes as Blob, { contentType, upsert: true });
      return { ok: !error, error: error?.message };
    },
    async removeObjects(paths) {
      if (!paths.length) return { ok: true };
      const { error } = await bucket.remove(paths);
      return { ok: !error, error: error?.message };
    },
    async listFolder(prefix) {
      const { data, error } = await bucket.list(prefix);
      if (error) return { ok: false, names: [], error: error.message };
      return { ok: true, names: (data ?? []).map((o) => o.name) };
    },
    async insertMetadata(row) {
      const { error } = await client.from(ORIGINALS_TABLE).insert(row);
      return { ok: !error, error: error?.message };
    },
    async deleteMetadataForDocument(documentId) {
      const { error } = await client.from(ORIGINALS_TABLE).delete().eq("document_id", documentId);
      return { ok: !error, error: error?.message };
    },
    async metadataForDocument(documentId) {
      const { data, error } = await client
        .from(ORIGINALS_TABLE)
        .select("id,user_id,document_id,storage_path,filename,content_type,size_bytes,checksum,processing_state")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false });
      if (error) return { ok: false, rows: [], error: error.message };
      return { ok: true, rows: (data ?? []) as OriginalFileRow[] };
    },
    async signedUrl(path, ttlSeconds) {
      const { data, error } = await bucket.createSignedUrl(path, ttlSeconds);
      if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? "no-url" };
      return { ok: true, url: data.signedUrl };
    },
  };
}
