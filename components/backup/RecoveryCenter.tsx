"use client";

/**
 * Recovery Center (LIFEOS-040, Feature 18).
 *
 * A read-only surface listing everything recoverable — discarded captures,
 * archived records, sync conflicts, corrupt preferences, incomplete migrations —
 * each with a preview of impact. No automatic repair of ambiguous state.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildRecovery } from "@/lib/backup/recovery";
import { getSyncStatus } from "@/lib/sync/status-store";
import { readJson, isUserContentKey } from "@/lib/security/storage-resilience";

const KIND_LABEL: Record<string, string> = {
  "discarded-capture": "Discarded captures",
  "archived-record": "Archived records",
  "sync-conflict": "Sync conflicts",
  "corrupt-preferences": "Corrupted preferences",
  "incomplete-migration": "Incomplete upgrades",
  "failed-import": "Failed imports",
  "interrupted-export": "Interrupted exports",
  "tombstone": "Deleted (recoverable)",
  "orphan-record": "Orphaned records",
};

export default function RecoveryCenter() {
  const state = useStore();
  const projection = useMemo(() => {
    let conflicts: { id: string; domain: string }[] = [];
    try { conflicts = getSyncStatus().conflicts.map((c) => ({ id: c.id, domain: c.domain })); } catch { /* none */ }
    let corruptPrefsKey: string | null = null;
    try { if (typeof localStorage !== "undefined") { const r = readJson("lifeos.prefs.v1"); if (r.status === "corrupt" && !isUserContentKey("lifeos.prefs.v1")) corruptPrefsKey = "lifeos.prefs.v1"; } } catch { /* ignore */ }
    return buildRecovery({ state, unresolvedConflicts: conflicts, corruptPrefsKey });
  }, [state]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof projection.candidates>();
    for (const c of projection.candidates) { const g = m.get(c.kind) ?? []; g.push(c); m.set(c.kind, g); }
    return [...m.entries()];
  }, [projection]);

  return (
    <div className="flex flex-col gap-4" data-recovery-center>
      {groups.length === 0 && <p className="rounded-2xl border border-black/[.06] p-6 text-center text-sm text-zinc-500 dark:border-white/[.08]" data-recovery-empty>Nothing needs recovery. Discarded, archived, and conflicting items would appear here.</p>}
      {groups.map(([kind, items]) => (
        <section key={kind} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-recovery-group={kind}>
          <h2 className="text-sm font-semibold">{KIND_LABEL[kind] ?? kind} <span className="text-zinc-400">({items.length})</span></h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {items.slice(0, 25).map((c) => (
              <li key={c.id} className="rounded-lg bg-black/[.02] px-3 py-2 text-[13px] dark:bg-white/[.03]" data-recovery-item>
                <p className="font-medium text-zinc-800 dark:text-zinc-100">{c.label}</p>
                <p className="text-[12px] text-zinc-500">{c.impact}</p>
              </li>
            ))}
          </ul>
          {kind === "sync-conflict" && <Link href="/health" className="mt-2 inline-block text-[12px] text-blue-600 hover:underline dark:text-blue-400">Open conflict center →</Link>}
        </section>
      ))}
    </div>
  );
}
