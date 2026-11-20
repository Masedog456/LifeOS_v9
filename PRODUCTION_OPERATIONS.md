# Production Operations (LIFEOS-040)

Operational runbook for running LifeOS with real accounts.

## Health checks

`lib/security/health.ts` separates a **public** liveness surface (app shell,
auth provider, static assets) from **authenticated** diagnostics (database,
schema, service worker). Health responses expose only a component name and a
coarse status — never secrets, table names, SQL, or user data. The user-visible,
sanitized Diagnostics Center is at `/security`.

## Environments & configuration

- Client env is `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  only (both public). The service-role key and any API keys live server-side and
  are never referenced in client code.
- Production and development must be distinct Supabase projects. Missing required
  config fails clearly (`getSupabaseClient` throws a human-readable error if
  exactly one of the two vars is set).
- `LIFEOS_ENABLE_DEV_ROUTES=1` exposes `/dev/*` self-test pages; **never set it
  in production.** Only CI/regression sets it.

## Security header / CSP policy

Set by `middleware.ts` from `lib/security/headers.ts` on every response. See
`SECURITY_AND_PRIVACY.md` §10 for the policy and the documented `unsafe-inline`
(scripts/styles) framework exception. No `unsafe-eval`.

## Automated audits (run each release)

```
npm run audit:security   # rls + secrets + routes + deps
npm run audit:rls        # every user-owned table has RLS + required policies
npm run audit:secrets    # no committed secrets / client-bundle key leaks
npm run audit:routes     # /dev is production-gated
npm run audit:deps       # no un-allowlisted high/critical prod advisories
```

## Dependency triage policy

- **Footprint:** 5 direct production deps (`@supabase/supabase-js`, `next`,
  `pdfjs-dist`, `react`, `react-dom`). Lockfile committed.
- **Cadence:** run `npm audit` each release; patch security fixes promptly;
  **do not** auto-upgrade major versions without review.
- **Emergency patches:** apply the smallest version bump that clears a
  high/critical advisory (LIFEOS-040 bumped `next` 16.2.10 → 16.2.12; PR 1
  bumped `next` and `eslint-config-next` 16.2.12 → 16.4.6 for critical
  remote-code-execution advisories, plus `npm audit fix` for transitive
  advisories — `npm audit` then reported 0).
- **Accepted exceptions:** none. `scripts/audit-deps.mjs` used to except
  `next`, `postcss` and `sharp` by package name, which would also have hidden
  any new advisory in those packages. If an exception is ever needed, record
  the specific advisory, affected range, reason and a review date.

## Migration safety / release checklist

- [ ] `tsc`, `lint`, production `build` clean.
- [ ] New self-tests + full regression green (do not weaken prior tests).
- [ ] Security + backup E2E green.
- [ ] `npm run audit:security` green.
- [ ] Migration chain `0001..NNNN` applies **idempotently 3×** on Postgres 16.
- [ ] Non-superuser RLS isolation holds for any new user-owned table.
- [ ] Tombstones, histories, and user ownership preserved across the chain.
- [ ] Never rewrite a historical migration; only add the next number.
- [ ] CSP/headers validated; `/dev` 404s in production without the flag.

## Manual production checks (credential-pending)

Signed in on two devices: (1) export on A, import-preview on B, confirm counts
reconcile; (2) offline edits on both, sign out on A mid-sync, confirm B surfaces
no data loss and the pending state is visible; (3) start account deletion on A,
confirm new mutations freeze and tombstones reach B on next sign-in; (4) force a
schema mismatch, confirm read-only mode blocks writes but allows export.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, `V1_DEPLOYMENT_RUNBOOK.md`, and `V1_ROLLBACK_REPORT.md`;
the `/release` surface shows live readiness. Migration rehearsal, RLS, two-user
isolation, export/restore, and security-header evidence are recorded in
`V1_ACCEPTANCE_REPORT.md`.
