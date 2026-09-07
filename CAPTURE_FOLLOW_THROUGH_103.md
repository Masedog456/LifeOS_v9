# LIFEOS-103 — Capture Follow-Through / From Thought to Next Move

**North star:** after Conqify understands something, it should help the user move
it forward without turning capture into a workflow.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `f0929df9fe4c8808e08e067e9c0693f1e5223677` (PR #108 merged) |
| Branch | `claude/lifeos-103-capture-follow-through` |
| Migration required | **no** (§47) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Two passes over `scripts/fixtures/lifeos-103-world.cjs`: what the existing
guidance layer already derives for each record shape, and what the person
actually sees when a capture of that shape ends.

## 1.1 A, D, H — what already speaks for these records

Every builder §21 names exists and already answers most of §2's questions.

```
buildCommitmentSignals   due_soon · project_no_next_action · goal_path_missing
buildDecisionInbox       GOAL_NO_PATH  "What should carry “Learn to sail”?"
                         options: Add a project · Open goal
goalPathState            g-nopath "none" · g-direct "actions" · g-project "project"
buildProjectContext      next · nextNote · empty · counts · blocked
buildGoalContext         next · pathNote · noWorkLinked
```

**There is one trap in here and the audit walked into it deliberately.** The
`goal_path_missing` *signal* fires for **both** `g-nopath` and `g-direct` —
because it asks only about projects. The Decision Inbox does not, because it uses
`goalsWithoutAnyPath`. LIFEOS-088 split those two predicates on purpose, and
§48's red 4 is exactly what happens to anything that picks the wrong one: a goal
already carried by a live action gets told to add work.

## 1.2 B, C — what each capture actually ends with

Measured on the running product:

```
ordinary action    FINISHED  SAVED AS ACTION · Email the landlord
dated action       FINISHED  SAVED AS ACTION · Call the dentist · Due Fri, Sep 11
event              FINISHED  SAVED AS EVENT · Interview · Tue, Sep 8 · 2 PM
recurring          FINISHED  SAVED AS ACTION · Pay rent · Every month on the 1st
waiting            FINISHED  SAVED AS WAITING · Quote from Priya
reflection         ASKING    (its own confirmation)
goal               ASKING    (its own confirmation)
```

**Reds 4, 5 and 6 do not hold.** Nothing gives an ordinary Action, an Event, a
recurring Action or a Reflection any advice at all — they end quietly, which is
what §5, §9 and §11 ask for. There is no noise to remove.

## 1.3 The structural finding: reviewed commits have no success panel

Goals and Projects are never auto-writable, so they go through the review panel.
Measured, confirming "I'd like to learn to sail":

```
after confirm   finished=false  results=false  kept=false
                RECENTLY → "I'd like to learn to sail" · "Goal · Learn to sail"
                Needs your decision · 2 →
```

The goal **was** created. There is simply **no success panel afterwards** — the
reviewed path clears the composer and the outcome appears in the recent list.
LIFEOS-095's `finished` state belongs to the auto-finish path alone.

This decides two of the brief's three candidates:

* **§12/§13 goal follow-through has no surface to appear on.** §29 names the
  success panel as the primary surface and for a goal there is not one. Building
  a second panel for it would be the workflow the north star forbids.
* And it would **duplicate an existing global decision**. `GOAL_NO_PATH` is
  already in the Decision Inbox for exactly this goal, with exactly the options
  §13 proposes ("Add a project", "Open goal"), and Home already shows *"Needs
  your decision · 2 →"*. §35 says link to the existing resolution rather than
  invent a second choice UI; §31 forbids a new queue.

## 1.4 Capture cannot create a Project

Measured: `"Sort out the Clinic lease"` produces

```
SAVED AS ACTION · Sort out the Clinic lease · Clinic lease · Add to Clinic fit-out
```

— an Action linked to the existing project, not a new Project. So §14's "Project
with no next Action" has no capture-created record to attach to, and §23 rule 1
requires one. Better still: the capture **resolved** the state it would have
suggested about, by putting an executable action into the empty project.

**Red 3 does not hold.**

## 1.5 The red that does hold — §7

`"I'm waiting on Priya for the quote"` ends at:

```
SAVED AS WAITING · Quote from Priya · Edit · Undo
record: { title: "Quote from Priya", waitingOn: "Priya", followUpDate: null }
```

Nothing anywhere speaks for it. Measured against the whole guidance layer:

```
a-wait-none   followUpDate=null   signals []   decisions []
a-wait-set    followUpDate=+3d    signals []   decisions []
```

`WAITING_FOLLOW_UP` in the Decision Inbox reads the `follow_up_due` signal, which
requires a follow-up date to **exist and have arrived**. §36 says missing and due
are different and must not be conflated — and they are not: a wait with no
follow-up date at all is invisible to every existing surface.

**§48's red 1 CONFIRMED**, and it is the only one of the eight that holds.

## 1.6 The bug that red exposed

§23 rule 4 requires a suggestion to map to an existing **safe** path. The path a
follow-up suggestion would point at is the correction sheet, and it is broken.

For a waiting action, `correctableOutcome` builds the Date field from
`a.followUpDate ?? a.dueDate` — it *reads* the follow-up. `CorrectionSheet.save`
writes it with `setActionDueDate` — it *writes* the due date. Measured:

```
Date := 2026-09-19 on a wait
  before  { followUpDate: null, dueDate: null }
  after   { followUpDate: null, dueDate: "2026-09-19" }
  panel   "SAVED AS WAITING · Quote from Priya · Due Sat, Sep 19"
```

A wait now carries a **due date** — a commitment the person cannot keep, because
the wait is on somebody else — and the field they edited shows one property and
sets another. `setNextFollowUpDate` already exists (LIFEOS-071 §13), writes a
proper history entry, and deliberately leaves `waitingSince` alone.

§39 permits a fix the audit finds independently required to make guidance
truthful. This is that: without it the one suggestion this sprint would add
points at a control that does the wrong thing.

## 1.7 E, F, G, I, J

* **E — can safely offer one action:** Waiting with no follow-up date. That is
  the whole list.
* **F — require judgment first:** Goal (no path), Project (no next action). Both
  already asked globally, and neither has a capture success panel.
* **G — would fabricate work:** everything in §24. Also "Prepare for event"
  (§9), "turn this insight into an action" (§11), and any workaround for a
  blocked action (§16).
* **I — only in the success panel.** §30's answer is no for recent cards: the
  suggestion is transient, and the underlying state is picked up later by Today
  and the Decision Inbox anyway.
* **J — the smallest useful scope is ONE suggestion kind**, `ADD_WAIT_FOLLOW_UP`,
  plus the correction-path fix that makes it point somewhere safe.

## 1.8 §48's eight candidate reds

| | red | verdict |
|---|---|---|
| 1 | waiting without follow-up ends with no useful next move | **HOLDS** — §1.5 |
| 2 | goal with no path has no local resolution | does not hold as a gap — it has no success panel at all, and the Decision Inbox already resolves it (§1.3) |
| 3 | project with no action has no local affordance | does not hold — capture cannot create a Project, and the capture resolves the state (§1.4) |
| 4 | goal with executable work gets noisy "add work" | does not hold — nothing suggests work today; recorded as the trap §1.1 describes |
| 5 | event gets generic follow-through | does not hold — events end quietly |
| 6 | reflection gets taskified | does not hold — reflections go to their own confirmation |
| 7 | correction leaves a stale suggestion | not applicable — there is no suggestion yet; asserted for the one being added |
| 8 | Home / Quick diverge | does not hold — LIFEOS-100 parity, re-verified |

---

# 2. What will be built

Two changes, and deliberately not a follow-through engine.

1. **`ADD_WAIT_FOLLOW_UP`** — the one grounded suggestion, on the success panel,
   for a wait with `status: "waiting"` and no `followUpDate`. Derived from store
   truth every render, so it disappears on correction (§39) and on undo (§40).
2. **The correction sheet writes `setNextFollowUpDate` for a waiting record** —
   the §1.6 bug, without which the suggestion points at a control that sets the
   wrong field.

**No goal follow-through, no project follow-through, no completion coaching, no
blocker workaround.** Each is rejected on measured evidence in §1, not on taste.

---

# 3. What was built (§46, §47)

## 3.1 The correction path, first

`components/capture/CorrectionSheet.tsx` routes a waiting record's date to
`setNextFollowUpDate` instead of `setActionDueDate`.

```
Date := 2026-09-19 on a wait
  before   { followUpDate: null,         dueDate: "2026-09-19" }   "Due Sat, Sep 19"
  after    { followUpDate: "2026-09-19", dueDate: null        }   "Follow up Sat, Sep 19"
```

The panel's new wording is LIFEOS-098's own `followUpPhrase`, reached simply by
setting the field it was always watching. `setNextFollowUpDate` (LIFEOS-071 §13)
deliberately leaves `waitingSince` alone, so correcting the date does not restart
the clock the waiting signal rests on.

The write side now keys off the **same `fields` array the read side built** —
`correctableOutcome` adds a `waitingOn` field only for a waiting action, and that
is the exact branch where it sourced the date from `followUpDate`. The two halves
cannot drift apart again.

## 3.2 `ADD_WAIT_FOLLOW_UP`, and nothing else

`lib/capture/follow-through.ts` is one predicate and one projection. A wait
qualifies on three facts about a row: `status === "waiting"`, a named person, no
`followUpDate`. Derived from the live store on every render beside LIFEOS-102's
`shownOutcomes`, so §39 and §40 hold without either path knowing the file exists.

**No task text is generated (§25).** The control opens the correction sheet,
where the person already sets the date. Dismissal is component state and dies
with the panel (§32); nothing is persisted (§46).

## 3.3 What was rejected, and on what evidence

| | why |
|---|---|
| goal follow-through (§12, §13) | Goals commit through the review panel, which leaves **no success panel** — measured `finished=false, results=false, kept=false`. §29's primary surface does not exist for them. And `GOAL_NO_PATH` is already in the Decision Inbox with the options §13 proposes (§35, §31). |
| project follow-through (§14, §15) | Capture **cannot create a Project**. `"Sort out the Clinic lease"` makes an Action linked to the existing one — and *resolves* the empty-project state it would have suggested about. |
| completion coaching (§18) | Out of scope by §18's own instruction, and nothing surfaces it in the same result context. |
| blocker workarounds (§16) | Would fabricate work. §24. |

---

# 4. Proof

## 4.1 Deterministic — `lib/capture/follow-through-selftest.ts`, 24 assertions

The **rejected** kinds are asserted too. A test that only covers what was built
lets a later sprint add goal and project follow-through back without meeting the
reasons — so 103.6 pins that a goal, project, event, note, reflection and rule
get nothing, with a control at 103.7 proving that is about the *kind* and not a
missing id. 103.16 pins the predicate distinction the audit nearly walked into.

## 4.2 Browser — `scripts/smoke-103-follow-through.cjs`, 22/22

Thirteen assertions are marked **GUARD** in the file itself: they pin quiet
endings the product already had, and they are what would catch this sprint
turning capture into a workflow.

## 4.3 Full-revert proof (§52)

Both production files reverted to `f0929df` and the new module removed: **15/21**
(before 18b existed).

| red | |
|---|---|
| 3 | the wait's suggestion is absent |
| 16, 16b | no per-outcome behaviour to measure |
| 17 | `followUp=undefined due=2026-09-19 · "Due Sat, Sep 19"` — the bug, in its original form |
| 18 | the suggestion never appeared to undo |
| 20 | nothing to measure for compactness |

**Six of twenty-one.** Assertion 18's red is worth naming precisely: it fails
with `had=false`, i.e. because the suggestion never existed, not because undo
misbehaved. A legitimate red, but its name claims more than the failure shows.

## 4.4 Mutation testing (§51) — 11 mutants, all caught, one after two corrections

| | mutant | outcome |
|---|---|---|
| M1 | suggest when a follow-up already exists | CAUGHT 103.2, 103.13, browser 4, 17 |
| M2 | the kind gate comes off — Goals, Notes, Rules suggest | CAUGHT 103.6 ×4 |
| M3 | non-waiting records suggest | CAUGHT 103.4 |
| M4 | generate fake action text | CAUGHT 103.12, browser 3, 20 |
| **M5** | persist the dismissal | **ESCAPED twice** — see below |
| M6 | keep a stale suggestion after a correction | CAUGHT browser 3, 16, 16b, 18, 20 |
| M7 | Home / Quick Capture divergence | CAUGHT browser 19 |
| M8 | show more than the cap | CAUGHT 103.9 |
| M9 | the correction path writes `dueDate` again | CAUGHT browser 17 |
| M10 | a wait with nobody named suggests | CAUGHT 103.3 |
| M11 | psychology in the reason | CAUGHT 103.12, browser 3, 20 |

**M5 escaped twice, for two different reasons, and both are worth recording.**

*First:* nothing asserted dismissal at all. The suite never dismissed a
suggestion, so it could not notice a declined one being written down — §32 and
§46 were both unasserted. **18b** now dismisses, checks the panel hides it,
checks no `localStorage` key appears, and captures a *different* wait to prove
the dismissal was about that panel rather than that kind of record forever.

*Second:* 18b still did not catch it, because the mutant was **equivalent**. It
added a `localStorage` **read** of a key nothing ever wrote, so it behaved
identically to the real code. Respun to write on dismiss and read on mount, it
reddens 18b. A mutant that changes no behaviour tests nothing, and calling that
a test gap would have been the wrong lesson.

---

# 5. Performance (§55)

`followThroughFor`, one render, refs from the **end** of the store:

| store actions | 1 outcome | 2 outcomes | 8 outcomes |
|---|---|---|---|
| 10 | 0.0007 ms | 0.0006 | 0.0015 |
| 110 | 0.0017 | 0.0021 | 0.0059 |
| 1,010 | 0.0101 | 0.0214 | 0.0497 |
| 5,010 | 0.0720 | 0.1281 | 0.2626 |

A typical one- or two-outcome capture costs **0.07–0.13 ms** at a 5,000-action
stress store. It is one `find` per outcome — the same lookup shape
`describeCreated` already does beside it — not a walk per outcome, and no new
index was built.

---

# 6. Visual and accessibility review (§53, §54)

Twenty-one screenshots across light, dark and 390px. Panel heights:

```
ordinary Action            136px
+ one suggestion           187px   (+51)
+ two suggestions          285px
```

Secondary, and not a wizard: the result reads as finished above it, the
suggestion is one line of fact plus two controls, and there is no CTA, no
urgency, no progress language.

**Touch targets** are 44px on a phone and released above it — LIFEOS-099's own
`min-h-[44px] sm:min-h-0` rule, so the 390px sweep reports nothing undersized
while desktop measures 127×27. Both controls carry an accessible name that
includes the record.

**One contrast finding, pre-existing and reported rather than fixed**, exactly as
LIFEOS-102 recorded it: `"No follow-up date is set."` and `"Dismiss"` measure
**4.47 against 4.5 in light**. They use `TERTIARY_TEXT` — the same token as the
panel's existing metadata, which 102 measured at the same 4.47 — so the new line
joins an existing group at an identical ratio rather than creating a failure. The
cause is the panel's own `bg-black/[.02]` tint costing 0.2 against the ground
LIFEOS-099 verified. Dark is clean. Fixing it means re-picking a token for every
capture outcome, which is 099 design scope.

---

# 7. Known gaps

1. **A dated wait gets both `dueDate` and `followUpDate`**, so the panel reads
   `"Due Fri, Sep 11 · Follow up Fri, Sep 11"` — the same date twice in two
   phrasings. Found while measuring §8's near neighbour. It is the commit path's
   behaviour, not the correction path's, and the same semantic question §3.1
   answers for corrections: a wait is blocked on someone else, so a due date on
   it is a commitment the person cannot keep. Out of this sprint's scope; the
   follow-through is correct either way.
2. **The finished panel's metadata is 4.47 in light** (§6). Pre-existing,
   panel-wide, already on LIFEOS-102's list.
3. **Browser assertion 18's revert red is weaker than its name** (§4.3).
4. **A wait created outside capture gets no suggestion.** Follow-through is
   local and transient by design (§30, §33) — the underlying wait is picked up by
   Today and the Decision Inbox once its follow-up date arrives. A wait that
   never gets one is still invisible to those surfaces, which is the gap §36
   distinguishes and this sprint did not widen into.
5. **Goal and Project follow-through remain unbuilt** (§3.3). If reviewed commits
   ever gain a success panel, the goal case becomes reachable — and would still
   have to answer §35's duplication question first.

---

# 8. Gates (§56)

```
deterministic selftests   6240/6240 across 64 suites; failing suites: none
smoke-103 follow-through  22/22      smoke-094 decision inbox  47/47
smoke-095 capture home    67/67      smoke-097 corrections     41/41
smoke-100 quick capture   28/28      smoke-101 natural lang    20/20
smoke-102 transparency    20/20
release audit             PASS 17/17 · migration count 47, head unchanged
route smoke               PASS 25/25
export verify             PASS 14/14
security audit            PASS (RLS, secrets, routes, auth, deps)
tsc --noEmit              clean
eslint                    0 errors, 2 pre-existing warnings
next build                clean
```

**Migration head 0047, unchanged.** §47 needed nothing.

---

# 9. The twelve claims (§58)

1. **Capture remains quick and finished by default** — an ordinary Action's panel
   is unchanged at 136px and three lines.
2. **Follow-through appears only when grounded** — one kind, on three facts about
   a row, and every other candidate rejected on measured evidence.
3. **Ordinary Actions get no redundant advice** — asserted, and M2 reddens.
4. **Events, Notes and Reflections are not taskified** — asserted at the kind
   level with a control, because the browser versions of that claim passed
   vacuously and were rewritten to say what they measure.
5. **A wait without a follow-up offers one useful next move** — and the path it
   points at now sets the right field.
6. **Goals and Projects only suggest work when path semantics prove none exists**
   — vacuously true here, because neither suggests at all, and 103.16 pins the
   predicate that would be needed if they ever did.
7. **No task text is generated** — the control opens the person's own field.
8. **Suggestions disappear when the state changes** — correction, undo, and
   ending the wait, all asserted; M6 reddens.
9. **Home and Quick Capture behave identically** — four sentences, panel and
   suggestion text compared; M7 reddens.
10. **No new queue, score or engine** — one file, one predicate, one projection.
11. **No persistence** — asserted by 18b after mutation testing found it
    unasserted.
12. **No migration** — head 0047.
