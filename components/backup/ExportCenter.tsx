"use client";

/**
 * Export & backup center (LIFEOS-040, Features 12, 13, 15).
 *
 * User-triggered complete-account export (JSON archive with manifest), export
 * verification, and a local backup. All computation is local; nothing is sent
 * anywhere. Discloses pending local mutations at export time. Keyboard-operable
 * throughout (Feature 30).
 */

import { useMemo, useState } from "react";
import { useStore } from "@/lib/mvpStore";
import { readPrefs } from "@/lib/prefs";
import { buildAccountArchive, serializeArchive, archiveFilename, safeExportPrefs, collectionToCsv } from "@/lib/backup/export";
import { verifyArchive, formatVerifyReport } from "@/lib/backup/verify";
import { getSyncDiagnostics } from "@/lib/persistence";
import { RELEASE_APP_VERSION } from "@/lib/release/versions";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? RELEASE_APP_VERSION;

function download(name: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportCenter() {
  const state = useStore();
  const [status, setStatus] = useState<string | null>(null);
  const [verifyText, setVerifyText] = useState<string | null>(null);

  const pending = useMemo(() => {
    try { const d = getSyncDiagnostics(); return (d?.dirtyDomains?.length ?? 0); } catch { return 0; }
  }, [state]);

  const buildArchive = () => buildAccountArchive(state, {
    appVersion: APP_VERSION,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    pendingMutations: pending,
    prefs: safeExportPrefs(readPrefs()),
  });

  const onExportJson = () => {
    setStatus("Building archive…");
    const archive = buildArchive();
    download(archiveFilename(archive), serializeArchive(archive));
    setStatus(`Exported ${archive.manifest.totalRecords.toLocaleString()} records.`);
  };

  const onExportCsv = () => {
    const archive = buildArchive();
    const parts: string[] = [];
    for (const [name, records] of Object.entries(archive.collections)) {
      if (Array.isArray(records) && records.length) parts.push(`# ${name}\n` + collectionToCsv(records as Record<string, unknown>[]));
    }
    download(`lifeos-export-${archive.metadata.generatedAt.slice(0, 10)}.csv`, parts.join("\n\n"), "text/csv");
    setStatus("Exported CSV bundle.");
  };

  const onVerify = () => {
    const archive = buildArchive();
    const report = verifyArchive(archive);
    setVerifyText(formatVerifyReport(report));
  };

  return (
    <div className="flex flex-col gap-5" data-export-center>
      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Export everything</h2>
        <p className="mt-1 text-sm text-zinc-500">A complete, documented archive of every record you own — no secrets or tokens. Computed locally.</p>
        {pending > 0 && <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[13px] text-amber-700 dark:text-amber-300" data-pending-notice>You have unsynced changes in {pending} area(s). They are included in this export.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onExportJson} data-export-json className="rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Export JSON archive</button>
          <button type="button" onClick={onExportCsv} data-export-csv className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Export CSV bundle</button>
          <button type="button" onClick={onVerify} data-verify-export className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Verify export</button>
        </div>
        {status && <p className="mt-3 text-[13px] text-emerald-600 dark:text-emerald-400" data-export-status role="status">{status}</p>}
      </section>

      {verifyText && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-verify-report>
          <h2 className="text-sm font-semibold">Verification</h2>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/[.03] p-3 text-[12px] dark:bg-white/[.04]">{verifyText}</pre>
        </section>
      )}
    </div>
  );
}
