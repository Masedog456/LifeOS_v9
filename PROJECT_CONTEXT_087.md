# LIFEOS-087 — Projects as Living Context

**North star:** a Project should tell me what it is, why it matters, what's
moving, what's stuck, and what happens next.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `00f4fc655ba9391c90ee8cd02dec76ec330ef8e5` (PR #92 merged) |
| Branch | `claude/lifeos-087-projects-living-context` |
| Migration required | **no** — composition and UI |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured by running a realistic project through the real builders: a Project
linked to a Goal, with a completed action, an overdue action, a blocked action,
an action blocked by an **already-completed** blocker, two waits (one follow-up
today, one six days out), an action deferred three times, two Marcuses, and a
Rule naming one of them.

## 1.1 A — What the Project page shows today

`projectDashboard` returns `{project, progress, milestones, workspace, goal,
overview, sessions, recentEntities, recentDocuments, reading}`. On the fixture:

```
progress: 0        milestones: 0        recentEntities: 0
reading:  0        documents: 0         sessions: {today:0, yesterday:0, thisWeek:0, older:0}
```

**Every panel is empty** on a project with eleven actions, an overdue item, a
blocker, two waits and a repeated deferral. The page was built for knowledge and
sessions (LIFEOS-031), and the work lives somewhere else entirely.

The one action surface, `ProjectActions`, renders count chips and a flat list of
**all eleven actions, completed ones included**:

```
open:7  inProgress:0  waiting:2  completed:2  blocked:1
["completed","Sign the lease"], ["open","Pay the deposit"], ["open","Send final draft"],
["open","Need legal review"], ["open","Order signage"], ["completed","Confirm branding"], …
```

No next action, no blocked/waiting distinction beyond a number, no attention, no
deferral count.

## 1.2 C — What existing builders already know, project-scoped

All of it exists and none of it reaches the page:

```
commitment signals   overdue "Pay the deposit" · follow_up_due "Transcript from Maria"
attention shortlist  overdue · follow_up_due · repeated_deferral "Email professor"
executive changes    completed "Sign the lease" · deferred ×3 · goal_horizon_changed
repeated deferral    ["Email professor", 3]
blocked map          ["a3"]        ← and NOT a5, whose blocker is completed
next action          "Pay the deposit · Supports Open the clinic through Clinic launch"
```

## 1.3 D / E — Project lifecycle history does not exist

```
Project has a `history` field?  false
project.updatedAt = 2026-09-04T11:00:00.000Z   ← the only date available
```

Goals carry `history`; Projects carry nothing but `updatedAt`. So **"when did
this Project become active?" is unanswerable**, and `updatedAt` must not be
pressed into service as a lifecycle event (§27).

## 1.4 The measured reds

### RED 1 — "What changed with Clinic launch?" reports nothing changed

```
plan = CHANGES [projectRef]      status = NO_RECORDED_EVIDENCE
"Conqify recorded no change to Clinic launch in that period."
```

In the same week the project completed an action, deferred one three times, and
had its Goal's horizon moved. The entity scope filters to changes whose entity
**is** the project — and a project has no history, so there are none. The
project's *actions* changed, and nothing reads them that way.

### RED 2 — "What am I waiting on for Clinic launch?" — a regression I introduced

```
plan = WAITING [projectRef]      status = NO_RECORDED_EVIDENCE
"No action is marked as waiting on clinic launch."
```

The project has **two** waiting actions. LIFEOS-086 scoped `answerWaiting` by
`plan.personName ?? plan.entityQuery` to fix a person-scoping bug; for a
**project** question `entityQuery` is `"clinic launch"`, so it now searches
`waitingOn` for that text and finds nothing. Before 086 the same question
returned every wait in the store — also wrong, but this replaced one wrong
answer with a worse sentence. `personName` alone should scope by person; a
`projectRef` should scope by project.

### RED 3 — "What is blocked on Clinic launch?" routes to WAITING

Blocked and waiting are different states with different evidence — a dependency
versus a `waitingOn` — and the router conflates them.

### RED 4 — two questions do not route at all

```
"Who is involved in Clinic launch?"            → plan NONE
"What keeps getting deferred on Clinic launch?" → plan NONE
```

Both name evidence that exists (§12, §15).

## 1.5 Not reds — verified, kept as forward guards

- **Next action already works project-scoped** and already explains its
  ancestry: *"Pay the deposit · Supports Open the clinic through Clinic
  launch."* §8's reuse is available as-is.
- **A completed blocker already does not block.** `blockedActionIds` holds `a3`
  and not `a5`, whose blocker is completed (§10).
