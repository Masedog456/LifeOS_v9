# LIFEOS-082 — Executive Guidance / What Should I Focus On?

**North star:** turn everything Conqify knows into a small, grounded set of
things that deserve my attention now.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `82d2ee48792ad89c7f69a6f8743120ee82ea1633` (PR #87 merged) |
| Branch | `claude/lifeos-082-executive-guidance-focus` |
| Migration required | **no** — pure derivation |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Produced by **running the builders**. A fixture with an overdue action, one
deferred three times, a weekly recurring action also deferred three times, a wait
whose follow-up is due today, a wait whose follow-up is five days out, a blocked
action, an action blocked by a *completed* blocker, two goals with no project,
one goal with a project, and a standard that tensions with a protocol.

## 1.1 A — What already answers "what should I do next?"

`recommendNextAction` (`lib/today/recommend.ts`), surfaced as **Suggested Next**
and by Memory's `NEXT_ACTION` class. It returns **one** executable action with
its ordering facts, and returns nothing on a tie rather than picking arbitrarily.

## 1.2 B — What already answers "what deserves attention?"

`buildCommitmentSignals` (`lib/commitment/signals.ts`) — and it is **much more
complete than this sprint's brief assumes.** Nine kinds, each with a recorded
field behind it:

```
overdue · follow_up_due · returned_today · recurring_due · blocked
due_soon · project_no_next_action · goal_path_missing · dormant
```

It already has everything §4 and §7 ask for: a lexicographic
`COMMITMENT_ORDER` with **no score anywhere**, one-sentence factual
`explanation`s, an `evidence` field, `secondaryReasons` so one commitment is
never two rows, a `dedupe`, and a `COMMITMENT_FORBIDDEN_WORDS` sweep. LIFEOS-071's
`resolutionsFor` already maps every kind to safe resolutions.

It is rendered in Today's **"Needs attention"** section, which means §22's
instruction applies: *reuse it rather than add another surface.*

**Nine of §5's fourteen candidate kinds already exist and are grounded.** This
sprint's job is synthesis and reach, not a new signal engine.

## 1.3 C — Where they differ

Exactly as §3 wants, and the distinction is already respected in code:
`recommendNextAction` answers *"the single best executable thing"*;
`buildCommitmentSignals` answers *"something to notice"*. Nothing in this sprint
should collapse them, and nothing currently does.

## 1.4 D — Important facts represented in neither

Three, and all three are **already computed elsewhere and never reach guidance**:

| Fact | Where it lives | Reaches attention? |
|---|---|---|
| Repeated deferral | `repeatedlyPostponed` (LIFEOS-081) | **no** |
| Rule tension | `findTensions` (LIFEOS-079) | **no** |
| Executive changes | `buildExecutiveChanges` (LIFEOS-081) | **no** |

Measured: the fixture's *"Request recommendation letter"* was deferred three
times and `repeatedlyPostponed` finds it — and it does not appear in the
commitment signals or in any Memory attention answer.

## 1.5 E — Duplicated guidance modules

**None worth eliminating.** `signals.ts` already imports `goalLinkedProjects`
and `goalsMissingPath` from `lib/execution/alignment` rather than re-deriving
them, and `dormantSignals` composes the shared dormancy view. The reuse
discipline §6 asks for is already the norm in this layer — which is why the fix
here is composition, not consolidation.

## 1.6 F — Noisy signals

`goal_path_missing` is the one to watch. In the fixture it produced **two of the
four** items, and it scales with the number of goals a person has: someone with
eight unbroken-down goals gets eight rows before any deadline is mentioned. It
is correctly ordered *after* the time-pressure kinds, but with no cap it still
floods the list. That is §9's argument, measured.

## 1.7 G — Useful but isolated

The three in §1.4. Each is grounded, tested and shipped, and each is invisible to
the question a person would actually ask.

## 1.8 H — What can be synthesized without touching Today ranking

A **shortlist**: compose the existing signals, add repeated deferral, cap it,
and order it by the order that already exists. `recommendNextAction` is not
touched, `COMMITMENT_ORDER` is not reordered, and Today's sections keep
rendering exactly what they render now.

## 1.9 I — Weak or unanswerable questions today

Measured, every line real output:

**RED 1 — four of §23's questions do not route at all.**

```
"What should I focus on?"   → plan = NONE → "Conqify can't answer that one"
"What am I neglecting?"     → plan = NONE
"What should I deal with?"  → plan = NONE
"What is stuck?"            → plan = NONE
```

**RED 2 — the signals that do answer are not synthesized.** *"What needs my
attention?"* routes to `OPEN_WORK` and returns:

```
Submit UH application · Transcript from registrar
Graduate school · Graduate school funding
```

Four items, **no cap**, and the action deferred three times is absent — the
strongest behavioural evidence in the fixture, computed by a shipped function,
missing from the answer.

**RED 3 — entity scope is ignored.** *"What needs attention with graduate
school?"* extracts `entityQuery: "graduate school"` and then returns the
identical unscoped four items, including *"Submit UH application"* and
*"Transcript from registrar"*. The same defect LIFEOS-081 found in `answerChanges`,
in a different builder.

**RED 4 — the empty state is an error message.** *"What should I focus on?"* on
an empty store answers *"Conqify can't answer that one"* — which is right for an
unroutable question and wrong for the question a person will actually ask most.

### What is NOT red, and must not be faked

§32 lists four cases that **already behave correctly**, and inventing red proofs
for them would be manufacturing evidence:

- **A future follow-up is not surfaced early.** The wait on Maria (follow-up in
  five days) correctly produced no signal.
- **Recurring work is not mislabelled** as repeated deferral — because
  `repeatedlyPostponed` already excludes it (LIFEOS-081 §15).
- **A completed blocker does not surface.** Nor did the *open*-blocker case:
  `blocked` is conditioned on the blocked action being due, or its blocker being
  overdue or quiet. That conservatism is correct design, not a gap.
- **A rule tension does not surface** in guidance at all today.

These become **forward guards** on the new shortlist, not fixes.

## 1.10 J — The smallest shared guidance model

1. **One derived shortlist**, `buildAttentionShortlist(state, ix, today, opts)`,
   producing `ExecutiveAttentionItem`. It **composes** `buildCommitmentSignals`
   and adds the one grounded fact that is missing (repeated deferral). It does
   not re-derive a single existing predicate.
2. **Cap 3, max 5** (§9), applied after the existing lexicographic order.
3. **Rules as context, never as rank** (§21) — attached to an item, not a kind
   of their own.
4. **Router**: a `FOCUS` aspect on the existing `OPEN_WORK` class (§23: one
   guidance kind, no overlapping classes), plus entity scoping with
   `NEEDS_CHOICE`.
5. **Resolutions reused** from LIFEOS-071 (§12) — no second resolver.

## 1.11 Kinds this sprint will NOT implement, and why (§5)

§5 says not to create a kind because it sounds useful. Four are refused:

| Kind | Why not |
|---|---|
| `GOAL_QUIET` | §13 — no principled inactivity window exists. An active *life* goal does not need weekly activity, and inventing a horizon-scaled window would be a threshold with nothing behind it. |
| `WAITING_STALE` | §17 — the grounded case is already `follow_up_due`. "Waiting too long" has no rule behind it. |
| `RECENT_CHANGE_REQUIRES_REVIEW` | §19 — a change only deserves attention if it creates an unresolved consequence, and any such consequence is *already* represented by another kind. Adding it would duplicate rather than inform. |
| `UNRESOLVED_CHOICE` | Nothing records one. |

`RULE_TENSION` becomes **context on an item** rather than a kind, which is what
§21 asks for: rules inform, they do not outrank a deadline.

So: **9 existing kinds reused unchanged + 1 new (`repeated_deferral`) = 10.**

## 1.12 Migration (§31)

**None.** Every input already exists and is already derived:
`buildCommitmentSignals`, `repeatedlyPostponed`, `findTensions`,
`resolutionsFor`, `buildTodayIndexes`. The shortlist is a pure function of
`(state, indexes, today)` and persists nothing.

---

*Sections 2 onward are written as the implementation lands.*
