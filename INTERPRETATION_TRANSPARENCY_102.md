# LIFEOS-102 — Interpretation Transparency / What Did Conqify Understand?

**North star:** when Conqify acts on my words, I should be able to see what it
understood without reading internal metadata.

## STATUS: COMPLETE

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

---

# 3. What was built (§39, §40)

Two changes. Both are truthfulness repairs to the **projection**; neither touches
the parser, changes an authority, adds a link, or persists anything.

## 3.1 Recurrence reaches the outcome panel

`describeCreated` now pushes `describeRule(a.recurrence)` into the detail line.

```
"Run every Monday"                          Run           →  Run · Every Monday
"Pay the rent on the first of every month"  Pay the rent  →  · Every month on the 1st
"Take the dog out every day"                Take the dog out → · Every day
```

`describeRule`, not a new phrase: the record's own history already carries this
function's exact output from commit time, so a second wording would be the
product disagreeing with itself about one rule (§24). The event path reads the
same field through the same formatter, guarded against the duplicate its title
usually already carries.

## 3.2 The panel re-derives from the live store

```tsx
const shownOutcomes = useMemo(
  () => (finished ? describeCreated(state, finished.outcomes.map(refOf), today) : []),
  [finished, state, today],
);
```

Re-derived **at render** rather than patched into the correction path. A
correction is not the only way the store moves under this panel — an undo
elsewhere, a sync, another tab — and patching `onClose` would have fixed the one
route the audit happened to walk. `state` comes from `useStore()`, so this
re-reads on any store change from any cause, and a **deleted** record now drops
out of the list, which is §38's rule from the other side.

The context-offer chip lost its own `describeCreated` call. It was the one place
that recomputed, which is exactly why the offer chip looked right and corrections
did not.

## 3.3 What was deliberately not built

**No "What I understood" disclosure.** §9 offers one and §29 asks for Home to
stay calm; the audit settled it. Every fact §4 lists already reaches the panel
except the one now fixed, so an expander would repeat the four lines above it —
which is precisely what §34 forbids. The finished panel *is* the interpretation
summary.

---

# 4. Proof

## 4.1 Browser — `scripts/smoke-102-transparency.cjs`, 20/20

Seventeen assertions are labelled **GUARD** in the file itself, because they pin
transparency LIFEOS-065/066, 089, 095/096 and 097 already built. Three are this
sprint's: **4** (recurrence) and **18–19** (staleness).

## 4.2 Full-revert proof (§45)

Both production files reverted to `da77790`, rebuilt, re-run: **17/20**.

| red | |
|---|---|
| 4 | `stored {"frequency":"weekly",...} but panel says "SAVED AS ACTION Run"` — all three shapes |
| 18 | `panel="Call the dentist" store="Call the orthodontist"` |
| 19 | `panel="Due Fri, Sep 11" store=2026-09-20` |

Three of twenty, and the suite's own header says so in advance rather than
claiming credit for all twenty. **That is the honest measure of this sprint: the
product was already transparent, and two facts were wrong.**

## 4.3 Mutation testing (§44) — 12 mutants, all caught, one after the suite grew

| | mutant | outcome |
|---|---|---|
| M1 | show the candidate's intended meaning as the saved result | CAUGHT 18, 19 |
| M2 | quote the cleaned title as user text | CAUGHT 16, 17 |
| M3 | present a possible Project as committed | CAUGHT 15 |
| M4 | hide the ambiguous matches | CAUGHT 13 |
| M5 | collapse multi-intent to one item | CAUGHT 10 |
| **M6** | expose the authority enum in the outcome lead | **ESCAPED**, then CAUGHT 20 |
| M7 | expose a confidence number | CAUGHT 20 |
| M8 | duplicate the waiting person | CAUGHT 5 |
| M9 | the panel stops re-deriving | CAUGHT 18, 19 |
| M10 | Home / Quick Capture divergence | CAUGHT 20 |
| M11 | the recurrence detail comes off | CAUGHT 4 |
| M12 | recurrence rendered as parser syntax | CAUGHT 4 |

**M6 walked through the internals sweep because the sweep was case-sensitive
against text the product uppercases.** The outcome lead is CSS-uppercased and
`innerText` returns rendered text, so the panel said `AUTO_WITH_UNDO` and a
lowercase `includes()` found nothing — the one place internals would most likely
leak is the one place the product shouts. The sweep is now case-insensitive.

The same pass replaced a bare `"%"` in the forbidden list with a
confidence-*shaped* pattern; `"%"` would have fired on any legitimate percentage
the product ever shows, and §7 forbids a score attached to an interpretation, not
the character.

## 4.4 Two probes that measured nothing, corrected

* **The §36 provenance helper returned an empty array.** It skipped any element
  with children, and the correction sheet's source line is a `<p>` holding two
  `<span>`s — so `every()` was vacuously true and assertion 17 could not fail. It
  now reads block text and finds the one quote that should be there.
* **The §48 benchmark took refs from the front of the store.** A record the
  capture just created is *appended*, so the first curve was flat and said
  nothing about the lookup at all.

---

# 5. Performance (§48)

`describeCreated` now runs once per render of the finished panel rather than once
at commit. Refs taken from the **end** of the store — where a new record lands:

