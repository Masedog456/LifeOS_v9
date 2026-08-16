/**
 * Client/server schema compatibility (LIFEOS-040, Feature 20).
 *
 * On startup LifeOS compares three numbers: the local persisted-state version,
 * the version this app build expects, and (when a remote is configured) the
 * highest migration the server reports. The gate DECIDES a mode:
 *
 *   ok           → normal read + write
 *   read-only    → the server is AHEAD of this client (its schema is newer): we
 *                  still let the user read and EXPORT, but block writes/sync so a
 *                  stale client can't clobber newer data
 *   upgrade      → local state is OLDER than this build expects: a safe in-app
 *                  state upgrade should run before writes
 *   blocked      → versions are irreconcilable / unknown; read + export only
 *
 * The rule the spec insists on: never continue DESTRUCTIVE synchronization under
 * unknown schema compatibility. When in doubt we fail closed to read/export.
 */

import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";

/** The latest migration number this build ships (keep in step with supabase/migrations). */
export const EXPECTED_MIGRATION_VERSION = 36;   // 0036_action_due_date (LIFEOS-053)

export type CompatMode = "ok" | "read-only" | "upgrade" | "blocked";

export interface CompatInput {
  /** Local persisted StoreState version (from detectStateVersion). */
  localStateVersion: number;
  /** The state version this build understands. */
  expectedStateVersion?: number;
  /** Highest migration the remote reports, or null when offline / local-only. */
  remoteMigrationVersion?: number | null;
  /** Highest migration this build ships. */
  expectedMigrationVersion?: number;
}

export interface CompatResult {
  mode: CompatMode;
  canRead: boolean;
  canWrite: boolean;
  canSync: boolean;
  canExport: boolean;
  reason: string;
  /** Actionable, non-technical guidance for the user. */
  guidance: string;
}

export function evaluateCompatibility(input: CompatInput): CompatResult {
  const expectedState = input.expectedStateVersion ?? CURRENT_STATE_VERSION;
  const expectedMigration = input.expectedMigrationVersion ?? EXPECTED_MIGRATION_VERSION;
  const remote = input.remoteMigrationVersion;

  // Local state newer than this build understands → do not risk a lossy write.
  if (input.localStateVersion > expectedState) {
    return mk("blocked", { read: true, write: false, sync: false, export: true },
      "Local data was written by a newer version of LifeOS than this one.",
      "Update LifeOS to the latest version. Until then you can read and export your data, but changes are paused to protect it.");
  }

  // Local state older than this build → run the in-app upgrade first.
  if (input.localStateVersion < expectedState) {
    return mk("upgrade", { read: true, write: false, sync: false, export: true },
      "Local data uses an older format and needs a quick upgrade.",
      "LifeOS will upgrade your local data format before saving changes. Your data is preserved.");
  }

  // Remote ahead of this client → read-only against the server (fail closed).
  if (typeof remote === "number" && remote > expectedMigration) {
    return mk("read-only", { read: true, write: true, sync: false, export: true },
      "The server has a newer database schema than this app build.",
      "Update LifeOS. You can keep working locally and export, but syncing is paused so a newer server isn't written by an older client.");
  }

  // Remote behind this client (rare) or unknown-but-configured mismatch.
  if (typeof remote === "number" && remote < expectedMigration) {
    return mk("read-only", { read: true, write: true, sync: false, export: true },
      "The server database is behind this app build.",
      "A database migration is pending. Local work continues; syncing resumes once the server is upgraded.");
  }

  return mk("ok", { read: true, write: true, sync: true, export: true },
    "Client and server schema versions are compatible.",
    "Everything is up to date.");
}

function mk(mode: CompatMode, caps: { read: boolean; write: boolean; sync: boolean; export: boolean }, reason: string, guidance: string): CompatResult {
  return { mode, canRead: caps.read, canWrite: caps.write, canSync: caps.sync, canExport: caps.export, reason, guidance };
}

/** True when it is safe to perform destructive synchronization. */
export function syncIsSafe(result: CompatResult): boolean {
  return result.mode === "ok" && result.canSync;
}
