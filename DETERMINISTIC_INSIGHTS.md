# Deterministic System Insights (LIFEOS-039)

LifeOS records a great deal of activity: sessions, focus intervals, actions
moving through their lifecycle, captures flowing out of the inbox, documents
opened, beliefs reviewed, records maintained, daily reviews completed. This
layer turns that already-recorded activity into **calm, descriptive views**.

> What received attention? What changed? What was completed? What remained
> open? Which projects, goals, and ideas generated activity? Where did captures
> flow? What knowledge was revisited? What patterns are visible across time?
> What has not been touched?

**The system reports what happened. It does not decide what was good, bad,
productive, important, or optimal.** Every view is a pure function of
`StoreState` for a user-selected date range. There is no AI, no embeddings, no
semantic interpretation, no automatic recommendations, no prioritization, no
predictions, no forecasts, no productivity or health scores, no streaks, no
gamification, no leaderboards, no social comparison, no notifications, and no
surveillance.

> **Insights describe recorded activity. They do not judge the person living
> it.**

---

## 1. Descriptive-only philosophy

Every number on every insights surface is one of three things:

- a **count** of events that actually occurred (`3 sessions`),
- a **duration** summed from recorded intervals (`4h 0m focused`), or
- an **arithmetic difference** between two such values (`+3`, `-2 fewer`).

There is no fourth kind. In particular there is:

- **no composite score** — nothing multiplies counts into a single "productivity"
  or "health" number;
- **no ranking that the system asserts** — projects, goals, and records are
  listed; the *user* chooses the sort; the system never says one is doing
  "better";
- **no interpretation of language** — a busy record is "referenced 12 times,"
  never "important"; a quiet record is "no recorded activity in 90 days," never
  "neglected," "stale," or "abandoned";
- **no direction judgment** in comparisons — "12 sessions, previously 9," never
  "improved," "declined," "better," "worse," "ahead," or "behind."

Metric labels, comparison phrasing, and dormancy wording are enforced by
self-tests (§9) that fail if a banned word appears.

---

## 2. Where the code lives

```
lib/insights/
  range.ts          time-range model: kinds, resolution, inclusivity, previous
  activity.ts       THE unified range-bounded activity index + eventsInRange
  coverage.ts       data-coverage disclosures (history start, open sessions…)
  metrics.ts        Insights Home metrics + formatDuration
  definitions.ts    plain-language definition for every metric key
  memory.ts         remembered range + dormancy threshold (prefs-backed)
  attention.ts      attention grouped by workspace/goal/project/…/focus target
  projects.ts       per-project raw measures
  goals.ts          per-goal raw measures (attributed via goalId / project.goalId)
  actions.ts        action-flow counts + transitions
  captures.ts       capture-flow outcomes, %, median delay, oldest unprocessed
  reading.ts        reading activity (opens, citations, notes, links)
  knowledge.ts      knowledge activity + raw backlink counts
  reviews.ts        daily-review history (absence, never streaks)
  focus.ts          focus activity (durations, interruptions, open sessions)
  change-log.ts     chronological event log + filters (reuses compact history)
  period-summary.ts Started/Continued/Completed/Changed/… from explicit rules
  comparison.ts     two-period raw values + abs/pct diff, neutral phrasing
  dormancy.ts       records with no activity past a user threshold
  contributions.ts  bounded hierarchy edges for the period (never whole graph)
  relationships.ts  per-record activity (Inspector Activity section)
  export.ts         CSV / JSON with range + timezone + filters + timestamp
  search.ts         factual activity filter sets (Feature 23)
  merge-rules.ts    saved-view sync merge (union / conflict detection)
  selftest.ts       97 assertions across 18 sections

components/insights/
  useInsights.ts    shared hook: builds the index + range once per snapshot
  RangePicker · CoverageNotice · MetricCard · MetricDefinitions · ExportButtons
  InsightsHome · AttentionView · ProjectActivity · GoalActivity · ActionFlow
  CaptureFlow · ReadingActivity · KnowledgeActivity · ReviewActivity
  FocusActivity · ChangeLog · PeriodSummary · PeriodComparison · DormancyView
  ContributionMap · TodayInsightsCard · InspectorActivity · PlanningInsightsContext

app/insights/                page.tsx + 14 subroutes
app/dev/insights-tests/      self-test harness page
```

No new state manager was introduced. Every surface reads the existing
module-level `mvpStore` through `useInsights()`.

---

## 3. The unified activity index (architecture)

The spec's central performance instruction is *"create one range-bounded
activity index and derive views from it."* That is exactly what
`lib/insights/activity.ts` does.

