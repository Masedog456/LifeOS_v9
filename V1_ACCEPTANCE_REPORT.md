# LifeOS V1 — Acceptance Report

> Provisional draft pending Product Owner sign-off. Release candidate `v1.0.0-rc1`.

This report records the acceptance evidence for the Version 1 release candidate.
It is deliberately **honest about method**: a gate is only marked an automated
pass when a deterministic test/audit in this repository proves it. Gates that
require live Supabase credentials, a real production deployment, or real
devices/browsers are marked **manual-required** with the exact procedure — they
are never presented as automated passes (`lib/release/acceptance.ts` enforces
this invariant, asserted by the release self-test).

## Environment

- Commit base: `35a2e27` (origin/main after LIFEOS-041 merge).
- Automated evidence: Node + local Postgres 16 + headless Chromium (Playwright).
- Reproduce with: `npm run release:audit`, `npm run release:migrations`,
  `npm run release:export`, `npm run release:checklist`, `npm run audit:security`,
  and (against a running build) `npm run release:routes|visual|browsers`.

## Automated results (this environment)

| Suite | Result |
|---|---|
| Release audit (schema/version/inventory) | **PASS 17/17** |
| Migration rehearsal (Postgres 0001→0031) | **PASS 35/35** |
| Export / restore verification | **PASS 14/14** |
| Release self-tests | **48/48** |
| Full regression (20 suites) | **1065/1065** |
| Cohesion E2E | **26/26** |
| Release E2E | **14/14** |
| Route smoke (dev build) | **21/21** |
| Visual regression (27 surfaces) | **27/27 clean, no overflow** |
| Browser matrix (Chromium 141) | **5/5 flows** |
| Security (rls+secrets+routes+deps) | **PASS** |
| typecheck / lint / build | **clean** |

Two-user isolation is proven **live** in the migration rehearsal: as a
non-superuser role, user B cannot SELECT, UPDATE, or DELETE user A's rows, every
policy scopes to `auth.uid()`, and A sees exactly its own row.

## Acceptance matrix

| Gate | Feature | Method | Status | Evidence / Manual step |
|---|---|---|---|---|
| Route audit | 3 | hybrid | partial | lib/release/routes.ts validateRoutes() + scripts/route-smoke.mjs (local build) — **manual:** Run route-smoke against the deployed preview URL. |
| Migration rehearsal (0001→0031, idempotency, checkpoints) | 4 | automated | pass | scripts/migration-rehearsal.mjs against local Postgres 16 |
| Production schema audit | 5 | automated | pass | scripts/release-audit.mjs + scripts/audit-rls.mjs |
| Two-user isolation matrix | 6 | hybrid | partial | scripts/migration-rehearsal.mjs RLS cross-user probes on local Postgres — **manual:** Repeat on the production Supabase project with two real accounts. |
| Authentication acceptance | 7 | credentialed | manual-required | lib/security/auth-boundaries + multi-tab logic tests (local) — **manual:** Run sign-up/in/out/refresh/expiry/reset matrix against live Supabase auth. |
| Cross-device sync acceptance (15 scenarios) | 8 | hybrid | partial | lib/sync selftest + sync.mjs E2E (local adapter, deterministic conflict/merge/tombstone logic) — **manual:** Execute the 15-scenario matrix across two real devices on live Supabase. |
| Data-preservation acceptance | 9 | hybrid | partial | upgrade-state/backup migration tests + persistence selftest + DST/timezone insight tests — **manual:** Second-device and failed-remote-sync legs require live sync. |
| Export acceptance | 10 | automated | pass | scripts/export-verify.mjs over the release fixture (manifest+checksums+counts+no-secrets) |
| Restore acceptance (clean/merge/dry-run) | 11 | automated | pass | lib/backup restore + import-preview selftest + export-verify dry-run |
| Account deletion acceptance | 12 | credentialed | manual-required | lib/privacy deletion staging logic + retention disclosure (local) — **manual:** Run the full deletion workflow with a disposable live account. |
| Security acceptance | 13 | automated | pass | npm run audit:security (rls+routes+secrets+deps) + security selftest (XSS/URL/depth/redaction) |
| Production header validation | 14 | credentialed | manual-required | lib/security/headers + middleware (local) — **manual:** curl the deployed URL and assert CSP/HSTS/Referrer/Permissions/XCTO + HTTPS redirect. |
| Accessibility acceptance | 15 | hybrid | partial | lib/accessibility audit selftest + cohesion E2E (keyboard/focus/no-overflow) — **manual:** Screen-reader naming pass (VoiceOver/NVDA) on critical safety flows. |
| Responsive acceptance (320–1440px) | 16 | automated | pass | scripts/visual-regression.mjs + cohesion.mjs no-overflow checks at breakpoints |
| Browser matrix | 17 | credentialed | manual-required | headless Chromium smoke only (local) — **manual:** Run smoke flows on real Chrome/Edge/Firefox/Safari/iOS/Android; record versions. |
| Performance acceptance | 18 | hybrid | partial | lib/perf budgets + fixture-sized render measurements (headless) — **manual:** Confirm p95 on target device classes/real browsers. |
| Error & recovery drill | 19 | automated | pass | lib/security storage-resilience + lib/sync recovery selftest + error boundary tests |
| Observability acceptance | 20 | automated | pass | lib/security/diagnostics + health selftest (sanitized, no record contents) |
| Onboarding acceptance | 21 | automated | pass | cohesion.mjs onboarding E2E (blank/skip/resume/reset/sample/keyboard/mobile) |
| Help & documentation acceptance | 22 | automated | pass | lib/release/routes help coverage + terminology validator + docs link check |
| Visual regression acceptance | 23 | automated | pass | scripts/visual-regression.mjs deterministic screenshots (explicit approval) |
| Rollback rehearsal | 30 | credentialed | manual-required | V1_ROLLBACK_REPORT documented procedure + forward-only migration analysis — **manual:** Redeploy previous Vercel build; run older app against additive schema. |
| Production smoke test | 31 | credentialed | manual-required | SmokeTestGuide checklist (local) — **manual:** Execute the 22-step smoke flow on the deployed RC with a disposable account. |

## Manual, credentialed checks still required before GA

- **Route audit** — Run route-smoke against the deployed preview URL.
- **Two-user isolation matrix** — Repeat on the production Supabase project with two real accounts.
- **Authentication acceptance** — Run sign-up/in/out/refresh/expiry/reset matrix against live Supabase auth.
- **Cross-device sync acceptance (15 scenarios)** — Execute the 15-scenario matrix across two real devices on live Supabase.
- **Data-preservation acceptance** — Second-device and failed-remote-sync legs require live sync.
- **Account deletion acceptance** — Run the full deletion workflow with a disposable live account.
- **Production header validation** — curl the deployed URL and assert CSP/HSTS/Referrer/Permissions/XCTO + HTTPS redirect.
- **Accessibility acceptance** — Screen-reader naming pass (VoiceOver/NVDA) on critical safety flows.
- **Browser matrix** — Run smoke flows on real Chrome/Edge/Firefox/Safari/iOS/Android; record versions.
- **Performance acceptance** — Confirm p95 on target device classes/real browsers.
- **Rollback rehearsal** — Redeploy previous Vercel build; run older app against additive schema.
- **Production smoke test** — Execute the 22-step smoke flow on the deployed RC with a disposable account.

No release blocker is open. The RC is ready for the credentialed acceptance pass; the tag is prepared but not yet created.
