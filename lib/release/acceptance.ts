/**
 * Release acceptance matrix (LIFEOS-042, Features 3–23, 30–32).
 *
 * Every release gate with an HONEST classification of how it is verified:
 *
 *   - "automated"   — a deterministic test / audit in this repo proves it, and
 *                     re-runs on demand (evidence = the command that proves it).
 *   - "credentialed" — requires live Supabase and/or a real production
 *                     deployment and/or multiple real devices/browsers; CANNOT
 *                     be marked passed from this environment. Its status stays
 *                     "manual-required" with a documented procedure.
 *   - "hybrid"      — partially automated here (logic/model/local-adapter) with
 *                     a credentialed portion still required before GA.
 *
 * The self-test enforces the rule the spec states twice: a credentialed gate may
 * NOT carry an automated "pass". This is how the release refuses to manufacture
 * confidence.
 */

export type VerifyMethod = "automated" | "credentialed" | "hybrid";
export type GateStatus = "pass" | "manual-required" | "partial";

export interface AcceptanceGate {
  id: string;
  feature: number;
  title: string;
  method: VerifyMethod;
  status: GateStatus;
  /** For automated/partial: the command or module that proves the automated part. */
  evidence: string;
  /** For credentialed/hybrid: what a human must still run before GA. */
  manualStep?: string;
}

export const ACCEPTANCE_GATES: readonly AcceptanceGate[] = [
  { id: "route-audit", feature: 3, title: "Route audit", method: "hybrid", status: "partial", evidence: "lib/release/routes.ts validateRoutes() + scripts/route-smoke.mjs (local build)", manualStep: "Run route-smoke against the deployed preview URL." },
  { id: "migration-rehearsal", feature: 4, title: "Migration rehearsal (0001→0033, idempotency, checkpoints)", method: "automated", status: "pass", evidence: "scripts/migration-rehearsal.mjs against local Postgres 16" },
  { id: "schema-audit", feature: 5, title: "Production schema audit", method: "automated", status: "pass", evidence: "scripts/release-audit.mjs + scripts/audit-rls.mjs" },
  { id: "two-user-isolation", feature: 6, title: "Two-user isolation matrix", method: "hybrid", status: "partial", evidence: "scripts/migration-rehearsal.mjs RLS cross-user probes on local Postgres", manualStep: "Repeat on the production Supabase project with two real accounts." },
  { id: "auth", feature: 7, title: "Authentication acceptance", method: "credentialed", status: "manual-required", evidence: "lib/security/auth-boundaries + multi-tab logic tests (local)", manualStep: "Run sign-up/in/out/refresh/expiry/reset matrix against live Supabase auth." },
  { id: "sync", feature: 8, title: "Cross-device sync acceptance (15 scenarios)", method: "hybrid", status: "partial", evidence: "lib/sync selftest + sync.mjs E2E (local adapter, deterministic conflict/merge/tombstone logic)", manualStep: "Execute the 15-scenario matrix across two real devices on live Supabase." },
  { id: "data-preservation", feature: 9, title: "Data-preservation acceptance", method: "hybrid", status: "partial", evidence: "upgrade-state/backup migration tests + persistence selftest + DST/timezone insight tests", manualStep: "Second-device and failed-remote-sync legs require live sync." },
  { id: "export", feature: 10, title: "Export acceptance", method: "automated", status: "pass", evidence: "scripts/export-verify.mjs over the release fixture (manifest+checksums+counts+no-secrets)" },
  { id: "restore", feature: 11, title: "Restore acceptance (clean/merge/dry-run)", method: "automated", status: "pass", evidence: "lib/backup restore + import-preview selftest + export-verify dry-run" },
  { id: "deletion", feature: 12, title: "Account deletion acceptance", method: "credentialed", status: "manual-required", evidence: "lib/privacy deletion staging logic + retention disclosure (local)", manualStep: "Run the full deletion workflow with a disposable live account." },
  { id: "security", feature: 13, title: "Security acceptance", method: "automated", status: "pass", evidence: "npm run audit:security (rls+routes+secrets+deps) + security selftest (XSS/URL/depth/redaction)" },
  { id: "prod-headers", feature: 14, title: "Production header validation", method: "credentialed", status: "manual-required", evidence: "lib/security/headers + middleware (local)", manualStep: "curl the deployed URL and assert CSP/HSTS/Referrer/Permissions/XCTO + HTTPS redirect." },
  { id: "accessibility", feature: 15, title: "Accessibility acceptance", method: "hybrid", status: "partial", evidence: "lib/accessibility audit selftest + cohesion E2E (keyboard/focus/no-overflow)", manualStep: "Screen-reader naming pass (VoiceOver/NVDA) on critical safety flows." },
  { id: "responsive", feature: 16, title: "Responsive acceptance (320–1440px)", method: "automated", status: "pass", evidence: "scripts/visual-regression.mjs + cohesion.mjs no-overflow checks at breakpoints" },
  { id: "browser-matrix", feature: 17, title: "Browser matrix", method: "credentialed", status: "manual-required", evidence: "headless Chromium smoke only (local)", manualStep: "Run smoke flows on real Chrome/Edge/Firefox/Safari/iOS/Android; record versions." },
  { id: "performance", feature: 18, title: "Performance acceptance", method: "hybrid", status: "partial", evidence: "lib/perf budgets + fixture-sized render measurements (headless)", manualStep: "Confirm p95 on target device classes/real browsers." },
  { id: "error-recovery", feature: 19, title: "Error & recovery drill", method: "automated", status: "pass", evidence: "lib/security storage-resilience + lib/sync recovery selftest + error boundary tests" },
  { id: "observability", feature: 20, title: "Observability acceptance", method: "automated", status: "pass", evidence: "lib/security/diagnostics + health selftest (sanitized, no record contents)" },
  { id: "onboarding", feature: 21, title: "Onboarding acceptance", method: "automated", status: "pass", evidence: "cohesion.mjs onboarding E2E (blank/skip/resume/reset/sample/keyboard/mobile)" },
  { id: "help-docs", feature: 22, title: "Help & documentation acceptance", method: "automated", status: "pass", evidence: "lib/release/routes help coverage + terminology validator + docs link check" },
  { id: "visual-regression", feature: 23, title: "Visual regression acceptance", method: "automated", status: "pass", evidence: "scripts/visual-regression.mjs deterministic screenshots (explicit approval)" },
  { id: "rollback", feature: 30, title: "Rollback rehearsal", method: "credentialed", status: "manual-required", evidence: "V1_ROLLBACK_REPORT documented procedure + forward-only migration analysis", manualStep: "Redeploy previous Vercel build; run older app against additive schema." },
  { id: "smoke", feature: 31, title: "Production smoke test", method: "credentialed", status: "manual-required", evidence: "SmokeTestGuide checklist (local)", manualStep: "Execute the 22-step smoke flow on the deployed RC with a disposable account." },
] as const;

