# LIFEOS-098 — Outcome Coherence / One Record, One Truth

**North star:** wherever the same commitment appears, Conqify should describe it
the same way.

## STATUS: COMPLETE

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

## 1.7 The audit's own miss, and how it was caught

The audit measured `dueLabel` reaching every signal surface and concluded the
Project and Goal pages agreed. They did — through the *recommendation's* reasons
and through the *attention* line. What the audit did not open was the ROW CHIP,
which is not a builder output at all: `ProjectContext` hands the component the
record and its raw `dueDate`, and the component wrote its own
`` `Due ${formatDayKey(r.dueDate)}` ``.

That expression has no past tense. So an action Today described as
**"Was due Fri, Sep 4"** read on a project page as **"Due Fri, Sep 4"** — a page
saying a passed deadline was still ahead. It is the only drift in this sprint
that was a different CLAIM rather than a different word for one, and it is the
one the audit missed.

It was caught by the cross-surface proof written afterwards (§46 below), not by
re-reading the code. That is the sprint's second useful finding: an audit that
reads builders finds builder drift, and a proof that renders pages finds page
drift. Both were needed.

---

# 2. What was built (§5, §43)

Five items from the audit, plus two the sprint's own proofs found. No new view
model, no cached label, no migration.

## 2.1 One change vocabulary — `lib/changes/vocabulary.ts`

`CHANGE_WORD` was declared in four components; `EVENING_CHANGE_LABEL` was a
fifth copy in `lib/today/evening.ts`; `CHANGE_LABEL` in `lib/today/daily.ts` was
a sixth, in the other key space. Six literals for one fact is the "real
duplication" §5 asks for evidence of.

They disagreed:

| kind | Evening | Today | Week | Project | Goal | **now** |
|---|---|---|---|---|---|---|
| `recurring_completed` | Done for the day | Done for the day | — | Kept | Kept | **Done for the day** |
| `rescheduled` | Date changed | — | — | Date moved | Date moved | **Date changed** |
| `returned` | Came back from a deferral | — | — | Came back | Came back | **Came back from a deferral** |
| `rule_adopted` | Standard adopted | Rule adopted | Adopted | — | — | **Rule adopted** / *Adopted* |
| `goal_horizon_changed` | Goal horizon changed | Horizon changed | Horizon changed | — | Horizon changed | **Goal horizon changed** / *Horizon changed* |

Ties were not broken on taste. The action words are LIFEOS-073's, which
LIFEOS-091 already reused verbatim — canonical before this sprint, kept rather
than re-chosen. The rule words follow **LIFEOS-095 §32**, which had already
settled that this product calls a `constitution_element` a *Rule*, with a
comment saying a kind named twice is two products. "Standard adopted" was the
drift.

### The worse problem: silence

Two of those tables were `Record<string, string>` with a `?? "Changed"`
fallback, and both were **incomplete**. Six real kinds — `created`, `cancelled`,
`restored`, `due_cleared`, `planned`, `prerequisite_removed` — had no entry on
the Project or Goal page, and both carried a key `added` that
`buildExecutiveChanges` has never emitted. Measured against the fixture:

```
project  completed  -> "Completed"
project  cancelled  -> "Changed"      ← a cancellation, described as "Changed"
```

Typing the map as `Record<ExecutiveChangeKind, …>` is what makes that class of
bug impossible rather than merely fixed: a new kind is a compile error here
until it is given a word.

### The prefix rule (§4)

§4 protects contextual difference, and the audit found exactly one that is real:
a Goal page has already named the goal, so "Horizon changed" is unambiguous
there, while Today mixes goals, rules and actions in one list and must say
*whose* horizon moved. That is now **one rule** — a surface names the subject it
is scoped to — instead of four hand-maintained tables.

The unambiguous form is the default. A surface must declare its scope to get the
shorter one, so forgetting produces a redundant noun and never an ambiguous one.

Both key spaces reach one table: `changeWord(kind, scope?)` for
`ExecutiveChangeKind`, and `timelineChangeWord(kind, scope?)` for the
autobiographical kinds, through the timeline map moved here from
`lib/memory/changes.ts` so the mapping and the words live together.

## 2.2 One due phrase (§3, §16)

Three sites stopped having their own opinion about a date:

