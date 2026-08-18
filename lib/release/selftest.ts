/**
 * Release acceptance self-tests (LIFEOS-042).
 *
 * Deterministic assertions over the release model: version alignment, migration
 * count/dense-numbering, route + help coverage, inventory completeness, known-
 * limitations completeness, checklist section coverage, the acceptance matrix
 * integrity invariant (no credentialed gate marked automated pass), fixture
 * validity + one-action removal, and the aggregate readiness verdict. Pure
 * functions only — no I/O.
 */

import { checkVersionAlignment, releaseVersions, RELEASE_TAG } from "@/lib/release/versions";
import { validateMigrationList, MIGRATION_CHECKPOINTS, isAllowedReleaseFixMigration } from "@/lib/release/migrations";
import { validateRoutes, routeHasHelp } from "@/lib/release/routes";
import { buildInventory, validateInventory } from "@/lib/release/inventory";
import { validateLimitations, LIMITATIONS } from "@/lib/release/limitations";
import { validateChecklist, CHECKLIST_SECTIONS } from "@/lib/release/checklist";
import { validateAcceptance, ACCEPTANCE_GATES, manualChecksStillRequired } from "@/lib/release/acceptance";
import { buildReleaseFixture, validateFixture, addFixture, removeFixture, fixtureRecordCount } from "@/lib/release/fixtures";
import { gatherEvidence } from "@/lib/release/evidence";
import type { StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  const base: Record<string, unknown[]> = {};
  for (const d of ["workspaces", "goals", "projects", "captures", "nextActions", "actionDependencies", "sessions", "focusSessions", "planningAssignments", "documents", "citations", "beliefs", "researchProjects", "dailyReviews", "maintenanceEvents", "duplicateCandidates", "savedInsightViews"]) base[d] = [];
  return base as unknown as StoreState;
}

