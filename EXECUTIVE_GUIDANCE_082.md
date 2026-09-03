# LIFEOS-082 — Executive Guidance / What Should I Focus On?

**North star:** turn everything Conqify knows into a small, grounded set of
things that deserve my attention now.

## STATUS: COMPLETE — EXECUTIVE GUIDANCE READY

| | |
|---|---|
| Base SHA | `82d2ee48792ad89c7f69a6f8743120ee82ea1633` (PR #87 merged) |
| Branch | `claude/lifeos-082-executive-guidance-focus` |
| Migration | **none** — pure derivation |
| Repository migration head | **0047**, unchanged |
| New persistence | **none** — no table, no domain, no noun |

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

# 2. What was built

| Concern | Where |
|---|---|
| The shortlist | `lib/guidance/attention.ts` |
| Routing — one guidance aspect | `lib/memory/query.ts` (`GuidanceAspect`) |
| The answer | `lib/memory/answer.ts` (`answerFocus`) |
| Entity scope for the full list too | `lib/memory/answer.ts` (`answerOpenWork`) |

**One new file and two edits.** Nothing under `lib/today/` and nothing under
`lib/commitment/` was modified.

## 2.1 Attention vs next action (§3)

Preserved, and the code already respected it: `recommendNextAction` answers
*"the single best executable thing"* and is untouched;
`buildAttentionShortlist` answers *"what should I notice"*. A test asserts that
building the shortlist leaves Suggested Next byte-identical (82.54).

## 2.2 Attention kinds implemented (§5)

**Ten.** Nine reused from `buildCommitmentSignals` unchanged, plus one:

```
overdue · follow_up_due · returned_today · recurring_due · blocked
due_soon · repeated_deferral · project_no_next_action
goal_path_missing · dormant
```

`AttentionKind` is `CommitmentKind | "repeated_deferral"` — the union, not a
retyped list, so a kind added or removed in the signal layer cannot silently
disagree here.

**Four kinds §5 offered were refused**, with reasons rather than silence:

| Refused | Why |
|---|---|
| `GOAL_QUIET` | §13 — no principled inactivity window. An active *life* goal does not need weekly activity, and a horizon-scaled window would be a threshold with nothing behind it. |
| `WAITING_STALE` | §17 — the grounded case is `follow_up_due`. "Waiting too long" has no rule. |
| `RECENT_CHANGE_REQUIRES_REVIEW` | §19 — a change deserves attention only when it leaves an unresolved consequence, and any such consequence is already produced by another kind. It would duplicate a row, not inform one. |
| `UNRESOLVED_CHOICE` | Nothing records one. |

`RULE_TENSION` became **context on an item** rather than a kind — §21's actual
requirement.

## 2.3 Source reuse (§6)

Everything is composed; nothing is re-derived.

| Fact | Source | Owner |
|---|---|---|
| Nine signal kinds | `buildCommitmentSignals` | LIFEOS-070 |
| Repeated deferral | `repeatedlyPostponed` | LIFEOS-081 |
| Rule context | `rulesMatchingText` | LIFEOS-079 |
| Resolutions | `resolutionsFor` / `resolutionsForAction` | LIFEOS-071 / 072 |
| Ordering | `COMMITMENT_ORDER`, spliced in whole | LIFEOS-070 |

Inheriting `repeatedlyPostponed` inherits its guarantees for free: recurring
work excluded, distinct instants only, count from recorded deferrals.

## 2.4 Ordering, and the one judgement made (§8)

`ATTENTION_ORDER` is `COMMITMENT_ORDER` with `repeated_deferral` spliced in
**after `due_soon`** — the single positional decision in the file. §8 forbids
letting a vague signal outrank a concrete deadline, and a pattern of deferrals,
however real, is softer evidence than a date that has arrived. Everything dated
comes first, the behavioural fact next, structural concerns last.

**No score exists.** Ordering is kind → date → id. An assertion sweeps every
item's own keys for anything matching `score|weight|rank|priority|urgency|
importance` (82.10).

## 2.5 The cap (§9)

Three by default, five maximum, clamped. Applied **after** ordering, so what
survives is the most directly evidenced rather than whatever was built first.

The browser suite made this concrete in a way worth recording: in the full
fixture the repeated-deferral row is *fourth* and the cap cuts it. A first draft
asserted it in the top three and failed — the cap working, not a defect. It is
now asserted on its own seed, and a separate assertion states that the cap is
what excluded it from the larger list (browser 2.5).

## 2.6 Explanations and resolutions (§10, §11, §12)

Every row carries the signal layer's own one-sentence explanation, then any
other true fact about the same item, then the user's rule as context — in that
order, because the rule informs and does not rank.

Resolutions are **reused, never re-created**:

- a signal-backed row travels with its `CommitmentSignal`, so the surface builds
  LIFEOS-071's controls;
- a `repeated_deferral` row has no `CommitmentKind` and therefore no entry in
  `RESOLUTIONS_BY_KIND`, so it carries its `actionId` and uses
  `resolutionsForAction` instead — **exactly the split LIFEOS-072 made for
  recommendations**, rather than synthesising a signal no evidence supports.

## 2.7 Goal semantics (§14)

The wording already matched the predicate and this sprint kept it:
**"No active project is linked to this goal"** — never "no path forward". A goal
that has an active project is not listed at all (82.33).

## 2.8 Waiting semantics (§17)

Only the grounded case: a follow-up date that has arrived. A follow-up five days
out produces nothing (82.27, browser 3.2). No "waiting too long" rule was
invented.

## 2.9 Personal Code as context (§21)

`ruleContext` is read by the presentation layer and by **nothing in the
ordering**. The assertion that proves it strips every rule from the store and
compares the resulting order to the original (82.36) — and the fixture attaches
a rule to the *lowest*-ranked row on purpose, so a promotion would have to move
something visible.

## 2.10 Memory integration (§23)

A `focus` aspect on the **existing** `OPEN_WORK` class. No new query kind, no
overlapping class. `all` keeps the full list; `focus` returns the shortlist.

Entity scope was added to **both** paths — the full list had the same defect
LIFEOS-081 found in `answerChanges`. Ambiguity returns `NEEDS_CHOICE`.

**§24's wording rule is enforced in both directions:** *"What am I neglecting?"*
routes and is answered, and the word "neglect" never appears in the answer
(82.63, 82.66).

---

# 3. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `npm run build` | clean · 0 errors · exit 0 |
| Deterministic selftests | **4754/4754** across 46 suites |
| …of which new this sprint | **86** (`lib/guidance/selftest.ts`) |
| `smoke-082-executive-guidance.cjs` (browser, 2 viewports) | **64/64** |
| `smoke-081` · `smoke-080` · `smoke-079` · `smoke-078` · `smoke-076` | 72/72 · 109/109 · 97/97 · 93/93 · 281/281 |
| `inject-077` · `inject-078` | 51/51 · 43/43 |
| `release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

### Performance (§35)

Shortlist plus one entity-scoped build, inside a 3000ms budget asserted in the
suite, at 100 / 1,000 / 5,000 actions. Indexes come from `buildTodayIndexes`,
built once by the caller and passed in; the deferral scan is bounded to
`DEFERRAL_LOOKBACK_DAYS` (90).

## 3.1 Mutation testing (§34)

Eight mutations. **Five caught immediately. All three escapes were tests passing
for the wrong reason** — the most useful result the suite produced.

| Escape | Why it passed | Fix |
|---|---|---|
| Randomising the tie-break | The fixture had **two** tied items, so a coin flip satisfies it half the time — and flakily. | Six tied items, exact expected order, plus a repeat-sort assertion. |
| Letting a rule promote an item | The rule was attached to the row that was **already first**, so promotion moved nothing. | A second rule attached to the *lowest*-ranked row. |
| Restating the goal predicate as a verdict | The assertion compared `GOAL_PATH_MISSING` **against itself**. | Assert the literal sentence, and sweep a list that definitely contains the goal row. |

All eight now turn targeted assertions red.

---

# 4. Product claims (§38)

1. **A small grounded shortlist** — 82.1–82.5, browser 1.1–1.2.
2. **Every item has factual evidence** — 82.15–82.17.
3. **No score exists** — 82.10, browser 1.6.
4. **Recurring work is not mislabelled** — 82.21, browser 2.3.
5. **Future follow-ups are not surfaced early** — 82.27, browser 3.2.
6. **Completed blockers do not surface** — 82.30, browser 4.3.
7. **Goal wording matches the predicate** — 82.31, 82.31b, browser 5.2–5.3.
8. **Personal Code is context, not priority** — 82.36, browser 6.2.
9. **Existing resolutions are reused** — 82.38–82.43, browser 9.1.
10. **Empty stays empty** — 82.47, browser 10.1–10.3.
11. **Today ordering is unchanged** — 82.54–82.55; no file under `lib/today/`
    was modified.
12. **No migration or new persistence noun** — pure derivation.

---

# 5. Known gaps

- **Today does not show the shortlist.** §22 says to reuse Today's existing
  "Needs attention" section rather than add a surface, and that section renders
  commitment signals — so adding `repeated_deferral` rows to it would change
  what Today shows. §38.11 requires Today ordering unchanged, so the
  conservative call was taken: **the shortlist is reachable through Memory
  only.** Wiring it into Today's existing section is a small, separable change
  and is deliberately not made here.
- **`GOAL_QUIET`, `WAITING_STALE`, `RECENT_CHANGE_REQUIRES_REVIEW` and
  `UNRESOLVED_CHOICE` are not implemented** — §2.2 gives the reason for each.
- **The 90-day deferral lookback is a stated window**, and the only one this
  sprint introduces. It is a scope bound, not a threshold about a person.
- **§27's no-nagging requirement is inherited, not newly engineered.** An item
  leaves the shortlist when its underlying signal resolves — completing,
  deferring or answering removes it — because every kind is the existing signal
  layer's. No notification machinery was added.
- **No AI is used at all** (§30). Deterministic text was sufficient, so the
  seam was not opened.

---

# 6. Verdict

**LIFEOS-082 COMPLETE — EXECUTIVE GUIDANCE READY.**

No migration. Repository migration head unchanged at **0047**. All final gates
green.

Nothing in §40's stop list was begun: no 0048, no Collections, People or
Calendar expansion, no D-8, no general D-23, no Observatory, no AI
psychological inference, no autonomous scheduling, no notification engine.
