/**
 * Restore safety: upgrade + integrity + rollback (LIFEOS-033, Feature 11).
 *
 * Wraps the LIFEOS-032 restore with sync-integrity guarantees: upgrade an old
 * backup's schema, validate referential integrity (duplicate ids, dangling
 * citations, missing parents), estimate conflicts with the current data, and
 * report skipped/transformed records — all BEFORE applying. Deterministic and
 * pure; the component confirms and the store keeps a rollback snapshot.
 */

import type { StoreState } from "@/types/mvp";
import { validateBackup, previewRestore, type RestoreMode, type RestorePreview } from "@/lib/ux/restore";
import type { LifeOSBackup } from "@/lib/ux/backup";
import { upgradeBackup, type BackupUpgradeResult } from "@/lib/migrations/upgrade-backup";
import { validateIntegrity, type IntegrityResult } from "@/lib/sync/integrity";

export interface RestorePlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  upgrade?: BackupUpgradeResult;
  integrity?: IntegrityResult;
  preview?: RestorePreview;
  /** The upgraded, ready-to-apply backup (only when ok). */
  backup?: LifeOSBackup;
}

/**
 * Build a full restore plan from raw input: parse+validate shape → upgrade schema
 * → integrity check → conflict/preview estimate. Never applies anything. A
 * malformed file yields `ok:false` with clear errors so the original data + file
 * are preserved.
 */
export function planRestore(current: StoreState, raw: unknown, mode: RestoreMode): RestorePlan {
  const validation = validateBackup(raw);
  if (!validation.ok || !validation.backup) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings };
  }
  const upgrade = upgradeBackup(validation.backup);
  const integrity = validateIntegrity(upgrade.backup.data);
  const preview = previewRestore(current, upgrade.backup, mode);

  const warnings = [...validation.warnings];
  if (upgrade.upgraded) warnings.push(`Backup upgraded from schema v${upgrade.fromVersion} to v${upgrade.toVersion}.`);
  if (upgrade.droppedKeys.length) warnings.push(`${upgrade.droppedKeys.length} unknown field(s) dropped during upgrade.`);
  if (integrity.warnings > 0) warnings.push(`${integrity.warnings} referential-integrity warning(s) — records will still restore.`);

  // Duplicate ids are the only integrity issue that blocks (data would be
  // ambiguous); dangling refs are warnings (the record still restores).
  const errors = integrity.issues.filter((i) => i.severity === "error").map((i) => `${i.domain}/${i.recordId}: ${i.message}`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    upgrade,
    integrity,
    preview,
    backup: errors.length === 0 ? upgrade.backup : undefined,
  };
}
