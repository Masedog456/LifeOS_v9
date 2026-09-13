# LifeOS V1 — Deployment Runbook

> Provisional draft pending Product Owner sign-off. Contains **no real secrets**.

This runbook deploys the Version 1 release candidate (`v1.0.0-rc1`) to Vercel
with an optional Supabase backend. It is written so another person can reproduce
the release.

## Required environment variables

Names only — never commit values. See `.env.example`.

| Variable | Scope | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | optional | Supabase project URL for cloud sync. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | optional | Supabase **anon** key (RLS-protected). Never the service role. |
| `NEXT_PUBLIC_APP_VERSION` | public | optional | Overrides the version shown in diagnostics/exports (defaults to `1.0.0-rc1`). |
| `NEXT_PUBLIC_BUILD_ID` | public | optional | Build identifier shown in diagnostics. |
| `LIFEOS_ENABLE_DEV_ROUTES` | server | optional | **Must be unset/absent in production** — exposes `/dev` test routes only when `=1` in non-production. |

The **service-role key is never used by the app** and must never be added to the
client environment. A secret scan (`npm run audit:secrets`) enforces this.

## Vercel configuration

- Framework preset: Next.js. Build command `npm run build`; output is the Next
  `.next` directory. Node 20+.
- Set the public env vars above in the Vercel project (Production scope). Do
  **not** set `LIFEOS_ENABLE_DEV_ROUTES` in production.
- Security headers are emitted by the app middleware (`middleware.ts` +
  `lib/security/headers.ts`) — no extra Vercel header config is required.

## Supabase configuration

- Create a Supabase project; note the URL and **anon** key (public).
- Apply **every canonical migration the production database has not yet applied,
  in repository order**, then verify parity (below).
- Row Level Security is defined by the migrations themselves; every user-owned
  table enables RLS with `auth.uid()`-scoped policies. Verify with
  `npm run audit:rls` and `npm run release:migrations`.

## Migrations — derive the chain, never retype it

This instruction went stale once: it named a range ending at `0031` while the
repository had already reached 47. A deployment run from it would have left production **sixteen migrations
behind the build**. So the rule is procedural, not numeric:

> Apply every canonical migration not yet present in production, in repository
> order, and verify that production reaches the repository's head before the
> frontend is deployed.

Derive the current chain rather than trusting this document:

```
ls supabase/migrations/*.sql | sort     # canonical order IS filename order
npm run audit:runbook                   # head, count, fix slot, and doc parity
```

*Current as of `9b2cb8f` (2026-09-11): **47** migrations, head
`0047_goal_horizons_lifecycle_history.sql`.* That is an audit **result**, not a
deployment constant — re-derive it on every release.

Ordering and safety properties, all verified by `npm run release:migrations`
(200/200 against Postgres 16 + pgvector as of `9b2cb8f`):

- strictly ascending by filename; dense `0001..N` with no gaps or duplicates
- `CREATE TABLE IF NOT EXISTS` throughout; policies use `DROP POLICY IF EXISTS`
  + `CREATE POLICY` — the chain is **idempotent** and safe to re-run in full
- no destructive DDL anywhere in the chain
- every user-owned table enables RLS with `auth.uid()`-scoped policies

Apply via the Supabase SQL editor or the Supabase CLI. Because the chain is
idempotent, re-running it in full is the safest way to reach parity when the
applied set is uncertain.

### The next migration number

Derive it; do not read a number out of prose. The next slot is **head + 1**, and
the single permitted unplanned addition is named by
`ALLOWED_RELEASE_FIX_MIGRATION` in `lib/release/migrations.ts`.
`npm run audit:runbook` fails if that constant is not head + 1, and
`npm run release:audit` rejects any migration beyond the head except that one.

## Pre-deploy checks

```
npm run lint && npx tsc --noEmit && npm run build
npm run audit:runbook           # migration head/slot parity + doc drift  ← gate
npm run audit:security          # rls + secrets + routes + auth + deps
npm run release:audit           # schema/version/inventory
npm run release:migrations      # Postgres rehearsal (local, needs pgvector)
npm run release:export          # export/restore verification
```

`audit:runbook` is a **hard gate**: it fails the release if the migration chain,
the build's declared head, the release-fix slot, or this document disagree. It
needs no database and no credentials, so it runs in CI on every PR.

The rehearsal requires the `vector` extension (migration `0010`). On Debian/
Ubuntu: `apt-get install -y postgresql-16-pgvector`. Supabase provides it
natively.

## Deploy steps — database first, frontend second

The order matters. The build ships a declared schema head; if the database is
behind it, writes are gated and sync is paused (see *Schema parity* below), so
the database must reach parity **before** the frontend that expects it.

1. **Back up / confirm recovery.** See `BACKUP_AND_RECOVERY.md`. Do this before
   any migration, not after.
2. **Inspect production migration state.** Establish which migrations are
   already applied. Because the chain is idempotent, re-running it in full is
   acceptable and is the safest option when the applied set is uncertain.
3. **Apply pending migrations** in repository order.
4. **Verify schema parity** (next section). Do not proceed on a failure.
5. **Configure the production environment** — public env vars in the Vercel
   project; `LIFEOS_ENABLE_DEV_ROUTES` must be **absent**.
6. **Merge the release PR to `main`** (do **not** tag yet) and trigger the Vercel
   production deployment from `main`. Wait for the build to succeed.
