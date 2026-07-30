# Next Actions & Commitments (LIFEOS-036)

A focused next-action layer. It helps the user answer one question:

> **What can I concretely do next?**

A next action is **manually created, specific, independently completable,
connected to meaningful context, and small enough to begin in a session.** It is
the leaf of the execution chain:

```
Goal → Project → Milestone → Next Action → Session → Activity & knowledge
```

The system **never generates, prioritizes, or schedules actions.** There is no
AI, no automatic task generation, no importance algorithm, no scheduler, no
calendar, no notifications/reminders, no productivity scores, streaks, or
gamification. LifeOS provides the structure; the user chooses what matters and
what happens next.

---

## 1. Where the code lives

```
lib/actions/
  action.ts         canonical factory + context-inheritance (milestone/project/
                    capture/session pre-fill; the user confirms every field)
  status.ts         status/size/energy/view labels, isOpen/isTerminal, canTransition
  queue.ts          deterministic Next eligibility, views, filters, sorts, counts
  dependencies.ts   cycle-safe edges (add/validate), blocked?, impact, prune
  defer.ts          tomorrow/next week/someday/date → local day key; return-when-due
  waiting.ts        waiting + follow-up-due (surfaced, never auto-acted)
  history.ts        compact append-only events (deduped; no full text)
  templates.ts      reusable shapes (explicit instantiation; no recurrence engine)
  relationships.ts  project/milestone/Today/daily-review projections + neighbours
  tracking.ts       session ↔ action attribution (reuses LIFEOS-030 activity)
  merge-rules.ts    field-level sync merge/conflict rules
  memory.ts         queue navigation memory (prefs.actions)
  selftest.ts       62 deterministic assertions

components/actions/
  ActionQueue.tsx        the queue: views, filters, sort, multi-select, keyboard
  ActionList.tsx         the list + keyboard nav (j/k/↑/↓, Enter, x, p)
  ActionDetail.tsx       focused screen: lifecycle + context + deps + history
  ActionCreator.tsx      the single creation form (all entry points)
  ActionFilters.tsx      filter controls
  ActionHistory.tsx      compact history timeline
  ActionDependencies.tsx blockers/blocked + add-blocker (cycle-safe)
  ActionTemplatePicker.tsx templates list + instantiate
  BatchActionBar.tsx     multi-select ops (NO batch title/notes, NO conversion)
  TodayActions.tsx       compact, non-judgmental Today card
  ProjectActions.tsx     project-dashboard action section (Feature 13)

app/actions/page.tsx         the queue (?new, ?start=next, ?fromCapture=<id>)
app/actions/[id]/page.tsx    the focused detail (?do=complete|defer|wait)
app/dev/action-tests/page.tsx runs runActionSelfTests() (dev route)
```

---

## 2. Action state model

| Status        | Meaning                                                | In "Next"? | Reversible |
|---------------|--------------------------------------------------------|-----------|------------|
| `open`        | Ready to do                                            | yes¹      | —          |
| `in_progress` | Actively being worked                                  | yes¹      | —          |
| `waiting`     | Blocked on someone/something (`waitingOn`, follow-up)  | no        | resume     |
| `deferred`    | Set aside until a local date (or someday)              | no        | auto/return|
| `completed`   | The user marked it done (manual)                       | no        | reopen     |
| `cancelled`   | The user abandoned it                                  | no        | restore    |

¹ unless currently **blocked** by an unfinished dependency.

Every field is user-selected. `estimatedSize` (tiny/small/medium/large/
unspecified) and `energy` (low/medium/high/unspecified) are **never calculated**.
`context` (computer/phone/errand/…/custom) is free text the user picks.

---

## 3. Creation & inheritance

One canonical creator (`makeAction` → `createAction`) is used by every entry
point: command center, project dashboard, milestone, workspace, daily review,
tomorrow focus, capture processing, active session, and the entity inspector.
Context is **pre-filled** where known, and the user confirms all fields:

