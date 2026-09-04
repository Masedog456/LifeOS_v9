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
