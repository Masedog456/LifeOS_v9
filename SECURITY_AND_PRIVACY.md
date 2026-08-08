# Security & Privacy (LIFEOS-040)

LifeOS is now hardened for real accounts and long-lived personal data. Security
here is **observable and testable, not assumed** — every boundary has a
deterministic self-test, an adversarial check, or an audit script that fails
loudly. This document is the map; the companions are `THREAT_MODEL.md`,
`BACKUP_AND_RECOVERY.md`, `PRODUCTION_OPERATIONS.md`, and `INCIDENT_RESPONSE.md`.

> Security protects the user's life record. It must not become another way to
> observe the user. No AI, no keystroke logging, no content logging, no hidden
> telemetry.

---

## 1. Where the code lives

```
lib/security/
  threat-model.ts        structured threats (feeds THREAT_MODEL.md)
  auth-boundaries.ts     auth invariants: render/write gates, safe redirect
  authorization-audit.ts machine-readable RLS registry + SQL policy checker
  input-limits.ts        record size caps, JSON depth, UUID/timestamp, safe parse
  safe-url.ts            protocol allowlist, control-char stripping, rel attrs
  redaction.ts           allowlist-only diagnostic events + secret scrubbing
  errors.ts              SafeError shaping (reference id, category, no stacks)
  headers.ts             CSP + security headers (+ validator)
  schema-compatibility.ts client/server compat gate (fail-closed to read/export)
  storage-resilience.ts  localStorage probe/read/write/quarantine
  multi-tab.ts           BroadcastChannel signals + advisory op-locks
  health.ts              public vs authenticated health checks
  dev-routes.ts          /dev prefix classifier + manifest auditor
  diagnostics.ts         sanitized Diagnostics Center projection
  selftest.ts            94 assertions

lib/backup/   export, manifest, verify, import-preview, restore, recovery, versioning, selftest (38)
lib/privacy/  data-map, deletion (semantics + account), retention, permissions

components/security/  DiagnosticsCenter, SecurityErrorBoundary, (Schema/Storage/Sync notices)
components/backup/    ExportCenter, ImportPreview, RecoveryCenter
components/privacy/   PrivacyCenter, AccountDeletion

app routes:  /security (diagnostics) · /backup · /recovery · /privacy · /privacy/delete
scripts:     audit-rls.mjs · scan-secrets.mjs · audit-routes.mjs · audit-deps.mjs
middleware.ts  sets security headers + CSP on every response
supabase/migrations/0031_security_production_hardening.sql
```

No new state manager was introduced; every surface reads the existing store,
auth, sync, and prefs.

---

## 2. Authentication

Identity is Supabase email/OTP; anonymous accounts never sync. `auth-boundaries.ts`
expresses the invariants as pure, tested predicates:

- **No protected data before a session is confirmed** (`mayRenderProtected`).
- **Expired sessions fail closed** — no protected UI, no writes (`isExpired`).
- **Protected writes require** signed-in + not-expired + not-deletion-frozen +
  schema-OK (`mayWriteProtected`).
- **Redirect targets are validated** — only same-origin path redirects; absolute
  and protocol-relative URLs fall back (`safeRedirect`), closing open-redirects.
- **Neutral error language** never reveals whether an account exists.
- Sign-out clears protected UI, and tabs coordinate sign-out (`multi-tab.ts`).

No custom cryptography — Supabase owns tokens; this module owns the *rules*.

---

## 3. Authorization & RLS

