# LifeOS V1 — Known Limitations

> Provisional draft pending Product Owner sign-off.

This is the **canonical** limitations list for the Version 1 release candidate
(`v1.0.0-rc1`). It is generated from `lib/release/limitations.ts`, so the app,
the `/release` surface, and this document never disagree. Every limitation has
an impact, a workaround, a blocker classification, and a follow-up owner.

**None of the limitations below block the release candidate.** They are the
honest edges of what Version 1 does — recorded so no claim exceeds the evidence.

| Area | Limitation | Impact | Workaround | Blocking | Owner |
|---|---|---|---|---|---|
| browsers | Support claimed only for current stable Chrome, Edge, Firefox, Safari, iOS Safari, Android Chrome. | Older or niche browsers are untested and unsupported. | Use a current mainstream browser. | no | release/browser-matrix |
| mobile | Some data-dense tables (insights, maintenance) scroll horizontally inside their own container on small screens. | Wide tables require sideways scroll on phones. | Rotate to landscape or use a wider viewport for heavy analysis. | no | ux |
| local-first | All data is local-first; a browser with cleared storage and no sync configured loses local-only data. | Data lives in the browser unless synced/exported. | Sign in to sync, or export regularly from Backup. | no | persistence |
| sync | Conflict resolution is last-write-wins per field with explicit conflict surfacing, not operational transform. | Simultaneous edits to the same field resolve to one value; the other is preserved as a surfaced conflict, not merged. | Resolve surfaced conflicts in the Recovery/Conflict center. | no | sync |
| privacy | Account deletion removes application rows immediately but provider backups may retain data briefly. | Erasure is not instantaneous at the infrastructure layer. | Disclosed in the deletion flow; retention window documented. | no | privacy |
| dependencies | Accepted dev-only/transitive advisories are tracked with mitigations. | No known runtime-exploitable advisory ships; accepted ones are dev-time only. | See the accepted-exceptions table in V1_KNOWN_LIMITATIONS. | no | security |
| security | CSP allows 'unsafe-inline' styles/scripts as a documented framework exception; 'unsafe-eval' is NOT allowed. | Inline styles/scripts are permitted; eval-based injection is blocked. | Tracked as a framework limitation; revisit on nonce support. | no | security |
| security | No end-to-end encryption; synced data is protected by RLS + transport security, not client-side E2E crypto. | The sync provider can technically access stored rows. | Use local-only mode for maximal privacy. | no | security |
| scope | No AI, LLM, agent, embedding, or recommendation features are active in V1. | All intelligence is deterministic and local. | By design. | no | product |
| scope | Single-user only; no collaboration or sharing. | One account per dataset. | By design. | no | product |
| scope | No calendar integration. | Planning horizons are intentions, not calendar events. | By design. | no | product |
| scope | No notifications or reminders. | No push/email nudges. | By design. | no | product |
| scope | No realtime presence. | No live co-editing indicators. | By design. | no | product |
| scope | No automatic planning; the user assigns horizons manually. | Planning is manual by design. | By design. | no | product |
| sync | Cross-device sync acceptance requires live Supabase credentials and two real devices; automated coverage is deterministic-model + local adapter tests. | Some cross-device scenarios are verified by model/logic tests, not a live two-device run. | Execute the credentialed cross-device matrix before GA; tracked in the acceptance report. | no | release/manual |
| accessibility | Documented accessibility exceptions (e.g. a few sub-44px inline affordances with larger hit areas) are listed with rationale. | A small number of controls rely on an enlarged hit area rather than a 44px visual box. | Listed in ACCESSIBILITY.md with target-size exceptions. | no | accessibility |
| performance | Very large accounts (tens of thousands of records) are beyond the measured fixture size. | Performance budgets are set for realistic, not extreme, datasets. | Documented budgets + follow-up item for large-account profiling. | no | performance |
| import | Document import is plain-text/Markdown first; rich formats (PDF binary layout, DOCX) are not first-class in V1. | Some source formats must be converted to text before import. | Paste text/Markdown; the reader parses headings/paragraphs deterministically. | no | reading |

## Explicit scope exclusions (by design)

Version 1 deliberately ships **no** AI, LLMs, agents, embeddings,
recommendations, automatic planning, calendar integration, notifications,
analytics, collaboration, realtime presence, gamification, or engagement
tracking. These are product decisions, not gaps to be fixed.

## Security posture caveats

- **No end-to-end encryption.** Synced data is protected by Postgres Row Level
  Security and transport security, not client-side E2E crypto. Use local-only
  mode for maximal privacy.
- **CSP inline exception.** The Content-Security-Policy permits `'unsafe-inline'`
  for styles/scripts as a documented framework limitation; it does **not** permit
  `'unsafe-eval'`. Tracked for revisit if nonce support becomes viable under the
  build toolchain.
- **Provider retention.** Account deletion removes application rows immediately,
  but the hosting/database provider's backups may retain data briefly. This is
  disclosed in the deletion flow; erasure is not instantaneous at the
  infrastructure layer.

## Incomplete-until-GA (credentialed) checks

The following require live Supabase credentials, a real production deployment,
or real devices/browsers and are **not** claimed as passing from CI:

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
