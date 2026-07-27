"use client";

/**
 * Recovery panel (LIFEOS-033, Features 10 & 11).
 *
 * Surfaces corruption isolation (records skipped during hydration — never
 * deleted from source), the last recovery event, an emergency raw backup export,
 * and a one-click restore ROLLBACK when a rollback snapshot is available (until
 * the next mutation). Read-only except the explicit rollback/export actions.
 */

import { useStore, restoreState } from "@/lib/mvpStore";
import { readPrefs } from "@/lib/prefs";
import { useSyncStatus, clearRollback } from "@/lib/sync/status-store";
import { lastRecoveryEvent } from "@/lib/sync/recovery";
import { exportBackup, serializeBackup, backupFilename } from "@/lib/ux/backup";
import { toast } from "@/lib/ux/feedback";

export default function RecoveryPanel() {
  const state = useStore();
  const { recovery, recoveryMode, rollback } = useSyncStatus();
  const lastEvent = typeof window !== "undefined" ? lastRecoveryEvent() : null;

  const emergencyExport = () => {
    const b = exportBackup(state, readPrefs());
    const blob = new Blob([serializeBackup(b)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `emergency-${backupFilename(b)}`; a.click();
    URL.revokeObjectURL(url);
    toast({ kind: "success", message: "Emergency backup exported" });
  };

  const doRollback = () => {
    if (!rollback) return;
    restoreState(rollback.state);
    clearRollback();
    toast({ kind: "success", message: "Restore rolled back", detail: rollback.label });
  };

  const hasRecovery = (recovery && recovery.totalSkipped > 0) || recoveryMode || lastEvent;

  return (
    <section aria-label="Recovery" className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <h2 className="mb-2 text-sm font-semibold tracking-tight">Recovery &amp; integrity</h2>

      {rollback && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/25">
          <span>A restore was applied. You can roll back to “{rollback.label}” until your next change.</span>
          <button type="button" onClick={doRollback} className="shrink-0 rounded-full bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">Roll back</button>
        </div>
      )}

      {recoveryMode && (
        <p className="mb-2 rounded-lg border border-rose-500/40 bg-rose-50/60 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/25 dark:text-rose-300">
          Recovery mode: some data could not be read safely. Your source data is preserved — export an emergency backup before repairing.
        </p>
      )}

      {recovery && recovery.totalSkipped > 0 ? (
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          <p>{recovery.totalSkipped} malformed record{recovery.totalSkipped === 1 ? "" : "s"} skipped during load (source not deleted):</p>
          <ul className="mt-1 list-inside list-disc">
            {recovery.domains.map((d) => <li key={d.domain}>{d.domain}: {d.skipped} skipped</li>)}
          </ul>
        </div>
      ) : !hasRecovery ? (
        <p className="text-xs text-zinc-500">No corruption detected. All records loaded cleanly.</p>
      ) : null}

      {lastEvent && (!recovery || recovery.totalSkipped === 0) && (
        <p className="mt-1 text-[11px] text-zinc-400">Last recovery event: {new Date(lastEvent.at).toLocaleString()} — {lastEvent.totalSkipped} skipped.</p>
      )}

      <button type="button" onClick={emergencyExport} className="mt-3 rounded-full border border-black/10 px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">Export emergency backup</button>
    </section>
  );
}
