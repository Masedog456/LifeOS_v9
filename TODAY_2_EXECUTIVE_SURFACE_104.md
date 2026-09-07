# LIFEOS-104 — Today 2.0 / The Actual Daily Executive Surface

Base: `684d2f8` (PR #109 merged). Branch: `claude/lifeos-104-today-2`.
Head unchanged at **0047**. No migration, no persistence, no new ranker.

---

## 1. Audit

Measured before anything was changed, against twenty fixture worlds
(`scripts/fixtures/lifeos-104-worlds.cjs`) and the §57 torture world, with a
probe that composes the same five builders `TodayCommandCenter` composes, in the
same order, with the same `show` gates. Days are offsets from a fixed anchor
(2026-09-07), so "overdue by four days" stays overdue by four days.

### 1.1 What Today derives today

| Builder | Called by Today | Fields Today reads |
| --- | --- | --- |
| `buildTodayIndexes` (062) | once | all |
| `buildTodayView` (062) | once | 14 of 19 |
| `buildDailyExecutiveView` (073) | once | **3 of 12** |
| `buildDailyCommandView` (083) | once | 4 of 5 |
| `buildDecisionInbox` (094) | once | **1 of 4** (`total`) |

`recommendNextAction` (072), `buildCommitmentSignals` (070),
`buildAttentionShortlist` (082) and `buildExecutiveChanges` (081) are reached
*through* those, never called twice. There is no local derivation in the
component and no second ranker: that part of §51 already held before this sprint.

### 1.2 The rendered hierarchy, before

Eleven to twelve sections on a dense day, in this order:

```
ORIENTATION → NOW → Suggested next → Today → Needs attention →
Since yesterday → Waiting → Project pulse → Worth returning to →
(can-wait line) → Upcoming → coverage
```

§57 torture world: **11 sections, 36 rows.** World T (120 actions):
**12 sections, 70 rows.** §50 asks for 3–5.

### 1.3 The twenty worlds

Answers to §2's ten questions, condensed. "AF" = what is above the fold on
desktop before Suggested next; "rec" = what Today recommends first.

| World | Sections | rec | reason shown | verdict |
| --- | --- | --- | --- | --- |
| A quiet day | **1 (empty panel)** | — | — | **RED A** — two live actions, page says "Tell Conqify what's going on." |
| B one clear next | 4 | Call the dentist | Due today | duplicated in Today **and** in orientation (**RED D**) |
| C several due | 4 | Confirm the caterer | Due today at 4 PM + counterfactual | duplicated in Today (**RED D**) |
| D overdue | 3 | File the insurance claim | Was due Thu, Sep 3 | orientation says "1 item needing attention"; **no such section exists** (**RED C**) |
| E follow-up due | 6 | Draft the personal statement | only executable | correct; wait routed to attention, roster keeps the row |
| F wait, no follow-up | 5 | Draft the personal statement | only executable | correct — wait is factual ("Since Aug 17"), not urgent |
| G blocked + blocker | 5 | **Get lease approval** | Unlocks Install the reception desk | recommender correct; orientation calls the *blocked* action "Yours to place" (**RED E**) |
| H recurring due | 4 | Take the medication | Today's occurrence is due | duplicated in Today (**RED D**); orientation says 1 attention, section renders 0 (**RED C**) |
| I event-heavy | 5 | Print the consent form | Due today | Advisor meeting appears **three times** (orientation, NOW, Today) (**RED D**) |
| J goal no path | 5 | Request the recommendation | only executable | **RED B** — attention flags 2 goals; the truthful predicate flags 1 |
| K project no next | 6 | Draft the brochure | only executable | correct — empty project surfaces as dormancy, never as work |
| L repeated deferral | **1 (empty panel)** | — | — | **RED A** |
| M many decisions | 6 | *(none)* | — | 4 decisions, count only, no preview (§19) |
| N yesterday changed | **1 (empty panel)** | — | — | **RED A** — three changes computed, none rendered |
| O open work only | 6 | *(none)* | — | ungrounded tie; §8 licenses this |
| P future dates only | **1 (empty panel)** | — | — | **RED A** |
| Q mixed | 8 | *(none)* | — | **RED F** — two things due today, page says "No single next action stands out" |
| R recently completed | 5 | Send the thank-you note | only executable | correct |
| S empty / new user | 1 | — | — | correct and calm — §56's red 12 does not hold |
| T noisy (120) | **12, 70 rows** | *(none)* | — | **RED C** (says 16 attention, renders 3), **RED F** (24 dated items, no standout) |

### 1.4 §56 — the twelve candidate reds, tested

| # | Candidate | Verdict | Measurement |
| --- | --- | --- | --- |
| 1 | strongest next move hidden below lower-value content | **partly** | 8 rows of orientation + NOW precede Suggested next in the torture and event-heavy worlds. Fold measured in §5. |
| 2 | primary recommendation duplicated in Today | **RED D** | 5 of 21 worlds repeat it verbatim; 2 of those also repeat it in the orientation line, and event-heavy repeats a fixed item three times. |
| 3 | blocked work recommended as executable | **no** for the recommender | `recommendNextAction` picked a blocked action in **zero** worlds. In G it correctly picked the *blocker*. |
| 3b | …but the orientation calls it executable | **RED E** | `flexibleToday` lists blocked actions under "Yours to place" (G, torture). |
| 4 | waiting recommended instead of follow-up | **no** | No world recommends a waiting action; `isExecutable` excludes them. E routes the due follow-up to attention. |
| 5 | Goal no-path shown as ordinary work | **RED B** | World J: Needs attention flags **both** goals "No active project is linked to this goal" — including one carried by a live action. `goalPathState` = `"actions"`; `goalsWithoutAnyPath` = `["j-none"]`; Decision Inbox = `["j-none"]`. Two engines, two answers. |
| 6 | Project no-next shown as executable | **no** | An action-less project reaches Today only as dormancy ("No recorded activity yet."). No "add task" is offered as work. |
| 7 | decision boundaries buried | **partly** | The count is in the first card in every world. There is **no top-item preview anywhere**, which §19 asks for. |
| 8 | Since yesterday too prominent | **no** | It renders below Suggested next, Today *and* Needs attention in every world that has it (T: 18 actionable rows above it; torture: 8). |
| 9 | events confused with Actions | **partly** | Model-level distinct (events carry no link and no control). Both render inside one section titled "Today" with no sub-heading. Measured visually in §5. |
| 10 | deferred item resurfaces too soon | **no** | `t-deferred` (+9d) appears in no actionable section. Not Today holds. |
| 11 | quiet day manufactures urgency | **no** | World F: "The only action Conqify can see that's ready to start" + "Nothing is due today." No urgency language in any world. |
| 12 | empty day shows clutter | **no** | World S renders one panel. Every section gates on content. |

Seven of twelve candidates did not hold. Three that did are narrower than
briefed. Three genuine reds the candidate list did not name were found instead.

### 1.5 The reds that are real

**RED A — a store with live work renders the new-user empty state.**
Four of twenty worlds. `view.empty` ANDs every section together, and *undated
open work belongs to no section* — it is visible only through the
recommendation. So two open actions with no dates, or a deferral that expired
today, or three meaningful changes from yesterday, all produce
"Tell Conqify what's going on." `buildTodayView` also cannot see
`command.sinceYesterday`, which is computed one layer up, so world N's three
changes are built and thrown away.

**RED B — goal judgment is rendered as attention, and fires falsely.**
`goal_path_missing` asks only whether a *project* links to the goal. A goal
carried by a live action therefore trips it. LIFEOS-088 knew this — its truthful
predicate is `goalsWithoutAnyPath` — and LIFEOS-094's Decision Inbox uses the
truthful one. Today uses the other, in the section that means "actionable".
§17 says this is judgment, not work.

**RED C — the orientation count contradicts the section it names.**
Five of sixteen non-empty worlds. The line counts `daily.attention` (070's raw
signals); the section renders `command.attention` (082's shortlist, capped and
deduplicated). Worlds D, G and H say "1 item needing attention" above a page
with no attention section at all. World T says 16 and renders 3. The
component's own comment claims this cannot happen: *"every number below is a
length of a list the sections themselves render, so the summary and the detail
can never disagree."* It does happen.

**RED D — the suggestion is repeated verbatim below itself.**
083's dedup discipline suppresses the *attention* card for the recommended
action and moves its reason inline. It does not suppress the *Today* row, or
the orientation's "Yours to place" line. World B shows "Call the dentist"
three times in eleven rows; event-heavy shows "Advisor meeting" three times
(orientation, NOW, Today).

**RED E — blocked work is offered as "Yours to place".**
`flexibleToday` does not consult `blockedActionIds`. §14 says blocked work must
not be presented as executable.

**RED F — "No single next action stands out" is said on the busiest days.**
Worlds Q (two things due today) and T (twelve due today, three overdue).
The cause is 072 §31E: when the top two candidates tie on every ordering fact,
the recommender refuses rather than dress an arbitrary pick as a judgment.

**That refusal is correct and is not changed by this sprint.** It is asserted
with its reasons in four suites (072 3.9, 082 3.1–3.4, 082 7.7–7.9, 073 8.4–8.5)
and Memory's "What should I do next?" gives the same answer, deliberately. §4
forbids a second ranker and §6's "existing tiebreakers" already run — they order
the list; they are just not allowed to *speak*. What is wrong is the sentence.
On a day with twelve dated items, "No single next action stands out from what
Conqify has recorded" reads as *there is nothing*, which is false. §33 says
exactly what to do instead: no fallback ranker, and secondary content that is
true. So the fix is at the surface, not in the ranker.

### 1.6 §27 — Morning Brief: **already merged; no duplication to remove**

There is no Morning Brief route, page or component. LIFEOS-083's "Daily Command
Center" *is* Today's command center; `/daily` has redirected to `/today/review`
since LIFEOS-092. Measured: `buildDailyExecutiveView` has exactly **one**
consumer in the app.

What the measurement does show is waste. Today reads three of its twelve fields,
and at 5,000 records that call is **128 ms of a 348 ms derivation** — the most
expensive of the five builders and the least used. Verdict: **keep the concept,
collapse the call.** 073's engine stays whole for `/today/review`; Today asks it
only for the part it renders.

### 1.7 §13 — waiting with no follow-up: **leave to a lifecycle sprint**

Measured: LIFEOS-070 emits `follow_up_due` only when a date exists and has
arrived; LIFEOS-094 emits `WAITING_FOLLOW_UP` on the same condition. Both
exclusions are deliberate. Today already shows a dateless wait truthfully in the
waiting roster — "Priya · Quote · Since Aug 17" — with no controls and no
urgency, which is exactly what the record supports. §13 names this outcome
itself. Nothing is redefined here.

### 1.8 §47/§48 — attention vs judgment vs context

The nine signal kinds, as Today actually routes them:

| Kind | `COMMITMENT_SECTION` | Where it renders | Should be |
| --- | --- | --- | --- |
| `overdue` | attention | Needs attention | **actionable** |
| `follow_up_due` | waiting | attention *and* waiting roster | **actionable** |
| `returned_today` | return | Worth returning to | actionable |
| `recurring_due` | attention | Needs attention | actionable |
| `blocked` | attention | Needs attention | context |
| `due_soon` | attention | Needs attention | actionable |
| `project_no_next_action` | pulse | Project pulse | **judgment** |
| `goal_path_missing` | pulse | **Needs attention** (via 082) | **judgment** |
| `dormant` | return | Worth returning to | context |

`goal_path_missing` is mapped to `pulse` by 070 and to attention by 082's
shortlist, and Today renders the shortlist — so the map says one thing and the
page does another. That is RED B's mechanism.

### 1.9 §63 — performance, before

Milliseconds per derivation, median of 40 runs (10 at 5,000):

| records | indexes | view | daily | command | decisions | total |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.32 | 2.27 | 3.88 | 1.73 | 1.22 | **9.43** |
| 1,000 | 1.69 | 16.22 | 24.16 | 12.53 | 11.89 | **66.49** |
| 5,000 | 8.60 | 86.58 | 128.21 | 63.03 | 62.04 | **348.47** |

Growth is linear (10× records → 7.0×; 5× → 5.2×). No pathological whole-store
pass exists. The constant is the problem, and `daily` is 37 % of it for three
fields.