- **Goal ancestry resolves from `Project.goalId`** — no lexical inference
  anywhere (§6).
- **Search already opens the real Project** and offers one-hop actions (§18).
- **Follow-up timing is already factual** — the six-days-out wait does not fire
  `follow_up_due` (§11).

## 1.6 J — the smallest composition layer

1. **`lib/execution/context.ts`** — one pure `buildProjectContext(state,
   projectId, ix, today)` composing what already exists, project-scoped, with
   ownership precedence so one action cannot appear in five sections.
2. **Fix `answerWaiting`'s scoping** (RED 2) — person by `personName`, project
   by `projectRef`.
3. **Project-scoped changes** read from the project's actions, not from the
   project record (RED 1).
4. **Route the two unrouted questions** through existing classes (RED 4).
5. **Rewrite the Project page's work-facing half** into §20's five sections,
   keeping the existing knowledge panels below.

## 1.7 Migration (§36)

**None.** Every fact above is derivable from existing records. Project lifecycle
history genuinely does not exist — and §27 directs stating that limitation
rather than fabricating dates from `updatedAt`, which is what this does.

---


# 2. The chosen surface (§19)

**The existing `/project/[id]`, improved in place.** No `/project-dashboard`,
`/project-command-center` or `/project-intelligence`.

`ProjectWorkingState` sits **above** the LIFEOS-031 knowledge panels rather than
replacing them. Those answer a different question — milestones, reading,
related work, sessions — and are still true; they were simply never the answer
to *"what is happening with this project?"*.

# 3. The composition model (§4)

`lib/execution/context.ts` — one pure `buildProjectContext(state, projectId, ix,
today)`. It adds **no ranking algorithm**: the recommendation is
`recommendNextAction` run over the project's own actions.

| Field | Composed from | Sprint |
|---|---|---|
| `goal` | `Project.goalId` | 031 |
| `next` | `recommendNextAction` | 072 |
| `openRows` / `blocked` / `waiting` | one ownership pass over the project's actions | 087 |
| `attention` (attached) | `buildCommitmentSignals` | 070 |
| `deferral` (attached) | `repeatedlyPostponed` | 081 |
| `recent` | `buildExecutiveChanges`, project-scoped | 081 |
| `people` | LIFEOS-086's `personHint` / `longerForms` | 086 |
| `rules` | `buildAttentionShortlist().ruleContext` | 082 |

## 3.1 Goal ancestry (§6)

`Project.goalId` only. A goal whose title resembles the project is asserted
**never** to be adopted.

## 3.2 Next action (§8)

The state is narrowed to the project's actions; the **index is the full one**,
so an action blocked by a blocker in another project is still correctly
excluded. Passing a narrowed index would have quietly unblocked it — asserted.

## 3.3 Blocked and waiting (§10, §11)

Blocked reads `blockedActionIds`, which already excludes an action whose blocker
is completed; the blocker **named** is the unfinished one. Waiting reuses the
existing semantics, and a follow-up six days out is stated as its date, never as
due.

## 3.4 Ownership precedence (§26)

    NEXT      owns the recommendation
    WAITING   owns any action whose status is `waiting`
    BLOCKED   owns any action with an unfinished blocker
    OPEN      owns ordinary active work
    ATTENTION owns nothing — it attaches to the row that owns the record
    DEFERRAL  owns nothing — it attaches a count to that row

And, from §40's visual review: **Recently excludes any action that owns a row**.
The row is the live truth; Recently is for what moved.

## 3.5 Recent movement (§13, §14, §24, §35)

Bounded to the last 7 days and named on screen. Deduplicated per record —
`buildExecutiveChanges` emits one entry per *event*, so an action deferred twice
produced two identical rows. A **goal-horizon edit is never project movement**
(§14), asserted both ways: it is absent from `recent`, and the same window
genuinely contains one.

## 3.6 People (§12, §34)

LIFEOS-086's derivation, so its conservatism holds here unchanged: names are
grounded in `waitingOn`, action titles and the project's own description; a
candidate that follows another is part of that name (so `Webb` is never a person
of its own); a sentence-initial capital is an artifact, not a name; an acronym
is not a person; and **Marcus and Marcus Webb are never merged** — the ambiguity
travels on the row.

# 4. Memory integration (§17)

