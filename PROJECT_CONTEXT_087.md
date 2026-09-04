# LIFEOS-087 — Projects as Living Context

**North star:** a Project should tell me what it is, why it matters, what's
moving, what's stuck, and what happens next.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

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

*Sections 2 onward are written as the implementation lands.*