- **from a milestone** → project + goal + workspace (+ milestone).
- **from a project** → goal + workspace.
- **from a capture** → `sourceCaptureId`, inherited workspace/goal/project links,
  and the capture's working/original text as an **editable title suggestion**.
  The capture is **preserved**; the user separately decides whether it becomes
  processed, archived, or stays in the inbox.

---

## 4. The "Next" definition (deterministic)

The Next view (`isNextEligible`) includes an action iff it is:

- status `open` (or `in_progress`, still shown to resume),
- **not** deferred into the future, **not** waiting,
- **not** completed/cancelled, and
- **not** currently blocked by an unfinished dependency.

It respects the user's **manual ordering**, with explicit **pins** floated to the
top. Nothing infers the "best" action and nothing silently reorders based on
behavior. There is no importance score.

---

## 5. Dependencies

Explicit, manually-created edges: **B is blocked by A**. The application layer
rejects self-loops, duplicates, and any edge that would create a **direct or
indirect cycle** (`wouldCreateCycle`, iterative DFS over an indexed adjacency
map). Completing A makes B **eligible** but **never starts it**. A **missing**
endpoint (a deleted blocker) is treated as non-blocking, so a dangling
dependency degrades gracefully and never crashes a projection. Deleting or
cancelling an action shows an **impact summary** (which actions it unblocks, how
many edges are removed) before proceeding.

---

## 6. Defer & waiting semantics

Both reuse the LIFEOS-034 local-date engine (`lib/reviews/dates.ts`) — the same
semantics as capture processing and daily reviews (DST- and timezone-correct):

- **Defer**: tomorrow / next week / a specific local date / someday. A deferred
  action leaves Next; when its date arrives it becomes **eligible for Next again
  while retaining its status history** (`returned` event). Someday has no date.
- **Waiting**: `waitingOn` + optional `followUpDate`. When a follow-up date
  arrives it is **surfaced** in the queue and daily review, but the status is
  **never changed automatically**.

No background workers, no notifications, no recurrence.

---

## 7. Session integration

Starting an action sets it `in_progress` and can optionally start (or reuse) a
session — reusing the **existing single-session engine**, never a second one. The
action is designated as the session's **current action** (one at a time; a
session may contribute to many over its life) and shown in the session banner.
Action lifecycle events are recorded into the session's existing activity
timeline (`action_activity`) — no new tracking system.

---

## 8. Completion

Completion is **always manual** and never cascades. Completing an action does
**not** complete its milestone, project, goal, or any other action. Optional
completion evidence (a note + linked records) can be attached, and milestone
progress is shown **separately**. Reopen and restore are available.

---

## 9. Batch, milestone, daily-review, Today, command, search

- **Batch** (multi-select): link project/workspace, add tag, set context/energy/
  size, defer, mark waiting, complete, cancel, restore — with an **impact
  confirmation** for destructive/large changes. **Never** batch title/notes;
  **never** batch conversion.
- **Milestone/project** dashboards show action counts by bucket (open / in
  progress / completed / blocked) and a per-milestone grouping. Milestone
  completion stays manual; if a milestone has open actions, completion mentions
  them but is **not** blocked.
- **Daily review** reports actions created / started / completed / deferred
  today, plus still-in-progress, waiting follow-ups, and overdue deferred
  returns. Completing a review changes no action.
- **Today** shows a compact, calm card: pinned + in progress, follow-ups due,
  returning today, and the most-recent incomplete action, with Start-next and
  Open-queue. No overdue guilt, no scores.
- **Command center**: New action, Open queue, Start next / selected, Complete /
  Defer / Wait on the current action, Resume recent, Create from current capture
  / milestone — contextual commands appear only when their context exists.
- **Search & inspector**: actions and templates are indexed (title, description,
  notes, tags, context, waitingOn, linked names). The entity resolver, backlinks,
  and inspector treat `action`/`action_template` as first-class kinds.

