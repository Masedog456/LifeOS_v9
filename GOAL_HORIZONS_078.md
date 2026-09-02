# LIFEOS-078 — Goal Horizons & Alignment

**North star:** help me see where my life is going, not just what I have to do
next.

## STATUS: COMPLETE — repository 0047 · production 0047 · parity PASS

| | |
|---|---|
| **Repository migration head** | **0047** |
| **Production Supabase head** | **0047** |
| **Parity** | **PASS** |
| Applied file | `supabase/migrations/0047_goal_horizons_lifecycle_history.sql` |
| Production ledger ends at | `0047 \| goal_horizons_lifecycle_history` |
| Contract change (§22) | approved, shipped inside 0047 |
| Deployment order | **database first, client second** — followed |

The Type B precondition is satisfied. Section 11a records the deployed
evidence and its provenance.

Sections 1–5b are the design as approved and are unchanged. Sections 10–14
record what was built, what was measured, and what is still limited.

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
- ~~**No CHECK constraint on `horizon`**~~ — **overridden by the approval (§8),
  and the approval was right.** The client validating an enum is not the same as
  the database refusing a bad value, and 0047 now carries
  `horizon is null or horizon in ('now','near','medium','long','life')`.
  The rehearsal proves an out-of-range value is refused on INSERT and UPDATE.
- ~~**No FK on `successor_goal_id`**~~ — **overridden by the approval (§9), and
  the approval was right.** `ON DELETE SET NULL` gives exactly the degradation
  this bullet wanted — the delete is not blocked and nothing cascades — while
  also making a dangling pointer impossible rather than merely tolerated. The
  column is indexed so a goal delete does not seq-scan the table.
- **No CAS / `sync_version`** (§40) — Goals are not 0045-guarded. Expanding CAS
  is explicitly out of scope absent a demonstrated P1; conflict behaviour will be
  measured and reported instead.

All three columns are nullable or defaulted and purely additive. The client's
row shape is not, which is what makes this a **type B** migration rather than a
type A — see 5b.

---

## 5b. §22 — the contract change (APPROVED, shipped in 0047)

**Capability advertisement is required.** This was measured, not assumed.

`goals` is written by a plain `this.client.from("goals").upsert(d.upsert)`, and
`d.upsert` comes from `goalToRow`, which emits an **unconditional row shape**.
Adding `horizon`, `successor_goal_id` and `history` to the Goal type means every
goal write carries those columns. Against a 0046 database they do not exist, so
PostgREST rejects the row and **the whole `goals` domain stops syncing**.

That is the 0045 client-first incident again, on a different table. `goals` is
currently gated by nothing — `DOMAIN_CAPABILITY_REQUIREMENTS` covers only `notes`
and `nextActions`.

Omitting the columns when unset does not fix it. It narrows the window to "until
the first person sets a horizon", which is worse: a latent failure that fires on
use rather than on deploy.

### The exact proposed change

Inside `0047`, replacing `app_schema_contract()` — no other object touched:

```sql
    'contract', 3,                    -- was 2
    'min_client_contract', 1,         -- unchanged
    'capabilities', jsonb_build_object(
      'guarded_notes', 2,             -- unchanged
      'guarded_next_actions', 2,      -- unchanged
      'goal_horizons', 1              -- NEW
    )
```

And one line of client, in the existing central map:

```ts
goals: { goal_horizons: 1 },
```

`min_client_contract` stays **1**: a pre-078 client writing goals without the new
columns is harmless against a 0047 database, because all three columns are
nullable or defaulted. Declaring old clients unfit would manufacture an outage
the data does not justify — the same reasoning as 0046.

### What each combination then does

| Client | Database | Result |
|---|---|---|
| 077 (old) | 0047 | **Compatible.** `contract 3 > 2` is fine; `min_client 1 ≤ 2`; the old client has no `goals` requirement and writes the old row shape |
| **078 (new)** | **0046** | **`goals` pauses, fail-closed.** Local durable, domain stays dirty, every other domain syncs, no false Synced, flushes when 0047 lands |
| 078 | 0047 | Compatible |

