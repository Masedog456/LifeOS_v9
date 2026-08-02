# Incident Response (LIFEOS-040)

A lightweight, honest incident runbook. It does not simulate guarantees the
hosting platform does not provide.

## Severity

- **SEV1** — cross-user data exposure, auth bypass, or data loss.
- **SEV2** — a subsystem down (sync, export) with a workaround.
- **SEV3** — degraded, non-data-threatening (slow, cosmetic).

## Checklist

1. **Contain** — if cross-user exposure is suspected, disable the affected write
   path and, if needed, put clients into read-only mode (schema-compat gate).
2. **Preserve evidence** — capture sanitized diagnostics (`/security` → download
   report) and sanitized error events. Never collect record contents or tokens.
3. **Assess scope** — which users, which tables, which time window.
4. **Communicate** — use the template below; state facts, not guesses.
5. **Remediate** — smallest safe fix; add a regression test that fails without it.
6. **Recover** — export-first: help affected users export before any corrective
   restore. Prefer additive fixes over destructive ones.
7. **Review** — post-incident review (below).

## Rollback

- **App:** redeploy the previous build.
- **Migrations:** LifeOS never rewrites historical migrations; a bad migration is
  fixed by a NEW forward migration. If a migration must be undone, write a
  compensating migration — do not edit history. Restore from a provider
  point-in-time backup only as a last resort, export-first.

## Key rotation

- Rotate the Supabase anon/service keys in the provider dashboard; update env in
  the deployment; redeploy. The anon key is public by design (RLS is the
  protection), so rotation is precautionary, not a fix for RLS gaps.

## User communication template

> We identified [issue] affecting [scope] between [start] and [end] (UTC). Your
> data was [impact, factual]. We have [action taken]. You can export your data
> anytime at /backup. We will follow up by [date]. No passwords are stored by
> LifeOS; [if relevant: please sign in again].

## Post-incident review template

- Timeline (detection → containment → resolution).
- Root cause (technical + process).
- What limited/worsened the blast radius.
- Regression test(s) added.
- Follow-up actions with owners and dates.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, `V1_DEPLOYMENT_RUNBOOK.md`, and `V1_ROLLBACK_REPORT.md`;
the `/release` surface shows live readiness. Migration rehearsal, RLS, two-user
isolation, export/restore, and security-header evidence are recorded in
`V1_ACCEPTANCE_REPORT.md`.
