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

---

## 2. What changed

### 2.1 The page shape

Five sections, everywhere. Nothing was deleted; what was competing was collapsed.

```
orientation line      counts, only when it has something to count
1  Suggested next     the one strongest move + why  ·  or §33's two silences
2  Today              BE THERE (events, timed) then DO (dated, recurring)
3  Needs your decision  count + the one question not already on screen
4  Needs attention    the actionable residue
5  ▸ Context and what's coming   Since yesterday · Waiting · Project pulse ·
                                 Worth returning to · Upcoming   (collapsed)
   coverage note      one line, one link
```

| World | before | after |
| --- | --- | --- |
| §57 torture | 11 sections, 36 rows | **5 sections**, 31 rows |
| T (120 actions) | 12 sections, 70 rows | **5 sections**, 65 rows |
| B (one dated action) | 4 sections, 11 rows, the action named 3× | **2 sections**, 8 rows, named once |
| A (quiet, two open actions) | the new-user empty panel | Suggested-next section naming both |

The NOW card is gone and became a marker on the row it described. In the
event-heavy world it had been the third mention of one appointment, after the
orientation card and the Today list.

### 2.2 One projection

`lib/today/surface.ts` — `buildTodayCommand(state, ix, today, { view, command })`.

It composes; there is no comparator in the file. `recommendNextAction` chose the
suggestion, `buildTodayView` ordered the schedule and the roster,
`buildAttentionShortlist` ordered and capped attention, `buildDecisionInbox`
ordered the questions. This splits, suppresses and counts.

§52 permits it "only if this reduces real drift", and the drift was measured, not
assumed: five of sixteen non-empty worlds had a summary line disagreeing with the
section it named.

### 2.3 Recommendation semantics — unchanged

**No ranker was added, changed or removed.** LIFEOS-072's §31E tie refusal is
asserted as still refusing (104.47), and Memory's "What should I do next?" still
gives Today's answer. What changed is one sentence, at the surface, under §33.

The audit's red F was real — "No single next action stands out from what Conqify
has recorded" was being said above twelve dated items — but the fix belonged
where the sentence is, not where the decision is. The refusal is right: several
things tied on every ordering fact, and dressing an arbitrary pick as a judgment
is what §4 and §6 both forbid. So Today now distinguishes the two silences:

- dated work exists, nothing stands out → `"3 things on today, and no single one
  stands out ahead of the rest."` — arithmetic over the rows rendered below it
- nothing dated at all → `"Nothing is pressing right now."` plus the open work,
  in record order, capped at five, with the note saying it is record order

### 2.4 Decision treatment (§19)

Promoted from a link in the orientation card to a section, because §7 puts it in
the first viewport beside Suggested next and Today. It carries the count and
**one** question — never the options, never the resolution controls, never the
queue. Those live at `/today/decisions`.

The preview skips any question already answered on screen. A due follow-up is one
fact with two names (`follow_up_due` and `WAITING_FOLLOW_UP`); while the queue was
a bare count that cost nothing, but as a section it put "Follow up with Maria?"
two rows above "Transcript · Follow-up date is today."

### 2.5 Attention treatment (§47, §48)

Three categories, three homes, decided by what a person can DO about the row:

| | belongs to | why |
| --- | --- | --- |
| `overdue`, `follow_up_due`, `recurring_due`, `due_soon`, `repeated_deferral` | **Needs attention** | there is an action to take |
| `goal_path_missing`, `project_no_next_action` | **Needs your decision** | §17: judgment, not executable work |
| `returned_today`, `dormant`, `blocked` | **Context** | recorded facts, no deadline of their own |

LIFEOS-070's `COMMITMENT_SECTION` map is untouched, and so is its
`goal_path_missing` predicate. Today simply stops rendering judgment kinds in the
section that means "actionable" — which fixes the false positive too, because the
queue that owns judgment already uses the truthful predicate.

### 2.6 Morning Brief (§27) — KEEP the concept, COLLAPSE the call

Measured, not assumed: there is no Morning Brief route, page or component. 083's
"Daily Command Center" *is* Today's, `/daily` has redirected to `/today/review`
since 092, and `buildDailyExecutiveView` had exactly one consumer in the app.

