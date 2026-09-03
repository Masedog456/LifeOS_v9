# LIFEOS-081 — Executive Memory / What Changed?

**North star:** Conqify should remember the arc of my life, not just the current
state.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `6d831314ffb359d5a26d0b1b96f2cb40e17dd8b5` (PR #86 merged) |
| Branch | `claude/lifeos-081-executive-memory-what-changed` |
| Migration required | **no** — see §1.11 |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Produced by **running the answer builders**, not by reading them. A one-week
fixture — a goal whose horizon moved, an action completed, one deferred three
times, one wait ended, a weekly recurring action, an action created and
completed in the same minute, a standard adopted, a standard retired, a
user-written reflection and an AI-written note — through `answerMemoryQuery`.

## 1.1 A — Which domains have real change history?

Six, and they are good:

| Domain | Where | What it records |
|---|---|---|
| **NextAction** | `action.history[]` | created · completed · cancelled · deferred · returned · restored · waiting · `edited` with `fromStatus`/`toStatus` · `due_set` · `due_cleared` · `unblocked` |
| **Goal** | `goal.history[]` (078) | created · status · horizon · replaced · target_date, each with `from`/`to` |
| **ConstitutionElement** | `constitutionRevisions[]` | created · adopted · edited · revised · relinked · retired, with `previousStatement`/`newStatement`/`successorId` |
| **PlanningAssignment** | `assignment.history[]` | planned · moved, with `toHorizon` |
| **Recurring work** | `recurrenceCompletions[]` | one row per kept occurrence — the row *is* the fact |
| **Capture** | `capture.history[]` | convert / process transitions |

## 1.2 B — Which only expose current state?

| Domain | What exists | Consequence |
|---|---|---|
| **Project** | `createdAt`, `updatedAt`, `status` | no lifecycle history at all |
| **Protocol** | `createdAt`, `updatedAt`, `status` | the LIFEOS-079 limitation, unchanged |
| **LifeEvent** | `date`, `recurrence` | already stated as `EVENT_HISTORY_LIMITATION` |
| **Note** | `createdAt`, `updatedAt` | no edit log |

## 1.3 C / D — What can and cannot be reconstructed

**Safely reconstructable:** every action transition in the table above; goal
creation, status, horizon, target-date and replacement; standard adoption,
revision and retirement; planning moves; recurring occurrences kept.

**Not reconstructable, and must stay stated rather than guessed:** project
lifecycle dates, protocol lifecycle dates, event reschedules, note edits, and
*"became unblocked"* — `removeActionDependency` writes `unblocked` for every
edge removal whether or not other blockers remain, and completing a blocker
writes nothing on the dependent. LIFEOS-073 already named that honestly as
`prerequisite_removed` and it stays that way.

## 1.4 E — Where does Memory misuse `updatedAt`?

**On the CHANGES path, it does not.** This is worth reporting plainly rather
than manufacturing a defect: `buildAutobiographicalTimeline` is scrupulous, and
says so in its own source — *"`createdAt`, never `updatedAt`. An old note edited
this week is not a new reflection."* Deferrals read `history[].deferred`, not
`deferredUntil`; completions read `completedAt` and re-check that a reopened
action no longer counts; occurrence completions read the completion **row**, not
the keystroke.

There is one real instance elsewhere: **`lib/memory/timeline.ts`** — the `/timeline`
Life surface, not the CHANGES path — presents `decision.updatedAt` as *"Decision
made"* and `synthesis.updatedAt` as *"Synthesis accepted"*. That is the §4
pattern exactly. It is a different surface with its own consumers, so this
sprint reports it rather than rewriting it.

## 1.5 F — Where does "changed" mean merely "edited"?

Nowhere on the CHANGES path. Every kind the timeline emits traces to a recorded
transition. The gap is the opposite of the one §4 anticipated: **not that edits
are counted as changes, but that real changes are dropped.**

## 1.6 G — What can Week Review answer that Memory cannot?

Two things, and both are the same defect.

**Same-day dedup.** `buildRangeReview` carries this line:

```ts
if (e.kind === "action_created" && completedSameDay.has(`${e.recordRef.id}:${e.day}`)) return false;
```

`answerChanges` has no equivalent. It carries only the `waitStarted` dedup. So
an action created and completed in the same minute is reported twice by Memory
and once by Week Review — **the convention already exists and is simply not
shared** (§23).

**Daily Review is better than Memory at Memory's own question.**
`lib/today/daily.ts` defines `CHANGE_KINDS` with **13 kinds** and a full
`CHANGE_LABEL` map. `lib/memory/answer.ts` defines `CHANGE_GROUPS` covering
**9**. Six kinds the timeline already produces are consumed by Daily Review and
silently dropped by Memory:

```
action_returned · action_restored · waiting_stopped
action_due_cleared · action_planned · prerequisite_removed
```

## 1.7 H — Duplicate definitions of "changed"

**Three**, none aware of the others:

| Definition | Where | Coverage |
|---|---|---|
| `CHANGE_KINDS` + `CHANGE_LABEL` | `lib/today/daily.ts` | 13 kinds, labelled |
| `CHANGE_GROUPS` | `lib/memory/answer.ts` | 9 kinds, grouped, no same-day dedup |
| section filters | `lib/memory/week.ts` | its own filters **plus** the same-day dedup |

And **none of the three covers Goals or Personal Code at all.**
`buildAutobiographicalTimeline` contains no reference to `state.goals` and none
to `constitutionRevisions`. LIFEOS-078 shipped `Goal.history` and nothing on the
"what changed?" path has ever read it.

## 1.8 I — What returns incomplete or misleading answers today

Measured. Every line below is real output from the current build.

**RED 1 — "What changed this week?" drops recorded changes and double-counts.**

The timeline produced `waiting_stopped ×1` and `action_returned ×2`. The answer
mentions none of them. It also reports:

```
"You completed 3 items, added 4 items, started waiting on 1 item,
 deferred 3 items and wrote 2 notes and reflections."

  You added     "Submit UH application"   action.createdAt
  You completed "Submit UH application"   action.completedAt
  You added     "Email the department"    action.createdAt
  You completed "Email the department"    action.completedAt
```

Two actions, four lines. And the goal whose horizon moved `near → medium` that
same week does not appear at all.

**RED 2 — "What do I keep putting off?" does not route.** `planMemoryQuery`
returns `null`; the answer is *"Conqify can't answer that one."* The three
recorded deferrals of "Call admissions" sit in `history[]` unread. Same for
**"What did I defer this week?"** — also `null`.

**RED 3 — "What rules changed this week?" answers a different question.** It
routes to `RULES` and returns the *current* code — *"2 rules in force — 1
always, 1 when/then"* — while a standard adopted on Sep 2 and one retired on
Sep 3 sit in `constitutionRevisions` unread. The Protocol limitation line is
correctly present; the grounded Standard history it should sit beside is not.

**RED 4 — "What did I say mattered this week?" searches for the word.** It
routes to `REFLECTION` with `entityQuery: "mattered"` and looks for records
containing *"mattered"*. The user's actual reflection — *"I think I care more
about philosophy than teaching"* — does not contain it, so the answer is
`NO_RECORDED_EVIDENCE`.

**RED 5 — entity-scoped change is ignored.** *"What changed with my graduate
school goal?"* routes to `CHANGES` and **does extract** `entityQuery: "graduate
school goal"` — then `answerChanges` never reads it. The output is byte-identical
to the un-scoped answer, and the range silently widens to *"the last 12 months"*.
Two goals match "graduate school"; there is no `NEEDS_CHOICE`.

**RED 6 — historical vs current waiting are confused (§12).** *"What did I stop
waiting on this week?"* routes to `WAITING`, which answers current state:
*"Not waiting on anything."* The wait that ended on Sep 2 is in the timeline as
`waiting_stopped` and is never reached.

**RED 7 is not a red case.** Nothing today mislabels a weekly recurring action as
repeated postponement, because nothing today detects repeated postponement at
all. It is a **forward guard** on the new feature, not a defect of the old one.

## 1.9 J — The smallest shared change model

Not an event store. The evidence is already there and already correct — what is
missing is one place that reads all of it.

1. **One builder, `buildExecutiveChanges(state, range, opts)`**, derived and
   pure, producing a typed `ExecutiveChange`. It composes
   `buildAutobiographicalTimeline` for everything that already works and adds
   the two domains nothing reads: **Goals** (`goal.history[]`) and **Personal
   Code** (`constitutionRevisions[]`).
2. **One dedup**, promoting Week Review's same-day rule to the shared layer so
   Memory stops double-counting.
3. **Repeated deferral** derived from recorded `deferred`/`returned`/planning
   moves at distinct timestamps — never from an old due date, and never for
   recurring work.
4. **Router work**: teach `CHANGES` the deferral, postponement, rule-change and
   stopped-waiting phrasings; honour `entityQuery`; return `NEEDS_CHOICE` on
   ambiguity.
5. **Reflection by range, not by keyword**, for "what did I say mattered",
   restricted to user-authored provenance.

## 1.10 Ordering constraint

The guards go in with the feature, not after. Repeated postponement is the one
new derivation that can defame someone's record — calling a weekly recurring
commitment "something you keep putting off" is both false and unkind — so the
recurrence exclusion and the neutral wording ship in the same commit as the
count.

## 1.11 Migration (§30)

**None is required, and none will be written.**

Every question in the north star is answerable from evidence already persisted:

| Question | Evidence |
|---|---|
| What changed this week? | action/goal/planning history, revisions, completion rows |
| What changed about this Goal? | `goal.history[]` — 0047, live |
| What do I keep putting off? | `action.history[].deferred` / `.returned` |
| What did I stop waiting on? | `action.history[].edited` with `fromStatus: "waiting"` |
| What standards changed? | `constitutionRevisions[]` |
| What did I say mattered? | `reflection.createdAt` + provenance |

The two things that genuinely cannot be answered — **project lifecycle history**
and **protocol lifecycle history** — are the same two LIFEOS-064 and LIFEOS-079
already declared, and §16 forbids opening 0048 for the second. Both stay stated
limitations. Neither is worth schema work on this sprint's evidence, because
neither is a north-star question: the arc of a life is carried by its goals,
actions and commitments, all of which have history.

`DOMAIN_CAPABILITY_REQUIREMENTS` untouched, `CLIENT_CONTRACT` stays at 3,
migration head stays at **0047**.

---

*Sections 2 onward are written as the implementation lands.*