* **Home** formatted its own (`formatDayKey`), so a capture saved on its due date
  read `Sun, Sep 6` there and `Due today` on every signal surface. Both accurate;
  only one of them the product's answer. It now asks `dueLabel`.
* **The Project and Goal row chips** built `` `Due ${formatDayKey(r.dueDate)}` ``
  with no past tense — §1.7 above.
* **`buildRangeReview`** wrote the phrase three more times, and its "due today"
  case printed the absolute date.

Those week literals existed for a real reason, and §4 covers it: a review of LAST
week saying "Due today" would be *false*, not differently phrased. So the rule is
named once, as `dueLabel`'s `relative` option, rather than left as a standing
reason for each surface to keep its own wording. Measured:

```
this week (range ends today)   a-today  ->  "Due today"        ← was "Due Wed, Sep 9"
last week (range ended Sun)    a-today  ->  "Due Wed, Sep 9"   ← unchanged, and correct
                               a-lastweek -> "Due Sun, Sep 6"  ← would be "Due today" if relative
```

## 2.3 One time formatter (§16)

Three sites in `lib/today/recommend.ts` interpolated the stored `LocalTime` into
prose, so Suggested Next said `14:00` about the action Home called `2 PM`. All
three go through `formatLocalTime`. No second date library was added; §16's
audit found `formatDayKey` and `formatLocalTime` already canonical, and both are
reused.

## 2.4 A follow-up is not a due date (§13)

**Home ignored `followUpDate` entirely.** A wait whose follow-up had arrived
showed only its project while Today said "Follow-up date is today". Dropping a
fact is the same defect as describing it differently, reached by omission.

`followUpPhrase` joins `dueLabel` in `lib/actions/due.ts`, deliberately mirroring
its grammar so a reader can tell the two facts apart by the NOUN rather than by
the sentence shape. One correction travelled with it: both component copies said
"Follow up today" whenever the date had merely *arrived* — including a week late
— while `buildCommitmentSignals` said "Follow-up date was Fri, Sep 4." about the
same record. §3 says the facts have to agree, so a past follow-up now states its
date on every surface.

## 2.5 Search stops putting a date in a status field (§28)

An Event's search entry wrote `status: ev.date`. Reported by the audit as
**latent** and fixed as latent: `inStatus` compares `e.status === filters.status`
so a date could never match a status word, and no surface renders `status`.
Nothing a person could see was wrong.

It was still a category error, and this file already knew the right shape —
`daily_review` two blocks down puts its date in `aliases` and its real status in
`status`. The Event now does the same, which as a side effect makes it findable
by typing its date. An Event has no status, so it is given none (§32).

## 2.6 "Moved forward" now means work that finished (§3)

Found by the browser pass and confirmed by mutation. `GoalContext.movement`
filtered by OWNERSHIP, not by kind, so a cancellation appeared under a block
labelled *Moved forward*. The old table's missing `cancelled` entry printed
"Changed", which is how it survived review; the count on the same page already
filtered on `completed`, so the list and the count disagreed about one window.

`MOVED_FORWARD_KINDS` is LIFEOS-081's own answer ("kinds that mean work
finished, never mixed with the ones that don't") and is used rather than
re-derived.

A consequence, stated rather than worked around: the per-record dedupe is no
longer reachable through `movement`. `completed` cannot repeat for one record —
the timeline derives it from `completedAt` — and a recurring commitment, which
genuinely can be kept twice in a window, is by definition still live and so owns
a row §34 keeps out of Recently. The dedupe is proved on `direction` instead,
where a goal really can record two horizon changes in one window.

---

# 3. What was deliberately NOT merged (§5)

§5 warns against a giant universal view model, and three other vocabularies were
examined and left alone. Each is a different key space carrying kinds this enum
has no concept of, and in every case the OVERLAPPING words already agree.

| vocabulary | key space | why it stays separate |
|---|---|---|
| `CHANGE_LABEL` in `components/constitution/ConstitutionPage.tsx` | `ConstitutionRevision["changeKind"]` | carries `created`, `edited`, `relinked`, `readopted` — four kinds the executive vocabulary cannot express. Its three overlapping words already equal the scoped forms. |
| `describeGoalHistoryEvent` in `lib/execution/lifecycle.ts` | `GoalHistoryEvent["kind"]` | produces full SENTENCES with both ends of a transition ("Horizon Near → Medium."), which is a different job from a chip |
| `STATUS_LABEL` in `lib/actions/status.ts` | `ActionStatus` | a state, not an event. §8 explicitly allows the grammatical difference between "Completed" the status and "Completed" the recorded change. |