So there is no duplicate command center to remove. What the measurement found was
waste — three of twelve fields read, 128 ms of a 348 ms derivation at 5,000
records. `buildTodayOrientation` is those three fields, extracted; the full view
calls it, so the morning surface and the evening one cannot drift about what
"fixed" means.

### 2.7 Left alone, deliberately

- **§13 waiting without a follow-up.** 070 and 094 both exclude dateless waits on
  purpose. The roster already states one truthfully — "Priya · Quote · Since Aug
  17" — with no controls and no urgency, which is what the record supports.
  Redefining commitment awareness inside Today is what §13 warns against. A
  lifecycle sprint can decide whether a 21-day silent wait deserves a question.
- **§31E** the tie refusal, above.
- **070's signal semantics**, including `goal_path_missing`'s project-only rule.
- **§55** no schema, no migration. Head stays 0047.

---

## 3. Proof

### 3.1 Deterministic — `today/surface`, 83 assertions

Organised by the reds the audit measured, because a red that comes back comes
back as a state, not as a function call. Every block pairs the record that must
produce the behaviour with the near neighbour that must not.

| Block | assertions | what it pins |
| --- | --- | --- |
| RED A — live work is not an empty store | 104.1–104.14 | four worlds that used to collapse; and the neighbours: empty stores, finished work, and deferrals ahead of today stay empty |
| RED B — goal judgment is not attention | 104.15–104.21 | the false positive, the disagreement between the two predicates, and the control that overdue still reaches attention |
| RED C — the count is the section | 104.22–104.30 | the old line asserted as having claimed an item; the new one asserted as following the rendered list where the two differ |
| RED D — no duplicate suggestion | 104.31–104.41 | dated, timed and recurring suggestions; and that an Event is never suppressed |
| RED E — blocked is not placeable | 104.42–104.46 | and unblocked dated work still is, so 104.42 cannot pass on an empty list |
| RED F — two silences | 104.47–104.52 | §31E asserted as **still refusing**; both sentences; no fallback pick |
| §19, §25 decision preview | 104.53–104.58 | skipped when already on screen, shown when not |
| §26, §29, §49 context | 104.59–104.61 | |
| §53 store truth | 104.62–104.66 | completion, reschedule, defer, waiting |
| §44, §45, §54 language and purity | 104.67–104.75 | no score, no raw 24-hour time, identical on re-derivation, ≤5 sections on the torture world |
| §13 waiting, unchanged | 104.76–104.80c | |

### 3.2 Browser — `smoke-104-today-surface.cjs`, 69 assertions

28 scenarios over the audit's own worlds, at 1280×900 and 390×844. Three read
geometry, because three of the reds were layout facts.

### 3.3 Full-revert proof (§59)

Product code reverted to `684d2f8` (`lib/today/daily.ts`,
`TodayCommandCenter.tsx`, `lib/today/surface*.ts` removed); the suite kept.
**48/66 — no crashes.** The 18 that distinguish the sprint:

| assertion | what the reverted product did |
| --- | --- |
| 3, 3b | named "Call the dentist" **3 times** in one page |
| 4, 4c | no BE THERE rows existed at all |
| 5, 5b | no timed-action rows; no recurrence rule on them |
| 11, 11b, 11c | flagged **both** goals as attention, including one with a live action |
| 13 | no decision section existed |
| 16 | named the recurring occurrence **3 times** |
| 17, 17b, 17c | rendered the new-user empty panel over two live actions |
| 19b | Since yesterday was a top-level section |
| 19c | the line claimed **6** items needing attention; the page rendered **2** |
| 22, 22b | **8 sections** on the 120-record world, five of them context |

The remaining 48 are guards and are labelled as guards. Several pass on both —
21 (mobile fold) because LIFEOS-083 already fixed that, 13b/13c because they are
"at most one"/"none" shapes that a missing section satisfies, 22c because a
denser page is still under six screens. They are kept because they would catch a
regression, not because they prove this sprint.

### 3.4 Mutation (§60)

