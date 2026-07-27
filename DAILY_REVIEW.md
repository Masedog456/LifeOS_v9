# Daily Review & Planning Loop (LIFEOS-034)

A deterministic daily review and planning loop. It helps the user answer, from
records that already exist:

- What happened today?
- What did I learn?
- What moved forward?
- What remains open?
- What matters tomorrow?
- What should I resume next?

The review **summarizes existing activity without inventing conclusions**. There
is no AI, no scoring, no streaks, no automatic prioritization, and nothing here
ever marks another record complete or incomplete.

---

## 1. Where the code lives

```
lib/reviews/
  dates.ts           local-date semantics (day keys, boundaries, DST, tz travel)
  day-summary.ts     deterministic "what happened today" projection
  open-loops.ts      derive unfinished-thread candidates (user chooses)
  tomorrow-focus.ts  ordered next-focus intentions + suggestions
  review.ts          review model/derivations, steps, recency grouping, start-tomorrow
  weekly-rollup.ts   deterministic weekly PROJECTION (not persisted)
  relationships.ts   review ↔ record backlinks
  selftest.ts        56 deterministic assertions

components/reviews/
  DailyReviewFlow.tsx   the guided-but-free 7-step page
  DaySummary.tsx        day-summary panel
  WinsStep / LessonsStep / FrictionStep / OpenLoopsStep / TomorrowFocusStep
  ReviewHistory.tsx     history grouped by recency
  WeeklyRollup.tsx      weekly projection
  TodayReviewCard.tsx   Today-page entry point
  EntityPicker.tsx      reuse of the search index to link records

app/daily/
  page.tsx              today's review
  [date]/page.tsx       a specific local date
  history/page.tsx      review history
  week/[start]/page.tsx weekly rollup

supabase/migrations/0025_daily_reviews.sql   the daily_reviews table
```

Reuses the entity API, inspector, command center, session tracking, execution
engine, reading engine, UX primitives, and the LIFEOS-033 sync-integrity layer.
No new state-management system.

---

## 2. Review lifecycle

A `DailyReview` moves through four statuses:

`not_started → in_progress → completed → reopened` (and back to completed).

- Creation is **idempotent per local date** (`getOrCreateReviewForDate`): opening
  `/daily` twice, or from any device, yields the **one** canonical review for
  that date.
- Any edit (summary, a win, a lesson, …) moves `not_started → in_progress` and
  stamps `startedAt`.
- **Completing** sets `completed` + `completedAt`. It changes no other record.
- **Reopening** a completed review sets `reopened` and clears `completedAt`, so
  the user can edit again.
- The guided flow has seven steps — *Today at a glance, Wins, Lessons, Friction,
  Open loops, Tomorrow's focus, Confirm & complete* — but the user may **jump
  freely**, **skip** any step, and reload without losing progress (every edit
  autosaves; free-text fields commit on blur and are protected by the shared
  unsaved-changes guard). It is a full page, never a modal.

---

## 3. Day-summary sources

`buildDaySummary(state, date)` reports counts + linked source records for a local
date, inferring no meaning. Sources:

| Group | Derived from |
| --- | --- |
| Sessions started / ended, total duration, workspaces used | `sessions` (startedAt / endedAt / workspaceId) |
| Goals touched, projects advanced | session `goalId`/`projectId` + milestones completed that day |
| Milestones completed | `projects[].milestones` with `completedDate` on the day |
| Documents read, highlights, annotations | `documents` (`progress.lastOpenedAt`, highlight/annotation `createdAt`) |
| Captures created | `captures.createdAt` |
| Decisions created/updated | `decisions.createdAt` / `updatedAt` |
| Beliefs revised | belief `revisions[].at` or `updatedAt` |
| Entities inspected, searches performed | session `activity` events |
| Unresolved conflicts / unsynced changes | live sync status (passed in, not from `StoreState`) |

Every item links back to its source record. The projection never writes.

---

## 4. Wins, lessons & friction

- **Wins** (Feature 4) are manual only. The day summary *suggests* sources
  (completed milestones, decisions, advanced projects) as one-tap prefills, but a
  win is never auto-written. A win links to any record (goal / project /
  milestone / session / workspace / knowledge entity).
- **Lessons** (Feature 5) are manual, link to the records they came from
  (document / passage / highlight / annotation / belief / decision / research /
  session), and can be **converted into a capture** — an existing canonical
  creator. LifeOS never creates a new knowledge subtype merely for lessons.
- **Friction** (Feature 6): `description`, `severity` (low/medium/high), `area`
  (navigation / clarity / workflow / sync / mobile / performance / content /
  planning / other), optional `linkedEntity`, `resolved`, `resolutionNotes`. It
  feeds the UX-audit workflow, **not analytics**; the weekly rollup surfaces
  repeated friction areas so patterns are visible without any scoring.