Authorization is enforced by **Postgres Row Level Security**, never by
application filtering. `authorization-audit.ts` is a machine-readable registry of
every user-owned table (ownership column, required policies, deletion mode,
tombstone domain). `npm run audit:rls` walks all migrations, finds every
`CREATE TABLE` with a `user_id` column, and **fails** if any lacks RLS + the
required SELECT/INSERT/(UPDATE)/(DELETE) policies — so a newly added table cannot
ship without an RLS review. Verified: **55 user-owned tables across 32 migrations
pass**, plus non-superuser RLS isolation and adversarial ownership tests
(read/update/delete/reference another user's record all denied).

Append-only/immutable tables (e.g. `reflections`, `retrieval_feedback`, the
retention tables) intentionally omit UPDATE and/or DELETE; the audit documents
that intent rather than rewriting historical migrations.

**Reading upload originals (LIFEOS-047, migration 0032).** The binary a user
uploads gets a **private** storage bucket `reading-originals` (never public) and a
metadata table `reading_document_files`. Object access is isolated per user by an
`<uid>/…` path convention enforced with RLS on `storage.objects`, so User A can
never read, list, write, or delete User B's files; the metadata table stores only
checksum/size/content-type/state — **never the file's text** — and cascades from
the owning `auth.users` row. Parsed document text and AI study results are already
per-user RLS-scoped on the existing `reading_documents` rows. Uploaded files and
document text are **never** placed in `localStorage`.

---

## 4. Input safety

LifeOS **prefers plain text** — React escapes by default and there is a single
`dangerouslySetInnerHTML` sink (passage annotations). That sink now
(`lib/library/annotations.ts`): HTML-escapes the whole string **including quotes**
FIRST, then routes any link URL through `safeHref`, so only http(s)/mailto links
become anchors and a crafted `[x](https://a/" onmouseover="…)` cannot inject an
attribute (the quotes are percent-encoded inside the href value). `input-limits.ts`
rejects (never truncates) oversized fields, over-deep or cyclic JSON, invalid
UUIDs/timestamps, and control characters; `safeJsonParse` never throws.

## 5. Record limits (documented)

| Field | Limit | Field | Limit |
| --- | --- | --- | --- |
| title | 500 | note / description | 50,000 |
| capture text | 20,000 | completion evidence | 20,000 |
| document title | 1,000 | tags / aliases per record | 100 / 200 |
| relationships per record | 2,000 | history entries per record | 5,000 |
| prefs JSON | 256 KB | JSON depth | 40 |
| import batch | 200,000 | export soft-warn | 50 MB |

Validated client-side and re-checkable server-side (import path). Existing data
predating a limit is never rewritten. Limits protect reliability, not behavior.

## 6. URL & external-link safety

`safe-url.ts` is the single gate: an absolute URL with an allowed protocol
(`http`, `https`, `mailto`) becomes a link; `javascript:`, `data:`, `file:`,
`vbscript:`, `blob:`, `about:`, malformed, relative, or over-long (>2 KB) URLs
become plain text. Control characters are stripped before parsing (defeats
`java\tscript:`). External links open with `rel="noopener noreferrer nofollow"`
and `target="_blank"`. **SSRF boundary:** the server never fetches an
arbitrary user-entered URL; imports validate URLs and never auto-fetch them.

## 7. Logging & redaction

`redaction.ts` enforces an **allowlist** for diagnostic events — only event name,
timestamp, scoped/masked user id, record TYPE, operation, duration, result
category, sanitized error code, and app/schema/migration versions. Content
(captures, notes, beliefs, research, document text, completion evidence, export
contents, raw sync payloads) and secrets (tokens, passwords, private URLs) are
**never** logged. `redactMessage` scrubs JWTs, keys, bearer tokens, emails, and
query-string secrets; `buildDiagnosticEvent` physically drops non-allowlisted
fields. There is no telemetry — nothing is transmitted.

## 8. Errors & diagnostics

`errors.ts` turns any throw into a `SafeError` (concise message, quotable
reference id, coarse category, retryable flag) — never a stack, SQL, env var,
token, or payload; dev keeps a redacted detail for the console only.
`SecurityErrorBoundary` wraps every major surface with retry + safe navigation +
an export path. The **Diagnostics Center** (`/security`) shows a fully sanitized
snapshot (versions, sync, storage, connectivity, auth category) and lets the user
copy/download it. A self-test asserts the snapshot carries no token or unmasked
email.

## 9. Schema compatibility & sync safety

`schema-compatibility.ts` compares local state / expected / remote migration
versions and picks a mode: `ok` (read+write+sync), `read-only` (server ahead →
writes local, sync paused), `upgrade` (local older → upgrade before writing),
`blocked` (local newer/unknown → read+export only). **Destructive sync never
proceeds under unknown compatibility.** Sync itself keeps idempotent mutation
ids, bounded retry, tombstones that are never silently resurrected, and surfaces
conflicts rather than destroying them (see `SYNC_INTEGRITY.md`).

## 10. Content Security Policy & headers

`headers.ts` is the single source (validated by a self-test and applied by
`middleware.ts` on every response): `default-src 'self'`; `object-src 'none'`;
`base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`;
`connect-src 'self' https:` (+ the configured Supabase origin); plus HSTS,
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
(camera/mic/geo off), `X-Frame-Options: DENY`, and COOP. **No `unsafe-eval`
anywhere.**

**Documented exceptions** (Feature 26 permits documenting unavoidable ones):
`script-src` and `style-src` allow `'unsafe-inline'`. Next.js App Router +
Turbopack emit first-party inline bootstrap and RSC flight-data scripts and do
**not** stamp a CSP nonce on them under Turbopack, so a nonce policy blocks the
framework's own scripts. Those inline scripts are 100% first-party build output —
never user content — and the app has no user-controlled inline-script sink (§4).
We therefore allow inline scripts but never `unsafe-eval`. This is re-reviewed
each release; if Turbopack nonce support lands, we switch to a nonce policy.

## 11. Development-surface lockdown

`/dev/*` self-test routes are gated by `app/dev/layout.tsx`: in a production build
they return `notFound()` unless the deliberate `LIFEOS_ENABLE_DEV_ROUTES=1` flag
is set (only the test harness sets it). Verified: without the flag,
`/dev/security-tests` and `/dev/insights-tests` return **404** while `/today`
returns 200. `npm run audit:routes` asserts the guard exists.

## 12. Privacy Center & data map

`/privacy` discloses, in plain language, what LifeOS stores, where it lives
(local vs your private Supabase), export/deletion controls, the diagnostics
policy, external-link behavior, retention limits, and browser permissions
(camera/mic/geo/notifications explicitly NOT used). LifeOS does **not** implement
end-to-end encryption and never claims to.

**Reading: uploading vs. AI analysis are separate (LIFEOS-047).** Uploading,
parsing, duplicate detection, and the on-device **Study** aids all happen locally
in the browser. **Ask** and **Summarize** send only the *relevant passages of the
one open document* — chosen by deterministic retrieval within a fixed character
budget — to your configured AI provider; never the whole library, never other
documents, never the raw file. When no provider is configured, answers are
produced by an on-device deterministic draft, and the Study panel states which of
the two produced the result so the data-flow is never ambiguous.

## 13. Account deletion & retention

Deletion is staged and honest (`lib/privacy/deletion.ts`): explain scope → offer
export → require the exact phrase `DELETE MY ACCOUNT` → (re-auth where supported)
→ freeze new mutations → run → report. It never implies instant irreversible
erasure: records are deleted from the primary DB immediately (user-ownership
cascade), tombstones propagate to other devices, a minimal deletion-request audit
row is retained, and provider backups purge as they roll off (see
`retention.ts`). Deletion semantics for every entity are registered
(`DELETION_SEMANTICS`) so confirmation copy is truthful — Archive ≠ delete;
Discard exposes restoration; "Delete permanently" states irreversibility.

## 14. Secrets & configuration

Only `NEXT_PUBLIC_*` public values (Supabase URL + anon key) ever reach the
client; the service-role key and any API keys are never referenced in client
code (verified by `getSupabaseClient`). `npm run audit:secrets` scans tracked
source for committed secrets, private keys, JWTs, and `NEXT_PUBLIC_*` variables
holding a service-role key. Missing required config fails clearly.

## 15. Known limitations

- No app-level MFA (identity is only as strong as the user's email inbox).
- No device binding for session tokens.
- CSP allows first-party inline scripts (framework requirement, §10).
- Provider backups may briefly retain deleted data (disclosed, §13).
- Local-only unsynced data on other devices isn't counted until it syncs.
- Three transitive high advisories (`next`→postcss/sharp) are accepted,
  documented exceptions outside the runtime attack surface (see
  `PRODUCTION_OPERATIONS.md`).

## 16. Validation summary

`tsc` 0 · `lint` 0 · production build 0 · security self-tests **94/94** · backup
self-tests **38/38** · security E2E **34/34** · full regression (20+ suites) ·
migration chain **0001–0032** idempotent 3× with non-superuser RLS isolation ·
`audit:rls` (**55 tables**) / `audit:secrets` / `audit:routes` / `audit:deps` all
pass · CSP verified with **zero** console violations while the app hydrates.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, `V1_DEPLOYMENT_RUNBOOK.md`, and `V1_ROLLBACK_REPORT.md`;
the `/release` surface shows live readiness. Migration rehearsal, RLS, two-user
isolation, export/restore, and security-header evidence are recorded in
`V1_ACCEPTANCE_REPORT.md`.