| # | mutant | caught by |
| --- | --- | --- |
| M1 | duplicate Suggested next in Today | deterministic 76/81 |
| M2 | blocked work back in flexible/executable | deterministic 80/81 |
| M3 | treat already-shown work (incl. waiting) as open work | deterministic 82/83 |
| M4 | bury the decision boundary | browser 63/66 |
| M5 | promote Since yesterday above the day | browser 63/66 |
| M6 | re-surface a deferral that has not come back | deterministic 79/81 |
| M7 | classify an Event as an Action row | browser 64/66 |
| M8 | hide the recommendation's reason | browser 65/66 |
| M9 | fabricate urgency when nothing is grounded | deterministic 76/81 |
| M10 | freeze the projection — break store-truth reflow | browser 67/69 |
| M11 | orientation counts the raw signals again | deterministic 80/81 |
| M12 | goal judgment back in Needs attention | deterministic 77/81 |

**Two of these did not redden on the first attempt, and both were the test's
fault:**

- **M3, first spin,** deleted a `status !== "waiting"` clause and changed
  nothing — `shown` already held every waiting action because the roster lists
  them all. An equivalent mutant. The clause is now gone (a condition that
  cannot fail is a condition nobody can test) and the mutant was respun against
  the clause that does the work.
- **M10 passed all 66.** §53 says Today reflows *immediately*, and every §53
  scenario reloaded the page — which proves the projection is derived rather
  than persisted, and remounts the component, rebuilding the freeze. Scenario
  23pre changes the store from inside the page with no navigation, and watches
  both the row and the line above it change.

### 3.5 Accessibility (§61) — and the two regressions it caught

`smoke-099-accessibility.cjs`: **22/22.** It caught both of these before they
could ship:

- the new BE THERE / DO group labels went out at `text-zinc-400` — **2.54:1** in
  light. They use the tertiary token now.
- extending the past-time dimming from Events to timed **Actions** took "Call
  the dentist" to **3.51:1** and its meta to **2.11:1**. Dimming stays on
  Events, where it already was. A row you cannot read is worse than a row you
  cannot tell is behind you, and the action is still yours to do.

Tap targets, focus and dark/light parity are unchanged; the new controls reuse
the existing pill and resolution components.

### 3.6 Visual review (§62)

Eight views captured: quiet desktop, dense desktop, mobile, overdue,
event-heavy, decision-heavy, empty, dark.

| view | cards | screens |
| --- | --- | --- |
| quiet desktop | 2 | 1.33 |
| dense desktop (120 records) | 6 | 2.66 |
| mobile (torture) | 6 | 2.82 |
| overdue | 2 | 1.32 |
| event-heavy | 3 | 1.56 |
| decision-heavy | 5 | 1.83 |
| empty | 0 | 1.06 |
| dark (torture) | 6 | 2.30 |

(Card counts include the orientation strip and the collapsed context block.
Largest section heading is 10 px uppercase; the 14 px `h2` in the measurement is
the onboarding card below the command center.)

**One finding, fixed:** on a quiet day the orientation line has no counts to
state, which left an empty bordered box holding one small link above the day.
§9 calls that furniture. The link stayed; the box went.

No dashboard feeling, no duplicated rows, no giant headings, no urgency theater,
no faint context, no buried recommendation.

### 3.7 Performance (§63)

Milliseconds per Today derivation, same run, same machine:

| records | indexes | view | command | surface | **Today total** | before |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.29 | 2.16 | 1.84 | 1.77 | **6.07** | 8.46 |
| 1,000 | 1.74 | 15.68 | 14.04 | 12.30 | **43.77** | 67.47 |
| 5,000 | 8.18 | 98.35 | 76.39 | 69.20 | **252.13** | 388.54 |

**35 % faster at 5,000 records**, and the reason is subtraction, not
optimisation: Today no longer builds nine fields it never read. Growth stays
linear (10× records → 7.2×; 5× → 5.8×). No new whole-store pass was added — the
projection reads the index and the four builders the page already had.

### 3.8 Gates

| gate | result |
| --- | --- |
| deterministic, 65 suites | **6323/6323** |
| 104 browser | **69/69** |
| 083 Morning Brief | 77/77 |
| 090 Not Today | 69/69 |
| 091 Evening Close | 87/87 |
| 092 One Daily Review | 59/59 |
| 094 Decision Inbox | 47/47 |
| 099 Accessibility | 22/22 |
| 103 Follow-Through | 22/22 |
| 082 Guidance | 62/64 — **identical on `684d2f8`** |
| 098 Outcome Coherence | 33/34 — **identical on `684d2f8`** |
| 074 Reachability | 137/145 — **identical on `684d2f8`** |
| release audit | PASS 17/17 |
| route smoke | PASS 25/25 |
| export verify | PASS 14/14 |
| security scan | PASS |
| tsc · eslint · build | clean (2 pre-existing warnings, elsewhere) |

