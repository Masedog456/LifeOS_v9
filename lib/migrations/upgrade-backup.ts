/**
 * Backup-file schema upgrades (LIFEOS-033, Feature 11).
 *
 * A backup exported by an older LifeOS carries an older `schemaVersion` and an
 * older `data` shape. Before a restore validates/applies, we upgrade the file's
 * `data` through the same ordered `upgradeState` pipeline and bump its
 * `schemaVersion`, preserving `prefs` and provenance. Deterministic and
 * idempotent; the original file is never mutated — this returns a new object.
 */

import type { LifeOSBackup } from "@/lib/ux/backup";
import { BACKUP_SCHEMA_VERSION } from "@/lib/ux/backup";
import { upgradeState } from "@/lib/migrations/upgrade-state";

export interface BackupUpgradeResult {
  backup: LifeOSBackup;
  fromVersion: number;
  toVersion: number;
  upgraded: boolean;
  droppedKeys: string[];
}

/** Upgrade a validated-shape backup to the current schema (pure). */
export function upgradeBackup(backup: LifeOSBackup): BackupUpgradeResult {
  const fromVersion = typeof backup.schemaVersion === "number" ? backup.schemaVersion : 0;
  const up = upgradeState(backup.data);
  const upgraded = fromVersion < BACKUP_SCHEMA_VERSION || up.changed;
  return {
    backup: {
      ...backup,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      data: up.state as LifeOSBackup["data"],
    },
    fromVersion,
    toVersion: BACKUP_SCHEMA_VERSION,
    upgraded,
    droppedKeys: up.droppedKeys,
  };
}
