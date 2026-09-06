# LIFEOS-095 — Capture Home / One Place to Tell Conqify Anything

**North star:** open Conqify, say what's happening, and get back to your life.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `b66f69b8f20192d102db23bc02bbff1e0d4a73c4` (PR #100 merged) |
| Branch | `claude/lifeos-095-capture-home` |
| Migration required | **no** (§38) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the running production build with Playwright, on two
viewports × two users. Probes: `scratchpad/audit95.cjs` (geometry, above-fold,
everything rendered before the input) and `scratchpad/audit95b.cjs` (the submit
flow, six real captures, and the mobile keyboard).

## 1.1 A, B — What is above the fold

**The capture input is already above the fold in all four cases, and it is
autofocused.** That is worth saying first, because two of the briefed reds
assume otherwise.

| | viewport | input top | input fits | submit | focus on load |
|---|---|---|---|---|---|
| desktop / fresh | 1280×800 | 334 | yes | 516 | `#capture` |
| desktop / returning | 1280×800 | 418 | yes | 600 | `#capture` |
| mobile / fresh | 390×844 | 400 | yes | 582 | `#capture` |
| mobile / returning | 390×844 | **529** | yes | **711** | `#capture` |

What sits above the input, measured in document order rather than guessed:

```
0–110    nav (two rows on mobile) + search row
123–241  "YOU ONCE WROTE" — the resurfaced-belief card   (returning only)
284–348  "YOU LIVE. CONQIFY KEEPS TRACK."                 tagline
         "What's on your mind?"                            h1
         "Errands, appointments, ideas, things you're …"    2-line paragraph
418      the textarea
```

Three stacked pieces of copy, then the input.

## 1.2 C — Clicks to type

**Zero.** `autoFocus` is on the textarea and the cursor is in it on load. The
front door is not behind a modal, a button, or a route change. §4 is already
satisfied.

## 1.3 D — What competes with capture

* **The resurfaced-belief card**, above the composer on every returning user.
  It costs 129 px, and on mobile it is what pushes the input to 529.
* **The bottom bar on mobile** — a persistent search field and a `+` FAB. In
  the screenshot it **clips the helper text under the Capture button**.
* **Three capture entry points** in one viewport: this page, the nav's
  "Capture ▾" menu, and the FAB.

## 1.4 E — What appears after a successful capture

Measured by confirming a real capture and reading the page:

```
url:    /
toast:  ""                       ← gone within 1.2 s
main:   the empty composer, exactly as before
```

The toast is `"Saved 1 thing."` — it names nothing, links to nothing, offers no
undo, and vanishes. **After a successful capture the page is indistinguishable
from a page where nothing happened.** There is no recent list, no result, no
trace. This is the sharpest finding in the audit.

## 1.5 F — What makes capture feel unfinished

Every capture requires a **second press**. `authorityFor` already grades a
high-confidence Action, Waiting, Note and Event as `auto_with_undo` — but that
grade only decides whether a checkbox arrives *ticked*. The commit still waits
for "Confirm all". So the flow for the most ordinary sentence in the product is

```
type → Capture → read a card → press Confirm all → toast vanishes → nothing
```

§31's auto-safe tier exists in the model and is not used at the one moment it
was built for.

## 1.6 G — Where context suggestions are noisy

Measured on `"Email Marcus about the lease tomorrow"` against a store holding
the matching Action:

```
POSSIBLE CONTEXT
Looks like this may refer to: Email Marcus about the lease
“marcus” and “lease” match an open Action. Nothing has been changed.
Person · Marcus
Name appears in the capture.
```

Thirteen nodes: a section heading, a lead-in sentence, the record's title, a
quoted-token explanation, a disclaimer, a second row, and a second reason.
§12's "bad" example almost verbatim.

It is also **the same sentence three times on one screen** — in the textarea,
as the candidate's title, and again inside the context block (§18).

## 1.7 H — Decisions surfaced too aggressively

Not on Home. `/today/decisions` (094) is not reproduced here and Home shows no
decision count at all. The gap is the other way: §14's small secondary
indicator does not exist.

## 1.8 I — Onboarding

**Nothing onboarding-shaped renders on `/`.** The "Getting started" checklist
lives on `/today`, below the fold. §19's premise does not hold on this route,
and there is nothing to move.

## 1.9 J — What can be deleted or collapsed

* The tagline **"YOU LIVE. CONQIFY KEEPS TRACK."** — a slogan above the primary
  input.
