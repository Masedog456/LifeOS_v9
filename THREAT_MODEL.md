# Threat Model (LIFEOS-040)

This is an honest enumeration of the threats LifeOS reasons about. It is
generated from and kept in sync with `lib/security/threat-model.ts` (a self-test
asserts every threat has a protection, a validation method, an owner, and a
stated *remaining* risk). **There are no fictional guarantees here.**

For each threat: the affected surface, likely impact, current protection, the
risk that remains, how it is validated, and the module/doc that owns the
mitigation.

| ID | Threat | Surface | Impact | Likelihood | Current protection | Remaining risk | Validation | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | Unauthorized account access | auth | critical | medium | Supabase email/OTP auth; no anonymous remote sync; RLS ties every row to auth.uid(). | Account is only as safe as the user's email inbox; no app-level MFA yet. | auth E2E (expired/revoked session), RLS isolation tests. | `lib/security/auth-boundaries.ts` |
| T02 | Cross-user data exposure | database | critical | medium | Row Level Security on every user-owned table (4 policies), enforced by Postgres not the app. | A missing policy on a future table; mitigated by the RLS audit that fails CI. | authorization-audit + non-superuser RLS isolation + ownership-boundary tests. | `lib/security/authorization-audit.ts` |
| T03 | Compromised session token | auth | high | low | Supabase-managed tokens, autoRefresh; sign-out clears protected UI; tabs coordinate sign-out. | A stolen refresh token is valid until expiry/rotation; no device binding. | sign-out clears UI E2E, cross-tab sign-out E2E. | `lib/authStore.ts` |
| T04 | Malicious record input | editors | medium | high | React escapes by default; the single HTML sink is escape-first + URL-allowlisted; input limits reject oversized/deep data. | New rich-text surfaces could reintroduce a sink; mitigated by the plain-text-first policy. | input-limits + safe-url self-tests, stored-XSS E2E. | `lib/security/input-limits.ts` |
| T05 | Stored / reflected XSS | reader annotations | high | medium | renderMarkdownInline escapes &<>"' first, then whitelists only http(s) links via safeHref. | Any future dangerouslySetInnerHTML must route through the same policy. | annotation render self-test with attribute-injection payload; stored-XSS E2E. | `lib/library/annotations.ts` |
| T06 | Unsafe URL handling | citations/documents/links | high | medium | Centralized safe-url: protocol allowlist (http/https/mailto), control-char stripping, rel=noopener. | Users can still click a valid https link to a hostile site (expected). | safe-url self-tests (javascript:/data:/file: rejected), unsafe-URL E2E. | `lib/security/safe-url.ts` |
| T07 | Injection (SQL/command) | database | high | low | No raw SQL from client; Supabase parameterized queries; no server-side shell. | RPCs must stay parameterized. | code review; no string-built SQL in adapter. | `lib/adapters/supabaseAdapter.ts` |
| T08 | Insecure exports | export/backup | medium | medium | Exports contain no tokens/secrets; JSON is data-only; import never trusts archive HTML/URLs. | An export file is as sensitive as the data; user must store it safely. | export manifest self-test asserts no secret fields; verify + import-preview tests. | `lib/backup/export.ts` |
| T09 | Accidental deletion | records | medium | high | Deletion-semantics registry drives honest confirmation copy; discard/archive are reversible; Recovery Center. | Permanent deletes are irreversible by design (clearly labeled). | deletion-semantics self-test; recovery-candidate tests. | `lib/privacy/deletion.ts` |
| T10 | Destructive synchronization | sync | high | medium | Three-way merge, tombstones, conflict surfacing; schema-compat gate blocks writes when incompatible. | A truly novel conflict shape could need manual reconciliation (surfaced, never auto-destroyed). | sync self-tests, schema-compat self-test, sync-conflict E2E. | `lib/security/schema-compatibility.ts` |
| T11 | Stale offline client | sync | high | medium | Schema-compat read-only mode when the server is ahead; idempotent mutation ids; bounded retry. | Very old clients must update before writing (by design). | schema mismatch read-only E2E. | `lib/security/schema-compatibility.ts` |
| T12 | Sensitive logging | diagnostics | high | medium | Allowlist-only diagnostic events; redaction of tokens/emails/hex; no content ever logged. | A careless console.log could bypass the policy; mitigated by the redaction helpers + review. | redaction self-tests; diagnostic-event cleanliness test. | `lib/security/redaction.ts` |
| T13 | Leaked secrets | build/config | critical | low | Only NEXT_PUBLIC_* anon values in client; service role/API keys never referenced client-side; secret-scan rules. | A committed .env could leak; mitigated by .gitignore + secret scan. | secret-scan script; bundle inspection. | `scripts/scan-secrets.mjs` |
| T14 | Compromised dependencies | supply chain | high | medium | Minimal dependency footprint (4 prod deps); npm audit; lockfile; no unexpected lifecycle scripts. | A transitive advisory can appear at any time; triage policy documented. | npm audit script; dependency-audit doc. | `PRODUCTION_OPERATIONS.md` |
| T15 | DoS via oversized records | editors/import | medium | medium | Per-field size caps, JSON depth cap, import batch cap, URL length cap. | A user can still create many small records (expected usage). | input-limits self-tests (size, depth, batch). | `lib/security/input-limits.ts` |
| T16 | Privilege escalation | auth/database | critical | low | No roles beyond the row owner; service role never in client; RLS uses auth.uid() only. | Server-side functions must run with least privilege. | RLS isolation with a non-superuser role. | `lib/security/authorization-audit.ts` |
| T17 | Insecure development routes | routing | medium | medium | /dev/* excluded/gated in production; route-manifest audit fails when a dev route ships. | A new dev route must follow the /dev prefix convention. | dev-route audit self-test + production route-manifest script. | `lib/security/dev-routes.ts` |

## Review cadence

The model is re-reviewed every release (see `PRODUCTION_OPERATIONS.md`). New
user-owned tables must appear in `lib/security/authorization-audit.ts` (enforced
by `npm run audit:rls`), and any new `dangerouslySetInnerHTML` sink must route
through the escape-first + URL-allowlist policy in `lib/library/annotations.ts`.

**Insights and security describe and protect recorded activity. They do not
observe the person living it** — no keystroke logging, no content logging, no
hidden telemetry.
