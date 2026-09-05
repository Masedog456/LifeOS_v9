# LIFEOS-090 — Frictionless Rescheduling & "Not Today"

**North star:** when reality changes, Conqify should help me replan without
making me manage the system.

## STATUS: COMPLETE

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

---

# 2. Defer and reschedule stay different (§4, §24, §26)

The brief's first instruction was *"do not collapse both into one generic
move."* They are not collapsed anywhere, and the difference is now stated in
the vocabulary rather than left implicit in which setter a component happened
to call.

| | **Not today** (defer) | **Reschedule** |
|---|---|---|
| Question it answers | "not today — when does it come back?" | "when is this actually due?" |
| Primitive | `deferAction` | `setActionDueDate` |
| `status` | → `deferred` | unchanged |
| Field | `deferredUntil` | `dueDate` |
| History | `deferred` | `due_set` |
| Counts toward repeated postponement | **yes** | **no** |
| Leaves Today | yes | only if the new date is not today |

`planReplan` maps a `defer` intent to `deferAction` and a `reschedule` intent
to `setActionDueDate`, and assertion 90.3 states the property directly: for no
intent do the two produce the same `op`. Mutations **M12** and **M13** swap the
two setters in each direction; each is caught, M12 by six assertions.

The count is the part that would be silently wrong if this were sloppy. Moving
a deadline is not a confession, and browser assertion 18 checks the record's
own history after a reschedule: no `deferred` event is written, so
`repeatedlyPostponed` — which reads `history[].deferred` and nothing else —
never sees it.

# 3. "Not today" (§5, §6, §7, §8)

`not_today` is a `ResolutionKind`, the eleventh, so it renders through the same
`ResolutionControls` as every other quick action and inherits the authority
model, the undo and the accessibility work already proven by LIFEOS-071.

Pressing it opens **one** compact row of choices, never a date grid:

```
Tomorrow · <the days left in this week, by name> · Next week · Someday
```

`restOfWeek(today)` returns the days after tomorrow that are still inside the
current week — empty on a Friday or a weekend, which is correct and is why the
deterministic suite pins itself to a Wednesday. §7 forbids inventing a "later
this week" that quietly resolves to one hidden weekday; **M19** makes exactly
that substitution and assertion 90.42 catches it. **M21** widens the filter so
tomorrow reappears as a named weekday — two chips, one day, two names — and
90.44 catches that.

"Next week" reuses `deferKeyFor("next_week", today)`, the store's own
convention (`weekStartKey + 7`, i.e. next Monday). §8 permits Monday only if
the product already has that convention: it does, so 090 reuses it rather than
adding a second one. **M20** replaces it with `addDays(today, 7)` — a plausible
second convention — and 90.39 catches the divergence.

There is no arbitrary date anywhere in the path. **M17** removes the
missing-day guard and **M18** makes `dayFor` fall back to tomorrow; both are
caught. An intent with no day produces no proposal and asks for one (§36).

# 4. Waiting is not deferred work (§11, §12)

The audit's RED 1: `deferAction` on a wait set `status: "deferred"` while
`waitingOn: "Maria"` stayed on the record. The wait was orphaned — no longer a
wait, still carrying a person.

`planReplan` refuses. A waiting record cannot take a `defer` or a `reschedule`;
it becomes an **exception** naming the person, and the exception carries its own
way forward — `setNextFollowUpDate` at the day the user already picked:

> **Transcript from Maria** — Still waiting on Maria — a wait isn't work you
> can push.  `[ Keep waiting; follow up Sun, Sep 6 instead ]`

Nothing is invented about Marcus, or Maria, or when they will reply (§12). The
follow-up date is the day the *user* chose; Conqify supplies no estimate of
anyone else's behaviour.

The row's vocabulary changed to match: a waiting record is offered
`complete_action`, `set_follow_up`, `stop_waiting` — and never a plain
reschedule, and never an enabled "Not today". **M4** restores the damaging set
and is caught; browser assertions 19–26 confirm the wait survives a follow-up
with `waitingOn`, `waitingSince` and `status` all intact.

# 5. The blocker (§13)

Replanning blocked work is allowed — the user may know something the graph does
not — but it is never silent and never automatic. The proposal carries the
blocker's name and drops to `confirm` authority:

> Move to Sun, Sep 6 — blocked by "Need legal review"; a new date won't
> unblock it.

The dependency is untouched by the move (browser 29), the blocker itself is
untouched (30), and the item still moves when the user insists (31). **M9**
drops the blocker from the proposal, **M10** downgrades it to run-on-press,
**M11** stops the row leading with the blocker; all three are caught.

# 6. Recurrence: the limitation, stated (§14, §15)

There is no way to move one occurrence of a repeat without moving the series.
`RecurrenceCompletion` records occurrence-level **completion** only —
`{ actionId, occurrenceDate, completedAt }` — and no row kind, field or flag
can say "this occurrence moved and the series did not". Adding one is schema,
and §37 forbids schema here.

