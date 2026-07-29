# Sync Conflicts, Recovery & Data Integrity (LIFEOS-033)

This document describes how LifeOS keeps long-term user data **trustworthy**
across devices, retries, partial failures, and conflicting edits. The governing
rule is one sentence:

> **The system must never silently discard newer user work.**

Everything below serves that rule. All conflict detection and merging is
**deterministic and client-side** — no AI, no embeddings, no automatic prose
merging, no server round-trip required to decide what changed. The only durable
server-side addition is a privacy-safe tombstone ledger (migration `0024`).

---

## 1. Where the code lives

```
lib/sync/
  schema.ts          version metadata (updated_at / revision / deleted_at); server-time preference
  merge.ts           three-way field-level merge + child-list union
  conflicts.ts       three-way conflict detection / classification
  tombstones.ts      delete integrity (suppress resurrection)
  operations.ts      idempotent, content-addressed mutation ids
  journal.ts         privacy-safe sync journal (metadata only)
  recovery.ts        corruption isolation + recovery mode
  integrity.ts       referential-integrity validation
  restore-safety.ts  upgrade → validate → preview → rollback for restores
  status-store.ts    reactive sync status (conflicts / recovery / rollback)
  selftest.ts        45 deterministic assertions incl. 10 cross-device scenarios

lib/migrations/
  state-version.ts   local StoreState schema version + detection
  upgrade-state.ts    ordered, idempotent StoreState upgraders
  upgrade-backup.ts   ordered, idempotent backup-file upgraders

components/sync/
  ConflictCenter.tsx  lists unresolved conflicts
  ConflictDialog.tsx  per-record resolution (keep local / remote / merge / duplicate / postpone)
  RecoveryPanel.tsx   corruption report, rollback banner, emergency export
  IntegrityReport.tsx referential-integrity findings

supabase/migrations/
  0024_sync_integrity.sql   sync_tombstones table (+ RLS, indexes)
```

The reactive store is surfaced on **`/health`** (Conflict Center, Sync
Reliability, Recovery & integrity, Data integrity, Backup/Restore) and exercised
deterministically on the dev route **`/dev/sync-tests`**.

---

## 2. The fifteen guarantees

1. **Version metadata.** Every record carries `updatedAt` (and, where relevant,
   `deletedAt`); a `revision` is *derived* from these plus a content hash rather
   than trusting a client clock alone. Server timestamps win when present
   (`lib/sync/schema.ts`).
2. **Three-way conflict detection.** `detectConflicts(base, local, remote)`
   compares each side against the last-synced **base** snapshot. A field is only
   a conflict when *both* sides changed it to *different* values — never
   last-write-wins on user content (`lib/sync/conflicts.ts`).
3. **Field-level three-way merge.** Non-overlapping field changes auto-merge;
   child collections (arrays of `{id}`) union by id; overlapping edits escalate.
   Prose is **never** auto-concatenated (`lib/sync/merge.ts`).
4. **Shared resolution UI.** One `ConflictDialog` offers keep-local /
   keep-remote / use-merge / keep-both (duplicate) / postpone. Focus defaults to
   the **safest** action (Postpone), Escape postpones, and no destructive option
   is ever the default. Works on desktop and as a mobile bottom sheet.
5. **Tombstones & delete integrity.** A delete writes a tombstone; a stale device
   holding an old copy cannot resurrect the record when the tombstone is at least
   as new as the record (`lib/sync/tombstones.ts`, table `sync_tombstones`).
6. **Privacy-safe journal.** The sync journal records *metadata only* — domain,
   record id, mutation type, attempt count, sanitized failure category — and
   never content, tokens, or secrets (`lib/sync/journal.ts`).
7. **Idempotent mutations.** Each mutation has a content-addressed id
   (`${domain}:${recordId}:${type}:${revision}`); replaying the same op is a
   no-op (`lib/sync/operations.ts`).
8. **Partial-failure recovery.** The journal tracks pending/failed operations so
   an interrupted sync resumes exactly the unfinished work rather than
   re-pushing everything or losing it.
