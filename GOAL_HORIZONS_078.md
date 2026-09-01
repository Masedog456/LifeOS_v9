# LIFEOS-078 — Goal Horizons & Alignment

**North star:** help me see where my life is going, not just what I have to do
next.

## STATUS: DESIGN READY — AWAITING MIGRATION APPROVAL

The audit is complete. Three persisted facts cannot be represented by anything
that exists today, so per §41 the design is proposed here and **no migration has
been written**.

> ### Blocked on a precondition, separately
>
> §1 requires starting from a `main` that contains PR #83. **#83 is open, not
> merged** (`state: open`, `merged: false`, `mergeable_state: clean` —
> Vercel is green). `origin/main` is still `b7fa54b`, which predates 0046.
>
> So no branch has been created. This audit is read-only and its findings are
> independent of 077 — Goals and schema compatibility do not touch — so it is
> delivered now rather than held. `claude/lifeos-078-goal-horizons-alignment`
> will be cut from `main` once #83 lands, and the base SHA reported then.

---

## 1. Audit — the complete Goal lifecycle as it exists

### The model

```ts
type GoalStatus = "active" | "paused" | "completed" | "abandoned" | "someday";

interface Goal {
  id, title, description, status, priority,   // priority: low | medium | high
  targetDate?,                                // yyyy-mm-dd, plain date
  notes, tags,
  manualProgress?,                            // 0–100 override
  linkedWorkspaces: RecordRefLite[],
  linkedKnowledge: RecordRefLite[],
  createdAt, updatedAt,
}
```

Storage: `public.goals` (migration 0023) — every field above, `status` and
`priority` as plain `text` with defaults and **no CHECK constraint**. Mapper
`goalToRow` / `rowToGoal` is complete and symmetrical. `goals` is in the backup
allow-list, so export/import/restore already carry every field.

### A. What can a Goal represent today?

An outcome with an optional date, a coarse priority, a lifecycle status, and
reference links to workspaces and knowledge. It can represent "finish the
applications by December" and "become a philosopher" — **identically**. Nothing
in the model distinguishes them.

### B. Which fields actually drive behaviour?

| Field | Drives |
|---|---|
| `status` | filtering (`activeGoals`), and `completed` → 100% in progress |
| `manualProgress` | overrides derived progress outright |
| `targetDate` | **displayed only** — no signal, no attention, no ordering |
| `priority` | **displayed only** — no recommender input found |
| `linkedWorkspaces` / `linkedKnowledge` | reference display, Constitution evidence |
| `description` / `notes` / `tags` | display |

Two of the five behavioural-looking fields (`targetDate`, `priority`) drive
nothing at all.

### C. How are Goals linked to Projects?

`Project.goalId?: string` — **one-to-many, Project-owned**. A Goal has 0..n
Projects; a Project advances at most one Goal. `goalProjects()` filters by it.
Deleting a Goal clears `goalId` on its Projects rather than cascading — good.

**Actions can also link directly:** `NextAction.goalId?` exists, so an Action may
name a Goal without a Project in between. Any ancestry explanation has to handle
both shapes, and §15's `Goal → Project → Action` is the common case, not the only
one.

### D. How do Goals influence Today?

**They do not.** `lib/today/` contains no goal reference; the recommender's only
goal contact is `queue.ts` using `goalId` as a *filter* input. Today cannot say
"this supports [Goal]" because nothing in Today knows a Goal exists.

### E. How are completed/abandoned goals remembered?

They are not, as goals. `lib/memory/` mentions `goal` exactly once — a label in
`answer.ts`. There is no week/month review goal section. A Goal marked
`completed` or `abandoned` simply stops appearing in `activeGoals()`; the
transition itself is not recorded anywhere, because **a Goal has no history
array and no provenance field** (unlike `NextAction`, which has both).

### F. Can the product distinguish aspiration from commitment?

Only accidentally. `GoalStatus` includes `"someday"` — an aspiration marker
living inside the *lifecycle* enum, so "I might do this one day" and "I have
stopped doing this" occupy the same axis. That is a category error already
present, and §21's boundary question lands right on it.

### G. Does changing a Goal overwrite historical meaning?

**Yes, completely.** `bumpGoal` is `{...mutate(g), updatedAt: now()}` — a
straight overwrite. Retitling "Run a marathon" to "Run an ultramarathon"
destroys the fact that the first was ever pursued. `updatedAt` moves; nothing
else records that anything changed. There is no `replaced` status and no
successor link, so §8's "I used to be pursuing X, then I changed to Y" is
currently unrepresentable.

### H. Which parts of the Goal UI are useful vs decorative?

`app/goals/page.tsx` (105 lines), `app/goal/[id]/page.tsx` (238), and
`components/insights/GoalActivity.tsx` (35).

