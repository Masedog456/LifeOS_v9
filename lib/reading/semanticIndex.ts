/**
 * Reading semantic index (LIFEOS-049).
 *
 * Embeds the stable retrieval chunks of ONE document so hybrid retrieval can
 * search a whole book, not just the words a question happens to repeat.
 *
 * Reuses the existing embedding infrastructure rather than inventing a second
 * pipeline: `/api/embed` batches text to a configured provider, or returns
 * deterministic LOCAL vectors when none is configured — so indexing works with
 * zero configuration and never hard-depends on a provider.
 *
 * Guarantees:
 *   - **The document is readable without any of this.** Indexing is optional,
 *     asynchronous, and failure only ever downgrades retrieval to lexical.
 *   - **Resumable + idempotent.** Chunk ids are deterministic and content-hashed,
 *     so a retry embeds only what is missing or genuinely changed.
 *   - **Bounded exposure.** Only this document's chunk text is sent, in batches —
 *     never the library, never unrelated documents (see §12 of the sprint spec).
 *   - **Per-user, per-document isolation** is enforced by RLS on the backend; the
 *     orchestration here is pure over an injectable seam so it is testable.
 */

import type { RetrievalChunk } from "@/lib/reading/chunking";
import { hashText } from "@/lib/hash";

/** Chunks embedded per request. `/api/embed` accepts up to 128; stay well under. */
export const INDEX_BATCH_SIZE = 24;
/** Hard ceiling on chunks embedded in a single run, so one book can't stall the UI. */
export const MAX_CHUNKS_PER_RUN = 600;

export interface StoredVector {
  chunkId: string;
  chunkOrder: number;
  contentHash: string;
  provider: string;
  model: string;
  dimensions: number;
  vector: number[];
}

export type IndexState = "not_indexed" | "partial" | "complete" | "unavailable";

export interface IndexStatus {
  state: IndexState;
  indexed: number;
  total: number;
  /** Present when the last run failed or degraded — plain language, no jargon. */
  note?: string;
}

/** The narrow backend this module needs. Real impl talks to Supabase + /api/embed. */
export interface SemanticIndexBackend {
  /** Null when there is no capability (local-only mode or signed out). */
  readonly userId: string | null;
  /** Existing vectors for a document (chunkId → stored row). */
  load(documentId: string): Promise<{ ok: boolean; vectors: StoredVector[]; error?: string }>;
  /** Persist a batch. Idempotent on (user, document, chunkId). */
  save(documentId: string, rows: StoredVector[]): Promise<{ ok: boolean; error?: string }>;
  /** Remove every vector for a document (used on delete). */
  removeForDocument(documentId: string): Promise<{ ok: boolean; error?: string }>;
  /** Embed a batch of texts. Mirrors the /api/embed contract. */
  embed(texts: string[]): Promise<{ ok: boolean; provider: string; model: string; dimensions: number; vectors: number[][]; error?: string }>;
}

/** Content fingerprint of a chunk — changes ⇒ the stored vector is stale. */
export function chunkContentHash(text: string): string {
  return hashText(text.replace(/\s+/g, " ").trim());
}

/** Which chunks still need embedding, given what is already stored. */
export function pendingChunks(chunks: RetrievalChunk[], stored: StoredVector[]): RetrievalChunk[] {
  const byId = new Map(stored.map((v) => [v.chunkId, v]));
  return chunks.filter((c) => {
    const hit = byId.get(c.id);
    return !hit || hit.contentHash !== chunkContentHash(c.text);
  });
}

/** Derive an honest status from counts. Never reports "complete" prematurely. */
export function statusOf(indexed: number, total: number, note?: string): IndexStatus {
  if (total === 0) return { state: "not_indexed", indexed: 0, total: 0, note };
  if (indexed === 0) return { state: "not_indexed", indexed, total, note };
  if (indexed < total) return { state: "partial", indexed, total, note };
  return { state: "complete", indexed, total, note };
}

export interface IndexRunResult extends IndexStatus {
  /** Vectors now available for retrieval (existing + newly embedded). */
  vectors: StoredVector[];
  /** True when the run embedded at least one new chunk. */
  changed: boolean;
}

/**
 * Index a document's chunks. Embeds only what is missing, in bounded batches,
 * persisting after each batch so an interrupted run (reload, network drop) is
 * resumable rather than wasted. Never throws: any failure returns an honest
 * partial status with whatever vectors did succeed.
 */
