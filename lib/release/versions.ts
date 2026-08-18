/**
 * Canonical release version identifiers (LIFEOS-042, Feature 33).
 *
 * One source of truth for every version number a Version 1 release must keep in
 * agreement: the human release tag, the app version surfaced in diagnostics and
 * exports, the database migration version/count, the persisted local-state
 * version, the export archive version, and the supported schema range. A
 * self-test (and the release audit) asserts these agree with the constants the
 * rest of the codebase already exports, so the UI, exports, and the tag can
 * never silently drift apart.
 *
 * This module is deterministic and dependency-light: it re-imports the existing
 * constants rather than restating them, so alignment is checked, not duplicated.
 */

import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";
import { EXPECTED_MIGRATION_VERSION } from "@/lib/security/schema-compatibility";
import { EXPORT_ARCHIVE_VERSION, MIN_SUPPORTED_ARCHIVE_VERSION } from "@/lib/backup/versioning";
import { BACKUP_SCHEMA_VERSION } from "@/lib/ux/backup";

/** The human-facing release tag for the Version 1 release candidate. */
export const RELEASE_TAG = "v1.0.0-rc1";

/** The app version reported in diagnostics and export metadata (no `v` prefix). */
export const RELEASE_APP_VERSION = "1.0.0-rc1";

/** The annotated tag message used when the release is finally cut. */
export const RELEASE_TAG_MESSAGE = "LifeOS Version 1 Release Candidate";

/** The highest migration number that ships in this release (0039). */
export const RELEASE_MIGRATION_VERSION = EXPECTED_MIGRATION_VERSION;

/** The count of migration files that ship in this release. Equal to the highest
 * number because numbering is dense (0001..0039). Verified against the real
 * files by the migration model + release audit. */
export const RELEASE_MIGRATION_COUNT = 39;

/** The lowest migration version an installed client is allowed to run against
 * without a forced upgrade (forward-compatible additive schema only). */
export const MIN_SUPPORTED_MIGRATION_VERSION = 20;

export interface ReleaseVersions {
  releaseTag: string;
  appVersion: string;
  migrationVersion: number;
  migrationCount: number;
  stateVersion: number;
  exportArchiveVersion: number;
  backupSchemaVersion: number;
  supportedMigrationRange: [number, number];
  supportedArchiveRange: [number, number];
}

/** The canonical, resolved set of version identifiers for this release. */
export function releaseVersions(): ReleaseVersions {
  return {
    releaseTag: RELEASE_TAG,
    appVersion: RELEASE_APP_VERSION,
    migrationVersion: RELEASE_MIGRATION_VERSION,
    migrationCount: RELEASE_MIGRATION_COUNT,
    stateVersion: CURRENT_STATE_VERSION,
    exportArchiveVersion: EXPORT_ARCHIVE_VERSION,
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    supportedMigrationRange: [MIN_SUPPORTED_MIGRATION_VERSION, RELEASE_MIGRATION_VERSION],
    supportedArchiveRange: [MIN_SUPPORTED_ARCHIVE_VERSION, EXPORT_ARCHIVE_VERSION],
  };
}

export interface VersionAlignment {
  ok: boolean;
  problems: string[];
  observed: {
    tag: string;
    appVersion: string;
    stateVersion: number;
    expectedMigrationVersion: number;
    exportArchiveVersion: number;
    backupSchemaVersion: number;
  };
}

/**
 * Verify the release version identifiers agree with the live constants across
 * the codebase. Optionally cross-check against an observed migration count
 * (e.g. from counting the real migration files) and the app version the running
 * UI would display.
 */
export function checkVersionAlignment(input?: {
  observedMigrationCount?: number;
  observedAppVersion?: string;
}): VersionAlignment {
  const problems: string[] = [];
  const v = releaseVersions();

  if (!/^v\d+\.\d+\.\d+(-rc\d+)?$/.test(v.releaseTag)) {
    problems.push(`release tag "${v.releaseTag}" is not a valid semver tag`);
  }
  if (`v${v.appVersion}` !== v.releaseTag) {
    problems.push(`app version "${v.appVersion}" does not match release tag "${v.releaseTag}"`);
  }
  if (v.migrationCount !== v.migrationVersion) {
    problems.push(`migration count ${v.migrationCount} != migration version ${v.migrationVersion} (dense numbering expected)`);
  }
  if (v.stateVersion !== CURRENT_STATE_VERSION) {
    problems.push(`state version ${v.stateVersion} != CURRENT_STATE_VERSION ${CURRENT_STATE_VERSION}`);
  }
  if (v.migrationVersion !== EXPECTED_MIGRATION_VERSION) {
    problems.push(`migration version ${v.migrationVersion} != EXPECTED_MIGRATION_VERSION ${EXPECTED_MIGRATION_VERSION}`);
  }
  if (v.supportedMigrationRange[0] > v.supportedMigrationRange[1]) {
    problems.push(`supported migration range is inverted: ${v.supportedMigrationRange.join("..")}`);
  }
  if (input?.observedMigrationCount != null && input.observedMigrationCount !== v.migrationCount) {
    problems.push(`observed migration files ${input.observedMigrationCount} != declared count ${v.migrationCount}`);
  }
  if (input?.observedAppVersion != null && input.observedAppVersion !== v.appVersion) {
    problems.push(`UI app version "${input.observedAppVersion}" != release app version "${v.appVersion}"`);
  }

  return {
    ok: problems.length === 0,
    problems,
    observed: {
      tag: v.releaseTag,
      appVersion: v.appVersion,
      stateVersion: CURRENT_STATE_VERSION,
      expectedMigrationVersion: EXPECTED_MIGRATION_VERSION,
      exportArchiveVersion: EXPORT_ARCHIVE_VERSION,
      backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    },
  };
}
