/**
 * Semantic index orchestration (LIFEOS-015, Phases 2/9).
 *
 * User-triggered, incremental, and idempotent: only records whose content hash
 * is new or changed are (re-)embedded. Batched with a configurable size and a
 * per-operation cap so the workload is bounded and visible. No automatic
 * background or whole-library re-embedding.
 */

import type { EmbeddableItem } from "@/lib/embeddings/types";
import type { EmbeddingRecord, StoreState } from "@/types/mvp";
import { embeddableItems } from "@/lib/embeddings/records";
import { authedJsonHeaders } from "@/lib/security/api-token";

export const EMBED_BATCH_SIZE = 32;
export const EMBED_MAX_PER_OP = 200;
const MAX_BATCH_RETRIES = 2;

export interface IndexStats {
  total: number;
  indexed: number;
  pending: number;
}

/** Items whose content hash is new or changed since the last index. */
export function pendingItems(state: StoreState): EmbeddableItem[] {
  const byRecord = new Map(state.embeddings.map((e) => [e.recordId, e.contentHash]));
  return embeddableItems(state).filter((it) => byRecord.get(it.recordId) !== it.contentHash);
}

export function indexStats(state: StoreState): IndexStats {
  const all = embeddableItems(state);
  const byRecord = new Map(state.embeddings.map((e) => [e.recordId, e.contentHash]));
  const indexed = all.filter((it) => byRecord.get(it.recordId) === it.contentHash).length;
  return { total: all.length, indexed, pending: all.length - indexed };
}

interface EmbedResponse {
  provider: string;
  model: string;
  dimensions: number;
  source: "provider" | "local";
  vectors: number[][];
}

async function requestEmbeddings(texts: string[]): Promise<EmbedResponse> {
  const res = await fetch("/api/embed", {
    method: "POST",
    headers: await authedJsonHeaders(),
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed route ${res.status}`);
  return (await res.json()) as EmbedResponse;
}

/**
 * Embed pending items (up to `max`) in batches. Returns NEW embedding records
 * to be merged into the store. A failing batch is retried, then skipped — the
 * run degrades rather than aborting.
 */
export async function runIndex(
  state: StoreState,
  opts: { batchSize?: number; max?: number } = {},
): Promise<{ records: EmbeddingRecord[]; embedded: number; failed: number; provider: string; model: string }> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? EMBED_BATCH_SIZE, EMBED_BATCH_SIZE));
  const max = Math.max(1, Math.min(opts.max ?? EMBED_MAX_PER_OP, EMBED_MAX_PER_OP));
  const pending = pendingItems(state).slice(0, max);

  const records: EmbeddingRecord[] = [];
  const now = new Date().toISOString();
  let failed = 0;
  let provider = "local";
  let model = "lexical-v1";

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    let resp: EmbedResponse | null = null;
    for (let attempt = 0; attempt <= MAX_BATCH_RETRIES && !resp; attempt++) {
      try {
        resp = await requestEmbeddings(batch.map((b) => b.text));
      } catch {
        if (attempt === MAX_BATCH_RETRIES) resp = null;
      }
    }
    if (!resp) {
      failed += batch.length;
      continue;
    }
    provider = resp.provider;
    model = resp.model;
    batch.forEach((it, j) => {
      const vector = resp!.vectors[j];
      if (!vector) return;
      records.push({
        recordId: it.recordId,
        type: it.type,
        sourceId: it.sourceId,
        contentHash: it.contentHash,
        provider: resp!.provider,
        model: resp!.model,
        dimensions: resp!.dimensions,
        generatedAt: now,
        vector,
      });
    });
  }

  return { records, embedded: records.length, failed, provider, model };
}