So 090 does what §15 says to do when the operation is not safely supported: it
does not fake it. "Not today" appears on a recurring row, **disabled**, with
the reason:

> This repeats. Conqify can close today's occurrence, but it can't move one
> without moving the whole repeat.

The occurrence-scoped completion stays and leads the row, so there is still
something honest to press. **M5** and **M6** let a recurring record through the
guard (the second by replacing `readRule` validation with truthiness, so a
malformed rule slips past); each reddens nine assertions. **M7** swaps the
occurrence-scoped completion for the one that ends the series; **M8** deletes
the disabled-with-a-reason branch so "Not today" silently parks the series.
All caught.

Browser 36 dispatches a click event *directly* at the disabled control rather
than clicking it — a plain click would pass by never arriving — and confirms
nothing is wired behind the disabled state.

# 7. Stop is not defer (§16, §17)

A `stop` intent maps to `cancelAction`: a lifecycle change that keeps the
record, its history and its links. No delete primitive is reachable from this
layer at all (90.51 asserts the ops list, not the prose — the honest
explanation legitimately contains the word "deleted"). Stop always asks, on a
single record as much as in a batch. **M15** turns stop into a someday-defer;
**M16** removes its confirmation; both caught.

# 8. Batch (§18, §19)

Selecting several items and pressing "Not today" now opens a **preview**
instead of mutating:

```
Move 3 items — when should they come back?
[ ✓ Tomorrow ] [ Next week ] [ Someday ]

3 selected · 1 can move · 1 is waiting · 1 repeats

Pay the deposit — Not today — back Sun, Sep 6

Transcript from Maria — Still waiting on Maria — a wait isn't work you can
  push.   [ Keep waiting; follow up Sun, Sep 6 instead ]
Water the plants — This repeats. Conqify can close today's occurrence, but it
  can't move one without moving the whole repeat.

[ Confirm ]  [ Cancel ]
```

One confirmation for the whole batch. Exceptions are shown with their own
reasons, counted separately in the summary, and each carries its own way out
where one exists — but an exception moves **only** if the user explicitly takes
it. `applyReplan` is handed the *proposals*, never the plan, so there is no
"apply everything" a caller could reach for by accident. **M22** applies the
list twice, **M23** hides the exception counts, **M24** removes the batch
confirmation; all caught.

Selection is explicit throughout: the preview acts on checked rows and nothing
else (§18).

# 9. One temporal path (§33)

Before 090 there were three places that could change when a piece of work
happens, and only one of them knew what kind of record it was acting on:

* the row's resolution controls,
* `BatchActionBar`'s blind `run("defer", …)`,
* `ActionDetail`'s own Defer panel, calling `deferAction` directly.

The third was found by a *failing browser test*, not by reading: assertion 15
went looking for `[data-resolution="reschedule"]` on `/actions/[id]` and found
nothing there at all. The detail page had its own path, with no waiting guard
and no recurring guard — so the audit's RED 1 and RED 2 were both still
reachable one click deeper. All three now go through `planReplan` and the
LIFEOS-071 primitives.

`lib/planning/replan.ts` is pure: it reads state and returns a `ReplanPlan`.
Nothing in it writes, and no `ReplanIntent` is ever persisted (§34).

# 10. Today, Memory and Weekly Review (§21, §22, §23, §25)

* A deferred item leaves Today and Suggested Next recomputes — `isDeferredAhead`
  already did this and 090 changed nothing about it (browser 14). When nothing
  else stands out, LIFEOS-072 **declines** rather than promoting a weaker
  candidate; assertion 90.58 is aimed at "left the pool / answer recomputed"
  rather than at a replacement existing, because requiring a replacement would
  assert the opposite of 072's design.
* Project and Goal ancestry survive both operations (`bumpAction` spreads the
  record) — browser 13, 50, 52.
* Memory already distinguished `deferred` from `rescheduled` in
  `buildExecutiveChanges`; 090 adds no vocabulary there.
* The result survives a reload (browser 53).

# 11. Visual review (§41)

Screenshots at 1280 and 390, dense and calm, on the plain, waiting, blocked and
recurring records, plus the batch preview. Three defects, all found by looking
rather than reading, all fixed:

**V1 — Complete twice, twenty pixels apart.** The Action page's lifecycle bar
already carries Complete, and the new Replan section rendered a second one, plus
an "Open" linking to the page it was already on. Filtered out of that section
only; `resolutionsForAction` is untouched so rows elsewhere keep both. What
stays is what the bar cannot do: `complete_occurrence`.

**V2 — one screen, two answers.** Replan said a repeat's occurrence cannot move
and explained why. The Due field, an inch above, would move it silently — the
series anchor, not one instance. The field still works, because that *is* the
honest operation on a series, but it now says what it does.

**V3 — a wait with two identical menus.** A wait whose follow-up had arrived
appeared on the attention shortlist and again in the waiting roster, each with
the same three buttons. LIFEOS-083 had already ruled that controls attach to the
primary row; the roster entry keeps its place in the list and loses the
duplicate menu.