**This is the payoff from 077.** In the 0045 world, shipping the client first was
an incident. Here it is a bounded, visible, self-healing pause of one domain —
because the client can now ask the database what it can do. Ordering is still
preferable (migration first), but it is no longer load-bearing for safety.

In the 077 taxonomy this is a **type B** migration: client-required, migration
first, `min_client_contract` untouched.

### Approved as proposed

`contract` 2 → 3, `goal_horizons: 1` added, `min_client_contract` held at 1.
Written into `0047` alongside the columns, so the claim and the capability
arrive in the same transaction — the property that makes it deployed truth
rather than a second copy of a client constant.

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

## 9. Risks raised at design time, and how each landed

- **The `horizon` word.** Resolved as proposed: `GoalHorizon` in code,
  "Horizon" in product, `PlanningHorizon` untouched and never imported by the
  new modules.
- **Transition history costs a column.** Paid, and approved. It is the third
  column in 0047.
- **Goals are not CAS-protected.** Confirmed and MEASURED rather than fixed —
  see §12. Concurrent edits are last-write-wins on the whole row, and a goal's
  history array is lost with it.
- **`someday` overlap.** The conservative call held: kept in data, no longer
  offered for new goals, no rows rewritten.

---

## 10. What was built

### The migration

`supabase/migrations/0047_goal_horizons_lifecycle_history.sql` — three columns
and the contract, in one transaction:

```sql
alter table public.goals add column if not exists horizon           text;
alter table public.goals add column if not exists successor_goal_id uuid;
alter table public.goals add column if not exists history           jsonb not null default '[]'::jsonb;

-- horizon is null or horizon in ('now','near','medium','long','life')
-- successor_goal_id references public.goals(id) on delete set null
-- goals_successor_idx on (user_id, successor_goal_id)

'contract' 3 · 'min_client_contract' 1 · capabilities +'goal_horizons' 1
```

`create or replace` on `app_schema_contract()` keeps SECURITY INVOKER and the
pinned `search_path`, and re-states the anon revoke rather than trusting
inheritance — the S-45B lesson, applied to the migration that touches the
function next.

### The client

| Concern | Where |
|---|---|
| Vocabulary, grouping, guidance | `lib/execution/horizons.ts` |
| Append-only history, replacement, lineage | `lib/execution/lifecycle.ts` |
| Alignment facts, `goal_path_missing`, ancestry | `lib/execution/alignment.ts` |
| Capability requirement | one line in `lib/sync/contract.ts` |
| Row mapping | `goalToRow` / `rowToGoal` |
| Store actions | `setGoalHorizon`, `replaceGoal`, history in `updateGoal` |
| Surfaces | `/goals` horizon grouping · `/goal/[id]` direction, facts, history |

`goal_path_missing` is a ninth commitment kind in the existing layer, in the
existing `pulse` section, with a resolution set of its own. No new navigation,
no new noun, no new domain.

### Memory — the seven grounded questions

Before this sprint all seven of §18's questions returned
`NO_RECORDED_EVIDENCE`. Honest, and useless: the router had no goal class, so
"which goals did I achieve?" fell through to nothing, and adding it to
`COMPLETION` would have answered a question about goals with a list of finished
actions.

`GOALS` is the eleventh query class, with a `goalAspect` for the six shapes
(`direction`, `paused`, `achieved`, `abandoned`, `replaced`, `no_path`,
`moved`). Every line traces to a stored field, and the exclusions are the point:

- A lifecycle answer is dated from the **history transition**, not `updatedAt` —
  a title edit moves `updatedAt` and would misdate when a goal was let go.
- "Moved forward" counts a completed action or project under the goal, and
  nothing else. A horizon change, a target-date change and an edit are all
  recorded and none of them is progress. The limitation says so on every
  progress answer, and a mutation test confirms the exclusion is load-bearing.
- A deleted successor is reported as deleted. The id is never printed.
- The `no_path` answer states its own project-shaped limitation rather than
  implying it covers directly-linked actions.

### Deliberate design decisions worth naming

