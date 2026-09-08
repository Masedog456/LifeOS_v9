# LIFEOS-106 — The Day's Shape

Base `1b8ee3a` (LIFEOS-105 and the 104 follow-ups both merged). **No migration** — head stays 0047. No schema, no new state, no persistence.

---

## North star

> After LIFEOS-106, a user opening Today on a day already full of meetings will now see **how much of the day is actually spoken for and how much work is queued against it** — and be told when two commitments collide — because LifeOS does the arithmetic over start and end times it already recorded, instead of listing obligations without ever saying whether they fit.

---

## The audit

### What the loop looks like today

```
Capture → Interpretation → Clarification → Commitment → Planning
        → TODAY → Action → Resolution → Review → Memory → Guidance
```

The strongest part of that loop is **commitment → Today → resolution**. After 104 and 105 it is genuinely coherent: one projection decides Today (`buildTodayCommand`), one predicate decides whose move it is (`isOwnMoveNow`), one dependency index decides what is blocked, and every mutation offered on a row comes from one resolver. Nothing in this sprint's audit found a lifecycle state that leaks between surfaces.

The weakest part is **Today → realistic day**. Everything is displayed correctly and nothing is related to anything else.

### The five gaps, ranked

Scored 1–5; implementation risk and reviewability are scored so that **5 = low risk / easy to review**.

| # | Gap | Pain | Freq | Lifecycle | Leverage | Reuses data | Coherence | Low risk | Reviewable | **Σ** |
|---|---|---|---|---|---|---|---|---|---|---|
| **1** | **Day realism — Today has no denominator** | 5 | 5 | 4 | 4 | 5 | 5 | 4 | 5 | **37** |
| 2 | Surface consolidation (`/today` vs `/plan/today`, etc.) | 3 | 3 | 3 | 5 | 5 | 5 | 2 | 2 | 28 |
| 3 | Goal ↔ daily continuity for undated meaningful work | 4 | 4 | 4 | 3 | 5 | 4 | 3 | 4 | 31 |
| 4 | Memory/behaviour influencing the recommender | 3 | 4 | 4 | 4 | 5 | 3 | 2 | 3 | 28 |
| 5 | Review → tomorrow continuity (`tomorrowFocus`) | 2 | 2 | 3 | 3 | 4 | 4 | 4 | 4 | 26 |

### Why the four losers lost, briefly

