# Planning Views & Focus Modes (LIFEOS-037)

A deterministic planning and focus layer over records that already exist. It
helps the user answer two questions:

> **What have I chosen to focus on, and when?**
> **What am I working on right now?**

It **displays and organizes the user's own choices**; it never decides what
matters. A *planning horizon* is a manual label — `today`, `this_week`,
`later`, `someday`, or `unscheduled` — expressing intent, **not a deadline**.
A *focus session* protects the space to carry out one thing.

The system **never** auto-plans, auto-schedules, auto-fills an empty plan,
auto-prioritizes, or moves anything on its own. There is no AI, no scheduler,
no calendar, no notifications/reminders, no productivity scores, streaks,
gamification, analytics, collaboration, presence, or automatic time
estimation. LifeOS provides the structure; the user chooses.

The core invariant, everywhere:

> **A planning move changes ONLY a record's horizon and manual order — never
> its status, deadline, priority, or hierarchy.**

---

## 1. Where the code lives

```
lib/planning/
  horizon.ts        HORIZONS, BOARD_COLUMNS, PLANNABLE_KINDS, isPlannable,
                    refKey, assignmentFor/horizonOf, assignmentIndex (O(1) map)
  history.ts        compact append-only PlanningHistoryEvent[] (deduped <1s)
  board.ts          deriveBoard: cards → 5 columns, filters, manual ordering,
                    boardCounts, nextOrderIn
  today-plan.ts     todayPlan(state, today): explicit Today assignments lead,
                    then derived (pinned/in-progress/waiting-due/returns/
                    tomorrow-focus) — deduped; NEVER auto-fills an empty plan
  weekly-plan.ts    weeklyPlan: thisWeek + unfinished-today + active milestones
                    + projects touched + waiting follow-ups + deferred returns
                    + completed-this-week (a review, NOT a 7-day calendar grid)
  focus.ts          FOCUS_PANELS (9), defaultPanels(kind), makeFocusSession,
                    activeFocus (one at a time), focusElapsedMs
  capacity.ts       capacitySummary (COUNTS only), capacityMessage (neutral;
                    never blocks, never scores)
  commitments.ts    commitmentGroups (viewing mutates nothing)
  planning-inbox.ts planningInbox (records that MAY need a manual decision),
                    activeProjectSafeguard (Feature 12), unplannedCount
  relationships.ts  planningInfoFor / focusHistoryFor / dailyPlanning projections
  card-meta.ts      resolveCardMeta: ref → title/href/context via entity API
  merge-rules.ts    mergeAssignment(Sets) + mergeFocusSession + mergeCapacityLimits
  memory.ts         focus-panel memory per target type (prefs.planning)
  selftest.ts       68 deterministic assertions

components/planning/
  PlanningBoard.tsx   5 columns, drag-drop, keyboard 1–5, multi-select,
                      filters, collapsed groups, mobile list toggle
  PlanningColumn.tsx  one horizon column (+ counts, collapse)
  PlanningCard.tsx    a record card with move controls (buttons + keyboard)
  TodayPlan.tsx       the deterministic Today plan
  WeeklyPlan.tsx      the weekly review view
  CapacityView.tsx    counts + neutral soft-limit message
  CommitmentReview.tsx everything committed to, grouped (+ CapacityView)
  PlanningInbox.tsx   records needing a manual planning decision
  FocusMode.tsx       the focused working screen (one target; bounded data)
  FocusPanels.tsx     panel visibility toggles (remembered per target type)
  InterruptionLog.tsx manual interruption log (no auto-detection)
  TodayPlanCard.tsx   compact Plan section for the Today page
  InspectorPlanning.tsx inspector planning metadata + actions

app/plan/page.tsx              the planning board
app/plan/today/page.tsx        the Today plan
app/plan/week/page.tsx         the weekly view
app/plan/commitments/page.tsx  commitments + capacity
app/plan/inbox/page.tsx        the planning inbox
app/focus/page.tsx             Focus Mode (?kind=&id= start, ?end=1 end)
app/dev/planning-tests/page.tsx runs runPlanningSelfTests() (dev route)
```

---

## 2. Data model

Two records, both persisted (migration `0028_planning_focus.sql`) and synced.

### PlanningAssignment
One assignment **per record** (a move updates it in place; sync never
duplicates it). The record is a **generic typed reference** (`ref.kind` +
`ref.id`), matching the entity architecture, so any plannable record can carry
a horizon without a per-type table.

```ts
{ id, ref: { kind, id }, horizon, order, createdAt, updatedAt, history }
```

`PLANNABLE_KINDS` = action, milestone, project, document, open_loop, capture.

### FocusSession
One primary target, an optional attached working session (reusing the
LIFEOS-030 session engine), panel visibility, a manual interruption log, and
compact history — interruptions and history embedded as bounded JSON (read
with the session).

```ts
{ id, targetKind, ref, title, sessionId?, startedAt, endedAt?,
  panels, interruptions, history }
```

`FocusTargetKind` = action | milestone | project | document | workspace |
entity | custom.

### Preferences (not records)
Capacity **soft limits** and board/focus UI preferences live in
`prefs.planning` (LIFEOS-027) — they are preferences, not records, and are
never surfaced as data to plan.

---

## 3. Determinism & the "never decides" rule

Every projection is a **pure function of `(state, today)`** — same inputs, same
output, no clocks in render, no side effects.

- **Today plan** surfaces the user's explicit `today` assignments first, then
  *derived* candidates the user already flagged elsewhere (pinned actions,
  in-progress work, waiting items due today, deferred returns, yesterday's
  tomorrow-focus). It **never** invents items and **never auto-fills an empty
  plan** — an empty plan stays empty.
