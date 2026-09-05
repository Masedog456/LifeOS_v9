# LIFEOS-090 — Frictionless Rescheduling & "Not Today"

**North star:** when reality changes, Conqify should help me replan without
making me manage the system.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `f9c654ef4527a8d974955fc6584d383197664193` (PR #95 merged) |
| Branch | `claude/lifeos-090-frictionless-rescheduling` |
| Migration required | **no** — composition and UI (§37) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the real store, not read. A world with an ordinary action due
today, an overdue one, a wait on Maria, a blocked action with a live blocker, a
weekly recurring action, an action deferred three times, and an action
**rescheduled** three times with no deferral, was run through
`resolutionsForAction`, `recommendNextAction`, `repeatedlyPostponed`,
`buildExecutiveChanges`, and then through `deferAction`, `setActionDueDate` and
`batchAction` against a live store.

Fixture: `scratchpad/fx90.js`. Probes: `probe90.cjs`, `p90c.cjs`.

## 1.1 A — What "defer" means today

`deferAction(id, option)`:

```
status        → "deferred"
deferredUntil → DayKey | undefined     ("someday")
history[]     → { action: "deferred", fromStatus, toStatus, detail }
```

Options are `tomorrow`, `next_week`, `someday`, `{date}`. `next_week` resolves
to **next Monday** via `weekStartKey(today) + 7` — an existing product
convention, so §8's "do not silently choose Monday unless the product already
has that convention" is satisfied by reuse.

A deferred action is still `isLive`, and `returnDueActions` brings it back on
hydrate with a `returned` event. `isDeferredAhead` is the one shared predicate
that keeps it out of Today, the signal layer and the recommender.

## 1.2 B — What "reschedule" means today

`setActionDueDate(id, date)`:

```
dueDate   → DayKey | undefined
status    → UNCHANGED
history[] → { action: "due_set" | "due_cleared", detail }
```

## 1.3 C — They are **not** conflated

This was the brief's §38.2 candidate red and it is **not one**. Two setters, two
status behaviours, two history verbs, and `applyTemporalEdit` keeps them apart
deliberately — its `defer` case carries the comment *"Deliberately NOT a
due-date change."* `buildExecutiveChanges` already emits `deferred` and
`rescheduled` as distinct kinds.

## 1.4 D / E — Which operations preserve deferral history

| Operation | Deferral fact | Status change |
|---|---|---|
| `deferAction` | **yes** — `history[].deferred` | → `deferred` |
| `setActionDueDate` | no — `history[].due_set` | none |
| `setNextFollowUpDate` | no | none |
| `completeOccurrence` | no | none (writes a completion row) |

## 1.5 F — Recurrence when postponed

`RecurrenceCompletion { actionId, occurrenceDate, completedAt }` gives
occurrence-level **completion**. There is no occurrence-level **skip or move** —
no row kind, no field, nothing in the schema that can say "this occurrence was
moved and the series was not."

`deferAction` on a recurring action therefore parks **the series record**.

## 1.6 G / H — Waiting and blocked

`markActionWaiting` sets `status: "waiting"`, `waitingOn`, `waitingSince`.
`setNextFollowUpDate` moves `followUpDate` without touching `waitingSince` —
LIFEOS-071 got that right and says why.

Blocking lives in `actionDependencies`, and `ix.blockedActionIds` already
excludes a blocker that is completed.

## 1.7 I — What the row offers today

`RECOMMENDATION_RESOLUTIONS = ["complete_action", "complete_occurrence",
"defer", "reschedule", "open_record"]`, capped at `MAX_INLINE = 3`.

Measured on every fixture action, **every single one offers the same four**:

```
a-plain    open        Complete · Defer · Reschedule · Open
a-wait     waiting     Complete · Defer · Reschedule · Open
a-blocked  open+blocked Complete · Defer · Reschedule · Open
a-recur    recurring   Done for today · Defer · Reschedule · Open
```

Only `complete_*` varies by kind. `set_follow_up`, `stop_waiting` and
`open_blocker` exist in `ResolutionKind` and are **not in the recommendation
set**, so a waiting row never offers the one control that fits it.

Cheapest "not today": **Defer → Tomorrow**, two clicks — and "Defer" names a
mechanism rather than the intent. `deferChoices` offers Tomorrow / Next week /
Someday; there is no "Later this week" and no "Pick date".

## 1.8 The measured reds

### RED 1 (§11) — deferring a waiting action destroys the wait

```
before  {status:"waiting",  waitingOn:"Maria", waitingSince:"2026-08-27", followUpDate:"2026-09-05"}
after   {status:"deferred", waitingOn:"Maria", waitingSince:"2026-08-27", followUpDate:"2026-09-05",
         deferredUntil:"2026-09-06"}
```

The wait is not cleared — it is **orphaned**. Every surface that asks "what am I
waiting on?" tests `status === "waiting"`, so Maria disappears from the waiting
list while the record still names her. This is exactly §11's forbidden
conversion, and the record is left in a state that claims two things at once.
**Confirmed.**

### RED 2 (§14) — deferring a recurring action parks the whole series

```
before  {status:"open",     dueDate:"2026-09-05", recurrence:"weekly/1"}
after   {status:"deferred", dueDate:"2026-09-05", recurrence:"weekly/1", deferredUntil:"2026-09-06"}
```

`isDeferredAhead` then hides the series from Today, the signal layer and the
recommender. The user meant "not this occurrence"; they got "pause the repeat".
`setActionDueDate` on the same record moves the **series anchor**.
**Confirmed.**

### RED 3 (§13) — blocked work is rescheduled with no mention of the blocker

`setActionDueDate` on a blocked action moves the date and keeps the dependency
(so §46.5 holds), but the row offers no `open_blocker`, says nothing about the
blocker, and the new date is a date on which the work still cannot be done.
**Confirmed** as a UX red, not a data-integrity one.

### RED 4 (§19) — batch defer applies blindly across a mixed set

```
batchAction(["a-plain","a-wait","a-recur"], "defer", {option:"tomorrow"})
  a-plain  → deferred                       ✓ intended
  a-wait   → deferred, wait orphaned        ✗
  a-recur  → deferred, whole series parked  ✗
```

No preview, no exceptions, one blind mutation. **Confirmed.**

### RED 5 (§5, §38.1) — there is no "Not today"

The concept does not exist. The nearest path is two clicks through a control
named after its mechanism, with three fixed choices that do not include "later
this week" or an explicit date. **Confirmed.**

## 1.9 Not reds — verified, and kept as forward guards

* **§38.2 defer vs reschedule** — distinct, as §1.3 shows.
* **§38.7 neutral rescheduling does not inflate deferral counts.**
  `a-resched` carries three `due_set` events and does **not** appear in
  `repeatedlyPostponed`; only `a-thrice` does. LIFEOS-081 reads
  `history[].deferred` and nothing else.
* **§46.2 deferred work remains open** — `isLive(deferred) === true`.
* **§38.6 Suggested Next recomputes** — `isExecutable` already excludes
  `waiting`, `isDeferredAhead`, `blockedActionIds`, and a recurring action whose
  occurrence is not today. Nothing caches the recommendation.
* **§22 / §23 ancestry survives** — `bumpAction` spreads the record, so
  `projectId` and `goalId` are untouched by both operations.
* **§46.5 the blocker survives a reschedule** — `actionDependencies` is a
  separate domain and is not touched.
* **§25 Memory already distinguishes** `deferred` from `rescheduled` in
  `buildExecutiveChanges`.
* **Recurring completion is already occurrence-scoped** — `complete_occurrence`
  replaces `complete_action` on a recurring row, and says so on the control.

## 1.10 J — The smallest change

A pure planning layer, `lib/planning/replan.ts`, that answers **one** question:
*given this record and this intent, what may safely happen?* It proposes; the
existing setters execute. Plus a compact Today control that leads with the
intent ("Not today") rather than the mechanism.

## 1.11 Migration (§37)

**None.** Occurrence-level *skip* would need schema — there is no row kind or
field that can say "this occurrence moved and the series did not". §15 sanctions
the alternative explicitly: *"If not supported safely: do not fake it. State the
limitation and preserve the series."* That is what 090 does. Head stays at
**0047**; `0048` is not written.
