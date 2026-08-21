# Internal product review — LIFEOS-059

**Branch** `claude/lifeos-059-internal-product-review` · **Base** `3705edc` (current `main`)
**Reviewers** founder · ChatGPT · Claude (this document)
**Method** code inspection of `main`, plus the capture classifier executed directly against the ten torture-test sentences.
**Status** analysis only. No product code changed. No P0 discovered.

---

## 0. Why this replaced the closed-beta evidence loop

PR #61 built a privacy-safe telemetry loop so that external testers' behaviour could become product evidence. There are no external testers. The reviewers are three parties who can all read the code and the state directly. A telemetry subsystem answering a question nobody is asking is cost without return, so it was closed unmerged.

The lessons it produced are worth keeping without the infrastructure:

- a privacy claim that lives only in JSX is unfalsifiable; put the claim where a test can hold it to behaviour
- evidence/telemetry must be strictly subordinate to product behaviour — it may never break a user action
- silent Constitution mutation is a stop-the-line invariant
- user feedback must never silently become AI context
- local-first privacy remains the default

Those are recorded in `PROJECT_MEMORY.md`. Nothing else from that branch comes forward.

---

## 1. The single sentence

**Conqify is an excellent instrument for thinking about your life and a weak instrument for running it, and the gap is concentrated in two places: it is hard to get an obligation in, and there is no model of time.**

Everything below is evidence for or against that sentence.

---

## 2. Review as three users

### A. Overwhelmed general user — "Can this help me keep my life together?"

**No, not yet.** Not because the pieces are missing — `NextAction` has status, due date, defer, waiting, follow-up, dependencies, templates, size, energy, and context — but because of what happens between the thought and the record.

Type "I need to call my dentist" into the box on the home page and press **Capture**. What happens: the text is saved as a `Capture`, sent to a model to generate *belief proposals*, and you are told *"Saved on this device. N beliefs waiting in your Inbox."* You now have a capture and possibly some belief proposals. **You do not have a task.**

To get a task you must know to go to `/process`, open that capture, choose the `convert` tab, read the suggestion, and confirm. Five deliberate steps, through a page called "Process inbox", which is a different page from "Belief inbox", which is a different page from "Conqify Inbox".

An overwhelmed person will not do this twice.

### B. Thoughtful / intellectual user — "Can this help me think better and live what I learn?"

**Yes, and this is the strongest thing about the product.** Reading ingestion with real page accounting, deterministic sectioning, hybrid retrieval, hierarchical summarization; a belief ledger with affirm/question/revise; Dialogue, Tensions, Syntheses; the Constitution with adoption gating and revision history; Living Memory and deterministic resurfacing that always states its reason.

The provenance system is genuinely rare. `classifyOrigin`, `fromAiText`, `effectiveOrigin` with least-privileged-wins, and the rule that *confirming a machine-suggested structure is not authorship* — most products in this space cannot tell you which sentences were yours. Conqify can, and it is tested.

### C. Productivity user — "Can this reliably tell me what matters and what I am forgetting?"

**Partly.** Today genuinely answers *what is overdue*, *what is due today*, *what follow-ups are due*, *what deferred items return today*, and *what is worth returning to* — and every surfaced item explains itself. That is more honest than most task managers.

But it cannot answer *what is happening today at what time*, *what recurs*, or *who owes me what*, because none of those exist in the schema. And it will only tell you about things that made it through the intake path in §A.

---

## 3. First 15 minutes

| Question | Finding |
|---|---|
| What does a new user think Conqify is? | A journaling / thinking tool. The home page headline is *"Chaos → order — Bring what's competing for your attention into one place"*, and the first thing it produces is **belief proposals**. |
| What do they think they should do first? | Type into the box. That part is right — the box is well-placed and autofocused. |
| Is Capture obviously useful? | It is obviously *inviting*. It is not obviously *useful*, because what comes back is a belief queue, not a handled obligation. |
| Is Today obviously central? | No. `/` is the capture box; `/today` is a separate destination. The brand link in the nav goes to Today, which is the only hint. |
| Is terminology exposed too early? | Yes. Before doing anything, the nav shows: Notes, Protocols, Process inbox, Belief inbox, Goals, Projects, Actions, Planning, Focus, Reading, Library, Knowledge, Constitution, Beliefs, Research, Daily Review, Insights, Timeline, Memory, Themes — and 20 more under **More**. **40 destinations.** |
| How long until practical value? | For a note or a book: under a minute — genuinely good. For a task: five steps and a mental model. For time-bound life: never, in the current build. |
| Life management or PKM? | **PKM.** The default output of the primary input is a belief. |

**Places where the user must understand the system before the system helps them:**