Decorative, and worse than decorative: **`goalSummary()` renders
`"N projects · X% complete"`.** `goalProgress` averages `projectProgress` across
live projects and returns **0 when a Goal has no projects**. So a life-direction
Goal with no project reads *"0 projects · 0% complete"* — a completion claim
about something that was never measurable. That is precisely the fake-progress
§11 forbids, and it exists today.

---

## 2. Representation gaps

| Need (§) | Today | Verdict |
|---|---|---|
| Direction horizon (§4) | nothing — `priority` is urgency-ish, not direction | **missing** |
| Horizon ≠ target date (§5) | `targetDate` exists and is independent | reuse |
| Target window (§6) | `targetDate` is sufficient; LIFE goals leave it unset | **reuse — no new field** |
| Lifecycle (§7) | `active` `paused` `completed` `abandoned` exist | reuse; **`replaced` missing** |
| Replacement link (§8, §32) | nothing | **missing** |
| Why (§9) | `description` *and* `notes` both exist | **reuse `description` — no new field** |
| Goal→Project→Action (§10) | `Project.goalId`, `NextAction.goalId` | reuse |
| Goal with no path (§13) | nothing | derivable, no storage |
| Today ancestry (§15) | nothing | derivable, no storage |
| Lifecycle transitions (§25–§27) | overwritten by `bumpGoal`; no history anywhere | **missing** |
| Memory / review (§25–§27) | nothing | derivable **once transitions are recorded** |

**Three facts cannot be derived and cannot reuse an existing field: `horizon`,
`successorGoalId`, and an append-only lifecycle `history`** — the last because
transitions are currently overwritten and nothing records that they happened.

---

## 3. A naming collision the audit found

`PlanningHorizon` **already exists** — `lib/planning/horizon.ts`, values
`today | this_week | later | someday | unscheduled`, applied to *planning
assignments of Actions*. Its own doc comment insists it is "when the user has
chosen to work on something — NOT a deadline, due date, or priority."

A Goal's direction horizon is a different concept on a different noun. Shipping
`Goal.horizon` alongside `PlanningHorizon` would put two unrelated meanings
behind one word, in a product whose terminology module (`lib/design/terminology.ts`)
exists to prevent exactly that.

