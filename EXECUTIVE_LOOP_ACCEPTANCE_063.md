# LIFEOS-063 — Executive Loop Acceptance

**Does Conqify materially reduce the cognitive work of running a real day?**

Sprint: LIFEOS-063 · Branch: `claude/lifeos-063-executive-loop-acceptance` · Base: `1cf021c`
Method: deterministic replay of a seven-day dogfood script through the real pipeline, a browser
smoke over the real UI, and code inspection. No external testers. No telemetry added.

---

## 1. Executive verdict

**Partially accepted.**

The loop closes. A messy sentence becomes the right records, Today assembles them into a page
that is worth opening, one grounded suggestion comes out of it, acting recomputes, and a quiet
day stays quiet. Across the seven-day replay the user spent **58 interactions**, of which
**9 (16%)** happened anywhere other than Capture and Today. Today needed **zero** interactions
to be correct on any day — it is a projection, and it was right every day without being
maintained. That is the thesis working.

What stops this being a full acceptance is not a missing feature. It is that the product
**says things that are not true** on the surface it wants you to live in, and **silently drops
things it just told you it had understood**:

- Today rendered *"You're all caught up. 🌿 Nothing is waiting on you right now."* on the same
  screen as three overdue actions, a due follow-up and two appointments. Proven in the browser
  (smoke A10).
- "Take my medication every day at 8" showed **08:00** on the confirmation screen and stored no
  time at all. Proven in the browser (smoke B4).
- "Team standup every weekday at 9:15" became a **one-off event on the day it was typed**, with
  the words "every weekday" left sitting in its title and **no disclosure** that the recurrence
  had been dropped — the exact collapse LIFEOS-061 was built to prevent.

Those three are repaired in this sprint (§19). Everything else is documented and deferred.

The honest summary of where the product stands: **Conqify is now genuinely good at "what is
happening today" and genuinely unable to answer "what happened this week."** It has become a
working present tense with no past tense.

---

## 2. Audit of main (§4)

