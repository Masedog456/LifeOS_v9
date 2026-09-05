# LIFEOS-093 — Meaning Capture / Structured Reflection

**North star:** Conqify should help me preserve what a day meant without making
me complete a journal.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
