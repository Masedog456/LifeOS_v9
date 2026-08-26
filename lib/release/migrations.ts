/**
 * Release migration model (LIFEOS-042, Features 4 & 35).
 *
 * Declared expectations about the migration chain — the representative upgrade
 * checkpoints the release must rehearse, and pure validators for a parsed list
 * of migration numbers (dense numbering, no duplicates, expected count). The
 * real Postgres rehearsal lives in `scripts/migration-rehearsal.mjs`; this
 * module holds the deterministic expectations that both the rehearsal and the
 * release self-test check against, so the two can never disagree.
 *
 * Historical migrations are never modified. The current head is **0044**
 * (`0044_workspace_session_current_action.sql`, LIFEOS-074 — the three
 * execution pointers `WorkspaceSession` already kept and the table had no
 * columns for). A demonstrated release-blocking database defect would add
 * exactly one narrowly-scoped `0045_v1_release_fix.sql` beyond it; see
 * `ALLOWED_RELEASE_FIX_MIGRATION` below.
 */

import { RELEASE_MIGRATION_COUNT } from "@/lib/release/versions";

/**
 * Representative upgrade checkpoints (Feature 4). Each names a point in product
 * history and the highest migration number applied at that point — an installed
 * client on that checkpoint must upgrade cleanly to the current head.
 */
export interface MigrationCheckpoint {
  id: string;
  label: string;
  throughVersion: number;
}

export const MIGRATION_CHECKPOINTS: readonly MigrationCheckpoint[] = [
  { id: "pre-reading", label: "Before the reading library", throughVersion: 20 },
  { id: "pre-workspaces", label: "Before workspaces & sessions", throughVersion: 21 },
  { id: "pre-actions", label: "Before next actions", throughVersion: 26 },
  { id: "pre-planning", label: "Before planning & focus", throughVersion: 27 },
  { id: "pre-maintenance", label: "Before knowledge maintenance", throughVersion: 28 },
  { id: "pre-security", label: "Before security & production hardening", throughVersion: 30 },
  { id: "pre-reading-ingestion", label: "Before native reading upload", throughVersion: 31 },
  { id: "pre-reading-originals", label: "Before reading-file persistence", throughVersion: 32 },
  { id: "pre-reading-semantic", label: "Before the reading semantic index", throughVersion: 33 },
  { id: "pre-constitution", label: "Before the Living Constitution", throughVersion: 37 },
  { id: "pre-successor-cascade", label: "Before the revision successor cascade", throughVersion: 38 },
  { id: "pre-calendar", label: "Before external calendar identity", throughVersion: 40 },
  { id: "pre-integrations", label: "Before integration account linking", throughVersion: 41 },
  { id: "pre-due-time-recurrence", label: "Before the due-time/recurrence contract fix", throughVersion: 42 },
  { id: "pre-session-pointers", label: "Before workspace-session execution pointers", throughVersion: 43 },
  { id: "current", label: "Current production head", throughVersion: 44 },
];

export interface MigrationListReport {
  ok: boolean;
  count: number;
  problems: string[];
  numbers: number[];
}

/**
 * Validate a parsed list of migration numbers: dense 1..N with no gaps or
 * duplicates and matching the declared release count. `numbers` is whatever a
 * caller parsed from the migration filenames (order-independent).
 */
export function validateMigrationList(numbers: number[]): MigrationListReport {
  const problems: string[] = [];
  const sorted = [...numbers].sort((a, b) => a - b);
  const seen = new Set<number>();
  for (const n of sorted) {
    if (seen.has(n)) problems.push(`duplicate migration number ${n}`);
    seen.add(n);
  }
  for (let i = 1; i <= sorted.length; i++) {
    if (!seen.has(i)) problems.push(`missing migration number ${i} (numbering must be dense)`);
  }
  if (sorted.length && sorted[0] !== 1) problems.push(`migration numbering must start at 1, starts at ${sorted[0]}`);
  if (sorted.length !== RELEASE_MIGRATION_COUNT) {
    problems.push(`migration count ${sorted.length} != declared release count ${RELEASE_MIGRATION_COUNT}`);
  }
  const head = sorted[sorted.length - 1] ?? 0;
  if (sorted.length && head !== sorted.length) {
    problems.push(`head migration ${head} != count ${sorted.length} (dense numbering expected)`);
  }
  return { ok: problems.length === 0, count: sorted.length, problems, numbers: sorted };
}

/**
 * A demonstrated release-blocking migration fix may add exactly this file, and
 * nothing else. The audit rejects any new migration beyond it.
 *
 * 0040 was reserved for an emergency fix and was never needed. LIFEOS-061 spent
 * the number on the time foundation instead — a planned, reviewed schema change,
 * not a hotfix — so the escape hatch moves to the next number rather than being
 * removed. The point of the hatch is that exactly ONE unplanned migration may
 * follow the head, and that remains true.
 *
 * LIFEOS-067 did the same thing again: 0041 became external calendar identity —
 * four nullable columns on `events`, reviewed at a schema gate before it was
 * written — so the hatch shifted to 0042. LIFEOS-068 spent that number on
 * integration accounts, also gated and reviewed first, so the hatch is now
 * 0043. LIFEOS-074 then spent 0043 on the due-time/recurrence contract repair —
 * a P1 found by audit, reported under the stop-and-report rule, and approved
 * before a line of SQL was written. 0044 went the same way, for the P2 the same
 * audit found next. So the hatch moves twice more, to 0045. Five moves, never
 * once spent: that is the outcome it was designed for.
 */
export const ALLOWED_RELEASE_FIX_MIGRATION = "0045_v1_release_fix.sql";

/** Whether a proposed new migration filename is an allowed release-fix addition. */
export function isAllowedReleaseFixMigration(filename: string): boolean {
  return filename === ALLOWED_RELEASE_FIX_MIGRATION;
}
