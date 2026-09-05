# LIFEOS-092 — One Daily Review Surface

**North star:** Conqify should have one clear place to close a day, not two
competing review experiences.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `8af0e0a78db0c3fd460076f046aa543d1e34b7c2` (PR #97 merged) |
| Branch | `claude/lifeos-092-one-daily-review` |
| Migration required | **no** — surface consolidation only (§33) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Both surfaces run against the same seeded day in a real browser, not read.
Probe: `.probe92.cjs` (scratchpad).

## 1.1 The two surfaces, mapped

| | **`/today/review`** (LIFEOS-091) | **`/daily`** (LIFEOS-034) |
|---|---|---|
| Route | `/today/review` | `/daily`, `/daily/[date]` |
| Shape | one scroll, five sections | seven-step wizard, Back/Skip/Next |
| Derivation | `buildEveningClose` (081/082/084/073) | `buildDaySummary` (034) |
| Completion | completions + resolved waits + goal movement | "Actions completed · N" |
| Changed | defer / reschedule / direction / other, split | "Actions deferred · N" |
| Still open | attention shortlist, capped at 3 | "Open loops" — a picker, not a status |
| Waiting | resolved vs still-waiting, split | — |
| Tomorrow | scheduled vs carry-forward, split | "Tomorrow's focus" — a text list |
| Carry-forward | real, through `planReplan` | — |
| Reflection | one optional sentence → `Reflection` | wins / lessons / friction / notes → `DailyReview` |
| Date selection | prev/next buttons, local state | `/daily/[date]` — **bookmarkable** |
| Persistence | **nothing** | **creates a record on visit** |
| Action mutations | full LIFEOS-071/090 resolver on every row | **none at all** |
| Entry points | 1 | 9 |

## 1.2 A — What `/daily` uniquely does

1. **Structured journaling**: wins, lessons, friction as separate lists, plus a
   free-text summary and notes, saved on a `DailyReview` record.
2. **A bookmarkable date** — `/daily/2026-09-04` is a URL. The evening close's
   previous-day control is local state, so a past day cannot be linked to.
3. **Open-loop selection** — choosing which loops belong to *this review*.
4. **Tomorrow's focus** — a manually ordered intention list.
5. **A completion lifecycle** — `not_started → in_progress → completed`, with
   history at `/daily/history`.

Of these, (2) is a genuine capability the canonical surface lacks. (1) and (3)
and (4) write *review-record text*; none of them touch a commitment.

## 1.3 B — What Evening Close uniquely does

Everything the day actually contains: goal movement, the defer/reschedule
distinction, direction changes, the repeated-deferral count, resolved vs open
waiting, a bounded still-open list, tomorrow split from carry-forward, and a
carry that goes through LIFEOS-090's replanning layer. Plus provenance-filtered
reflections and a quiet-day state.

## 1.4 C, D — Duplication and contradiction

### RED 1 (§20) — Today shows two "Review today →" links to different pages

Measured on `/today`:

```
[ { "text": "Review today →",                    "href": "/today/review" },
  { "text": "Review this week",                  "href": "/memory"       },
  { "text": "Review today →",                    "href": "/daily"        },
  { "text": "Choose loops for today's review →", "href": "/daily?step=openLoops" } ]
```

**Two links with an identical label, going to different surfaces, on one page.**
**Confirmed.**

### RED 2 (§34.3, §8) — the two surfaces disagree about the same day

Same seeded day, same moment:

```
/daily         0 sessions · 0m · 3 items
               Actions completed · 2
               Actions deferred  · 1

/today/review  3 completed · 1 deferred · 1 rescheduled · 4 other changes ·
               3 still open · 1 waiting
```

`/daily` misses the resolved wait, the reschedule, the goal horizon change, the
achieved goal and the adopted standard — and calls the day "3 items". Two
derivations of "what happened today", giving different answers. **Confirmed.**

### RED 3 (§2, §16) — visiting `/daily` writes a record you did not ask for

```
/today/review : dailyReviews 0 -> 0
/daily        : dailyReviews 0 -> 1
   created: { "status": "not_started", "summary": "", "wins": [], … }
```

`getOrCreateReviewForDate(date)` runs in a mount effect. Opening the page to
*look* creates a `not_started` review, which then appears in history and in
`/insights/reviews` as something the user began and abandoned. LIFEOS-073 wrote
the opposite rule for `/today/review` — "creates nothing by being visited" — and
both rules are live at once. **Confirmed.**

### RED 4 (§28) — the command palette exposes three doors, none canonical

```
Open Daily Review     -> /daily
Start daily review    -> /daily
Continue daily review -> /daily
```

`/today/review` appears in the palette **not at all**. **Confirmed.**

### RED 5 (§22) — navigation names the older surface

`Nav.tsx` carries `{ href: "/daily", label: "Daily Review" }`. The canonical
surface has no navigation presence. Onboarding's review step also points at
`/daily` ("Open Daily Review"). **Confirmed.**

### RED 6 (§15) — reflection exists twice, writing different records

`/daily` asks four questions (summary, wins, lessons, friction) and writes them
onto a `DailyReview`. `/today/review` asks one optional question and writes a
`Reflection` through the existing path. Two places to "say something about
today", with different persistence and different provenance. **Confirmed.**

### RED 7 (§13) — tomorrow exists twice, with different meanings

`/daily` step 6 is a manually ordered "focus" text list. `/today/review` splits
what tomorrow already holds from what may be carried, and carrying goes through
`planReplan`. **Confirmed.**

### RED 8 (§23) — three names for one thing

"Daily Review" (nav, palette, onboarding), "Review today" (Today, the evening
heading), "Review history" / "Weekly rollup" (`/daily/*`). **Confirmed.**

## 1.5 Not reds — measured, and recorded rather than manufactured

* **§34.4 — the wizard has NO action-mutation paths.** It imports
  `addReviewWin`, `addReviewOpenLoop`, `addReviewFocus` and friends, and not one
  setter that touches a `NextAction`. There is nothing here bypassing 090/091,
  because there is nothing here replanning at all. The brief anticipated this
  red; the evidence does not support it.
* **§34.5 — the wizard does not force completion.** Every step has a Skip, steps
  can be jumped freely, and there is no progress meter or percentage anywhere.
  §16's defect is absent.
* The *consequence* of both is the real finding: the wizard's "open loops" and
  "tomorrow's focus" cannot close a loop or move work. They record a note about
  it. That is why it is the weaker surface, not because it is unsafe.

## 1.6 E, F — What is weaker on each side

**Weaker in `/daily`:** the derivation (RED 2), the persistence semantics
(RED 3), pagination on mobile, no real replanning, no carry-forward, no
provenance filter on "your words", and a second vocabulary for the same day.

**Weaker in `/today/review`:** exactly one thing — **the day is not
addressable**. `previousDay` is React state, so a past day cannot be linked,
bookmarked or shared. `/daily/[date]` can.

## 1.7 G — Which mutations are implemented twice

**None.** The two surfaces write disjoint record types: `/daily` writes
`DailyReview` fields; `/today/review` writes actions (through 090) and
`Reflection`. §9's consolidation target does not exist as stated — which is
worth saying plainly rather than inventing work to match the brief.

## 1.8 H — Which review should be canonical

**`/today/review`**, on the evidence: it is the only one whose account of the
day is complete and internally consistent, the only one that can actually close
a loop, and the only one that creates nothing by being read.

## 1.9 I — What can be deleted, and what must not be

`dailyReviews` is **not** a dead domain. It is read by the sync adapters, backup
and versioning, the entity system and backlinks, command records, insights,
the planning inbox, today-plan, release fixtures and the security authorization
audit. Deleting the record type would be a migration (§33 forbids one) and would
orphan every review a user has already written.

So the consolidation is at the **surface**, not the schema:

| Delete | Keep |
|---|---|
| `DailyReviewFlow` and its five step components | the `DailyReview` record type |
| `DaySummary` (the wizard's own derivation) | `/daily/history` — reads past reviews |
| `TodayReviewCard` (Today's duplicate CTA) | `/daily/week/[start]` — a weekly rollup |
| `deriveOpenLoops`, `focusSuggestions`, `startTomorrowActions` | the store's review primitives |

`buildDaySummary` stays: `lib/reviews/weekly-rollup.ts` still uses it.

The store's review mutations stay too. They are not *duplicate* paths — nothing
else writes a review record — and removing live persistence for a synced,
exported, backlinked domain is a far larger change than this sprint's remit.

## 1.10 J — The smallest safe consolidation

1. `/today/review` accepts `?date=` — absorbing the one thing `/daily` did
   better (§7, §17).
2. `/daily` and `/daily/[date]` become intentional redirects to it (§5, §27).
   No 404, no broken bookmark, and `/daily/2026-09-04` lands on that day.
3. Every entry point — nav, palette, onboarding, Today, review history —
   converges on the canonical route (§6, §20, §22, §28).
4. The wizard UI is deleted; the record type, its history and its rollup stay.
5. One vocabulary: **"Review today"**, which is already `REVIEW_TODAY_LABEL`.

## 1.11 Migration (§33)

**None.** No schema is added, changed or removed. Head stays at **0047**;
`0048` is not written.

---

# 2. The decision (§3)

**`/today/review` is canonical.** It is the only surface whose account of the
day is complete and internally consistent, the only one that can actually close
a loop, and the only one that creates nothing by being read.

`/daily` was not kept because it existed. It was measured against the same day
and lost on every axis but one.

# 3. Unique value preserved (§7, §17)

**The addressable day.** `/daily/2026-09-04` was a URL; the evening close's
previous-day control was React state, so a past day could not be linked,
bookmarked or shared. The canonical route now takes `?date=`, validates it with
`isDayKey`, and falls back to today rather than erroring — and `/daily/[date]`
hands its day across the redirect, so a bookmark from a year ago still lands on
the day it named.

**Past reviews stay readable.** `/daily/history` and `/daily/week/[start]` keep
working, and `reviewHref` now points at the canonical route so entity links,
backlinks and insight rows reach the page directly instead of through a
redirect hop.

**Not preserved:** wins / lessons / friction as separate structured lists. §15
prefers one optional reflection path unless the audit proves unique value, and
what those steps produced was review-record text that no other surface reads.
Existing entries remain readable in history. This is a real product tradeoff and
it is listed under known gaps rather than waved through.

# 4. Duplication removed (§8, §26)

| Removed | Why |
|---|---|
| `DailyReviewFlow` + 5 step components | the second daily review |
| `DaySummary` | the second day derivation |
| `TodayReviewCard` | Today's duplicate "Review today →" |
| `lib/reviews/open-loops.ts` | second "what is unresolved" — 082 answers it |
| `lib/reviews/tomorrow-focus.ts` | second "what next" — 072/091 answer it |
| `startTomorrowActions` | read focus lists nothing produces now |
| `REVIEW_STEPS` contents | a stepped vocabulary for a surface with no steps |

**Deliberately kept:** the `DailyReview` record type and the store primitives
that write it. `dailyReviews` is read by the sync adapters, backup, versioning,
the entity system and backlinks, command records, insights, the planning inbox,
today-plan, release fixtures and the security authorization audit. Deleting it
would be a migration (§33 forbids one) and would orphan every review already
written. `buildDaySummary` stays too — `weekly-rollup.ts` still uses it.

# 5. Route strategy (§5, §27)

```
/today/review          canonical; ?date= selects the day
/today/review?date=…   a past day, addressable
/daily                 → replace → /today/review
/daily/[date]          → replace → /today/review?date=<date>
/daily/history         unchanged — past reviews
/daily/week/[start]    unchanged — weekly rollup
```

`router.replace`, not `push`, so Back does not land on a dead route. Both
redirects return 200 and render a one-line fallback with a real link, so a
reader is never stranded if the client-side navigation is slow.

# 6. Mutation paths (§9)

The audit found nothing to consolidate here, and says so: the wizard imported no
setter that touched a `NextAction`. Its "open loops" and "tomorrow's focus" wrote
review-record text.

What §9 *did* protect is the canonical surface, and assertion 92.35 states it:
carrying work goes through `planReplan` and `deferAction` is not called directly
anywhere on the page. Mutation **M14** reintroduces the direct call and is
caught.

# 7. Reflection (§15, §16)

One optional prompt — "Anything about today worth remembering?" — writing a
`Reflection` through the existing path with the prompt preserved as provenance.
Offered for today only. There is no progress meter, nothing marked incomplete,
and no second journaling flow beside it (browser 27–32). Mutation **M13** adds
"Step 3 of 7 — required" and is caught twice.

# 8. Navigation and copy (§22, §23, §28)

One vocabulary: **"Review today"**, which was already `REVIEW_TODAY_LABEL`.

```
before                          after
nav      "Daily Review" → /daily        "Review today" → /today/review
palette  Open Daily Review    → /daily  Review today        → /today/review
         Start daily review   → /daily  Open review history → /daily/history
         Continue daily review→ /daily
         Complete daily review→ /daily/<today>?step=complete
         Reopen daily review  → /daily/<today>
Today    "Review today →" ×2, two targets   "Review today →" ×1
```

The palette's `reviewProvider` branched on a `DailyReview` lifecycle that no
surface can advance any more: it offered "Complete daily review" pointing at a
step that no longer exists, and "Reopen daily review" for a record nothing can
edit. A palette entry for an impossible action is the same defect as a button
announcing a mutation it never made.

# 9. Visual findings (§37)

Eight states: Today, the canonical review, quiet, dense, yesterday,
tomorrow-heavy, the redirect, and mobile.

**V1 — a button that named the wrong day.** Reviewing Friday, the page offered
"Tomorrow · Possible carry-forward · Carry to tomorrow", and the press moved the
work to the day after **today**. The action was right — you cannot schedule into
a day that has gone — and the word was wrong. On a past day the section is now
"Carry forward", the sub-heading names the target, and the button reads "Carry
to Sun, Sep 6". `planReplan` is also given `today` rather than the reviewed day,
so the intent and the label agree by construction rather than by coincidence.

**V2 — "Review friday, sep 4".** `.toLowerCase()` on a formatted date, so that
"Review today" would read naturally. They were always two different sentences.

**Checked and clean:** no stepper anywhere, no "Back / Skip / Next" on mobile,
no duplicate titles, no second review call-to-action, and no "close the day"
button on a page that is already closing the day.

**Recorded, out of scope:** Today's "TODAY SO FAR" tile still reports "Actions
completed · 1" in its own vocabulary. It agrees with the review — it is an
insights preview, not a second daily review — so it is not a contradiction, but
it is a third place a count of the day appears.

# 10. Performance (§39)

```
                canonical      via /daily redirect    previous day
n=  100         189ms          200ms                  77ms
n= 1000         297ms          273ms                  205ms
n= 5000         945ms          966ms                  596ms
```

The 091 baseline was 223 / 270 / 1056ms for first render. The canonical route is
the same work plus a `useSearchParams` read, and measures at or slightly below
that baseline. **The redirect costs ~10ms**, which is the client-side navigation
and not a second render. No page errors at any size.

# 11. Known gaps

1. **Structured journaling is gone.** Wins, lessons and friction as separate
   lists have no writer any more. Past entries stay readable at
   `/daily/history`; new ones would have to be typed into the one reflection
   sentence. This is the tradeoff §15 asked for, made deliberately.
2. **The store still exposes wizard primitives.** `addReviewWin`,
   `addReviewFocus`, `startDailyReview` and friends are live and unused by any
   surface. They are not duplicate mutation paths — nothing else writes a review
   record — and removing persistence for a synced, exported, backlinked domain is
   a larger change than this sprint's remit.
3. **`/daily/week/[start]` and `/memory` both review a week.** Out of scope: §21
   and §30 say not to rewrite Weekly Review, so the overlap is recorded rather
   than resolved.
4. **Today's "TODAY SO FAR" tile** — §9 above.

# 12. Gates (§40)

| Gate | Result |
|---|---|
| Deterministic — full regression | **5751/5751** across 56 suites, none failing |
| `reviews/consolidation` selftest | **55/55** |
| §35 browser torture (092) | **59/59** |
| §36 mutation proofs | **16/16 caught**, 0 escapes, 0 patch failures |
| 081 / 082 / 083 / 084 | 72 · 64 · 77 · 62 |
| 090 replanning / 091 evening close | 69/69 · 87/87 |
| `release:audit` | PASS 17/17 · migration count 47, nothing beyond 0047 |
| `release:routes` | PASS 24/24 — `/daily` and `/today/review` both covered |
| `release:export` | PASS 14/14 |
| `audit:security` | PASS — RLS, secrets, routes, auth, deps |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (2 pre-existing warnings in unrelated files) |
| `next build` | clean |

# 13. The ten claims (§42)

1. **One canonical daily review** — `/today/review`; 92.10, 92.37–92.38.
2. **All entry points converge** — browser 1–4, 15, 16a; M1, M2, M8.
3. **Unique value preserved** — `?date=` and the dated redirect; browser 10–14;
   M5, M6, M7.
4. **Duplicate derivation removed** — 92.37, M11.
5. **Duplicate mutation paths removed** — none existed in the wizard, and 92.35
   holds the canonical surface to the replanning layer; M14.
6. **Reflection stays optional** — browser 27–32; M13.
7. **Tomorrow stays distinct from carry-forward** — browser 23, inherited from
   091 and re-asserted here.
8. **Old bookmarks stay safe** — browser 5, 10, 14; both redirects return 200;
   M3, M4.
9. **Morning, Evening and Week form one rhythm** — Today → "Review today" →
   `/memory`; browser 38–40.
10. **No migration, no new review engine** — head 0047; 92.27; the canonical
    surface composes LIFEOS-091 unchanged.
