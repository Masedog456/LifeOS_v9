# LIFEOS-093 — Meaning Capture / Structured Reflection

**North star:** Conqify should help me preserve what a day meant without making
me complete a journal.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `4269899119a5d469a7bebfd73ec3b86ad1f1d96e` (PR #98 merged) |
| Branch | `claude/lifeos-093-meaning-capture` |
| Migration required | **no** — the existing `Reflection` carries it (§8) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the real builders. A store with a reflection written today
about today, a reflection written today **about yesterday**, and a completed
`DailyReview` from August carrying a win, a lesson and a friction.

Probe: `scratchpad/probe93.cjs`.

## 1.1 A — What structured meaning the old review held

`DailyReview` carries `summary`, `wins[]`, `lessons[]`, `friction[]`,
`openLoops[]`, `tomorrowFocus[]`, `notes`, and typed links to goals, projects,
workspaces and entities.

## 1.2 B, C — What survives, and what can still be written

**All of it survives in persistence.** LIFEOS-092 removed the *writer*, not the
record. Measured:

```
dr1  wins=1  lessons=1  friction=1
reviewCounts: {"wins":1,"lessons":1,"friction":1,"openLoops":0,"focus":0}
```

`ReviewHistory`, `ReviewActivity` and `weekly-rollup` all still read them, so
§9's "keep it readable" and §10's "no data loss" hold today with no work.

**Readable but unwritable:** `summary`, `wins`, `lessons`, `friction`, `notes`.
That is the capability loss this sprint answers — and it is answered by giving
the user a place to write meaning, not by restoring the wizard that wrote it.

## 1.3 D, E, F — The canonical reflection path

`addReflection({ prompt, response, context })` → a `Reflection`:

```ts
interface Reflection {
  id: string;
  prompt: string;          // the question asked
  response: string;        // the user's words, immutable
  createdAt: ISO;
  context?: string;        // "Optional mood/context the user attached"
  annotations: ReflectionAnnotation[];
  beliefIds?, threadIds?, sourceIds?: string[];
}
```

**The prompt is already a field.** §7's `ReflectionPromptKind` needs no schema:
several prompts are several reflections, each carrying the question it answered.
That is the fallback §7 names, and it is available today.

**Provenance is structural.** `classifyOrigin({ kind: "reflection" })` returns
`user_authored` because a reflection is a thing the user typed — and an
attribution marker in the text still wins, so machine prose saved into one is
reported as machine prose. Search already says "You wrote this" (assertion
85.42c). §12 holds with no work.

## 1.4 G — Can a reflection link to a Goal or Project?

**No.** The record's fields are `id, prompt, response, context, createdAt,
annotations`, plus optional `beliefIds` / `threadIds` / `sourceIds`. There is no
goal ref, no project ref, and no free-form `linkedEntityRefs`.

§18 and §19 are conditional — *"where current relationship model supports
that"* — and it does not. Misusing `sourceIds` (which means knowledge sources)
to hold a goal id would be a lie in the schema, and §8 forbids a migration by
default. So explicit reflection→Goal linkage is **out of scope and recorded as a
gap**, not faked and not migrated.

## 1.5 H, I — Freeform vs structured, and what stays dead

**Structured:** the prompt (which question), and the reviewed day.
**Freeform:** everything the user types.

**Not resurrected:** the stepper, the `not_started → in_progress → completed`
lifecycle, the DailyReview writers, the open-loops picker and the tomorrow-focus
list. LIFEOS-092 retired those for reasons that have not changed.

## 1.6 The reds

### RED 1 (§13, §14) — the reviewed day is written and never read

LIFEOS-091 already passes `context: date` when saving. **Nothing reads it.**
Measured:

```
Evening Close for 2026-09-09 : ["r-today", "r-about-yest"]
Evening Close for 2026-09-08 : []

timeline: r-about-yest  day=2026-09-09  evidence=reflection.createdAt
          (its context says 2026-09-08)
```

A reflection written at 22:00 about yesterday appears on **today's** review and
is absent from the day it is about. `context` is a write-only field: recorded,
synced, exported, and consulted by nothing. Grep confirms no reader anywhere.
**Confirmed.**

### RED 2 (§16) — Memory has no words for meaning

A `REFLECTION` question class already exists and works — *when given a topic*:

```
"what did I say about philosophy?"  → "1 record you wrote mentions “philosophy”."
```

But every meaning question the brief names falls through to the generic
capability line with no evidence at all:

```
"what did I learn this week?"              → capability line, evidence []
"what mattered today?"                     → capability line, evidence []
"what was difficult?"                      → capability line, evidence []
"what am I realizing?"                     → capability line, evidence []
"what decisions did I want to remember?"   → capability line, evidence []
```

Two causes, and both matter: the router's reflection vocabulary has no
`learn` / `matter` / `difficult` / `realise` / `decide`, and the class is
**topic-scoped**, so even a routed but topicless question — `"what did I write
today?"` — finds nothing though two reflections were written that day.
**Confirmed.**

### RED 3 (§38.2) — one generic prompt

The Evening Close offers exactly one: *"Anything about today worth
remembering?"*, and only for today. There is no way to say what mattered, what
was learned, or what was hard. **Confirmed.**

### RED 4 (§38.1) — the structured fields have no writer

By design, from LIFEOS-092. Restated here as the capability this sprint is
answering. **Confirmed.**

## 1.7 Not reds — measured, and kept as forward guards

* **§38.5 Search finds reflection text** and marks it `user_authored`; measured
  on "philosophy".
* **§38.6 No duplication.** A reflection appears once in the Evening Close,
  under "In your own words", and nowhere else on the page.
* **§9, §10 historical structured content is readable** and counted.
* **§12 provenance is structural** and needs no new rule.
* **§24, §36 there is no sentiment or streak anywhere** to remove.

## 1.8 J — The smallest layer

1. **A small prompt set**, three at most visible, written through
   `addReflection`. Several prompts are several reflections; the prompt field
   carries which question. No new record type, no new writer.
2. **Make `context` readable.** One derivation — the autobiographical timeline —
   prefers an explicit reviewed-day context *when it is a valid day key*, and
   falls back to `createdAt` otherwise. Because Evening Close, Week Review and
   Memory all read that one timeline, they agree by construction (§32, §33).
   An old reflection whose context says "tired" is untouched.
3. **Teach the existing `REFLECTION` class the meaning verbs**, and let a
   time-scoped reflection question answer from the range. One class, more
   aspects — §16's stated preference — rather than six new Memory nouns.

## 1.9 Migration (§8)

**None.** The prompt is a field, the reviewed day is a field, and the only work
is to start reading one of them. Head stays at **0047**; `0048` is not written.

---

# 2. The model (§7, §35)

`lib/reviews/meaning.ts`. No new record type, no session, no completion state.

```
Reflection.prompt    which question was answered   → the prompt kind
Reflection.response  the user's words, immutable   → the meaning
Reflection.context   the day under review          → §13's reviewed day
Reflection.createdAt when it was typed             → untouched
```

Six prompt kinds — `mattered`, `learned`, `difficult`, `realization`,
`decision`, `remember` — carried by the prompt TEXT, which is what persists.
`promptKindOf` reads a stored reflection back into a kind, including LIFEOS-091's
older single prompt, and returns `null` rather than guessing for anything else.

# 3. Prompts (§5, §6, §26)

Three offered; three more behind one press; **one composer open at a time**.

```
[ What mattered ] [ What you learned ] [ Worth remembering ]   Another prompt
Optional. One sentence, or nothing at all.
```

Six textareas on arrival IS the wizard, in one column instead of seven steps.
Choosing a prompt is a chip press; being confronted with six empty boxes is not.

The language is plain (§6): no "describe your emotional state", no "rate the
quality of your day", no "what limiting beliefs arose". `MEANING_FORBIDDEN_WORDS`
is swept over every string the layer produces, and mutation **M12** — replacing
one prompt with a mood rating — reddens three assertions.

# 4. Date semantics (§13, §14)

**The audit's sharpest red.** LIFEOS-091 already wrote `context: date` on every
reflection and **nothing read it**, so a reflection typed at 22:00 about
yesterday appeared on today's review and was absent from the day it was about.

`reflectionDayKey` decides this in one place, and conservatively:

* an explicit context wins **only when it is a valid day key**, so an older
  reflection whose context reads "on the train" still falls back to `createdAt`
  (mutation **M2**);
* the recorded instant is **never restamped** — `at` stays exactly what it was,
  and only the day the reflection is filed under moves (**M4**);
* `evidence` names which field decided: `reflection.context` or
  `reflection.createdAt` (**M5**).

Because Evening Close, Week Review and Memory all read the one timeline, they
agree by construction (§32, §33). And the card says "Written Sat, Sep 5" when
the two differ, rather than hiding one behind the other.

A past day is **read-only**: you cannot add meaning to a day you are only
looking at, which is why no prompts are offered there.

# 5. Provenance (§12, §34)

Structural and unchanged. `classifyOrigin({ kind: "reflection" })` returns
`user_authored` because a reflection is something the user typed, and an
attribution marker in the text still wins, so machine prose saved into one is
reported as machine prose. Search says "You wrote this Sat, Sep 5" (browser 43).
An AI-authored note never appears under "In your own words" (browser 30–31).

# 6. Memory and Search (§16, §17)

A `REFLECTION` question class already existed and worked — *when given a topic*.
Every meaning question fell through to the generic capability line:

```
before  "what did I learn this week?"  → capability line, evidence []
after   "what did I learn this week?"  → What you wrote · Sep 7 – Sep 9
```

The fix reuses LIFEOS-081's own `TOPICLESS_TERMS` mechanism, built for exactly
this. My first attempt reached for the wrong hook — adding the meaning words to
the framing-verb stripper, which deleted them entirely and left no term at all.

The whole-string lookup then broke on the multiword remnants these questions
produce ("decisions i want remember"), so the test is per word and conservative
in the direction that matters: topicless only when **every** word is frame or
filler and at least one is a real frame word. `"what did I say about
philosophy?"` still searches for philosophy (**M16**, **M17**).

Search needed no work at all — it already indexed reflections and attributed
them correctly.

# 7. Goal and Project context (§18, §19)

**Not implemented, and not faked.** A `Reflection` has no goal ref, no project
ref and no free-form entity refs. §18 and §19 are conditional — *"where the
current relationship model supports that"* — and it does not. Misusing
`sourceIds`, which means knowledge sources, to carry a goal id would be a lie in
the schema, and §8 forbids a migration by default. Recorded as a gap below.

What IS proven is the safety half: a decision written as prose mutates no goal
and creates no rule (browser 32–34, assertions 93.45–93.49).

# 8. What it refuses to infer (§21, §22, §23, §24, §25)

* *"I decided not to apply to law school."* → a reflection. No goal moves.
* *"I need to stop replying when angry."* → a reflection. No standard is created.
* *"Writing the statement felt impossible."* → stored exactly as written. Nothing
  on the page says avoidance, anxiety, burnout or struggling.
* No sentiment, no mood, no score, no streak, no generated summary of the day's
  themes.

# 9. Visual findings (§41)

**V1 — the date twice.** On a past day the heading reads "Review Friday, Sep 4"
and the subtitle repeated "Fri, Sep 4" one line below. The subtitle now earns
its place only when the heading says "today".

**V2 — 251 cards.** The performance run at 5,000 records rendered every
reflection for the day, unbounded, while the close's own list is capped at three.
Bounded at six — one answer per prompt, a real ceiling — with the remainder
counted rather than dropped.

**V3 — notes vanished.** Caught by LIFEOS-091's suite, not by me: the old "In
your own words" rendered the close's user-authored words, which includes notes;
my component rendered only prompt answers. The section is about what the person
wrote, not which record type they wrote it into. Notes are back, and excluded
from the card list they already appear in.

**Checked and clean:** no textarea wall, no repeated prompts, no journal
heaviness, no duplicate cards, and no copy that pressures anyone to write.

# 10. Performance (§42)

```
                render      prompt opens    save settles
n=  100         217ms       88ms            96ms
n= 1000         242ms       68ms            181ms
n= 5000         907ms       92ms            757ms
```

The 092 baseline was 189 / 297 / 945ms. Meaning capture is at or slightly below
it. A prompt opens in ~90ms at every size; the save at 5,000 is dominated by the
store's own persist. Two thousand reflections filter in under 100ms
(assertion 93.51).

# 11. Known gaps

1. **A reflection cannot be linked to a Goal or Project.** The record has no
   field for it. §18 is conditional on the relationship model supporting it,
   §8 forbids a migration, and misusing `sourceIds` would be a lie in the
   schema. So §20's capture-context suggest-confirm flow has nothing to attach
   to either, and neither is implemented.
2. **Past days are read-only.** You can read what you wrote about Friday but not
   add to it. That is a deliberate choice about what "reviewing a past day"
   means, not a limitation — but a person who thinks of something on Sunday
   about Friday currently has nowhere to put it.
3. **A reflection cannot be edited or deleted from this surface.** §28 says
   capture first; `Reflection.response` is immutable by design and annotations
   are append-only, so editing would need its own decision.
4. **Old wins / lessons / friction still have no writer.** They stay readable at
   `/daily/history`, and the meaning prompts are the replacement — but a person
   who wants three separate lists of wins no longer has them.

# 12. Gates (§44)

| Gate | Result |
|---|---|
| Deterministic — full regression | **5825/5825** across 57 suites, none failing |
| `reviews/meaning` selftest | **74/74** |
| §39 browser torture (093) | **57/57** |
| §40 mutation proofs | **17/17 caught**, 0 escapes, 0 patch failures |
| 081 memory / 083 morning / 084 week | 72/72 · 77/77 · 62/62 |
| 085 search / 089 capture context | 54/54 · 66/66 |
| 090 replanning / 091 evening / 092 consolidation | 69/69 · 87/87 · 59/59 |
| `release:audit` | PASS 17/17 · migration count 47, nothing beyond 0047 |
| `release:routes` | PASS 24/24 |
| `release:export` | PASS 14/14 |
| `audit:security` | PASS — RLS, secrets, routes, auth, deps |
| `tsc --noEmit` | clean |
| `eslint` | 0 errors (2 pre-existing warnings in unrelated files) |
| `next build` | clean |

# 13. The twelve claims (§46)

1. **Useful with zero reflection** — browser 1–3; 93.53, 93.54.
2. **Minimal effort** — a chip and a sentence; browser 4–7.
3. **Multiple reflections save independently** — browser 14–16; §27.
4. **User-authored and correctly attributed** — browser 43 ("You wrote this");
   §12 is structural.
5. **Past-day reflections attach to the reviewed day** — browser 26–29;
   93.17–93.29; M1–M5.
6. **They appear in Memory and Week Review** — browser 39–41; 93.36.
7. **Search retrieves them** — browser 42.
8. **Goal/Project linkage requires confirmation** — not implemented, because the
   schema cannot represent it; §7 and §11 above.
9. **No automatic Goal mutation** — browser 32–34; 93.45, 93.46.
10. **No diary, mood scoring, streaks or journal subsystem** — browser 12, 37,
    38; M11, M12.
11. **Historical structured content readable** — 93.41–93.44.
12. **No migration** — head stays 0047.
