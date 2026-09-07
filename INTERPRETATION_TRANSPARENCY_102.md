# LIFEOS-102 — Interpretation Transparency / What Did Conqify Understand?

**North star:** when Conqify acts on my words, I should be able to see what it
understood without reading internal metadata.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `da77790fba571b079a7d13c90f9c165a0c440bab` (PR #107 merged) |
| Branch | `claude/lifeos-102-interpretation-transparency` |
| Migration required | **no** (§40) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Twenty captures (`scripts/fixtures/lifeos-102-world.cjs`), run twice: once
through the real pipeline to record every structured fact that exists at render
time, and once through the running product to record what is actually on screen.
**A, B and C are the difference between those two columns.**

## 1.1 A — what already exists at render time

Everything §4 asks for, and it is already computed by the existing stack:

| fact | where it comes from | example measured |
|---|---|---|
| kind, title | `interpret` → `describeCreated` (read back from the store) | `action` · "Call the dentist" |
| date | `extractTemporal` → `dueLabel` | "Due Fri, Sep 11" |
| time | `extractTimeOfDay` → `formatLocalTime` | "2 PM" |
| person / object | `detectWaiting` | `waitingOn: "Ana"`, `waitingFor: "signed lease"` |
| project / goal | `matchRecords` + 089 `suggestContext` | `strong` → "Clinic launch" |
| ambiguous context | 089 `ambiguousAlternatives` | `["Clinic launch", "Clinic lease"]` |
| recurrence | `extractRecurrence` → `describeRule` | `{weekly, [1]}` → "Every Monday" |
| matched record | `readChanges` → `candidateMatches` | `["Request recommendation from Smith", "…Jones"]` |
| asking reason | `askingBecause` | "More than one thing matches." |

## 1.2 B — what is hidden, measured

The stored record diffed against the panel that reports it, ten auto-finishing
captures. **Nine of ten hide nothing.** Date, time, person, object, project,
event start time — all reach the panel. The exception is one fact, in three
shapes:

```
"Run every Monday"                        record recurrence {weekly,[1]}
                                          panel  "SAVED AS ACTION · Run"
"Pay the rent on the first of every month" record recurrence {monthly, day 1}
                                          panel  "SAVED AS ACTION · Pay the rent"
"Take the dog out every day"              record recurrence {daily}
                                          panel  "SAVED AS ACTION · Take the dog out"
```

A recurring commitment is reported as though it were a one-off. This is not only
a transparency gap — it is §38's rule broken: *the result must describe what
actually exists*.

Two details make it sharper:

* **The product has already written the sentence.** Each of those records carries
  its own history entry `{action: "edited", detail: "Every Monday"}` — the
  canonical phrase from `describeRule`, computed at commit time and then not
  shown.
* **A recurring EVENT reads correctly by accident.** "Staff meeting every Tuesday
  at 10" keeps the phrase in its *title*, so the panel says it. The action path
  strips the phrase out of the title (LIFEOS-096, correctly) and nothing puts the
  fact back.

## 1.3 C — what is duplicated

Nothing, on the surfaces measured. LIFEOS-096 §9 already removed the
"Transcript from Maria / Waiting on Maria" repetition, and the audit confirms
`describeCreated` still suppresses a `waitingOn` the title already contains —
§16's "avoid duplicating the person three times" is in force.

## 1.4 D, E — the asking reasons are already human

Every reason measured on screen:

```
"A note is yours to confirm."     "A goal is yours to confirm."
"A rule is yours to confirm."     "More than one thing matches."
"A date here wouldn't be kept."   "You may already have this."
"Needs your confirmation."        "Conqify will not create this for you"
```

None exposes a parser rule name, an authority enum or a score. **§41's red 2
does not hold.**

## 1.5 F, G, H, I, J

* **F.** Yes, and it already is one model: `describeCreated` projects the *stored*
  record for the finished state, and the review panel projects the *candidate*
  for the asking state. The split is correct and §37 is why — they are different
  layers, not two explanations of one thing.
* **G.** Raw text is used for the source quote and nothing else. Every displayed
  fact in the finished state comes from the stored record.
* **H.** A correction. See §1.7.
* **I.** In the panel that already exists. The audit found no missing *place* —
  it found one missing *fact*.
* **J.** The smallest useful disclosure is **no new disclosure at all**. §34
  forbids echo, and a "What I understood" panel repeating the four lines already
  on screen would be exactly that.

## 1.6 §41's eight candidate reds, tested

| | red | verdict |
|---|---|---|
| 1 | simple result does not expose what was understood | **HOLDS**, in one exact form — §1.2 |
| 2 | asking state uses internal vocabulary | does not hold — §1.4 |
| 3 | multi-intent unclear | does not hold — the panel says "I found 2 things:" and renders both |
| 4 | completion ambiguity hides the matches | does not hold — `"2 records match “recommendation request”. Which one?"` with both selectable |
| 5 | possible context indistinguishable from committed | does not hold — "POSSIBLE CONTEXT / Nothing is selected — pick the one you meant" vs a plain committed detail line |
| 6 | correction sheet does not separate source from record | does not hold — `You said: “Remind me to call the dentist Friday”` above `Title="Call the dentist"` |
| 7 | Quick Capture differs from Home | does not hold — LIFEOS-100 §42 parity, re-verified |
| 8 | cleaned title presented as a user quote | does not hold — the only quoted string on the page is the raw source |

Six of the eight were already solved, by LIFEOS-065/066 (the change panel),
089 (context tiers), 095/096 (outcome projection) and 097 (the correction sheet).
Reporting that first is the point of auditing first.

## 1.7 The red the brief did not list

§43 scenario 19 asks whether a stale interpretation is presented as current truth
after a correction. Measured — and it is:

```
correct the TITLE   store "Call the orthodontist"   panel "Call the dentist"
correct the DATE    store dueDate 2026-09-20        panel "Due Fri, Sep 11"
in Quick Capture    store "Call the orthodontist"   panel "Call the dentist"
```

`describeCreated` reads from the store, which is why the *first* render is
truthful — but it is called once, at commit, and the result is held in React
state. The correction writes to the store and nothing recomputes. So the panel
keeps asserting a record that no longer exists, on both doorways, for both
fields.

§28 and §38 both forbid this, and it is the more serious of the two findings:
§1.2 omits a fact, this one **states a false one**.

---

# 2. What will be built

Two fixes. Both are truthfulness repairs to the projection, neither touches the
parser (§39) and neither persists anything (§40).

1. **Recurrence reaches the outcome panel**, through `describeRule` — the
   formatter that already produced the phrase sitting in the record's history.
2. **The outcome panel re-derives from the store after a correction**, using the
   same `describeCreated` call the context-offer chip already uses for exactly
   this reason.

**No "What I understood" disclosure is being added.** The audit found the panel
is already the interpretation summary, and §34 forbids an expander that echoes
the four lines above it.