- **Repeated deferral (brief's gap A) is already well served** and was not ranked as a gap. `repeatedlyPostponed` is consumed by attention, the decision inbox, weekly review, evening close, project context and goal context. LifeOS does notice. Classifying *why* someone avoids something would need model judgment over feelings the store does not record.
- **Gap 5 turned out to be mostly dead infrastructure.** `DailyReview.tomorrowFocus` has **no UI writer at all** — `addReviewFocus` exists in the store and is called by nothing — so real users have none. The one surface that reads it, `todayPlan`, has a genuine bug: its comment says "the most recent review whose target is today" and the loop has **no date filter**, so a focus item written on 2026-01-04 still lands in today's plan eight months later (measured). Worth fixing; too small and too invisible to be a sprint. Meanwhile the loop that *matters* — evening close proposes carry-forward → user resolves → canonical `dueDate`/assignment → tomorrow's Today reads it — is already closed properly through canonical state.
- **Gap 4** would make the single most consequential thing LifeOS says less explainable, against §8's "no invisible intelligence".
- **Gap 2** is real and worth doing, but it is a multi-PR deletion project, not one reviewable slice.

### The winning gap, measured

Journey E — the brief's overloaded day: four meetings, work due today, overdue work, a recurring routine, blocked work, waiting work, project actions, one meaningful non-urgent action.

```
ORIENTATION : "4 events · 1 timed commitment · 3 to fit in · 1 item needing attention"
FIXED       : 08:00 medication · 09:00 standup–09:30 · 11:00 review–12:30
              14:00 1:1–15:00 · 16:00 board–17:30
WORK        : 3 rows
```

The page says **"3 to fit in"** and never says what they have to fit into. 4h 30m of the day was already gone and nothing on the surface said so. A user can read every row correctly and still not know whether the day is possible.

And a second, sharper red found on the way: **LifeOS had no concept of a scheduling conflict anywhere in the codebase.** Two meetings booked over each other rendered as an ordinary schedule.

```
FIXED : 09:00 Team standup–09:30
        09:15 Client review–10:15     ← collides, and nothing says so
```

---

## Mini-spec

**Problem.** Today displays the day correctly and never describes its shape.
**Outcome.** The user can see what the day already holds before deciding what else to attempt.
**Trigger.** Opening Today on any day with at least one timed commitment.
**Inputs.** The `fixed` rows Today has already built — nothing else.
**Canonical state.** `LifeEvent.startTime`/`endTime`, `NextAction.dueTime`, via `EventOccurrence`. Unchanged.
**Derived state.** `DayShape` — committed minutes, span, gaps, conflicts, counts.
**Persistence.** None.
**Decision rules.** Pure interval arithmetic. No thresholds, no ranking, no comparator.
**AI involvement.** None.
**Provenance.** The line states its own inputs; a conflict note names the other commitment and the exact overlap.
**Failure states.** Nothing timed → no line at all. No durations → the duration clause is simply absent.
**Idempotency.** A pure function; asserted stable and non-mutating.
**Integration.** Today only.

### Explicit non-goals

- **No duration estimates for work.** `estimatedSize` is deliberately *not* converted into minutes. "medium" is not a number, the field is `unspecified` on most records, and a capacity figure assembled from guesses is a workload score wearing arithmetic's clothes — LIFEOS-037 refused exactly that and this keeps the refusal.
- **No verdict.** Never "too full", never "unrealistic", never a score or colour. Asserted.
- **No auto-scheduling or time-blocking.** LifeOS proposes nothing and moves nothing.
- **No new destination.** One line and a row note inside the existing BE THERE group.
- **No change to the recommender.** Not one line of ordering logic was touched.

---

## What it refuses to count, and why

| Record | Counted as a commitment | Contributes minutes |
|---|---|---|
| Event with start **and** end | yes | **yes** |
| Event with start only | yes | no — an instant has no extent |
| All-day event | no | no — it occupies no *part* of the day |
| Timed **action** (`dueTime`) | yes | **no** — a deadline is not a duration |
| Waiting action with a time | no | no — §12; not the person's commitment |
| Completed / cancelled | no | no |

A due time says *when it must be finished* and nothing about how long it takes. Counting it as occupied time would be the product inventing an appointment the user never made — the same rule §3 already applies when deciding what is "fixed".

**Overlapping time is counted once.** Busy intervals are merged before the total is taken, so a double-booked morning cannot inflate the figure. Two meetings of 30m and 60m overlapping by 15m are 75 minutes, not 90.

---

## User-facing behaviour

Above the BE THERE rows:

> 3h 30m committed between 9 AM and 5:30 PM · 5h unscheduled in between · 3 to place around it

On each colliding row:

> Overlaps Client review (15m).

Clauses with nothing to say are absent — a day with no measurable duration does not print "0m committed", and a day with nothing timed prints no line at all.

---

## Proof

| | |
| --- | --- |
| deterministic, **67 suites** | **6506/6506** (69 new: 106.1–106.69) |
| 106 browser | **26/26** (8 scenarios, desktop + mobile) |
| 104 browser · 105 browser | 79/79 · 68/68 |
| revert the overlap union → naive sum | **4 deterministic redden** |
| revert the suggestion add-back | **3 deterministic redden** |
| revert the rendering | **16 of 26 browser redden**; the 10 absence-assertions correctly stay green |
| 099 accessibility | 22/22 |
| release audit · route smoke · export verify | 17/17 · 25/25 · 14/14 |
| tsc · eslint | clean (2 pre-existing warnings, elsewhere) |
| migration head | **0047, unchanged** |

### Pre-existing failures — verified against `main`, not assumed

| Suite | On this branch | On clean `main` |
| --- | --- | --- |
| 084 Weekly review | 60/62 | **60/62 — identical** |
| 074 Reachability | crashes at C1–C3 | **crashes identically** |

074 and 084 were checked out and re-run on `main` with a fresh build. 082 (64/64) and 098 (34/34), which carried failures in earlier sprints, are green on both.

### Two latent test bugs fixed to get a green baseline

Neither is a product defect; both failed for the first time on 2026-09-08 against an unchanged `main`.

1. **105.48/105.49** pinned a review range to the fixture anchor while `stopWaiting` stamps history with the real clock — so a one-day range over 2026-09-07 could not contain an event written on 2026-09-08. That block now asks about the real today.
2. **104 browser scenario 31** assumed 08:00 was in the past. §24 lifts the suggestion out of the fixed rows, and the recommender prefers a timed action whose time is still ahead — so at 04:39 the record under test *became* the suggestion and the schedule was legitimately empty. The due time is now floored to the current hour.

---

## Self-review

| Question | Answer |
|---|---|
| Another source of truth? | No — a pure function over the rows Today already built; it never reads the store. |
| Another inbox or dashboard? | No — one line and a row note inside an existing group. |
| Duplicate recommendation logic? | No comparator, no ranking, no ordering anywhere in the module. |
| Could derived replace persisted? | It is entirely derived; nothing is persisted. |
| Can it be explained? | The line states its own inputs; a conflict names both sides and the exact overlap. |
| Can repeated runs duplicate? | Pure and asserted idempotent (106.46/47); pairs deduped (106.32). |
| Can inactive data leak? | Completed/cancelled excluded (106.58/59); waiting excluded (106.52–54). |
| Can a commitment disappear? | Nothing is filtered from any list — this only reads. |
| Recurrence handled? | A recurring timed responsibility counts, with no invented duration (106.60/61). |
| Today clearer or noisier? | One line; conflict notes appear only when a real collision exists. |
| More coherent loop? | It connects the time system to the work list, which nothing previously did. |
| Would deleting UI be better? | For gap 2, probably yes — recorded above as the next candidate, not attempted here. |

---

## Known limitations

- **Only events carry duration.** A day of undated work still reports no committed time — correctly, but it means the line is quiet exactly when the user is busiest with unscheduled work. Fixing that honestly needs duration data the product does not have and should not guess.
- **Gaps are measured *between* commitments only**, inside the span. Time before the first and after the last is not claimed, because LifeOS has no working-hours preference and inventing one would be a guess.
- **`todayPlan`'s tomorrow-focus leak is not fixed here** (found, measured, documented above) — it belongs to the planning surface, not to Today.
- **The conflict note does not offer a resolution.** It states the fact; rescheduling is reached through the row's existing controls.
