# Inbox Zero & Capture Processing (LIFEOS-035)

A deterministic capture-processing workflow. It answers one question for every
raw capture:

> **What should happen to this capture?**

Each capture should be easy to **clarify, connect, convert, defer, archive, or
discard**. The system may *suggest* actions based on a record's shape and
context, but it **never decides meaning for the user**. Nothing is auto-rewritten,
auto-classified, auto-converted, auto-split, or auto-prioritized. There is no AI,
no embeddings, no scoring, no streaks, no gamification, and no notifications.

The original captured text is the preservation guarantee: it is **never edited in
place**. Clarifications live in a separate `workingText`; the verbatim `text`
stays immutable (enforced by the database trigger from migration 0001).

---

## 1. Where the code lives

```
lib/inbox/
  capture-status.ts   status enum, labels, queue-view set, effectiveText,
                      links/tags accessors, age, canTransition (pure)
  queue.ts            deterministic view/filter/sort derivation + counts,
                      nextToProcess, nearbyCaptures (projection over captures)
  defer.ts            defer options → local day key, isDue/isSomeday,
                      returnDueDefers (deferred → inbox when the date arrives)
  history.ts          compact append-only processing events (no full text)
  conversion.ts       canonical-type targets + deterministic preview
  split.ts            manual (blank-line) segment suggestion + split plan
  merge.ts            explicit merge plan + separators (never used by sync)
  merge-rules.ts      field-level sync merge/conflict rules for processing data
  relationships.ts    capture lineage (split/merge/conversion) + referencing
  processing.ts       suggestedActions (shape/context hints — never decisions)
  memory.ts           queue navigation memory (view/sort/filter/active) in prefs
  selftest.ts         54 deterministic assertions

components/inbox/
  InboxPage.tsx        the queue: view tabs, sort, filter, multi-select, keys
  InboxQueue.tsx       the list + keyboard nav (j/k/↑/↓ move, Enter open, x sel)
  CaptureProcessor.tsx focused single-capture screen (original always visible)
  ConversionPreview.tsx convert-to-canonical preview (reuses canonical creators)
  SplitCapture.tsx     manual-boundary split with preview
  MergeCaptures.tsx    explicit merge with selection/order/separator + preview
  DeferCapture.tsx     tomorrow / next week / someday / a specific date
  ProcessingHistory.tsx compact history timeline
  BatchActionBar.tsx   multi-select actions (NEVER batch conversion)
  TodayInboxCard.tsx   compact, non-judgmental Today entry point

app/process/page.tsx         the queue
app/process/[id]/page.tsx    the focused processor
app/dev/inbox-tests/page.tsx runs runInboxSelfTests() (dev route)
```

---

## 2. The processing model

### Status

Every capture has a processing status. Existing captures (created before this
sprint) default to `inbox` — no migration rewrites their meaning, and no
duplicate "inbox record" is created.

| Status       | Meaning                                             | Reversible |
|--------------|-----------------------------------------------------|------------|
| `inbox`      | Raw, unprocessed (the default)                      | —          |
| `processing` | Actively being worked (transient)                   | —          |
| `processed`  | The user decided what it means                      | ✓ restore  |
| `deferred`   | Set aside until a local date (or someday)           | ✓ auto/rest|
| `archived`   | Set aside, out of the inbox (reversible)            | ✓ restore  |
| `discarded`  | Stronger set-aside; confirmed; retained, not purged | ✓ restore  |

`discarded` is a **soft, reversible status** with a `discardedAt` tombstone
timestamp. Nothing is permanently destroyed on discard — a discarded capture is
restorable from the Discarded view and remains tombstone-compatible with the
LIFEOS-033 sync layer.

### The six things you can do

1. **Clarify / rewrite** — write a clearer `workingText`. The original is always
   shown, always recoverable, and reverting is one click. Unsaved edits are
   guarded (`useUnsavedGuard`). Every rewrite/revert is logged to history.
2. **Convert** — turn the capture into a canonical record (belief, concept,
   decision, research note, reflection, principle, framework, practice, project
   note, workspace note) by **reusing the existing canonical creators**, with a
   deterministic preview first. The source capture is **preserved** and linked
   as lineage — conversion never destroys the original.
3. **Split** — divide into multiple captures at **manual** boundaries (blank-line
   suggestions are mechanical, never semantic). The original is preserved unless
   the user opts to archive it; children carry `splitFromId` lineage.