---

## 10. Data model (migration 0027)

`0027_next_actions.sql` adds three tables: `next_actions`, `action_dependencies`,
`action_templates`. Design:

- **Normalized** lifecycle/context columns; bounded always-read-with-the-action
  structures (links, tags, compact history) as `jsonb`, matching 0022/0023/0025.
- **Soft references only**: `project_id` / `milestone_id` / `goal_id` /
  `workspace_id` / `source_capture_id` / `source_review_id` are plain `uuid`
  **without foreign keys**, so deleting a project/milestone/goal **never cascades
  away an action** and an orphaned reference degrades gracefully.
- `action_dependencies` is a first-class **edge table** (a dependency addition
  unions across devices; cycle checks run at the application layer) with a DB
  `check (blocker_id <> blocked_id)` and a `unique(user_id, blocker_id,
  blocked_id)`.
- Additive, **idempotent**, **RLS-protected** (4 policies per table), indexed,
  and tombstone-compatible with the LIFEOS-033 sync layer.

Validated on Postgres 16: chain `0001–0027` applies idempotently 3×; columns
carry correct defaults; a bare insert defaults to `open`/`unspecified` with empty
collections; the self-dependency `check` is enforced; a soft `project_id`
reference to a non-existent project is accepted (orphan-safe); **RLS isolates
users** (user1 sees only their rows, user2 only theirs).

---

## 11. Sync conflict rules

`lib/actions/merge-rules.ts` layers on the LIFEOS-033 engine. Rule: **never lose
completion history or dependencies silently.**

| Situation                                              | Resolution     |
|--------------------------------------------------------|----------------|
| Local tag add + remote note edit                       | **Auto-merge** |
| Different linked entities / history events added        | **Union**      |
| Dependency additions (no cycle)                         | **Union**      |
| Completed locally + cancelled remotely                  | **Conflict**   |
| Deferred locally + started remotely                     | **Conflict**   |
| Divergent title/description edits                       | **Conflict**   |
| Project reassignment on both devices                    | **Conflict**   |
| Completed on both with different completion notes       | **Conflict**   |

Conflicts surface in the shared Conflict Center; nothing overwrites a competing
decision. History is always unioned by id — never dropped.

---

## 12. Privacy boundaries & known limitations

- All derivations read only local records; nothing is sent anywhere and nothing
  is inferred about the user. History stores compact metadata, never a copy of
  descriptions/notes.
- The **session's current-action pointer** is working state kept in local
  storage (the `workspace_sessions` table has no column for it), so it does not
  cross devices; the action itself and its status/history do sync.
- Milestones/actions are distinct: a **milestone** is a checkpoint (manual
  done/undone); a **next action** is a concrete, independently-completable step.
  Completing actions never moves a milestone.

---

## 13. Verification

- `runActionSelfTests()` — **62/62** (`/dev/action-tests`): lifecycle, Next
  eligibility, manual ordering, context inheritance, defer/waiting/someday,
  dependency cycles + unblocking + missing endpoints, templates, milestone/
  daily-review/Today projections, sync conflict rules, history dedup, projection
  purity, performance.
- `actions.mjs` E2E — **39/39** across the required scenarios.
- Performance (20,000 actions + ~3,000 dependencies): Next-queue derivation
  **~19 ms**; a 3,000-deep dependency cycle check **~2 ms**.
- Migration 0027 validated on Postgres 16 (idempotent 3×, defaults, self-dep
  check, orphan-safe soft refs, RLS cross-user isolation).

---

## Addendum — actions & maintenance (LIFEOS-038)

Knowledge maintenance treats cancelled actions as **archive candidates** and an
active project with no open action as an **inactive project** candidate in the
review queue — surfaced for a conscious decision, never auto-archived or
auto-created. Archiving an action is a reversible maintenance event and does not
change the action's status or delete it. See `KNOWLEDGE_MAINTENANCE.md`.