- **Horizon never influences ordering.** The Today ancestry line is appended
  *after* the recommender has ordered its candidates and is absent from
  `GROUNDING_CODES`, so it can neither move a recommendation nor make an
  ungrounded one look explainable.
- **History records transitions, not edits.** Status, horizon and target-date
  changes are recorded; title, notes, priority and tag edits are not. If every
  edit wrote an entry, "when did I let this go?" would be buried under typo
  fixes and the record would stop being evidence.
- **Re-selecting the same horizon writes nothing.** Asserted in the browser.
- **A deleted successor never leaks its words.** The history entry stores an id
  only, and renders as "Replaced by a goal that has since been deleted" — the
  0039 deletion-privacy rule, applied here by construction.
- **`someday` was not migrated.** Rewriting those rows to `horizon = 'life'`
  would put words in the user's mouth about goals they have not looked at in
  months. It stays readable, keeps working, and is simply no longer offered.

### The fake percentage, and what replaced it

`goalProgress` returned `0` for a goal with nothing measurable, and the card
rendered *"0 projects · 0% complete"*. It now returns `number | null`, and
`null` covers two cases that were both fabrication:

1. a goal with no projects, and
2. an **unmeasurable project inside the average**, worth zero — a goal with one
   finished project and one fresh one came out at "50%", half of it invented.

Averaging only the measurable projects was considered and rejected: it reports
that same goal as 100%, overstating in the other direction. When part of the
picture is genuinely unknown, the whole is reported unknown, and the counts on
the goal page carry what is known.

---

## 11a. Deployed evidence

**Provenance: EXTERNALLY VERIFIED DEPLOYED EVIDENCE.** The production migration
and every check below were performed outside this environment and reported back.
No production credentials or Supabase CLI exist here; nothing in this section
was executed by Claude, and none of it is inferred from the repository, from
client constants, or from the rehearsal.

| Checked on production | Result |
|---|---|
| Migration ledger head | `0047 \| goal_horizons_lifecycle_history` |
| Applied file | the exact repository migration |
| Version/name parity with the repository | **PASS** |
| `goals.horizon` | `text`, nullable, no default |
| `goals.successor_goal_id` | `uuid`, nullable, no default |
| `goals.history` | `jsonb`, NOT NULL, default `'[]'::jsonb` |
| Existing goals back-filled | **no** |
| `goals_horizon_valid` | permits `now/near/medium/long/life` and NULL only |
| `goals_successor_goal_id_fkey` | → `public.goals(id)` `ON DELETE SET NULL` |
| `goals_successor_idx` | present on `(user_id, successor_goal_id)` |
| Predecessor column | does not exist |
| `app_schema_contract()` | contract 3 · min_client 1 · `guarded_notes` 2 · `guarded_next_actions` 2 · `goal_horizons` 1 |
| Contract security | SECURITY INVOKER, `search_path = pg_catalog, public` |
| Contract EXECUTE | anon **none** · authenticated yes · service_role yes · postgres owner/admin |
| `notes_sync_version_guard` · `next_actions_sync_version_guard` | both present, BEFORE UPDATE → `enforce_sync_version()` |
| RLS on `notes` / `next_actions` | still enabled |
| Supabase Security Advisor after 0047 | no new 0047-specific warning |

The advisor's remaining warnings — older mutable-`search_path` functions,
`vector` in `public`, leaked-password protection disabled — pre-date this
migration and are not attributable to it.

The deployment order was database first, client second, which is what the Type B
classification required.

---

