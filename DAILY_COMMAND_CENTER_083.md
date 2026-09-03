# LIFEOS-083 — Morning Brief / Daily Command Center

**North star:** open Conqify and understand your day in under 30 seconds.

## STATUS: COMPLETE — DAILY COMMAND CENTER READY

| | |
|---|---|
| Base SHA | `b4b2c0d1988c3912a362782efbb342a23a5fa8ac` (PR #88 merged) |
| Branch | `claude/lifeos-083-morning-brief-command-center` |
| Migration | **none** — composition and UI only |
| Repository migration head | **0047**, unchanged |
| Chosen surface | **Today**. Home stays capture; no new route. |

---

# 1. The audit (§2)

Produced by **running the product** at two viewports with two realistic
fixtures — a dense day (advisor meeting at 09:00, an overdue application, a
statement due today, an action deferred three times, a follow-up due today, a
blocked action, a goal horizon that moved yesterday, a rule retired yesterday)
and a genuinely calm day (one task due in four days). Screenshots reviewed, not
just DOM counts.

## 1.1 A — What the user currently sees first

**On mobile, one thing: an onboarding checklist.**

```
### dense / mobile
  above the fold: ["Getting started 2/8"]
### dense / desktop
  above the fold: ["Getting started 2/8", "Daily review"]
```

The first phone screen is two rows of navigation, a greeting, a paragraph of
explanatory prose, and an eight-item **"Getting started"** card. The advisor
meeting at 09:00, the overdue application and the follow-up due today are all
below the fold. The order in `app/today/page.tsx` is literally:

```
header → <FirstRun/> → tour invite → TodayReviewCard → TodayCommandCenter
```

so three pieces of scaffolding outrank the day itself.

## 1.2 B — How many places to understand the day

| Question | Where it is answered today |
|---|---|
| What is fixed today? | `/today` → Today section |
| What should I do next? | `/today` → Suggested next |
| What deserves attention? | `/today` → Needs attention *(commitment signals only)* |
| **What should I focus on?** | **`/memory`** — the 082 shortlist, invisible on Today |
| **What changed?** | **`/memory`** — 081's changes, invisible on Today |
| What am I waiting on? | `/today` → Waiting |
| What can wait? | nowhere |

**Two surfaces minimum, and the two newest capabilities are on the wrong one.**

## 1.3 C — Sections that duplicate each other

**Two different "Needs attention".** `TodayCommandCenter` renders one from
commitment signals; `app/today/page.tsx` renders a `Card title="Needs attention"`
from `view.activeRecs` (orchestrator recommendations). Same heading, different
evidence, same page.

## 1.4 D — Which builder already answers each north-star question

Every one of them exists. None is missing.

| Question | Builder | On Today? |
|---|---|---|
| Fixed today | `buildTodayView` → `occurrences`, `dueToday`, `recurringToday` | yes |
| Next | `recommendNextAction` (072) | yes |
| Attention | `buildAttentionShortlist` (082) | **no** |
| Changed | `buildExecutiveChanges` (081) | **no** |
| Waiting | `buildTodayView` → `waiting` | yes |
| Tomorrow | `buildDailyExecutiveView` → tomorrow preview | on `/today/review` only |

## 1.5 E — Noisy sections

`app/today/page.tsx` carries **twelve** legacy `Card` sections from LIFEOS-025's
knowledge-work era, each gated on `show={…length > 0}`:

```
Pinned · Needs attention · Continue thinking · To review · Continue
Active research · Open decisions · Due for review · Practice
Recent captures · From your memory · Reflection prompts · Recently completed
```

Plus `TodayCommandCenter`'s seven. **Nineteen possible sections on one page**,
against §6's budget of five. On the executive fixtures most stay hidden — but
they are hidden by *emptiness*, not by design, and a user who also uses the
knowledge features gets all of them.

**"Recently completed" is a section on the main command center**, which §21
forbids outright.

## 1.6 F — Facts missing from the opening experience

- **The 082 attention shortlist.** Its own report flagged this: *"the shortlist
  is reachable through Memory only."*
- **"Since yesterday."** The fixture's goal horizon moved `Near → Medium`
  yesterday and a rule was retired yesterday. Neither appears anywhere on Today.
- **"What can wait."** Nothing grounds a calm line.

## 1.7 G — Home or Today?

**Today.** Home is the capture surface (LIFEOS-060) and works; `/today` already
*is* the command center — `TodayCommandCenter` is named that. Moving the brief
to Home would create a second daily surface, which §4 forbids. The work is to
fix what Today shows first, not to build somewhere new.

## 1.8 H — The smallest composition layer

One pure `buildDailyCommandView(state, ix, today, now)` that **composes**
`buildTodayView`, `recommendNextAction`, `buildAttentionShortlist`,
`buildExecutiveChanges` and the existing tomorrow preview, applies a stated
dedup precedence, and returns at most five sections. No new ranking.

## 1.9 I — No new persistence

Confirmed. Every input is already derived. Nothing needs storing.

## 1.10 J — What to remove or collapse

This is the larger half of the sprint:

1. **Move `FirstRun` and the tour invite below the day.** The single biggest
   first-viewport offender.
2. **Collapse the twelve legacy Cards** into one compact "More" block.
3. **Delete the duplicate "Needs attention"** Card (`view.activeRecs`).
4. **Remove "Recently completed"** from the active surface (§21).

## 1.11 Measured red proofs (§31)

| # | Claim | Measured |
|---|---|---|
| 1 | Multiple surfaces needed | Attention and Changes live on `/memory`; fixed/next/waiting on `/today` |
| 2 | 082's shortlist not visible on the daily surface | Confirmed — no call site outside Memory |
| 3 | Duplicate sections exist | Two "Needs attention" headings on one page |
| 4 | Mobile first viewport fails the three core questions | Above the fold: `["Getting started 2/8"]` only |
| 5 | A calm day renders unnecessary structure | Calm mobile = **2.0 screens**; first screen is onboarding + tour + "1 item needing attention" for a task due in four days |

All five are genuinely red. None is invented.

## 1.12 Migration (§30)

**None.** Composition and UI only.

---

# 2. What was built — and what was removed

The larger half was removal.

| Change | Where |
|---|---|
| The day renders **before** the scaffolding | `app/today/page.tsx` |
| Second "Needs attention" heading **deleted** | `app/today/page.tsx` |
| Pinned / Continue thinking / To review moved behind the existing disclosure | `app/today/page.tsx` |
| Instructional paragraph trimmed to the ⌘K hint | `app/today/page.tsx` |
| The composition layer | `lib/today/command.ts` |
| Attention shortlist + "Since yesterday" rendered | `components/today/TodayCommandCenter.tsx` |

**No new route** (§4). **No new persistence** (§30). `recommendNextAction`,
`buildTodayView`, `buildCommitmentSignals` and `COMMITMENT_ORDER` are all
untouched.

## 2.1 The measured result (§17)

| | before | after |
|---|---|---|
| dense / mobile, above the fold | `["Getting started 2/8"]` | `["Suggested next", "Today"]` |
| dense / desktop, above the fold | `["Getting started 2/8", "Daily review"]` | `["Suggested next", "Today", "Needs attention", "Since yesterday"]` |
| calm / mobile | 2.0 screens | 1.9 screens, and the attention section is gone |
| calm / desktop | 1.5 screens | 1.4 screens |

The first phone screen now carries the orientation line (`1 event · 2 to fit in
· 4 items needing attention`), the 9 AM meeting, the recommendation with its
reasons and its goal ancestry, and the start of the Today list. §17's three
questions are all answered without scrolling.

## 2.2 Section composition (§6)

`TodayCommandCenter` renders, in order: orientation → NOW → **Suggested next** →
**Today** → **Needs attention** → **Since yesterday** → **Waiting** → what can
wait → Project pulse → Worth returning to → Upcoming. Every one hides itself
when empty (§6's "no empty-section graveyard"), which is why the calm day shows
five headings and the dense day ten.

## 2.3 Dedup precedence (§22, §23)

Stated in `lib/today/command.ts` and asserted:

1. **NEXT** wins the primary recommended action.
2. **FIXED** wins anything on today's schedule.
3. **ATTENTION** suppresses its own card — and its explanation moves onto the
   winning row as an inline reason.

Clause 3 is what makes it safe: §23 warns against hiding evidence, and nothing
is hidden. Suppression is recorded in `suppressed` with which section won, so a
test can assert the rule rather than the outcome.

**One refinement came from looking at the page rather than the tests.** The Next
card lists its own reasons, so moving the suppressed card's sentence there
printed *"Was due Tue, Sep 1"* twice on one card. `alreadySaid` now checks
whether the winning row already carries the sentence — and only the Next row
can, since a schedule row shows a date and nothing else.

## 2.4 Attention integration (§9)

The LIFEOS-082 shortlist shipped reachable only through Memory; its own report
said so. It is now what the "Needs attention" section renders — capped at three,
suppression applied, and reaching facts the raw signal layer never had. A
repeatedly deferred action appears with *"You deferred this 3 times."*

Rows with a signal behind them use LIFEOS-071's resolutions; a `repeated_deferral`
row has no `CommitmentKind`, so it uses `resolutionsForAction` — LIFEOS-072's
split, reused rather than re-invented.

## 2.5 Recent change (§11)

`SINCE_YESTERDAY_KINDS` is ten kinds and deliberately short: what **finished**,
what **stopped waiting**, and what **changed direction**. Adding a task
yesterday is not news; a deferral is already represented by the item still being
open; a typo edit was never a change at all. Capped at three, newest first.

## 2.6 What can wait (§14)

Exactly two sentences are possible, both arithmetic:

```
"Nothing is due today."                        (+ "N open items are scheduled later.")
"N open items are scheduled later."
```

There is no third, and no sentence that names something to skip — `calmLine` has
no notion of importance with which to try. On a busy day with nothing scheduled
ahead it renders **nothing** rather than reaching for something reassuring.

## 2.7 Today ordering preserved (§39.10)

No file under `lib/today/` that decides order was modified.
`recommendNextAction` is asserted to return the same action before and after
composing the view (83.39), and the schedule is asserted to be the view's own
(83.40).

---

# 3. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `npm run build` | clean · 0 errors · exit 0 |
| Deterministic selftests | **4809/4809** across 47 suites |
| …of which new this sprint | **55** (`lib/today/command-selftest.ts`) |
| `smoke-083-command-center.cjs` (browser, 2 viewports) | **77/77** |
| `smoke-082` · `smoke-081` · `smoke-080` · `smoke-079` · `smoke-078` · `smoke-076` | 64/64 · 72/72 · 109/109 · 97/97 · 93/93 · 281/281 |
| `inject-077` · `inject-078` | 51/51 · 43/43 |
| `release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

**Performance (§35).** Composition at 100 / 1,000 / 5,000 actions inside a
3000ms budget asserted in the suite; 20 calm-line builds over 5,000 actions
under 1500ms. The view is passed in rather than rebuilt, so the index pass is
paid once per render.

**Accessibility (§36).** Asserted on the page: exactly one `h1`, every section
heading meaningful, every control labelled, every link non-empty, and the
recommendation keyboard-focusable (browser 10.1–10.5).

## 3.1 Screenshots reviewed (§33)

Desktop and mobile × dense and calm, before and after, at
`/tmp/shots083`, `/tmp/shots083after`, `/tmp/shots083final`. **Two defects were
found by looking rather than by asserting:**

- the duplicated *"Was due Tue, Sep 1"* on the Next card (§2.3);
- three lines of instructional prose above the day, every day.

Neither would have been caught by a DOM assertion, because both were correct
markup saying the same thing twice.

## 3.2 Mutation testing (§34)

Ten mutations. Nine caught; **the escape was the "since yesterday" cap** —
invisible because the fixture happened to produce exactly three qualifying
changes, so `<= 3` passed whether or not the slice existed. Over-supply fixtures
now give six changes and six attention items, assert an exact count of three,
and name **which end** is kept, so a cap that kept the oldest also goes red.

## 3.3 Two harness bugs

Both were assertions over-reaching, not product defects:

- counting *"Was due"* across the whole Next card also counted LIFEOS-072's
  counterfactual, which legitimately repeats the date in a different sentence.
  Now asserted on the `[data-inline-reason]` element, which is what 083 controls.
- sweeping the page for *"skip"* matched the onboarding card's **Skip** button.
  Now scoped to the calm line itself.

---

# 4. Product claims (§39)

1. **Fixed today is answered** — browser 1.3, 1.4.
2. **One grounded Next action** — browser 2.1, 2.3.
3. **ExecutiveAttention is visibly integrated** — browser 3.1–3.3.
4. **Recent change without opening Memory** — browser 5.1–5.3.
5. **Waiting appears only when useful** — browser 4.1, 4.2.
6. **Personal Code only as grounded context** — browser 3.4.
7. **Duplicates suppressed across sections** — 83.5–83.10, browser 2.2, 2.4.
8. **Calm days stay calm** — 83.27–83.33, browser 8.1–8.6.
9. **Mobile orients quickly** — the before/after table in §2.1.
10. **Today ordering not rewritten** — 83.39, 83.40.
11. **No new score** — 83.41.
12. **No migration or persistence noun** — none added.

---

# 5. Known gaps

- **The orientation line counts more than the section shows.** It says
  *"4 items needing attention"* while the capped, deduplicated section shows at
  most three. Both are true — one summarises the day, the other is a shortlist —
  but a careful reader can notice the difference. Fixing it means changing
  LIFEOS-073's `buildDailyExecutiveView` summary, which 128 assertions sit on,
  and the benefit did not justify that here.
- **Tomorrow is not on Today** (§29). The tomorrow preview remains on
  `/today/review`. Today already ends with "Upcoming", which covers the next
  seven days including tomorrow, so adding a tomorrow section would be the
  duplicate surface §22 warns about.
- **Two composition layers still exist** — `buildTodayView` for Today and
  `buildDailyExecutiveView` for Daily Review. They agree, and neither was
  rewritten. Consolidating them is a separate sprint.
- **No AI is used** (§26). Deterministic text was sufficient.

---

# 6. Verdict

**LIFEOS-083 COMPLETE — DAILY COMMAND CENTER READY.**

No migration. Repository migration head unchanged at **0047**. All final gates
green.

Nothing in §41's stop list was begun: no 0048, no Collections, People or
Calendar expansion, no D-8, no general D-23, no Observatory, no notification
engine, no ambient capture, no autonomous scheduling.