---

## 5. Open-loop rules

`deriveOpenLoops(state, live)` suggests unfinished threads; **the user chooses**
which belong in the review. Candidates:

- in-progress sessions (no `endedAt`)
- incomplete milestones in non-completed projects
- active projects
- unresolved decisions (status not `decided`/`abandoned`)
- unfinished reading (documents `reading`/`paused`)
- unresolved sync conflicts and unsynced local changes (live signals)
- plus manually-added loops

Choosing or removing a loop **never** marks any record complete or incomplete —
it only records the user's selection on the review.

---

## 6. Tomorrow-focus behavior

A small, **user-ordered** set of next-focus intentions (Feature 8). LifeOS never
assigns priority automatically and never creates deadlines — order is the user's
manual arrangement (move up/down). Each item may reference a goal / project /
milestone / workspace / document / entity, or be free text. Suggestions (active
projects, active goals, in-progress reading) are optional.

From a **completed** review, "Start tomorrow" (Feature 9) offers actions that
**reuse existing systems** only — resume a project, open a workspace, open a
document, inspect an entity, or start a planning session in the project's
workspace (via the existing `startProjectSession`). No navigation or session
logic is duplicated.

---

## 7. Weekly-rollup projection

`buildWeeklyRollup(state, weekStart)` is a deterministic **projection** over the
week's daily reviews + activity — completed reviews, missed review days (past),
sessions and time by workspace, goals/projects touched, milestones, reading,
captures, decisions, repeated friction areas (count ≥ 2), and unresolved open
loops. **No scoring, no productivity rating, no recommendations.** It is
**not persisted** — computed on view with prev/next navigation.

---

## 8. Local-date & timezone semantics

Day boundaries follow the **user's local calendar date**, stored as a plain
`date` (yyyy-mm-dd) **separate from timestamps** (`lib/reviews/dates.ts`).

- Runtime helpers (`todayKey`, `dayBoundsLocal`) use the engine's own local
  timezone via `Date`'s local getters/constructor, which is **DST-correct** by
  construction (a spring-forward day is genuinely 23h, fall-back 25h). We never
  hardcode a UTC day boundary.
- Pure offset helpers (`localDateKeyAtOffset`, `dayBoundsAtOffset`) take an
  explicit "minutes east of UTC" so the day-summary and self-tests are fully
  deterministic regardless of the host timezone.
- **Duplicate prevention** keys on the STORED `date`, never a recomputed one, and
  is enforced by a database `unique (user_id, date)` constraint. So changing
  timezones or the clock can never fork a second review for a day that already
  has one.
- **Timezone travel:** the same instant can be a different local date in two
  zones (e.g. 02:00 UTC is the 27th in Tokyo but the 26th in Los Angeles). The
  review's identity is its stored `date`; travelling does not retroactively move
  an existing review or create a duplicate. New reviews created after travel use
  the new local date, as expected.

---

## 9. Sync behavior

Daily reviews are first-class, user-owned, synced records. They ride the existing
LIFEOS-033 sync layer: row-level dirty-domain upsert/delete in the Supabase
adapter, deletes tombstoned under domain `dailyReviews`, and three-way conflict
handling like any other record. Because a review only ever references other
records (never owns them), a review conflict is resolved independently of the
records it mentions.

---

## 10. Privacy boundaries

The day summary, open-loop derivation, and weekly rollup read only local record
metadata and never transmit anything on their own. The `daily_reviews` row stores
the user's own words plus id-references; RLS restricts every row to its owner.
Diagnostics never expose review content.

---

## 11. Known limitations

- Two-device review conflict is handled by the generic sync layer; a live
  two-device demonstration is credential-pending in this environment.
- The weekly rollup recomputes per view (not cached); a full-year (52-week) scan
  over a very large store is bounded but not instant — a single week is fast
  (< 250ms over 5k records; see the perf self-tests).
- Lesson→capture conversion targets the capture creator specifically; other
  canonical targets can be added later without a new subtype.
- Friction feeds the UX audit as structured entries; there is deliberately no
  automated triage or scoring.

---

## 12. Tests

- **Self-tests:** `lib/reviews/selftest.ts` — 56 assertions at `/dev/review-tests`
  (`#review-selftest-summary`).
- **E2E:** `dailyreview.mjs` — 27 checks (start/save-midway/reload-continue/
  complete/reopen, link a project, friction, choose open loops, order tomorrow
  focus, start a session from focus, history, weekly rollup, command center,
  Today integration, duplicate-date prevention, mobile, keyboard).
- **Migration:** `0025` validated on Postgres 16 — idempotent 3×, four RLS
  policies, `unique(user_id, date)` enforced, cross-user isolation.