| | |
|---|---|
| Current main SHA | `1cf021c` (merge of PR #65) |
| LIFEOS-060 merged | `c1f36bf` (PR #63) — feature commits `650e534`, `7a673f7` |
| LIFEOS-061 merged | `90ff49c` (PR #64) — feature commit `842013e` |
| LIFEOS-062 merged | `1cf021c` (PR #65) — feature commit `580476c` |
| Store domain count | **46** (`STORE_DOMAINS` / `EXPORT_DOMAINS`, identical order, append-only) |
| Migration head | **0040** `0040_time_foundation.sql` (40 migrations, 62 public tables) |
| Test-suite count | **29** selftest suites, 2627/2628 assertions on unmodified main |
| Today sections | NOW · SUGGESTED NEXT · TODAY · NEEDS ATTENTION · WAITING · PROJECT PULSE · RETURN · UPCOMING |
| Capture path | Inline on `/` — `CaptureComposer` → `interpret()` → confirm → `commitCapture()`. No `/process` detour. |
| Time semantics | `dueDate` (day) + `dueTime` (`HH:mm` wall clock, no timezone) + `LifeEvent` (happens, no status) + recurrence as a derived rule with persisted per-occurrence completions |

The one failing assertion on unmodified main is the pre-existing marginal wall-clock budget in
the `memory` suite (~1520–1700ms against a 1500ms ceiling). It fails identically on `main` and
was **not** weakened here.

---

## 3. How the evidence was produced

Three instruments, all committed or reproducible:

| Instrument | What it is |
|---|---|
| `lib/dogfood/scenario.ts` | The seven-day script as data — captures, acts, and the eight §19 capture probes. |
| `lib/dogfood/replay.ts` | Runs it through `interpret → toCommitCandidate → commitCapture → buildTodayIndexes → buildTodayView → recommendNextAction`. Nothing is simulated. |
| `lib/dogfood/ops.ts` | A thin adapter onto the real store functions, which **refuses to construct in a browser** — the replay wipes the store, and a comment is not a fence. |
| `smoke-063.cjs` (scratchpad) | 30 assertions driving the real UI in Chromium against the replayed week. |

**No telemetry was added** (§6). No beta event system, no analytics, no evidence logger, no new
store domain, no new route. `lib/dogfood/*` is a developer-only fixture that no running code
path reads.

### The two clocks, stated rather than hidden

The script names absolute dates in a fixed week (Mon 2026-03-02 → Sun 2026-03-08) so that
"tomorrow", "Thursday" and "every Tuesday" resolve identically on every run. But three product
behaviours read a *stored timestamp* rather than the day being asked about — `alsoToday`
(`createdAt`), `waitingDays` (`waitingSince`), and a recurring action's occurrence anchor
(`dueDate ?? createdAt`). With a fixed script date and a real machine clock those three come out
wrong, and none of that is a defect.

So the replay takes an `anchor` and is run twice: once on the fixed week, once starting from the
real today. **Anything that fails under both passes is a product finding. Anything that fails
only under the fixed week is this paragraph.** Two suspected defects — a recurring action
stopping to a date five months away, and a waiting item reporting "0 days" — were caught by that
discipline and are *not* reported below, because they are artifacts of the fixture.

---

## 4. Seven-day scenario results

Interaction counts are derived from `CaptureComposer`, not estimated: typing is one, pressing
**Capture** is one, pressing **Confirm** is one, and each correction (untick, kind switch,
reaching for "Keep the whole thing as a note") is one more.

| Day | Scenario | Interactions | Away from Capture/Today | Today sections rendered |
|---|---|---:|---:|---|
| 1 | Messy intake | 10 | 0 | TODAY · UPCOMING |
| 2 | Real-time change | 4 | 0 | TODAY · WAITING · UPCOMING |
| 3 | Recurrence | 14 | 1 | NOW · SUGGESTED · TODAY · WAITING · UPCOMING |
| 4 | Waiting + blocked | 9 | 5 | SUGGESTED · TODAY · WAITING · PULSE · UPCOMING |
| 5 | Dense day | 17 | 3 | all eight |
| 6 | Quiet day | 4 | 0 | *(empty state)* |
| 7 | Review the week | 0 | 0 | SUGGESTED · TODAY · ATTENTION · WAITING · PULSE · RETURN · UPCOMING |
| | **Week** | **58** | **9 (16%)** | |

### Day 1 — messy intake (§8)

> *"I have class tomorrow at 11, need to finish the deployment tonight, buy dog food, call my
> advisor, and I'm still unsure whether teaching is the right direction."*

One sentence, five intents, **three interactions**, five candidates, four confirmed:

| | Read as | Kept |
|---|---|---|
| "I have class tomorrow at 11" | **Event** | date `2026-03-03`, time `11:00` |
| "need to finish the deployment tonight" | **Action** | "tonight" reported as unstorable, kept in the text |
| "buy dog food" | **Action** | — |
| "call my advisor" | **Action** | — |
| "I'm still unsure whether teaching…" | **Note** *(offered, unticked)* | "Reads as a reflection — kept as a note unless you'd rather file it." |

This is the sprint's strongest single result. Five different kinds of thing, no module chosen by
the user, no form filled in, the original sentence preserved verbatim, and the one item that
carries a claim about the user's inner life is offered rather than assumed.

**Answers to §5:** (A) one sentence. (B) an event, three actions, a reflection, one date, one
time. (C) all of it — Today and Upcoming updated with zero further input. (D) nothing. (E) n/a.

Two blemishes, both real. "Return the library books by Thursday" became an action titled
**"Return the library books by"** — the day word is stripped into the field and the preposition
that governed it is left behind (FR-9). And "Replace the kitchen tap washer" produced a
`possible` note that arrived **unticked**, so Confirm was disabled and the only way forward was
the escape hatch (FR-4). Four days later that thing could not be deferred, because it had never
become an action.

### Day 2 — real-time change (§9)

> *"I finished deployment. I didn't work out. Marcus still hasn't sent the document. Move the
> workout forward and remind me I need to email my professor tomorrow."*

Four intents. **One** was represented:

| | Read as | Verdict |
|---|---|---|
| "I finished deployment." | Note | **Cannot represent.** A completion statement does not close anything. The user still had to find the action and tick it. |
| "I didn't work out." | Note | **Cannot represent.** There is no model of a missed intention. |
| "Marcus still hasn't sent the document." | **Waiting**, `waitingOn: "Marcus"` | Correct, and it entered `waiting` immediately. |
| "Move the workout forward and remind me I need to email my professor tomorrow." | One note, resolved date `2026-03-04` **discarded** | **Cannot represent** rescheduling or reminders — *and* the genuine obligation inside it ("email my professor tomorrow") never became an action. |

Per §9 nothing was invented to make this pass. The precise boundary is: **Conqify understands
what you intend to do, and does not understand what you did, failed to do, or want moved.**
The last row is the worst of the four, because the sentence contained an ordinary obligation
with a date and the product both declined to store it and discarded the date it had resolved.

### Day 3 — recurrence (§10)

Three standing things captured, one occurrence closed, one source stopped.

| Typed | Became | Correct? |
|---|---|---|
| "Take out the recycling every Wednesday at 7" | Action, `Every Wednesday` | Rule yes — **time lost** (FR-2) |
| "Take my medication every day at 8" | Action, `Every day` | Rule yes — **time lost** (FR-2) |
| "Go to the gym every Tuesday and Thursday at 6:30" | Action, `Every Tuesday, Thursday` | Rule yes (Oxford comma handled) — **time lost** |
| "Team standup every weekday at 9:15" | **One-off Event** on the capture day, titled *"Team standup every weekday"* | **No** (FR-3) |

The parts that work, work well. Closing one occurrence did not mark the source done; the source
returned on its next occurrence; there were no duplicates (smoke B3); stopping recurrence kept
every completion and left the one outstanding occurrence as an ordinary dated action. The user
never re-created a recurring item.

The parts that fail, fail quietly. `extractRecurrence` returns `null` — not `unsupported` — for
"every weekday", "every weekend" and "weekdays", so unlike "twice a week" and "third Thursday"
(which are correctly reported as unstorable), these produce **no rule and no disclosure**, and
the event silently anchors to whichever day you happened to type it.

### Day 4 — waiting and blocked work (§11)

Every §11 requirement held:

- The blocked action ("Send the chapter to my advisor") was **never** suggested — smoke F1.
- The waiting item was **never** suggested as executable — smoke F2.
- The blocker surfaced as the project's next action, and Project Pulse said `1 blocked`.
- The follow-up came due and Today said **"Follow-up due"** — a fact, not a nudge.
- Project Pulse read *"Next: Draft the methods section by · 1 blocked"* — position, no score,
  no percentage, no "at risk" (smoke F4).

This was also the week's most expensive day: **5 of 9 interactions happened away from Capture
and Today** — creating the project, filing two actions under it, and declaring the dependency,
each on a different screen.

### Day 5 — dense day (§12)

Four events, thirteen actions, one overdue, one returned from deferral, one waiting with a due
follow-up, three projects, two recurring sources. All eight sections rendered. Asked *"what
should I do next?"*:

> **Go to the gym** — *because: Overdue by 1 day*

**One** suggestion (smoke A7). **One** grounded reason (smoke A6). The physio appointment 160
minutes away did not displace it, the two due-today items did not displace it, and no number was
invented to justify the order — overdue simply comes before due-today in a lexicographic
comparison whose every step is a sentence you could say out loud. Nothing about the suggestion
was written to the store (smoke D2).

The deferred item came back: `returned: buy dog food` appeared under NEEDS ATTENTION on exactly
the day it was pushed to. Nothing vanished.

### Day 6 — quiet day (§13)

One passing thought, nothing else. Today rendered **no sections at all** and a single prompt
pointing back at Capture. No suggestion was manufactured (smoke E2). No section rendered blank
(smoke E3). No language characterised the reader (smoke E4).

This is a genuinely good result and the easiest thing in the world to get wrong. A quiet Saturday
produces a quiet page.

### Day 7 — review the week (§14)

Asked the six questions of the surfaces that already exist, against the week the replay had just
lived through:

| Question | Verdict | Surface | Evidence |
|---|---|---|---|
| What did I complete? | **Answerable** | `/actions`, `/insights/actions` | 1 completed action + 1 closed occurrence, both timestamped |
| What remains open? | **Answerable** | `/actions`, `/today` | 10 open actions, retrievable by status |
| What am I waiting on? | **Answerable** | `/today` → WAITING | 1 waiting item with a person string and a since date |
| What happened this week? | **Unanswerable** | `/timeline`, `/insights/change-log` | 52 activity events and 4 calendar events exist; `buildInsightTimeline` returned **0** entries, because it indexes knowledge records, not a lived week |
| What did I defer? | **Partial** | `/actions` | the *current* deferral is stored; how many times something was pushed lives only in per-action history, with no surface listing it |
| What changed in my projects? | **Partial** | `/projects`, PROJECT PULSE | Pulse states the current position; nothing states the delta since last week |

Three of six answerable, and the two most human questions — *what happened*, *what did I keep
putting off* — are the ones it cannot answer.

---

## 5. Why I left Conqify (§15)

The highest-value column. Seven departures in seven days.

| Day | Why I left | Where I went | Category |
|---|---|---|---|
| 2 | Wanted to move the workout to another day. There is no rescheduling. | edited the date by hand, in a different screen | **temporal editing** |
| 2 | Wanted to be reminded to email my professor tomorrow. There is no reminder. | phone alarm | **reminders** |
| 2 | Wanted to say "I finished the deployment" and have it close. It became a note. | found the action, ticked it | **capture: completion intent** |
| 3 | The standup is a recurring meeting and Conqify recorded a one-off. | left it in the work calendar | **calendar / recurrence coverage** |
| 4 | To connect two steps and file them under a project I had to visit three screens. | stayed, but grudgingly | **maintenance burden** |
| 5 | "Dentist Thursday at 2:30" is how I write appointments. It became a note. | phone calendar | **calendar / capture** |
| 5 | "Still waiting on Priya for the quote" did not register as waiting. | texted Priya, kept no record | **People / waiting** |
| 7 | Wanted to know what happened this week. Nothing answers that. | own notes app | **autobiographical memory** |

Clustered: **calendar 2 · temporal editing 2 · memory 1 · People 1 · capture coverage 2 ·
maintenance 1.**

Notably absent: I never left because capture was slower than writing it elsewhere, and I never
left because I could not find where something went. Both were real complaints before LIFEOS-060.

---

## 6. Friction ledger (§16)

Severity is not inflated. P0 is reserved for data loss, privacy and security; nothing here is
P0, because the raw capture is always preserved and every value discussed below remains
recoverable from the sentence the user typed.

| # | Sev | Scenario | Intention | What happened | Freq | Workaround | Root cause | Fix | Owner |
|---|---|---|---|---|---|---|---|---|---|
| **FR-1** | **P1** | Every day with content | Read Today | Page renders *"You're all caught up. Nothing is waiting on you right now"* beside overdue work, a due follow-up and two events | every render | ignore it | `app/today/page.tsx` keeps a second empty-state panel gated only on the legacy knowledge collections, independent of `TodayCommandCenter` | **local — repaired §19** | 063 |
| **FR-2** | **P1** | Day 3 | "…every day at 8" | Composer displays `08:00`; store keeps no time; Today shows none | every timed recurring capture | re-enter on the action page — where it is also refused | `setActionDueTime` refuses without a `dueDate`; a recurring action deliberately has none, and `commitCapture` gates the time on `c.dueDate` | **local — repaired §19** | 063 |
| **FR-3** | **P1** | Day 3 | "…every weekday at 9:15" | One-off event on the capture day; "every weekday" left in the title; **no disclosure** | common phrasing | retype as "every Monday, Tuesday…" | `extractRecurrence` returns `null` rather than `unsupported` for weekday/weekend phrases | **disclosure repaired §19; weekday sets deferred** | 063 / Capture |
| **FR-4** | P2 | Days 1, 6 | "Replace the kitchen tap washer" | `possible` note, arrives unticked, Confirm disabled, escape hatch required; four days later it cannot be deferred because it is not an action | 3 of 13 captures | tick it manually | verb coverage in `ACTION_VERBS` | structural | Capture |
| **FR-5** | P2 | Probe B | "Dentist Thursday at 2:30" | Note; the resolved date is disclosed then dropped. Same for "Coffee with Ana Friday at 3", "Haircut Tuesday at 10" | very common | write "Dentist appointment…" | `looksLikeEvent` requires an event noun | structural | Capture |
| **FR-6** | P2 | Day 5 | "Still waiting on Priya for the quote" | Note. *"Waiting on Priya…"* works; a leading "Still " does not | common | drop the word | pattern coverage in `detectWaiting` | structural | Capture |
| **FR-7** | P2 | Day 2 | "I finished deployment." | Note. Nothing closes | daily | tick it by hand | no completion intent in capture | structural | Capture |
| **FR-8** | P2 | Day 2 | "Move the workout forward and remind me I need to email my professor tomorrow" | One note; date discarded; the real obligation inside it never became an action | weekly | retype the obligation | no reschedule/reminder intent; `decompose` merges the clause | structural | Temporal editing |
| **FR-9** | P3 | All days | "…by Thursday" | Title reads *"Return the library books by"*. Visible in Today, Suggested Next, Upcoming and Project Pulse — it was in **every** Today render of the week | every date-bearing capture with a preposition | edit the title | `stripResolvedTemporal` removes the day word but not the preposition governing it | **local — repaired §19** | 063 |
| **FR-10** | P3 | Day 5 | "Dinner with Sam tonight at 7:30" | Time extracted; "tonight" left in the title ("today" strips correctly) | occasional | edit the title | "tonight" is a time-of-day word, so the date stripper never sees it | local, deferred — touching this risks the LIFEOS-060 note-body data-loss lesson | Capture |
| **FR-11** | P3 | Day 3 | — | `completeOccurrence` accepts any well-formed date, including one the rule never produces | not reachable from the UI | — | the guard validates format, not membership | local, deferred | Time |
| **FR-12** | P2 | Probe E | "chase Priya about the quote" | `waitingOn` = *"Priya about the quote"* — the person swallowed the object | every multi-clause wait | — | `waitingOn` is a free-text span, not a person | structural | People |

---

## 7. Maintenance burden audit (§17)

Where does the user still have to behave like a database administrator?

| Task | During dogfood | Verdict |
|---|---|---|
| Choosing record type | The "Or:" row offers *Note / Reflection / Waiting / Project / Goal / Event / Protocol* by name | **System should maintain.** Eight nouns is an ontology, and the row asks the user to know it. The *authority gradient* is right — never auto-creating a Goal or Project is correct — but the mechanism is a taxonomy quiz. |
| Moving records | Never needed | **System maintains.** |
| Tagging | Never used, never missed | **System maintains** (by not existing). |
| Updating project state | Never needed; Pulse infers position from the actions | **System maintains.** |
| Maintaining dates | Setting a date at capture is free | **Necessary human judgment** — but *changing* one has no surface, which is FR-8. |
| Stopping recurrence | 1 trip to action detail | **Necessary human judgment.** Correctly modelled: history preserved, outstanding occurrence kept. Only the location is wrong. |
| Linking to a project | 3 trips in one week | **System should maintain.** `matchRecords` already offers association when the text resembles an existing title; it did not fire for "Draft the methods section" against project "Thesis chapter". |
| Resolving a waiting item | Not offered on Today at all — WAITING rows are links, with no control | **System should maintain** the *affordance*; the judgment stays human. |
| Cleaning stale records | Not needed in a week | Unknown at this horizon. |
| Constructing Today relevance | **Zero interactions, all seven days** | **System maintains.** This is the best thing in the product. |

**Score: 4 "system should maintain" against 3 "necessary human judgment" and 3 already handled.**
The maintenance that remains is concentrated in one place — *connecting a record to its context
after the fact* — and it cost 9 of 58 interactions.

---

## 8. Taxonomy exposure (§18)

Running the app as someone who does not know the ontology.

**Where implementation vocabulary leaks into ordinary use:**

| Where | Word | Does the user need it? |
|---|---|---|
| Capture "Or:" row | **Protocol** | No. It is a `WHEN → THEN` rule; nobody calls that a protocol. |
| Capture "Or:" row | **Reflection** vs **Note** | No. The difference is never explained and has no visible consequence at capture time. |
| Capture "Or:" row | **Goal** vs **Project** | Sometimes — but the user is asked to decide before there is anything to decide about. |
| Nav → Capture | "Belief inbox", "Process inbox" | No. Two inboxes beside a capture box that has already processed everything. |
| Nav → Learn | **Beliefs**, **Constitution**, **Knowledge** | These are the product's philosophy, not the day's vocabulary. |
| Nav → Reflect | **Themes**, **Memory** (Living Memory) | "Memory" is promising and empty of the thing its name implies (§10). |
| Nav → More | **Formation**, **Threads**, **Orchestrator / "Conqify Inbox"**, **Workspaces** | No. Four different words for containers and queues. |
| Nav → More | **Maintenance**, **Diagnostics**, **Release**, **Recovery**, **System Health** | Five engineering surfaces in a consumer product's primary navigation. |

**Where it does not leak, and should be protected:**

Today's section names are ordinary English — *Now, Suggested next, Today, Needs attention,
Waiting, Project pulse, Worth returning to, Upcoming*. Not one of them is a data type. The
capture placeholder is *"Call the dentist tomorrow, finish the report, and Marcus still owes me
the file…"* — an example, not a schema. Overdue is stated once, in the past tense: *"Was due
Mon, Aug 17."*

**Could Capture have handled it?** For the week's ordinary content: yes, 10 of 13 captures
needed no taxonomy knowledge at all. The three that did (FR-4, FR-6, and the reflection on Day 1)
all failed the same way — the rules could not place the sentence, so it arrived as an unticked
`possible` note and the user had to make a filing decision to get anything saved.

---

## 9. Capture acceptance (§19)

Eight shapes, each against a clean store. "Interactions" is to *useful saved state*.

| | Shape | Result | Inter­actions | Wrong-record risk | Unresolved shown | Original survives | Taxonomy needed |
|---|---|---|---:|---|---|---|---|
| A | one obligation — *"Email the landlord about the boiler"* | **Action** | 3 | none | n/a | yes | no |
| B | one appointment — *"Dentist Thursday at 2:30"* | **Note**, date disclosed then dropped | 4 | **high** — an appointment filed as a note | date *"won't be kept"* shown | yes | **yes** |
| C | one recurring item — *"Water the plants every Sunday"* | **Action**, `weekly[Sun]` | 3 | none | n/a | yes | no |
| D | one waiting item — *"Marcus owes me the signed lease"* | **Waiting**, `waitingOn: Marcus` | 3 | none | n/a | yes | no |
| E | mixed four-intent | **3 Actions + 1 Waiting**, one date resolved | 3 | low — `waitingOn` swallowed the object (FR-12) | n/a | yes | no |
| F | reflection — *"I've been feeling stretched thin since the move"* | **Note** (unticked; escalated) | 4 | none — it is offered, never assumed | n/a | yes | **yes** |
| G | ambiguous — *"the thing with the car"* | **Note** (unticked) | 4 | none | n/a | yes | **yes** |
| H | unknown time phrase — *"Sort out the insurance sometime in the autumn"* | **Note**, *"sometime"* reported as vague | 4 | none | **yes** | yes | **yes** |

**Score: 1 of 2 — partially.** Four of eight shapes reach useful state in three interactions with
no taxonomy knowledge. Four require the user to make a filing decision, and one of those (B) is
among the most common things anyone types into a life-management app.

The invariants held everywhere: **the original text survived all eight**, no belief or
Constitution element could be produced by any path, and every date that could not be stored was
either disclosed or resolved into a field.

---

## 10. Today acceptance (§20)

*0 = cannot answer · 1 = partially · 2 = reliably.* Review scoring only; no such score exists in
the product.

| Day | What is happening | What needs attention | What is waiting | What is coming | What can be done now | Day total |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 | 2 | 2 | 2 | 2 | 2 | 10 |
| 2 | 2 | 2 | 2 | 2 | 2 | 10 |
| 3 | **1** | 2 | 2 | 2 | 2 | 9 |
| 4 | 2 | 2 | 2 | 2 | 2 | 10 |
| 5 | 2 | 2 | 2 | 2 | 2 | 10 |
| 6 | 2 | 2 | 2 | 2 | 2 | 10 |
| 7 | 2 | 2 | 2 | 2 | 2 | 10 |
| **Mean** | **1.86** | **2.00** | **2.00** | **2.00** | **2.00** | **9.86 / 10** |

Day 3 scores 1 on *"what is happening"* for one reason: the standup that recurs every weekday
was recorded as a single event, so on any other day of that week Today would not have shown it
(FR-3). Every other cell is a 2 on evidence, not on impression — the sections rendered, the facts
were correct, and the empty ones disappeared.

**Deducted separately and not folded into the score above:** on every day with content, the page
*also* said the user was caught up (FR-1). That is not a failure to answer; it is an answer
contradicting itself two panels lower.

**Today score: 2 — reliably**, conditional on FR-1 and FR-3 being repaired. Both are.

---

## 11. Executive intelligence acceptance (§21)

| Case | Suggestion | Explanation | Grounded? | Would a human understand? | Harmful or silly? |
|---|---|---|---|---|---|
| overdue | "Go to the gym" | *Overdue by 1 day* | yes | yes | no |
| due today | "Return the library books" | *Due today* | yes | yes | no |
| blocked | **never suggested**; the blocker is offered instead | *Blocks 1 other action* | yes | yes — it names why | no |
| waiting | **never suggested** | — | n/a | yes — you cannot do it | no |
| event proximity | did not displace an overdue item | *fits before your event* only ever appears **with** a grounding fact | yes | yes | no |
| tie | **no suggestion** — `indistinguishable()` returns none rather than manufacturing a reason | `NO_STANDOUT` | n/a | yes | no |
| empty state | **no suggestion** | *"No single next action stands out from what Conqify has recorded."* | n/a | yes | no |
| unsized tasks | suggested, **with no duration claim** in either direction | — | yes | yes | no |
| explicit large task | not offered a 20-minute gap | — | yes | yes | no |
| recurrence | recurring sources are **excluded** from recommendation | — | n/a | yes — a standing source is not a next step | no |

**Suggested Next score: 2 — reliably.** Ten for ten. Across seven days it never produced a
suggestion without a fact, never produced more than one, never suggested something the user
could not start, and never wrote anything to the store. The restraint is the achievement: on the
quiet day and on a genuine tie it says nothing, which is the hardest behaviour to hold onto once
a recommender exists.

One observation, not a defect: it suggested the same item four days running because that item
was the only dated thing outstanding. That is correct, and it also reads as a system with a
short memory of what it has already told you.

---

## 12. Autobiographical memory gap (§22)

| Question | Can Conqify answer it? |
|---|---|
| What did I accomplish this week? | **Partly.** `status === "completed"` with `completedAt`, plus `recurrenceCompletions` rows. No surface assembles them into a week. |
| What changed? | **No.** Per-record `history[]` exists on actions and captures; nothing aggregates it across records over a period. |
| What did I postpone? | **No.** Only the *current* `deferredUntil` is queryable; the count of pushes is buried in per-action history. |
| What did I decide? | **Partly** — for `Decision` records. Nothing for the ordinary decisions embedded in captures. |
| What was I worried about? | **No.** Day 1's *"still unsure whether teaching is the right direction"* survives only as raw capture text. |
| What progressed? | **No.** Project Pulse is a snapshot with no previous snapshot to compare against. |
| What stalled? | **Partly.** `dormancyView` / `returnSuggestion` finds the quietest record and says so — the closest thing that exists. |

**Source data that already exists and would support this later** (§22 asks only for this):

- `buildActivityIndex(state)` — **52 events** for a single replayed week, each with `at`, `type`,
  `recordKind`, `recordId`, and workspace/goal/project attribution. This is the substrate.
- `eventsInRange(index, range)` and `changeLog(index, range, filter)` — range filtering and
  typed filtering already exist and already work.
- `periodSummary(index, range)` — already groups an index into labelled sections with counts.
- Per-record append-only `history[]` on actions (`ActionEvent`) and captures, carrying
  `fromStatus`/`toStatus`/`detail`.
- `recurrenceCompletions` — a dated, per-occurrence record of standing responsibilities kept.
- `captures` — the unmodified original text of everything the user ever said, timestamped.

**The missing layer is precise and small: a narrative projection over a date range.** Not new
storage. Every fact needed to answer all seven questions is already recorded; what is absent is a
function that takes `(state, range)` and returns *completed / opened / deferred / waited /
happened / stalled*, and a surface that renders it. `periodSummary` is roughly one third of it.

**Not built** (§22).

---

## 13. Calendar gap (§23)

Now that `LifeEvent` exists, what would a connector actually add?

**Duplication observed:** two of seven departures were to an external calendar, and both were
because capture failed to *recognise* an appointment (FR-5) or a recurrence (FR-3) — **not**
because the Event model was inadequate. The model held every event the replay produced.

**Manual re-entry needed:** every event, every time. Conqify has no knowledge of a meeting
someone else scheduled, which is where most of a working person's calendar comes from. The
replay could only contain events the user typed, which is itself the finding.

**What sync would add**, in order of value:
1. Events the user did not create — the majority of a real calendar.
2. Busy/free truth, which is what makes "fits before your event" trustworthy rather than
   optimistic; today it reasons only over events Conqify happens to know about.
3. Cancellations and time changes, which the product currently cannot represent at all (FR-8).

**Privacy / authority boundary needed:** read-only first; imported events must be marked
non-user-authored (`fromAiText` has no equivalent for "external source" — a `source` field on
`LifeEvent` would be needed) and must be excluded from anything that reads as the user's own
record. Deletion must be one-way: removing a Conqify record must never delete an external event.
An imported event must never become an Action.

**Is the Event model sufficient for a connector?** **Nearly.** `LifeEvent` has `title`, `date`,
`startTime`, `endTime`, `allDay`, `notes`, `recurrence`, `linkedEntityRefs`. Missing for a
connector: an external id, a source label, and a last-synced marker. Its recurrence model
(`RecurrenceRule`) is narrower than RFC 5545 — it has no weekday-set shorthand (which is exactly
FR-3), no BYSETPOS, no EXDATE. Importing a real calendar would immediately hit all three.

**Assessment: the Event model is a good foundation and is not yet connector-ready.** The gap is
three fields and a richer recurrence vocabulary, not a redesign. **Not built** (§23).

---

## 14. Notification / reminder gap (§24)

**What is missed without push, from the replay:** the medication at 08:00 and the standup at
09:15 — both daily, both time-critical, both the kind of thing a person opens no app for. The
physio appointment at 14:00 would be missed by anyone who opened Today in the morning and not
again. Pull-based Today is checked when you think to check it, and the items that need a
reminder are precisely the ones you are not thinking about.

**Is Today's pull model enough?** For *what should I do next* — yes, comfortably. For *be
somewhere at a time* — no, and no amount of Today refinement fixes that, because the failure mode
is the user not looking.

**Which use cases genuinely require delivery:**

| Needs delivery | Does not |
|---|---|
| A timed event about to start | Anything with a due *date* and no time |
| A timed recurring responsibility (medication) | Project pulse, waiting items with no follow-up date |
| A follow-up date arriving on a waiting item | Suggested Next |
| A deferred item returning | Overdue work — Today is the right place, and pushing it would be nagging |

**Should reminders attach to Action/Event or be separate?** The evidence says **attach**. Every
case above is a moment already implied by an existing record: `Event.startTime`, `dueTime`,
`followUpDate`, `deferredUntil`. A separate Reminder noun would be a fifth thing to maintain and
would immediately drift from the record it describes. What is genuinely new is a *delivery*
concern — permission, channel, quiet hours, and the fact that a missed notification must never
change a record. That is infrastructure, not ontology.

**A precondition:** FR-2 means a timed recurring action currently stores **no time**, so the
single most valuable reminder case has nothing to fire on. Repaired in §19. **Not built** (§24).

---

## 15. People / waiting gap (§25)

Is a `waitingOn` string enough?

| Test | Result |
|---|---|
| Same person across multiple waits | **Fails on the first realistic sentence.** "Marcus still hasn't sent the document" → `"Marcus"`. "chase Priya about the quote" → `"Priya about the quote"`. The extractor returns a text span, so the same person yields different strings depending on sentence shape, and nothing joins them. |
| Multiple people with the same first name | **Cannot be distinguished.** Two "Sarah"s are the same string. There is no disambiguation prompt and no place to record which Sarah. |
| A person in a Project and an Event | **No connection at all.** "Dinner with Sam" is an Event whose title contains a name; "Send the chapter to my advisor" names a role; a `waitingOn: "Marcus"` is a third, unrelated string. Three mentions, three representations, zero links. |
| Repeated follow-ups | **Only the latest survives.** `followUpDate` is a single field; chasing someone three times leaves no trace of having chased them twice before. |

**Conclusion from evidence, not from preference:** the string is sufficient for *one* wait on
*one* person and insufficient for everything else. The specific failures are identity (same
person, different strings), disambiguation (different people, same string), and history (repeated
follow-ups overwrite).

The most important observation is what is **not** yet needed. Nothing in the replay wanted a
contact record, an address book, a relationship graph, or an interaction log. What it wanted was
**a stable identity to hang existing facts on** — which is a much smaller thing than a People
CRM, and building the CRM would be the mistake. **Not built** (§25).

---

## 16. Memory / review gap (§26)

| Surface | Can it answer enough? |
|---|---|
| **Daily Review** (`/daily`) | No. It is a *prompt to reflect today*, not a record of a week. It answers "how was today" for days the user filled it in, and the replay filled in none. |
| **Timeline** (`/timeline`) | No. `buildInsightTimeline` returned **0 entries** for a week containing 13 actions, 4 events, 13 captures, 3 projects and a completed occurrence. It indexes knowledge-side records — beliefs, sources, dialogues, decisions — and the executive loop's records are not among them. |
| **Living Memory** (`/memory`) | No. `buildLivingMemory` resurfaces *records worth revisiting*, ranked by dormancy and graph position. It answers "what have you forgotten about" — a different and genuinely useful question — not "what happened". |
| **Activity index** | **Yes, as data.** 52 events for one week, with timestamps, types, record refs and project attribution. `eventsInRange` and `changeLog` already slice it. |

**The missing layer, precisely:** a function `weekInReview(state, range)` returning
`{ completed, opened, deferred, waitedOn, happened, stalled }` computed from the activity index
plus per-record history, and one surface that renders it. It requires **no new persisted data**
— every input already exists — and it is what three of the six §14 questions and five of the
seven §22 questions are asking for.

The reason Timeline cannot be extended into this is worth stating: it is not under-built, it is
built for a different corpus. Pointing it at actions and events would change what the page means.
**Not built** (§26).

---

## 17. Navigation audit (§27)

*Not a redesign. Counts only.*

| | |
|---|---|
| Top-level controls | **6** — `Today`, and the menus `Capture`, `Work`, `Learn`, `Reflect`, `More` |
| Total destinations | **40** |
| Total routes in the app | **119** page files |
| Needed during a full week of dogfood | **4** — `/` (capture), `/today`, `/actions/{id}`, `/projects` |
| Never touched | **36 of 40 (90%)** |

**Destinations that duplicate user intent:**

| Cluster | Routes | Observation |
|---|---|---|
| Intake | `/`, `/process`, `/inbox`, `/notes` | Four ways in. Since LIFEOS-060, `/` handles what `/process` was for; `/inbox` is belief proposals, which the capture path now demotes by design. |
| Belief-adjacent | `/beliefs`, `/constitution` | Two routes, two nouns, one idea. |
| Reflection | `/daily`, `/review`, `/timeline`, `/memory`, `/themes`, `/insights/reviews` | **Six** reflection surfaces, and §14 established that none of them answers "what happened this week". |
| Thinking tools | `/dialogue`, `/inquiry`, `/reason`, `/compare`, `/threads`, `/research`, `/author`, `/formation`, `/decisions` | Nine. Untouched across seven days of ordinary life — which is not a criticism of them, but does locate them. |
| System | `/maintenance`, `/health`, `/security`, `/backup`, `/recovery`, `/privacy`, `/release` | **Seven** engineering surfaces in the primary navigation of a consumer product. |

**Is Home / Capture / Today / Memory / Life still the right long-term simplification?**

On this evidence, **yes, with one correction**. The week used exactly four destinations, and they
map onto that shape almost exactly: Capture (`/`), Today (`/today`), and Life (`/actions`,
`/projects`). The correction is that **Memory is currently the emptiest of the five** — it is the
one the week needed and could not use (§16), while the nine thinking tools it would absorb were
never opened. The simplification is right and it is being proposed for a Memory that does not
exist yet.

---

## 18. Product claim test (§28)

| Claim | Verdict | Evidence |
|---|---|---|
| **1. "Tell Conqify what's happening."** | **PARTIAL** | A five-intent sentence produced an Event, three Actions and a reflection in three interactions (Day 1). But 4 of 13 captures could not be placed and required a filing decision, and an appointment written the ordinary way became a note (FR-5). You can tell it what's happening; sometimes it writes it down wrong. |
| **2. "Conqify keeps track."** | **PARTIAL** | It kept every deadline, every dependency, every waiting item and every recurring source across seven days without being maintained, and a deferred item returned exactly when it was told to. It also **discarded a time it had just displayed** (FR-2) and **collapsed a recurring meeting into one day without saying so** (FR-3). Both repaired here; the verdict reflects the state under review. |
| **3. "What should I do next?"** | **PASS** | Ten of ten in §11. One suggestion, always explained, never something the user could not start, nothing persisted, and silence on a tie. |
| **4. "What am I forgetting?"** | **PASS** | Overdue, due today, returned-from-deferral, blocked-and-dated, and a follow-up that has come due all surfaced without being asked for. `returnSuggestion` additionally surfaces the quietest record. |
| **5. "What happened this week?"** | **FAIL** | Timeline returned 0 entries for a week containing 52 activity events. No surface answers it. This was the only departure on Day 7. |

**2 PASS · 2 PARTIAL · 1 FAIL.**

---

## 19. Repairs made in this sprint

Made **after** the review was complete (§29), and only where §30's tests are met: clearly local,
no new persisted domain, no migration, no new life noun, no scope expansion. Listed separately
from the findings, as §34 requires.

| # | Repair | §30 category | Files |
|---|---|---|---|
| **R-1** | Delete the second "You're all caught up" panel from `/today`. `TodayCommandCenter` already owns the empty state and is the only thing that knows whether the projection found anything — the surviving panel was gated on the legacy knowledge collections alone and so fired while the page listed overdue work. This is the same defect LIFEOS-062 fixed at the other end of the page. | broken empty state / wrong Today copy | `app/today/page.tsx` |
| **R-2** | Let a recurring action carry a `dueTime`. `setActionDueTime` refused any time without a `dueDate`, on the correct principle that *a time with no day names no moment* — but a recurrence rule **does** name days. The guard now accepts a due date **or** a recurrence rule, `commitCapture` sets recurrence before the time and no longer gates the time on a due date, and Today renders the time on a recurring row. | dropped existing behavior | `lib/mvpStore.ts`, `components/today/TodayCommandCenter.tsx` |
| **R-3** | Report an unsupported recurrence phrase instead of swallowing it. `extractRecurrence` returned `null` for "every weekday"/"every weekend"/"weekdays", so unlike every other unsupported phrase it produced no disclosure and the event silently collapsed to one day. It now returns `unsupported: "unsupported_pattern"`, which the existing channel already knows how to show. **Weekday-set support itself is not added** — that is capability, and it is deferred. | dropped existing behavior | `lib/capture/schedule.ts` |
| **R-4** | Strip the preposition that governed a resolved date. "Return the library books by Thursday" left the title as *"Return the library books by"*, which appeared in every Today render of the week. | wrong copy | `lib/capture/dates.ts` |

Nothing architectural was touched. **Zero migrations. Zero new store domains. Zero new nouns.**

---

## 20. Top 10 problems

Ranked by how much cognitive work they leave with the user, not by how hard they are to fix.

1. **There is no past tense.** Nothing answers "what happened this week" (§12, §16, claim 5).
2. **Rescheduling does not exist.** The most common thing anyone does to a plan cannot be said
   (FR-8) — and "move it to Thursday" is a sentence, not a date-picker interaction.
3. **Time-critical items have no delivery.** Medication at 08:00 is invisible unless you open the
   app (§14).
4. **Appointments written the ordinary way are not recognised.** "Dentist Thursday at 2:30" is a
   note (FR-5). This is the single highest-frequency capture miss.
5. **A person is a string.** Two waits on the same human are two unrelated strings (FR-12, §15).
6. **Connecting a record to its context is manual and off-surface.** 9 of 58 interactions, across
   three screens (§7).
7. **Verb coverage decides whether an errand exists.** "Replace…" is a note; "Buy…" is an action
   (FR-4), and the consequence only shows up days later.
8. **Capture cannot hear a completion.** "I finished it" does not finish it (FR-7).
9. **Waiting has no resolution affordance** where it is displayed (§7).
10. **Ninety percent of navigation went untouched** for a week of ordinary life, and six of the
    forty destinations are reflection surfaces that could not answer a reflection question (§17).

---

## 21. Top 10 things to protect

These were expensive to get right and are easy to lose.

1. **The raw capture is never modified.** 13 of 13 sentences survived verbatim. Every other
   guarantee in the product rests on this one.
2. **One suggestion, always explained, or none.** `NO_STANDOUT` on a genuine tie is the hardest
   restraint in the codebase to keep.
3. **Lexicographic ordering, not a weighted sum.** Every comparison is a sentence a person could
   say out loud. The first `urgency * 0.4 + importance * 0.3` undoes it.
4. **Suggested Next is derived, never persisted.** Nothing to go stale, nothing to make the
   machine's guess look like the user's decision.
5. **Blocked and waiting are never recommended.** Telling someone to do what they cannot do is
   worse than saying nothing.
6. **Sections disappear when empty.** A quiet Saturday renders one prompt, not eight empty panels.
7. **Today is a projection, never a verdict.** `FORBIDDEN_TODAY_WORDS` asserted against the whole
   rendered page. No streaks, no percentages, no health score.
8. **Beliefs and Constitution elements are structurally unreachable from capture** —
   `CandidateKind` has no member for them, so no path, including AI, can create one.
9. **Recurrence is a rule, not a hundred rows.** Purity gives uniqueness; completions are
   per-occurrence; stopping preserves history; February 31st is skipped, never clamped.
10. **Unstorable time is disclosed in the user's own words** — *"'sometime' — Conqify can't pin
    this down yet. It stays in the text."* FR-3 was a hole in exactly this contract, and it is
    the contract that made the hole visible.

---

## 22. Recommended next three sprints (§32)

Ranked by the §32 criteria, from the evidence above.

| | Sprint | Frequency of leaving | Cognitive burden | Executive value | Architecture readiness | Risk |
|---|---|---|---|---|---|---|
| **1** | **LIFEOS-064 — Week in Review (autobiographical memory, read-only)** | 1 departure, but it is the one that made the user open a different app to think about their own life | High — the user is currently the only thing that remembers | **Highest.** "What happened" is half of executive function, and the product has none of it | **Highest.** 52 activity events/week already recorded, `eventsInRange` / `changeLog` / `periodSummary` already exist. **No new persisted data.** | **Lowest.** A pure projection, like Today. Zero migrations. |
| **2** | **LIFEOS-065 — Temporal editing (rescheduling as language)** | **2 departures, both on Day 2** — the highest-frequency single cause | High — every plan changes, and changing one currently means leaving the sentence behind | High. "Move it to Thursday", "push everything a week", "I did that already" | Good. `dueDate`, `dueTime`, `deferredUntil` and `RecurrenceRule` are all in place; what is missing is capture intents that *modify* an existing record rather than create one | Medium. It is the first time capture writes to a record it did not create — the association and authority rules need real care. |
| **3** | **LIFEOS-066 — Capture coverage II (appointments, completions, waiting phrasing)** | 2 departures, and the root cause of 4 of the 12 friction items | Medium — the cost is a filing decision, not lost data | High. FR-4, FR-5, FR-6, FR-7 and FR-12 are one sprint | **Highest.** `looksLikeEvent`, `ACTION_VERBS`, `detectWaiting` and `decompose` are all in place and tested; this is vocabulary, not architecture | Low, with one trap: every past capture regression was a *silent* one, so the disclosure contract must be extended alongside the coverage. |

**Why not calendar sync first**, despite two departures: §13 found the Event model is three
fields and a recurrence vocabulary short of connector-ready, and both calendar departures were
caused by *capture* failures (FR-3, FR-5), not by the absence of a connector. Sprint 3 removes
one of those causes and sprint 1 costs nothing architecturally. Calendar sync is the right fourth
sprint, and it will be a cheaper one after 066.

**Why not People**: §15 was explicit — what the evidence asks for is a stable identity to hang
existing facts on, not a CRM. That is a smaller change and it should follow, not precede, the
sprint that fixes how a person's name is extracted in the first place (FR-12, in 066).

---

## 23. Things not to build yet

- **People CRM** — the evidence asks for identity, not contact management (§15).
- **Calendar sync** — the Event model is not connector-ready and the observed pain is upstream
  of it (§13).
- **Reminder infrastructure** — genuinely needed (§14), but it should attach to `Event.startTime`
  / `dueTime` / `followUpDate` / `deferredUntil` rather than become a fifth noun, and it should
  follow the repair that makes a recurring action carry a time at all.
- **Any productivity score, streak, or composite metric.** The §20 and §21 scores in this document
  are review instruments and must not become product UI.
- **A recommendation model.** The deterministic ordering scored ten out of ten; replacing an
  explainable comparison with an inexplicable one would be a downgrade.
- **Navigation redesign as its own sprint.** The 90% untouched figure is an argument for the
  Home/Capture/Today/Memory/Life shape, but Memory must exist before the shape can be adopted.
- **New persisted ontology of any kind.** The three highest-value sprints above need **zero**
  migrations between them.

---

## 24. Final product diagnosis

Three sprints ago the diagnosis was *overbuilt Understanding, underbuilt Organization*. That has
changed. Capture, Time and Today were the right three sprints and they built a real executive
loop: **a person can now say a messy sentence and get the correct records, and open one page
that tells them what their day is.** Across a full week that loop needed no maintenance — Today
was right every day for zero interactions, and the user left Capture and Today for only 16% of
what they did.

The product's remaining problem is no longer that it does not understand — it is that it does
not **remember**, and it does not let you **change your mind**. Conqify has a present tense and
no past tense; it can hear "I need to" and cannot hear "I did", "I didn't", or "move it". Those
are not features around the edge of the loop; they are the other half of the same loop, and a
person running a real week hits both by Tuesday.

What is genuinely strong is worth naming plainly, because it is unusual: this product declines to
manufacture certainty. It says nothing on a tie. It suggests nothing on an empty day. It reports
the words it could not understand instead of guessing at them. It cannot be made to write a
belief on the user's behalf. Those choices are why the failures in this report are all of the form
*"it did not do enough"* and none of the form *"it did something wrong to my data"*.

The three defects that broke that pattern — a page claiming you were caught up while listing
overdue work, a time displayed then discarded, a recurrence collapsed without a word — are
repaired here, and each was found by running the product rather than by reading it. That remains
the only method that works.

**Verdict: partially accepted.** The loop holds. It has no memory.