`buildActivityIndex(state)` flattens **all existing compact histories** —
sessions, focus sessions, action history, planning-assignment history, capture
history, reading/citation events, belief and concept history, research touches,
daily reviews, and maintenance events — into a single, time-sorted
`ActivityEvent[]`:

```ts
interface ActivityEvent {
  at: string;            // ISO timestamp
  type: string;          // "session", "action.completed", "capture.processed"…
  recordKind: string;    // "session" | "action" | "capture" | …
  recordId: string;
  workspaceId?: string; goalId?: string; projectId?: string; milestoneId?: string;
  durationMs?: number;   // present for interval events (sessions, focus)
  detail?: string;
}
```

- The index is built **once per store snapshot**, memoized in `useInsights()`
  with `useMemo(..., [state])`. Every card, table, and comparison on a page
  reuses the same array — no card re-scans the raw domain arrays.
- `eventsInRange(index, range)` returns the slice for a range using **binary
  search** on precomputed numeric timestamps, so range filtering is
  `O(log n + k)` rather than a full scan.
- The final sort precomputes numeric timestamps (`{e, t: num(e.at)}`) to avoid
  `O(n log n)` `Date.parse` calls.

Because the index is derived from existing histories, **no activity is
duplicated in the database** (§7).

---

## 4. Time-range model

`lib/insights/range.ts` implements canonical **local-date** semantics.

Supported kinds: `today`, `last_7_days`, `last_30_days`, `this_month`,
`last_month`, `this_year`, `custom`.

- **Explicit start and end.** `resolveRange(kind, {today, customStart,
  customEnd, offsetMinutes})` returns a `ResolvedRange` with `startKey`,
  `endKey` (both `YYYY-MM-DD`), and `startMs`/`endMs` numeric bounds.
- **Deterministic inclusivity.** A range covers `[start-of-startKey,
  end-of-endKey)` — the start day is included from midnight, the end day is
  included through its final millisecond, computed as the exclusive start of the
  *next* day. `last_7_days` means today plus the previous six local days
  (7 calendar days inclusive), never a rolling 168-hour window.
- **DST-safe.** Day boundaries are computed from local calendar dates via
  `dayBoundsLocal` / `dayBoundsAtOffset`, not by adding fixed millisecond
  offsets, so a 23- or 25-hour DST day still maps to exactly one day key.
- **Timezone travel.** Ranges are resolved from the device's current local date
  at view time. If you cross timezones, "today" follows the new local date; a
  previously saved custom range keeps its explicit `YYYY-MM-DD` bounds
  unchanged. The coverage notice discloses that day assignment uses local time.
- **No hidden rolling windows.** Every view resolves its range through the same
  `resolveRange`, so two views set to "last 30 days" cover identical bounds.
- **`previousRange(range)`** returns the contiguous, equal-length window
  immediately before the current one — the basis for Compare Periods (§ Feature 14).

The last selected range is persisted (§Preference persistence) and re-adopted
after mount (never in the `useState` initializer, to keep SSR hydration-safe).

---

## 5. Coverage model

`buildCoverage(state, index)` returns disclosures shown by every view via
`<CoverageNotice/>`:

- **History start** — "Session history begins on March 12, 2026." (the earliest
  recorded event), so an empty early range is understood as *before records
  began*, not as inactivity.
- **Open sessions excluded** — "Two sessions remain open and are excluded from
  completed-duration totals." Interval metrics only sum intervals that have
  ended within the range.
- **Local-only** — "This view includes locally available synced records."
- **Deleted-via-history** — "Deleted records may appear only through retained
  history events."

Partial data is never presented as complete without qualification.

---

## 6. Feature-by-feature behavior

- **Insights Home** — 15 range metrics (sessions, session duration, focus
  sessions, focused duration, actions created/completed, captures
  created/processed, projects/milestones touched, documents opened, reading
  events, beliefs reviewed, maintenance events, daily reviews). Counts and
  durations only; no composite score.
- **Attention View** — activity grouped by workspace / goal / project /
  milestone / action / document / knowledge entity / focus target. Measures:
  session count, recorded duration, focus-session count, last-touched date,
  related-activity count. Never labeled value / importance / priority.
- **Project Activity** — sessions, focused time, actions
  created/started/completed, captures linked, documents opened, milestones
  touched, planning movements, maintenance events, last activity. Raw measures
  only; user-sorted; never "neglected" or "successful."
- **Goal Activity** — projects/milestones/actions linked, sessions, focus,
  completions, captures, reading, knowledge references, last activity.
  Attributed via `goalId` or a linked project's `goalId`. No score, prediction,
  or health status.
- **Action Flow** — counts for created / started / waiting / deferred /
  completed / cancelled / restored, plus transitions in the period. No velocity
  score; more completions are never implied to be "better."
