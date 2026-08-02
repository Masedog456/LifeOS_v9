# LifeOS V1 — Release Checklist & Freeze Policy

> Provisional draft pending Product Owner sign-off.

## Release freeze policy (LIFEOS-042, Feature 1)

LifeOS is **feature-frozen** for the Version 1 release. On the release-candidate
branch:

**Not allowed:** new features · new domain models · new migrations (except a
demonstrated release-blocking fix) · major dependency upgrades · visual
redesign · speculative refactors · cleanup-only rewrites · test weakening.

**Allowed:** bug fixes · security fixes · accessibility fixes · data-loss fixes ·
migration fixes · production-deployment fixes · release documentation · launch
packaging.

### Release-blocker definition

A finding is a **release blocker** if it is any of: data loss · cross-user data
exposure · broken authentication · a failed migration · an inaccessible critical
safety flow · a production crash on a core route · unrecoverable sync corruption ·
secret exposure · account-deletion failure. **No blocker may remain open at
release tagging.**

## Executable checklist

Rendered from `lib/release/checklist.ts` (`npm run release:checklist`). Legend:
`done` = automated/complete · `manual-required` = credentialed check documented
and pending · `pending` = held until gates pass. Every item carries an owner,
evidence, blocker classification, and date — no "probably done".

### repository

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Feature freeze declared; only release-allowed changes on the RC branch | release | V1_RELEASE_CHECKLIST + RELEASE_POLICY (this PR) | done | non-blocker | 2026-08-01 |

### migrations

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Chain 0001→0031 applies clean; idempotent x3; checkpoints upgrade | persistence | scripts/migration-rehearsal.mjs | done | blocker | 2026-08-01 |
| No new migration beyond an allowed 0032 release fix | persistence | lib/release/migrations isAllowedReleaseFixMigration + audit | done | blocker | 2026-08-01 |

### database

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Expected table/migration counts; no duplicate numbers; schema version | persistence | scripts/release-audit.mjs | done | blocker | 2026-08-01 |

### rls

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Every user-owned table has RLS + required policies | security | npm run audit:rls (54 tables PASS) | done | blocker | 2026-08-01 |

### authentication

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Sign-up/in/out/refresh/expiry/reset/multi-tab matrix | release/manual | auth-boundaries logic tests + manual step documented | manual-required | blocker | 2026-08-01 |

### synchronization

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| 15-scenario cross-device matrix | release/manual | lib/sync selftest + sync.mjs (local) + manual credentialed step | manual-required | non-blocker | 2026-08-01 |

### export/restore

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Export verifies; restore clean/merge/dry-run; no silent overwrite | persistence | scripts/export-verify.mjs + restore selftest | done | blocker | 2026-08-01 |

### deletion

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Deletion workflow: export offered, confirm, freeze, retention honest | release/manual | lib/privacy deletion logic + manual live-account step | manual-required | blocker | 2026-08-01 |

### security

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Secret scan, dep audit, RLS, routes, CSP, XSS/URL/depth/redaction | security | npm run audit:security + security selftest | done | blocker | 2026-08-01 |

### privacy

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Privacy Center accurate; provider retention disclosed | privacy | app/privacy + SECURITY_AND_PRIVACY.md | done | non-blocker | 2026-08-01 |

### accessibility

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Keyboard/focus/landmarks/contrast + documented exceptions | accessibility | accessibility selftest + cohesion E2E + manual SR step | manual-required | non-blocker | 2026-08-01 |

### responsiveness

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| No horizontal overflow on critical routes 320–1440px | ux | cohesion.mjs + scripts/visual-regression.mjs | done | blocker | 2026-08-01 |

### browsers

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Chrome/Edge/Firefox/Safari/iOS/Android smoke matrix | release/manual | headless Chromium (local) + manual matrix documented | manual-required | non-blocker | 2026-08-01 |

### performance

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Fixture-sized render budgets; p95 on target devices | performance | V1_PERFORMANCE_REPORT + lib/perf budgets | manual-required | non-blocker | 2026-08-01 |

### documentation

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| 8 V1_* docs created; 23 docs updated; links check | docs | this PR + terminology/link validators | done | non-blocker | 2026-08-01 |

### demo/fixture

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Deterministic release fixture + optional demo workspace; removable | release | lib/release/fixtures + release-tests E2E | done | non-blocker | 2026-08-01 |

### deployment

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Deployment runbook precise; env vars documented; no secrets | ops | V1_DEPLOYMENT_RUNBOOK.md | done | non-blocker | 2026-08-01 |

### smoke-testing

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| 22-step production smoke flow on deployed RC | release/manual | SmokeTestGuide + manual step on preview | manual-required | blocker | 2026-08-01 |

### rollback

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| Rollback rehearsal documented; forward-only limits stated | ops | V1_ROLLBACK_REPORT.md + manual redeploy step | manual-required | non-blocker | 2026-08-01 |

### tagging

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| v1.0.0-rc1 tag PREPARED, not created until gates pass | release | lib/release/versions + Feature 34 procedure | pending | blocker | 2026-08-01 |

### release-publication

| Item | Owner | Evidence | Status | Blocker | Date |
|---|---|---|---|---|---|
| GitHub prerelease with notes + SHA + migration version | release | V1_RELEASE_NOTES.md + tag procedure | pending | non-blocker | 2026-08-01 |

## Gate state

- **Deterministic gates:** PASS (release-audit 17/17, release self-tests 48/48,
  migration rehearsal 35/35, export/restore 14/14, full regression 1065/1065).
- **Open blockers:** the `tagging` item is intentionally `pending` — the tag is
  prepared but **not created** until the manual credentialed gates pass.
- **Manual credentialed checks still required:** 12 (see V1_ACCEPTANCE_REPORT.md).

The tag `v1.0.0-rc1` is prepared and must not be created until every gate
(including the manual credentialed ones) passes.