4. **Merge** — an **explicit** user operation: select captures, order them,
   choose a separator, preview, merge. Originals are preserved unless archived.
   Merge is **never** used by sync.
5. **Link** — connect to existing records (workspace / goal / project / document
   / entity) **without converting**. Status is unchanged.
6. **Defer / Archive / Discard** — set aside with the reversibility above.

The processor may surface **suggested actions** from a capture's shape (e.g. a
URL, a question mark, length) and context. These are hints only; the user
always decides. Nothing is auto-applied.

---

## 3. Deferral semantics

Deferral is deterministic and local-date based, reusing `lib/reviews/dates.ts`
(`todayKey`, `addDays`, `weekStartKey`) so it is DST- and timezone-travel-correct:

- **Tomorrow** → `addDays(today, 1)`
- **Next week** → the start of next week
- **Someday** → no date (stays out of the inbox until manually returned)
- **A specific date** → that local day key

When a deferred capture's date has arrived, `returnDueDefers` moves it back to
the inbox. This runs on hydrate and when the queue mounts — there are **no
workers, no notifications, and no recurrence**. Returning is a pure state
transition applied by the store, not by the projection.

---

## 4. Data model (migration 0026)

`0026_capture_processing.sql` adds processing metadata as **additive columns on
the canonical `captures` table** (captures already sync there), rather than a new
normalized table — the smallest durable structure that fits the persistence
architecture. Bounded, always-read-with-the-capture structures (links, tags,
lineage, compact history, source context) are `jsonb`, matching how 0022 / 0023 /
0025 embed activity / milestones / review content.

Key columns: `processing_status` (`not null default 'inbox'`), `working_text`
(separate from the immutable `text`), `deferred_until`, `archived_at`,
`discarded_at`, `source_context`, `linked_workspace_ids` / `linked_goal_ids` /
`linked_project_ids` / `linked_entity_refs`, `tags`, `processing_notes`,
`split_from_id`, `merged_from_ids`, `processing_history`.

- Existing captures **default to `inbox`** (column default + defensive backfill).
- The original `text` column stays **immutable** — the 0001 trigger is untouched.
- Indexes: `captures_status_idx (user_id, processing_status)`,
  `captures_deferred_idx (user_id, deferred_until)`,
  `captures_split_from_idx (split_from_id)`.
- RLS is inherited from the table's existing per-user policies (0001) — no policy
  change is needed.
- Additive and **idempotent**: every statement is `if not exists` / rerunnable;
  migrations 0001–0025 are untouched.

Validated on Postgres 16: the full chain 0001–0026 applies idempotently 3×; new
columns carry correct types/defaults; a legacy-shaped insert defaults to `inbox`
with empty collections; status + `working_text` updates succeed while the
original `text` is rejected as immutable; RLS remains enabled.

---

## 5. Sync behavior (processing fields)

`lib/inbox/merge-rules.ts` defines field-level merge for the processing metadata,
layered on the LIFEOS-033 sync engine. The governing rule: **never silently
discard lineage or history.**

| Situation                                             | Resolution        |
|-------------------------------------------------------|-------------------|
| Both devices add different links / tags / lineage     | **Union** (auto)  |
| Both append history                                   | **Union** (auto)  |
| Local rewrite + remote tag/link                       | **Merge** (auto)  |
| Local archive + remote conversion                     | **Conflict**      |
| Local defer + remote processed                        | **Conflict**      |
| Divergent status transitions on the same capture      | **Conflict**      |
| `workingText` edited differently on both devices      | **Conflict**      |
| Split + rewrite of the same source                    | **Conflict**      |
| Merge-originals archived remotely + edited locally     | **Conflict**      |

Conflicts are surfaced through the existing Conflict Center; nothing is resolved
by overwriting a competing decision. Merge (Feature 7) is an explicit user
operation and is never invoked during sync.

---

## 6. Integrations

- **Today** — a compact `TodayInboxCard` (inbox count, oldest age, items
  returning today, two primary actions). No guilt copy, no streaks, no scores;
  it hides itself when the inbox and deferred set are both empty.
- **Daily review** — the day summary reports a `captures_processed` group; the
  open-loops derivation contributes a single `inbox:backlog` aggregate candidate
  (the user decides — nothing is auto-closed).