* The two-line instructional paragraph — §7 says avoid these.
* The three-clause placeholder, which is a paragraph in a text field (§8).
* The context block's lead-in sentence and disclaimer.
* The belief card's position, not the card.

## 1.10 The reds (§39)

| # | Claim | Verdict |
|---|---|---|
| 1 | Capture not above fold on mobile | **NOT CONFIRMED** — 400 (fresh) / 529 (returning) of 844 |
| 2 | Capture not above fold on desktop | **NOT CONFIRMED** — 334 / 418 of 800 |
| 3 | Onboarding competes with capture | **NOT CONFIRMED on `/`** — no onboarding renders here |
| 4 | Success leaves the user in a workflow | **CONFIRMED** — and worse: it leaves them with nothing |
| 5 | Same capture appears multiple times | **CONFIRMED** — textarea, title, context lead-in |
| 6 | Context suggestions too verbose | **CONFIRMED** — 13 nodes, §12's bad example |
| 7 | Ambiguous capture lacks a local choice | **NOT CONFIRMED** — 089's chooser is local and works |
| 8 | Recent captures / results absent or noisy | **CONFIRMED — absent entirely** |

Four of eight. The three "not confirmed" are stated as measurements rather than
quietly dropped, because the brief predicted them and the build had already
fixed them.

### A red the brief did not predict

**The mobile keyboard.** Simulated at a 508 px visible height (390×844 phone
with a standard keyboard), on a returning user:

```
input  top 529  → below the visible area
submit top 711  → below the visible area
```

Neither the field nor the button is reachable without scrolling past 529 px of
chrome, slogan and helper copy. §26 makes this the requirement that matters
most, and it is the one that fails.

## 1.11 What the audit says to build

Nothing about the *engine*. `interpret`, `suggestContext`, `authorityFor` and
`commitCapture` all work and none of them are touched. The gap is entirely in
what Home does with them:

1. **Use the authority tier that already exists** — commit an all-auto-safe
   capture on submit, with undo, instead of asking for a press (§31).
2. **Say what happened** — a finished state naming the record, replacing a
   toast that names nothing (§10).
3. **Show the last few captures and what they became** — derived from
   `sourceCaptureId`, which is already persisted (§15, §16, §17).
4. **Cut the copy above the input** and move the belief card below it (§5, §7).
5. **Compress the context block** to one line per suggestion (§12).

No new route (§37). No migration (§38). No new interpretation engine.

---

# 2. What shipped

## 2.1 The hierarchy (§6)

```
1  the input                     What's happening?  — h1, then the field
2  what just happened            Saved as Action · Email Marcus about the lease · Sun, Sep 6  [Undo]
3  recently                      the last four things you said, and what they became
4  small links                   Today →   Needs your decision · N →   Capture inbox →
5  the resurfaced belief         moved BELOW the input, not deleted
```

Measured with the same probe as the audit, so the numbers are comparable:

| | input top | submit bottom |
|---|---|---|
| desktop, returning | 418 → **143** | 600 → **336** |
| mobile, returning | 529 → **231** | 711 → **424** |

424 is inside the 508 px a 390×844 phone leaves above its keyboard, which is
the red the audit found and §26 makes matter most.

## 2.2 The copy (§7, §8)

Removed: the slogan **"YOU LIVE. CONQIFY KEEPS TRACK."**, the two-line
instructional paragraph, and the three-clause placeholder that wrapped to three
lines inside the field. Also removed: *"Start messy. Nothing is created until
you confirm it"* — which stopped being true the moment §31 shipped.

What is left is `HOME_PROMPT` — **"What's happening?"** — and one placeholder,
`"Email Marcus about the lease tomorrow"`.

## 2.3 The auto-safe decision (§31, §32)

`authorityFor` has always graded a high-confidence Action, Waiting, Note and
Event as `auto_with_undo`. **That grade decided one thing: whether a checkbox
arrived ticked.** The commit still waited for a second press.

`canFinishWithoutAsking` uses the tier for the decision it describes. It grants
nothing new; every clause below is a reason to *ask* rather than to act, which
is the safe direction for a default to fail in:

| Clause | Why |
|---|---|
| a pending change to an existing record | §33 — it alters something you have |
| nothing found | there is no capture to finish, only text to keep |
| any `confirm` tier | Protocol, Reflection, Project, Goal, Rule, and every low-confidence reading |
| an unstorable fragment | §19 of 060 — "sometime", "soon" get said out loud |
| a date the kind would drop | the same argument, one field down |
| contested context | §11 — ambiguity, when it is real |
| **an existing-record match** | §18 of 089 — you may already have this |