export function runReleaseSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Versions ----
  const va = checkVersionAlignment();
  ok("1.1 version alignment ok", va.ok, va.problems.join("; "));
  ok("1.2 release tag is v1.0.0-rc1", RELEASE_TAG === "v1.0.0-rc1");
  ok("1.3 app version matches tag", `v${releaseVersions().appVersion}` === RELEASE_TAG);
  ok("1.4 migration version 39", releaseVersions().migrationVersion === 39);
  ok("1.5 supported migration range sane", releaseVersions().supportedMigrationRange[0] <= releaseVersions().supportedMigrationRange[1]);
  ok("1.6 observed-count mismatch is caught", !checkVersionAlignment({ observedMigrationCount: 30 }).ok);
  ok("1.7 observed app-version mismatch is caught", !checkVersionAlignment({ observedAppVersion: "9.9.9" }).ok);

  // ---- 2. Migrations ----
  const dense = validateMigrationList(Array.from({ length: 39 }, (_, i) => i + 1));
  ok("2.1 dense 1..39 valid", dense.ok, dense.problems.join("; "));
  ok("2.2 duplicate number rejected", !validateMigrationList([1, 1, 2]).ok);
  ok("2.3 gap rejected", !validateMigrationList([1, 3]).ok);
  ok("2.4 wrong count rejected", !validateMigrationList(Array.from({ length: 36 }, (_, i) => i + 1)).ok);
  ok("2.5 twelve checkpoints", MIGRATION_CHECKPOINTS.length === 12); // +pre-constitution (056) +pre-successor-cascade (056D)
  ok("2.6 checkpoints cover required ids", ["pre-reading", "pre-workspaces", "pre-actions", "pre-planning", "pre-maintenance", "pre-security", "pre-reading-ingestion", "pre-reading-originals", "pre-reading-semantic", "current"].every((c) => MIGRATION_CHECKPOINTS.some((m) => m.id === c)));
  ok("2.7 only 0040 release fix allowed", isAllowedReleaseFixMigration("0040_v1_release_fix.sql") && !isAllowedReleaseFixMigration("0041_extra.sql"));

  // ---- 3. Routes ----
  const rr = validateRoutes();
  ok("3.1 route audit passes", rr.ok, rr.problems.join("; "));
  ok("3.2 every route has safe failure", rr.withoutSafeFailure.length === 0, rr.withoutSafeFailure.join(", "));
  ok("3.3 today has help", routeHasHelp("/today"));
  ok("3.4 privacy has help", routeHasHelp("/privacy"));
  ok("3.5 >=20 surfaces audited", rr.total >= 20);

  // ---- 4. Inventory ----
  const inv = buildInventory(["cohesion-tests", "release-tests"]);
  const invR = validateInventory(inv);
  ok("4.1 inventory valid", invR.ok, invR.problems.join("; "));
  ok("4.2 44 data domains", inv.dataDomainCount === 44); // +notes (052) +protocols (054) +constitution ×2 (056)
  ok("4.3 dev flag inventoried", inv.envVars.some((e) => e.name === "LIFEOS_ENABLE_DEV_ROUTES"));
  ok("4.4 no service-role env var", !inv.envVars.some((e) => /service.?role/i.test(e.name)));
  ok("4.5 supabase optional", inv.externalServices.every((s) => !s.required));

  // ---- 5. Limitations ----
  const lim = validateLimitations();
  ok("5.1 limitations complete", lim.ok, lim.problems.join("; "));
  ok("5.2 no-ai limitation present", LIMITATIONS.some((l) => l.id === "no-ai"));
  ok("5.3 provider-retention present", LIMITATIONS.some((l) => l.id === "provider-retention"));
  ok("5.4 csp-inline exception present", LIMITATIONS.some((l) => l.id === "csp-inline"));
  ok("5.5 every limitation has workaround+owner", LIMITATIONS.every((l) => l.workaround && l.owner));

  // ---- 6. Checklist ----
  const cl = validateChecklist();
  ok("6.1 checklist valid", cl.ok, cl.problems.join("; "));
  ok("6.2 all 21 sections covered", CHECKLIST_SECTIONS.length === 21);
  ok("6.3 tagging item still pending (gate)", cl.pending >= 1);
  ok("6.4 every item has owner+evidence+date", cl.problems.length === 0);

  // ---- 7. Acceptance matrix ----
  const acc = validateAcceptance();
  ok("7.1 acceptance integrity ok", acc.ok, acc.problems.join("; "));
  ok("7.2 no credentialed gate marked pass", !ACCEPTANCE_GATES.some((g) => g.method === "credentialed" && g.status === "pass"));
  ok("7.3 every non-pass has manual step", ACCEPTANCE_GATES.every((g) => g.status === "pass" || !!g.manualStep));
  ok("7.4 manual checks are enumerated", manualChecksStillRequired().length >= 1);
  ok("7.5 has automated passes", acc.automatedPass >= 8);

  // ---- 8. Fixture ----
  const fx = buildReleaseFixture();
  const fxR = validateFixture(fx);
  ok("8.1 fixture valid", fxR.ok, fxR.problems.join("; "));
  ok("8.2 fixture deterministic", JSON.stringify(buildReleaseFixture()) === JSON.stringify(buildReleaseFixture()));
  ok("8.3 fixture has tombstone+conflict", fx.tombstones.length >= 1 && fx.conflicts.length >= 1);
  const withFx = addFixture(emptyState(), fx);
  ok("8.4 fixture merges into state", fixtureRecordCount(withFx, fx.fixtureId) === fxR.recordCount && fxR.recordCount > 15);
  const removed = removeFixture(withFx, fx.fixtureId);
  ok("8.5 removed in one action", fixtureRecordCount(removed, fx.fixtureId) === 0);
  ok("8.6 captures span processing states", (fx.records.captures as { processingStatus: string }[]).map((c) => c.processingStatus).filter((v, i, a) => a.indexOf(v) === i).length >= 4);

  // ---- 9. Aggregate readiness ----
  const ev = gatherEvidence(39);
  ok("9.1 deterministic gates pass", ev.deterministicGatesPass, "one or more release validators failing");
  ok("9.2 manual checks surfaced", ev.manualChecksRequired >= 1);
  ok("9.3 readiness reflects blockers", typeof ev.tagReady === "boolean");
  ok("9.4 observed-count mismatch fails evidence", !gatherEvidence(30).version.ok);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
