# LIFEOS-084 — Weekly Executive Review

**North star:** show me what actually happened this week, what is drifting, and
what I should carry forward.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

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

*Sections 2 onward are written as the implementation lands.*
