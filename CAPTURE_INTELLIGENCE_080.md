# LIFEOS-080 — Capture Intelligence for Goals + Personal Code

**North star:** tell Conqify what's happening in normal language, and it should
know what kind of thing it might become.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `9b890b2be611319f55cda0730e337d4737b81ac2` (PR #85 merged) |
| Branch | `claude/lifeos-080-capture-intelligence-goals-code` |
| Migration required | **no** — see §2.11 |
| Repository migration head | **0047**, unchanged |

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

*Sections 2 onward are written as the implementation lands.*
