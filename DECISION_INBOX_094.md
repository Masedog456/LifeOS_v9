# LIFEOS-094 — Commitments Inbox / What Needs a Decision?

**North star:** when Conqify knows something needs my decision, it should put it
in one small place instead of letting it leak across the app.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `bdee863da251233e0c08625f96d38af88275d58e` (PR #99 merged) |
| Branch | `claude/lifeos-094-decision-inbox` |
| Migration required | **no** — derived from existing records (§24) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the real builders on a world carrying one of everything: an
active goal with no executable work, an active goal that has some, an achieved
goal with none, a plain overdue action, a wait whose follow-up is due, a wait
whose follow-up is three weeks out, an action deferred three times, one deferred
once, a blocked action, and an unprocessed capture matching two projects.

Probe: `scratchpad/probe94.cjs`.

## 1.1 A, B — Judgment versus open work

The ten attention kinds, sorted by §18's test — *does Conqify need the user, or
does it just need the user to get on with it?*

| Kind | Resolutions it already offers | Verdict |
|---|---|---|
| `overdue` | complete · reschedule · defer | **attention** — do it |
| `due_soon` | open · reschedule · defer | **attention** |
| `recurring_due` | complete occurrence · open | **attention** |
| `returned_today` | open · complete · defer · reschedule | **attention** |
| `dormant` | open · reschedule · defer · complete | **attention** |
| `blocked` | **open blocker · open record** | **attention** — see §1.4 |
| `project_no_next_action` | create next action · open | **attention** |
| `follow_up_due` | **set follow-up · stop waiting** | **decision** |
| `goal_path_missing` | **create goal project · open** | **decision** |
| `repeated_deferral` | *(no entry — shortlist-only)* | **decision** |

The resolutions are the tell. Where a kind's options are *ways of doing the
work* — complete it, move it, open it — the user needs notice, not a decision.
Where the options are mutually exclusive answers to a question the system cannot
settle — keep waiting or stop waiting; give this goal a path or leave it — that
is a judgment boundary.

## 1.2 C, D — What has a resolution, and what has none

`follow_up_due` and `goal_path_missing` carry theirs in `RESOLUTIONS_BY_KIND`.
`repeated_deferral` is a shortlist-only kind with no entry, so its options come
from `resolutionsForAction` — LIFEOS-090's vocabulary, which already offers
"Not today", "Reschedule" and "Stop".

**`PERSONAL_CODE_CONFLICT` has no product evidence and is excluded.** LIFEOS-079
has no conflict detector: the only occurrence of "conflict" in
`lib/code/personal-code.ts` is a **topic keyword** in a life-area list
(`conflict: ["conflict", "argument", "argue", "fight", …]`). §6 says not to
invent a kind because it sounds useful, and §16 conditions it on the detection
being "concrete and actionable". It is not, so the kind does not exist.

## 1.3 E — Duplicates, and a constraint that changes the design

The attention shortlist **already collapses one record to one kind** — and it
picks by `ATTENTION_ORDER`, which puts attention ahead of judgment. Measured on
an action that is both overdue and deferred three times:

```
a-both kinds: ["overdue"]        ← the deferral decision is invisible
```

So **the queue cannot be a filter over the shortlist.** Filtering it would hide
every decision that happens to sit on a record with a louder attention signal.
The queue must derive from the sources directly and apply its own precedence.

**Correction to a first reading of that same run.** The goal `g-none` also
vanished from the shortlist once an action was linked to it, and I first read
that as the `goal_path_missing` signal resolving itself. It was not — the
shortlist is capped, and the new row displaced it. Measured directly:

```
goalPathState       → "actions"
goalsMissingPath    → ["g-none"]     ← still listed
goalsWithoutAnyPath → []
```

`goalPathMissing` asks only about **projects**, and LIFEOS-088 kept it that way
deliberately: Today's sentence claims only that no active project carries the
goal. This queue's row asks *"what should carry this goal?"* and states *"no
active project or live action is linked"* — a stronger claim, and a false one
for a goal with a live directly-linked action. So §13's "088 semantics" here
means `goalsWithoutAnyPath`, the predicate 088 added for exactly this question.
Assertions 94.6b–94.6d pin all three facts.

## 1.4 F — What stays contextual

* **Blocked work.** Its only resolutions are `open_blocker` and `open_record` —
  navigation, not a choice. §12 says not to add every blocked action when Today
  and the Project already explain it, and the evidence agrees: there is no
  decision here to present.
* **Person ambiguity (086).** `longerForms(state, name)` needs a *name* — it is a
  query-time helper, and there is no store-wide "these two people are ambiguous"
  derivation. Marcus and Marcus Webb are only ambiguous when something asks about
  Marcus.
* **Memory `NEEDS_CHOICE`.** An answer *status*, computed per question. Nothing
  persists it, and it does not exist until someone asks.
* **Replan exceptions (090).** Produced by an attempted operation and consumed by
  the preview that produced them. There is no record of "the user tried and was
  refused", and §15 says not to invent an error inbox.

## 1.5 G, H — Persisted versus derived, and the existing surfaces

Everything above is derived. The one persisted thing is the `Capture` itself —
see §1.7.

Two inbox surfaces already exist and neither is this one:

* **`/inbox`** — the proposal review queue. Genuinely a judgment surface, but it
  answers a different question: *should this capture become this record?*
* **`/plan/inbox`** — planning hygiene. Measured on the fixture, it returned five
  "open action with no horizon" rows. §17 excludes exactly this.

## 1.6 The reds

### RED 1 (§45.1) — no coherent answer exists

```
"what needs my decision?"        → the generic capability line
"what am I putting off deciding?" → the generic capability line
"what choices are unresolved?"   → "Nothing … is asking for attention right now."
```

The third is worse than the first two: it answers confidently, from the
attention model, about a different question. **Confirmed.**

### RED 2 (§45.3, §45.4, §45.5) — the decisions are scattered and outranked

A due follow-up, a three-times deferral and a goal with no path are visible in
three different places (Today, the Evening Close, the Goal page) and nowhere
together. Worse, §1.3 shows a decision can be **hidden entirely** by an
attention signal on the same record. **Confirmed.**

### RED 3 (§4) — the obvious name is taken

The command palette already has **"Open Decisions"**, pointing at `/decisions` —
the knowledge `Decision` record type, an entirely different thing. Calling this
queue "Decisions" would collide with an existing product noun. **Confirmed**, and
it settles §4: the label is **"Needs your decision"**.

## 1.7 Not a red — capture ambiguity IS durable

§30 and §31 anticipated that capture ambiguity would be transient and therefore
ineligible. **The measurement says otherwise.** A `Capture` persists with a
`processingStatus`, and the interpretation is pure, so the ambiguity re-derives
from the stored record:

```
capture c1 (inbox): "Follow up on the applications and the portfolio review"
  candidates: waiting
  [waiting] suggestions: "More than one Project matches — choose which."
```

`interpret(text, state, today)` → `suggestContext(candidate, state, index)`, both
pure, both reading only persisted state. An unprocessed capture whose context is
contested is a durable judgment boundary and belongs in the queue.

The boundary §31 asks about is real but sits elsewhere: a capture the user has
already **processed** has no unresolved ambiguity, and a candidate the composer
is holding *before* the capture is saved has no record at all. Neither is
eligible; an inbox capture is.

## 1.8 I — What must never enter

Overdue, due soon, recurring due, returned, dormant, blocked-without-a-choice,
project-with-no-next-action, every planning-inbox hygiene row, future waiting,
achieved and abandoned goals, and any capture that is not still in the inbox.

## 1.9 J — The smallest model

`lib/guidance/decisions.ts` — a pure `DecisionInbox` derived from four sources,
each already built:

```
WAITING_FOLLOW_UP      follow_up_due signals            (070)
REPEATED_DEFERRAL      repeatedlyPostponed, threshold 2 (081)
GOAL_NO_PATH           goalsWithoutAnyPath              (088 semantics)
AMBIGUOUS_CAPTURE      interpret + suggestContext       (080/089)
```

Deduped by underlying record with an explicit precedence, ordered by kind then
by date then by id, capped, and resolved through the primitives those systems
already expose. No persistence, no dismissal state, no score.

## 1.10 Migration (§24)

**None.** Every item is derived from records that already exist, so a resolved
condition stops producing its item for free (§39) and the queue reflects synced
state without a sync domain of its own (§41). Head stays at **0047**; `0048` is
not written.

---

# 2. What shipped

## 2.1 The name (§4)

**"Needs your decision."** Not "Decisions" — the palette already has **Open
Decisions**, pointing at `/decisions`, the knowledge `Decision` record type.
Not "Decision Center", "Decision Intelligence Hub" or "Command Queue". The
label is the question the surface answers, in the product's existing voice.

## 2.2 The model — `lib/guidance/decisions.ts`

Pure. `(state, indexes, today) → DecisionInbox`. No writes, no clock, no AI.

| Kind | Source | Question | Evidence |
|---|---|---|---|
| `AMBIGUOUS_CAPTURE_CONTEXT` | `interpret` + `suggestContext` (080/089) | Which project does this belong to, if either? | `capture.text` |
| `WAITING_FOLLOW_UP` | `follow_up_due` signals (070) | Follow up with *X*? | `action.followUpDate` |
| `GOAL_NO_PATH` | `goalsWithoutAnyPath` (088) | What should carry *“G”*? | `project.goalId` |
| `REPEATED_DEFERRAL_REVIEW` | `repeatedlyPostponed`, threshold 2 (081) | Keep *“A”*? | `action.history[].deferred` |

That is every kind with product evidence behind it, and no others. Three that
were considered and rejected, with the reason each time being *the evidence
does not exist*, not *it did not fit*:

* **`PERSONAL_CODE_CONFLICT`** — LIFEOS-079 has no conflict detector. The only
  occurrence of "conflict" in `personal-code.ts` is a topic keyword in a
  life-area list, beside "argument" and "fight". §6 forbids inventing a kind
  because it sounds useful.
* **`AMBIGUOUS_PERSON`** — `longerForms(state, name)` needs a *name*. Marcus and
  Marcus Webb are ambiguous only once something asks about Marcus; there is no
  store-wide derivation to read.
* **`BLOCKED_REVIEW`** — a blocked action's only resolutions are `open_blocker`
  and `open_record`. Navigation, not a choice (§12).

### Precedence (§19, §37)

One underlying record produces at most one row. The kinds are ranked in the
order above and the earliest wins: an action that is both a due follow-up and
a three-times deferral asks **once**, as the follow-up, because a date that has
arrived outranks a pattern. Ties break by the date the reason refers to, then
by key. **There is no score.**

### An option is a type, not a string

`DecisionOption.resolution` is a `ResolutionKind` (071) and `DecisionOption.replan`
is a `ReplanIntent` (090) — imported types, so a label naming an operation
nothing implements cannot compile. The first draft offered "Stop doing this" as
`resolution: "stop"`, which is not a `ResolutionKind` at all; the field was
`string` and nothing noticed. Assertion **94.22b** now checks every named
operation against the engine that would run it, on the real record — offered,
enabled, and under the label the row prints. Verified by mutation.

Two vocabularies rather than one because neither covers the queue alone: 071
cannot end a commitment, and 090 has no follow-up or goal-project operation.

## 2.3 The surface

`/today/decisions`, rendered by `components/today/DecisionInbox.tsx`.

Under `/today` rather than at `/decisions`, for the collision in §1.6 RED 3;
`/today/review` set the namespace precedent in LIFEOS-092. **No new nav item**
(§25) — the audit did not show the queue earns one.

**It renders no engine of its own.** Every control is filtered out of a list
`resolutionsForAction` / `resolutionsFor` / `planReplan` built, with their
labels, their enablement and their bounded-choice panels. This file never
constructs a control and never touches a store field.

Reached from four places, all of them existing:

| Where | What it shows |
|---|---|
| Today, orientation line | `… · 4 needing your decision` — a clause in its own words |
| Today, under the line | `Needs your decision →` — absent at zero |
| `/today/review` | one pointer, `Needs your decision · N →`, today only |
| Command palette | **Needs your decision**, beside the untouched **Open Decisions** |

The orientation line keeps "needing your decision" as a **separate clause in
different words** from "needing attention". Folding the two counts together
would erase the distinction this sprint exists to draw, on the one line most
people read.

## 2.4 What this deliberately did not do

**Today's Needs-attention section still shows the due follow-up**, with the
same two controls. That is LIFEOS-082's shortlist answering its own question,
and §12 of this brief assumes those surfaces keep explaining things. The queue
is additive: it gives the judgment calls one address, and it does not strip
LIFEOS-082 of a row it has evidence for. Flagged here because it is a judgment
call a reader might make differently.

**No migration.** Head stays at **0047**. `0048` is not written.

---

# 3. What the testing found

## 3.1 Deterministic — `lib/guidance/decisions-selftest.ts`, 66 assertions

Whole repository: **5891 / 5891 across 58 suites.**

## 3.2 Browser — `scripts/smoke-094-decision-inbox.cjs`, 47 assertions

All passing against the production build. The exclusions are nine of them: an
overdue action, one due tomorrow, a follow-up three weeks out, a single
deferral, a blocked action, its blocker, a goal that already has work, an
achieved goal, and a capture already filed — none reach the page.

### The boundary §40 assumed away

§40 asks what happens when the record changed "in another tab". **That race
does not exist in this product.** `lib/mvpStore.ts` registers no `storage`
listener, so a second tab's write is not observed at all until a reload. Two
assertions pin it as behaviour:

```
19 §40 a second tab's write is not observed live — this app has no cross-tab sync
20 §40 …and a reload derives the queue from what is actually stored
```

`decisionStillStands` is real, is called before the one operation this file
initiates, and is proven against an already-moved state by 94.35–94.38. What it
cannot do is see another tab, and this is not the sprint to change that.

## 3.3 Mutation — twelve, ten caught, two escapes that were both real

Ten reddened immediately: open work leaking in, the goal predicate reverting to
projects-only, a filed capture asked about again, the threshold dropping to one
deferral, precedence inverting, the cap failing, the ordering losing its kind,
two staleness checks, and a zero printed on Today.

**M4** replaced the ambiguity test with "has a reason" and nothing reddened —
because every inbox capture in the fixture was ambiguous, so the two conditions
selected the same row. A capture whose context 089 suggests *confidently* now
sits in the fixture (`c3`), and M4 reddens on it. That capture is the whole
admission test: a suggestion the composer can simply make is not a judgment
boundary.

**M6** removed an `isLive` guard on the follow-up source and nothing reddened —
because the guard was dead. `isFollowUpDue` requires `status === "waiting"`, and
a waiting action is live by definition. Removed rather than pinned: dead logic
reads like a protection the code does not have.

## 3.4 Performance (§49) — a 2.2-second regression, found and fixed

| Records | Before | After |
|---|---|---|
| 100 | 4.4 ms | **3.8 ms** |
| 1,000 | 110 ms | **18 ms** |
| 5,000 | **2186 ms** | **101 ms** |

Every other source reads an index or a filter. The capture source cannot:
deciding whether a capture's context is contested runs `suggestContext`, which
calls 089's `matchRecords`, which walks the store. Right for one composer
keystroke; wrong five hundred times — and this builder runs on **Today**, on
every store change.

`DECISION_CAPTURE_SCAN = 12`: the queue examines the twelve most recent unfiled
captures, newest first. It is a decision surface, not a counter for the capture
inbox; an inbox of hundreds is a processing backlog and `/process` is the
surface for it. Assertions 94.46b and 94.46c pin the bound, so a change that
makes the scan proportional to the inbox again reddens rather than ships.

## 3.5 Visual review (§48) — four things no assertion could see

Screenshots at desktop and mobile across zero / one / four / capped /
ambiguity-heavy / goal-heavy / follow-up-heavy worlds, plus Today.

1. A lone **"Open" orphaned on a second line** under every wait —
   `ResolutionControls` brings its own column and the options this file owns
   were stacked below it. One flex row now.
2. **"Keep “Request recommendation”?" directly above "Request recommendation".**
   Two kinds quote the record inside the question, so the title line is omitted
   when the question already carries it.
3. **Three rows reading "What should carry this goal?"**, told apart only by a
   secondary line. The goal question now names the goal.
4. On Today, **"4 needing your decision" with "Needs your decision · 4" three
   lines below**. The count is stated once, in the sentence; the link is a link.

## 3.6 A claim in the audit that was wrong

§1.3 originally read the goal's disappearance from the *shortlist* as its
`goal_path_missing` signal resolving. It was the cap displacing it. Measured
directly, `goalsMissingPath` still listed the goal. The correction is in §1.3
above and it changed the implementation: the queue reads `goalsWithoutAnyPath`,
which is the predicate matching the sentence the row actually prints.

---

# 4. The twelve product claims (§53)

1. **There is one place to see what needs a decision.** `/today/decisions`,
   reached from Today, the evening close and the palette. — *browser 1, 25–31*
2. **It contains only judgment calls.** Nine kinds of open work are asserted
   absent. — *94.6, browser 3*
3. **Attention and decision are different lists.** The shortlist raises things
   the queue does not, and the two are not the same set. — *94.7, 94.8*
4. **A decision cannot be hidden by a louder attention signal.** The queue
   derives from sources, not from the shortlist, which collapses one record to
   one kind. — *94.11–94.13*
5. **One record asks once.** Explicit precedence, first writer wins. — *94.9–94.11*
6. **Every row asks a question and says why.** — *94.17–94.20, browser 4–5*
7. **Every option maps to something that exists**, offered and enabled under the
   label the row prints. — *94.22, 94.22b, browser 6–10*
8. **Nothing resolves itself.** No default, nothing preselected, no write on
   render. — *94.23, browser 11–12*
9. **Answering removes the row, and the record is what changed.** — *94.31–94.34,
   browser 13–14, 17–18*
10. **Nothing about the queue is stored.** No dismissal, no status, no domain,
    no migration; a reload re-derives. — *94.45, 94.46, browser 15–16*
11. **It stays small and says what it left out.** Cap 5, remainder stated,
    bounded capture scan. — *94.29, 94.30, 94.46b–c, browser 23–24*
12. **It never diagnoses the person.** Three deferrals is evidence of three
    deferrals. — *94.39–94.42, browser 34–35*

---

# 5. Files

```
lib/guidance/decisions.ts              the model (new)
lib/guidance/decisions-selftest.ts     66 assertions (new)
components/today/DecisionInbox.tsx     the surface (new)
app/today/decisions/page.tsx           the route (new)
scripts/smoke-094-decision-inbox.cjs   47 browser assertions (new)

components/today/TodayCommandCenter.tsx  §26 link, §27 clause
components/today/ReviewToday.tsx         §28 pointer
lib/today/daily.ts                       orientationLine takes the count
lib/command/commands.ts                  §32 palette entry
lib/design/route-inventory.ts            route registered
lib/release/routes.ts                    data-bearing
lib/onboarding/education.ts              help coverage
```

## Gates

```
deterministic     5891/5891 across 58 suites
browser (094)     47/47
browser (prior)   081 72/72 · 088 83/83 · 089 66/66 · 090 69/69
                  091 87/87 · 092 59/59 · 093 57/57
route smoke       25/25
release audit     17/17
export verify     14/14
route audit       PASS   secret scan  PASS
tsc               clean
eslint            0 errors (2 pre-existing warnings)
build             PASS
migration head    0047, unchanged
```