- **Capacity** reports **counts only** against a user-set soft limit, phrased
  neutrally ("7 selected, preferred limit 5"). It never blocks a move, never
  scores, never labels the user over-committed.
- **The active-project safeguard** notes an active project with no open action
  and offers *Create / Link / Leave* — it **never** auto-creates an action and
  **never** labels the project unhealthy or stalled.
- **Commitment review** and every other view **mutate nothing** on load; each
  per-item control is an explicit user action.

---

## 4. Local-date semantics

All horizon and "due today / returns today" logic uses the canonical
local-date engine (`lib/reviews/dates.ts`: `todayKey`, `addDays`,
`weekStartKey`, `weekDays`, `isoOnLocalDay`). Dates are **local calendar
days**, timezone- and DST-correct, computed in projections (never in workers),
so "today" means the user's today.

---

## 5. Focus Mode

Focus centers the screen on **one** target and hides nonessential navigation
(a dedicated minimal layout — **no** automatic browser fullscreen). Only
**bounded, target-related** data is loaded (e.g. a project's open actions, its
linked captures) — never the whole knowledge graph.

Panels (`FOCUS_PANELS`): project_context, current_action, notes,
session_activity, captures, document, related_knowledge, timer, interruptions.
Which panels show is **remembered per target type** in `prefs.planning`. A
focus session may attach a working session (reusing the session engine); one
focus is active at a time.

**Interruptions** are logged **manually** (timestamp, description, category,
optional linked record, resolved flag). Nothing is auto-detected or scored;
they may appear in the daily review's friction section.

---

## 6. Integrations

- **Today page** — a compact `<TodayPlanCard />` Plan section (deterministic,
  non-judgmental).
- **Daily review** — focus sessions and interruptions appear in the day
  summary (`lib/reviews/day-summary.ts`); interruptions may surface as friction.
- **Capture** — the capture processor offers an explicit horizon assignment
  ("Plan…"). Capturing never auto-schedules.
- **Reading** — a document can be a focus target; planning never modifies
  reading progress.
- **Command center** — nav commands (Plan, Today Plan, Commitments, Planning
  inbox, Focus) plus `focus:end` / `focus:action`.
- **Inspector** — `<InspectorPlanning />` shows a record's horizon + history
  and offers plan / re-plan / remove and "Focus on this".
- **Entity/search** — plannable records resolve title/href through the shared
  entity API (`card-meta.ts`).

---

## 7. Persistence & sync

Row mappers and `loadPlanning` / `syncPlanningAssignments` /
`syncFocusSessions` live in `lib/adapters/supabaseAdapter.ts`, following the
established diff-by-id + tombstone pattern. Deletes are tombstoned under
`planningAssignments` / `focusSessions`.

Merge rules (`merge-rules.ts`), layered on the LIFEOS-033 engine, with two
overriding invariants — **never silently duplicate a planning assignment, and
never silently lose focus history:**

| Situation | Resolution |
|---|---|
| Different records moved on two devices | both kept (union) |
| Same record → different horizons | **conflict**; keep local, flag for the user |
| Incompatible order change on the same record | **conflict** |
| Assignment removed on one device, moved on the other | keep the move (never silently drop a plan); flag |
| Assignment removed on one device, untouched on the other | honor the removal |
| Interruptions logged on separate devices | union by id |
| Focus panels toggled independently | per-key merge (local wins per key) |
| Focus ended vs. extended | **conflict**; keep the ended state's history |
| Unrelated capacity limits changed | auto-merge (absent key = no opinion) |
| Same capacity limit changed differently | **conflict** |
| History from both devices | union by id, time-sorted |

Assignment-set merges are keyed by the **record reference** (`kind:id`), not
the assignment id, so the same record planned on two devices resolves to
exactly **one** assignment.

---

## 8. Testing

- **Unit** — `runPlanningSelfTests()` : 68 deterministic assertions across 18
  sections (horizon, history, board, today, weekly, focus, capacity,
  commitments, inbox, safeguard, merge rules, memory, local-date, performance).
  Dev route: `/dev/planning-tests`.
- **E2E** — 27 checks against the production build (board columns + orphan,
  planning inbox + assign, board move buttons, keyboard move, multi-select,
  Today plan, focus on action + timer, interruption log, panel toggle, end
  focus, focus on project, commitment review + capacity message,
  active-project safeguard, capture→plan, preference persistence, mobile
  board, mobile focus, weekly view).
- **Performance** — self-test section 18 measures the projections against a
  realistic fixture: board `< 250ms`, today + weekly `< 300ms`, planning inbox
  `< 400ms`. The inbox builds O(1) existence sets and an assignment index, so
  orphan detection never rescans the record arrays.
- **Migration** — full chain `0001–0028` applies idempotently 3× on Postgres
  16; defaults, the `(user_id, ref_kind, ref_id)` unique constraint, indexes,
  RLS, and cross-user isolation (non-superuser role) all verified. Soft
  references (no FK) keep projections orphan-safe.

---

## 9. What this feature deliberately does NOT do

No AI, LLMs, agents, or embeddings. No automatic prioritization, scheduling,
or time estimation. No calendar integration, notifications, or reminders. No
productivity scores, streaks, or gamification. No analytics, collaboration,
realtime presence. No auto-filling of empty plans, no auto-movement of cards,
no auto-created actions. A horizon is never a deadline; a move never touches
status, deadline, priority, or hierarchy.