7. **Run acceptance**: post-deploy checks below, then the smoke, auth and
   **two-user isolation** matrices in `FOUNDER_TO_MARKET_READINESS.md` §10.

## Schema parity — what can and cannot be verified

**There is no migration ledger in this database, by design.**
`public.app_schema_contract()` (migration `0046`) reports *capabilities*, not a
version number — its own comment says "never the migration ledger". Do not add
one: a second copy of a client constant is the mistake that contract was written
to replace.

That makes parity verification capability-based:

```
-- against production, after applying migrations
select public.app_schema_contract();
```

Confirm the reported `contract` equals **`CLIENT_CONTRACT`** in
`lib/sync/contract.ts`, and that the capability keys the head migration publishes
are all present. Derive both rather than reading them here:

```
grep "export const CLIENT_CONTRACT" lib/sync/contract.ts
grep -nE "'contract',|'[a-z_]+', [0-9]+" $(ls supabase/migrations/*.sql | tail -1)
```

*Current as of `9b2cb8f` (2026-09-12): `contract: 3`, capabilities
`guarded_notes` 2, `guarded_next_actions` 2, `goal_horizons` 1.* Written in the
guarded form deliberately: `npm run audit:runbook` reads that number and fails
the build if it stops matching `CLIENT_CONTRACT`, so this snapshot cannot go
stale silently the way the instruction above it did.

The values are literals written *inside* each migration, so the database cannot
claim a capability it did not apply. That is exactly why the number matters: a
database stopped one migration short of the head reports the PREVIOUS
generation and omits that migration's capability.
`scripts/migration-rehearsal.mjs` §5 proves this on real Postgres — it applies
the chain to the second-to-last migration, records what the database advertises,
then applies the head and watches the generation rise in the same step the
columns arrive.

> **This instruction was itself wrong once.** It named the previous generation —
> the signature of a database one migration BEHIND the head — which would have
> certified an under-migrated production as correct. Confirm against
> `CLIENT_CONTRACT`, never against a number copied into prose.
> `npm run audit:runbook` now fails if this document names one at all.

> **Trap — read this.** `/security` (Diagnostics) displays a migration version,
> but that number is `EXPECTED_MIGRATION_VERSION` from the **build**, not from
> the database. It tells you what this app expects, never what production has.
> It is not parity evidence.

> **Known gap (Stage-1 bring-up, 2026-09-11).** `evaluateCompatibility()` has a
> "server behind this build → read-only, sync paused" branch, but
> `remoteMigrationVersion` is only ever supplied in self-tests — nothing in
> production populates it. The runtime backstop therefore **cannot fire today**.
> Until that is wired, the capability query above is the only real parity check,
> and skipping it is skipping the whole safeguard.

## Post-deploy checks

1. `curl -sD - <URL>/today -o /dev/null` — confirm CSP (no `unsafe-eval`), HSTS,
   Referrer-Policy, Permissions-Policy, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`.
2. Confirm `<URL>/dev/cohesion-tests` returns **404** (dev routes excluded).
3. Open `/security` (Diagnostics) — confirm the app version and build. Note that
   the migration version shown is the **build's** expectation, not the
   database's; parity is proven by the capability query above.
4. Run the 22-step production smoke test (`SmokeTestGuide` / Feature 31) with a
   disposable account.
5. Verify the auth callback works and HTTPS is enforced.

## Health checks

- Public: the app shell and `/today` render.
- Authenticated: Diagnostics reports versions, sync state, pending mutations,
  conflicts — all sanitized.

## Rollback — frontend and database are not the same operation

See `V1_ROLLBACK_REPORT.md`.

**Frontend rollback is routine.** In Vercel, **Promote** the previous
deployment. A rolled-back build must still run against the *upgraded* schema,
and it does: the chain is additive, and clients are supported from
`MIN_SUPPORTED_MIGRATION_VERSION` (currently **20**, read from
`lib/release/versions.ts`) up to the head. Rolling the frontend back does not
roll the database back, and must not be expected to.

**Database rollback is not routine and is not automated.**

- Applied migrations are **not** casually reversed. The chain contains no
  destructive DDL precisely so that forward-only is viable.
- A data-destructive migration would need its own reviewed, rehearsed reversal
  plan written *before* it is applied. None exists in the current chain.
- Recovery from a bad schema state is **restore from backup**, not a down
  migration — which is why step 1 of the deploy order is the backup.
- Rehearse recovery against disposable data, never against production.

## Cache invalidation

Vercel invalidates the CDN on each deployment. Static assets are content-hashed;
no manual purge is required for a standard deploy.

## Incident escalation

See `INCIDENT_RESPONSE.md`. Collect the sanitized diagnostic report; it contains
no record contents or secrets.

## Tag / release creation

Only after **all** gates pass (including the credentialed manual checks in
`V1_ACCEPTANCE_REPORT.md`):

```
git tag -a v1.0.0-rc1 -m "LifeOS Version 1 Release Candidate"
git push origin v1.0.0-rc1
```

Then create a GitHub **prerelease** from the tag, attach `V1_RELEASE_NOTES.md`,
and record the commit SHA and the migration head derived by `npm run audit:runbook`. If the environment
cannot push tags, create the tag via the GitHub UI (Releases → Draft a new
release → choose `v1.0.0-rc1` → mark as prerelease) and verify the tag appears on
the remote.
