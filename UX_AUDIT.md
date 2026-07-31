# LifeOS UX Audit (LIFEOS-032)

> Provisional — the Daily Use, Reliability & Product Polish sprint. Records the
> friction audit, mobile audit, and performance measurements, and the shared UX
> architecture that addresses them.

## Shared UX architecture

- **`lib/ux/`** — deterministic engine: `dirty-state` (unsaved-changes detection +
  `beforeunload` guard), `confirmations` (impact summaries), `feedback` (toast
  store + dedup), `backup` / `restore` (versioned export + validated import),
  `diagnostics` (sanitized sync snapshot), `performance` (budget helpers),
  `onboarding` (first-run checklist projection), `selftest` (40 assertions).
- **`components/ux/`** — one primitive each: `ToastProvider`, `ConfirmDialog`
  (+ global `requestConfirm`), `EmptyState`, `ErrorState`, `SaveStatus`,
  `UnsavedChangesDialog`, `BackupRestore`, `SyncDiagnostics`, `FirstRun`.
- No second state library: every store is the same `useSyncExternalStore`
  module-store pattern already used across LifeOS.

## Friction audit

| Flow | Clicks (before → after) | Issue found | Fix |
| --- | --- | --- | --- |
| Delete goal / project / reset | 1 (raw) | `window.confirm` / inline text; no impact detail; no undo clarity | Shared `ConfirmDialog` with record name, type, affected children, linked-survive note, reversibility; high-impact acknowledgement gate |
| Milestone completion | 1 | no feedback that it counted | Success toast ("Milestone completed") |
| Session end / start / workspace switch | 1 | silent | Toasts (session ended, workspace switched) |
| Backup / restore | — | no way to export or move data | `BackupRestore` on `/health`: versioned export + validated import with preview + merge/overwrite |
| Sync trust | — | state opaque; "Saved" could imply remote when local-only | `SaveStatus` never shows "Saved" before remote success; `SyncDiagnostics` reliability center |
| First run | — | no guidance for the now-large app | Dismissible `FirstRun` checklist of real actions, derived from state |
| Empty pages | varies | some blank/ad-hoc | Shared `EmptyState` (what belongs, why, next action) |
| Malformed import | — | risk of clobbering data | Rejected with clear error; original data + file preserved; explicit confirm to apply |

Dead ends removed: reset/delete now always lead somewhere (toast + navigation);
import errors explain the next step; empty states link to the first useful action.

## Mobile audit (320 / 390 / 430 px)

| Surface | Result |
| --- | --- |
| Command palette | no horizontal scroll; full-width; keyboard-safe |
| Quick capture | full-width sheet |
| Reader | single-column at small widths (LIFEOS-028) |
| Inspector | bottom sheet (LIFEOS-029), no h-scroll |
| Workspace dashboard | verified no h-scroll (LIFEOS-030) |
| Goal / project dashboard | verified no h-scroll at 390px (E2E) |
| Session banner | wraps; quick-note field full-width; safe-area padding |
| ConfirmDialog | bottom-sheet on mobile, safe-area padding, no h-scroll (E2E) |
| Toasts | bottom stack, safe-area padding, pointer-safe |

Requirements met: no horizontal page scroll, usable tap targets, visible primary
actions, `env(safe-area-inset-bottom)` padding on sheets/banner/toasts, no
hover-only actions (all hover affordances are also click/focus reachable).

## Performance measurements

Measured in `lib/ux/selftest.ts` against a large fixture (**5,000 captures +
400 beliefs**), asserted under budget on the CI-class runner:

| Operation | Budget | Result |
| --- | --- | --- |
| Backup export (serialize 5k+400) | < 500 ms | pass (single-digit–low-tens ms) |
| Restore validation | < 500 ms | pass |
| Backup counts | < 100 ms | pass |
| 200 workspace dashboards (LIFEOS-030) | < 1500 ms | pass |
| 200 goal dashboards (LIFEOS-031) | < 1500 ms | pass |

Relationship/backlink derivations remain memoized per graph snapshot (WeakMap,
LIFEOS-029), so repeated inspector/dashboard opens do not re-scan. No new O(n²)
paths were introduced; toasts and confirmations are O(1). We deliberately did not
optimize paths that measured well within budget.

## Loading / saving / offline / error states

Standardized via `SaveStatus` (honest local-vs-remote), `SyncStatus`,
`SyncDiagnostics`, `ErrorState`, and `EmptyState`. Local data is never mutated by
a failure path; corrupt local blobs are preserved (LIFEOS-025) and now
exportable/restorable.

