# LifeOS Version 1 — Release Notes (`v1.0.0-rc1`)

> Provisional draft pending Product Owner sign-off. Release date: _TBD_.

## What LifeOS is

LifeOS is a **single-user, local-first** operating system for lifelong
intellectual, personal, and spiritual formation. It turns books, notes,
conversations, and reflections into organized knowledge and practical action —
deterministically, on your own device, with optional cloud sync to your own
Supabase project. There is no AI, no tracking, and no telemetry in Version 1.

## Major systems

- **Capture & processing** — save a thought instantly; decide later what it is.
- **Workspaces & sessions** — working contexts and resumable sessions.
- **Goals, projects, milestones & next actions** — outcomes down to concrete steps.
- **Planning & focus** — assign horizons (intentions, not deadlines) and work quietly on one target.
- **Daily review** — a short, honest look back and a plan for tomorrow.
- **Reading, documents, citations, beliefs & research** — read closely, cite exactly, build claims with evidence.
- **Entity relationships & inspector** — context for any record without losing your place.
- **Knowledge maintenance** — careful stewardship (duplicates, orphans, stale records) surfaced as suggestions, never errors.
- **Deterministic insights** — descriptive views of your activity that never score or judge.
- **Sync, conflict recovery, backup & restore** — cross-device durability with explicit conflict handling.
- **Security, privacy, diagnostics & production hardening.**
- **Onboarding, help, accessibility, responsive design & a shared design language.**

## Privacy model

Local-first. Your data lives in your browser and, if you sign in, syncs to **your
own** Supabase project protected by Postgres Row Level Security — every one of the
54 tables is user-owned and RLS-enforced (verified live: another account cannot
read, update, or delete your rows). No AI, no content logging, no analytics, no
hidden telemetry.

## Local / remote behavior

Fully usable offline against local storage. When signed in, changes mirror to
Supabase with an honest sync indicator (Saved / Saving… / Saved locally / Sync
error). Save status never claims "Saved" before a remote write actually succeeds.

## Export & recovery

Export **everything** you own as a deterministic JSON archive (with a manifest
and per-collection checksums; no secrets). Verify it, and restore it with a
preview, duplicate detection, and a merge-or-replace choice — destructive
restores always ask first; nothing is silently overwritten. A Recovery Center
surfaces discarded, archived, and conflicting items.

## Security posture

Row Level Security on every user-owned table (audited so a table can't ship
without policies). A strong Content-Security-Policy ships on every response
(**no `unsafe-eval`**), alongside HSTS, Referrer-Policy, Permissions-Policy,
`X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`. Inputs are
size-limited and plain-text-first; external links are protocol-allowlisted;
errors and diagnostics are sanitized (no record contents, tokens, or stacks).
`/dev` test routes 404 in production. The service-role key is never present in
the client bundle. See `SECURITY_AND_PRIVACY.md` and `V1_KNOWN_LIMITATIONS.md`.

## Accessibility status

Keyboard-operable throughout, with visible focus rings, landmarks, headings,
live-region announcements, 44px touch targets, `prefers-reduced-motion` support,
and WCAG-AA color contrast. Documented exceptions are listed in `ACCESSIBILITY.md`.
A screen-reader naming pass on critical safety flows is a documented pre-GA
manual check.

## Supported browsers

Current stable **Chrome, Edge, Firefox, Safari, iOS Safari, and Android Chrome**.
Only headless Chromium is automated in CI; the real-browser matrix is a
documented pre-GA manual check. See `V1_BROWSER_SUPPORT.md`. We do not claim
support for untested browsers.

## Known limitations

See `V1_KNOWN_LIMITATIONS.md`. None block this release candidate.

## Migration requirements

The database schema is migrations **0001 → 0031**. Apply them in order; the
chain is idempotent (safe to re-run) and every user-owned table is
RLS-protected. No new migration ships in this release. See
`V1_DEPLOYMENT_RUNBOOK.md`.

## Version identifiers

- Release tag: `v1.0.0-rc1` · App version: `1.0.0-rc1`
- Migration version: `31` · Local state version: `1` · Export archive version: `1`
- Supported migration range: `20–31`

The Diagnostics page (`/security`) and the `/release` surface report the same
version.

## How to report issues

Open a GitHub issue on the LifeOS repository with the sanitized diagnostic report
(Diagnostics → Copy/Download) attached. The report contains **no** record
contents or secrets.

## Rollback guidance

Deployments are forward-only at the schema layer (additive migrations). The app
can be rolled back by redeploying the previous build; the schema stays forward-
compatible within the supported range. See `V1_ROLLBACK_REPORT.md` — do not
expect destructive database rollback.

## Maturity note

This is a **release candidate**, not a general-availability release. The
automatable gates pass; a set of credentialed manual checks (live auth, live
cross-device sync, live deletion, production headers, real-browser matrix,
production smoke) remain before GA and are listed in `V1_ACCEPTANCE_REPORT.md`.
