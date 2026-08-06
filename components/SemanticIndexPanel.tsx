"use client";

import { useMemo, useState } from "react";
import type { StoreState } from "@/types/mvp";
import { addEmbeddings, getStoreSnapshot } from "@/lib/mvpStore";
import { EMBED_BATCH_SIZE, indexStats, runIndex } from "@/lib/embeddings";

/**
 * User-triggered incremental semantic indexing (LIFEOS-015, Phases 2/9).
 *
 * Shows the visible workload (how many records are new/changed) and lets the
 * user embed them in bounded batches. Unchanged content is skipped via content
 * hashes; nothing runs automatically in the background; no dollar estimates.
 * Semantic ranking activates once an index exists — deterministic retrieval is
 * unaffected either way.
 */
export default function SemanticIndexPanel({ state }: { state: StoreState }) {
  const stats = useMemo(() => indexStats(state), [state]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const approxBatches = Math.ceil(stats.pending / EMBED_BATCH_SIZE);

  async function update() {
    setBusy(true);
    setNote(null);
    try {
      const { records, embedded, failed, provider } = await runIndex(getStoreSnapshot());
      addEmbeddings(records);
      setNote(
        embedded > 0
          ? `Indexed ${embedded} record${embedded === 1 ? "" : "s"} via “${provider}”.${failed ? ` ${failed} failed.` : ""}`
          : "Everything is already indexed.",
      );
    } catch {
      setNote("Indexing failed — regular search still works.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <span>Semantic index (optional)</span>
        <span>{stats.indexed}/{stats.total} indexed{stats.pending > 0 ? ` · ${stats.pending} pending` : ""}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-xs text-zinc-500">
            Builds a private, on-device semantic index so search and reasoning can find conceptually
            related material even when the wording differs. Deterministic search never depends on it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={update}
              disabled={busy || stats.pending === 0}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "Indexing…" : stats.pending === 0 ? "Index up to date" : `Update index (${stats.pending} new/changed)`}
            </button>
            {stats.pending > 0 && (
              <span className="text-xs text-zinc-400">≈ {approxBatches} embedding batch{approxBatches === 1 ? "" : "es"}</span>
            )}
          </div>
          {note && <p className="mt-2 text-xs text-zinc-400">{note}</p>}
        </div>
      )}
    </section>
  );
}