9. **Schema evolution.** Ordered, deterministic, idempotent upgraders bring both
   the local `StoreState` and exported backup files forward
   (`lib/migrations/`). Unknown keys are dropped safely; missing domains are
   defaulted.
10. **Corruption recovery.** On hydrate, each domain is validated
    record-by-record; malformed rows (null / non-object / missing id) are
    **isolated out of the in-memory store so a single bad record can never crash
    a consumer**, counted per-domain, and reported — while the source in
    `localStorage` is left **untouched** (`lib/sync/recovery.ts`,
    `lib/mvpStore.ts`). A badly-damaged domain can trigger read-only *recovery
    mode* that still permits an emergency export.
11. **Restore safety.** Importing a backup runs upgrade → validate integrity →
    preview → apply, and records a one-click **rollback** snapshot that survives
    until the next user mutation (`lib/sync/restore-safety.ts`,
    `components/ux/BackupRestore.tsx`, `components/sync/RecoveryPanel.tsx`).
12. **Documented cross-device scenarios.** Ten scenarios (below) are encoded as
    assertions in `lib/sync/selftest.ts`.
13. **Conflict-aware save status.** `SaveStatus` shows "Recovery mode" or
    "Conflict — resolution required (n)" ahead of the normal saved/ saving state.
14. **Diagnostics expansion.** The Sync Reliability panel adds unresolved
    conflicts, journal depth, oldest pending op, skipped malformed records,
    recovery mode, and the local schema version — all sanitized.
15. **Architecture.** All logic is isolated in `lib/sync/` + `components/sync/`
    so it is unit-testable without a live backend.

---

## 3. The ten cross-device scenarios

Each is asserted in `lib/sync/selftest.ts` (run at `/dev/sync-tests`):

1. Same record edited on two devices in **different** fields → auto-merge, no
   conflict.
2. Same field edited on two devices → escalated conflict, local kept until the
   user resolves.
3. Delete on device A, unrelated edit on device B → conflict surfaced as
   *delete-vs-edit*, never a silent loss.
4. Different children added to the same parent on two devices → child-list
   **union** (both kept).
5. Offline edits on device A while device B syncs → replay is idempotent; no
   duplicate rows.
6. Re-applying the same mutation (retry) → no-op.
7. Delete then stale device re-syncs old copy → tombstone suppresses
   resurrection.
8. Record intentionally re-created after delete → tombstone cleared, record
   lives.
9. Corrupt local blob on hydrate → malformed rows isolated, app still loads,
   source preserved.
10. Restore an older/other-schema backup → upgraded, validated, preview shown,
    rollback offered.

Plus a performance budget assertion: detecting conflicts across ~5,000 records
completes well under 800 ms.

---

## 4. Database change (migration 0024)

The **only** durable server-side metadata this sprint required is a tombstone
ledger. Revision is derived from the existing `updated_at` columns, so **no
columns were added to any historical table** and migrations `0001–0023` are
untouched.

`public.sync_tombstones (user_id, domain, record_id, deleted_at)` — primary key
`(user_id, domain, record_id)`, three indexes, RLS enabled with per-user
select/insert/update/delete policies. It stores only *which* record was deleted
and *when* — never content (privacy-safe).