The three suites that are not green were **run against the base commit and fail
there identically** — same assertion names, same counts. They are not 104
regressions: 074's are Defer/Someday on the action detail page (A20–A23, D17,
H13, H14) plus D7c, and 082/098's are on `/memory`.

### 3.9 Test files updated in other suites

Three suites were selecting on markup this sprint moved. The capability each
measures is unchanged, and each edit says so at the site:

- **074** C1–C13 and D2–D3 follow the fixed/DO split; D7/D11 open the collapsed
  context block, because a person opening a disclosure *is* reachability, which
  is what that suite measures.
- **074 C3** exposed a genuine loss, not a selector problem: a timed recurring
  action became a fixed row and lost the control that closes one occurrence
  without ending the series. `FixedRow` carries the occurrence key and the row
  carries the button. No restructuring justifies removing a mutation the user
  had.

---

## 4. Product claims (§66)

| # | claim | evidence |
| --- | --- | --- |
| 1 | Today answers "what should I do now?" quickly | 21, 21b, 21c, 22d — Suggested next in the first viewport at 390×844 and 1280×900, ahead of every context heading |
| 2 | one strongest next move when grounded | 1, 1b, 104.31–104.37 |
| 3 | its reason is visible | 2, 2b, 104.36; M8 reddens |
| 4 | Suggested next is not duplicated | 3, 3b, 16, 104.31–104.41; M1 reddens; revert names it 3× |
| 5 | Events and Actions stay distinct | 4, 4b, 5, 104.38–104.40; M7 reddens |
| 6 | waiting is not mistaken for executable | 8–8d, 104.76–104.80c; M3 reddens |
| 7 | blocked work is not recommended | 9, 10, 10b, 104.42–104.46; M2 reddens |
| 8 | judgment is distinct from ordinary work | 11–11c, 13–13c, 104.15–104.21; M12 reddens |
| 9 | deferred work respects Not Today | 15, 14d, 104.11, 104.65; M6 reddens |
| 10 | quiet days do not manufacture urgency | 17c, 104.52; M9 reddens |
| 11 | empty days stay calm | 18–18c, 104.9, 104.10 |
| 12 | Since yesterday stays contextual | 19, 19b, 104.59–104.61; M5 reddens |
| 13 | Today reflows from store truth | 23pre–27c, 104.62–104.66; M10 reddens |
| 14 | no new ranker, score, persistence or migration | 104.47 (§31E still refuses), 104.67, 104.71–104.73; head unchanged at 0047 |

---

## 5. Known gaps

1. **§13 — a long silent wait raises no question.** A wait with no follow-up
   date and 21 days on it is stated factually and asks nothing. 070 and 094 both
   exclude it deliberately; §13 names "leave to a future lifecycle sprint" as an
   acceptable outcome and this sprint took it.
2. **The greeting.** `app/today/page.tsx` still opens with "Good afternoon." at
   1.75 rem — the largest text on a decision surface, saying nothing about the
   day. Outside 104's scope (§68), and flagged here rather than changed.
3. **Resolution controls on blocked work.** An overdue-and-blocked row offers
   Complete / Reschedule / Defer rather than leading with the blocker, because
   `RESOLUTIONS_BY_KIND.overdue` does not consult `blockedActionIds` the way
   `recommendationResolutionsFor` does. Pre-existing (071/082); the row now says
   "Blocked by …", so the fact is visible even though the control order is not
   yet.
4. **The DO list is uncapped.** The 120-record world renders twelve "Due today"
   rows. Every one is genuinely due today, and §50 is about sections, so nothing
   was capped — but a person with forty things due today would scroll.
5. **The pure probe does not hydrate.** `mvpStore` returns due deferrals on
   load, so a deferral whose date has arrived reaches Today as a *returned*
   action. Any future probe over these fixtures should expect the browser and
   the probe to differ on exactly that record.
6. **074, 082, 098** carry pre-existing failures, unchanged by this sprint and
   verified against the base commit.
