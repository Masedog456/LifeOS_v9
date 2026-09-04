# LIFEOS-084 — Weekly Executive Review

**North star:** show me what actually happened this week, what is drifting, and
what I should carry forward.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `45cb9a6786c3f870b6987410b2c28a7f53343640` (PR #89 merged) |
| Branch | `claude/lifeos-084-weekly-executive-review` |
| Migration required | **no** — composition and read model |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Produced by running a realistic one-week fixture through the actual builders:
two completions (one under a goal's project, one unlinked), an action deferred
three times, a **weekly recurring** action also deferred three times, a wait
still open, a wait that ended mid-week, an overdue action, a goal whose horizon
moved, a goal with no project, a retired standard, a user reflection, an
AI-written note, and an event scheduled for next week.

## 1.1 A — What Week Review already answers well

`buildWeekReview` is solid and this sprint keeps all of it: a correct Monday
week boundary, `completed`, `scheduled`, `added`, `waiting`, `stillOpen`,
`projects`, an arithmetic-only `summary`, a `coverage` note, and explicit
`limitations` — including the project-history limitation, stated without being
asked.

**§32's consistency requirement already holds.** Both Week Review and Memory
resolved the same window for the same day:

```
buildWeekReview(this_week)  →  2026-09-07 → 2026-09-10
Memory "what happened this week?" →  Sep 7 – Sep 10, 2026
```

## 1.2 B — What LIFEOS-081 now answers better

`buildExecutiveChanges` over the identical range found things Week Review shows
nowhere:

```
goal_horizon_changed  "Graduate school"        Near → Medium
rule_retired          "Never work at weekends."
waiting_ended         "Lease from Marcus"
```

And `repeatedlyPostponed` answers the deferral question properly:
`[["Request recommendation letter", 3]]`.

## 1.3 C — What LIFEOS-082 knows that Week Review does not

The attention shortlist over the same state:

```
overdue            "Pay the deposit"
follow_up_due      "Transcript from registrar"
repeated_deferral  "Request recommendation letter"
goal_path_missing  "Run a marathon"
```

Week Review's `stillOpen` has three of those records but no kinds, no
explanations, and no notion that a goal has no path at all.

## 1.4 D / E — Duplication and noise, measured

**The Deferred section is the raw event list.** It rendered **six rows** for two
actions:

```
deferred  6  ["Request recommendation letter", "Weekly lab prep",
              "Request recommendation letter", "Weekly lab prep", …]
```

Three of those six are a **weekly recurring commitment** — the exact thing
LIFEOS-081 §15 excludes from repeated deferral, because pushing a standing
routine by a day is not slippage. Week Review presents it as slippage, three
times.

**The Added section surfaced machine prose.** Its only entry was
`"AI summary: you were productive."` — the AI-written note. `added` filters
reflections, waiting duplicates and same-day completions, but has **no
provenance filter**, so a model's sentence appears as something the week
contained.

## 1.5 F — User questions that remain unanswered

Of §36's eight, **three do not route at all**:

```
"What should I carry into next week?"  → plan = NONE → "Conqify can't answer that one"
"What remains unresolved?"             → plan = NONE
"What should I reconsider?"            → plan = NONE
```

And `"What changed direction?"` routes to `CHANGES/all` with no time word, so it
silently widens to **the last 12 months** rather than the week.

## 1.6 G — Evidence missing entirely from the weekly surface

| Missing | Where it already exists |
|---|---|
| Moved forward (completed linked work) | `buildExecutiveChanges` + goal alignment |
| Changed direction (goal / rule transitions) | `buildExecutiveChanges` (081) |
| Repeated deferral, recurring-safe | `repeatedlyPostponed` (081) |
| Unresolved attention with reasons | `buildAttentionShortlist` (082) |
| Waiting that **ended** | `waiting_ended` change (081) |
| Next week's scheduled commitments | `upcoming` / events |
| **Carry forward** | nowhere — this is the genuinely new synthesis |

## 1.7 H — Historical evidence vs current open state

The line this sprint must hold:

- **Historical** — completed, changed, deferred, waiting-ended, reflections.
  All from `buildExecutiveChanges` and the timeline, bounded by the range.
- **Current** — still waiting, still open, unresolved attention, carry forward.
  All from present state, because "is this still true on Monday?" is a question
  about now, not about the week that just ended.

Mixing them is how a review claims a resolved thing is still open.

## 1.8 I — What "carry forward" means operationally

An **unresolved item that remains valid next week**. Sourced from evidence that
already exists — overdue and dated work, returned-from-deferral, repeated
deferral, waiting follow-up, and a goal with no path — and explicitly *not*
completed work, retired rules, resolved waits or abandoned goals.

Critically (§25, §26): the review **proposes**. It does not plan. Nothing here
may write a date.

## 1.9 J — What to remove rather than add

1. **Collapse eight sections into five** (§20).
2. **Replace the six-row Deferred list** with 081's recurring-safe count.
3. **Filter machine prose out of Added** — or fold Added into the summary, since
   §6 questions whether creation is worth its own section at all.

## 1.10 The surface (§29)

**Improve `WeekInReview` in place.** It is the existing weekly review, it lives
in `/memory`, and it already owns the range toggle. `/review/weekly` is a
different, older thing — the formation weekly *synthesis*, AI-driven — and is
not the executive review. No new route.

## 1.11 Migration (§35)

**None.** Every input is already derived and already tested.

---


# 2. What was built

## 2.1 `lib/memory/weekly.ts` — the model (§4)

A pure derived `WeeklyExecutiveReview`. No migration, no persistence, no store
access, no clock of its own. It composes what already existed:

| Field | From | Sprint |
|---|---|---|
| `base` | `buildWeekReview` | 064 |
| `movedForward` | `buildExecutiveChanges` + goal link | 081 / 078 |
| `changedDirection` | `buildExecutiveChanges` | 081 |
| `repeatedDeferrals` | `repeatedlyPostponed` | 081 |
| `waitingEnded` | `buildExecutiveChanges` | 081 |
| `reflections` | changes + `isMachineProduced` | 081 / provenance |
| `unresolved` | `buildAttentionShortlist` | 082 |
| `carryForward` | **new synthesis** over all of the above | 084 |
| `scheduledNext`, `reconsider` | **new** | 084 |

**No score anywhere** (§5, §13, §14). Every ordering is lexicographic over a
stated precedence; every sentence is a count or a recorded transition. The
suite asserts no field is named score, grade, rating, percentage or momentum,
and that a goal line carries exactly five keys — none of which could become one.

### The precedence is derived, not restated (§17)

`CARRY_ORDER` is computed from `ATTENTION_ORDER` by mapping each reason to its
earliest constituent signal. The first draft hand-wrote the list and promptly
ranked `goal_gap` above `waiting_follow_up` — offering a goal with no project
ahead of a follow-up date that had already arrived, while the attention
shortlist one function away ranked them the other way round. That is
LIFEOS-082 §8's prohibition reintroduced by duplication, and the fix is to have
one precedence rather than two that agree by inspection.

## 2.2 `components/memory/WeekInReview.tsx` — eight sections into five (§20)

    FINISHED · MOVED AND CHANGED · STILL OPEN · IN YOUR OWN WORDS · NEXT WEEK

Both measured defects are gone by construction:

- **Deferred** was the raw event list — six rows for two actions, three of them
  a weekly recurring commitment. It is now 081's recurring-safe count, one row
  per action, and the surface states the exclusion.
- **Added**'s only entry was `"AI summary: you were productive."` Creation is
  now left to the arithmetic summary, which cannot carry prose.

Two sections were dropped rather than folded. **On the calendar** listed what
was scheduled in a week that has already happened, and 064's own note admits
Conqify has no record of attendance; the summary still counts it, and next
week's calendar survives under NEXT WEEK where it is actionable. **Projects**
was a fourth block of counts with no history behind it — the goal lines say the
same thing one level up, and only for goals that recorded something.

## 2.3 Memory routing (§36)

| Question | Before | After |
|---|---|---|
| What should I carry into next week? | unrouted | `OPEN_WORK/carry` |
| What remains unresolved? | unrouted | `OPEN_WORK/focus` |
| What should I reconsider? | unrouted | `CHANGES/reconsider` |
| What changed direction? | `CHANGES/all`, whole week | `CHANGES/direction` |

Carry and unresolved are deliberately **separate**: folding them made the
product answer "what remains unresolved?" under the heading "Worth carrying
into next week", which is an answer to a question nobody asked.

"Carry into next week" names a future period, and the period is the
DESTINATION. Without a guard the range resolver read it as a retrieval window
and answered "that period hasn't happened yet, so there is nothing recorded in
it" — true of next week, and no answer at all.

---

# 3. What was NOT built

- **No migration.** Head stays at **0047**. Every input was already derived.
- **No new route** (§29). `/memory` is improved in place. `/review/weekly` is
  the older AI formation synthesis and is a different thing.
- **No momentum, health or alignment score** (§13, §14).
- **No "drop this"** (§18). `buildReconsider` states two facts — deferred
  several times, no due date — and stops. There is no `shouldDrop` field and no
  staleness number one could grow into.
- **No writes** (§25, §26). Nothing in this sprint schedules anything. The
  browser suite asserts `localStorage` is byte-identical after a render.
- **No `GOAL_QUIET`, no dormancy inference, no psychologizing** (§5, §19).

`/memory/week` — linked from `ReviewToday` since LIFEOS-073 — has never
existed and 404'd. Repointed at `/memory`, the one weekly review surface.

---

# 4. Verification

| Gate | Result |
|---|---|
| Deterministic, all suites | **4928 / 4928**, 48 suites (was 4809 / 4809, 47) |
| `memory/weekly` | **119 / 119** |
| Browser torture, 084 | **62 / 62** |
| Mutation proofs | **17 / 17 caught** |
| 078 / 079 / 080 / 081 / 082 / 083 browser | 93 / 97 / 109 / 72 / 64 / 77 — all pass |
| release-audit, rls, auth, routes, wiring, mappers | pass |
| export-verify, scan-secrets | pass |
| route-smoke (production build) | 24 / 24 |
| `tsc --noEmit`, `eslint` | clean (2 pre-existing warnings) |
| `next build` | pass |

## 4.1 The mutations that escaped, and what they exposed

Three of seventeen survived the first pass. None was a test that needed
rewording; each was a test passing for a reason it did not name.

**The completed-record guard and the recurring guard were unreachable.**
`buildCarryForward`'s `isLive` check and `buildReconsider`'s `readRule` check
are never exercised through the builders that feed them — the shortlist holds
only live commitments, and `repeatedlyPostponed` already drops recurring work —
so deleting either changed nothing observable. Both are now asserted at the
function boundary, where the exported signature lets a caller hand in exactly
what the internal path never would, each paired with a positive case so the
assertion cannot pass by returning nothing.

**A threshold mutation threw instead of failing.** Setting
`REPEATED_THRESHOLD` to 0 crashed on an undefined `lastAt`. A crash is not a
proof, so the mutation was replaced with the one that reproduces the audit's
measured defect: removing the recurring exclusion, which turns a standing
routine into slippage and now turns two assertions red.

## 4.2 What §39 found that no assertion did

Reading the rendered page found three defects the 119 deterministic and (then)
58 browser assertions all missed, because each section was individually correct.

1. **The same commitment, three times on one screen.** "Learn Portuguese" under
   Deferred more than once, under Worth carrying forward, and under Worth a
   second look — each opening "You deferred this 4 times." Fixing it pairwise
   did not hold: the browser suite then caught deferred-vs-reconsider on a week
   crowded enough to push the item out of the carry cap. The component now runs
   **one ownership pass** in one stated precedence (carry → still open →
   deferred), and facts that are not rows — the count, "it has no due date" —
   attach to the row that owns the record.

2. **The summary contradicted the section beneath it.** "deferred 9 items" for
   a week in which three things were put off: it counted deferral EVENTS, the
   audit's own complaint restated in one sentence. Nothing guarded it — the
   change broke no existing assertion — so 84.5b and 84.5c now do, with a
   mutation to prove it.

3. **The title truncated to "Request re…" at 390px.** Appending the deferral
   count to a row's `shrink-0` meta cost the row its most important word. The
   count moved to its own line.

---

# 5. Limitations, stated (§33, §34)

- **Projects have no lifecycle history.** 064's limitation is preserved
  verbatim and still rendered. Project lines count linked records; the review
  cannot say a project moved.
- **Protocols have no lifecycle history either.** Their `updatedAt` is not
  evidence of a change, and the suite asserts a Protocol never becomes a
  recorded direction change.
- **A follow-up date having arrived is recorded; whether you followed up is
  not.**
- **Attendance is not recorded**, which is why a past week's calendar is not
  presented as what happened.
- **Reconsider is deliberately narrow**: four or more deferrals AND no due
  date. Other shapes may deserve a second look; none of them has evidence this
  product records, so none is offered.
