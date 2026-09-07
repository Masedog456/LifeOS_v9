# LIFEOS-105 — Commitment Lifecycle / Nothing Falls Through the Cracks

Base: `ec3690a` (PR #110 merged). Branch: `claude/lifeos-105-commitment-lifecycle`.
Head unchanged at **0047**. No migration, no lifecycle engine, no reconciliation
pass, no new ranking model.

---

## 1. Audit

Measured against the **real store**. `replaceState` and `getSnapshot` are
exported, so every writer below is the one the product calls — not a
re-implementation — and every reader is asked the same question the page asks.
Fixture: `scripts/fixtures/lifeos-105-world.cjs`, one deterministic world with
every shape §52 names, anchored to a fixed day so "overdue by four" stays
overdue by four.

### 1.1 Canonical writers

| transition | writer | fields written | history |
| --- | --- | --- | --- |
| → open (create) | `createAction*` | — | `created` |
| → completed | `completeAction` | `status`, `completedAt` | `completed` |
| → cancelled | `cancelAction` | `status`, `cancelledAt` | `cancelled` |
| → open (reopen) | `reopenAction` / `restoreAction` | `status`, clears `completedAt`/`cancelledAt` (+`deferredUntil` on restore) | `reopened` / `restored` |
| → deferred | `deferAction` | `status`, `deferredUntil` | `deferred` |
| deferred → open | `returnDueActions` (on hydrate) | `status`, clears `deferredUntil` | `returned` |
| due date set/cleared | `setActionDueDate` | `dueDate` | `due_set` / `due_cleared` |
| → waiting | `markActionWaiting` | `status`, `waitingOn`, `waitingSince`, `followUpDate` | `waiting` |
| follow-up moved | `setNextFollowUpDate` | `followUpDate` only | `edited` |
| waiting → open | `stopWaiting` | `status`, clears `waitingOn`/`waitingSince`/`followUpDate` | `edited` (from/to recorded) |
| occurrence closed | `completeOccurrence` | `recurrenceCompletions` row | `completed` on the series |
| blocker added/removed | `addActionDependency` / `removeActionDependency` | `actionDependencies` | `unblocked` on removal |

Every UI path into deferral goes through `replanOps` / `ResolutionControls` /
`commitment/apply.ts` / `capture/apply-edit.ts` — all of which call
`deferAction`. §17 holds: **no surface reaches raw `deferAction` where
`planReplan` is required.** `not_today` is offered *disabled* for waiting and
recurring records at the builder (`resolve.ts`), which is where the guard is.

### 1.2 The transition matrix, as measured

Chain A — dated Action · defer · reschedule · complete:

| step | status | fields | visible |
| --- | --- | --- | --- |
| open, due today | `open` | `dueDate=T` | Today:do |
| `deferAction("next_week")` | `deferred` | `dueDate=T`, `deferredUntil=T+7` | **Today:do** ← R4 |
| `setActionDueDate(T+2)` | `deferred` | `dueDate=T+2`, `deferredUntil=T+7` | **NOWHERE** ← R3 |
| `completeAction` | `completed` | — | nowhere ✓ |

Chain B — waiting · follow-up · returned · complete:

| step | status | fields | visible |
| --- | --- | --- | --- |
| open, due today | `open` | `dueDate=T` | Today:do |
| `markActionWaiting("Maria")` | `waiting` | `dueDate=T`, `waitingOn`, `waitingSince` | **Today:do + Today:waiting** ← R2 |
| `setNextFollowUpDate(T)` | `waiting` | +`followUpDate=T` | Today:do + Today:waiting |
| `stopWaiting()` | `open` | `dueDate=T` only | Today:do ✓ |
| `completeAction` | `completed` | — | nowhere ✓ |

Chain B2 — waiting · complete **without** stopping the wait:

| step | fields after | |
| --- | --- | --- |
| `completeAction` on a waiting record | `waitingOn`, `waitingSince`, `followUpDate` **all still set** | ← R5 |

Chain C — blocking. **All three clean.** Completing the blocker removes the
`blocked` signal and re-opens the project's next action; removing the
dependency writes `unblocked`; deleting the blocker RECORD leaves no zombie —
the blocked action becomes executable immediately.

Chain D — recurrence. Completing today's occurrence leaves the series `open`
and live; the row leaves Today for today only. **Clean.** Deferring the series
through the raw writer does park it — but no UI path offers that (§1.1).

Chain F/G — ancestry. `buildProjectContext.next` correctly skips waiting,
deferred, blocked and completed candidates. `goalPathState` drops to `"none"`
when the goal's last live action completes. **Clean.**

### 1.3 §7 — the status matrix

| status | live | executable | Today | Project | recommendable |
| --- | --- | --- | --- | --- | --- |
| `open` | ✓ | ✓ | suggested / do / open | next | ✓ |
| `in_progress` | ✓ | ✓ | suggested / do | next | ✓ |
| `waiting` | ✓ | ✗ | waiting roster (+attention when a follow-up is due) | rows, never next | ✗ |
| `deferred` | ✓ | ✗ | nothing (Not Today) | rows, never next | ✗ |
| `completed` | ✗ | ✗ | nothing | nothing | ✗ |
| `cancelled` | ✗ | ✗ | nothing | nothing | ✗ |

No two parts of the app disagree about a status — **except** where a `waiting`
record also carries a `dueDate`, which is R1/R2 below.

### 1.4 §5, §6 — the visibility contract, and the orphan probe

The probe classifies a record as an orphan when it is live, not waiting, not
deferred ahead, not blocked, has no future date, and reaches **no** surface.
Over the torture world it finds exactly one class:

```
{"id":"a-undated","title":"Read the licensing guidance","status":"open"}
```

An open action with no date, no project and no goal. It is not on Today (the
quiet-day open-work list only renders when nothing is dated), not on any Project
or Goal page, and raises no signal.

**This is a documented characteristic, not a red.** The semantic reason exists —
nothing about the record says it matters *today* — and the recovery paths do:
`/actions` lists it, Search finds it, and Today's open-work list names it on any
quiet day. §49 asks for no new UI unless the audit proves a recovery path is
missing; none is. The invariant checker keeps it honest by asserting the class is
*exactly* this one, so a future change that strands a dated or linked record
fails.

### 1.5 §51 — the sixteen candidates, tested

| # | candidate | verdict |
| --- | --- | --- |
| 1 | dated wait gets both `dueDate` and `followUpDate` | **RED 1** — 4 of 5 dated-wait sentences |
| 2 | waiting correction writes the wrong field | **no** — LIFEOS-103 fixed the correction path; it writes `followUpDate` |
| 3 | returned wait leaves stale waiting metadata | **no** — `stopWaiting` clears all three fields |
| 4 | defer then reschedule remains hidden | **RED 3** — visible nowhere |
| 5 | reschedule increments repeated deferral | **no** — 3 reschedules left the count at 3 |
| 6 | blocker completes, blocked stays hidden | **no** — derived; the signal clears |
| 7 | blocker deletion leaves a zombie dependency | **no** — the action becomes executable |
| 8 | recurring completion ends the series | **no** — series stays `open` and live |
| 9 | recurring Not Today moves the series | **no** at the UI — offered disabled with the reason |
| 10 | completion leaves a live signal | **no** — every reader gates on `isLive` |
| 11 | completion remains in Today | **no** |
| 12 | Decision item stays after its condition resolves | **no** — all three kinds clear |
| 13 | Goal path stays true after all executable work ends | **no** — drops to `"none"` |
| 14 | Project next on completed/waiting/blocked work | **no** — correctly skipped |
| 15 | undo leaves a derived suggestion | **no** — undo deletes the records |
| 16 | evening/week review contradict current lifecycle | **no** — capture→defer→reschedule→complete in one day yields `completed=1`, `stillOpen=0` |

**Ten of sixteen did not hold.** Three that did are below, plus three the
candidate list did not name.

### 1.6 The six genuine reds

**R1 (§9) — one date, two fields, two meanings.** `commitCapture` writes
`c.dueDate` through `setActionDueDate` *and* passes the same value to
`markActionWaiting` as the follow-up:

```ts
if (c.dueDate) setActionDueDate(actionId, c.dueDate);
…
if (c.kind === "waiting") markActionWaiting(actionId, c.waitingOn ?? "", c.dueDate);
```

Measured: "Waiting on Sam for the keys by Friday" →
`dueDate = followUpDate = 2026-09-11`. The record is simultaneously due Friday
and following up Friday.

**R2 (§12, §48) — a deadline claim on non-executable work.** Independent of how
the date got there. A `waiting` record carrying a `dueDate` raises `overdue`
when it is past and `due_soon` when it is near, and renders in Today's **DO**
list when it is today — while the same record sits in the waiting roster. §12 is
explicit that the waiting Action is not executable.

| dueDate on a waiting record | signal | in Today's DO list |
| --- | --- | --- |
| three days ago | `overdue` | no |
| today | — | **yes** |
| in two days | `due_soon` | no |

**R3 (§16) — reschedule cannot recover deferred work.** `setActionDueDate` never
touches status, by design ("a due date is information, not a state machine"). So
a deferred action given a new date keeps `status: "deferred"` and its original
`deferredUntil`, and is visible **nowhere** — not Today, not attention, not the
decision queue — until the *old* deferral date arrives, by which time the new due
date may already be past.

**R4 (§40, §48) — Not Today does not hold for a due-today record.**
`buildTodayView` filters `actions.filter(isLive)`, and `isLive` is true for
`deferred`. `alsoToday` re-checks `isDeferredAhead`; `dueToday` and
`recurringToday` do not. So deferring an action that is due today leaves it in
Today's DO list, and deferring a recurring series does the same.
(`buildTodayOrientation` already filters correctly — the two disagree.)

**R5 (§11) — completion leaves the wait behind.** `completeAction` writes
`status` and `completedAt` and nothing else, so `waitingOn`, `waitingSince` and
`followUpDate` survive. No live reader is fooled today — all of them gate on
`isLive` — but the record's **current state** says it is waiting on Maria with a
follow-up due, which is false, and §48 lists `completed + follow_up_due` as an
invalid combination.

**R6 (§42) — a historical line reads a field the transition cleared.** The
week/day review's `waiting_stopped` entry quotes `a.waitingOn` to say "on Maria".
`stopWaiting` clears that field, so the detail is **always `null`**:

```
timeline: [["waiting_stopped", null]]
the history event that HAS the name: ["edited", "stopped waiting on Maria"]
current waitingOn after stop: undefined
```

The truth is in the history event's own `detail`, which is where a question about
what happened belongs (§42).
