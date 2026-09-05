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
