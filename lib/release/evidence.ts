/**
 * Release evidence aggregation (LIFEOS-042, Feature 35).
 *
 * Composes every deterministic release validator into one readiness snapshot the
 * /release UI and the release audit render. It reports gate counts and the tag-
 * readiness verdict honestly: the tag is "ready" only when all deterministic
 * gates pass AND there are no open blockers — but credentialed manual checks are
 * always listed as still-required, so "ready" here means "the automatable gates
 * pass", never "GA is done".
 */

import { checkVersionAlignment } from "@/lib/release/versions";
import { buildInventory, validateInventory } from "@/lib/release/inventory";
import { validateRoutes } from "@/lib/release/routes";
import { validateLimitations } from "@/lib/release/limitations";
import { validateChecklist } from "@/lib/release/checklist";
import { validateAcceptance, manualChecksStillRequired } from "@/lib/release/acceptance";
import { buildReleaseFixture, validateFixture } from "@/lib/release/fixtures";
import { validateMigrationList, MIGRATION_CHECKPOINTS } from "@/lib/release/migrations";
import { RELEASE_MIGRATION_COUNT } from "@/lib/release/versions";

export interface ReleaseEvidence {
  version: ReturnType<typeof checkVersionAlignment>;
  inventory: ReturnType<typeof validateInventory>;
  routes: ReturnType<typeof validateRoutes>;
  limitations: ReturnType<typeof validateLimitations>;
  checklist: ReturnType<typeof validateChecklist>;
  acceptance: ReturnType<typeof validateAcceptance>;
  fixture: ReturnType<typeof validateFixture>;
  migrations: ReturnType<typeof validateMigrationList>;
  checkpointCount: number;
  deterministicGatesPass: boolean;
  openBlockerCount: number;
  manualChecksRequired: number;
  tagReady: boolean;
}

/**
 * Gather all deterministic evidence. `observedMigrationCount` may be supplied by
 * a caller that counted the real migration files (the release audit does this);
 * absent it, the declared count is validated for internal consistency.
 */
export function gatherEvidence(observedMigrationCount?: number): ReleaseEvidence {
  const version = checkVersionAlignment({ observedMigrationCount });
  const inventory = validateInventory(buildInventory());
  const routes = validateRoutes();
  const limitations = validateLimitations();
  const checklist = validateChecklist();
  const acceptance = validateAcceptance();
  const fixture = validateFixture(buildReleaseFixture());
  // In the absence of parsed files, validate the declared dense chain 1..N.
  const numbers = Array.from({ length: observedMigrationCount ?? RELEASE_MIGRATION_COUNT }, (_, i) => i + 1);
  const migrations = validateMigrationList(numbers);

  const deterministicGatesPass =
    version.ok && inventory.ok && routes.ok && limitations.ok &&
    checklist.ok && acceptance.ok && fixture.ok && migrations.ok;

  const openBlockerCount = checklist.openBlockers.length;
  const manualChecksRequired = manualChecksStillRequired().length;

  return {
    version, inventory, routes, limitations, checklist, acceptance, fixture, migrations,
    checkpointCount: MIGRATION_CHECKPOINTS.length,
    deterministicGatesPass,
    openBlockerCount,
    manualChecksRequired,
    // The tag is only ready once deterministic gates pass and no open blocker
    // remains. Manual credentialed checks are surfaced separately and gate GA.
    tagReady: deterministicGatesPass && openBlockerCount === 0,
  };
}

/** A one-line readiness summary for logs and the UI. */
export function readinessLine(e: ReleaseEvidence): string {
  return [
    `deterministic gates: ${e.deterministicGatesPass ? "PASS" : "FAIL"}`,
    `open blockers: ${e.openBlockerCount}`,
    `manual checks required: ${e.manualChecksRequired}`,
    `tag ready: ${e.tagReady ? "yes" : "no"}`,
  ].join(" · ");
}