One more difference was measured and left, with the reasoning stated because it
is the closest call in the sprint. Today shows a follow-up **twice**, in two
sections, with two phrasings:

```
NEEDS ATTENTION   Signed form from Ana   Follow-up date was Wed, Sep 2.
WAITING           Ana · Signed form from Ana              Follow-up due
```

These are not contradictory: the first explains why the item needs attention and
names the date, the second states the current state of the wait. §4 and §8 cover
that, and collapsing them would make the attention line stop explaining itself.
It is recorded here so the next audit can revisit it deliberately rather than
rediscovering it.

---

# 4. Proof (§46–§53)

## 4.1 Deterministic — `lib/changes/coherence-selftest.ts`, 79 assertions

Every assertion renders ONE fixture through TWO OR MORE real builders and
compares what they say about the same record, because drift is never wrong on
one surface — it is two surfaces each being locally reasonable about one fact.

The fixture (§47) holds one of everything the sprint distinguishes: an ordinary
open action, one due today with a time, an overdue one, a genuinely deferred
one, a *neutrally rescheduled* one, a wait with no follow-up, a wait whose
follow-up is today, a blocked item and its blocker, a recurring commitment, a
goal-linked action, a completed one, a cancelled one, and one due on last week's
final day — plus an event, a project, a goal, a reflection and a capture.

**The six reds that did not hold are asserted too**, as regression guards. A
measurement that came back clean is worth keeping as one.

## 4.2 Browser — `scripts/smoke-098-outcome-coherence.cjs`, 34 assertions

The deterministic suite proves the builders agree; this proves the PAGES do,
which matters more here than usual: every drift removed this sprint lived inside
a component, in a table beside a JSX block or a template literal inside a
`<span>`.

**The first version passed 29/29 and was worth much less than that number.**
Run against a full revert of the sprint, only six assertions went red; the rest
were decorations. Each was fixed or labelled:

| what was wrong | why it proved nothing | fix |
|---|---|---|
| past tense read from the recommendation | §34's ownership rule means the row chip that drifted is only rendered for an overdue action that does NOT own the recommendation | a second overdue record in the fixture |
| raw-time assertions on `/today` | the recommendation was an undated overdue action, so `recommend.ts` never produced the three sentences under test | a world whose only dated work is the timed one |
| …and the text was split on the heading | which kept the rest of the page, including Today's own timed chip, so "2 PM" was found either way | scoped to the recommendation block |
| prefix rule tested on the Goal page | the scoped word never changed there | the mixed form, on the evening close, which said "Standard adopted" |
| search asserted about `status` | no surface renders it | asserts what IS newly observable: the event is findable by its date |
| follow-up checked per surface | each was locally plausible | compares the DAY Today names against the day the project page names |

**Fifteen assertions now go red against a full revert**, covering all five
briefed fixes plus the two the sprint found on its own.

## 4.3 Mutation (§49) — 15 mutants, 15 caught

| # | mutant | verdict |
|---|---|---|
| M1 | `recurring_completed` reverts to the Project page's old word | CAUGHT |
| M2 | `rescheduled` reverts to the Goal page's old word | CAUGHT |
| M3 | `returned` drops the deferral, merging §9's two facts | CAUGHT |
| M4 | `rule_*` reverts to the evening's word | CAUGHT |
| M5 | the prefix rule ignores scope (always the long form) | CAUGHT |
| M6 | the prefix rule ignores the SUBJECT (any scope strips) | CAUGHT |
| M7 | an unknown kind is blanked instead of named | CAUGHT |
| M8 | the timeline map is bypassed (raw key falls through) | CAUGHT |
| M9 | Home formats its own date again | CAUGHT (also `capture/home`) |
| M10 | Home drops the follow-up again | CAUGHT |
| M11 | a passed follow-up says "today" again | CAUGHT |
| M12 | the raw `LocalTime` returns to the recommendation | CAUGHT (also `today/guidance`) |
| M13 | the Event's date goes back into `status` | CAUGHT |
| M14 | a past range gets relative words too | CAUGHT *(after a fixture fix)* |
| M15 | Recently stops filtering to work that finished | CAUGHT by `execution/goal` |

