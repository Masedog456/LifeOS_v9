# LIFEOS-101 — Capture Intelligence Gaps / Say It Naturally

**North star:** the user should not have to phrase life the way the parser expects.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `49ed92a1dd7dd122ccc1f695340d8487546aa37b` (PR #106 merged) |
| Branch | `claude/lifeos-101-natural-capture-language` |
| Migration required | **no** (§38) |
| Repository migration head | **0047**, unchanged |

---

# 1. The corpus (§2, §3)

`scripts/fixtures/lifeos-101-corpus.cjs` — **105 sentences**, written down *before*
any parser change so "improvement" is measured against a fixed expectation rather
than against whatever the parser happens to do afterwards.

```
action 13 · waiting 8 · event 6 · note 5 · reflection 5 · goal 5 · rule 5
completion 6 · notdone 5 · blocked 3 · recurrence 4 · mixed 5 · negation 5
historical 5 · uncertain 5 · reported 2 · condition 2 · shorthand 3
adversarial 13
```

**34 are guards** — sentences that must not become a commitment. Each carries the
intent a careful reader would give it (`want`), plus any other defensible reading
(`safe`), because several are genuinely ambiguous and the honest answer is a Note.

It runs through the **real `interpret`** against `scripts/fixtures/lifeos-101-store.cjs`,
a seeded store with an open wait on Maria, five open actions and two goals — so
existing-record matching and completion detection are live. A corpus run against
an empty store would measure a different product.

## 1.1 Before

```
PASS 83 · MISSED_INTENT 11 · AMBIGUOUS_BUT_SAFE 6
WRONG_DOMAIN 3 · LOST_FIELD 1 · UNSAFE_FALSE_POSITIVE 1
```

## 1.2 The failure taxonomy, ranked (§4)

| severity | what | count |
|---|---|---|
| **unsafe** | a past narrative with a recurrence phrase became an auto-writable **recurring Action** | 1 |
| **wrong domain** | a bare `never` made a not-done fact into a **Personal Code rule** | 2 |
| **missed** | ordinary commitment framing — *remind me to*, *I've got to*, *I gotta*, *don't let me forget to*, *make sure I* — landed as Notes | 5 |
| **missed** | mixed intent: a new-opener clause was **welded into the first clause's title** | 3 |
| missed | "I need the transcript from Maria" → Note | 1 |
| missed | "Make sure Maria sends the form" → Note | 1 |
| wrong domain | "I want to apply to philosophy programs" → auto Action, not Goal | 1 |
| lost field | "every morning" is neither stored nor reported | 1 |

---

# 2. What was fixed (§37), and what was not

Four fixes. Every one has a failing positive **and** a close negative that already
behaved safely (§39), measured on the running interpreter before a line changed.

## Fix A — a standing commitment needs a standing stance

```
RED    "When I was applying to college I called Maria every week"
       → action / high / auto_with_undo / weekly recurrence
GUARD  "Run every Monday" · "Call Mom every Sunday"
       · "Pay rent on the first of every month" · "Staff meeting every Tuesday at 10"
```

A finished chapter of someone's life written back as a weekly obligation — and
**auto-writable**, so it lands before it can be declined.

`interpret`'s recurrence branch had no stance test. Every other consequential
branch asks: `detectStandard` and `detectAspiration` both refuse a non-asserted
sentence internally. This one skipped the question because it is reached through
the *schedule* rather than through a commitment detector, and a recurrence phrase
is as present in a memory as it is in a plan.

`stance.ts` gains the past time-frame — `when` / `while` / `back when` + a subject
+ `was`/`were` — and the branch consults it. `used to` was already on that list;
this is the same sentence with a different frame around it.

## Fix B — `never` before a past-tense verb is a report, not a rule

```
RED    "Never got around to emailing Marcus"  → standard
       "I never needed to call the dentist"   → standard
       "I never sent Marcus the lease"        → standard
GUARD  "I never say no to my kids" · "I never check email before nine"
       · "Never lie to make myself look better" · "I should never reply when I'm angry"
```

Fixed in `stance.ts` rather than by trimming `normative.ts`'s marker list, because
**the marker is not wrong** — "never" really is normative language. What is wrong
is the stance, `detectStandard` already refuses a non-asserted sentence, and one
change fixes the goal path too. All four guards stay `standard`.

## Fix C — commitment framing (§5, §6)

```
RED    "Remind me to call the dentist Friday"          → note
       "Don't let me forget to submit the application" → note
       "Make sure I send Maria the form"               → note
       "I've got to call the dentist"                  → note
       "I gotta email Marcus tomorrow"                 → note
GUARD  14 sentences, all measured safe before the change and after
```

Extends the **two rules `classify.ts` already has** rather than adding a third, so
title cleanup, the conditional refusal and the `^`-anchoring come for free (§27).
`to` is required in every reminder alternative, which is what keeps §5's
`REMIND ME THAT + fact` a Note — the anchor *is* the negation guard, rather than a
list of things not to match.

Two deliberate narrownesses:

* **The contraction is required.** Bare "I got to" is past tense far more often
  than obligation — "I got to meet him yesterday" — and stays a Note.
* **The remainder must open with an action verb**, which the rule beside it does
  not require. The audit is why: **"I have to admit that was hard" already becomes
  an auto-writable Action titled "admit that was hard"**, a pre-existing false
  positive of that rule (§7.1). A new opener inheriting a bug discovered while
  adding it would be a choice.

## Fix D — mixed intent survives the new openers (§24)

```
RED    "Email Marcus tomorrow and remember the lease expires Friday"
       → ONE Action titled "Email Marcus and remember the lease expires"
GUARD  "Buy milk and bread" · "Move the sofa and the chair to the garage"
```

The second intent was not merely unrecognised — it was **welded into the first
one's title**. `hasOwnIntent` merges back any fragment it cannot place, and
"remember the lease expires Friday" had no entry anywhere.

Safe to widen because that list only decides where to *cut*, and a cut that lands
on a non-action still produces a Note. The merge-back guard is unchanged.

## 2.1 Two false positives this sprint introduced, and fixed

Both were caught by the guard corpus before landing, which is what it is for.

| | |
|---|---|
| `"I never sent Marcus the lease"` → **waiting on "I"** | Fix B stopped `never` claiming it for Personal Code, exposing a latent waiting bug. `detectWaiting` now *skips* a first-person subject rather than blanking it — an anonymous wait is the same wrong record with less information in it. |
| `"Remind me to be kinder to myself"` → **auto Action "be kinder to myself"** | The `i should` rule already excluded dispositions. That list is now a named constant both rules use. |

## 2.2 Rejected (§4 — do not fix everything)

* **"every morning" / "every evening" recurrence.** Measured: `"Take vitamins
  every morning"` stores no recurrence *and* leaves "every morning" in the title,
  so the phrase is silently absorbed rather than reported. Real, and rejected
  because the fix has a subtlety this sprint should not rush — mapping it to
  `daily` discards the *morning*, and leaving the phrase in the title duplicates
  wording. §16 says do not widen recurrence casually. Recorded in §8.
* **"I want to apply to philosophy programs" → auto Action.** `detectAspiration`
  has an "errand wearing a want" escape hatch that fires whenever the remainder
  opens with an action verb, so the same aspiration shape becomes a Goal or an
  auto-Action depending on whether its verb happens to be on a list built for
  errands ("I'd like to run a marathon" *is* a Goal). Real and inconsistent, and
  every narrow discriminator considered — a resolved date, object definiteness —
  breaks "I want to email Marcus". Recorded in §8.
* Everything classified STYLE_ONLY (§2).

---

# 3. Before / after (§36)

Identical corpus, identical store, the five library files reverted to `49ed92a`
for the "before" column.

| | before | after |
|---|---|---|
| PASS | 83 | **94** |
| MISSED_INTENT | 11 | **3** |
| AMBIGUOUS_BUT_SAFE | 6 | 6 |
| WRONG_DOMAIN | 3 | **1** |
| LOST_FIELD | 1 | 1 |
| **UNSAFE_FALSE_POSITIVE** | 1 | **0** |

**+11 correct, zero new false positives, one eliminated** (§35).

## 3.1 One corrected expectation, not a corrected product

The corpus originally marked `"Remind me that the dentist appointment is Friday"`
as a guard that must stay a Note. Measured, it becomes a dated **Event** — and so
does `"Dentist appointment Friday"` with no framing at all. The event detector is
reading the noun and the framing is incidental; an appointment on a named day *is*
an event. The expectation was wrong and was corrected, with §5's own example kept
beside it and still behaving as §5 requires:

```
"Remind me that my passport expires Friday"  → note
"Remind me that the dentist appointment is Friday" → event
```

---

# 4. Proof

## 4.1 Deterministic — `lib/capture/language-selftest.ts`, 65 assertions

The file's shape **is** §40's pairing: every recall assertion sits beside the
negation, historical, uncertainty and reported-speech variants of the same
sentence, because a rule and its guards drifting apart is the failure this sprint
could most easily cause.

A guard passes when the sentence produces no consequential **auto-writable**
record — not when it produces a Note specifically. Demanding a Note would pin
behaviour §18 deliberately leaves open.

101.8 and 101.9 are a pair worth naming: the new opener is gated on an action verb
where the rule beside it is not, and **101.9 asserts the ungated rule's known
weakness**, so the asymmetry is documented by a test that starts failing the day
someone fixes it.

## 4.2 Browser — `scripts/smoke-101-natural-language.cjs`, 20/20

Assertion **19 is §42**, the sprint's own risk made a test. LIFEOS-100 unified the
doorway and a new interpretation rule could fork it again if anything depended on
which surface was mounted. Ten sentences — every chosen fix plus its negation and
its historical variant — go through Home and through the quick-capture sheet from
`/project/p1`, and the **store deltas** are compared, not the rendering.
**All ten identical, route preserved.**

## 4.3 Full-revert proof (§44)

Everything the sprint added, reverted — five library files, the new selftest, the
dogfood register — rebuilt and re-run.

| | |
|---|---|
| deterministic `capture/language` | **44/61** — 17 assertions distinguish the sprint |
| dogfood register | 2 more |
| browser `smoke-101` | **14/20** — 6 red |

The browser reds are 1, 2, 10, 17, 18 and 20. **17 shows the defect itself**:
`{"t":"When I was applying to college I called Maria","rec":true,"s":"open"}`.

Two of the six are red for a related but different reason than their names
suggest, and this is the honest reading: **18** ("raw capture stored exactly as
typed") and **20** ("the sheet's accessibility is unchanged") both fail because
under revert the sentence goes to the *asking* state, so nothing is committed and
the `role="status"` panel does not exist. They are legitimate reds; neither is an
accessibility regression.

The suite crashed on its first revert run — `opensWithPastVerb is not a function`,
because the export moves in this sprint — and took 59 other assertions with it.
**A crash is not a caught defect**, and a suite that cannot survive the thing it
measures measures nothing. The assertion is now `typeof`-guarded so it fails
instead of exploding.

## 4.4 Mutation testing (§43) — 17 mutants, all caught, two only after the suite grew

| | mutant | outcome |
|---|---|---|
| M1–M4 | remove each new positive pattern | CAUGHT |
| M5 | the reminder rule loses its `^` anchor | CAUGHT 101.5 |
| M6 | the past time-frame comes off `stance.ts` | CAUGHT 101.15, 101.21 |
| M7 | the recurrence branch stops asking about stance | CAUGHT 101.15 |
| M8 | the mixed-intent remainder is swallowed | CAUGHT 101.22 |
| M9 | existing-record matching bypassed | CAUGHT 101.25 |
| **M10** | domain precedence: actions before waiting | **ESCAPED**, then CAUGHT |
| **M11** | the `i should` disposition guard removed | **ESCAPED**, then CAUGHT |
| M12 | title built from the raw framing | CAUGHT 5 + coverage 10.2 |
| M13 | the date/time field dropped | CAUGHT 101.2, 101.3 |
| M14 | disposition guard off the reminder rule | CAUGHT 101.10 |
| M15 | action-verb gate off the new obligation opener | CAUGHT 101.8 |
| M16 | the `never`/past-verb stance test removed | CAUGHT 101.18 |
| M17 | nobody-waits-on-themselves guard removed | CAUGHT 101.12 |

**M10 was a real corpus gap, and exactly what §34 asks for.** Running the action
rules before `detectWaiting` changed nothing across 65 assertions and 105
sentences, because every waiting sentence in both happened to be one the action
rules do not claim. Precedence only shows on a sentence *both* claim, and there
was none. `"Chase up the transcript"` is that sentence — `chase up` is on the
action verb list *and* on the waiting pattern list. 101.28–101.30 now pin the
order, with a control so the assertion is about precedence rather than about
waiting swallowing everything.

**M11 was a misnamed assertion.** 101.11 claimed to test that the disposition list
still guards the rule it came from, and did not: `detectStandard` claims "I should
be more patient" at `interpret` step 1b, before the classifier is reached, so
through `interpret` that guard is **unreachable**. It is not unreachable for
`classifyOne`, a public export four other surfaces call — and this sprint made the
list shared, so it is load-bearing for the reminder rule too. There are now two
assertions, each naming which level it is about.

---

# 5. Performance (§45)

`interpret` over the 105-sentence corpus, mean ms per sentence:

| open actions | before | after |
|---|---|---|
| 6 | 0.065 | 0.065 |
| 106 | 0.073 | 0.083 |
| 1,006 | 0.254 | 0.340 |
| 5,006 | 1.056 | 1.579 |

5,000 straight interpretations of `"Remind me to call the dentist Friday"`:
**267 ms — 0.053 ms each.**

**§45's requirement holds: no store scan was added to classify wording.** The new
rules are pure regex over the sentence. At realistic store sizes the difference is
~0.01 ms and unmeasurable.

The stress-store increase was traced rather than assumed, and **two hypotheses were
wrong before the right one**:

* *Fix D makes more sentences decompose into two segments, and each segment pays
  the per-segment store cost.* Wrong — the multi-segment sentences are the cheap
  ones. The split into "single-segment" and "multi-segment" groups was not a valid
  comparison either: group membership changes between revisions, and a 4-item loop
  and a 101-item loop get different JIT treatment.
* *More sentences reach a store-scanning call.* Wrong — instrumented call counts
  barely move (`detectMissed` 90 → 95, `matchRecords` 106 → 109).

Measured per sentence on a fixed list, **two sentences account for 51.2 ms of the
54.2 ms increase**:

```
"I never needed to call the dentist"    0.023ms → 25.64ms
"Never got around to emailing Marcus"   0.028ms → 25.59ms
```

Both moved from a **wrong-but-fast** `detectStandard` early return into
`detectMissed`, which is pre-existing and already cost 12.6 ms for "I didn't call
the dentist" before this sprint. `detectMissed` measured alone is linear in open
actions: **0.148 / 0.450 / 2.661 / 13.546 ms** at 6 / 106 / 1,006 / 5,006. That is
a pre-existing scalability property of the not-done path, recorded in §8.

---

# 6. Visual review (§46)

Titles carry no framing residue and nothing is duplicated:

```
"Remind me to call the dentist Friday"  → SAVED AS ACTION · Call the dentist · Due Fri, Sep 11
"I gotta email Marcus tomorrow"         → SAVED AS ACTION · Email Marcus · Due tomorrow
"Make sure I send Maria the form"       → SAVED AS ACTION · Send Maria the form
"Never got around to emailing Marcus"   → SAVED AS NOTE · (kept as typed)
```

Two things the review surfaced, both worth stating:

* `"Don't let me forget to submit the application"` **asks** rather than
  auto-finishing, because the store already holds "Submit the application" and 089
  says *"May already exist"*. That is duplicate protection working (§26), not a
  miss.
* `"When I was applying to college I called Maria every week"` now falls to the
  note fallback and therefore reaches the **pre-existing** escalation path ("Part
  of this didn't match any rule, so Conqify asked AI for help with it"). No LLM
  fallback was added (§31); Fix A routes one more shape into the one that already
  existed, and a long past narrative genuinely is *"a sentence the rules could not
  place"*. It is confirm-gated, and the alternative it replaced was a wrong
  recurring commitment.

---

# 7. Known gaps

1. **`"I have to admit that was hard"` is already an auto-writable Action** titled
   "admit that was hard", and so is `"I have to say I was disappointed"` and
   `"I need to be more patient"`. A pre-existing false positive of the `I need/have
   to` rule, out of this sprint's scope — and the reason the new opener beside it
   is gated on an action verb. Assertion **101.9 pins it**, so it will start
   failing the day it is fixed.
2. **`"every morning"` / `"every evening"` are neither stored nor reported.** §2.2.
3. **`"I want to <action verb> …"` becomes an auto Action rather than a Goal**,
   while `"I'd like to run a marathon"` becomes a Goal. §2.2.
4. **`detectMissed` is O(open actions)** with a high constant — 13.5 ms at 5,006.
   §5.
5. **`"Remind me that …"` framing is not stripped from a title** when the sentence
   becomes an Event: `"Remind me that the dentist appointment"`. Fix C only handles
   `remind me TO`.
6. **`"I need the transcript from Maria"` stays a Note.** §9 says prefer Action or
   ask rather than invent waiting state; it currently does neither. Left as
   measured rather than guessed at.
7. **`"Make sure Maria sends the form"` stays a Note** — someone else's action.
   §8 says not to read every sentence about another person as a commitment, so
   this is deliberate, but a Waiting suggestion would be defensible.

---

# 8. Gates (§48)

```
deterministic selftests   6216/6216 across 63 suites; failing suites: none
smoke-101 language        20/20
smoke-080 intelligence    111/111 (54 desktop, 56 mobile)
smoke-089 capture context 66/66
smoke-095 capture home    67/67
smoke-096 clean outcomes  36/36
smoke-097 corrections     41/41
smoke-100 global capture  28/28
release audit             PASS 17/17 · migration count 47, head unchanged
route smoke               PASS 25/25
export verify             PASS 14/14
security audit            PASS (RLS, secrets, routes, auth, deps)
tsc --noEmit              clean
eslint                    0 errors, 2 pre-existing warnings
next build                clean
```

**Migration head 0047, unchanged.** §38 needed nothing: this sprint is
interpretation code and tests only.

---

# 9. The twelve claims (§50)

1. **Ordinary phrasing works better** — +11 correct on a fixed 105-sentence corpus,
   with five everyday commitment framings that were Notes now reaching the Next
   list under their own verb phrase.
2. **Only measured gaps were changed** — four fixes, each with a red proof and a
   guard measured before the change; three candidate fixes rejected and recorded.
3. **Negation safety is intact** — every new opener has its negated variant
   asserted, and M5 (removing the `^` anchor) reddens 101.5.
4. **Historical safety is intact** — and improved: the sprint *removed* an unsafe
   false positive rather than adding one. M6 and M7 both redden.
5. **Uncertainty does not silently commit** — hedged and reported-speech variants
   of every new opener write nothing.
6. **Mixed-intent captures stay multi-intent** — and stopped being welded into one
   title. M8 reddens.
7. **Completion still matches existing records first** — unchanged, asserted in
   the browser at 11 and 12.
8. **Waiting improvements create no duplicates** — and one *wrong* wait was
   removed: nobody waits on themselves.
9. **Home and Quick Capture interpret identically** — ten sentences, byte-equal
   store deltas, route preserved.
10. **Raw source remains exact** — asserted deterministically over six sentences
    and in the browser.
11. **No LLM fallback, embeddings, or confidence UI were added** — the escalation
    path §6 mentions is pre-existing and confirm-gated.
12. **No migration was added** — head 0047.
