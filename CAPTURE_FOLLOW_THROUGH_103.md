# LIFEOS-103 — Capture Follow-Through / From Thought to Next Move

**North star:** after Conqify understands something, it should help the user move
it forward without turning capture into a workflow.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
