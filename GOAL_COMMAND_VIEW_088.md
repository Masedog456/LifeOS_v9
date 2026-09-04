# LIFEOS-088 — Goal Command View

**North star:** a Goal should show me where I'm headed, what is carrying it
forward, what is missing, and what I should do next.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `8ff599cac16ce3a4944f5c0749d36cdf867ca2f5` (PR #93 merged) |
| Branch | `claude/lifeos-088-goal-command-view` |
| Migration required | **no** — composition and UI (§40) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured, not read. A three-goal world was run through the real builders:

* **g1 "Open the clinic"** — horizon `medium`, target date 120 days out, three
  linked projects (one active, one completed, one abandoned), twelve linked
  actions including an overdue one, a blocked one, one blocked by an
  **already-completed** blocker, two waits (one follow-up today, one six days
  out), an action deferred three times, one action reaching the goal both
  directly and through a project, and a lifecycle history of
  created → horizon Near→Medium → Paused→Active.
* **g2 "Get properly fit"** — active, horizon `long`, **no project at all** and
  two directly-linked actions (one open, one completed four days ago).
* **g3 "Find a clinic to join"** — status `replaced`, `successorGoalId → g1`.

Fixture: `scratchpad/fx88.js`. Probes: `probe88.cjs`, `p88b/c/d/e.cjs`.

## 1.1 A — What the Goal page shows today

`/goal/[id]` is the one Goal page (§27 — there is no `/goal-dashboard`,
`/goal-command-center` or `/goal-intelligence`, and none will be created). It
composes `goalDashboard` (LIFEOS-031) and `GoalDirection` (LIFEOS-078).

On g1 — a goal carrying an overdue action, a blocked action, two waits, a triple
deferral and a perfectly good next action — the page renders:

```
Goal progress          "Not measured yet — no milestones or completed projects."
Projects               Clinic launch    0% · 0/0     ← eleven actions under it
                       Premises search  100% · 0/0
                       Franchise route  0% · 0/0     ← abandoned, still listed at 0%
Next milestones        (empty)
Linked knowledge       (empty)
Reading                (empty)
Recent captures        (empty)
Recent decisions       (empty)
Knowledge graph        (empty)
Session timeline       (empty)
How this is pursued    1 active project of 3 · 10 open actions
                       2 actions completed in the last 30 days
                       Last recorded activity 2026-09-04 · today
Direction              Find a clinic to join → Open the clinic
What has changed       Paused → Active · Horizon Near → Medium · Goal created
Lifecycle              Active
```

Six empty panels, four counts, and **not one of the actual commitments**. There
is no next action, no blocked row, no waiting row, no deferral count, no
attention, no target date, and nothing that says what moved this week.

`GoalDirection` (078) is the honest part and survives into the new view. The
LIFEOS-031 dashboard below it is knowledge-and-sessions furniture that the audit
found empty on a goal with twelve live commitments.

## 1.2 B — Schema. Goals carry more than Projects do

`Goal` (`types/mvp.ts:2291`) holds `horizon?`, `targetDate?`, `successorGoalId?`
and — unlike `Project` — a real **`history?: GoalHistoryEvent[]`**, appended by
LIFEOS-078 and never edited. So the limitation 087 had to state (§27 there:
"Conqify keeps no history of project changes") **does not apply here**. A goal
can say when its status changed, when its horizon moved, and what it became,
from stored evidence — and it must never fall back on `updatedAt` (§8), which a
title edit moves.

Measured on g1: `goal.history[]` yields three dated transitions;
`goal.updatedAt` yields one meaningless instant.

## 1.3 C — What the existing builders already know, goal-scoped

All of it exists. None of it reaches the Goal page.

```
commitment signals    overdue "Pay the deposit" · follow_up_due "Transcript from Maria"
                      goal_path_missing goal:g2
attention shortlist   overdue a2 · follow_up_due a7 · repeated_deferral a9 · goal_path_missing g2
executive changes     completed a1/a13 · deferred a9 ×3 · goal_status_changed g1
repeated deferral     ["Email professor", "You deferred this 3 times."]
blocked map           blockedActionIds = {a3}          ← and NOT a5 (blocker completed)
recommendNextAction   over g1's linked actions → "Pay the deposit"
                      over g2's linked actions → "Book a gym induction"
goalLinkedActions     dedupes a14, which names both the goal and its project
```

`recommendNextAction` is reused exactly as 087 reused it — **no second ranker**
(§15) — by narrowing the *state* to the goal's own actions while passing the
**full index**, so a blocker outside the goal still blocks.

## 1.4 The measured reds

### RED 1 (§14) — a goal with direct actions is told it has no path

`g2` is active, has one open directly-linked action, and
`recommendNextAction` names it. The product says:

```
goalPathMissing(state, g2)            true
goalsMissingPath(state)               ["Get properly fit"]
commitment signal                     goal_path_missing · "No active project is linked to this goal."
/goal/g2 renders                      "No active project is linked to this goal. Add a project"
memory "which goals have no path?"    "1 active goal has no active project linked to it."
```

The **wording** is already correct — §13's known limitation was fixed by
LIFEOS-078, which chose the literal `GOAL_PATH_MISSING = "No active project is
linked to this goal"` over "no path forward", and the memory answer even prints
the limitation out loud:

> "This looks at linked projects only. A goal whose work is tracked as
> directly-linked actions still appears here."

078 **stated** the gap; 088 **closes** it. §11 is explicit that direct
Goal-linked Actions are real Goal support and that not every Action must be
forced through a Project. So the new view derives a three-way path state — via
project, via direct actions, or genuinely none — and only the third is a
missing path.

`goalPathMissing` itself is **not** changed: it is literally true, Today depends
on it, and its own signal text makes exactly the claim it can prove. The command
view derives the richer state; the narrow signal keeps its narrow sentence.

### RED 2 (§38) — a fake percentage is still live on Goal detail

`goalProgress` is clean (see §1.5). The percentages on the Goal page come from
somewhere else: the Projects panel prints `projectProgress(p)` per row.

```
Clinic launch     0%   measurable=false   status=active     ← eleven actions under it
Premises search 100%   measurable=true    status=completed
Franchise route   0%   measurable=false   status=abandoned
```

A project with no milestones and no manual override returns `0`, which
`projectProgressMeasurable` already reports as **not a measurement**. The Goal
page ignores that and draws a bar at zero. This is the same fabrication
LIFEOS-078 removed from the goal's own number, surviving one level down: the
person looking at the work carrying their goal is told it is at 0%.

The command view replaces the percentage with what is actually known — open,
blocked, waiting and completed **counts** — and shows a percentage only where
`projectProgressMeasurable` is true.

### RED 3 — `Recently` cannot be scoped to a goal by entity

```
buildExecutiveChanges(state, range, {entity: {kind:"goal", id:"g1"}})
  → goal_status_changed "Open the clinic"          (1 row, the goal's own history)
```

Everything that actually happened under the goal — a completed action, three
deferrals — is invisible, exactly as 087 measured for projects. The new view
scopes by the goal's **linked actions and projects**, unioned with the goal's own
history events, not by `entity`.

### RED 4 — Memory's "what changed with <goal>?" is not goal-scoped

```
Q: "what changed with Open the clinic?"
   CHANGES · entityQuery "open clinic"
   → "You completed 2 items, changed direction on 2 goals, added 17 items…"
      Buy running shoes        ← this belongs to a DIFFERENT goal (g2)
      Sign the lease
      Find a clinic to join → Open the clinic
      Open the clinic  Near → Medium
```

The goal name resolves to nothing, the scope silently drops, and the answer
reports the whole store while appearing to answer about one goal. Same class of
defect 087 fixed for projects (`c.projectRef?.id`), by a different door.

### RED 5 — a goal cannot be found by typing its exact title

```
searchEverything(state, "Open the clinic")
  → total 0     filters {status:"open", consumed:["open"]}
```

"Open" is swallowed as a **status filter**; the residual "clinic" is then matched
only against records whose status is `open`, and goals are `active`. A person
typing their own goal's exact title gets nothing. `"Get properly fit"` and
`"Find a clinic to join"` both work, so this is specifically a title whose first
word collides with a status word — and LIFEOS-085 §7's rule that an exact title
hit must never be buried applies with more force when it is buried by a filter
the user did not ask for.

### RED 6 — horizon and target are not both shown, and neither is prominent

`goal.horizon` appears only as a `<select>`; `goal.targetDate` appears **nowhere
on the page at all**, though g1 carries one. §6 wants the horizon shown directly
and never inferred; §7 wants horizon and target treated as independent facts that
may both exist. Today the page shows one as a form control and drops the other.

### RED 7 — nothing on the page distinguishes waiting from blocked from open

`GoalDirection` says "10 open actions". Behind that number: two waits (one with a
follow-up that arrived today, one six days out), one genuinely blocked action,
one action deferred three times, one overdue. §20's rule — do not infer a goal is
"blocked" because one action is blocked while other executable work remains — is
un-testable today because the page has no notion of blocked at all.

### RED 8 — the successor is shown, but only as a lineage list

`Direction` renders `Find a clinic to join → Open the clinic`. On **g3** itself
`successorOf` returns g1 and the page shows the chain, which is right. What is
missing is the factual statement on the goal being *viewed*, with the recorded
date from `goal.history[].replaced` (`2026-07-26`) rather than `updatedAt`. No
UUID is printed anywhere today, and none will be (§9).

## 1.5 Not reds — verified, and kept as forward guards

These were audited because the brief named them, and each is already correct.
They become mutation targets rather than fixes.

* **§39 `goalProgress`.** Returns `null` on every fixture goal, including the one
  with a completed project alongside an unmeasurable one. LIFEOS-078's comment
  names both fabrications it removed. It is **safe where it is** and is **not
  used in the command view** — the view reports counts. No broad refactor.
* **§8 lifecycle evidence.** `goalChanges` reads `goal.history[]` exclusively;
  `answerGoals` uses `lastTransition` and explicitly degrades to
  "no transition date recorded" rather than reaching for `updatedAt`.
* **§10 completed blockers.** `blockedActionIds` = `{a3}` and excludes `a5`,
  whose blocker `a6` is completed.
* **§16 what counts as moved forward.** `answerGoals`'s `moved` aspect counts
  completed actions and completed projects only, and says so:
  "Editing a goal, changing its horizon or moving its target date is recorded,
  but is not progress."
* **§17 changed direction ≠ progress.** `goal_horizon_changed` and
  `goal_status_changed` are `changed direction` in the weekly review, never
  `moved forward`.
* **§9 no UUIDs.** `answerGoals`'s `replaced` aspect prints
  "the goal it became has since been deleted" rather than an id.
* **Duplicate links.** `goalLinkedActions` dedupes `a14`, which names both g1 and
  one of g1's projects. One commitment, counted once.

## 1.6 J — the smallest composition layer

Nothing needs to be built from scratch. The gap is that six existing builders
never meet on one page. `buildGoalContext(state, goalId, ix, today)` composes
them, adds no ranking, no score and no persistence, and is a pure function of its
arguments.

## 1.7 Migration (§40)

**None.** Every fact the view needs — horizon, target date, history, successor,
`Project.goalId`, `NextAction.goalId`, dependencies, deferral history — is
already stored. Migration head stays at **0047**. `0048` is not written.

---

# 2. The chosen surface (§27)

**`/goal/[id]`, and nothing else.** No `/goal-dashboard`, no
`/goal-command-center`, no `/goal-intelligence`. The route count is unchanged.

`GoalCommandView` sits above the LIFEOS-031 knowledge panels rather than
replacing them: the knowledge side is still true, it was simply never the answer
to "what is happening with this goal?".

`GoalDirection` (078) is folded in. Its lineage, its history and its counts now
live in the command view's Overview and Context, because printing them twice on
one screen told the reader nothing the first copy had not. Its one CONTROL — the
"Replaced by…" recorder — survives as `RecordReplacement`, moved next to the
other lifecycle controls in the header.

## 2.1 Five sections, and no sixth (§28)

```
WHERE THIS IS HEADED   horizon · target · counts · path · projects
NEXT AND SUPPORT       one recommendation, then everything else carrying it
STUCK AND WAITING      blocked rows, waiting rows
RECENTLY               moved forward · changed direction
CONTEXT                what has changed · replacement · people · rules
```

# 3. The composition model (§4)

`buildGoalContext(state, goalId, ix, today)` — pure, no persistence, no score.

## 3.1 The path (§11, §13, §14)

`goalPathState` lives in `lib/execution/alignment.ts`, beside `goalPathMissing`,
so the two questions stay distinguishable rather than drifting into a third
incompatible definition of "has a path":

```
project   at least one linked project is active
actions   no active project, but an action is linked STRAIGHT to the goal
none      neither — and NO_PATH names both checks
```

`goalPathMissing` is **unchanged**. It asks the narrower project-only question,
its sentence claims exactly that, Today depends on it, and it is still true.

An action reached only through a **paused** project is deliberately not a path:
that project's state is the user's own decision about it, and inventing a path
out of it would overclaim in the other direction.

`pathNote` is absent on a goal that is not `active` — a paused goal has no
active project by the user's own decision, and a replaced or achieved goal is
finished. That is `goalPathMissing`'s own rule, kept.

## 3.2 Horizon and target (§6, §7)

Both read straight from the record. Neither is ever derived from the other, and
nothing compares a target date against a horizon's guidance span. The target
prints **with the year** — a due date is days away and the weekday is the useful
part, but a goal's target is routinely months or years out.

## 3.3 Next action (§15)

`recommendNextAction` over the goal's own actions, with the **full index** so a
blocker outside the goal still blocks. No second ranker. The recommender's own
reasons are rendered verbatim.

## 3.4 Ownership precedence (§34)

```
NEXT      owns the recommendation
WAITING   owns any action whose status is `waiting`
BLOCKED   owns any action with an UNFINISHED blocker
SUPPORT   owns ordinary live work
ATTENTION attaches its reason to the row above; owns nothing
DEFERRAL  attaches a count to the row above; owns nothing
RECENTLY  excludes anything that currently owns a row
```

A completed action owns no row, so it still appears under Recently.

## 3.5 Movement is not direction (§16, §17)

`movement` is completed linked work, scoped by the goal's actions and projects.
`direction` is the goal's own recorded transitions. A horizon change, a status
edit, a new target date and a title edit are never movement. The completed
**count** is taken over the whole window, never over the capped display list.

## 3.6 Lifecycle (§8, §9)

From `goal.history[]` exclusively. `updatedAt` is never a lifecycle date — a
title edit moves it. A deleted successor is reported as deleted; no id is
printed anywhere.

## 3.7 Progress (§38, §39)

`goalProgress` is not used here at all. `projectProgress` reaches a row only when
`projectProgressMeasurable` is true. The page's own bar renders only when a
number exists. `0/0 projects` and `0/0 milestones` are gone — a zero denominator
measures nothing.

# 4. Memory and Search (§25, §26)

Three fixes, each closing a red:

* **`buildExecutiveChanges`** now scopes a `goal` entity to the goal's linked
  actions and projects as well as its own history.
* **`resolveEntities`** gains a last-resort pass where every word of the
  fragment must appear in the title, so the frame stripper's "open clinic"
  resolves to "Open the clinic". Word-level, unordered, two words minimum, and
  ambiguity still asks which record was meant.
* **`searchEverything`** retries the literal query when a consumed filter left
  the result empty, so a goal is findable by its exact title. Narrow by
  construction: a query whose filter works is untouched, and the filters
  reported back describe what was actually applied.

`answerGoals`'s `no_path` aspect answers the path question and names the goals
carried by directly-linked actions instead of listing them as pathless.

# 5. Migration (§40)

**None.** Head stays at **0047**. `0048` was not written.

# 6. Verification

| Gate | Result |
|---|---|
| Deterministic (52 suites) | **5,414 / 5,414** |
| LIFEOS-088 suite | **115** assertions |
| Mutation testing (§43) | **32 applied, 32 caught, 0 escaped** |
| Browser torture 088 (§42) | **83 / 83** (desktop + mobile) |
| Browser 078 / 079 / 081 / 082 / 083 | 97 / 97 / 72 / 64 / 77 |
| Browser 084 / 085 / 086 / 087 | 62 / 54 / 53 / 52 |
| Release audit | 17 / 17 |
| Export verify | 14 / 14 |
| Security audit | pass |
| Route smoke (production) | 24 / 24 |
| `tsc --noEmit` · `eslint` · `next build` | clean |

## 6.1 Seven mutations were the test's fault, not the product's

Every assertion passed on its first run, which is when a suite is least
trustworthy. Six mutations escaped and one crashed:

* **Four fixture gaps.** Nothing in the world had a goal whose only direct
  action was finished, an action blocked by a completed *and* a live blocker, a
  record reaching Recently with two same-kind events, or more history entries
  than the cap. A fixture that never exceeds a cap cannot test the cap.
* **One date collision.** `g3.updatedAt` fell on the same day as its replacement
  entry, so an assertion reading history could not be told apart from one
  reading `updatedAt`.
* **One assertion that THREW** rather than failing, because it dereferenced
  `c.waiting.find(...)!`. The harness cannot tell a crash from a pass.
* **One mutation that was a semantic no-op** — relaxing the token fallback's
  minimum length reproduces a pass that already ran. Replaced with
  `every()` → `some()`, which does change behaviour.

## 6.2 What the visual review found (§44)

Six defects the deterministic and browser suites both missed, and every one was
a thing said twice or a number that measures nothing:

1. The horizon guidance printed under the header **and** inside Overview.
2. "Not measured yet…" led the page, above the counts that ARE known.
3. `0/0 projects` and `0/0 milestones` — zero-denominator counts.
4. A goal with nothing carrying it said so in Overview and again, in different
   words, in a second card underneath.
5. `Active  Replaced by…` floated unlabelled between two cards.
6. A goal's target date printed as "Sat, Jan 2" — no year.

## 6.3 Two prior-sprint guards had stopped guarding

Running 078's browser suite against this page failed 18 assertions. All pointed
at markup 088 replaced — but two had become vacuous rather than failing:

* 078 proves goal history is append-only by re-selecting the same horizon and
  asserting a count attribute did not move. 088 had reused that attribute name
  on every row **with no value**, so the proof compared `""` with `""`. The
  count is back on the container; rows carry `data-goal-history-row`.
* 7.3's title-edit guard read the same attribute, with the same result.

The rest were repointed to the behaviour that replaced theirs, and two new
assertions were added where the replacement claims more than the original did.

# 7. Limitations, stated

* **A paused project's open actions are not a path.** Deliberate, and the
  `NO_PATH` sentence names the two checks it made so the reader can see which
  applied.
* **"Last recorded activity" is gone.** It was the newest `updatedAt` across a
  goal's projects and actions, so a project title edit moved it. Recently
  answers the same question from dated transitions in a named window.
* **People are still plain strings.** "Marcus" and "Marcus Webb" remain two
  references; the longer form travels with the shorter as unresolved ambiguity.
  There is no identity model, and none is faked.
* **A goal created before LIFEOS-078** has no history, and the page says nothing
  about when it changed rather than dating it from `updatedAt`.
* **`goalProgress` still exists** and is still used on the goals index and in
  the header's manual-override bar. It returns `null` rather than fabricating,
  which the audit verified; it was not refactored, per §39.

# 8. Product claims (§49)

1. A goal shows its horizon and its target date as two independent facts, both
   read from the record, neither derived from the other.
2. A goal carried by actions linked directly to it is described as carried, not
   as missing a path — and the recommender names its next step.
3. A goal with nothing carrying it says which two checks came back empty, and
   offers a project without performing it.
4. No project is drawn at 0% because it has nothing countable.
5. There is no goal health, momentum, alignment, risk or progress score.
6. One action occupies exactly one row; attention and deferral attach to it.
7. A completed blocker is never named as holding anything up.
8. A follow-up dated in the future does not read as due, and no wait is ever
   called too long.
9. The goal is never called blocked because one action is, while other
   executable work remains.
10. What moved forward is completed linked work; a horizon change, a status edit
    and a new target date are direction, and are labelled as such.
11. Every lifecycle date comes from the append-only history, never `updatedAt`,
    and a deleted successor is reported as deleted rather than as an id.
12. Asking Memory what changed with a goal returns that goal's work, and
    searching a goal's exact title finds it.
