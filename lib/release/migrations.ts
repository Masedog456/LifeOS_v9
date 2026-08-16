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
 * Historical migrations are never modified. The current head is 0037
 * (`0037_protocols.sql`, the LIFEOS-054 conditional intention). A demonstrated
 * release-blocking database defect would add exactly one narrowly-scoped
 * `0038_v1_release_fix.sql` beyond it.
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
  { id: "current", label: "Current production head", throughVersion: 37 },
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
 */
export const ALLOWED_RELEASE_FIX_MIGRATION = "0038_v1_release_fix.sql";

/** Whether a proposed new migration filename is an allowed release-fix addition. */
export function isAllowedReleaseFixMigration(filename: string): boolean {
  return filename === ALLOWED_RELEASE_FIX_MIGRATION;
}