- **Capture Flow** — outcome distribution with counts and percentages, median
  processing delay, oldest unprocessed capture, and source distribution where
  explicitly stored. No quality judgments.
- **Reading Activity** — documents opened, reading sessions, recorded progress,
  citations created, notes, entities/beliefs linked, last-opened dates,
  unfinished reading selected in planning. No comprehension or quality
  inference.
- **Knowledge Activity** — entities/beliefs created, beliefs reviewed, citations
  and relationships added, research touched, maintenance events, merged/archived
  records, and most-referenced records by **raw backlink count** (clearly
  labeled). Frequently referenced ≠ "important."
- **Review Activity** — completed reviews, open loops, tomorrow-focus
  selections, friction entries, maintenance decisions, interruptions, items
  carried forward. Missed days appear only as **absence of records** — never
  streaks, shame, or failure language.
- **Focus Activity** — focus sessions, total and median recorded duration,
  targets used, interruptions, sessions ended normally vs left open, actions
  completed and documents opened during focus. No distraction or deep-work
  score.
- **Change Log** — chronological event list reusing compact-history events,
  filterable by record type, workspace, goal, project, event type, and date
  range. It links to records; it does not duplicate full record contents.
- **Period Summary** — Started / Continued / Completed / Changed / Reviewed /
  Learned / Deferred / Waiting / Archived, each generated from explicit event
  rules. No generated prose, narrative, or recommendations.
- **Compare Periods** — raw value in each period, absolute difference, and
  percentage difference **only when the denominator is non-zero**. Neutral
  phrasing ("12 sessions, previously 9"; "3 fewer completed actions"). Never
  improved / declined / better / worse / ahead / behind.
- **Dormancy View** — records (projects, goals, milestones, actions, documents,
  research, beliefs, entities) with no activity past a **user-chosen** threshold.
  "No recorded activity in 90 days." Never abandoned / stale / neglected /
  unhealthy unless that is an explicit stored status. Activity is attributed
  through linked events, so an idle project with a recently touched action is
  not flagged.
- **Contribution Map** — a **bounded** set of hierarchy edges for the selected
  period (session→action, action→milestone, milestone→project, project→goal,
  capture→action, document→citation, citation→belief, focus→target). It never
  renders the whole graph and never infers causation.
- **Export** — CSV (tabular) and JSON (structured) of the current view, each
  including selected range, timezone, filters, generation timestamp, raw values,
  and clear field names. No hidden derived scores, because none exist.

---

## 7. Database (migration 0030)

We first confirmed the existing compact histories already carry everything the
views need. They do — so **no event warehouse and no second analytics table
were created.** Insights are derived at read time.

`0030_deterministic_insights.sql` adds exactly one table, `saved_insight_views`,
storing **display intent only**:

| column | purpose |
| --- | --- |
| `id` uuid PK | stable saved-view identifier |
| `user_id` uuid | `default auth.uid()`, FK → `auth.users` on delete cascade |
| `name` text | user label |
| `insight` text | which view (`home`, `attention`, `compare`, …) |
| `range_kind` text | default `'last_7_days'` |
| `custom_start` / `custom_end` date | for custom ranges |
| `grouping` text | e.g. attention grouping |
| `filters` jsonb | default `'{}'` |
| `created_at` / `updated_at` timestamptz | timestamps |

A saved view **never stores calculated results** — only the range, filters, and
grouping needed to *recompute* the view. This guarantees a saved view can never
display stale numbers.

Properties: additive, idempotent (`create table if not exists`, guarded policy
creation), RLS-protected, indexed (`user_id`, `insight`, `updated_at`),
sync-compatible, tombstone-compatible, orphan-safe (cascade only from the owning
user), no destructive cascades onto activity records. The migration chain
`0001…0030` was applied three times in sequence on Postgres 16 with no drift.

---

## 8. Sync & conflict rules

Saved views sync through the existing adapter (`loadInsightViews` /
`syncInsightViews`, diff-by-id + tombstones). `lib/insights/merge-rules.ts`
governs merges:

- **Safe (union / auto-merge):** views created independently on different
  devices; a one-sided edit (only local or only remote changed); unrelated
  preferences.
- **Conflict (surfaced, never silently resolved):** the same view edited
  differently on both sides; a view deleted on one side and edited on the other
  (the edit is kept and the conflict is flagged); custom range or grouping
  changed differently.
- An unchanged-vs-deleted view honors the delete.
- The same saved-view id is **never duplicated**, and an insights merge **never
  alters source activity records**.

---

## 9. Testing