export async function indexDocument(
  backend: SemanticIndexBackend,
  documentId: string,
  chunks: RetrievalChunk[],
  opts: { maxChunks?: number } = {},
): Promise<IndexRunResult> {
  if (!backend.userId) {
    return { ...statusOf(0, chunks.length, "Semantic search needs you to be signed in."), vectors: [], state: "unavailable", changed: false };
  }
  const existing = await backend.load(documentId);
  if (!existing.ok) {
    return { ...statusOf(0, chunks.length, "Couldn't load the search index just now."), vectors: [], state: "unavailable", changed: false };
  }

  const vectors: StoredVector[] = [...existing.vectors];
  const byId = new Map(vectors.map((v) => [v.chunkId, v]));
  const todo = pendingChunks(chunks, vectors).slice(0, opts.maxChunks ?? MAX_CHUNKS_PER_RUN);
  let changed = false;
  let note: string | undefined;

  for (let i = 0; i < todo.length; i += INDEX_BATCH_SIZE) {
    const batch = todo.slice(i, i + INDEX_BATCH_SIZE);
    const res = await backend.embed(batch.map((c) => c.text));
    if (!res.ok || res.vectors.length !== batch.length) {
      note = "Some of this document isn't searchable by meaning yet — you can retry.";
      break;
    }
    const rows: StoredVector[] = batch.map((c, j) => ({
      chunkId: c.id,
      chunkOrder: c.order,
      contentHash: chunkContentHash(c.text),
      provider: res.provider,
      model: res.model,
      dimensions: res.dimensions,
      vector: res.vectors[j],
    }));
    const saved = await backend.save(documentId, rows);
    if (!saved.ok) {
      note = "Some of this document isn't searchable by meaning yet — you can retry.";
      break;
    }
    for (const r of rows) {
      if (byId.has(r.chunkId)) {
        const idx = vectors.findIndex((v) => v.chunkId === r.chunkId);
        if (idx >= 0) vectors[idx] = r;
      } else {
        vectors.push(r);
        byId.set(r.chunkId, r);
      }
    }
    changed = true;
  }

  // Count only vectors that correspond to a CURRENT chunk with a matching hash.
  const current = new Set(chunks.map((c) => c.id));
  const hashes = new Map(chunks.map((c) => [c.id, chunkContentHash(c.text)]));
  const usable = vectors.filter((v) => current.has(v.chunkId) && hashes.get(v.chunkId) === v.contentHash);
  return { ...statusOf(usable.length, chunks.length, note), vectors: usable, changed };
}

/** Remove a document's semantic index (called when the reading is deleted). */
export async function removeIndexForDocument(
  backend: SemanticIndexBackend,
  documentId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!backend.userId) return { ok: true };
  const res = await backend.removeForDocument(documentId);
  return { ok: res.ok, reason: res.error };
}

// --------------------------------------------------------------- real backend --

/** The reading semantic-index table provisioned by migration 0034. */
export const INDEX_TABLE = "reading_chunk_embeddings";

interface IndexRow {
  id: string; user_id: string; document_id: string; chunk_id: string; chunk_order: number;
  content_hash: string; provider: string; model: string; dimensions: number; vector: number[];
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Build the real backend for the current session, or null when there is no
 * capability (local-only mode / signed out) — in which case retrieval simply
 * stays lexical and the document remains fully readable.
 *
 * Embedding goes through the existing `/api/embed` route: server-only keys, and
 * deterministic local vectors when no provider is configured. Only THIS
 * document's chunk text is ever sent, in bounded batches.
 */
export async function getSemanticIndexBackend(): Promise<SemanticIndexBackend | null> {
  const { getSupabaseClient } = await import("@/lib/supabase");
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  const userId = error ? null : data.user?.id ?? null;
  if (!userId) return null;

  return {
    userId,
    async load(documentId) {
      const { data, error } = await client
        .from(INDEX_TABLE)
        .select("chunk_id,chunk_order,content_hash,provider,model,dimensions,vector")
        .eq("document_id", documentId)
        .order("chunk_order", { ascending: true });
      if (error) return { ok: false, vectors: [], error: error.message };
      const vectors: StoredVector[] = (data ?? []).map((r) => ({
        chunkId: r.chunk_id as string,
        chunkOrder: r.chunk_order as number,
        contentHash: r.content_hash as string,
        provider: r.provider as string,
        model: r.model as string,
        dimensions: r.dimensions as number,
        vector: (r.vector ?? []) as number[],
      }));
      return { ok: true, vectors };
    },
    async save(documentId, rows) {
      const payload: IndexRow[] = rows.map((r) => ({
        id: newId(), user_id: userId, document_id: documentId, chunk_id: r.chunkId,
        chunk_order: r.chunkOrder, content_hash: r.contentHash, provider: r.provider,
        model: r.model, dimensions: r.dimensions, vector: r.vector,
      }));
      // Idempotent on (user, document, chunk) so retries never duplicate.
      const { error } = await client.from(INDEX_TABLE).upsert(payload, { onConflict: "user_id,document_id,chunk_id" });
      return { ok: !error, error: error?.message };
    },
    async removeForDocument(documentId) {
      const { error } = await client.from(INDEX_TABLE).delete().eq("document_id", documentId);
      return { ok: !error, error: error?.message };
    },
    async embed(texts) {
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ texts }),
        });
        if (!res.ok) return { ok: false, provider: "", model: "", dimensions: 0, vectors: [], error: "embed failed" };
        const body = await res.json() as { provider: string; model: string; dimensions: number; vectors: number[][] };
        return { ok: true, provider: body.provider, model: body.model, dimensions: body.dimensions, vectors: body.vectors };
      } catch {
        return { ok: false, provider: "", model: "", dimensions: 0, vectors: [], error: "offline" };
      }
    },
  };
}
