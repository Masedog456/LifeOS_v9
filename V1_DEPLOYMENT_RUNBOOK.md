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
- Apply migrations `supabase/migrations/0001 … 0031` **in order** via the
  Supabase SQL editor or CLI. The chain is idempotent (safe to re-run).
- Row Level Security is defined by the migrations themselves; every user-owned
  table enables RLS with `auth.uid()`-scoped policies. Verify with the queries in
  `V1_ACCEPTANCE_REPORT.md` / `scripts/migration-rehearsal.mjs`.

## Migration order

Strictly ascending by filename: `0001_…` first, `0031_…` last. No `0032` ships in
this release. A demonstrated release-blocking DB fix would add exactly
`0032_v1_release_fix.sql` (additive, idempotent, RLS-protected).

## Pre-deploy checks

```
npm run lint && npx tsc --noEmit && npm run build
npm run audit:security          # rls + secrets + routes + deps
npm run release:audit           # schema/version/inventory
npm run release:migrations      # Postgres rehearsal (local)
npm run release:export          # export/restore verification
```

## Deploy steps

1. Merge the release PR to `main` (do **not** tag yet).
2. Trigger the Vercel production deployment from `main`.
3. Wait for the build to succeed.

## Post-deploy checks

1. `curl -sD - <URL>/today -o /dev/null` — confirm CSP (no `unsafe-eval`), HSTS,
   Referrer-Policy, Permissions-Policy, `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`.
2. Confirm `<URL>/dev/cohesion-tests` returns **404** (dev routes excluded).
3. Open `/security` (Diagnostics) — confirm app version `1.0.0-rc1`, migration
   version `31`.
4. Run the 22-step production smoke test (`SmokeTestGuide` / Feature 31) with a
   disposable account.
5. Verify the auth callback works and HTTPS is enforced.

## Health checks

- Public: the app shell and `/today` render.
- Authenticated: Diagnostics reports versions, sync state, pending mutations,
  conflicts — all sanitized.

## Rollback steps

See `V1_ROLLBACK_REPORT.md`. In short: in Vercel, **Promote** the previous
deployment. The additive schema stays forward-compatible within the supported
migration range (`20–31`), so the previous app build runs against the current
schema. Do **not** attempt destructive database rollback.

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
and record the commit SHA and migration version (`31`). If the environment
cannot push tags, create the tag via the GitHub UI (Releases → Draft a new
release → choose `v1.0.0-rc1` → mark as prerelease) and verify the tag appears on
the remote.
