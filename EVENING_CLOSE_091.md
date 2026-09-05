# LIFEOS-091 — Evening Close / Remember the Day

**North star:** at the end of the day, Conqify should help me see what actually
happened, close open loops, and remember the day without making me write a
report.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
