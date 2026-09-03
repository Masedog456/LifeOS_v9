# LIFEOS-081 — Executive Memory / What Changed?

**North star:** Conqify should remember the arc of my life, not just the current
state.

## STATUS: COMPLETE — EXECUTIVE MEMORY READY

| | |
|---|---|
| Base SHA | `6d831314ffb359d5a26d0b1b96f2cb40e17dd8b5` (PR #86 merged) |
| Branch | `claude/lifeos-081-executive-memory-what-changed` |
| Migration | **none** — see §1.11 |
| Repository migration head | **0047**, unchanged |
| New persistence | **none** — no event store, no table, no domain |

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

# 2. What was built

| Concern | Where |
|---|---|
| The one derivation | `lib/memory/changes.ts` |
| Repeated postponement | `lib/memory/changes.ts` (`repeatedlyPostponed`) |
| Routing — six change aspects | `lib/memory/query.ts` (`ChangeAspect`) |
| The answer, in sections | `lib/memory/answer.ts` (`answerChanges`) |
| Reflections by range | `lib/memory/answer.ts` (`answerReflection`) |

**No new UI.** `AskMemory` renders the new answers through the surface it
already had. **Today ranking untouched** — no file under `lib/today/` changed.

## 2.1 The change taxonomy actually implemented

24 kinds, each named for the field behind it. §5's list minus everything that
could not be grounded:

| Group | Kinds |
|---|---|
| Actions | `created` `completed` `recurring_completed` `cancelled` `deferred` `returned` `restored` `rescheduled` `due_cleared` `planned` `prerequisite_removed` `waiting_started` `waiting_ended` |
| Goals | `goal_created` `goal_status_changed` `goal_horizon_changed` `goal_target_changed` `goal_replaced` |
| Personal Code | `rule_adopted` `rule_revised` `rule_retired` |
| Words & calendar | `reflection_added` `note_added` `capture_added` `decision_recorded` `event_scheduled` |

**Not implemented, because nothing records them:** `BLOCKED`, `UNBLOCKED`,
`EVENT_RESCHEDULED`, and any project lifecycle kind. `removeActionDependency`
writes `unblocked` for every edge removal whether or not other blockers remain,
and completing a blocker writes nothing on the dependent — so the honest kind is
`prerequisite_removed`, which is what LIFEOS-073 already called it.

## 2.2 Three rules do the work

**An edit is not a change.** A `created`, `edited` or `relinked` revision
produces nothing; only `adopted`, `revised` and `retired` do — the schema
already separates a wording correction from a change of position, and this
respects that line. A goal with no `history[]` contributes nothing rather than
contributing its `createdAt`: a record written before LIFEOS-078 genuinely has
no recorded transition, and dating one from when a row appeared would put a date
on a life decision that nobody made that day.

**Direction is not progress.** `MOVED_FORWARD_KINDS` holds completions and
nothing else. `DIRECTION_KINDS` holds the goal transitions. The two sets are
asserted never to overlap (81.15), and moving `goal_horizon_changed` into the
first turns four assertions red.

**Recurring work is never postponement.** A weekly commitment pushed a day
generates a deferral like any other, and counting it would tell someone their
standing routine is a personal failing. The exclusion is `readRule(a.recurrence)`
— a filter on the record, not a heuristic — and the answer states that the
exclusion exists rather than leaving the person to wonder why an item is missing.

## 2.3 Source priority (§8)

```
1. explicit lifecycle/history event   action.history[] · goal.history[]
2. explicit completion record         recurrenceCompletions[]
3. revision record                    constitutionRevisions[]
4. creation timestamp                 createdAt
```

`updatedAt` is not on the list. Asserted by sweep (81.16): no change anywhere
traces to it.

## 2.4 Dedup and precedence (§23)

Two rules, and the second is the one Memory was missing:

1. Same kind, same record, same day → one.
2. **Created AND completed on the same day → the completion only.**
   `buildRangeReview` has applied this since LIFEOS-064 and `answerChanges`
   never did, so Memory reported an action created and completed in one minute
   as two lines while Week Review reported it as one. Promoted to the shared
   layer so both read the same rule rather than one remembering it.

Created one day and completed the next stays **two** changes — two real days,
two real facts (81.24).

## 2.5 Repeated-deferral semantics (§14)

- Counted from `action.history[].deferred` at **distinct instants**. Never from
  `deferredUntil`, never from an old due date — a task whose date passed was
  missed, which is a different fact with a different feeling attached.
- Recurring work excluded (§15).
- Threshold 2.
- The output is a count and the instants behind it. The wording is §21's
  verbatim: **"You deferred this 3 times."** There is no vocabulary in the
  module for avoidance, resistance or fear.

## 2.6 Reflection provenance (§17)

*"What did I say mattered this week?"* was searching for the literal word
"mattered". A small closed list of **topicless terms** now means "no topic — use
the range", and the heading and summary stop claiming a topic that was never
asked about.

The provenance boundary is untouched and is what makes the answer safe: the
authored/machine split already in `answerReflection` does the work, so an
AI-written note in the same range is listed with the attribution that is true of
it and never inside a "You said". Asserted deterministically (81.94–81.96) and
structurally in the browser (6.3, 6.4).

## 2.7 Goal changes (§9)

Created · status · horizon · target date · replaced — each from `goal.history[]`,
each carrying `from` → `to` where the record holds both, so *"Near → Medium"* is
the content of the line rather than a bare title.

A replacement pointing at a deleted goal degrades to *"a goal you later
deleted"*. No id is ever printed (§26, asserted at 81.21).

## 2.8 Personal Code limitations (§16)

Unconditional standards have `ConstitutionRevision` history and their changes are
dated. **Conditional Protocols have no history at all**, so their change dates do
not exist, `updatedAt` is not offered as a substitute, and 0048 was not opened.
Every rules answer carries `PROTOCOL_CHANGE_LIMITATION` whether or not it found
anything, because the absence of when/then history is the reason the answer may
look short.

A `value` or `purpose` element changing is a Constitution change, not a Personal
Code change, and is excluded (81.17).

## 2.9 Week Review reuse (§27)

**Deliberately partial, and this is the honest account.**

What was unified: the same-day dedup, by *promotion* — Memory adopted Week
Review's rule into the shared layer.

What was not: `buildRangeReview` still derives its own sections from
`AutobiographicalEvent` rather than consuming `ExecutiveChange`. Rewiring it
would be the wholesale rewrite §27 warns against — 101 week-review assertions and
128 daily-review assertions sit on that shape — and the duplication that actually
hurt the user (Memory lacking a rule Week Review had) is gone. `daily.ts`'s
`CHANGE_KINDS` likewise still stands; it and the new builder now agree on the 13
action kinds, but they are not yet one list.

So there are two definitions of "changed" where there were three, and the two
that remain no longer disagree about any action. Stated rather than smoothed.

---

# 3. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `npm run build` | clean · 0 errors · exit 0 |
| Deterministic selftests | **4668/4668** across 45 suites |
| …of which new this sprint | **114** (`lib/memory/changes-selftest.ts`) |
| `scripts/smoke-081-executive-memory.cjs` (browser, 2 viewports) | **72/72** |
| `smoke-080-capture-intelligence.cjs` · `smoke-079-personal-code.cjs` | 109/109 · 97/97 |
| `smoke-078-goal-horizons.cjs` · `smoke-076-sync-trust.cjs` | 93/93 · 281/281 |
| `inject-077-schema-compatibility.cjs` · `inject-078-goal-capability.cjs` | 51/51 · 43/43 |
| `release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

Migration rehearsal was not re-run: no schema was touched.

### Performance (§29)

Asserted with budgets in the suite, over a bounded week:

| Size | changes + postponement |
|---|---|
| 100 entities | under 2500ms |
| 1,000 entities | under 2500ms |
| 5,000 entities | under 2500ms |
| 50 entity-scoped builds over 500 goals | under 2000ms |

Indexes are built once per call (`lookups`), not once per entry, and the goal and
rule passes test each entry against the same millisecond bounds rather than
re-resolving the range.

## 3.1 Mutation testing (§33)

Ten mutations aimed at the load-bearing rules. **Nine were caught immediately.
The tenth is the one that mattered.**

> **M1 — dating a goal transition from `updatedAt` instead of its history
> entry: GREEN.**

The sprint's central rule was unguarded. The fixture's `updatedAt` happened to
sit inside the range and no assertion pinned the horizon change to its recorded
day, so swapping the field changed nothing any test could see. The fixture now
gives the goal a title edit *today* and a horizon move *two days ago* — the dates
disagree, so only one of them can be right — and four assertions cover it
(81.6b–81.6e). M1 now turns two red.

The nine caught first time: recurring work counted as postponement, the same-day
dedup removed, a horizon change counted as progress, a deleted rule let through
with no wording, range bounds broken, current wording attributed to an old
revision, a topicless question turned back into a keyword search, an ambiguous
entity silently picked, and a return counted as a deferral.

## 3.2 Two defects the tests found, and one harness bug

- **A regression I introduced.** The first rules signal matched any rule noun
  beside any lifecycle verb, and stole *"Which standards have I retired?"* and
  *"When did I change my rule about sleep?"* from the RULES class — turning the
  079 suite red, including the assertion that guards the Protocol limitation.
  The signal is now narrow: rules as the SUBJECT of "changed", question opening
  with "what".
- **A fixture bug the assertion caught.** The recurring action was written with
  `daysOfWeek` instead of `weekdays`, so `readRule` rejected it and the §15
  guard silently did not apply. The negative assertion is what exposed it.
- **A harness bug.** Browser 6.3 sliced the answer's text on the words "You
  said" to check no AI text fell inside — which cannot work, because each card
  renders a record's text *before* its attribution label. The product was
  correct; the assertion now reads each row's own attribution element.

---

# 4. Product claims (§36)

1. **"What changed?" uses historical evidence** — 81.16 sweeps every change for
   an `updatedAt` trace; 81.6b–81.6e pin a transition to its recorded day.
2. **Meaningful changes are distinguishable from edits** — 81.10, 81.11.
3. **Repeated postponement requires repeated recorded deferral** — 81.33–81.36,
   81.39.
4. **Recurring work is not mislabelled** — 81.37, browser 3.4, 3.5.
5. **Goal progress stays grounded in completed work** — 81.13–81.15, 81.90,
   browser 2.4, 2.5.
6. **Personal Code changes are grounded** — 81.68–81.71, browser 5.1, 5.2.
7. **The Protocol limitation remains explicit** — 81.72, browser 5.3, 5.4.
8. **"You said" remains restricted by provenance** — 81.94–81.96, browser 6.3,
   6.4.
9. **Entity-scoped queries resolve safely** — 81.85–81.89, browser 7.1–7.3.
10. **No event-store infrastructure was added** — no migration, no domain, no
    table; `buildExecutiveChanges` is a pure function of `(state, range)`.

---

# 5. Known gaps

- **Project lifecycle history does not exist.** `Project` carries `createdAt`,
  `updatedAt` and a current `status`, and nothing else — so there is no
  `project_completed` kind and no project status transition anywhere in the
  taxonomy. This is LIFEOS-064's limitation, unchanged, and it is why §10's
  potential list is mostly unimplemented.
- **Protocol change dates do not exist.** Stated in every rules answer.
- **Event reschedules are invisible.** `EVENT_HISTORY_LIMITATION`, unchanged.
- **Week Review still derives its own sections** (§2.9). Two definitions of
  "changed" where there were three.
- **`lib/memory/timeline.ts` still presents `decision.updatedAt` as "Decision
  made"** on the `/timeline` surface. Found by this audit, reported, and left
  alone: it is a different surface with its own consumers and is not on the
  CHANGES path.
- **"What keeps coming back?" is answered as repeated deferral.** §15's other
  candidates — repeated follow-up due, repeated planning without completion —
  are not implemented, because distinguishing them from ordinary recurring work
  needs evidence this sprint did not establish.

---

# 6. Verdict

**LIFEOS-081 COMPLETE — EXECUTIVE MEMORY READY.**

No migration. Repository migration head unchanged at **0047**. All final gates
green.

Nothing in §38's stop list was begun: no 0048, no Collections, People or
Calendar expansion, no D-8, no general D-23, no Observatory, no psychological
pattern inference, no autonomous journaling, no ambient capture.
