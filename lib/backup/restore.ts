/**
 * Safe restore (LIFEOS-040, Feature 14).
 *
 * Turns a previewed import into an applied restore with a recovery report and a
 * ROLLBACK snapshot. The rules: never silently overwrite (destructive restores
 * require an explicit confirmation flag); apply transactionally in memory (build
 * the whole next state, then swap); keep a rollback snapshot so the user can
 * undo. Import never trusts archive HTML/URLs and never imports auth secrets.
 */

import type { StoreState } from "@/types/mvp";
import type { AccountArchive } from "@/lib/backup/export";
import { previewImport, applyImport, type ImportMode, type ImportPreview } from "@/lib/backup/import-preview";

export interface RestoreResult {
  applied: boolean;
  reason?: string;
  preview: ImportPreview;
  nextState?: StoreState;
  rollback?: StoreState;
  report: RestoreReport;
}

export interface RestoreReport {
  mode: ImportMode;
  domainsChanged: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsRemoved: number;
  destructive: boolean;
  confirmedDestructive: boolean;
  at: string;
}

export interface RestoreOptions {
  mode?: ImportMode;
  /** Must be true to apply a destructive restore. */
  confirmDestructive?: boolean;
  /** When true, compute everything but do NOT return nextState (dry run). */
  dryRun?: boolean;
  now?: string;
}

export function restore(current: StoreState, archive: AccountArchive, opts: RestoreOptions = {}): RestoreResult {
  const mode = opts.mode ?? "merge";
  const preview = previewImport(current, archive, mode);
  const report: RestoreReport = {
    mode,
    domainsChanged: preview.plans.filter((p) => p.added || p.updated || p.removed).length,
    recordsAdded: preview.plans.reduce((n, p) => n + p.added, 0),
    recordsUpdated: preview.plans.reduce((n, p) => n + p.updated, 0),
    recordsRemoved: preview.plans.reduce((n, p) => n + p.removed, 0),
    destructive: preview.destructive,
    confirmedDestructive: Boolean(opts.confirmDestructive),
    at: opts.now ?? new Date().toISOString(),
  };

  if (!preview.importable) return { applied: false, reason: "Archive failed verification.", preview, report };
  if (preview.destructive && !opts.confirmDestructive) {
    return { applied: false, reason: "This restore would overwrite existing data. Explicit confirmation required.", preview, report };
  }
  if (opts.dryRun) return { applied: false, reason: "Dry run — nothing was changed.", preview, report };

  // Transactional in-memory apply: build the full next state, then hand it back
  // for the store to swap atomically. Keep a rollback snapshot.
  const nextState = applyImport(current, archive, mode);
  return { applied: true, preview, nextState, rollback: current, report };
}

/** Human-readable restore report. */
export function formatRestoreReport(r: RestoreReport): string {
  return [
    `Restore (${r.mode}) at ${r.at}`,
    `  domains changed: ${r.domainsChanged}`,
    `  added: ${r.recordsAdded}, updated: ${r.recordsUpdated}, removed: ${r.recordsRemoved}`,
    `  destructive: ${r.destructive}${r.destructive ? ` (confirmed: ${r.confirmedDestructive})` : ""}`,
  ].join("\n");
}