## Known limitations

- Not every legacy creation form was migrated to a single "creation shell"; the
  standardization was applied through shared primitives (labels, keyboard submit,
  autofocus, duplicate-submit guards already present) rather than a rewrite, per
  the sprint's "do not rewrite canonical creators".
- The unsaved-changes in-app dialog is available (`UnsavedChangesDialog`) and the
  `beforeunload` guard is wired via `useUnsavedGuard`; it is applied to the
  longest-form surfaces, not yet every minor inline field.
- Automated accessibility (axe) and Lighthouse CI are not yet wired.

## Sync conflict resolution (LIFEOS-033)

- The shared `ConflictDialog` never defaults focus to a destructive action:
  focus lands on **Postpone** (the safest option), and Escape postpones rather
  than discarding. Keep-local / keep-remote / use-merge / keep-both (duplicate) /
  postpone are all offered explicitly; a safe auto-merge is labelled when
  available so the user sees what will merge without action.
- It renders as a centered dialog on desktop and a bottom sheet on mobile; the
  `syncintegrity.mjs` E2E confirms it opens and has no horizontal scroll at
  390px.
- Recovery, integrity, and conflict panels on `/health` are landmarked regions
  (`aria-label` "Sync conflicts" / "Recovery" / "Data integrity") for
  screen-reader navigation.

## Daily review flow (LIFEOS-034)

- The review at `/daily` is a **full page, never a modal**. The seven steps are
  real, keyboard-reachable buttons with `aria-current="step"`; the user may jump
  freely, skip, and reload without losing progress (every edit autosaves; free
  text commits on blur under the shared unsaved-changes guard).
- Nothing destructive is implied: completing or reopening a review changes no
  other record, and choosing an open loop never marks anything done/undone. The
  friction log feeds this UX audit as structured entries (area + severity) rather
  than analytics.
- Landmarked regions ("Day summary", "Daily review" on Today) aid screen-reader
  navigation. The flow is verified mobile-friendly (no horizontal scroll at
  390px) and keyboard-activatable by `dailyreview.mjs`.

## Inbox zero & capture processing (LIFEOS-035)

- The processor is a **full page, never a modal**. The **original captured text
  is always visible and never hidden**, so clarifying, converting, or discarding
  is always done with the source in view — the system suggests, the user decides.
- The queue is fully **keyboard-navigable** (`J`/`K`/`↑`/`↓` move, `Enter` open,
  `x` select); views, sort, and filter are labelled controls with
  `aria-current="page"` on the active view; action panels are labelled regions
  (`aria-label="… panel"`) and the current status carries `data-capture-status`.
- Nothing is destructive by surprise: **discard requires an inline confirmation**
  and is reversible (restore from the Discarded view); archive is reversible;
  clarifying writes a separate working version and never overwrites the original;
  unsaved rewrites/notes are caught by the shared unsaved-changes guard.
- **No guilt, no gamification.** The Today inbox card is compact and
  non-judgmental (count + oldest age + returning-today), with no streaks, scores,
  or nudges, and it hides itself when the inbox and deferred set are both empty.
- Verified mobile-friendly (no horizontal scroll at 375px on the processor) and
  keyboard-activatable by `inbox.mjs` (35/35).

## Next actions & commitments (LIFEOS-036)

- The action detail is a **full page, never a modal**. Lifecycle controls (start,
  complete, defer, wait, resume, cancel, restore, duplicate) are real labelled
  buttons; the current status carries `data-action-status` and panels are
  labelled regions. The queue is fully **keyboard-navigable** (`J`/`K`/`↑`/`↓`
  move, `Enter` open, `x` select, `p` pin) with `aria-current="page"` views.
- Nothing is destructive by surprise: **cancel is reversible** (restore/reopen);
  **delete** is a separate, confirmed action that shows a dependency **impact
  summary** (what it unblocks, how many edges are removed) first; unsaved title/
  description/notes edits are caught by the shared unsaved-changes guard.
- **Completion is manual and never cascades** — completing an action never
  completes its milestone/project/goal, and milestone progress is shown
  separately (a milestone with open actions can still be completed, with a
  mention, never a block).
- **No guilt, no gamification.** The Today actions card is compact — pinned + in
  progress + due follow-ups + returning-today — with no overdue language, no
  streaks, and no productivity scores; it hides itself when empty.