The last one was not in the design. See §3.3.

`askingBecause` names the reason, walking the same clauses in the same order,
so the sentence and the decision cannot drift.

## 2.4 The finished state (§10)

```
SAVED AS ACTION
Email Marcus about the lease
Sun, Sep 6  ·  Graduate school
[Add to Teaching portfolio]   [Undo]
```

`describeCreated` reads the **store**, not the candidates it was handed — a
summary built from the input would keep claiming a record `commitCapture`
declined to write, which is how "Saved 1 thing" could be printed for zero.

Undo deletes what was created and calls `restoreCapture`, so the sentence goes
back to the inbox rather than disappearing (§17). Every primitive already
existed.

## 2.5 The recent list (§15, §16, §17, §18)

Four rows, newest first, derived from `capture.linkedEntityRefs` — which
`commitCapture` already writes in one history event. **One captured moment is
one row**: a sentence that produced three records is one row with three
outcomes, not four cards. The row shows the person's own sentence and the
product word for what it became, never a candidate kind or a processing status
(assertion 95.34 sweeps for that vocabulary).

## 2.6 What did not change

No new route (§37) — `/` already existed. **No migration** (§38); head stays at
**0047**. No new interpretation engine, no voice stack, no file ingestion. The
resurfaced belief was moved, not deleted.

---

# 3. What the testing found

## 3.1 A fixture found a defect before a user did

Deriving *"Not filed yet"* from an empty outcome list told people their filed
capture was still waiting, and pointed them at an inbox it is not in.
`convertCapture` files into nine domains this surface has no reader for.
`unfiled` reads `processingStatus` — the store's own answer — and a capture
filed somewhere Home cannot render says just **"Filed"** and offers no link it
cannot honour.

## 3.2 Mutation (§41) — fifteen, two escapes, one shared cause

Thirteen reddened immediately. Both escapes had the same cause: *"Dinner with
Ana sometime next quarter maybe"* is a low-confidence note **and** carries an
unstorable fragment, so the confirm-tier clause blocked it whatever the other
two clauses did — **two guards sat untested behind a third.**

Replaced with captures that isolate each:

* *"Call the dentist sometime soon"* — a high-confidence Action whose only
  problem is that "sometime" and "soon" are the user's own words about *when*
  and no field can hold them.
* *"Remember that the deadline is Friday"* — a high-confidence Note carrying a
  date a note cannot keep.

Both now redden their guard, and both are cases where finishing silently would
drop the one part of the sentence Conqify could not store.

## 3.3 LIFEOS-089's own suite caught two regressions

The most valuable half hour of the sprint. Running 089 against this branch
turned three of its assertions red.

### The offer that went missing

A capture that finishes by itself never renders the context panel. So a
`possible`-tier suggestion — which arrives switched **off** by design, because
the evidence is weaker — was declined on the person's behalf and silently. The
record written was correct; the **offer** was what went missing.

It rides on the finished state now, as one chip through the `updateAction`
setter that already exists. And an `exact` match, which arrives accepted and
therefore *is* written by an auto-finish, is named in the finished state: **a
link nobody was shown is a link nobody can correct.**

### The duplicate wait

089 assertion 46 — *"the open wait it may duplicate is surfaced"*. *"I'm
waiting on Maria for the transcript"* is a high-confidence wait with no
ambiguity anywhere, so §31 finished it and wrote a **second wait on Maria**
beside the one already open. 089 §18 exists to stop exactly that.

Any existing-record suggestion, at any strength, now asks. Assertion 95.7e pins
that the identical sentence still finishes when there is nothing to duplicate,
so the fix is a guard and not a blanket.

089 is back to 66/66. Its section 7 was **rewritten rather than deleted** — the
same four questions asked of the route the capability now travels.

## 3.4 Visual review (§42)

Screenshots at desktop and mobile across fresh / returning-empty / busy /
success / ambiguous / rule / multi-record worlds.

1. **The finished panel and the recent list's newest row were the same moment,
   stacked** — the identical sentence and date 150 px apart. Home omits that
   row while the panel is up, fetching one extra so the list does not shrink.
2. **On a phone, "Confirm all", "Keep the whole thing as a note" and "Start
   over" sat under the fixed mobile command bar** — including the escape hatch
   LIFEOS-060 §16 promises is always one click away. The layout gives every
   route bottom clearance now.

