"use client";

/**
 * Backup & Restore (LIFEOS-032, Feature 8).
 *
 * Export all user-owned data to a versioned JSON file, and import one with
 * validation + a per-domain preview and a merge/overwrite choice. Never silently
 * overwrites: a malformed file is rejected (original data + file preserved), and
 * applying requires an explicit confirmation through the shared ConfirmDialog.
 * All local + deterministic; no cloud provider.
 */

import { useMemo, useRef, useState } from "react";
import { useStore, restoreState } from "@/lib/mvpStore";
import { readPrefs } from "@/lib/prefs";
import { exportBackup, serializeBackup, backupCounts, backupFilename, totalRecords } from "@/lib/ux/backup";
import { applyRestore, type RestoreMode } from "@/lib/ux/restore";
import { planRestore, type RestorePlan } from "@/lib/sync/restore-safety";
import { setRollback } from "@/lib/sync/status-store";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { toast } from "@/lib/ux/feedback";

export default function BackupRestore() {
  const state = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<RestoreMode>("merge");

  const exportCounts = useMemo(() => backupCounts(state), [state]);

  const doExport = () => {
    const backup = exportBackup(state, readPrefs());
    const blob = new Blob([serializeBackup(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = backupFilename(backup); a.click();
    URL.revokeObjectURL(url);
    toast({ kind: "success", message: "Backup exported", detail: `${totalRecords(exportCounts)} records` });
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setRawText(await file.text());
  };

  // Full restore plan (LIFEOS-033): validate → schema upgrade → integrity → preview.
  const plan: RestorePlan | null = rawText != null ? planRestore(state, rawText, mode) : null;

  const doImport = () => {
    if (!plan?.ok || !plan.backup) return;
    const backup = plan.backup;
    const total = totalRecords(backupCounts(backup.data));
    const prev = state; // rollback snapshot captured before applying
    requestConfirm({
      confirmLabel: mode === "overwrite" ? "Overwrite everything" : "Merge in",
      onConfirm: () => {
        restoreState(applyRestore(state, backup, mode));
        setRollback(mode === "overwrite" ? "before overwrite restore" : "before merge restore", prev);
        setRawText(null); setFileName("");
        if (fileRef.current) fileRef.current.value = "";
        toast({ kind: "success", message: mode === "overwrite" ? "Data restored (overwrite)" : "Data merged in", detail: `${total} records — roll back from Recovery` });
      },
      impact: {
        name: fileName || "backup file", typeLabel: "Restore",
        children: [], undoable: true, severity: "high", verb: mode === "overwrite" ? "Overwrite" : "Merge",
        linkedNote: mode === "overwrite"
          ? "Overwrite REPLACES all current records with the backup’s. A one-click rollback is kept until your next change."
          : "Merge adds the backup’s records and updates any with a matching id. A one-click rollback is kept until your next change.",
      },
    });
  };

  return (
    <section aria-label="Backup and restore" className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Backup &amp; restore</h2>
      <p className="mb-3 text-xs text-zinc-500">Export all your LifeOS data to a versioned JSON file, or restore from one. Everything stays on your device unless you’re signed in.</p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={doExport} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">Export backup ({totalRecords(exportCounts)} records)</button>
        <label className="cursor-pointer rounded-full border border-black/10 px-4 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/12 dark:hover:bg-white/[.06]">
          Choose backup file…
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </label>
      </div>

      {plan && (
        <div className="mt-4 rounded-lg border border-black/10 p-3 text-xs dark:border-white/12">
          <p className="font-medium">{fileName}</p>
          {!plan.ok ? (
            <div className="mt-1 text-rose-600 dark:text-rose-400" role="alert">
              <p className="font-medium">This file can’t be restored:</p>
              <ul className="mt-0.5 list-inside list-disc">{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p className="mt-1 text-zinc-500">Your current data is unchanged, and the file is preserved.</p>
            </div>
          ) : (
            <>
              <p className="mt-1 text-zinc-500">{totalRecords(backupCounts(plan.backup!.data))} records in file. {plan.integrity ? plan.integrity.warnings + " integrity warning(s)." : ""}</p>
              {plan.warnings.map((w, i) => <p key={i} className="mt-0.5 text-amber-600 dark:text-amber-400">⚠ {w}</p>)}
              <div className="mt-2 flex items-center gap-3">
                <span className="text-zinc-400">Mode:</span>
                <label className="flex items-center gap-1"><input type="radio" name="restore-mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge</label>
                <label className="flex items-center gap-1"><input type="radio" name="restore-mode" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} /> Overwrite</label>
              </div>
              {plan.preview && (
                <div className="mt-2 max-h-40 overflow-auto rounded border border-black/[.06] dark:border-white/[.08]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-zinc-400"><tr><th className="px-2 py-1">Domain</th><th className="px-2 py-1">Now</th><th className="px-2 py-1">In file</th><th className="px-2 py-1">After</th></tr></thead>
                    <tbody>
                      {plan.preview.domains.filter((d) => d.current || d.incoming).map((d) => (
                        <tr key={d.domain} className="border-t border-black/[.05] dark:border-white/[.06]"><td className="px-2 py-0.5">{d.domain}</td><td className="px-2 py-0.5">{d.current}</td><td className="px-2 py-0.5">{d.incoming}</td><td className="px-2 py-0.5 font-medium">{d.resulting}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button type="button" onClick={doImport} className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">Restore…</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