**Not fixed, recorded:** the Suggested Next card prints "Was due Thu, Sep 3"
twice — once as a reason bullet and again inside LIFEOS-072's contrast sentence
("Was due Thu, Sep 3, and Water the plants isn't overdue"). It is a real
duplicated date. Changing it means rewriting 072's explanation composition and
its assertions, which is another sprint's guarantee, not this one's.

**Not a defect:** on a Saturday the quick menu shows only Tomorrow / Next week /
Someday. `restOfWeek` is legitimately empty and no weekday is invented to fill
the gap.

# 12. Performance (§42)

Deterministic, 100 / 1,000 / 5,000 actions:

```
n= 100  plan(1)=0.124ms  plan(50)=2.62ms  plan(all)=  5.2ms  choices=0.19ms
n=1000  plan(1)=0.054ms  plan(50)=2.06ms  plan(all)= 40.0ms  choices=0.17ms
n=5000  plan(1)=0.048ms  plan(50)=1.82ms  plan(all)=200.0ms  choices=0.18ms
```

Planning is **flat in store size** and linear in the selection: one item costs
the same at 5,000 records as at 100. Even selecting all 5,000 at once costs
200ms, and no UI path does that.

In the browser, same sizes:

```
n= 100  /today=170ms  menu opens in  96ms  "Not today" settles in  72ms
n=1000  /today=218ms  menu opens in  80ms  "Not today" settles in 166ms
n=5000  /today=680ms  menu opens in 100ms  "Not today" settles in 396ms
```

The menu opens in ~100ms at every size. The write at 5,000 is dominated by the
store's own serialize-and-persist, not by anything 090 added. No page errors at
any size.

# 13. Accessibility (§43)

Every quick action is a real `<button>` with a word label, an explanation, and
keyboard focus (browser 55–57). Selected state in the batch preview is carried
by a `✓` as well as by colour. Tap targets are 72×27 at 390px with no
horizontal overflow. A disabled control's reason is rendered as text on the
page, not only as a `title` — a tooltip needs a pointer and a hover, which
gives a touch user and a screen-reader user silence.

# 14. Language (§32, §35)

`REPLAN_FORBIDDEN_WORDS` is asserted against every string this layer produces,
and browser 54 re-checks the rendered page. Nothing says "you seem overloaded",
"you're falling behind", or "AI recommends". The explanations state facts about
records: what kind of work it is, what it is blocked by, when it comes back.

# 15. Known gaps

1. **One occurrence of a repeat still cannot move.** Stated, not faked. It needs
   an occurrence-exception row, which is schema, which is §37.
2. **The Due field on an Action page can still set a date on a waiting record.**
   It does not clear `waitingOn`, so nothing is orphaned, but it is a second
   surface with looser rules than Replan's. Out of §33's stated remit (Replan
   was the collapse target) and left recorded rather than quietly widened.
3. **The duplicated date on Suggested Next** — §11 above.
4. **`repeatedlyPostponed` counts deferrals only.** Correct today. If a future
   sprint wants "moved a lot" to include neutral reschedules, that is a
   deliberate product decision and should be made explicitly, not by widening
   the predicate.

# 16. Gates (§44)

| Gate | Result |
|---|---|
| Deterministic — full regression | **5602/5602** across 54 suites, none failing |
| `planning/replan` selftest | **88/88** |
| §39 browser torture (090) | **69/69** |
| §40 mutation proofs | **25/25 caught**, 0 escapes, 0 patch failures |
| 081 executive memory | 72/72 |
| 082 executive guidance | 64/64 |
| 083 command center | 77/77 |
| 084 weekly review | 62/62 |
| 087 project context | 52/52 |
| 088 goal context | 83/83 |
| 089 capture context | 66/66 |
| `release:audit` | PASS 17/17 · migration count 47, nothing beyond 0047 |
| `release:routes` | PASS 24/24 |
| `release:export` | PASS 14/14 |
| `audit:security` | PASS — RLS, secrets, routes, auth, deps |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (2 pre-existing warnings in unrelated files) |
| `next build` | clean |

# 17. The twelve claims (§46)

1. **"Not today" leaves Today** — browser 14; `isDeferredAhead`.
2. **It stays open work** — browser 11: `deferred`, not `cancelled`, and
   `isLive` is true.
3. **No silent arbitrary date** — every choice is named and shown; M17, M18,
   90.46–90.49.
4. **Defer and reschedule stay distinct** — §2 above; 90.3, M12, M13.
5. **A blocker survives a replan** — browser 29, 30.
6. **A wait is never turned into scheduled work** — browser 19–26; M1, M4.
7. **A recurring series is never parked by moving one occurrence** — browser
   32–36; M5, M6, M8.
8. **Stop is a lifecycle change, not a deferral** — 90.50–90.56; M15.
9. **A batch previews before it mutates** — browser 40, 42; M24.
10. **Exceptions are shown, not swallowed** — browser 46–49; M23.
11. **Neutral rescheduling does not inflate the postponement count** — browser
    18; M13.
12. **Project and Goal ancestry survive** — browser 13, 50, 52.