**Recommendation:** keep the user-facing word "horizon" for Goals (it is the
right English word, and the brief's own vocabulary), but name the type
`GoalHorizon` and never `Horizon`, and add a terminology note so the two are
distinguishable in code. Flagging rather than silently choosing — if you would
rather the Goal field were called something else (`GoalRange`, `direction`), say
so before 0047 is written.

---

## 4. Proposed model

### Horizon — semantic direction, not a date calculator (§4, §5)

```ts
type GoalHorizon = "now" | "near" | "medium" | "long" | "life";
```

Ranges (days–weeks, 1–3 months, 3–12 months, 1–5 years, open-ended) are
**guidance for the person and for AI suggestion**, never arithmetic. Nothing
derives horizon from `targetDate` or vice versa; §5's three examples all round-trip.

### Lifecycle (§7)

Reuse `active` / `paused` / `completed` / `abandoned`; add **`replaced`**.
`completed` is the existing spelling of ACHIEVED and is not renamed — renaming
would rewrite history for no gain.

`someday` stays, deprecated in UI: it is an aspiration marker, and with a `life`
horizon available it is no longer needed. Existing rows keep working.

### Replacement (§8, §32)

`successorGoalId?: string` on the predecessor. A replaced Goal keeps its title,
why, horizon, target and links; the successor is an ordinary new Goal. Memory
can then say "A was replaced by B" and nothing more.

### Why (§9)

`description` **is** the why. No new field, no vision editor.

---

## 5. Migration decision — 0047 required

Three persisted facts cannot be represented or derived. `status = 'replaced'`
needs **no** schema change (plain `text`, no CHECK constraint), so the migration
is three columns:

```sql
-- 0047_goal_horizon.sql  (PROPOSED — NOT WRITTEN)
alter table public.goals
  add column if not exists horizon text;                        -- null = unset
alter table public.goals
  add column if not exists successor_goal_id uuid;              -- null = not replaced
alter table public.goals
  add column if not exists history jsonb not null default '[]'::jsonb;  -- append-only lifecycle transitions
```

Deliberately excluded, and why:

- **No `target_start` / `target_end`** — `target_date` is sufficient (§6).
- **No `why` column** — `description` already is it (§9).
- **No `lifecycle` column** — `status` already is it (§7).
- **No CHECK constraint on `horizon`** — the existing `status` and `priority`
  columns are unconstrained text; adding a constraint only here would be
  inconsistent, and the client validates against the bounded enum. Say the word
  if you would rather have the constraint.
- **No FK on `successor_goal_id`** — a successor may be deleted, and a dangling
  successor should degrade to "replaced, successor gone" rather than block the
  delete or cascade one. The client treats an unresolvable id as absent.
- **No CAS / `sync_version`** (§40) — Goals are not 0045-guarded. Expanding CAS
  is explicitly out of scope absent a demonstrated P1; conflict behaviour will be
  measured and reported instead.

Both columns are nullable and additive, so this is an **expand-contract type A**
migration in the 077 taxonomy: safe in either deployment order, no contract bump
required, no client gating.

---

## 6. What is built without any migration

Everything else is derivation over existing data:

- **`goal_path_missing`** (§13, §34) — Goal `active` and no linked Project with
  status `active`. Distinct from `project_no_next_action`, which is reused as-is
  (§14) rather than duplicated at goal level.
- **Alignment as fact** (§12) — linked active projects, open actions, recently
  completed actions, last-activity date. Counts and dates, never scores.
- **Today ancestry** (§15) — the recommender keeps its ordering; the explanation
  gains "supports [Goal] through [Project]", derived from `Project.goalId` /
  `NextAction.goalId`. Horizon does **not** influence ordering (§17).
- **Progress evidence** (§26) — completed actions and projects under the Goal.
  Opening, editing, retitling and changing horizon do **not** count.
- **Memory and review** (§25, §27) — lifecycle transitions and the evidence
  above. Requires a transition record; see the open question below.

### Lifecycle transitions — the third column

**Transitions are not recorded anywhere.** A Goal has no history array and
`bumpGoal` overwrites. So "what goal did I abandon in March?" cannot be answered
from stored data — only "this goal is abandoned now". §25–§27 depend on this.

Three options were considered, and one survived scrutiny:

1. **Derive from `updatedAt` + current status.** Rejected. It answers "which
   goals are abandoned" but not when or from what, and would misattribute a
   title edit as the transition time — overclaiming, which §25 forbids.

2. **Reuse the `events` domain.** Rejected on inspection. `LifeEvent` has
   `linkedEntityRefs` and *could* hold a goal reference, but it has **no
   `goalId`**, carries a required `date` day-key, and is the user's calendar.
   Writing "you abandoned this goal" into someone's timeline of events is a
   category error, not a saving. *(An earlier draft of this document recommended
   this option after misreading `NextAction`'s field list as `LifeEvent`'s. It
   does not hold.)*

3. **An append-only `history` on the Goal** — **recommended.** It mirrors
   `NextAction.history` exactly, and the pattern is already established in three
   shipped tables (`0006`, `0008`, `0009` all use
   `history jsonb not null default '[]'::jsonb` for append-only status history).
   No new domain, no new noun, no new surface — one column and the same shape a
   reader of this codebase already knows.

So **0047 is three columns, not two.** The two-column figure in an earlier draft
was wrong because it assumed transitions could be recorded for free; they cannot.

---

## 7. Authority, capture, AI (§21–§24, §36, §38)

Unchanged from the brief's requirements, and the existing capture path already
behaves correctly: `interpret.ts` classifies "I want to …" as a **goal
candidate** with `confidence: "possible"` and the reason *"Conqify won't create a
goal unless you say so."* That is already SUGGEST-CONFIRM, and `createGoal` is
reached only via an explicit confirm path. Nothing to loosen.

Horizon suggestion is AUTO-SAFE (a suggestion, not a mutation) and must validate
against the bounded enum. Marking achieved, abandoning, replacing, and material
target changes stay SUGGEST-CONFIRM. Provenance rules are untouched.

---

## 8. Things this sprint will NOT do

No `Aspiration`, `Vision`, `Milestone`, `Outcome`, `Objective`, `OKR` or
`Strategy` entity (§42). One Goal domain. No new top-level navigation — Goals
gains horizon grouping in place (§19). No streaks, points, scores, badges or
alignment percentages (§43) — and the existing fake `"0% complete"` is **removed**
as part of this, since it is the same offence already shipped.

---

## 9. Remaining risks

- **The `horizon` word.** Two meanings, one term. Flagged above; naming is
  yours to confirm.
- **Transition history costs a column.** Resolved in section 6 — an append-only
  `history` on the Goal, matching three shipped precedents. If you would rather
  §25–§27 were cut than pay a third column, that is a live option and would
  shrink 0047 to two.
- **Goals are not CAS-protected.** Concurrent horizon/lifecycle edits from two
  devices follow ordinary last-write-wins. Will be measured and reported (§40),
  not silently fixed.
- **`someday` overlap.** Deprecating it in UI while keeping it in data is the
  conservative call; a future sprint could migrate those rows to
  `horizon = life`, but not this one.

---

## 10. Verdict

**LIFEOS-078 DESIGN READY — AWAITING MIGRATION APPROVAL.**

Awaiting three things:

1. PR #83 merged, so the branch can be cut from a `main` containing 077.
2. Approval of the three-column 0047 above.
3. Confirmation of the `GoalHorizon` naming, given the existing `PlanningHorizon`
   (section 3).

No branch created. No migration written. No product code changed. Nothing in
§51 begun.