## 11. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| `npm run build` | exit 0 |
| Deterministic selftests | **4252/4252** across 42 suites |
| …of which new this sprint | 93 goal-horizon + 11 goal round-trip |
| `npm run release:migrations` (real PostgreSQL 16) | **200/200**, 42 of them 078 |
| `scripts/inject-078-goal-capability.cjs` (§12 red proof) | **43/43** |
| `scripts/smoke-078-goal-horizons.cjs` (browser, 2 viewports) | **93/93** |
| `scripts/smoke-076-sync-trust.cjs` | 281/281 |
| `scripts/inject-077-schema-compatibility.cjs` | 51/51 |
| `scripts/inject-076b-old-client-window.cjs` (compiled 0045-era client) | 8/8 |
| `scripts/inject-076b-live-window.cjs` | 9/9 |
| `scripts/inject-074-*` (six harnesses) | 248/248 |
| `scripts/inject-075-cross-device.cjs` · `inject-076-*` | 135/135 · 179/179 |
| `npm run release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

### The red proof (§12), in one paragraph

The same simulated 0046 backend, run twice in one process. The fake enforces
the actual 0046 column set, so it cannot pass the RED run by being lenient.
**With `goals` deleted from `DOMAIN_CAPABILITY_REQUIREMENTS`** the write path
attempts the upsert, PostgREST rejects the unknown column, and health reports
`retrying` with `goals` failed — the incident, reproduced. **With the
requirement present** the upsert is never attempted, the edit and its horizon
are durable locally, `goals` stays dirty, health is not `synced`, notes still
push through the 0045 guarded path, and the notice names no database noun.
Deploying 0047 then flushes the held goal with all three columns and clears the
notice.

### Two test bugs found and fixed rather than trimmed

- An assertion read `health.detail`, a field that does not exist, so it was
  testing an empty string against a regex.
- An assertion grepped the migration for the word "predecessor" and matched the
  migration's own explanation of why there is no such column.

Both are recorded because a test that passes for the wrong reason is the failure
mode this project spends the most effort on.

---

## 12. Limitations, stated plainly

- **Cross-device goal history can be lost.** Goals are not 0045-guarded, so a
  push is a blind row upsert and the later stale writer takes the whole row —
  including the `history` array. History is append-only *on a device*, not
  across devices. Pinned at runtime in `roundtrip-selftest` §10.7–10.9.
- **The merge layer would have preserved it.** `threeWayMerge` unions the two
  arrays, and does so only because `GoalHistoryEvent` carries an `id`, which is
  what makes `isChildList` recognise it as a child collection. That is asserted
  (§10.10–10.11) — but the layer remains unwired, so it is what the product
  *would* do, not what it does. Those assertions must fail when the merge layer
  is wired; that is their purpose.
- **`goal_path_missing` is project-shaped.** A goal whose work is tracked only
  as directly-linked Actions with no Project is flagged. That is literally true
  of the records and the wording says only that, but it is a shape the rule does
  not distinguish.
- **Horizon guidance ranges are prose.** Nothing checks a goal's target date
  against its horizon's span, by design. A goal is never "wrong" for its dates.

---

## 13. Deployment — done

**Type B — client-required capability. The order was followed.**

1. `0047` applied to production Supabase. ✅
2. Parity verified externally: ledger ends at `0047 | goal_horizons_lifecycle_history`,
   `app_schema_contract()` returns contract 3 with `goal_horizons: 1`. ✅
3. Client cleared to merge. ✅

| Client | Database | Result |
|---|---|---|
| 077 (old) | 0047 | Compatible — old row shape accepted, no `goals` requirement |
| **078 (new)** | **0046** | **`goals` pauses, fail-closed** — local durable, dirty, other domains sync, no false "Synced", flushes when 0047 lands |
| 078 | 0047 | Compatible — the state production is now in |

The 078-against-0046 row is the deploy-order proof and remains asserted
(`inject-078-goal-capability.cjs`) even though production has moved past it: it
is the guarantee that the ordering was a preference rather than a cliff.

---

## 14. Verdict

**LIFEOS-078 COMPLETE — GOAL HORIZONS & ALIGNMENT READY.**

Repository migration head **0047** · production Supabase head **0047** · parity
**PASS**, on externally verified deployed evidence (§11a).

All final gates green: 4252/4252 deterministic assertions, 200/200 migration
rehearsal against real PostgreSQL 16, 43/43 red capability proof, 93/93 browser
across two viewports, 24/24 route smoke, 14/14 export verify, release and
security audits passing, `tsc` and `eslint` clean, build exit 0.

Nothing in §28 was begun: no Rules, Collections, People, Calendar expansion,
D-8, general D-23, or Observatory.