export interface AcceptanceReport {
  ok: boolean;
  problems: string[];
  automatedPass: number;
  manualRequired: number;
  partial: number;
  total: number;
}

/**
 * Validate the matrix's integrity. The critical invariant: no credentialed gate
 * may claim an automated pass, and every non-passed gate must document the
 * manual step still required.
 */
export function validateAcceptance(): AcceptanceReport {
  const problems: string[] = [];
  for (const g of ACCEPTANCE_GATES) {
    if (g.method === "credentialed" && g.status === "pass") {
      problems.push(`${g.id}: credentialed gate must not be marked automated pass`);
    }
    if (g.status !== "pass" && !g.manualStep) {
      problems.push(`${g.id}: non-passed gate must document the manual step required`);
    }
    if (!g.evidence) problems.push(`${g.id}: missing evidence pointer`);
  }
  return {
    ok: problems.length === 0,
    problems,
    automatedPass: ACCEPTANCE_GATES.filter((g) => g.status === "pass").length,
    manualRequired: ACCEPTANCE_GATES.filter((g) => g.status === "manual-required").length,
    partial: ACCEPTANCE_GATES.filter((g) => g.status === "partial").length,
    total: ACCEPTANCE_GATES.length,
  };
}

/** The manual, credentialed checks still required before GA (Feature 44). */
export function manualChecksStillRequired(): { id: string; title: string; step: string }[] {
  return ACCEPTANCE_GATES
    .filter((g) => g.status !== "pass" && g.manualStep)
    .map((g) => ({ id: g.id, title: g.title, step: g.manualStep! }));
}
