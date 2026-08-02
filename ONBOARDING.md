# Onboarding (LIFEOS-041, Feature 9/37)

A calm first-run experience that teaches LifeOS through USE, at `/onboarding`
(`components/onboarding/OnboardingShell.tsx`, driven by `lib/onboarding/*`).

## The progression (`steps.ts`)

Welcome → Capture one thing → Decide what it is → Create or pick a project →
Choose one next action → See Today → A brief focus session → Where review lives →
Your data & privacy → You're set up. Each step teaches ONE reusable interaction
and links to the real surface (Capture → `/`, Project → `/projects`, …) — there
is no separate demo sandbox and no forced demo data.

## Guarantees

- **Skippable** ("Skip for now" → Today) and **resumable** (progress persists and
  restores on return). **Restart onboarding** re-runs it; any step is reachable.
- No fake urgency, no celebration confetti, no gamified progress — the bar reads
  "Step 3 of 10 · 2 done", descriptive only.
- No account-data assumptions; nothing is invented for the user.

## Persistence & sync (`state.ts`, `merge-rules.ts`)

Onboarding state (version, completed/skipped steps, resetCounter, sample id)
lives in `prefs.onboardingV2` — local-first, mirrored to the RLS-protected
`user_prefs` table (migration 0020). **No new migration was required**: onboarding
v2, UI preferences, and dismissed education extend the existing preferences
cleanly (the spec's preferred path).

**Sync rules:** completed + skipped steps **union** across devices, so a step
finished anywhere counts everywhere — UNLESS a later explicit **reset** exists
(resets are versioned via `resetCounter` and win, and the conflict is surfaced).
Dismissed education ids union. Scalar UI preferences take latest-write but
differences are reported (`mergeUiPreferences`), never silently overridden.
Sign-out clears private navigation memory. Merge is applied when adopting remote
prefs (`prefs.adoptRemotePrefs`).

## Empty workspace (Feature 10)

An empty account shows one primary entry point plus a few secondary paths
(capture, create a project, add a document, create the sample workspace, import a
backup) — never twenty empty dashboards, never populated without consent.

## Verified

`onboarding` self-tests (29) cover progression, skip/resume/reset, sample
create/remove, merge rules, and education/help mapping; `cohesion.mjs` E2E (26)
covers first-run, skip, resume, complete, privacy step, help, sample workspace,
responsive, and keyboard-only onboarding.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
