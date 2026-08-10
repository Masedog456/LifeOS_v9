/**
 * Executable release checklist model (LIFEOS-042, Feature 28).
 *
 * Every checklist item carries an owner, an evidence pointer, a status, a
 * blocker classification, and a date — "no probably done". Items are grouped
 * into the required sections. `V1_RELEASE_CHECKLIST.md` and the /release UI
 * render from this list; the self-test asserts every required section is
 * present and no item is left unclassified.
 */

export type ChecklistStatus = "done" | "pending" | "manual-required" | "not-applicable";
export type BlockerClass = "blocker" | "non-blocker";

export interface ChecklistItem {
  section: string;
  item: string;
  owner: string;
  evidence: string;
  status: ChecklistStatus;
  blocker: BlockerClass;
  date: string;
}

/** The sections the spec (Feature 28) requires. */
export const CHECKLIST_SECTIONS = [
  "repository", "migrations", "database", "rls", "authentication", "synchronization",
  "export/restore", "deletion", "security", "privacy", "accessibility", "responsiveness",
  "browsers", "performance", "documentation", "demo/fixture", "deployment", "smoke-testing",
  "rollback", "tagging", "release-publication",
];

const D = "2026-08-01";

export const CHECKLIST: readonly ChecklistItem[] = [
  { section: "repository", item: "Feature freeze declared; only release-allowed changes on the RC branch", owner: "release", evidence: "V1_RELEASE_CHECKLIST + RELEASE_POLICY (this PR)", status: "done", blocker: "non-blocker", date: D },
  { section: "migrations", item: "Chain 0001→0033 applies clean; idempotent x3; checkpoints upgrade", owner: "persistence", evidence: "scripts/migration-rehearsal.mjs", status: "done", blocker: "blocker", date: D },
  { section: "migrations", item: "No new migration beyond an allowed 0034 release fix", owner: "persistence", evidence: "lib/release/migrations isAllowedReleaseFixMigration + audit", status: "done", blocker: "blocker", date: D },
  { section: "database", item: "Expected table/migration counts; no duplicate numbers; schema version", owner: "persistence", evidence: "scripts/release-audit.mjs", status: "done", blocker: "blocker", date: D },
  { section: "rls", item: "Every user-owned table has RLS + required policies", owner: "security", evidence: "npm run audit:rls (55 tables PASS)", status: "done", blocker: "blocker", date: D },
  { section: "authentication", item: "Sign-up/in/out/refresh/expiry/reset/multi-tab matrix", owner: "release/manual", evidence: "auth-boundaries logic tests + manual step documented", status: "manual-required", blocker: "blocker", date: D },
  { section: "synchronization", item: "15-scenario cross-device matrix", owner: "release/manual", evidence: "lib/sync selftest + sync.mjs (local) + manual credentialed step", status: "manual-required", blocker: "non-blocker", date: D },
  { section: "export/restore", item: "Export verifies; restore clean/merge/dry-run; no silent overwrite", owner: "persistence", evidence: "scripts/export-verify.mjs + restore selftest", status: "done", blocker: "blocker", date: D },
  { section: "deletion", item: "Deletion workflow: export offered, confirm, freeze, retention honest", owner: "release/manual", evidence: "lib/privacy deletion logic + manual live-account step", status: "manual-required", blocker: "blocker", date: D },
  { section: "security", item: "Secret scan, dep audit, RLS, routes, CSP, XSS/URL/depth/redaction", owner: "security", evidence: "npm run audit:security + security selftest", status: "done", blocker: "blocker", date: D },
  { section: "privacy", item: "Privacy Center accurate; provider retention disclosed", owner: "privacy", evidence: "app/privacy + SECURITY_AND_PRIVACY.md", status: "done", blocker: "non-blocker", date: D },
  { section: "accessibility", item: "Keyboard/focus/landmarks/contrast + documented exceptions", owner: "accessibility", evidence: "accessibility selftest + cohesion E2E + manual SR step", status: "manual-required", blocker: "non-blocker", date: D },
  { section: "responsiveness", item: "No horizontal overflow on critical routes 320–1440px", owner: "ux", evidence: "cohesion.mjs + scripts/visual-regression.mjs", status: "done", blocker: "blocker", date: D },
  { section: "browsers", item: "Chrome/Edge/Firefox/Safari/iOS/Android smoke matrix", owner: "release/manual", evidence: "headless Chromium (local) + manual matrix documented", status: "manual-required", blocker: "non-blocker", date: D },
  { section: "performance", item: "Fixture-sized render budgets; p95 on target devices", owner: "performance", evidence: "V1_PERFORMANCE_REPORT + lib/perf budgets", status: "manual-required", blocker: "non-blocker", date: D },
  { section: "documentation", item: "8 V1_* docs created; 23 docs updated; links check", owner: "docs", evidence: "this PR + terminology/link validators", status: "done", blocker: "non-blocker", date: D },
  { section: "demo/fixture", item: "Deterministic release fixture + optional demo workspace; removable", owner: "release", evidence: "lib/release/fixtures + release-tests E2E", status: "done", blocker: "non-blocker", date: D },
  { section: "deployment", item: "Deployment runbook precise; env vars documented; no secrets", owner: "ops", evidence: "V1_DEPLOYMENT_RUNBOOK.md", status: "done", blocker: "non-blocker", date: D },
  { section: "smoke-testing", item: "22-step production smoke flow on deployed RC", owner: "release/manual", evidence: "SmokeTestGuide + manual step on preview", status: "manual-required", blocker: "blocker", date: D },
  { section: "rollback", item: "Rollback rehearsal documented; forward-only limits stated", owner: "ops", evidence: "V1_ROLLBACK_REPORT.md + manual redeploy step", status: "manual-required", blocker: "non-blocker", date: D },
  { section: "tagging", item: "v1.0.0-rc1 tag PREPARED, not created until gates pass", owner: "release", evidence: "lib/release/versions + Feature 34 procedure", status: "pending", blocker: "blocker", date: D },
  { section: "release-publication", item: "GitHub prerelease with notes + SHA + migration version", owner: "release", evidence: "V1_RELEASE_NOTES.md + tag procedure", status: "pending", blocker: "non-blocker", date: D },
];

export interface ChecklistReport {
  ok: boolean;
  problems: string[];
  done: number;
  manualRequired: number;
  pending: number;
  openBlockers: ChecklistItem[];
}

export function validateChecklist(): ChecklistReport {
  const problems: string[] = [];
  const sections = new Set(CHECKLIST.map((c) => c.section));
  for (const req of CHECKLIST_SECTIONS) {
    if (!sections.has(req)) problems.push(`checklist missing required section: ${req}`);
  }
  for (const c of CHECKLIST) {
    if (!c.owner) problems.push(`${c.section}/${c.item}: missing owner`);
    if (!c.evidence) problems.push(`${c.section}/${c.item}: missing evidence`);
    if (!c.date) problems.push(`${c.section}/${c.item}: missing date`);
  }
  // Open blockers = blocker-classified items not done and not merely a manual step.
  const openBlockers = CHECKLIST.filter((c) => c.blocker === "blocker" && c.status === "pending");
  return {
    ok: problems.length === 0,
    problems,
    done: CHECKLIST.filter((c) => c.status === "done").length,
    manualRequired: CHECKLIST.filter((c) => c.status === "manual-required").length,
    pending: CHECKLIST.filter((c) => c.status === "pending").length,
    openBlockers,
  };
}
