"use client";

/**
 * Import preview & restore (LIFEOS-040, Feature 14).
 *
 * Upload a LifeOS archive → verify → preview the exact changes → dry run →
 * apply (with explicit confirmation for destructive restores). Never silently
 * overwrites; never trusts archive HTML/URLs; never imports secrets.
 */

import { useState } from "react";
import { useStore, replaceState } from "@/lib/mvpStore";
import { safeJsonParse } from "@/lib/security/input-limits";
import { previewImport, type ImportMode, type ImportPreview as Preview } from "@/lib/backup/import-preview";
import { restore, formatRestoreReport } from "@/lib/backup/restore";
import type { AccountArchive } from "@/lib/backup/export";

export default function ImportPreview() {
  const state = useStore();
  const [archive, setArchive] = useState<AccountArchive | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null); setReport(null);
    const text = await file.text();
    const parsed = safeJsonParse(text);
    if (!parsed.ok) { setError(`Could not read archive: ${parsed.error}`); return; }
    const a = parsed.value as AccountArchive;
    setArchive(a);
    setPreview(previewImport(state, a, mode));
  };

  const rePreview = (m: ImportMode) => { setMode(m); if (archive) setPreview(previewImport(state, archive, m)); };

  const onDryRun = () => {
    if (!archive) return;
    const r = restore(state, archive, { mode, confirmDestructive: true, dryRun: true });
    setReport("DRY RUN — nothing changed.\n" + formatRestoreReport(r.report));
  };

  const onApply = () => {
    if (!archive || !preview) return;
    const r = restore(state, archive, { mode, confirmDestructive });
    if (!r.applied) { setError(r.reason ?? "Restore blocked."); return; }
    replaceState(r.nextState!);
    setReport("Applied.\n" + formatRestoreReport(r.report));
  };

  return (
    <div className="flex flex-col gap-5" data-import-center>
      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Import from a LifeOS archive</h2>
        <p className="mt-1 text-sm text-zinc-500">Preview every change before anything is written. Destructive restores need explicit confirmation.</p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">
          <input type="file" accept="application/json,.json" className="sr-only" data-import-file onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          Choose archive…
        </label>
        {error && <p className="mt-3 text-[13px] text-rose-600 dark:text-rose-400" role="alert" data-import-error>{error}</p>}
      </section>

      {preview && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-import-preview>
          <div className="mb-2 flex items-center gap-2 text-[13px]">
            <span className="text-zinc-500">Mode:</span>
            <button type="button" onClick={() => rePreview("merge")} className={`rounded-full px-3 py-0.5 ${mode === "merge" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>Merge</button>
            <button type="button" onClick={() => rePreview("replace")} className={`rounded-full px-3 py-0.5 ${mode === "replace" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>Replace</button>
          </div>
          <p className="text-[13px] text-zinc-500" data-preview-summary>Verification: {preview.verify.ok ? "passed" : "failed"} · {preview.totalIncoming.toLocaleString()} incoming · {preview.totalDuplicates.toLocaleString()} duplicate id(s)</p>
          {preview.destructive && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[13px] text-rose-700 dark:text-rose-300" data-destructive-warning>This restore would overwrite or remove existing records.</p>}
          <div className="mt-2 max-h-48 overflow-y-auto text-[12px]">
            <table className="w-full"><tbody>
              {preview.plans.filter((p) => p.incoming > 0 || p.removed > 0).map((p) => (
                <tr key={p.domain} className="border-t border-black/[.05] dark:border-white/[.06]"><td className="py-1 pr-2">{p.domain}</td><td className="py-1 tabular-nums text-zinc-500">+{p.added} added · {p.updated} updated{p.removed ? ` · ${p.removed} removed` : ""}</td></tr>
              ))}
            </tbody></table>
          </div>
          {preview.destructive && (
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={confirmDestructive} onChange={(e) => setConfirmDestructive(e.target.checked)} data-confirm-destructive />
              I understand this overwrites existing data.
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onDryRun} data-dry-run className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Dry run</button>
            <button type="button" onClick={onApply} disabled={preview.destructive && !confirmDestructive} data-apply-import className="rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Apply restore</button>
          </div>
        </section>
      )}

      {report && <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-restore-report><pre className="overflow-x-auto whitespace-pre-wrap text-[12px]">{report}</pre></section>}
    </div>
  );
}