### And one I nearly mis-sold

The assertion I first wrote for the second fix — *"is any control under the
bar"* — passes for any long page mid-scroll, and **passed with the fix
reverted**. Proved by reverting it. The measurement that distinguishes the two
states is clearance at full scroll: **2 px without, 66 px with**, so the
assertion asks for 16.

## 3.5 Performance (§43)

| Records | composer ready | recent list | submit → result |
|---|---|---|---|
| 100 | 141 ms | 166 ms | 98 ms |
| 1,000 | 117 ms | 147 ms | 86 ms |
| 5,000 | 138 ms | 157 ms | 173 ms |
| 5,000 + 500 pathless goals | 167 ms | 188 ms | 239 ms |

The last row is the honest worst case: Home's §14 decision count runs
LIFEOS-094's builder, and that store is the one that builder works hardest on.
Nothing heavier runs before the user types — `interpret` is called on submit,
never on keystroke.

## 3.6 Known gaps

* **A wait's title is the whole sentence.** *"I'm waiting on Maria for the
  transcript"* becomes an Action titled with that entire sentence, so the
  finished state reads "Waiting · I'm waiting on Maria for the transcript ·
  Waiting on Maria". That is `interpret`'s title extraction and §49 forbids
  touching it this sprint.
* **Nine `convertCapture` domains have no outcome reader.** Captures filed as a
  concept, dialogue, practice, principle, framework, research project or
  workspace note say "Filed" rather than naming the record. Honest, but thin.
* **No cross-tab sync**, as LIFEOS-094 recorded: a second tab's write is not
  observed until a reload.

---

# 4. The product claims (§47)

1. **Capture is immediately visible on Home.** Input top 143 desktop / 231
   mobile, autofocused, whole field above the fold. — *browser 1–3*
2. **Home has one dominant primary action.** Nothing is stacked above the
   input; it spans 93% of the column. — *browser 28–29*
3. **Simple captures feel finished quickly.** One press, then a named result.
   — *browser 5–7, 41*
4. **Auto-safe captures do not require needless confirmation.** — *95.1, 95.2*
5. **Consequential ambiguity still requires judgment.** Confirm tiers,
   contested context, unstorable fragments, dropped dates, possible duplicates.
   — *95.3–95.11, browser 11–12, 15–18, 25b*
6. **Context suggestions stay compact.** 149 chars, one line per suggestion.
   — *browser 26–27*
7. **Recent captures and results are bounded.** Four, whatever you say.
   — *95.22, 95.36, browser 23*
8. **Raw source remains recoverable.** The row keeps what you typed; Undo puts
   it back in the inbox. — *95.26, browser 10, 21*
9. **Onboarding does not block usefulness.** Nothing onboarding-shaped renders
   on `/`. — *browser 4*
10. **Mobile capture is excellent.** Input and submit both inside 508 px, tap
    target 101×40, no sideways scroll, nothing under the command bar.
    — *browser 37–42*
11. **Home does not become another dashboard.** No decision queue, no Today
    command center, no stat tiles. — *browser 30–33*
12. **No migration and no new interpretation engine.** Head 0047; `interpret`,
    `suggestContext`, `authorityFor` and `commitCapture` are untouched.

---

# 5. Files

```
lib/capture/home.ts                     the decision and the outcomes (new)
lib/capture/home-selftest.ts            58 assertions (new)
components/capture/RecentCaptures.tsx   the recent list (new)
scripts/smoke-095-capture-home.cjs      67 browser assertions (new)

app/page.tsx                            the hierarchy
app/layout.tsx                          mobile command-bar clearance
components/capture/CaptureComposer.tsx  auto-finish, finished state, copy
components/capture/CaptureContext.tsx   §12 compression
lib/capture/context.ts                  EXISTING_RECORD_LEAD shortened
lib/capture/context-selftest.ts         that assertion, guarding the property
scripts/smoke-089-capture-context.cjs   section 7 rewritten for the new route
```

## Gates

```
deterministic     5949/5949 across 59 suites   (095: 58 new)
browser (095)     67/67
browser (prior)   080 109/109 · 083 77/77 · 085 54/54 · 089 66/66 · 090 69/69
                  091 87/87 · 092 59/59 · 093 57/57 · 094 47/47
route smoke       25/25       release audit 17/17
export verify     14/14       route audit PASS   secret scan PASS
tsc clean · eslint 0 errors (2 pre-existing warnings) · build PASS
migration head    0047, unchanged
```