| Question | Before | After |
|---|---|---|
| What changed with X? | "Conqify recorded no change" | project-scoped via `projectRef` |
| What am I waiting on for X? | "No action is marked as waiting on clinic launch" | scoped by `projectId` |
| What is blocked on X? | routed to WAITING | reads dependency state |
| Who is involved in X? | unrouted | `PROJECT` + `people` aspect |
| What keeps getting deferred on X? | unrouted | `CHANGES/postponed`, project-scoped |

**The waiting fix repairs a regression I introduced in LIFEOS-086.** That sprint
scoped `answerWaiting` by `personName ?? entityQuery` to fix a person bug; for a
project question `entityQuery` is the project's title, so the filter searched
`waitingOn` for "clinic launch". A person scopes by `waitingOn`; a project scopes
by `projectId`; nothing else scopes at all.

# 5. Migration (§36)

**None.** Head stays at **0047**. Project lifecycle history genuinely does not
exist — Goals carry `history`, Projects carry only `updatedAt` — so the page
states that limitation rather than dating a status change from a field that
means "last edited".

# 6. Verification

| Gate | Result |
|---|---|
| Deterministic, all suites | **5297 / 5297**, 51 suites (was 5182 / 5182, 50) |
| `execution/context` | **115 / 115** |
| Browser torture, 087 | **52 / 52** |
| Mutation proofs | **22 / 22 caught** |
| 078–086 browser suites | 93 / 97 / 109 / 72 / 64 / 77 / 62 / 54 / 53 — all pass |
| release · rls · auth · routes · wiring · mappers · export · secrets | pass |
| route-smoke (production build) | 24 / 24 |
| `tsc` · `eslint` · `next build` | clean (2 pre-existing warnings) |
| Performance | 5 project contexts over 5,000 actions < 3000ms |

## 6.1 Five mutations escaped, and only one was a product gap

Four were **fixture gaps** — the case the mutation would break was not present,
so the assertion could not have failed:

- every blocked row had exactly one blocker, so "name the *unfinished* one"
  picked the same record either way;
- deduplication left two recent rows against a cap of five;
- `personHint` had already filtered "PDF" out because nothing was recorded about
  it, so the acronym guard was not what made its test pass;
- only **one** repeatedly-deferred action existed store-wide, so a
  project-scoped answer and an unscoped one were identical.

That last one, once visible, exposed the real gap: the deferral scope had
**never applied** — `entityQuery` for "what keeps getting deferred on Clinic
launch?" resolves to no record, so the filter silently did nothing. It now falls
back to the resolved `projectRef`.

The fifth was a **broken mutation**: it referenced a symbol the file does not
import, so it threw rather than failing, and a crash is not a proof. Replacing it
exposed something worse — a failed patch left the source unchanged and the run
reported GREEN, a no-op masquerading as an escaped mutation. **The harness now
aborts on a patch that does not apply.**

## 6.2 What §40's visual review found

Two duplications that 113 deterministic and 52 browser assertions all missed:

1. **"Transcript from Maria" said the follow-up was today twice** — once as the
   row's meta, once as the signal beneath it.
2. **"Email professor" appeared under *Also open* with its deferral count and
   again under *Recently* as "Deferred"** — the same action twice on one screen,
   the second telling the reader nothing the first had not.

# 7. Limitations, stated

- **No project lifecycle history.** "When did this become active?" is
  unanswerable, and the page says so instead of guessing from `updatedAt`.
- **Recently is bounded to seven days** by default; Memory answers deeper.
- **People are matched by name, not identity** — LIFEOS-086's limitation,
  carried forward unchanged and shown on every ambiguous row.
- **The existing milestone-derived progress bar is untouched.** §28 forbids
  *creating* a score; this one predates the sprint and is a manual milestone
  count, not a judgement. Nothing new reads or extends it.

# 8. Product claims (§45)

1. **A Project shows why it exists when linked to a Goal** — and says plainly
   when it is not. ✅
2. **One grounded Next action is visible**, from the existing recommender. ✅
3. **Open work is visible without a backlog wall** — capped, with the
   recommendation not repeated. ✅
4. **Blocked and waiting are surfaced factually** — a completed blocker never
   blocks, a future follow-up is never due. ✅
5. **Repeated deferral is visible without shame language.** ✅
6. **Recent movement uses real historical evidence** — and a goal-horizon edit
   is not project progress. ✅
7. **People context is conservative** and never merges two names. ✅
8. **Personal Code is context only**, through the existing relevance system. ✅
9. **One action occupies one row.** ✅
10. **Project lifecycle history is not fabricated.** ✅
11. **No score exists** — no health, momentum, risk, alignment or percentage. ✅
12. **No migration and no new persistence noun.** Head stays at **0047**. ✅
