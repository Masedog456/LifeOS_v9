/**
 * Client/server schema compatibility — DIAGNOSTIC SUMMARY ONLY (LIFEOS-040,
 * Feature 20).
 *
 * Read this paragraph before the rest. **Nothing in the write path consults
 * this module.** It computes a human-readable mode for the Diagnostics screen
 * and the sanitized report, and that is its entire job today. `syncIsSafe()` has
 * no caller outside self-tests. The decision that actually stops a write from
 * reaching a database that cannot accept it lives in `lib/sync/contract.ts`
 * (`evaluateContract` → `gatedDomains`) and is consumed by the flush loop in
 * `lib/persistence.ts`; `npm run audit:compat` proves it end to end.
 *
 * That distinction has been misread twice, in opposite directions, and both
 * misreadings were expensive:
 *
 *   LIFEOS-077 F-3  treated this module as load-bearing when it was not — the
 *                   write landed while it said `canSync: false`. The repair was
 *                   not to wire this up; it was to gate on the contract, whose
 *                   per-domain answer has a far smaller blast radius.
 *   A later audit   read a superseded diagnostic of that same defect (see
 *                   `scripts/audit-077-f3.cjs`) and concluded the opposite —
 *                   that no runtime protection existed anywhere. It does. The
 *                   claim reached the deployment runbook before it was caught.
 *
 * So: if you are here because you want writes blocked, you are in the wrong
 * file. If you are here because a row on `/security` is wrong, you are in the
 * right one.
 *
 * The modes it reports:
 *
 *   ok           → nothing to say
 *   read-only    → client and server schema generations differ in either
 *                  direction; sync is described as paused
 *   upgrade      → local state is OLDER than this build expects: a safe in-app
 *                  state upgrade should run before writes
 *   blocked      → local state is NEWER than this build understands
 *
 * SCALE HAZARD. `remoteMigrationVersion` and `expectedMigrationVersion` are
 * compared directly, so they must be two values on the SAME scale — and the
 * names are now a historical accident. The sole production caller
 * (`DiagnosticsCenter`) passes the server's *capability contract generation*
 * against `CLIENT_CONTRACT`, which is a valid like-for-like comparison. But
 * `expectedMigrationVersion` defaults to `EXPECTED_MIGRATION_VERSION`, a
 * migration count — so a caller who supplies only the remote side silently
 * compares a contract generation against a migration number and gets a
 * meaningless answer. Pass both, always.
 */

import { CURRENT_STATE_VERSION } from "@/lib/migrations/state-version";

/** The latest migration number this build ships (keep in step with supabase/migrations). */
export const EXPECTED_MIGRATION_VERSION = 48;   // 0048_billing_subscriptions (LIFEOS-BILLING)

export type CompatMode = "ok" | "read-only" | "upgrade" | "blocked";

export interface CompatInput {
  /** Local persisted StoreState version (from detectStateVersion). */
  localStateVersion: number;
  /** The state version this build understands. */
  expectedStateVersion?: number;
  /**
   * The remote's schema generation, or null when offline / local-only.
   *
   * Despite the name, the production caller supplies the server's *capability
   * contract generation* — there is no migration ledger to read (migration
   * 0046, deliberately). Whatever scale you use here, use the same one below.
   */
  remoteMigrationVersion?: number | null;
  /**
   * The generation this build expects, on the SAME scale as the field above.
   *
   * Defaults to `EXPECTED_MIGRATION_VERSION`, which is a migration count. That
   * default is only correct if the remote side is also a migration count — so
   * a caller passing a contract generation MUST pass `CLIENT_CONTRACT` here
   * rather than relying on it.
   */
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