- Verified mobile-friendly (no horizontal scroll at 375px on the queue) and
  keyboard-activatable by `actions.mjs` (39/39).

## Planning views & focus modes (LIFEOS-037)

- The planning board is a **full page, never a modal**, with five labelled
  horizon columns. A card moves by **drag-drop, per-card move buttons, or the
  keyboard** (`1`–`5` for the five horizons) so nothing depends on a pointer;
  columns carry `data-column`, cards their record ref, and the mobile layout
  switches to a **single-column list** (no horizontal scroll at 390px, verified
  on board and focus).
- **Framing is neutral, never coercive.** The board reads "a horizon is a
  choice — never a deadline"; capacity says "7 selected, preferred limit 5" and
  **never blocks a move, colors it red, or scores it**; the active-project
  safeguard says "No next action selected" and offers Create / Link / Leave —
  it never calls a project stalled or unhealthy.
- **Nothing is decided for the user.** The Today plan never auto-fills when
  empty (an empty plan shows an empty state, not invented items); viewing the
  commitments or weekly views mutates nothing; every per-item control (change
  horizon, remove from planning, focus on this) is an explicit action with a
  confirming toast.
- **Focus Mode** hides nonessential navigation and centers one target, but does
  **not** force browser fullscreen; the exit control is always a visible,
  labelled button (`data-focus-exit`), the timer is opt-in, and interruptions
  are logged by hand — never auto-detected.
- Verified mobile-friendly and keyboard-activatable by `planning.mjs` (27/27).

## Deterministic system insights (LIFEOS-039)

- **Descriptive, never evaluative.** Every insights surface shows counts,
  durations, and arithmetic differences only — there is no composite score, no
  "performance" rating, and no ranking the system asserts. Home reads "counts and
  durations, nothing rated or ranked"; a busy record is "referenced N times,"
  never "important."
- **Comparison language is strictly neutral.** Compare Periods reads "Raw values
  and their differences only — no judgment about direction" and renders
  "12 sessions, previously 9" / "3 fewer" — it **never** says improved, declined,
  better, worse, ahead, or behind. This is enforced by a self-test that fails if a
  banned word appears.
- **Dormancy is stated as fact, never blame.** The Dormancy View reads "No
  recorded activity in 90 days" against a **user-chosen** threshold; it never
  calls a record abandoned, stale, neglected, or unhealthy unless that is an
  explicit stored status.
- **Coverage is always disclosed.** Every view carries a `CoverageNotice` — when
  history began, that open sessions are excluded from completed-duration totals,
  that the view is local-only, and that deleted records may appear only through
  retained history. Partial data is never presented as complete.
- **Nothing is decided for the user.** Insights on Today stay a small card (Today
  is not turned into an analytics dashboard); the planning integration shows
  factual context but never reorders the board, alters horizons, or recommends
  what to plan; the daily-review snapshot adds no praise or criticism.
- **Every metric is defined.** A definitions drawer (`MetricDefinitions`) gives
  each metric a plain-language definition; no metric exists only as undocumented
  behavior.
- Verified keyboard-reachable and mobile-friendly (single column, no horizontal
  scroll at 390px) by `insights.mjs` (33/33).

## Security, privacy & recovery flows (LIFEOS-040)

- **Honest, non-coercive copy everywhere.** Deletion dialogs use a
  deletion-semantics registry so "Archive" never means delete, "Discard" exposes
  restoration, and "Delete permanently" states irreversibility. Account deletion
  discloses tombstone + backup retention and never implies instant erasure; the
  flow offers **export first** and has no coercive retention language.
- **Nothing destructive happens silently.** Restores preview every change and
  require explicit confirmation to overwrite; the Recovery Center previews impact
  and never auto-repairs ambiguous state; corrupt content is quarantined, not
  discarded.
- **Errors never leak or dead-end.** `SecurityErrorBoundary` shows a concise
  message, a quotable reference id, a retry, safe navigation, and an export path —
  never a stack or payload.
- **Critical flows are accessible (Feature 30).** Export, import, restore, and
  account deletion are keyboard-operable with visible focus, labelled controls,
  `role="alert"`/`role="status"` announcements, and no color-only meaning;
  verified keyboard-activated export and mobile Recovery Center (no horizontal
  scroll at 390px) in `security.mjs`.
- **Diagnostics are shareable without fear** — the report is sanitized (masked
  email, redacted tokens, no record contents) and the page says so.
