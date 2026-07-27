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
