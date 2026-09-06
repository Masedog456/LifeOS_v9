# LIFEOS-098 — Outcome Coherence / One Record, One Truth

**North star:** wherever the same commitment appears, Conqify should describe it
the same way.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `07cc4c9de8c1baaccae69f9639af2af66da3efe8` (PR #103 merged) |
| Branch | `claude/lifeos-098-outcome-coherence` |
| Migration required | **no** (§45) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

One fixture (`scratchpad/fx98.js`) holding thirteen actions, an event, a
project, a goal, a reflection and a capture — an ordinary open action, one due
today with a time, an overdue one, a genuinely deferred one, a *neutrally
rescheduled* one, a wait with no follow-up, a wait with one due today, a
blocked one and its blocker, a recurring one, a goal-linked one, a completed
one and a cancelled one.

Rendered through every real builder (`scratchpad/audit98.cjs`) and through the
running app (`scratchpad/audit98b.cjs`).

## 1.1 What is already coherent — and it is most of it

**Titles.** Every surface reads `action.title`. Home, Today, the shortlist, the
signals, the decision inbox, search, project and goal context all print the
same string. **Red 46.1 does not hold.**

**Due phrasing on signal surfaces.** `dueLabel` is one function and every
signal-derived surface uses its output verbatim:

```
Today · attention shortlist · evening close · project context · goal context
  a-over    → "Was due Fri, Sep 4."
  a-goal    → "Due Fri, Sep 11."
  a-today   → "Due today"
```

**Home immediate vs recent.** Both call `describeCreated`. **Red 46.7 does not
hold** — LIFEOS-095 §34 already made them one path.

**Waiting repetition.** LIFEOS-096 §9 and LIFEOS-097 removed the triple. Home
shows the person once, in the title. **Red 46.3 does not hold.**

**Corrections propagate.** Measured end to end: changing an Action's Project
through LIFEOS-097's sheet updated Home, Today's ancestry sentence, both
Project views, the Goal view and the record page — with nothing cached and no
reload. **Reds 46.5 and 46.6 do not hold.**

**Control labels.** The canonical complete control says **"Complete"** in
`resolve.ts`, and every commitment surface renders that. `ActionDetail`'s "Mark
complete" is the confirm step of a two-step control, and `RecommendationCard`'s
"Done" is a different record type. **Red 46.10 does not hold.**

Six of the ten briefed reds are already clean. That is the sprint's most
useful finding and it is stated first.

## 1.2 A, B — Where the same date and time really do drift

Measured on one action, `Call the dentist`, due today at 14:00:

```
Home        "Action · Call the dentist · Sun, Sep 6 · 2 PM · Clinic launch"
Today       "Call the dentist · Was due at 14:00 today · Supports Graduate school…"
```

**Two drifts in one line.**

* **The date.** Home prints the absolute day, `Sun, Sep 6`; every signal surface
  says `today`. `describeCreated` formats the date itself with `formatDayKey`
  instead of asking the shared phrase. **Red 46.2 CONFIRMED.**
* **The time.** Home says `2 PM` through `formatLocalTime`; Suggested Next says
  `14:00`, raw. Exactly two sites interpolate the stored `LocalTime` into prose,
  both in `lib/today/recommend.ts` (lines 286 and 503). **Red 46.2's time half
  CONFIRMED.**

## 1.3 C — The state vocabulary, five times over

`CHANGE_WORD` is declared **five separate times** — `TodayCommandCenter`,
`ProjectWorkingState`, `GoalCommandView`, `WeekInReview`, plus
`EVENING_CHANGE_LABEL` in `lib/today/evening.ts` — and they disagree about the
same recorded event:

| kind | Evening | Today | Week | Project | Goal |
|---|---|---|---|---|---|
| `recurring_completed` | Done for the day | Done for the day | — | **Kept** | **Kept** |
| `rescheduled` | **Date changed** | — | — | **Date moved** | **Date moved** |
| `returned` | **Came back from a deferral** | — | — | **Came back** | **Came back** |
| `created` | Added | — | — | Added | **Created** |
| `goal_horizon_changed` | Goal horizon changed | Horizon changed | Horizon changed | — | Horizon changed |
| `rule_adopted` | — | **Rule adopted** | **Adopted** | — | — |

**Reds 46.4 and 46.9 CONFIRMED.**

Some of that difference is legitimate and §4 protects it: on the Goal page
"Horizon changed" is unambiguous, while Today needs "Goal horizon changed" to
say *whose* horizon. That is a **prefix** decision, and it should be one rule
rather than four hand-maintained tables.

The rest is pure drift. `recurring_completed` is "Kept" on a Project and "Done
for the day" on Today; `rescheduled` is "Date moved" in two files and "Date
changed" in another; `created` is "Added" in three and "Created" in one. Same
fact, different word, no contextual reason.

## 1.4 Search — a latent category error

```
[event] "Interview" status=2026-09-11
```

An Event's search entry stores its **date** in the `status` field. `inStatus`
compares `e.status === filters.status`, so a date can never equal a status word
— the filter is unaffected — and the palette does not render `status`, so
nothing user-visible is wrong today. **Red 46.8 CONFIRMED as latent**, not as
visible drift, and reported that way.

## 1.5 D, E, F, G — the rest of the questions

* **D. Stale derived context** — none found. Every surface reads the store at
  render; the propagation test above is the evidence.
* **E. Due vs deferred/planned conflation** — the model keeps them apart
  (`dueDate`, `deferredUntil`, `followUpDate` are separate fields, and
  LIFEOS-090's deferral history is distinct from `due_set`). **But Home ignores
  `followUpDate` entirely**: a wait whose follow-up is today shows only its
  Project, while Today says "Follow-up date is today." §13's distinction is
  correct in the data and missing from one surface.
* **F. Waiting** — consistent since 096/097.
* **G. Completion** — `STATUS_LABEL.completed` is "Completed" and the historical
  words are "Completed"/"Done for the day"; §8 explicitly allows the
  grammatical difference. No drift.
* **H. Project/Goal duplication** — Today's ancestry sentence says "Supports
  Graduate school through Clinic launch" once. No triple.

## 1.6 I, J — What exists, and the smallest thing to build

Already canonical and to be reused, not replaced: `dueLabel`, `formatDayKey`,
`formatLocalTime`, `STATUS_LABEL`, `buildCommitmentSignals`, `describeCreated`.

The smallest change that removes the most drift:

1. **One change vocabulary** — replace five tables with one map plus a
   context-prefix rule (§43's "one formatter per fact", and five copies is the
   real duplication §5 asks for evidence of).
2. **`formatLocalTime` at the two raw sites** in `recommend.ts`.
3. **Home asks the shared date phrase** instead of formatting its own.
4. **Home shows a follow-up as a follow-up** (§13).
5. **Search stops putting a date in the status field** (§28).

No new view model, no cached labels, **no migration**.
