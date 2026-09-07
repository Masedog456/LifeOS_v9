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

---

## 2. What changed

### 2.1 One predicate, three readers (§47)

`lib/actions/lifecycle.ts` — three tiny functions, all consolidating.

```ts
ownsTheNextMove(a)          a.status !== "waiting"
isOwnMoveNow(a, today)      isLive && ownsTheNextMove && !isDeferredAhead
shedStatusFields(from, to)  what a status takes with it when it ends
```

`isOwnMoveNow` is the question three readers were already asking and answering
differently:

| | before | after |
| --- | --- | --- |
| `recommend.ts` | live · not waiting · not deferred ahead · not blocked | composes the predicate, keeps the blocked clause |
| `signals.ts` | live · not deferred ahead — **waiting missing** | composes it |
| `view.ts` | live — **both missing** | composes it |

Blocked is deliberately *not* in the predicate: a blocked action's next move is
still the person's (it is the blocker), which is why LIFEOS-070 raises `overdue`
on blocked work and attaches the blocker as the reason.

`shedStatusFields` is LIFEOS-074 §1's rule, extracted from `transitionAction` so
that `completeAction` and `cancelAction` take the same door out of a status —
the D-11 class that helper's own comment names.

### 2.2 The six fixes

| red | fix | file |
| --- | --- | --- |
| R1 §9 | a `waiting` candidate's date is the follow-up; `setActionDueDate` is not called for it | `mvpStore.commitCapture` |
| R2 §12 | date-claim candidates rest on `isOwnMoveNow`, so a wait raises no `overdue`/`due_soon` and is not work to do | `signals.ts`, `view.ts` |
| R3 §16 | naming a day for deferred work returns it to `open` and clears `deferredUntil`, recording the transition on the `due_set` event | `mvpStore.setActionDueDate` |
| R4 §40 | `buildTodayView`'s candidate list is `isOwnMoveNow`, not `isLive` | `view.ts` |
| R5 §11 | completion and cancellation shed the fields their status leaves behind | `mvpStore`, `lifecycle.ts` |
| R6 §42 | the stopped-wait line reads the `waiting` history event, not the field the stop cleared | `memory/week.ts` |

Defer and reschedule stay distinct (§15). R3 does not make a date into a
deferral: it says that naming a day for work you had put aside is picking it
back up. **Clearing** a date is not a decision to start, so the deferral
survives it — and deferring again re-parks the work.

### 2.3 One regression, caught by the suite

Narrowing `live` zeroed Project pulse's "2 waiting · 1 blocked". Those count a
project's **unfinished work**; `live` now answers "the person's available work".
Two different questions, and the code now says which is which.

### 2.4 Left alone, deliberately

- **§45** no repair pass. Old records carrying both a `dueDate` and a wait still
  exist; the READERS now interpret them truthfully (no deadline claim, not in
  the work list), which is better than mutating data and needs no migration.
- **§17, §23** Not Today's guard stays at the resolution builder, where it is:
  `not_today` is offered *disabled* for waiting and recurring records with the
  reason stated. Every UI path into deferral goes through that builder.
- **§27** reopen exists (`reopenAction`, `restoreAction`) and was audited, not
  changed.
- **§50** no schema. Head stays 0047.

---

## 3. Proof

### 3.1 Deterministic — `actions/lifecycle`, 82 assertions

Organised by red, each with its near neighbour. Three blocks drive the **real
store** through `withIsolatedStore`, because a probe that reimplements a writer
tests the probe.

Two assertions were vacuous on the first pass and were rewritten: 105.41 claimed
a wait "keeps its due date" against a fixture that had none, and 105.62 claimed
the recurring series survives while completing an unrelated action. Both now
carry what they describe.

**§48's invariant checker** (`lifecycleViolations`) walks a store and reports
every combination current semantics forbid — finished records carrying wait or
deferral fields, waiting work presented as executable, deadline signals on
waits, deferred work in Today, a project's next action that cannot be started, a
decision whose condition has resolved, a dependency on a record that does not
exist. It runs after **every step of every chain** (105.51–105.64), so a future
writer that reintroduces any of them fails here.

**§6's orphan probe** (`invisibleCommitments`) is pinned to exactly one class —
an open action with no date, no project and no goal — with each near neighbour
asserted to have a stated reason for being quiet.

### 3.2 Browser — `smoke-105-lifecycle.cjs`, 65 assertions

Thirty scenarios. §44's claim is asserted by clicking the app's own controls
(26pre/26b/26c), because that is the only path that reaches the store singleton
from inside a page.

### 3.3 Full-revert proof (§55)

Product code reverted to `ec3690a`; the suite kept. **57/65 — no crashes.**
Eight assertions distinguish the sprint, and they cover all six reds:

| assertion | what the reverted product did |
| --- | --- |
| 2, 2b | left a deferred action in Today's DO list because its date was today |
| 4 | left it `deferred` with `deferredUntil` after a reschedule — visible nowhere |
| 31 | committed `dueDate` **and** `followUpDate` as `2026-09-11` |
| 32 | put a dated wait in the work list |
| 32b | rendered **"Quote · Was due Fri, Sep 4 · Complete Reschedule Defer"** on a waiting record |
| 33 | left `waitingOn`, `waitingSince` and `followUpDate` on a completed record |
| 34 | rendered "Transcript · Stopped waiting" with the person's name missing |

The first revert run distinguished only **3 of 55**, which was a fact about the
suite rather than the sprint: three reds were invisible to it because the suite
seeded `followUpDate` directly, never gave a wait a `dueDate`, and never
inspected stored fields. Scenarios 31–34 were added for exactly that, and the
second run is the one above.

