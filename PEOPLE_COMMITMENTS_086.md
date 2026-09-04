# LIFEOS-086 — People & Commitments

**North star:** when my life involves someone else, Conqify should remember who,
what I owe them, and what I'm waiting on.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `ac99313fd07e885e01240e1dd7297850444ac85e` (PR #91 merged) |
| Branch | `claude/lifeos-086-people-commitments` |
| Migration required | **no** — see §1.7 |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured by running a realistic fixture through the real builders: two people
named Marcus, a waiting record on Maria with a follow-up due today, a waiting
record on Jordan with a follow-up six days out, a waiting record on *a company*,
a completed commitment to Marcus, a project whose description names Priya, a
user reflection about Marcus, and an AI-authored note about Marcus.

## 1.1 A / C / F — Is "person" a domain? **No.**

```
store keys matching person|people|contact:  []
index kinds:  ["action","goal","note","project","reflection"]
app routes matching peop|contact|person:    (none — only /personal-code)
```

There is **no Person type, no people array, no contacts route, and no `person`
ref kind**. `RecordRefLite` is `{ kind: string; id: string }` with an open
`kind`, but there is no person record for one to point at.

People exist as **plain strings**, in exactly two shapes:

| Shape | Structured? | Notes |
|---|---|---|
| `NextAction.waitingOn` | yes, one field | documented *"Free text: what/who this action is waiting on"* — so it holds `"Maria"` **and** `"the letting agency"` |
| Names written into prose | no | action titles, note bodies, reflection responses, project descriptions |

`Dialogue.participants` is `Perspective[]` — AI reasoning perspectives, not
people. `LifeEvent` is explicitly documented as having *"no attendees, no
organizer"*.

## 1.2 G — Is waiting tied to a person record? **No — free text.**

```
"Transcript"   waitingOn="Maria"                followUp=2026-09-04
"Signed form"  waitingOn="Jordan"               followUp=2026-09-10
"Lease copy"   waitingOn="the letting agency"   followUp=undefined
```

One field, three strings, and one of them is not a person at all. Any person
model built here must not assume otherwise.

## 1.3 The measured reds

### RED 1 — six of §3's eight questions do not route at all

```
"What do I owe Marcus?"                  → plan NONE
"What did I last say about Alex?"        → plan NONE
"Which Projects involve Priya?"          → plan NONE
"Which Goals involve Daniel?"            → plan NONE
"What should I follow up on with Jordan?"→ plan NONE
"What commitments involve Marcus?"       → plan NONE
```

Every one names records that exist.

### RED 2 — the worst kind: a wrong answer that looks right

```
"What am I waiting on from Maria?"
   plan = WAITING  entity="maria"      status = ANSWERED
   "3 items are waiting on someone else."
   items: ["Transcript", "Signed form", "Lease copy"]
```

The planner **extracted the person and the answer discarded her**:
`answerWaiting` never reads `plan.entityQuery`. So the product confidently
reports Jordan's form and a letting agency's lease as things it is waiting on
*from Maria*. This is the defect LIFEOS-081 fixed for `answerChanges`, still
live in the waiting branch.

### RED 3 — a person's name resolves to an action, and is then used as a name

```
"What is unresolved with Sarah?"
   plan = OPEN_WORK  entity="sarah"
   "Nothing Conqify has recorded about Call Sarah back about the invoice
    is asking for attention right now."
```

`resolveEntities` matched the *action* whose title contains "Sarah", and the
answer then addressed that action title as though it were the person.

### RED 4 — an AI-authored note is the top result for a person's name

```
"Marcus" → Note: "AI summary: Marcus seems responsive lately."   ← first
           Reflection: "I keep putting off replying to Marcus…"
           Action: Send Marcus the deposit        (completed)
           Action: Email Marcus the draft lease
           Action: Ask Marcus Webb for the survey
```

A model's sentence about a person outranks the person's own commitments and the
user's own words (§16, §33).

### RED 5 — ambiguity is completely invisible

Three actions name a Marcus; at least two are different people
("Marcus" / "Marcus Webb"). Nothing anywhere surfaces the ambiguity, and
nothing merges them either — because nothing looks (§7, §8, §25).

## 1.4 Not reds — verified, kept as forward guards

- **Follow-up timing is already factual.** Only Maria's `follow_up_due` fired;
  Jordan's follow-up six days out did not (§11, §40.4).
- **Waiting semantics already exist** and are reusable as-is (§10).
- **Completed work is excluded** from commitment signals by construction.
- **No relationship scoring, sentiment or CRM machinery exists** anywhere to
  remove (§4, §32).

---

# 2. J — the smallest architecture

## 2.1 Migration decision (§5, §6): **none required**

All eight of §3's questions are answerable from data the store already holds:

| Question | Grounded in |
|---|---|
| What do I owe X? | open Actions whose text the **user wrote** X into |
| What am I waiting on from X? | `waitingOn` — already structured |
| What should I follow up on with X? | `followUpDate` on those waits |
| What is unresolved with X? | the above + existing commitment signals |
| What did I last say about X? | user-authored notes and reflections |
| Which Projects / Goals involve X? | records whose own text names X |

A Person **table** would not improve any of these until the user had first
created and maintained person records — which is a contact book, and §4 forbids
one. So the sprint proceeds without persistence.

## 2.2 What that costs, stated rather than hidden (§25)

A derived model **cannot establish identity**. It can only say: *these records
contain this name.* Therefore:

- "Marcus" and "Marcus Webb" are treated as **distinct references**, never
  merged, and the ambiguity is surfaced (§7, §8).
- Two different people who share a first name **cannot** be told apart, and the
  product must say so rather than imply one person.
- There is no dedup, because there is nothing to dedup — as §25 directs, the
  limitation is recorded instead of faked.

## 2.3 The build

1. **`lib/people/context.ts`** — one pure `buildPersonContext(state, name, …)`
   returning open commitments, waiting, follow-ups, projects/goals, recent
   user-authored mentions and person-linked attention. No score, no roster.
2. **Fix `answerWaiting` to honour `plan.entityQuery`** (RED 2).
3. **Memory: a `PersonAspect` on existing classes**, not six new nouns (§19).
4. **Search: a Person row** when a query names something the store treats as a
   person reference, linking to the person view (§18).
5. **A lightweight `/people/[name]` detail route** so a result has somewhere to
   open. **No roster list** — enumerating "people" from string matching would
   present "the letting agency" as a person and would claim a set of
   relationships Conqify cannot vouch for (§27, §28).

## 2.4 Ownership precedence, to avoid the three-row problem (§36)

    WAITING            owns any record with status `waiting`
    OPEN COMMITMENTS   owns ordinary open actionable work
    ATTENTION          never owns a row; it attaches its reason inline

---

*Sections 3 onward are written as the implementation lands.*