| store actions | 1 outcome | 3 outcomes | 8 outcomes |
|---|---|---|---|
| 8 | 0.0015 ms | 0.070 | 0.138 |
| 108 | 0.007 | 0.063 | 0.013 |
| 1,008 | 0.008 | 0.074 | 0.064 |
| 5,008 | 0.046 | 0.233 | 0.424 |

`describeRule`: **100,000 calls in 24 ms.**

**§48's requirement holds: no store scan was added for explanation.** The lookups
already existed inside `describeCreated`; what changed is how often they run. At
a 5,000-action stress store a typical one- or two-outcome capture costs
0.05–0.1 ms per render, well inside a frame.

---

# 6. Visual and accessibility review (§46, §47)

Thirty screenshots across light, dark and 390px, plus the sheet. The new line
sits where the others do and reads as one of them:

```
SAVED AS ACTION · Run · Every Monday · Edit · Undo
SAVED AS ACTION · Pay the rent · Every month on the 1st · Edit · Undo
SAVED AS ACTION · Call Marcus · Due tomorrow · 2 PM · Edit · Undo
```

No debug-console feeling, no repeated facts, no metadata wall, no "AI
explanation" tone, and the same three lines in every theme and viewport.

**Home and the quick-capture sheet measure identically** — LIFEOS-100's
`bg-background` parity fix holds exactly:

```
light  "Saved as Action" home 4.47  sheet 4.47      dark  7.09 / 7.09
       "Every Monday"    home 4.47  sheet 4.47            7.09 / 7.09
```

Two accessibility findings, **both pre-existing and both reported rather than
fixed**, per §46:

1. **The finished panel's metadata is 4.47 against 4.5 in light** — the label,
   `Edit`, and now the recurrence line. LIFEOS-099 verified `zinc-500` at 4.67
   against the page ground; this panel's own `bg-black/[.02]` tint costs 0.2. Its
   sweep never saw it because the panel only exists transiently after a capture.
   `git diff` confirms **this sprint changed no colour class** — the new line
   joins an existing group at the same ratio rather than creating a failure.
   Fixing it means re-picking a token for every capture outcome, which is 099
   design scope.
2. **The asking panel's `Possible context` at 2.54 light / 4.08 dark** — the same
   gap LIFEOS-100 recorded. This sprint does not touch that state.

---

# 7. Known gaps

1. **The finished panel is 4.47 in light** (§6.1). Pre-existing, panel-wide.
2. **The asking panel's context labels are below AA** (§6.2). Pre-existing,
   untouched, already on LIFEOS-100's list.
3. **Recurrence is still absent from `/actions`.** Measured during the audit: the
   record is on the page and no surface there says "Every Monday". This sprint
   fixed the capture outcome, which is what §4 and §24 name; the actions list is a
   different surface and out of scope.
4. **`waitingFor` is computed and never shown separately.** LIFEOS-096 folds it
   into the title ("Signed lease from Ana") and suppresses the duplicate on
   purpose (§16). Correct today; worth revisiting only if a wait ever needs the
   object independently.
5. **A correction that changes a record's KIND is not covered.** The correction
   sheet edits fields, not kinds, so the re-derivation has no kind-change case to
   handle. Stated because the fix would otherwise look more general than it is.

---

# 8. Gates (§49)

```
deterministic selftests   6216/6216 across 63 suites; failing suites: none
smoke-102 transparency    20/20      smoke-089 capture context  66/66
smoke-095 capture home    67/67      smoke-097 corrections      41/41
smoke-100 global capture  28/28      smoke-101 natural language 20/20
smoke-099 accessibility   22/22
release audit             PASS 17/17 · migration count 47, head unchanged
route smoke               PASS 25/25
export verify             PASS 14/14
security audit            PASS (RLS, secrets, routes, auth, deps)
tsc --noEmit              clean
eslint                    0 errors, 2 pre-existing warnings
next build                clean
```

**Migration head 0047, unchanged.** §40 needed nothing: this is derived
presentation only.

---

# 9. The twelve claims (§51)

1. **Users can inspect what Conqify understood without parser jargon** — the
   finished panel names the kind, the record, its date, its time, its person, its
   project and now its schedule, and a sweep of six panels finds no authority
   enum, no score, no rule name.
2. **Raw source stays distinct from derived interpretation** — the only quoted
   string anywhere is the sentence the person typed; the cleaned title appears as
   a field, never inside quotes.
3. **Stored result stays distinct from intended meaning** — the finished panel is
   built from the store, the review panel from candidates, and M1 (rendering the
   candidate as the result) reddens.
4. **Multi-intent is understandable** — "I found 2 things:", both rows, both
   titles.
5. **Ambiguity names the actual choices** — *"2 records match "recommendation
   request". Which one?"* with both records selectable.
6. **Possible context is not presented as committed** — "POSSIBLE CONTEXT /
   Nothing is selected — pick the one you meant", and nothing is linked until it is.
7. **Goal and Personal Code boundaries are explained in human language** —
   "Conqify won't create a goal unless you say so", "Conqify will not create this
   for you".
8. **Cleaned titles are never misquoted as user text** — asserted, with a helper
   that was fixed after it was found proving nothing.
9. **Corrections leave no stale interpretation** — the sprint's own fix, on both
   fields and both doorways.
10. **Home and Quick Capture explain identically** — six sentences, panel text
    compared character for character.
11. **No chain-of-thought, confidence UI, or reasoning system was added** — and a
    mutant that added a fake percentage reddens.
12. **No migration was added** — head 0047.