### 3.4 Mutation (§54)

Twelve mutants, **all redden**:

| # | mutant | result |
| --- | --- | --- |
| M1 | waiting writes `dueDate` again | 81/82 |
| M2 | completion keeps the wait fields | 78/82 |
| M3 | `stopWaiting` keeps `followUpDate` | 80/82 |
| M4 | defer → reschedule stays deferred | 78/82 |
| M5 | reschedule writes `deferred` history | 80/82 |
| M6 | a finished blocker still blocks | 81/82 |
| M7 | finished work stays recommendable | 81/82 |
| M8 | waiting counts as the person's own move | 64/82 |
| M9 | Not Today stops holding | 75/82 |
| M10 | Project next counts waiting/deferred work | 81/82 |
| M11 | the stopped-wait line reads the cleared field | 81/82 |
| M12 | the deferral is not shed on a status change | 79/82 |

**M6 took three spins to apply**, and the first two are worth recording: it
targeted `isLive(blocker)` in `indexes.ts`, which does not exist there, and then
lost its nested quotes to the shell. An unapplied mutant is not a surviving one
— it is a mutant that never ran, and only one of those is a result.

### 3.5 Performance (§56)

Milliseconds per derivation, median, same run:

| records | Today | Project | Goal | Decisions | Changes | total |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 5.82 | 3.30 | 3.78 | 1.26 | 0.24 | **14.40** |
| 1,000 | 43.10 | 22.86 | 25.38 | 10.76 | 1.75 | **103.84** |
| 5,000 | 205.48 | 125.58 | 141.51 | 62.78 | 7.28 | **542.64** |

Linear (10× records → 7.2×; 5× → 5.2×). No global reconciliation was added:
`isOwnMoveNow` is O(1) per record and replaces per-record checks that were
already there.

### 3.6 Gates

| gate | result |
| --- | --- |
| deterministic, 66 suites | **6405/6405** (82 new) |
| 105 browser | **65/65** |
| 087 Project Context · 088 Goal Context | 52/52 · 83/83 |
| 090 Not Today · 091 Evening Close · 092 One Daily Review | 69/69 · 87/87 · 59/59 |
| 094 Decision Inbox · 103 Follow-Through · 104 Today 2.0 | 47/47 · 22/22 · 69/69 |
| 083 Command Center · 099 Accessibility | 77/77 · 22/22 |
| 082 Guidance | 62/64 — pre-existing |
| 098 Coherence | 33/34 — pre-existing |
| 084 Weekly Review | 52/62 — **identical on the reverted code**, verified |
| release audit · route smoke · export verify · security | 17/17 · 25/25 · 14/14 · PASS |
| tsc · eslint · build | clean (2 pre-existing warnings, elsewhere) |
| migration head | **0047**, unchanged |

---

## 4. Product claims (§61)

| # | claim | evidence |
| --- | --- | --- |
| 1 | live commitments do not quietly disappear | 105.17–105.29, 105.65–105.70; scenarios 2–4; M4 reddens |
| 2 | waiting stays distinct from executable work | 105.2, 105.12–105.16, 105.80–105.80c; scenarios 5, 32; M8 reddens |
| 3 | waiting dates use the correct semantic field | 105.7–105.11; scenario 31; M1 reddens |
| 4 | returned waits stop behaving as waiting | 105.40–105.41c; scenario 9; M3 reddens |
| 5 | defer and reschedule stay distinct | 105.24–105.29; scenario 24; M5 reddens |
| 6 | rescheduling recovers deferred work | 105.19–105.23; scenarios 3, 4, 4b; M4 reddens |
| 7 | blocked work returns when the blocker resolves | 105.59–105.61; scenarios 12, 13, 13b; M6 reddens |
| 8 | recurring completion does not end the series | 105.62–105.62d; scenario 14; |
| 9 | completion removes work from live surfaces | 105.34–105.39, 105.54; scenario 17; M7 reddens |
| 10 | decision items disappear when resolved | 105.64; scenario 22 |
| 11 | Goal/Project path follows executable reality | 105.59b, chain G; scenarios 20, 21; M10 reddens |
| 12 | corrections and undo reflow derived surfaces | scenarios 25, 26, 26b, 26c |
| 13 | reviews and Memory preserve truth without contradicting current state | 105.48–105.50; scenarios 18, 27, 28, 34; M11 reddens |
| 14 | no new lifecycle engine, persistence or migration | `lifecycle.ts` is three functions and no state; head 0047 |

---

## 5. Known gaps

1. **Cross-tab data changes need a reload.** The store is a module singleton and
   only `lib/security/multi-tab.ts` listens for `storage`, for session locking.
   A second tab's write reaches this tab on the next load. §44's in-page claim
   holds; the cross-tab half does not, and this cost ten assertions on the first
   browser run before the premise was corrected.
2. **§13's dateless wait still asks nothing.** Audited in LIFEOS-104 and
   unchanged: 070 and 094 both exclude it deliberately.
3. **Legacy records may carry a `dueDate` on a wait.** No repair pass (§45). The
   readers interpret them truthfully, so nothing lies; the field is simply
   inert. A lifecycle sprint with migration approval could clear them.
4. **`waitingOn` capture quality.** The interpreter produced "landlord next
   Tuesday" and "contractor Friday" as the person waited on. A capture-layer
   issue, outside 105.
5. **A live undated unlinked action reaches no Today surface on a busy day.**
   §6's orphan probe pins this to exactly one class; the recovery paths
   (`/actions`, Search, the quiet-day list) exist, so §49 asks for no new UI.
6. **084, 082 and 098** carry pre-existing failures, verified against reverted
   code — 084 fails 52/62 either way.
