# LIFEOS-091 — Evening Close / Remember the Day

**North star:** at the end of the day, Conqify should help me see what actually
happened, close open loops, and remember the day without making me write a
report.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `44d3846eac14104cc00164e9803862973c76b985` (PR #96 merged) |
| Branch | `claude/lifeos-091-evening-close` |
| Migration required | **no** — composition over existing history (§37) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the real builders, not read. A realistic full day
(`scratchpad/fx91.js`) where every commitment the morning showed resolves into
something different by evening: two completions under a Project under a Goal, a
third-time deferral to tomorrow, a neutral reschedule to Friday, a wait that
ended today, a wait still open on Marcus, a blocked action, an overdue action,
work already dated tomorrow, a recurring completion, a cancellation, a goal
horizon change, a goal achieved, a rule adopted, a user reflection, a user note,
and an AI-authored note.

Probes: `probe91.cjs`, `probe91b.cjs`, `probe91c.cjs`.

## 1.0 Three fixture traps, ruled out before anything was called a red

The first run reported far more missing than was really missing, because the
fixture used field names that do not exist:

| I wrote | The schema actually uses |
|---|---|
| `goal.history[].action` + `from`/`to` | `kind` (`"horizon"`, `"status"`) + `fromHorizon`/`toHorizon`, `fromStatus`/`toStatus` |
| `action.history[].action: "waiting_started"` / `"waiting_ended"` | `"waiting"`, and leaving a wait is `"edited"` carrying `fromStatus: "waiting"` |
| `constitutionRevision.kind` | `changeKind` |

With the wrong names, goal changes, rule changes and the resolved wait were all
absent — and three of them would have been reported as product defects. Two of
the three survived correction as genuine reds; the goal and rule changes did
not, and are §1.5's finding instead.

## 1.1 A — What evening-review capability already exists

**A great deal.** `/today/review` (LIFEOS-073) already renders
`buildDailyExecutiveView` with six sections — Completed today, Changed today,
Still open, Waiting, Tomorrow, In your own words — plus a coverage line and
stated limitations. It is reachable from Today, it creates no record by being
visited, and every Still-open and Waiting row already carries the shared
LIFEOS-071/090 resolver.

`/daily` remains the seven-step journaling wizard (LIFEOS-034), optional and
untouched.

And **LIFEOS-084's `WeeklyExecutiveReview` already implements almost exactly the
model §4 describes — for the week**:

```
movedForward       §7  completed linked work, and nothing else
changedDirection   §8  recorded transitions, never called progress
repeatedDeferrals  §9  recurring-safe, counted, neutral
waitingEnded       §12 waits that ENDED in the range
stillWaiting       §12 open now
reflections        §19 the user's own words only, capped
unresolved         §11 present state, capped at three
carryForward       §15 a proposal, never a plan
scheduledNext      §14 structurally distinct from carry-forward
goalReview         §28 completedThisWeek — the only "moved forward" there is
leftBehind         §23 one calm arithmetic line
```

So this sprint is not designing a model. It is bringing the day up to the week.

## 1.2 B — Which facts are already derivable

Every question in §3 except two. `buildExecutiveChanges` over a one-day range
produced twelve grounded changes for the fixture day, including the goal and
rule transitions. The two that are not derivable today are **carry-forward for a
day** (§15) and the **optional memory prompt** (§20) — the second is an input,
not a derivation.

## 1.3 C — Which sections duplicate newer systems

### RED 1 (§40, §41) — every completion is printed twice

`COMPLETION_KINDS` and `CHANGE_KINDS` both contain `completed_action` and
`recurring_completion`, and `ReviewToday` renders both lists. Measured on the
fixture:

```
Completed today : Draft personal statement · Send application
Changed today   : Completed  Draft personal statement      ← again
                  Completed  Send application               ← again
                  Date changed  Dentist
                  Cancelled  Apply to the fifth school
                  Stopped waiting  Transcript from Maria
                  Deferred  Request recommendation
```

Two of the six "changes" are the two completions listed directly above them.
**Confirmed.**

A second overlap is legitimate and must be kept: `Dentist` appears under Changed
("Date changed") and under Still open ("Due Fri, Sep 11"), which are two
different facts about one record. §41 asks for facts repeated across sections,
not records — the completion pair is the defect; this pair is not.

## 1.4 D — Which facts are missing

### RED 2 (§28) — no Goal or Project movement

`DailyExecutiveView` has no moved-forward concept at all. `buildExecutiveChanges`
correctly identified both completions as `MOVED_FORWARD_KINDS` under
`p-apps` → `g-grad`, and nothing on the evening surface aggregates it. §28's
"Graduate school — 2 linked actions completed" is not producible. **Confirmed.**

### RED 3 (§15, §16) — no carry-forward, and the week's version is wrong for a day

`buildDailyExecutiveView.tomorrow` is dated evidence only; its own comment says
"no carry-forward". §3's "what should consciously carry into tomorrow?" has no
answer. **Confirmed.**

Worse, reusing LIFEOS-084's `buildCarryForward` unchanged over a day window is
**not** correct. Measured:

```
carryForward reused for ONE DAY
 · dated   Dentist                        Due Fri, Sep 11.
 · dated   Pay the application fee        Was due Sun, Sep 6.
 · dated   Submit the second application  Due tomorrow.    ← already scheduled
```

Something due next Tuesday is genuinely unresolved work to carry into next week.
Something due **tomorrow** is not a candidate for carrying into tomorrow — it is
already there. Offering it is precisely the §14 merge the brief forbids, and
§16 settles it: already scheduled, not merely a candidate. The day model must
subtract what tomorrow already holds. **Confirmed.**

Correctly excluded already, and kept as forward guards: completed work,
cancelled work, a resolved wait, and open undated work are never carried, and a
deferral returning tomorrow is not a candidate either.

### RED 4 (§10) — the repeated-deferral count cannot be stated

`repeatedlyPostponed` over the **day** range returns nothing for the
thrice-deferred action, because only one of its three deferral instants falls
inside today. Over a wide range it returns `count=3`. §10's sentence — "deferred
again today — 3 recorded deferrals" — needs both windows at once, and nothing
composes them. **Confirmed.**

### RED 5 (§5, §6, §12) — a resolved wait is filed as a change

`Transcript from Maria` ended its wait today and appears under **Changed**.
§6 lists resolved waiting under **Done**. The surface also runs six primary
sections against §5's budget of five, because Waiting is its own section rather
than being split into resolved (Done) and still-waiting (Still open).
**Confirmed.**

### RED 6 (§11) — Still open is unbounded

On a dense day (40 extra overdue chores) the fixture produced:

```
stillOpen : 8      ← §11 says at most 3
attention : 45
```

**Confirmed.**

### RED 7 (§24, §41) — the day speaks in weeks

Both the summary and the coverage line are the week review's, unmodified:

```
"In this period you completed 2 actions, captured 3 notes and reflections…"
"…It is not a complete record of your week."
```

On a quiet day: `"Nothing was recorded in this period."` A one-day surface
telling the user about "this period" and "your week" is wrong, and §23 asks for
counts. **Confirmed.**

### RED 8 (§26) — no previous day

`ReviewToday` calls `todayKey()` directly and reads no date parameter, so a
review opened after midnight can only ever describe the new day. **Confirmed.**

### RED 9 (§20) — no optional memory prompt

Nothing asks "anything about today worth remembering?" The `/daily` wizard is
the only path and it is a seven-step form. **Confirmed.**

## 1.5 E, F, I — Not reds, kept as forward guards

* **§7 nothing is mislabeled as progress.** `MOVED_FORWARD_KINDS` holds
  completions only; `DIRECTION_KINDS` holds the goal transitions. Measured: the
  horizon change and the achieved goal landed in DIRECTION, not MOVED_FORWARD.
* **§9 defer and reschedule are already distinct** on the daily surface —
  `action_deferred` → "Deferred", `action_rescheduled` → "Date changed". The
  fixture's neutral reschedule never appeared as a deferral, and
  `repeatedlyPostponed` did not count it. LIFEOS-090's distinction survives.
* **§8's goal and rule changes are already derived** — by LIFEOS-081, correctly,
  with `from`/`to` on each. The daily view simply never asks for them:
  `CHANGE_KINDS` is the LIFEOS-073 timeline vocabulary, which has no goal or
  rule kinds. Twelve changes exist for the fixture day; the evening surface
  shows six. This is LIFEOS-081's "three definitions of changed" defect
  surviving on the one surface 081 did not reach.
* **§39.14 an AI note is already excluded from "In your own words."** With a
  correctly attributed note the reflections list drops from 3 to 2.
  `isMachineProduced` over `classifyOrigin` does the work, and attribution lives
  in the text itself so it survives export and sync.
* **§13 blocked work is never carried.** `carryReasonFor("blocked")` returns
  `null` by design — blocked work is waiting on its blocker, not on tomorrow.
* **§I never inferred:** attendance (nothing records it), "became unblocked"
  (`UNBLOCK_LIMITATION` states this in the UI), "worked on" (a `started` event
  marks picking work up, not effort), mood, and any score.

## 1.6 G — What "carry into tomorrow" means today

Nothing. The word appears once in `lib/today/daily.ts`, in a comment explaining
that there is none.

## 1.7 H — What can be closed from the review

Everything LIFEOS-071 and 090 already offer: complete, complete occurrence, not
today, reschedule, set follow-up, stop waiting, open blocker, open record. Still
open and Waiting rows already carry them. §17 needs no new mutation layer.

## 1.8 J — The smallest composition layer

`lib/today/evening.ts` — one pure `EveningClose` over a **chosen day**,
composed from what already exists:

```
completed        ← COMPLETION_KINDS, plus waits that ENDED     (§6, §12)
movedForward     ← MOVED_FORWARD_KINDS ∩ goal-linked           (§7, §28)
changed          ← buildExecutiveChanges MINUS the completions (§8, RED 1)
deferred         ← "deferred", with the wide-window count      (§9, §10)
rescheduled      ← "rescheduled", never mixed with deferred    (§9)
waitingOpen      ← present state                               (§12)
stillOpen        ← the attention shortlist, capped at three    (§11)
tomorrowScheduled← daily.tomorrow, dated evidence              (§14)
carryForward     ← buildCarryForward MINUS tomorrowScheduled   (§15, §16)
reflections      ← user-authored only, capped at three         (§19)
calmSummary      ← counts, in a day's words                    (§23, §24)
```

No persistence, no new derivation, no schema. The day and the week end up
reading the same builders, which is what §33 and §34 ask for.

## 1.9 Migration (§37)

**None.** Every fact §3 asks for is already recorded or already derived. The one
input this sprint adds — an optional sentence about the day — goes through the
existing reflection path with its existing provenance (§21), not a new diary
record type. Head stays at **0047**; `0048` is not written.

---

# 2. The derived model (§4)

`lib/today/evening.ts` — one pure `EveningClose` over a **chosen day**. It
persists nothing, adds no schema, and every fact in it comes from a builder that
already existed:

| Field | Source | Section |
|---|---|---|
| `completed` | LIFEOS-064 completion kinds | Done |
| `waitingResolved` | 081 `waiting_ended` | Done |
| `movedForward` | 081 `MOVED_FORWARD_KINDS` ∩ goal-linked | Done |
| `changed` | 081, minus everything with its own list | Changed |
| `deferred` | 081 `deferred` + whole-life count | Changed |
| `rescheduled` | 081 `rescheduled` | Changed |
| `changedDirection` | 081 `DIRECTION_KINDS` + rule kinds | Changed |
| `stillOpen` | 082 attention shortlist, capped at 3 | Still open |
| `waitingOpen` | present state, capped at 3, remainder counted | Still open |
| `reflections` | 081 words, user-authored only, capped at 3 | In your own words |
| `tomorrowScheduled` | 073 dated evidence | Tomorrow |
| `carryForward` | 084 `buildCarryForward`, minus tomorrow | Tomorrow |
| `calmSummary` | arithmetic over the above | header |

Passing a different `date` is all §26 needs. The range is
`resolveRange("custom", { customStart: date, customEnd: date })` — the local-day
implementation that already existed (§25). There is no rolling 24-hour window
anywhere, and assertion 91.81 states that.

# 3. Done (§6, §7, §12, §28)

Completion only. A created record, an edited one, a rescheduled one and a
cancelled one are all absent, and `updatedAt` is never read as a completion —
mutation **M16** makes exactly that substitution and reddens six assertions.

A wait that **ended** today is filed here, not under Changed: finishing a wait
is something that finished. It names the person it was on.

Movement is completed **linked** work and nothing else:

> Moved forward
> Graduate school — 2 linked actions completed

A horizon edit can never enter (**M3**), and a completion linked to nothing is
still Done but moves no goal (**M4**, assertion 91.14a). There is no momentum,
no percentage and no score anywhere on the surface — assertion 91.63 sweeps for
`%` and browser 5 sweeps the rendered page.

# 4. Changed (§8, §9, §10)

## Defer and reschedule stay apart

LIFEOS-090 drew this line and 091 preserves it. They are separate typed lists
that provably never intersect (91.25), and mutations **M1** and **M2** swap them
in each direction — each caught four times.

## The repeated-deferral count needs two windows

"Deferred again today" is a fact about the day. "3 recorded deferrals" is a fact
about the record's whole life. Neither window alone can say the sentence, so the
model takes both:

> Request recommendation — Deferred
> Deferred again today — 3 recorded deferrals.

A **first** deferral is never dressed up as a pattern (**M18**, 91.28), and the
line is inline on the row rather than a warning wall (§10). `repeatedlyPostponed`
already excludes recurring work, so a standing routine is never called
avoidance.

## Direction is not progress

The goal horizon change, the achieved goal and the adopted standard now appear —
they had been invisible, because LIFEOS-073's `CHANGE_KINDS` is the
autobiographical vocabulary and has no goal or rule kinds. Twelve provable
changes for the audit's day; the old surface showed six. Assertion 91.20 states
that every provable change reaches *some* section, and 91.20a names the single
deliberate exception: machine prose, which §19 drops on purpose.

# 5. Still open (§11, §12, §13)

The attention shortlist, capped at three. Forty overdue chores stay three rows
(**M6**, 91.32). A completed record can never appear (**M12**, 91.35a). Blocked
work names its blocker and inactivity is never called blocked.

Waiting is split. Resolved today leads Done; still-waiting sits here with the
recorded follow-up date and nothing about what the other person owes anyone. The
roster is bounded at three with the remainder **counted** —

> 1 more wait is open. See all

— because five people to hear from is a legitimate state, and hiding the sixth
silently would be the review deciding which of someone's commitments are worth
mentioning.

# 6. Tomorrow and carry-forward (§14, §15, §16, §18)

Two lists, never merged:

```
Tomorrow already has
  Dentist appointment              10 AM
  Request recommendation           Comes back tomorrow
  Submit the second application    Due Sun, Sep 6

Possible carry-forward
  Pay the application fee          [ Carry to tomorrow ]

Nothing moves until you choose it.
```

`buildCarryForward` is LIFEOS-084's, with three subtractions the day scale
requires:

1. **What tomorrow already holds.** Work due tomorrow is not a candidate for
   carrying into tomorrow (**M13**).
2. **Work dated later than tomorrow.** §15 says so in as many words. The first
   run proposed carrying the dentist appointment the user had deliberately moved
   to Friday that same afternoon — a review that asks you to undo the decision
   you just made is arguing with you, not helping you replan (**M14**).
3. **Anything that is not work.** 084's `goal_gap` reason is sensible about a
   week and meaningless as "bring this into tomorrow" (**M15**).

Completed, cancelled, resolved and undated work never enter, because the
shortlist that feeds this is built from present unresolved state.

Nothing moves until pressed (browser 35), and the press goes through
LIFEOS-090's `planReplan` — see §8 below.

# 7. Provenance and the optional prompt (§19, §20, §21, §22)

"In your own words" holds user-authored records only. An AI note carries its
attribution in its own text, so `isMachineProduced` keeps it out and the marker
survives export, re-import and sync. **M5** removes the filter and reddens two
assertions; browser 43 checks the machine sentence is not on the page under any
heading.

One optional prompt, phrased as an invitation:

> Anything about today worth remembering? *One sentence, or nothing at all.*

An answer goes through `addReflection` with the prompt preserved as the prompt —
the existing reflection path, no "daily diary" record type (browser 46–49). It is
offered only for today, and never for a past day. Nothing is generated: there is
no "today was a challenging but productive day", and `EVENING_FORBIDDEN_WORDS` is
swept over every string the model can produce plus the rendered page.

# 8. One temporal path (LIFEOS-090 §33)

The most serious finding of the sprint, and the screenshots found it.

"Carry to tomorrow" called `deferAction` directly. Pressing it on a wait set
`status: "deferred"` and left `waitingOn: "Marcus"` on the record — the wait gone
from every surface that asks what you are waiting on, while the person still
owed a reply. That is LIFEOS-090's RED 1 exactly, reintroduced on a new surface
by a second mutation path.

The button now asks `planReplan`, which already refuses to push a wait and
already offers the honest alternative, so the press keeps the wait and moves the
follow-up date instead. Browser 39e–39h hold it. The store binding that
`ReplanPreview` and this page were each keeping a copy of now lives in
`components/planning/replanOps.ts`.

# 9. Consistency (§31, §32, §33, §34)

* **§31** Nothing the morning showed vanishes by evening — every one of the six
  morning items resolves into some section (91.82), including the rescheduled
  one, which does not disappear because its date changed.
* **§32** The page reads the same store Today reads. There is no shadow state.
* **§33, §34** The evening's completions, deferrals and reschedules are 081's,
  asserted by counting them directly (91.84–91.86), and every shown change
  carries the field it traces to (91.87). Memory and Weekly Review read the same
  builders, so a different summary is possible and a contradictory fact is not.

# 10. Visual review (§41)

Seven day-shapes at 1280 and one at 390: productive, quiet, dense,
defer-heavy, waiting-heavy, reflection-heavy, and a day with nothing tomorrow.

**V1 — carrying a wait orphaned it.** §8 above.

**V2 — a due wait rendered twice inside one section**, once from the shortlist
and once from the roster, each with its own identical three-button menu. The
shortlist leads; the roster holds what it did not.

**V3 — one date, two sections, two formats.** "Submit the second application ·
Due tomorrow" under Still open and "· Due Sun, Sep 6" under Tomorrow.

**V4 — the goal movement row read as a completion.** It sat unlabelled directly
above the completions, so "Graduate school · 2 linked actions completed" looked
like a fourth finished item. Done now carries two sub-headings.

**Not defects:** an item may appear under both Still open and Possible
carry-forward, because §3.7 and §3.8 are different questions — but the *reason*
is printed once, and `echoesStillOpen` is the flag that keeps it that way.

# 11. Performance (§42)

Deterministic, one whole close:

```
n= 100   14ms   | changes  1.3ms  shortlist  2.3ms  deferral counts 0.1ms
n=1000  100ms   | changes 11.6ms  shortlist 19.6ms  deferral counts 0.3ms
n=5000  514ms   | changes 59.4ms  shortlist 98.9ms  deferral counts 1.0ms
```

In the browser, first render and switching to the previous day:

```
n= 100   223ms / 139ms      n=1000  270ms / 229ms      n=5000  1056ms / 658ms
```

Every rendered section stays at three rows at every size. No page errors at any
size. The indexes are built once and shared; no section rescans the store.

# 12. Known gaps

1. **The whole-life deferral window is unbounded** — it starts at 1970 so the
   count cannot depend on when you asked. At 5,000 records that pass costs 1ms,
   so it is not worth bounding yet; at a much larger store it would be.
2. **A wait cannot be carried, only followed up.** That is the correct
   behaviour, but the button still says "Carry to tomorrow" and then does the
   other thing, explaining itself in a toast. A row-specific label would be
   better than a correction after the press.
3. **`/daily`'s seven-step wizard still exists** alongside this surface. It is
   untouched and optional, and the two are not merged — but two review surfaces
   is one more than a product needs, and which one survives is a product
   decision, not a sprint's.
4. **`buildEveningClose` calls `buildDailyExecutiveView` internally** for the
   completions and the tomorrow list, which recomputes attention and the
   recommendation that this surface never reads. It is why the 5,000-record
   close costs 514ms against 160ms for its own three passes.

# 13. Gates (§44)

| Gate | Result |
|---|---|
| Deterministic — full regression | **5708/5708** across 55 suites, none failing |
| `today/evening` selftest | **106/106** |
| §39 browser torture (091) | **87/87** |
| §40 mutation proofs | **22/22 caught**, 0 escapes, 0 patch failures |
| 081 / 082 / 083 / 084 | 72/72 · 64/64 · 77/77 · 62/62 |
| 087 / 088 / 089 / 090 | 52/52 · 83/83 · 66/66 · 69/69 |
| `release:audit` | PASS 17/17 · migration count 47, nothing beyond 0047 |
| `release:routes` | PASS 24/24 |
| `release:export` | PASS 14/14 |
| `audit:security` | PASS — RLS, secrets, routes, auth, deps |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (2 pre-existing warnings in unrelated files) |
| `next build` | clean |

# 14. The twelve claims (§46)

1. **The close derives the day automatically** — every section comes from
   recorded evidence; the only input is one optional sentence.
2. **Completed work is factual** — `updatedAt` is never a completion (M16);
   created, edited, rescheduled and cancelled records are excluded (91.2–91.4).
3. **Movement uses completed linked work only** — M3, M4, 91.12, 91.14a.
4. **Deferral and rescheduling stay distinct** — M1, M2, 91.25.
5. **Waiting stays truthful** — resolved and open never intersect (91.41), and
   carrying a wait cannot orphan it (browser 39e).
6. **Still open is bounded and meaningful** — M6, M12, 91.31, 91.35a.
7. **Tomorrow's schedule is distinct from carry-forward** — M13, 91.54.
8. **Carry-forward never happens silently** — browser 35 checks nothing moved by
   being shown; 36 checks the press is what moves it.
9. **Reflections preserve provenance** — M5, browser 43, 47.
10. **Quiet days are calm** — 91.64–91.68, browser 57–59.
11. **Evening, Memory and Weekly Review agree** — 91.84–91.87.
12. **No migration, no diary system** — head stays 0047; the optional sentence
    goes through `addReflection` (browser 49).
