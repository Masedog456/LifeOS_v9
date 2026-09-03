# LIFEOS-083 — Morning Brief / Daily Command Center

**North star:** open Conqify and understand your day in under 30 seconds.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `b4b2c0d1988c3912a362782efbb342a23a5fa8ac` (PR #88 merged) |
| Branch | `claude/lifeos-083-morning-brief-command-center` |
| Migration required | **no** — composition and UI only |
| Repository migration head | **0047**, unchanged |

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

*Sections 2 onward are written as the implementation lands.*