Validated on PostgreSQL 16: applied idempotently three times, structure + four
RLS policies confirmed, and cross-user isolation verified (a second user sees
none of the first user's tombstones).

> Note: validating the *full* `0001–0024` chain in a throwaway cluster requires
> the `pgvector` extension used by `0010_semantic_retrieval.sql`. Where pgvector
> is unavailable, `0024` is validated standalone (it depends only on
> `auth.users` / `auth.uid()`), which is sufficient because it is additive and
> references no earlier table.

---

## 5. Privacy & safety invariants

- Diagnostics, the journal, and tombstones never include document contents,
  tokens, credentials, or secrets.
- Conflict resolution never defaults focus to a destructive action.
- Corruption isolation never deletes source data; it only refuses to load bad
  rows into memory.
- Restores are always reversible until the next user mutation.

---

## 6. Running the checks

- **Unit / scenarios:** open `/dev/sync-tests` (summary at
  `#sync-selftest-summary`, `data-pass`/`data-total`/`data-failed`).
- **End-to-end:** `syncintegrity.mjs` drives a production build (self-tests,
  conflict resolution, corruption recovery, integrity, backup upgrade + restore
  + rollback, diagnostics, and the mobile conflict dialog) — 22/22 checks.
- **Migration:** `0024` idempotency + RLS isolation on a real Postgres cluster.

## 7. Out of scope (by constraint)

No AI, agents, embeddings, analytics, collaboration, realtime presence,
messaging, calendar integration, notifications, automatic prose merging, or new
product domains were added. Sync integrity is deterministic plumbing beneath the
existing product, not a new surface.

---

## 8. Later additions riding this layer

- **Daily reviews (LIFEOS-034).** The `daily_reviews` domain (migration `0025`)
  is a first-class synced record that uses this layer unchanged: row-level
  dirty-domain upsert/delete, deletes tombstoned under domain `dailyReviews`, and
  the same three-way conflict handling as any other record. A review only ever
  references other records (never owns them), so a review conflict resolves
  independently of the records it mentions. Its one-per-local-date identity is
  enforced by a DB `unique(user_id, date)` constraint so timezone travel can
  never fork a duplicate. See `DAILY_REVIEW.md`.

- **Capture processing (LIFEOS-035).** Processing metadata rides on the existing
  `captures` domain (migration `0026`, additive columns), so the base capture
  continues to sync via its full-array upsert. `lib/inbox/merge-rules.ts` adds
  field-level three-way merge for the new fields on top of this layer, under one
  rule: **never silently discard lineage or history.** Additive, order-independent
  fields — links, tags, `mergedFromIds` lineage, and the compact processing
  history — are **unioned** automatically, as is a local rewrite alongside a
  remote tag/link. Genuine decision divergence raises a **conflict** for the
  user: local archive vs. remote conversion, local defer vs. remote processed,
  divergent status transitions, `workingText` edited differently on both devices,
  split-vs-rewrite of the same source, and merge-originals-archived-remotely while
  edited locally. Conflicts surface in the existing Conflict Center; nothing is
  resolved by overwriting a competing decision. The **merge** operation (Feature 7)
  is explicit and user-driven — it is never invoked during sync. Discard is a soft,
  reversible status and remains tombstone-compatible. See `CAPTURE_PROCESSING.md`.

- **Next actions (LIFEOS-036).** Actions, their dependency edges, and templates
  are first-class synced domains (migration `0027`), each using this layer
  unchanged: row-level dirty-domain upsert/delete, deletes tombstoned under
  `nextActions` / `actionDependencies` / `actionTemplates`. `lib/actions/merge-
  rules.ts` adds field-level three-way merge under one rule: **never lose
  completion history or dependencies silently.** Tags, links, history, and
  dependency additions (that don't form a cycle) **union**; genuine decision
  divergence raises a **conflict** — completed-vs-cancelled, deferred-vs-started,
  divergent title/description, project reassignment on both devices, and
  completed-on-both-with-different-notes. Cycles are re-validated on apply. See
  `NEXT_ACTIONS.md`.

- **Planning & focus (LIFEOS-037).** Planning assignments and focus sessions are
  first-class synced domains (migration `0028`), each using this layer unchanged:
  row-level dirty-domain upsert/delete, deletes tombstoned under
  `planningAssignments` / `focusSessions`. `lib/planning/merge-rules.ts` adds
  three-way merge under two overriding rules: **never silently duplicate a
  planning assignment, and never silently lose focus history.** Assignment-set
  merges are keyed by the **record reference** (`kind:id`), not the assignment
  id, so a record planned on two devices resolves to exactly **one** assignment.
  Different records moved independently, interruptions logged on separate
  devices, focus panels toggled independently, unrelated capacity limits, and
  history from both sides all **union** (a key absent on one side means "no
  opinion", never a change). Genuine divergence raises a **conflict** — the same
  record moved to different horizons, an incompatible order change, an assignment
  removed on one device but moved on the other (the move is kept — a plan is
  never silently dropped), a focus session ended on one device but extended on
  the other (the ended state's history is kept), and the same capacity soft limit
  changed differently. See `PLANNING_AND_FOCUS.md`.