1. Capture → the difference between "Capture" and "Analyze" (there isn't a meaningful one; both call the model)
2. Capture → knowing `/process` exists at all
3. `/process` → knowing "convert" is the tab that makes a task
4. Three surfaces called Inbox
5. Constitution vs Beliefs — adjacent nav items, no way to tell them apart from their labels
6. Guiding Principle (Constitution) vs Principle (knowledge layer) — two live user-visible objects with the same word, acknowledged in `types/mvp.ts`
7. Standard vs Protocol vs Practice — three ways to describe how you intend to behave
8. Planning horizon vs due date vs deferred-until vs follow-up date — four different date-ish fields

---

## 4. Capture torture test

Executed against `classifyCapture` in `lib/capture/classify.ts` on `main`. These are actual outputs, not predictions.

| Input | Actual classification | Confidence | Natural? | Verdict |
|---|---|---|---|---|
| "I need to call my dentist." | `action` — title `call my dentist` | high | Yes | ✅ Correct |
| "I need to remember Mom's birthday." | `action` — title `remember Mom's birthday` | high | No | ⚠️ Wrong shape — this is a **date**, not a task. Becomes an undated to-do that will never complete. |
| "Marcus still owes me the document." | `note` | possible | No | ❌ Should be **waiting**. The extractor requires "waiting for/on" or "need X to respond"; the most natural phrasing misses. |
| "Book Mexico flights for October." | `action` — title keeps "for October" | high | Mostly | ⚠️ Right type, but "October" is **discarded as data** — it stays in the title string, never becomes `dueDate`. |
| "Interesting Jung idea about the shadow." | `note` | possible | Yes | ✅ Correct, and correctly *not* promoted to a belief. |
| "Chicken tortilla soup recipe from Mom." | `note` | high | Yes | ✅ Correct — the `recipe` marker beats the imperative content. This is the system at its best. |
| "I want to learn Spanish." | `action` — title `learn Spanish` | high | No | ❌ A **goal**, filed as a single next action. "Learn Spanish" will sit in the Next list forever. |
| "When I get angry, wait ten minutes before replying." | `protocol` — trigger `I get angry`, response `wait ten minutes before replying` | high | Yes | ✅ Excellent. Clean split, correct type, high confidence. |
| "Every Sunday refill my medication box." | `note` | possible | No | ❌ **Recurrence is unrepresentable.** Silently degrades to a note. |
| "Dentist appointment Tuesday at 2:30." | `note` | possible | No | ❌ **Events are unrepresentable.** Day and time both discarded. |

**Score: 4 clean, 2 partial, 4 failures.**

Observations:

- The rule ordering is genuinely well-designed. Protocol-before-action, waiting-before-action, and informational-markers-before-imperatives are all correct and non-obvious.
- **There is no date or time extraction anywhere in the classifier.** "October", "Tuesday at 2:30" and "Every Sunday" are treated as ordinary words. The one field that would matter most for life management is the one nothing populates.
- The failures cluster: three of four are about *time* (recurrence, events, dates), and one is about *people*.
- **No taxonomy knowledge is required to capture** — that part is well protected. The taxonomy cost lands later, at `/process`.
- **Smallest conceptual improvement:** extract dates and times into `dueDate` during classification, and add a `waiting` trigger for possessive/debt phrasing ("owes me", "still hasn't", "hasn't sent"). Neither requires a new noun.

---

## 5. Today review

| Question | Status | Evidence |
|---|---|---|
| What must I do today? | **SUPPORTED** | `TodayDueCard` → `dueTodayActions` |
| What is overdue? | **SUPPORTED** | `overdueActions`, past-tense wording, no scolding — tested in `lib/actions/selftest.ts` |
| What am I forgetting? | **PARTIALLY** | Surfaces undated/stale/dormant records via `TodayReturnCard` and Insights. Cannot surface an obligation that was never captured, and cannot surface anything time-bound. |
| What is waiting on someone? | **PARTIALLY** | `waitingDue` follow-ups appear in `TodayActions` — but only if the user typed "waiting for X" *and* set a follow-up date. |
| What should I return to? | **SUPPORTED** | `TodayReturnCard` — one item, always states its reason, dismissible, no streak. Genuinely well-judged. |
| What commitment is drifting? | **PARTIALLY** | Dormancy and stale-belief signals exist; there is no notion of a *commitment* drifting, only a record going quiet. |
| What should I prepare for? | **UNSUPPORTED** | Requires knowing what is *scheduled*. Nothing is scheduled. |
| What recurring responsibility matters? | **UNSUPPORTED** | `PracticeCadence` is explicitly "a cadence SUGGESTION only — LifeOS never schedules". There is no recurring obligation type. |

**Unsupported, ranked by damage to "Conqify helps me keep my life together":**

1. **What should I prepare for** — an appointment you miss is the canonical life-management failure. This is the difference between a thinking tool and a life tool.
2. **What recurring responsibility matters** — rent, medication, bins, standing meetings. This is most of the actual load of keeping a life together, and it is 100% absent.
3. **What commitment is drifting** — real but softer; the dormancy engine is a reasonable proxy.

One more structural point: **Today is a projection over records that exist.** It is honest and it never invents. But that makes its quality entirely dependent on intake — and intake is the weakest link (§4, §A). Fixing Today without fixing capture would improve nothing.

---

## 6. Time model review

Current model, from `types/mvp.ts`: `dueDate` (local day key, date-only), `deferredUntil` (day key), `followUpDate` (day key), `targetDate` on Goals/Projects/Milestones, planning horizon (an attention band, explicitly not a deadline). The type comment is candid: *"When real appointments arrive they belong to a future Event layer fed by a calendar — a due date must never be used as a fake calendar event."*

| Case | Status | Note |
|---|---|---|
| Dentist at 2:30 PM | **UNSUPPORTED** | Date-only by design. Time of day cannot be stored. |
| Class every Tuesday | **UNSUPPORTED** | No recurrence. |
| Rent every first of month | **UNSUPPORTED** | No recurrence. |
| Trash every Thursday | **UNSUPPORTED** | No recurrence. |
| Call me in three days | **AWKWARD** | Representable as `deferredUntil` or `followUpDate` — but the user must translate "in three days" into a date themselves. |
| Assignment due midnight | **SUPPORTED** | A due *day* is the right model here. |
| Medication every morning | **UNSUPPORTED** | Recurrence, and arguably the highest-stakes case in the list. |
| Birthday next month | **AWKWARD** | Storable as a dated action; semantically wrong (it is an annual event, not a task, and it will not recur next year). |
| Recurring staff meeting | **UNSUPPORTED** | Recurrence + time of day. |

**2 supported, 2 awkward, 5 unsupported.**

### Is the absence of Events / recurrence / reminders the single largest product hole?

**Recurrence and events: yes. Reminders: no — and they should be treated separately.**

The case for yes: five of nine time cases are flatly unrepresentable, four of ten capture cases fail on time, and two of the three highest-damage Today gaps are time gaps. No amount of philosophy compensates for an app that cannot hold "rent, the 1st."

The case for no, taken seriously: the *largest* hole might be intake, not time. A perfect time model behind a five-step filing process helps nobody. Time is the bigger absence; intake is the bigger blocker. Both are in Organization, which is why Organization is the layer to strengthen — but intake should go first because it is cheaper and it gates the value of everything after it.

**Reminders are a different question and the answer is currently no.** Conqify has no notification system of any kind — no service worker, no push, no email. That is a *deliberate* design position ("pull, not push. No notification, no badge, no streak, no guilt" — `TodayReturnCard`), and it is one of the more attractive things about the product. Adding events and recurrence does not require abandoning it: a calm app can know that rent is due on the 1st and simply *say so when you open it*. Notifications should stay off the roadmap until there is a specific reason they cannot.

---

## 7. Constitution review

**Would a normal user understand "Constitution"?** No. They will read it as either governmental or self-important. The word is doing work — it correctly implies *adopted*, *durable*, and *amendable* — but it asks for a leap before any value is delivered.

**Useful or grandiose?** Both, and the split is along a clean line. The *mechanism* is excellent: adoption gated on `adoptedAt`, drafts excluded entirely, revision history preserved, `excludeFromAi` per element, references rather than duplicates. The *framing* is grandiose: four kinds, a 14-domain interview, and a "Constitution Builder" before a single task has been handled.

**Do the four kinds make sense?** Purpose and Value do. **Guiding Principle vs Standard is the weak seam** — "How you intend to act" vs "A specific bar you hold yourself to" is a distinction most people will not reliably make, and getting it wrong has no recovery affordance beyond editing.

**Constitution vs Beliefs?** This is the single most expensive naming problem in the product. They are adjacent items in the same nav menu. Beliefs = what you hold true (with affirm/question/revise). Constitution = how you intend to live (with adopt/retire/revise). The distinction is real and defensible in the code; it is invisible in the interface.

**Standard vs Protocol?** Defensible and actually well-argued in the type docs: a Standard is a bar ("I reply within 24 hours"); a Protocol is conditional ("when X, do Y"); a Practice has a cadence. Three genuinely different shapes. But that is three nouns for "how I intend to behave", and a user meeting them in a nav menu has no way to know which one they want.

**Does it encourage over-formalization?** Yes. The interview walks 14 life domains and proposes up to 6 elements. That is a formalization ceremony placed at the point of *least* user investment.

**Why would someone return after building it?** This is the real problem. Today does not surface Constitution elements. Protocols are deliberately not surfaced ("no reliable trigger detection exists and a guessed trigger would be worse than none" — correct reasoning, but it means Protocols are write-only in practice). The Constitution → operations bridge exists in the schema (`linkedRefs`) and barely exists in the daily loop.

**Ongoing value or setup value?** **Currently setup-heavy, return-light.** The bridge is built; nothing walks across it.

**Strongest case FOR keeping it central:** It is the only thing in Conqify that is not a better-organized version of something else. Task managers do not ask what you are for. If Conqify is going to be more than a notebook with good provenance, this is where that comes from, and the mechanism is already sound.

**Strongest case AGAINST:** It is a large conceptual tax collected before any practical value has been delivered, on a product that cannot yet hold "dentist Tuesday at 2:30". A user who cannot trust Conqify with their week will not hand it their philosophy. **Keep it; stop putting it early.**

---

## 8. Notes / knowledge review

The principle *"Notes are allowed to simply be useful"* is genuinely protected, and this is a real win. `Note` has **no status, no lifecycle, no confidence, no epistemic standing** — the type comment is explicit that those are exactly what made every other record expensive to file into. Promotion is always an explicit user act (`lib/notes/promotion.ts`). An untitled note is a legitimate note.

| Test | Result |
|---|---|
| Recipe | ✅ Classified `note` at high confidence via the `recipe` marker |
| Travel note | ✅ Falls through to `note` |
| Guitar chords | ✅ `note` |
| Spanish vocabulary | ✅ `vocabulary` is an explicit note marker; "Spanish: por vs para" also hits the `Topic: detail` rule |
| Teaching idea | ✅ `note` |
| Health question | ⚠️ Classified `question` at `likely` — and `question` has **no destination** (`CONFIRMABLE_TYPES` excludes it). Handled honestly: it is offered as a Note and says so. Slightly awkward, not wrong. |
| Book excerpt | ✅ `note`, or the Reading layer |
| Household note | ✅ `note` |
| Random thought | ✅ `note` — the fallback, and the reason Note was built |

**Ordinary notes do stay ordinary.** This is the best-defended principle in the product.

**Where PKM gravity pulls the app away from life management:**

1. The **home page** — the primary input turns a captured thought into *belief proposals*. The default gravity of the main input is epistemic, not practical.
2. **`/inbox`** is the *Belief* inbox and is what the nav badge counts. The task-shaped inbox (`/process`) has no badge.
3. **Nav weight**: Learn + Reflect + Thinking tools = 16 destinations. Work = 5.
4. Today's collapsed "More from your notebook" contains Dialogues, Tensions, Research, Decisions, stale Beliefs, Reflection Prompts, Living Memory. Its *name* is "notebook" — the app's own self-description in the daily loop is a notebook.

---

## 9. Terminology audit

| Noun | Rating | Note |
|---|---|---|
| **Note** | IMMEDIATELY CLEAR | Correct, and correctly the fallback. |
| **Action** | IMMEDIATELY CLEAR | Labelled "Next action" in capture, which is even better. |
| **Project** | IMMEDIATELY CLEAR | Standard meaning, standard behaviour. |
| **Topic** | IMMEDIATELY CLEAR | And it is *not* a separate entity — a Topic **is** a Workspace. Good restraint. |
| **Workspace** | LEARNABLE | Familiar from other tools. Overlaps with Topic by design. |
| **Protocol** | LEARNABLE | Unusual word, but the `when → then` shape teaches itself, and the classifier reinforces it. |
| **Practice** | LEARNABLE / OVERLAPPING | Overlaps Standard and Protocol in the "how I behave" space. |
| **Belief** | SPECIALIST | Most people do not maintain a belief ledger. Adjacent to Constitution, which makes it worse. |
| **Constitution** | SPECIALIST | See §7. |
| **Principle** | OVERLAPPING | Knowledge-layer object. Collides with Guiding Principle. |
| **Guiding Principle** | OVERLAPPING | Constitution kind. The rename to "Guiding" is a mitigation for a collision that should not exist. |
| **Knowledge** | POSSIBLY UNNECESSARY | Nav label for `/world`. A category name, not a thing a user wants. |

**Most expensive conceptual overlaps, in order:**

1. **Constitution ↔ Beliefs** — adjacent nav items, both about "what I hold", no disambiguation at the point of choice.
2. **Principle ↔ Guiding Principle** — two live user-visible objects sharing a word. The codebase already documents this as a known collision.
3. **Standard ↔ Protocol ↔ Practice** — three nouns for how you intend to behave. Individually well-defined, collectively a maze.
4. **Three Inboxes** — Process inbox, Belief inbox, Conqify Inbox. Only one is badged, and it is the philosophical one.
5. **Four date-ish fields** — dueDate, deferredUntil, followUpDate, planning horizon. Each is individually justified in the type docs; together they are a lot to hold.

Nothing is merged or removed in this sprint. But #1 and #4 are naming/IA problems that could be fixed without touching the domain model.

---

## 10. Return-value review

**"Why do I open Conqify tomorrow?"** Today is the only honest answer, and Today is only as good as what got captured.

| Surface | Likely return frequency | Note |
|---|---|---|
| **Today** | DAILY | The correct daily home. Calm, explains itself, no guilt. |
| **Capture** | DAILY | Frictionless in, unclear out. |
| **Notes** | WEEKLY | Real recurring value — you go back for the recipe. |
| **Actions / due dates** | DAILY *if populated* | Machinery is strong; population is the problem. |
| **Projects** | WEEKLY | Standard. |
| **Reading** | OCCASIONAL | Deep and excellent, but book-shaped: intense then dormant. |
| **Return** | WEEKLY | Well-judged: one item, always explained, dismissible. |
| **Insights** | OCCASIONAL | Deterministic and honest. Interesting rather than needed. |
| **Constitution** | SETUP-HEAVY / RETURN-LIGHT | Large build ceremony, no daily surface. |

**Features with a strong creation experience but weak recurring value:**

1. **Constitution / Constitution Builder** — the most elaborate creation flow in the product, and Today never mentions it again.
2. **Protocols** — genuinely delightful to capture (the `when → then` split feels like magic), and *deliberately never surfaced*. Write-only.
3. **Dialogue / Tensions / Syntheses** — rich to create; they appear only inside a collapsed disclosure.
4. **Research projects** — same shape.
5. **Formation / Practices** — proposals with cadence, but nothing schedules or tracks them, by design.

The pattern is consistent: **Conqify is much better at helping you make something than at bringing it back.** Return and Living Memory are the two counterexamples, and they are the two features most worth extending.

---

## 11. Trust review

Settled invariants are not re-litigated here. Remaining concerns only:

**T1 — "Capture" and "Analyze" both call the model. (P1)**
On `/`, both buttons run `addCapture` and then `generateBeliefs(raw)`, which posts the raw text to `/api/ai`. The only difference is that "Analyze" navigates to `/inbox` afterwards. Offering two buttons where one is named "Analyze" tells the user the other one does not. The confirmation message — *"Saved on this device."* — is true about storage and lands immediately after a network round trip that sent the same text to a provider. Nothing in the product claims captures stay local, so this is misleading by affordance rather than a false statement; that is the same family as the LIFEOS-058A defect and should be fixed the same way.

**T2 — `excludeFromAi` exists only on Constitution elements. (P2)**
Grep confirms the field is on `ConstitutionElement` and nowhere else. A user who learns "Hide from AI" on the Constitution page will reasonably assume the control exists for notes, captures and sources. It does not. Nothing false is stated; the affordance is asymmetric, which over time reads as a false promise.

**T3 — "Not recorded" vs "not happening" is under-communicated for Protocols. (P2)**
The decision not to surface Protocols is correct and well-reasoned — guessed trigger detection would be worse than none. But a user who files "when I get angry, wait ten minutes" and never hears about it again cannot tell whether the system is respecting a boundary or has quietly lost the protocol. The reasoning is in the type docs where no user will read it.

**T4 — Brand inconsistency at first use. (P3)**
36 user-visible occurrences of "LifeOS" across 30 component/page files, including `/welcome`, which greets a brand-new user with *"Welcome to LifeOS"* while the nav says Conqify. Not a data-integrity issue; it is a credibility issue at the exact moment credibility is being established.

**Explicitly re-confirmed as healthy:** AI authorship visibility (`fromAiText`, `classifyOrigin`, `effectiveOrigin` least-privileged-wins); adoption gating on `adoptedAt`; deletion truthfulness after 058A; explainability of surfaced items (every Today/Memory item states its reason); local-first semantics with explicit sync.

---

## 12. Red team

**"Conqify is Notion with philosophy."**
*For:* 44 store domains, 40 nav destinations, and a general-purpose capture box. The surface area is Notion-like.
*Against:* Notion has no opinion. Conqify has provenance, adoption gating, deterministic explainable surfacing, and a refusal to score people — none of which Notion would ever build.
**Judgment: FALSE, but the sprawl makes it a fair first impression.** The differentiators are real and mostly invisible in the first fifteen minutes.

**"There are too many nouns."**
*For:* 44 domains; three "how I behave" nouns; two Principles; three Inboxes; four date fields.
*Against:* Almost every noun is individually well-argued in the type docs, and Note-as-fallback is genuine restraint.
**Judgment: TRUE.** Each addition was locally justified; the total was never re-examined. This is the classic failure mode of a well-documented codebase.

**"The Constitution is clever but unnecessary."**
*For:* Setup-heavy, return-light, no daily surface, most conceptually expensive thing in the product.
*Against:* It is the only genuinely differentiated layer, and the mechanism is sound.
**Judgment: HALF TRUE.** Not unnecessary — misplaced. It is currently an onboarding gate; it should be an earned destination.

**"This is PKM pretending to be life management."**
*For:* The primary input produces beliefs. The badged inbox is the belief inbox. Learn + Reflect + Thinking = 16 destinations vs Work = 5. Today's own disclosure calls itself "your notebook".
*Against:* Actions, dependencies, planning horizons, focus sessions and due-date handling are real and well-built.
**Judgment: TRUE AS EXPERIENCED, FALSE AS BUILT.** The life-management machinery exists; the product's centre of gravity points away from it. This is the most important finding in the review.

**"Today is too weak to replace a normal todo app."**
*For:* No time of day, no recurrence, no events, no reminders. A normal todo app has all four.
*Against:* Today does overdue, due-today, follow-ups, deferred-returns and one explained return item — and it does them without nagging, which no normal todo app manages.
**Judgment: TRUE ON COVERAGE, FALSE ON QUALITY.** What it does, it does better. It does too little.

**"There is no reason to open it every day."**
*For:* The high-investment features have no daily surface.
*Against:* Today, Return and due actions are a real daily loop.
**Judgment: FALSE, CONDITIONALLY.** There is a reason — but only for a user who got past the intake problem. For a new user, true.

**"AI adds complexity instead of removing it."**
*For:* The primary capture path uses AI to produce belief proposals that create a second queue to process. That is AI *adding* a decision.
*Against:* The capture classifier is deterministic, explainable, offline, and free — and it is the best-behaved intelligence in the product.
**Judgment: TRUE WHERE IT IS AI, FALSE WHERE IT IS RULES.** The deterministic classifier removes work. The generative belief pipeline adds it. That ratio should inform the roadmap.

**"A Calendar would provide more value than half the existing knowledge features."**
*For:* Five of nine time cases unrepresentable; four of ten capture cases fail on time; the two highest-damage Today gaps are both time.
*Against:* A calendar is a large surface with real integration and timezone cost, and Conqify would be a poor calendar client.
**Judgment: TRUE, with a correction — it is not a *calendar* that is needed, it is a *time model*.** Events with a time of day, and recurrence. Calendar *sync* is a later and separable question.

**"The product reflects the founder's worldview more than a general user's life."**
*For:* The deepest, most loved parts are Constitution, Beliefs, Dialectic, Formation, Reading. The thinnest parts are appointments, recurring chores, and people. That is a portrait of the builder.
*Against:* Notes-stay-ordinary, the calm Today, and the refusal to nag are all decisions made *against* the builder's instinct toward formalization.
**Judgment: TRUE, and it is the most useful criticism on this list.** It is not fatal — a strong worldview is why the differentiators exist — but the next three sprints should be chosen by someone else's life.

---

## 13. Delight review — what to protect

Only strengths supported by actual behaviour in the code:

1. **Provenance.** `fromAiText`, `classifyOrigin`, `effectiveOrigin` with least-privileged-wins, and the rule that confirming a suggested structure is not authorship. Rare, tested, load-bearing.
2. **User authority.** Nothing is created without confirmation. Even "Call the dentist" yields a proposal, never an action.
3. **Notes stay ordinary.** No status, no lifecycle, no confidence. Promotion is always explicit.
4. **The Protocol split.** `when → then` extraction is the single most delightful moment in the product.
5. **Explainability.** Every surfaced item in Today, Return and Living Memory states why it appeared, as a fact rather than a judgment.
6. **The quiet Today.** Past-tense overdue wording, no counts, no "you're behind", no streaks — asserted by tests, not just intended.
7. **Return, done right.** One item, never a list, always explained, dismissible at no cost, not recorded as failure.
8. **Deterministic intelligence.** The classifier and the insight engines are pure functions: no latency, no cost, no provider drift, testable.
9. **Local-first privacy.** Real, and the deletion paths are honest after 058A.
10. **Reading → life integration.** The ingestion depth is genuinely beyond what this category normally attempts.

---

## 14. Friction ledger

---

**F1**
**FACT:** The primary capture surface sends text to a model and returns *belief proposals*; turning that same text into a task requires navigating to `/process`, opening the capture, selecting `convert`, and confirming.
**WHY IT MATTERS:** This is the first thing every user does, and it teaches them that Conqify is for thinking, not for handling.
**PERSONA:** A (severe), C (severe), B (mild)
**SEVERITY:** P1 · **FREQUENCY:** Every capture
**CURRENT WORKAROUND:** Learn the `/process` route; or give up and use another app for tasks.
**ROOT CAUSE:** The belief pipeline (the oldest feature) still owns the home page; the deterministic classifier (the newest and best) is buried two navigations deep.
**POSSIBLE FIX:** Show the classification inline on the capture surface with a one-tap confirm. The classifier is pure, synchronous and free — there is no technical reason it cannot run as you type.
**DO NOT IMPLEMENT YET.**

---

**F2**
**FACT:** No time of day, no recurrence, no events. Five of nine time cases unrepresentable; "Dentist Tuesday at 2:30" and "Every Sunday refill my medication box" both silently degrade to notes.
**WHY IT MATTERS:** Appointments and recurring obligations are most of the actual work of keeping a life together.
**PERSONA:** A (severe), C (severe)
**SEVERITY:** P1 · **FREQUENCY:** Weekly or more
**CURRENT WORKAROUND:** The phone's calendar and reminders app — which means Conqify is not where the user's day lives.
**ROOT CAUSE:** LIFEOS-053 deliberately shipped a minimal date-only model and deferred Events; the deferral was correct then and has not been revisited.
**POSSIBLE FIX:** An Event record with a local datetime, and a recurrence rule on Actions. Not calendar sync — a time model.
**DO NOT IMPLEMENT YET.**

---

**F3**
**FACT:** The classifier performs no date or time extraction. "for October", "Tuesday at 2:30" and "Every Sunday" are treated as ordinary words and survive only inside the title string.
**WHY IT MATTERS:** `dueDate` exists and is well-built, and nothing populates it automatically. The user must set every date by hand after filing.
**PERSONA:** A, C
**SEVERITY:** P2 · **FREQUENCY:** Every dated capture
**CURRENT WORKAROUND:** Manual date entry on the action detail screen.
**ROOT CAUSE:** LIFEOS-054 scoped the classifier to type routing only.
**POSSIBLE FIX:** Deterministic date extraction into `extracted.dueDate`, shown for confirmation like every other extracted field. No new noun; no model call.
**DO NOT IMPLEMENT YET.**

---

**F4**
**FACT:** "Marcus still owes me the document" classifies as `note`. The waiting extractor requires "waiting for/on" or "need X to respond".
**WHY IT MATTERS:** Follow-ups are the highest-value thing a life system can catch, and the natural phrasing misses.
**PERSONA:** C (severe), A
**SEVERITY:** P2 · **FREQUENCY:** Weekly
**CURRENT WORKAROUND:** Phrase it as "waiting on Marcus for the document".
**ROOT CAUSE:** Two narrow regexes.
**POSSIBLE FIX:** Add debt/possession patterns ("owes me", "still hasn't", "hasn't sent", "supposed to send").
**DO NOT IMPLEMENT YET.**

---

**F5**
**FACT:** There is no People noun. "Marcus", "Mom" and "my dentist" are strings inside titles.
**WHY IT MATTERS:** Three of the ten torture sentences involve a person. Waiting, birthdays, follow-ups and household coordination are all people-shaped.
**PERSONA:** A, C
**SEVERITY:** P2 · **FREQUENCY:** Constant
**CURRENT WORKAROUND:** Tags, or nothing.
**ROOT CAUSE:** Never scoped. A People noun was never on the roadmap.
**POSSIBLE FIX:** The smallest version is not a CRM — it is a `waitingOnPerson` string that groups, so "what is Marcus sitting on?" is answerable.
**DO NOT IMPLEMENT YET.**

---

**F6**
**FACT:** 40 nav destinations across 6 top-level menus, before the user has created a single record.
**WHY IT MATTERS:** It signals "this is a system to learn", not "this will help you today".
**PERSONA:** A (severe), C
**SEVERITY:** P2 · **FREQUENCY:** Every session
**CURRENT WORKAROUND:** ⌘K, which is excellent — for users who find it.
**ROOT CAUSE:** Every sprint added a destination; none removed one.
**POSSIBLE FIX:** Progressive nav — reveal a destination once its record type exists. The state to drive this already exists.
**DO NOT IMPLEMENT YET.**

---

**F7**
**FACT:** Three surfaces named Inbox (`/process`, `/inbox`, `/orchestrator`), and the badge counts the belief one.
**WHY IT MATTERS:** "Inbox" is the most load-bearing word in personal productivity. Three of them means none of them.
**PERSONA:** all
**SEVERITY:** P2 · **FREQUENCY:** Every session
**CURRENT WORKAROUND:** Memorise which is which.
**ROOT CAUSE:** Three features each correctly needed a queue; nobody owned the shared vocabulary.
**POSSIBLE FIX:** One Inbox (captures). Rename the other two to what they are — "Belief proposals", "Suggestions".
**DO NOT IMPLEMENT YET.**

---

**F8**
**FACT:** Both buttons on `/` call the model; only one is named "Analyze". The confirmation says "Saved on this device."
**WHY IT MATTERS:** Same family as the LIFEOS-058A defect: a true sentence positioned so it implies something false.
**PERSONA:** all
**SEVERITY:** P1 · **FREQUENCY:** Every capture
**CURRENT WORKAROUND:** None — the user cannot capture without a model call.
**ROOT CAUSE:** The belief pipeline was the original product; the button pair was never revisited.
**POSSIBLE FIX:** Make plain Capture local-only and let the classifier (which is already local) do the work; keep AI behind the explicit second button.
**DO NOT IMPLEMENT YET.**

---

**F9**
**FACT:** Constitution and Beliefs are adjacent nav items with no disambiguation at the point of choice.
**WHY IT MATTERS:** The most expensive naming collision in the product, on the two most conceptually demanding features.
**PERSONA:** A, C
**SEVERITY:** P2 · **FREQUENCY:** Every nav open
**CURRENT WORKAROUND:** Trial and error.
**ROOT CAUSE:** `/constitution` and `/beliefs` were split in LIFEOS-056 for good architectural reasons; the nav inherited both.
**POSSIBLE FIX:** One-line hints in the menu, or one "How I intend to live" destination with two sections.
**DO NOT IMPLEMENT YET.**

---

**F10**
**FACT:** Protocols are deliberately never surfaced, and the product never says so.
**WHY IT MATTERS:** The user cannot distinguish a respected boundary from a lost record.
**PERSONA:** B, A
**SEVERITY:** P3 · **FREQUENCY:** Per protocol
**CURRENT WORKAROUND:** Visit `/protocols`.
**ROOT CAUSE:** Correct engineering decision, undocumented in the interface.
**POSSIBLE FIX:** One sentence on the protocol surface: *Conqify will not watch for this trigger — it is here for you to re-read.*
**DO NOT IMPLEMENT YET.**

---

**F11**
**FACT:** 36 user-visible "LifeOS" strings across 30 files, including the welcome tour.
**WHY IT MATTERS:** A new user meets two product names in the first minute.
**PERSONA:** all
**SEVERITY:** P3 · **FREQUENCY:** First run, then intermittent
**CURRENT WORKAROUND:** None.
**ROOT CAUSE:** Rename was applied to the nav and not swept.
**POSSIBLE FIX:** A sweep plus a test asserting no user-visible "LifeOS" remains.
**DO NOT IMPLEMENT YET.**

---

**F12**
**FACT:** "I want to learn Spanish" classifies as an `action` with title "learn Spanish".
**WHY IT MATTERS:** A goal filed as a next action becomes permanent debris in the Next list — the exact failure that makes people abandon task systems.
**PERSONA:** A, C
**SEVERITY:** P3 · **FREQUENCY:** Occasional
**CURRENT WORKAROUND:** File as a Goal manually.
**ROOT CAUSE:** "I want to" is grouped with "I need to" in one regex; Goals are never a classifier destination.
**POSSIBLE FIX:** Separate "I want to" + a non-action verb and route to Goal at `possible` confidence.
**DO NOT IMPLEMENT YET.**

---

## 15. Top 10 product problems

1. **The primary capture path produces beliefs, not handled obligations** (F1)
2. **No time of day, no recurrence, no events** (F2)
3. **No date extraction — `dueDate` exists and nothing fills it** (F3)
4. **Both capture buttons call the model; only one says so** (F8)
5. **The product's centre of gravity points at Understanding while its promise is Organization** (§12)
6. **Constitution is setup-heavy and return-light — the bridge is built, nothing crosses it** (§7, §10)
7. **40 nav destinations before the first record** (F6)
8. **Three Inboxes, and the badge counts the philosophical one** (F7)
9. **Waiting only triggers on two narrow phrasings; there is no People noun** (F4, F5)
10. **Constitution ↔ Beliefs and Principle ↔ Guiding Principle are unresolvable from the interface** (F9, §9)

## Top 10 things to protect

1. Provenance — `fromAiText`, `classifyOrigin`, least-privileged `effectiveOrigin`
2. User authority — nothing is created without confirmation
3. Notes stay ordinary — no status, no lifecycle, no confidence
4. The `when → then` Protocol split
5. Explainability — every surfaced item states its reason as a fact
6. The quiet Today — no counts, no "behind", no streaks, tested
7. Return — one item, always explained, dismissible at no cost
8. Deterministic intelligence — pure, offline, free, testable
9. Local-first privacy and honest deletion
10. Reading → life integration

Neither list is padded.

---

## 16. Product thesis score

| Layer | Score | Reasoning |
|---|---|---|
| **LIFE ORGANIZATION** | **2 / 4** — usable | The machinery is strong: Actions with status/defer/waiting/dependencies/templates/horizons, Projects, Goals, Milestones, Workspaces, and a Today that handles overdue and due-today well. It is held to 2 by two things — getting an obligation *in* takes five steps, and half of ordinary life (appointments, recurrence, people) cannot be represented at all. |
| **LIFE UNDERSTANDING** | **3 / 4** — strong | Reading ingestion, hybrid retrieval, hierarchical summarization, belief ledger, Constitution with adoption gating and revision history, Dialogue/Tensions/Syntheses, Living Memory, deterministic resurfacing. Provenance alone is near-exceptional. Not a 4 because the breadth is undisciplined — many of these are write-only in daily practice. |
| **LIFE GUIDANCE** | **2 / 4** — usable | Today, Return, dormancy, deterministic Insights, orchestrator recommendations — all real, all explainable, none manipulative. Capped at 2 because guidance can only speak about what was captured, and it cannot speak about time at all. |

**WHICH LAYER IS OVERBUILT?** **Understanding.** Reading, Dialectic, Research, Formation, Themes, Memory, Timeline, Knowledge, Beliefs, Constitution — ten substantial surfaces, most with no daily return path.

**WHICH LAYER IS UNDERBUILT?** **Organization** — specifically *intake* and *time*. Not the data model, which is good; the path in and the vocabulary of when.

**WHICH LAYER SHOULD THE NEXT THREE SPRINTS STRENGTHEN?** **Organization**, all three. Understanding needs no new features for a long time. Guidance will improve on its own as soon as Organization is populated, because Today is already a faithful projection — it is currently faithful to an empty room.

---

## 17. Roadmap candidates

| Candidate | User problem | Frequency | Workaround today | Organization value | Cognitive cost | Smallest useful version | Rank |
|---|---|---|---|---|---|---|---|
| **One-step intake** | Capture doesn't produce a handled thing | Every capture | Learn `/process` | Very high | **Negative** (removes concepts) | Classification inline on the capture surface with one-tap confirm | **NOW** |
| **Date/time extraction** | `dueDate` is never populated | Every dated capture | Manual entry | Very high | Negative | Deterministic extraction into an existing field | **NOW** |
| **Events (datetime)** | Appointments unrepresentable | Weekly+ | Phone calendar | Very high | Medium — one new noun | An Event with a local datetime, shown in Today | **NOW** |
| **Recurrence** | Rent, meds, bins, standing meetings | Daily | Phone reminders | Very high | Medium | A recurrence rule on Actions/Events; next occurrence only | **NOW** |
| **Waiting / follow-up (broader)** | Natural phrasing misses | Weekly | Rephrase | High | Low | More trigger patterns + a "who owes me what" view | **SOON** |
| **People (lite)** | No person noun | Constant | Tags | High | Medium — resist CRM | `waitingOnPerson` that groups; not a contact record | **SOON** |
| **Household / recurring responsibilities** | Chores, bills | Weekly | Reminders app | High | Low *if* recurrence exists | Falls out of recurrence — not a separate feature | **SOON** |
| **Reminders / notifications** | Being told without opening | Daily | Phone | Medium | **High** — abandons "pull, not push" | None yet. Events + recurrence deliver most of the value while the app stays quiet | **LATER** |
| **Goals (strengthened)** | "Learn Spanish" has nowhere good to go | Monthly | File manually | Medium | Low | Route `I want to` + non-action verb to Goal | **LATER** |
| **Patterns** | "What keeps happening?" | Monthly | Insights | Medium | Medium | Extends existing deterministic insights | **LATER** |
| **Time & Attention** | Where hours go | Monthly | Nothing | Low | High | — | **MAYBE** |
| **Relationship graph** | Map people | Rare | Nothing | Low | High | People-lite must exist and be used first | **MAYBE** |
| **Drive / Docs** | Files alongside records | Occasional | Links | Low | Medium | Not until intake is fixed | **MAYBE** |
| **Contacts sync** | Populate People | Rare | Manual | Low | High — real privacy cost | Only after People-lite proves itself | **MAYBE** |
| **Gmail** | Email → obligations | Daily | Manual | Medium | **Very high** — privacy, volume, a fourth inbox | — | **NO** |
| **Personal Observatory** | Whole-life dashboard | Rare | Insights | Low | Very high | — | **NO** (Understanding is already overbuilt) |
| **Integral lenses** | Structured self-analysis | Rare | Dialectic | Very low | Very high | — | **NO** (worldview feature on an underbuilt base) |

---

## 18. Recommended next three sprints

### Sprint 1 — Capture lands where it belongs

**Problem solved:** F1, F3, F8, F12. The distance between "I need to call my dentist" and a task you will actually see is five steps and a model call.

**Why now:** It gates everything. A perfect time model behind a five-step filing process helps nobody, and this sprint *removes* concepts rather than adding them — the cheapest high-value work available.

**Smallest useful scope:**
- Run `classifyCapture` inline on the capture surface as the user types (it is pure, synchronous and free)
- Show the suggested destination with a one-tap confirm; "Keep as note" is always one tap away
- Add deterministic date/time extraction into `extracted.dueDate`, shown for confirmation like every other extracted field
- Make plain **Capture** local-only; keep the model behind the explicit second button, correctly labelled
- Route "I want to" + a non-action verb to Goal at `possible` confidence

**What NOT to include:** No new nouns. No AI fallback classification. No nav restructure. No touching the belief pipeline beyond the button split.

**Expected improvement:** Organization 2 → 3. Guidance 2 → 3 as a side effect, because Today finally has something faithful to project.

---

### Sprint 2 — A model of time

**Problem solved:** F2. Five of nine time cases and four of ten capture cases are currently unrepresentable.

**Why now:** With intake fixed, this is the largest remaining hole, and it is the one that decides whether Conqify can hold a person's actual week.

**Smallest useful scope:**
- An `Event` record with a local datetime — *only* a title, a datetime and links
- A recurrence rule on Actions and Events, materialising **the next occurrence only** (no infinite series, no expansion)
- Today gains one line: what is scheduled today, with times
- Extend Sprint 1's extraction to recognise times and simple recurrences ("every Sunday", "the 1st")

**What NOT to include:** No calendar sync. No timezone travel handling. No notifications — Conqify stays pull-only. No attendees, locations, invites, or reminders-before.

**Expected improvement:** Organization 3 → 4. Guidance 3, now able to answer *what should I prepare for*.

---

### Sprint 3 — Who owes me what

**Problem solved:** F4, F5. Follow-ups are the highest-value catch a life system makes, and the natural phrasing currently misses entirely.

**Why now:** With intake and time solved, this is the largest remaining category of dropped obligation — and it is small.

**Smallest useful scope:**
- Broaden waiting detection: "owes me", "still hasn't", "hasn't sent", "supposed to send"
- A `waitingOnPerson` string on waiting actions, with a grouped view answering "what is Marcus sitting on?"
- Today's follow-up line names the person

**What NOT to include:** **No People record.** No contact fields, no relationship graph, no Contacts import, no birthdays. A grouping string, and stop. If it proves itself, a People noun can be argued for on evidence.

**Expected improvement:** Organization 4. Guidance 3 → 4 on the "what am I forgetting" question, which is the one users actually value.

---

## 19. Things we should not build yet

- Gmail, Drive/Docs, Contacts — integrations before the core loop works
- Notifications and reminders — abandons "pull, not push" for value that events + recurrence largely deliver anyway
- Personal Observatory, Integral lenses, relationship graph, Time & Attention — all Understanding, which is already overbuilt
- Any new Constitution surface — it needs a *reason to return*, not more depth
- A People/CRM record — earn it with the Sprint 3 string first
- Nav restructure — the right time is after Sprints 1–3, when the correct hierarchy will be obvious
- More AI anywhere — the deterministic classifier removes work; the generative pipeline adds it

---

## 20. Founder dogfood plan — 7 days

Real life only. No synthetic feature usage: do not open a surface to exercise it, and do not file something you would not otherwise have filed. **Leaving Conqify for another app is the most valuable data point in this protocol** — record it precisely rather than avoiding it.

**Daily entry (`docs/dogfood/YYYY-MM-DD.md`):**

```
WHAT I TRIED TO DO:
WHAT I EXPECTED:
WHAT HAPPENED:
FRICTION:
WHAT FELT USEFUL:
WHAT I USED ANOTHER APP FOR:
WHY I LEFT CONQIFY:
```

**Suggested emphasis — a lens per day, not a script:**

| Day | Lens |
|---|---|
| 1 | Capture only. Everything that crosses your mind goes in the box. Do not process. Count how many you later could not find. |
| 2 | Try to run the day from Today alone. Note every time you check another app instead. |
| 3 | Something time-bound (appointment, deadline, bill). Record what you did when it would not fit. |
| 4 | Something recurring. Record what you did instead. |
| 5 | Something involving another person — waiting, owed, coordinated. |
| 6 | Ordinary life: a recipe, a household note, an errand. Does the ordinary stay ordinary? |
| 7 | Open Conqify with no agenda. Write down what it tells you, and whether you needed it. |

**Rules:**
- Record friction the moment it happens, not at the end of the day
- Never fix anything mid-week — this is measurement, not development
- If you avoid a feature, write down why; avoidance is the finding
- On day 7, name the one thing that would have made the week work

The output feeds sprint scoping. It does **not** feed a telemetry system — that is what this sprint replaced.

---

## Method and limits

Everything above comes from reading `main` at `3705edc` and executing the capture classifier directly. The ten torture-test classifications in §4 are real program output.

**What this review does not have:** any observation of a person other than the founder using the product. Every persona judgment is a reasoned inference from code and copy, not evidence from a user. §20 exists to start closing that gap with one real user, honestly recorded — and even then it is n=1, and the founder is the least representative user available.