- **Session / workspace** — new captures inherit `sourceContext` (workspace /
  session / goal) from the active session at capture time; the processor shows
  and links that context.
- **Command center** — a `nav:process` command plus contextual commands
  (rewrite / convert / defer / archive / process) for the active capture.
- **Search & inspector** — captures index their processing status and tags; the
  entity resolver summarizes with `workingText ?? text` and exposes processing
  notes; backlinks scan captures that reference a record.
- **Queue navigation memory** — view / sort / filter / active capture persist in
  `prefs.inbox` and restore after reload.

---

## 7. What this feature deliberately does NOT do

No AI, LLMs, agents, or embeddings. No automatic classification, rewriting,
conversion, splitting, or prioritization. No scores, streaks, or gamification.
No calendar integration, notifications, background workers, recurrence, or
analytics. No collaboration. No batch conversion (each conversion is reviewed
individually). Discard never permanently destroys a capture immediately.

---

## 8. Verification

- `runInboxSelfTests()` — **54/54** (status defaults, queue filter/sort/view
  derivation, defer local-date semantics, split/merge planners + lineage,
  conversion preview, backlinks, sync conflict rules, projection purity, perf).
  Run it at `/dev/inbox-tests`.
- `inbox.mjs` E2E — **35/35** across the 27 required scenarios (open inbox,
  keyboard nav, focused processor with original always visible, rewrite + revert,
  convert, link without converting, split, merge, defer, restore-deferred-on-load,
  archive/restore, discard-with-confirm reversible, batch multi-select without
  batch conversion, history, Today integration, queue-memory reload, mobile).
- Migration 0026 validated on Postgres 16 (idempotent 3×, defaults, immutability,
  RLS).

---

## Addendum — capture → next action (LIFEOS-036)

A processed capture can become a **next action** (`→ Next action` on the
processor, or the command center). This opens the action creator pre-filled with
the capture's working/original text as an editable title and its inherited
workspace/goal/project links and `sourceCaptureId`. The **capture is preserved**
— creating the action changes nothing about it; the user separately decides
whether it becomes processed, archived, or stays in the inbox. Captures are never
auto-classified as actions. See `NEXT_ACTIONS.md`.

## Addendum — capture → planning horizon (LIFEOS-037)

The capture processor also offers an explicit **"Plan…"** control that assigns
the capture a **planning horizon** (Today / This Week / Later / Someday). This
is a manual choice that records where the user *intends* to consider the
capture; it is **not scheduling** — no date, deadline, reminder, or automatic
movement is created, and the capture's processing status is unchanged. A
capture is only ever planned because the user picked a horizon. See
`PLANNING_AND_FOCUS.md`.

## Addendum — capture flow insights (LIFEOS-039)

The LIFEOS-039 **Capture Flow** view (`/insights/captures`) reports, for a
user-selected range, where captures went: the outcome distribution with counts
and percentages, the **median processing delay**, the **oldest unprocessed
capture**, and source distribution where explicitly stored. It is derived from
existing capture history — no new capture fields, no new storage. It makes **no
quality judgments** about captures. See `DETERMINISTIC_INSIGHTS.md`.

The outcomes are exactly the six `processingStatus` values a capture can hold —
**still in inbox, being processed, processed, deferred, archived, discarded** —
because status is the only thing this view reads. It previously also listed
outcomes like "converted to action", "linked to project/knowledge" and
"restored": those name capture *history actions*, not statuses, so no capture
could ever be reported under them. "Converted to action" was doubly wrong, since
none of the eleven `convertCapture` targets creates a `NextAction` (that is the
processor's separate `→ Next action` control, described above). Corrected in
LIFEOS-050B; the label map is now typed against `CaptureProcessingStatus` so the
two cannot drift apart again.

## Addendum — security & export (LIFEOS-040)

This subsystem's records are covered by the LIFEOS-040 hardening: they sit behind
Postgres **RLS** (audited so a new table can't ship without it), are included in
the complete **account export** (deterministic JSON with checksums, no secrets),
are restorable via the previewed, non-destructive **import/restore** flow, and
appear in the **Recovery Center** where they support discard/archive. Inputs are
size-limited and plain-text-first; external links are protocol-allowlisted;
diagnostics and errors never carry this subsystem's contents. See
`SECURITY_AND_PRIVACY.md` and `BACKUP_AND_RECOVERY.md`.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