Two of these did real work before they were caught.

**M14 escaped first.** No record in the fixture was due on a PAST range's last
day, so the §4 rule that a past review must not say "today" was asserted over a
set that could never contain the word. A record due on last week's final day
makes the two settings distinguishable.

**M15's anchor was "not found"** — which revealed that §2.6's fix had been
silently lost. Verifying the browser suite meant checking the tree out at the
audit commit and back again, and an edit not yet committed did not survive the
round trip. The mutation run is what noticed.

The harness needed a correction of its own: the first version read only
`changes/coherence` and reported M15 as an escape while `execution/goal` — where
that assertion lives — was red in the same run. A mutant is caught by whichever
suite owns the guarantee it breaks.

## 4.4 Performance (§51)

Milliseconds, best of three, one process.

| n actions | indexes | project ctx | goal ctx | week review | search index | Home ×40 | 10k `changeWord` |
|---|---|---|---|---|---|---|---|
| 100 | 0.2 | 7.9 | 6.5 | 1.3 | 0.2 | 0.8 | 0.3 |
| 1,000 | 2.5 | 58.3 | 46.3 | 10.0 | 1.3 | 0.7 | 0.1 |
| 5,000 | 6.6 | 260.6 | 223.3 | 40.6 | 4.4 | 0.6 | 0.2 |

The vocabulary is a plain object lookup and is nowhere near the cost: **0.019 µs
per `changeWord` call**, 0.027 µs through the timeline map. The project and goal
context numbers are LIFEOS-087/088's and are unchanged by this sprint.

The interesting measurement is the substitution itself — 5,000 row chips:

| | old | new |
|---|---|---|
| an OVERDUE row | 221.6 ms | **202.9 ms** |
| a row due TODAY | 213.4 ms | **2.1 ms** |
| a PAST follow-up | 0.1 ms | **211.5 ms** |

`dueLabel` is *100× cheaper* for work due today, because it returns a constant
without touching `Intl`; a bare `formatDayKey` costs 197 ms per 5,000 calls and
is the whole expense in every row above.

The follow-up row is the honest opposite, and the number is the correctness fix
rather than overhead: the old path was fast **because it was wrong** — it
returned the constant "Follow up today" for any follow-up whose date had passed.
Stating the real date costs one `Intl` call. At the page level, with the waiting
list uncapped:

```
Project page, 5,000 actions -> 715 waiting rows: 27.0 ms for every follow-up phrase
                                    8 open rows:  0.3 ms for every due phrase
```

No memo was added. §42 and §44 rule out cached labels, and 27 ms on a page that
would already be rendering 715 rows is not where the time goes.

## 4.5 Accessibility (§52)

Measured on the elements whose text this sprint produces, in both schemes.
Colours are returned as `lab()` on this project; the first probe parsed the
three components as RGB and reported every dark-mode phrase at 1.06, which would
have been filed as an invisible-text defect. The conversion is now done exactly,
through a canvas.

| | light | dark |
|---|---|---|
| `/today` | 4.67 | 4.08 |
| `/project/p1` | 2.54 | 4.08 |
| `/goal/g1` | 2.54 | 7.51 |
| `/today/review` | 4.67 | 4.08 |

The 2.54 is `text-zinc-400` at 11 px on the light ground, below WCAG AA's 4.5
for normal text; the 4.08 values are marginally below it too.

**This sprint did not introduce it and does not fix it.** `git diff` over
`components/` shows every `className` in the change byte-identical — only the
text inside the spans differs — so these are the product's existing 11 px meta
styles. The numbers are recorded here because §52 asked for the measurement, and
the honest answer is that the contrast of the meta row is a live, pre-existing
issue worth its own sprint rather than a silent widening of this one.

Two labels render at 10 px ("Cancelled", "Completed" on the project footer),
also pre-existing.

## 4.6 Visual review (§50)

Nine surfaces × light, dark and 390 px mobile. Nothing clipped, no horizontal
scroll on any surface (max overflow 0 px), no truncated phrase. The project page
now reads with one grammar throughout:

```
Suggested next   Pay the application fee   Was due Tue, Sep 1
Also open        Renew the parking permit  Was due Thu, Sep 3
                 Call the dentist          Due today
Waiting on       Signed form from Ana      Follow up was Wed, Sep 2
                 Transcript from Maria     Follow up today
Recently         Book the venue            Completed · Sat, Sep 5
                 Order the banner          Cancelled · Sat, Sep 5
```

---

# 5. The twelve claims (§55)

1. **A commitment is described the same way wherever it appears.** Six literals
   became one typed table; a page can no longer hold a private opinion about a
   recorded fact. *(§4.1, M1–M8)*
2. **A due date reads the same on Home, Today, a project and a goal.** Home
   formatted its own; two row chips had no past tense at all. *(§2.2, browser 1–7)*
3. **A passed deadline is never described as still ahead.** The one drift in the
   sprint that was a wrong claim rather than a different word. *(§1.7)*
4. **A stored time becomes prose in exactly one place.** Suggested Next said
   "14:00" about the action Home called "2 PM". *(§2.3, M12)*
5. **A follow-up is a follow-up, not a due date.** Home showed neither; two pages
   said "today" about a date a week gone. *(§2.4, M10, M11)*
6. **Deferred is still not rescheduled.** LIFEOS-090's distinction survives
   canonicalization, in the words and on the records. *(98.22–98.24, M3)*
7. **A relative word is only used on a day it is true about.** A review of last
   week states dates; a review of this week says "today". *(§2.2, M14)*
8. **"Moved forward" means work that finished.** A cancellation used to appear
   under it, hidden behind a missing table entry. *(§2.6, M15)*
9. **An unknown kind is neither guessed at nor blanked.** *(§32, M7)*
10. **No raw database enum reaches a person.** *(browser 16)*
11. **Nothing new is stored.** No field, no cached label, no migration.
    Repository migration head **0047**, unchanged.
12. **Six of the ten anticipated problems did not exist, and are reported as
    measurements rather than worked around.** Titles, `dueLabel` on signal
    surfaces, Home's two creation paths, waiting repetition, correction
    propagation and the complete control were already coherent. They are asserted
    as regression guards.

---

# 6. Gates (§53)

| gate | result |
|---|---|
| `changes/coherence` (new) | **79/79** |
| Full deterministic suite | **6135/6135** across 62 suites |
| `smoke-098-outcome-coherence` | **34/34** (15 red against a revert) |
| Mutation (§49) | **15/15 caught** |
| 082 executive guidance | 64/64 |
| 083 command center | 77/77 |
| 085 universal search | 54/54 |
| 086 people | 53/53 |
| 087 project context | 52/52 |
| 088 goal context | 83/83 |
| 090 replanning | 69/69 |
| 091 evening close | 87/87 |
| 094 decision inbox | 47/47 |
| 095 capture home | 67/67 |
| 096 clean outcomes | 36/36 |
| 097 capture corrections | 41/41 |
| `npm run release:audit` | PASS 17/17 |
| `npm run release:routes` | PASS 25/25 |
| `npm run release:export` | PASS 14/14 |
| `npm run audit:security` | PASS |
| `tsc --noEmit` | clean |
| `eslint lib components app` | 0 errors (2 pre-existing warnings, untouched files) |
| `next build` | clean |

`smoke-075-cross-device` and `smoke-076-sync-trust` were not run for this sprint;
they time out waiting for `[data-health-state="synced"]` on `main` as well as on
this branch, and no code this sprint touches is on their path.

## Files

| | |
|---|---|
| new | `lib/changes/vocabulary.ts`, `lib/changes/coherence-selftest.ts`, `scripts/smoke-098-outcome-coherence.cjs` |
| changed | `lib/actions/due.ts`, `lib/capture/home.ts`, `lib/command/records.ts`, `lib/execution/goal-context.ts`, `lib/memory/answer.ts`, `lib/memory/changes.ts`, `lib/memory/week.ts`, `lib/today/daily.ts`, `lib/today/evening.ts`, `lib/today/recommend.ts`, and five components |
| assertions updated | `lib/capture/home-selftest.ts` (clock-dependent), `lib/today/guidance-selftest.ts` (pinned the raw time), `lib/execution/goal-context-selftest.ts` (Recently's contract) |
