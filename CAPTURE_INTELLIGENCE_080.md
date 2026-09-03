# LIFEOS-080 — Capture Intelligence for Goals + Personal Code

**North star:** tell Conqify what's happening in normal language, and it should
know what kind of thing it might become.

## STATUS: COMPLETE — CAPTURE INTELLIGENCE READY

| | |
|---|---|
| Base SHA | `9b890b2be611319f55cda0730e337d4737b81ac2` (PR #85 merged) |
| Branch | `claude/lifeos-080-capture-intelligence-goals-code` |
| Migration | **none** — see §1.11 |
| Repository migration head | **0047**, unchanged |
| Schema capability advertisement | **not needed** — nothing was added to the wire |

---

# 1. The audit (§2)

Everything below was produced by **running the pipeline**, not by reading it. The
probe calls `interpret(text, emptyStoreState(), "2026-09-03")` on a 34-sentence
corpus and prints segments, kinds, confidence, authority and titles. Where a
verdict is quoted, that is the actual output.

## 1.1 A — Which candidate kinds exist today?

Nine, in `lib/capture/authority.ts`:

```
action · waiting · note · protocol · reflection · project · goal · event · standard
```

Plus one path that is not a kind: `wholeCaptureAsNote` — the §16 escape hatch,
always available, independent of interpretation.

Three tiers already exist and are worth naming precisely, because 080 must not
blur them:

| Tier | Members | Enforced by |
|---|---|---|
| Proposable and writable | action, waiting, note, protocol, reflection, project, goal, event | — |
| Proposable, never writable | **standard** | `SUGGEST_ONLY_CANDIDATE_KINDS`, `never_auto`, both conversion paths |
| Not even proposable | belief, constitution, constitution_element, decision, principle, framework | `CandidateKind` has no member — structural, not a check |

The AI seam is narrower still: `AI_PROPOSABLE_KINDS = ["action", "waiting",
"note"]`, and every AI candidate is forced to `authority: "confirm"` regardless
of kind. A model cannot propose a goal, a protocol or a standard today.

## 1.2 B — Which ones are consequential?

"Consequential" = a wrong one costs more than deleting a row.

| Kind | Cost of a wrong one |
|---|---|
| **standard** | A claim about who the person is trying to be, attributed to them |
| **goal** | Structure that reaches alignment, horizons (0047) and the Goals surface; a wrong one sits there implying a life direction |
| **protocol** | A normative record; it is one half of Personal Code and it feeds Today's context lines |
| **project** | Structure the user must maintain or dismantle |
| **reflection** | A statement about inner life, written into formation |
| action / waiting / event / note | One row, one delete |

## 1.3 C — Which may auto-create?

Only four kinds have a base authority above `confirm`: **action, waiting, note,
event** — all `auto_with_undo`, all arriving pre-ticked via `preselected()`.

And only at `high` confidence. `authorityFor` demotes any `likely`/`possible`
reading to `confirm`, so "the system does not know what this is" can never
arrive pre-selected. That rule is sound and 080 does not touch it.

## 1.4 D — Which are suggest-only?

Exactly one: `standard`. And here is the audit's most important finding.

### The `standard` candidate is a dead end

LIFEOS-079 wrote, in `lib/capture/interpret.ts`:

> The candidate exists so the sentence reaches Personal Code, not so capture can
> create a rule.

**It does not reach Personal Code.** There is no handoff. Traced end to end:

1. `interpret` produces a `standard` candidate, `never_auto`, unticked.
2. `CaptureComposer` renders it with the note *"Conqify will not create this for
   you"* — and offers a checkbox, the same as every other row.
3. The user ticks it and presses Confirm.
4. `commitCapture` reaches `case "standard": break;` and writes nothing.
5. `created.length === 0`, so the toast reads **"Saved your capture."**
6. `/personal-code` has no prefill, no query parameter, no draft state
   (`useState("")` and nothing reads a URL).

The raw capture does survive — that guarantee holds. But from where the person
is standing, Conqify recognised their rule, said so, accepted their
confirmation, and then reported nothing. The recognition is thrown away at the
last step, and the only route to the rule they just wrote is to navigate to
Personal Code and type it again.

The refusal to *create* is right and stays. The absence of a *destination* is
the defect.

## 1.5 E — Where do Goals currently enter Capture?

**One rule, one regex**, at `lib/capture/interpret.ts:434`:

```ts
const aspiration = /^i\s+want\s+to\s+(.+)$/i.exec(text);
```

…gated by an errand exclusion (if the remainder classifies as a high-confidence
action, it stays an action). Then `commitCapture` → `createGoal({ title })`.

So `goal` is already a `CandidateKind` at `confirm` authority. **§7 is a
detector gap, not a kind gap.** What that single anchored regex misses:

| Sentence | Today | Should be |
|---|---|---|
| `I want to learn Spanish` | **goal** ✓ | goal |
| `I want to get into better shape this year` | **goal** ✓ | goal |
| `I'd like to run a marathon someday` | note | goal |
| `My goal is to save six months of expenses` | note | goal |
| `Someday I want to move closer to my parents` | note | goal |
| `Long term I want to start my own business` | note | goal |
| `Eventually I need to finish my degree` | note | goal |
| `I'm trying to get better at saying no` | note | goal |

Four of those fail for the same mechanical reason: the regex is anchored at `^`,
so **any prefix defeats it** — "Someday", "Long term", "Eventually". The
sentence that literally says *"My goal is to"* becomes a note.

### Two aspirations are worse than missed — they are captured as rules

```
"I've always wanted to learn to play piano"   → standard / never_auto
"I want to be debt free in two years"         → standard / never_auto
```

The first matches `\balways\b`. The second matches `i want to be`. Both are
goals — the second names a **two-year horizon**, which 0047 exists to hold — and
both land in the one tier that cannot be written at all. A wish becomes a rule
the person is held to, and then the rule goes nowhere (§1.4).

Also: `commitCapture`'s goal case passes `{ title }` only. `createGoal` accepts
`horizon` (0047), so a capture-born goal is always horizon-less even when the
person wrote "someday" or "in two years".

## 1.6 F — Where do Standards / Protocols enter Capture?

**Protocol** — `extractConditional(text)?.leading`, and the leading form is:

```ts
/^(when(?:ever)?|if|before|after)\b\s+([^,]+?)\s*(?:,|\s+then\s+)\s*(.+)$/i
```

A **comma or the word "then" is mandatory**. Consequence:

| Sentence | Today | Should be |
|---|---|---|
| `When I'm angry, wait before replying` | **protocol** ✓ | protocol |
| `If I feel overwhelmed I go for a walk` | note | protocol |
| `Whenever I skip a workout I do it the next morning` | note | protocol |
| `I'm not going to reply to anything when I'm angry` | note | protocol (trailing) |

The trailing form is extracted but never used — `interpret` and `saveRule` both
test `.leading` only.

**Standard** — `detectStandard` in `lib/code/normative.ts`. Its marker list
requires `always`/`never`, a small closed verb set after `don't`, or a
clause-anchored `I want/try/intend/aim to be…`. What falls through:

| Sentence | Today | Should be |
|---|---|---|
| `I always tell the truth even when it makes me look bad` | **standard** ✓ | standard |
| `Never check email before 9am` | **standard** ✓ | standard |
| `From now on I stop working at 6pm` | note | standard |
| `No phone at the dinner table` | note | standard |
| `I should be more patient with my kids` | note | standard |
| `I refuse to take on work I can't finish` | note | standard |

`I should be more patient` fails because the marker is `i (should|must)
(always|never)` — "should" alone is not enough, by design, and that design is
now visibly too tight.

## 1.7 G — What statements are currently misclassified?

The tables above are the misses. These are the **wrong positives**, and they are
the ones that matter, because a wrong `standard` puts a commitment in front of
someone who was not making one:

| Sentence | Today | Why it is wrong |
|---|---|---|
| `I used to always answer emails immediately` | **standard** | **Past tense.** They *used to*. Offered as a rule they hold now. |
| `I wonder if I should always be so available` | **standard** | **Wondering.** A question about a rule, read as the rule. |
| `Is it a rule that I never say no?` | **standard** | **A literal question mark**, and `\bnever\b` fires. `detectStandard` runs before the `endsWith("?")` rule in `classifyOne`, so the question guard is never reached. |
| `I've always wanted to learn to play piano` | **standard** | A goal (§1.5). |
| `I want to be debt free in two years` | **standard** | A goal with a horizon (§1.5). |

**§15, §16 and §17 are not partially implemented — they are absent.** There is
no reflection guard, no negation guard and no past-tense guard anywhere in
`normative.ts`, `classify.ts` or `interpret.ts`. The negation cases that
currently behave correctly do so by accident:

```
"I don't want to run a marathon"     → note   (only because the goal regex needs a bare "^i want to")
"I no longer want to be the person…" → note   (same accident)
```

Both would flip to a goal the moment §7's detector widens. **The guards must
land before or with the widening, not after** — widening first would ship a
product that reads "I don't want to run a marathon" as a goal to run a marathon.

## 1.8 H — What mixed-intent statements collapse into one noun?

`decompose` is better than the brief's §22 warning implies: it is sentence spans
→ separator split → **merge-back for any fragment with no intent of its own**,
plus an abbreviation guard and a never-split rule for leading conditionals. It
is not naive punctuation splitting, and it already handles the common case:

```
"I want to run a marathon and I need to buy running shoes"
  → goal("run a marathon") + action("buy running shoes")   ✓
"Call the dentist tomorrow and I want to be someone who doesn't put things off"
  → action("Call the dentist") + standard(…)               ✓
```

What collapses:

```
"I want to get healthier so I should stop eating late, and I need to book a physical"
  → goal("get healthier so I should stop eating late") + action("book a physical")
```

Two things fused into one goal title. `so` is not a separator, and `I should
stop eating late` is a **rule**, not part of the aspiration. The goal is left
with a title that is half aspiration and half rule.

```
"I've been thinking I want to change careers, I should talk to Dana about it"
  → note(reflection) + note
```

The goal inside the first clause is invisible: `I've been thinking` is a
reflective marker matched at the *start* of the segment, and the segment is then
classified as a whole. And `I should talk to Dana` is only a note because
`classifyOne`'s action rule is `(need|have|want|ought) to` — **`should` is
missing from the list**, though it *is* in `decompose`'s split prefixes.

### The structural limit behind all of this

`interpretSegment` returns **exactly one `Candidate` per segment** — every
branch is a `return`. So "several at once" is achievable today *only* by
splitting the text. A single clause that is genuinely two things ("I want to get
healthier" = an aspiration; "so I should stop eating late" = a rule) cannot
produce two candidates no matter how good the detectors get.

That is the north star's real obstacle, and it is a shape problem, not a rule
problem.

## 1.9 I — Where is user wording lost?

Mostly it is not. The raw capture is written first and never rewritten;
`standard` keeps the sentence verbatim; notes keep the body; `dateNotKept` and
the `unresolved` list exist specifically so nothing vanishes silently.

Two places where it does:

1. **The goal title is the stripped remainder.** `I want to learn Spanish` →
   `learn Spanish`. Fine in isolation — but on a fused segment it produces
   `get healthier so I should stop eating late`, which is not a sentence the
   person wrote and not a goal they set.
2. **`standard` loses everything at commit** (§1.4). The wording survives on the
   capture; the *recognition* does not survive anywhere.

## 1.10 J — The smallest change that makes Capture materially smarter

Ordered so that each step is safe on its own, and so the guards land before the
widening:

1. **Guards first (§15, §16, §17).** Past tense, negation, and
   wondering/question. These only ever *remove* a consequential suggestion, so
   they cannot make anything worse, and three live wrong-positives disappear the
   day they ship.
2. **Close the `standard` dead end (§6).** A recognised rule must arrive at
   Personal Code with the sentence carried across. No new page (§33) — the
   existing `/personal-code` create field, prefilled. Still `never_auto`; still
   nothing written without the person's hand.
3. **Widen goal detection (§7)** to the shapes in §1.5, at `confirm`, with the
   two aspirations currently mis-tiered as `standard` routed back to `goal`.
   Carry an explicitly-stated horizon word onto the candidate as a *shown,
   editable* field rather than a silent one.
4. **Widen the normative detector (§11) in `lib/code/normative.ts` only** — one
   canonical path, reused, never duplicated.
5. **Widen `extractConditional` to the no-comma leading form**, gated hard.
   This is the one change with reach beyond capture (six call sites, including
   `saveRule`'s routing and `normative.ts`'s own exclusion), which is exactly
   why it must be the shared function rather than a second detector.
6. **Split on `so` / `but`** under the existing merge-back rule, so the fused
   goal+rule separates.
7. **Allow one segment to yield several candidates**, so the north star's "or
   several at once" stops depending on the person having used a comma.

## 1.11 Migration (§32)

**None is required, and none will be written.**

Every kind 080 wants to recognise already has a home and a row shape:

| What 080 recognises | Where it already goes |
|---|---|
| Goal, with a horizon | `goals`, `horizon` column — migration **0047**, live |
| Unconditional rule | `constitution_elements`, `kind: "standard"` |
| Conditional rule | `protocols` |
| Action / waiting / note / event / project / reflection | unchanged |

080 changes **which** record a sentence is proposed as, and **where the person
is sent to confirm it**. It adds no field, no domain, no wire shape and no
capability. `DOMAIN_CAPABILITY_REQUIREMENTS` is untouched, `CLIENT_CONTRACT`
stays at 3, and the repository migration head stays at 0047.

The interpretation layer itself is transient by construction (LIFEOS-060) —
`Interpretation` is never persisted — so there is nothing here that could need
one.

---

# 2. What was built

| Concern | Where |
|---|---|
| Is this sentence actually asserting the thing it names? | `lib/capture/stance.ts` |
| Does it name something the person wants? | `lib/capture/aspiration.ts` |
| Does it state a rule? (widened, not duplicated) | `lib/code/normative.ts` |
| Conditionals, in the one shared function | `lib/capture/classify.ts` |
| Splitting `so` / `but` | `lib/capture/decompose.ts` |
| Routing, and second readings | `lib/capture/interpret.ts` |
| Capture → Personal Code | `lib/code/handoff.ts`, `components/capture/CaptureComposer.tsx`, `app/personal-code/page.tsx` |
| Provenance through the new door | `lib/mvpStore.ts` (`saveRule`) |

**No new page (§33).** No Goal Capture page, no Rule Capture page, no Smart
Intake. One route was touched — `/personal-code`, which LIFEOS-079 already
added — and it learned to accept a prefill.

**Today ranking is untouched (§30).** No file under `lib/today/` was modified.

## 2.1 The guards came first, and that ordering was load-bearing

Two of the four negation cases in the audit behaved correctly *by accident*:
`"I don't want to run a marathon"` stayed a note only because the goal regex was
anchored at `^`. Widening goal detection first would have shipped a product that
reads that sentence as a goal to run a marathon.

`lib/capture/stance.ts` is the one answer to *"is this sentence actually
asserting this?"*, and both consequential detectors delegate to it rather than
carrying their own copy — LIFEOS-079 has already paid once for a second list
that drifted from `extractConditional`.

It turns on a distinction worth stating plainly, because getting it backwards
would suppress exactly what Personal Code exists for:

| | |
|---|---|
| `"I don't lie to avoid embarrassment"` | negative **content**, asserted stance → **a rule** |
| `"I don't want to run a marathon"` | negated **operator** → not a goal |

Most rules people write for themselves are prohibitions. So every pattern
negates *wanting*, *intending* or the universal quantifier that makes a rule a
rule — never a plain verb.

When a guard withholds a reading, the note says so (*"Reads as something you
used to do…"*) — and only when the marker really was there, so the product never
reports a near-miss it did not have.

## 2.2 Goals: the anchor was the defect

`lib/capture/aspiration.ts` replaces `/^i\s+want\s+to\s+(.+)$/i`. Markers are
now clause-anchored rather than string-anchored — the fix LIFEOS-079 arrived at
for the same class of problem — so a prefix no longer defeats them while
*"whether teaching is what I want to do"* still does not match.

The errand exclusion survives unchanged, and it is what makes widening safe:
`"I want to call my brother on Saturday"` is still an action. The one exception
is a long-range adverb, which says outright that this is not the next step —
`"Eventually I need to finish my degree"` carries an action verb and is plainly
not an errand.

**Goal or rule** is decided by stripping the marker and looking at what is left.
Stripping first is the whole trick: `"I've always wanted to learn piano"`
contains `always`, but the `always` modifies the *wanting*.

### Horizons are read, never inferred

LIFEOS-078 wrote the rule into `createGoal` — *"nothing is inferred from the
title or the date"* — and this sprint holds that line. A long-range adverb is
used for two honest things only: to find the marker behind it, and to tell an
ambition from an errand. It is **not** mapped onto a `GoalHorizon`.

"This year" is `near` in November and `medium` in January. Picking one would be
the product inventing a life fact from a calendar, which is the overclaiming 078
refused for goal progress. A capture-born goal arrives with no horizon and the
person sets it. Asserted at browser 1.9.

## 2.3 The dead end, closed

The audit's central finding was that a `standard` candidate reached nothing.
Capture recognised the rule, printed *"Conqify will not create this for you"*,
offered a checkbox like every other row, took the confirmation, refused the
write, and reported *"Saved your capture."*

What changed is that capture gained a **destination**, not authority:

- the suggest-only row has **no checkbox** — a control that cannot do what it
  appears to do is worse than no control;
- it has *"Add to my Personal Code →"* instead, which saves everything else the
  person ticked, saves the capture, and navigates;
- Personal Code opens with the sentence prefilled and *"Nothing is saved until
  you add it"*;
- arriving there still creates nothing. The person's own click does.

`standard` is still `never_auto`, `commitCapture` still refuses it, and
`FORBIDDEN_CANDIDATE_KINDS` is byte-identical. Asserted end to end at browser
2.4–3.11, and the negative — `constitutionElements` empty — is asserted twice
before it is asserted non-empty.

**Provenance survived the new door.** `saveRule` now classifies the source
capture's own text rather than defaulting to "the user", exactly as
`convertCapture` does, so machine prose kept from a suggestion still reads as
machine prose after adoption (LIFEOS-050A/050B).

## 2.4 Several things at once

`interpretSegment` returned one candidate per segment, so "several" could only
ever mean several clauses. Two changes:

- `so` and `but` join the separators, under the existing merge-back rule;
- a segment may now yield a **second reading**, in exactly one case: a
  reflective sentence that also names an ambition or a rule.

```
"I want to get healthier so I should stop eating late, and I need to book a physical"
  → Goal "get healthier" · Rule "I should stop eating late" · Action "book a physical"

"I've been thinking I want to change careers"
  → Note (the reflection)  ·  Goal "change careers", unticked
```

Suppressing the second loses what the person said; asserting it decides a career
change on their behalf. Offering both is honest only while the second arrives
unselected — asserted at browser 6.4 and at 80.94.

## 2.5 One normative path, one conditional function

§11 asked for no duplicated detector logic, and the sprint took that further
than the normative case:

- `detectStandard` was **widened in place**; a sweep asserts that no `standard`
  candidate exists anywhere that `detectStandard` does not also produce, so a
  future parallel path turns the suite red (80.68).
- `extractConditional` gained the un-delimited leading form in the **shared
  function**, not a copy. It has six callers — the protocol classifier,
  `decompose`'s never-split rule, `saveRule`'s routing, `normative.ts`'s own
  exclusion, inbox conversion and the Protocols page — and a second opinion
  about what a conditional is would let them disagree about one sentence.

With no delimiter there is nothing to split on but the subject, so both halves
must be first-person clauses and neither may be past tense. `"When I got home
the dog was gone"` has one `I`; `"When I saw him I told him the truth"` is a
narrative. Neither is a protocol. And because the split was inferred, the
reading is `likely`, not `high`.

---

# 3. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `npm run build` | clean · 0 errors · exit 0 |
| Deterministic selftests | **4554/4554** across 44 suites |
| …of which new this sprint | **204** (`lib/capture/intelligence-selftest.ts`) |
| `scripts/smoke-080-capture-intelligence.cjs` (browser, 2 viewports) | **109/109** |
| `scripts/smoke-079-personal-code.cjs` | 97/97 |
| `scripts/smoke-078-goal-horizons.cjs` | 93/93 |
| `scripts/smoke-076-sync-trust.cjs` | 281/281 |
| `inject-077-schema-compatibility.cjs` · `inject-078-goal-capability.cjs` | 51/51 · 43/43 |
| `release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

Migration rehearsal was **not** re-run: no schema was touched. The
schema-compatibility harnesses were run anyway to confirm nothing regressed.

**Performance (§37).** 660 interpretations of the audit corpus complete well
inside a 1500ms budget asserted in the suite (80.131). Interpretation runs on
every capture submit, so the budget is on the hot path rather than on a report.

## 3.1 Mutation testing found three assertions that were not earning their keep

Every mechanism was broken deliberately to check that the assertion naming it
went red. Ten mutations; seven were caught immediately. The three that were not
are the useful part:

- **A fixture passing for the wrong reason.** `"I was so tired I went to bed"`
  stays one segment with the subject lookahead removed — the merge-back rule
  rescues it either way, so the assertion was testing merge-back, not the
  lookahead it was named after. Replaced with `"I'm running late so start
  without me"`, where removing the lookahead really does produce *"start without
  me"* as an errand the user is meant to perform. The code comment overstated
  the lookahead too, and was corrected to say what it actually buys.
- **An assertion that crashed instead of failing.** Removing the second reading
  threw on `cs[1].authority`, which in the real runner takes down the whole
  suite and reports nothing. A missing candidate must be a red assertion.
- **A hedge asserted in the wrong place.** The inferred-conditional hedge lives
  in `classifyOne` *and* `interpret`; only the second was asserted, leaving the
  shared classifier — which four other surfaces read — free to claim certainty.

All ten mutations are now caught.

## 3.2 Three harness bugs, one of them a repeat

- `\brule\b` does not match `"…Likely ruleConqify will not create…"`.
  `textContent` concatenates adjacent elements with no separator, so a trailing
  word boundary never matches. **This is recorded in the LIFEOS-079 report and
  this harness reproduced it anyway.**
- Two title assertions read `body.textContent`, which contains the raw capture
  because React renders a textarea's value as a child node. **One of them
  passed** — matching the user's own sentence rather than the candidate. Titles
  are now read out of the inputs.

---

# 4. Product claims (§40)

1. **Messy language reaches the right kind of record** — §1.5–§1.7's tables, now
   green: ten goal shapes, seven rule shapes, three conditional shapes.
2. **Nothing consequential is ever created silently** — swept over the whole
   corpus, not over remembered examples: no goal, rule, protocol or project
   candidate is ever pre-selected (80.103–80.105), and everything that is
   pre-selected is a cheap kind at high confidence (80.106–80.107).
3. **A recognised rule reaches Personal Code** — browser 2.5–3.11.
4. **…and is created only by the person** — `constitutionElements` empty at
   recognition and after the handoff; non-empty only after their click.
5. **A named commitment is not a held one** — browser 5.1–5.5.
6. **…and a prohibition is still a rule** — browser 5.6, the guard against the
   guard.
7. **One sentence can be several things** — browser 4.1–4.5, 6.1–6.5.
8. **The user's wording is kept** — titles asserted off the inputs; the raw
   capture is never rewritten.
9. **The model gained nothing** — `AI_PROPOSABLE_KINDS` unchanged; a
   model-proposed goal, rule or protocol is dropped (80.108–80.113).
10. **Nothing grades anyone** — swept over every string this layer can render
    (80.130, browser 7.1).

---

# 5. Limitations

- **A trailing conditional is still not a protocol.** *"I'm not going to reply
  to anything when I'm angry"* stays a note. `extractConditional` extracts the
  trailing form but no caller acts on it, deliberately — *"call me when you
  land"* is ordinary prose, not a rule — and changing that policy is a wider
  decision than this sprint. It is a known miss, not a fixed one.
- **Horizons are not detected.** By choice (§2.2). A goal from Capture has none
  until the person sets one.
- **Detection is literal throughout.** Marker lists, a subject-based conditional
  split, a fixed long-range adverb list. A sentence phrased outside that
  vocabulary falls through to a note — which is the correct failure, and the
  reason the vocabulary is in the source rather than learned.
- **The second reading is narrow.** Only a reflective sentence yields two
  candidates. Every other genuinely dual sentence relies on the one-tap
  alternates, which now include Rule on a goal.
- **Cross-device is unchanged.** No mapper, no field, no domain, no wire shape.
  Goals, protocols and constitution elements sync exactly as they did before
  this sprint.

---

# 6. Verdict

**LIFEOS-080 COMPLETE — CAPTURE INTELLIGENCE READY.**

No migration. Repository migration head unchanged at **0047**. All final gates
green.

Nothing in §42's stop list was begun: no new top-level page, no Today ranking
change, no 0048, no widening of what AI may propose, and no weakening of the
never-auto tier.
