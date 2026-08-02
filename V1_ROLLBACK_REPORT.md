# LifeOS V1 — Rollback Rehearsal Report

> Provisional draft pending Product Owner sign-off. Release candidate `v1.0.0-rc1`.

## Summary

LifeOS deployments are **forward-only at the schema layer**. Every migration is
additive and idempotent, and the app is written to be forward-compatible within
the supported migration range (`20–31`). Rollback therefore means **redeploying
the previous application build**, not reverting the database.

## What was rehearsed (deterministic / analysis)

| Scenario | Result |
|---|---|
| Additive-only schema (no destructive DDL in 0001→0031) | **Confirmed** — every table uses `CREATE TABLE IF NOT EXISTS`; policies use `DROP POLICY IF EXISTS` + `CREATE POLICY`; no `DROP TABLE`/`DROP COLUMN` in the chain. |
| Older app against newer additive schema | **Compatible by design** — the app reads/writes only the columns it knows; additive columns are ignored. Supported range `20–31` is declared in `lib/release/versions.ts`. |
| Idempotent re-apply | **PASS ×3** — `scripts/migration-rehearsal.mjs` applies the full chain three times on one database with a stable 54-table result. |
| Export before rollback | **Available** — `npm run release:export` verifies a complete, checksummed archive can be produced at any time. |
| Restore after rollback | **PASS** — restore into a clean account materializes all records; merge/dry-run into a populated account never silently overwrites. |
| Schema-forward compatibility | **Confirmed** — schema-compatibility gate (`lib/security/schema-compatibility.ts`) pauses **writes** (not reads/export) on a mismatch, so nothing is corrupted. |

## What requires a live environment (manual, pre-GA)

| Step | Procedure |
|---|---|
| Redeploy previous Vercel build | In Vercel → Deployments → select the prior production deployment → **Promote to Production**. |
| Sync freeze during rollback | Confirm the schema-compatibility banner appears if the app/schema versions diverge, and that reads + export remain available. |
| Re-forward deployment | Re-promote the newer build; confirm writes resume and diagnostics report the expected versions. |

## Database rollback limitation (explicit)

**Do not attempt a destructive database rollback.** Migrations are forward-only;
there are no down-migrations. If a schema change ever needed reverting, it would
be done with a new additive migration, not by dropping objects. This is stated
so no operator assumes a `DROP`-based rollback path exists.

## Verdict

Application rollback is safe and rehearsed by analysis + local tests. The live
Vercel promote/re-promote legs are documented and must be exercised on the
deployed RC before GA (tracked in `V1_ACCEPTANCE_REPORT.md`).