**Self-tests — `lib/insights/selftest.ts`, 97/97 passing** across 18 sections:
range inclusivity, local-date semantics, DST transitions, timezone travel,
coverage detection, session metrics, open-session exclusion, attention grouping,
project/goal activity, action transitions, capture flow, reading/knowledge/
review/focus activity, change-log ordering, period-summary rules, period
comparison, zero denominators, dormancy thresholds, contribution relationships,
inspector activity, search filters, metric definitions, preference persistence,
saved-view merge rules, export accuracy, history deduplication, and performance.
Determinism is achieved with `offsetMinutes: 0` and a fixed `today`.

**E2E — `insights.mjs`, 33/33 passing** against the production build: open
Insights, change/custom date range, coverage notice, Attention View, filter by
project, Project Activity, Action Flow, Capture Flow, Knowledge/Review/Focus
Activity, Change Log + filter, Period Summary, compare two periods, empty
comparison, Dormancy View + threshold change, Contribution Map, metric
definitions, export CSV/JSON, Today/Daily-Review/Planning integration, Inspector
activity, Command Center commands, search filters, preference restoration,
mobile insights, offline saved view, two-device saved-view conflict, partial
sync coverage notice.

**Full regression — 758/758 assertions** across all 14 self-test suites,
including the pre-existing 13 suites (no prior test was weakened).

---

## 10. Performance

Realistic fixture in the self-test: 20,000 actions, 5,000 sessions, 10,000
captures over a year → **~35,000 activity events**. On the CI container:

| operation | measured |
| --- | --- |
| build activity index (~35k events) | **85 ms** (budget < 400 ms) |
| Insights Home metrics | **34 ms** (budget < 150 ms) |
| Attention View | **19 ms** (budget < 200 ms) |
| Change Log | **11 ms** (budget < 200 ms) |

The index is built once and shared; range filtering is a binary-searched slice;
projections are memoized. No view scans every record separately per card.

---

## 11. Privacy boundaries & known limitations

- **Local-first and private.** Insights compute in the browser from local
  state. Nothing is sent anywhere for analysis; there is no telemetry, no
  server-side scoring, and no cross-user comparison.
- **Coverage is honest.** Views disclose history start, excluded open sessions,
  local-only scope, and deleted-via-history caveats rather than implying
  completeness.
- **Local-only unsynced records** on other devices are not counted until they
  sync; the coverage notice says so.
- **Timezone travel** re-anchors "today" to the current local date; historical
  events keep their recorded timestamps, so a range that straddles a move may
  attribute a boundary event to the day it was local at recording time.
- **Deleted records** contribute only through retained history events; their
  current details are gone by design.
- The Contribution Map is deliberately **bounded** to the period and does not
  attempt a full-graph or causal analysis.

---

## 12. Integrations

- **Today** — a compact `TodayInsightsCard` (sessions, focus time, actions
  completed, captures processed today) that stays small and returns nothing when
  the day has no activity yet.
- **Daily Review** — a factual day snapshot linking to the full Period Summary;
  no praise or criticism.
- **Planning** — `PlanningInsightsContext` shows last-touched and in-range
  factual context; it never reorders the board, alters horizons, or recommends
  what to plan.
- **Inspector** — an `InspectorActivity` section (created/last-edited/last-opened/
  last-reviewed/last-session, in-range sessions, focus duration, linked activity
  count, recent history) with links to full activity and the change log.
- **Command Center** — Open Insights / Attention View / Project Activity /
  Capture Flow / Knowledge Activity / Review Activity / Change Log / Compare
  Periods, plus a contextual "Activity for current record."
- **Search** — factual filters: touched / untouched / created / completed /
  reviewed / opened within range, has sessions, has focus sessions. No
  behavioral ranking is added to results.

---

## 13. Metric definitions

Every displayed metric has a plain-language definition in
`lib/insights/definitions.ts`, surfaced through the `MetricDefinitions` drawer
and per-card affordances. Examples:

- *Focused duration* — the sum of recorded focus-session intervals ending within
  the selected range.
- *Project touched* — at least one linked event occurred during the selected
  range.
- *Captures processed* — captures whose processing outcome was recorded within
  the range.

No metric exists only as undocumented implementation behavior.

## Addendum — security & export (LIFEOS-040)

This subsystem's records are covered by the LIFEOS-040 hardening: they sit behind
Postgres **RLS** (audited so a new table can't ship without it), are included in
the complete **account export** (deterministic JSON with checksums, no secrets),
are restorable via the previewed, non-destructive **import/restore** flow, and
appear in the **Recovery Center** where they support discard/archive. Inputs are
size-limited and plain-text-first; external links are protocol-allowlisted;
diagnostics and errors never carry this subsystem's contents. See
`SECURITY_AND_PRIVACY.md` and `BACKUP_AND_RECOVERY.md`.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
