# LIFEOS-092 — One Daily Review Surface

**North star:** Conqify should have one clear place to close a day, not two
competing review experiences.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
