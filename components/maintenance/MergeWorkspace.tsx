"use client";

/**
 * Merge workspace (LIFEOS-038, Feature 8). Deterministic merge with a PREVIEW:
 * pick which record to keep, see exactly what would be preserved (citations
 * re-pointed, backlinks affected, history carried), then confirm. Losers are
 * archived (reversible) — never deleted, evidence never destroyed.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, mergeRecords } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildMaintenanceIndex } from "@/lib/maintenance/integrity";
import { duplicateCandidates, DUPLICATE_REASON_LABEL } from "@/lib/maintenance/duplicates";
import { mergePreview, MERGEABLE_KINDS } from "@/lib/maintenance/merge";
import { toast } from "@/lib/ux/feedback";

export default function MergeWorkspace() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildMaintenanceIndex(state), [state]);
  const candidates = useMemo(() => duplicateCandidates(state, index).filter((c) => MERGEABLE_KINDS.has(c.kind)), [state, index]);
  const [primaryByGroup, setPrimaryByGroup] = useState<Record<string, string>>({});

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Merge records</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Consolidate duplicates deterministically. A merge preserves history, citations, and backlinks, keeps the chosen record&apos;s id, archives the rest (reversible), and never deletes.</p>
      </header>

      {candidates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]" data-empty>No mergeable duplicate groups.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {candidates.map((c) => {
            const primaryId = primaryByGroup[c.id] ?? `${c.members[0].kind}:${c.members[0].id}`;
            const primary = c.members.find((m) => `${m.kind}:${m.id}` === primaryId) ?? c.members[0];
            const losers = c.members.filter((m) => `${m.kind}:${m.id}` !== primaryId);
            const preview = mergePreview(state, index, primary, losers);
            return (
              <section key={c.id} data-merge-group={c.id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{DUPLICATE_REASON_LABEL[c.reason]} · {c.kind}</p>
                <fieldset className="mb-2 flex flex-col gap-1">
                  {c.members.map((m) => {
                    const e = entityRef(ctx, m.kind, m.id);
                    const key = `${m.kind}:${m.id}`;
                    return (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <input type="radio" name={`primary-${c.id}`} data-primary={key} checked={primaryId === key} onChange={() => setPrimaryByGroup((p) => ({ ...p, [c.id]: key }))} />
                        <Link href={e.href} className="min-w-0 truncate hover:underline">{e.title}</Link>
                      </label>
                    );
                  })}
                </fieldset>
                <p className="mb-2 text-[11px] text-zinc-500" data-merge-preview>Keeps <strong>{entityRef(ctx, primary.kind, primary.id).title}</strong> · re-points {preview.movedCitations.length} citation{preview.movedCitations.length === 1 ? "" : "s"} · affects {preview.affectedBacklinks.length} backlink{preview.affectedBacklinks.length === 1 ? "" : "s"} · carries {preview.preservedHistoryCount} history event{preview.preservedHistoryCount === 1 ? "" : "s"} · archives {preview.losers.length} · evidence preserved.</p>
                <div className="flex justify-end">
                  <button type="button" data-confirm-merge onClick={() => { mergeRecords(primary, losers, c); toast({ kind: "success", message: "Merged" }); }} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Merge into selected</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
