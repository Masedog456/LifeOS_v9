# LIFEOS-086 — People & Commitments

**North star:** when my life involves someone else, Conqify should remember who,
what I owe them, and what I'm waiting on.

## STATUS: COMPLETE

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


# 3. The person identity model

**There isn't one, and that is the design.** People stay plain strings; this
sprint adds a derived read model that answers *what has Conqify recorded that
names this person?* and never claims more.

| Claim | Made? |
|---|---|
| "These records name this string" | yes |
| "This string is a person" | only where the text is capitalised and something is recorded |
| "These two strings are the same person" | **never** |
| "This person is a friend / coworker / manager" | never — nothing records it |
| Any score, health, sentiment or closeness | never |

`longerForms` surfaces ambiguity and resolves nothing. Memory returns
`NEEDS_CHOICE` for "Marcus" when "Marcus Webb" also exists, offering both.

# 4. Reuse vs new domain (§5, §6)

Reuse, entirely. `NextAction.waitingOn` is the one structured place a person is
recorded and is used as-is; commitment signals, resolutions, provenance,
`resolveMemoryRange` and the LIFEOS-085 search index are all composed rather
than duplicated. **Migration head stays at 0047.**

# 5. Semantics

## 5.1 What "owe" means (§12)

Open work whose **title** the user wrote the name into. Not notes, not
description, not a project's prose. A name in a note is a mention, kept in a
different field and worded differently — the deterministic suite asserts an
open action reading *"Priya asked for the oak ones"* in its notes is **not**
something owed to Priya.

## 5.2 What "waiting" means (§10, §13)

`status === "waiting"` with a matching `waitingOn`. Framed as what the user is
waiting on, never as a debt the other person owes.

## 5.3 Ownership precedence (§36)

    WAITING           owns any record whose status is `waiting`
    OPEN COMMITMENTS  owns ordinary open actionable work
    ATTENTION         owns nothing; it attaches its reason to the owning row

The fixture's wait is titled *"Transcript from Maria"* **and** has
`waitingOn: "Maria"`, so both claims are live and the precedence has something
to decide.

## 5.4 Projects and goals (§14, §15)

Only where the record's **own** title or description names them. A project
reached through an action that mentions someone is a second hop through prose
that is not the project's, and is excluded.

## 5.5 Dates (§34)

`waitingSince` and `createdAt`; never `updatedAt` standing in. The fixture holds
a note written six days ago and edited yesterday, asserted to date from when it
was written.

# 6. Integration

- **Memory (§19):** one `PERSON` class with five aspects — `owe`, `waiting`,
  `mentions`, `links`, `all` — not six new nouns. A person's name is read from
  the raw question so capitalisation survives.
- **Search (§18):** a Person row, first, that **opens** the view rather than
  duplicating it. `personHint` is a cheap scan, not the full model, because
  search runs on every keystroke.
- **Today (§22):** untouched. No People section, no ranking change.

# 7. Verification

| Gate | Result |
|---|---|
| Deterministic, all suites | **5182 / 5182**, 50 suites (was 5031 / 5031, 49) |
| `people` suite | **151 / 151** |
| Browser torture, 086 | **53 / 53** |
| Mutation proofs | **18 / 18 caught** |
| 078–085 browser suites | 93 / 97 / 109 / 72 / 64 / 77 / 62 / 54 — all pass |
| release · rls · auth · routes · wiring · mappers · export · secrets | pass |
| route-smoke (production build) | 24 / 24 |
| `tsc` · `eslint` · `next build` | clean (2 pre-existing warnings) |
| Performance | 8 person summaries over 5,000 records < 3000ms; 8 name hints < 1000ms |

## 7.1 The four mutations that escaped

Three were fixture gaps — the fixture did not contain the case the mutation
would break, so the assertion could not have failed:

- No action named someone in its **notes** without also naming them in its
  title, so obligation-from-mention was untestable.
- The wait was titled "Transcript", so it could only ever appear in one section
  whatever the precedence said.
- Every note had `createdAt === updatedAt`, so the date rule was untestable.

The fourth was a **broken mutation, not a passing test**: `personHint` carries a
byte-identical archived check and appears earlier in the file, so replacing the
first occurrence patched a function the assertion does not exercise.

Three assertions were also wrong before the product was: two matched the bare
word "spoke" inside the sentence whose entire job is to say *"not whether you
spoke"*, and one flagged `"title"` as a contact-enrichment field, failing on the
user's own action titles rather than on a contact card.

## 7.2 What §42's visual review found

Two defects that 148 deterministic and 53 browser assertions all missed:

1. **"Due Sun, Sep 6" printed twice on one row** — once as the row's meta, once
   as the signal's explanation beneath it.
2. **"Ask Marcus Webb for the survey" listed as Marcus's work, unqualified,
   directly beneath a banner saying Conqify cannot tell whether Marcus Webb is
   the same Marcus.** The page was acting on an identity claim its own notice
   disclaims. A row matched through a longer name now says which name the
   record used, so the ambiguity travels with the row.

# 8. Limitations, stated (§25)

- **Identity cannot be established.** Two people who share a first name cannot
  be told apart, and the page says so on every view. There is no dedup, because
  there is nothing to dedup.
- **`waitingOn` holds things as well as people** — it is documented "what/who".
  A person view is only ever reached by naming someone, and the capitalisation
  guard keeps "the letting agency" from being offered as a person.
- **No roster.** Enumerating people from string matching would present that
  letting agency as a person and would claim a set of relationships Conqify
  cannot vouch for, so `/people/[name]` exists and `/people` does not.
- **Search still ranks an AI-authored note about a person among the results**,
  correctly attributed ("Written by Conqify") by LIFEOS-085. It is excluded from
  the person view's mentions, where authorship is the section's whole claim.
- **No communication is recorded anywhere in the schema**, so nothing ever says
  "you last spoke to them" — only "your latest recorded mentions".

# 9. Product claims (§46)

1. **A person is resolved safely where identity exists** — and where it does
   not, the ambiguity is returned rather than guessed. ✅
2. **Open commitments involving them are visible.** ✅
3. **Waiting-on context is visible**, from the structured field. ✅
4. **Follow-up timing is factual** — a follow-up six days out is stated as its
   date, never as due. ✅
5. **Projects and goals appear only when grounded** in the record's own text. ✅
6. **Recent mentions preserve provenance** — machine prose is excluded from the
   section whose claim is authorship. ✅
7. **Ambiguous names are never silently merged** — `NEEDS_CHOICE`, and a
   per-row note saying which name the record used. ✅
8. **Mere mention is not obligation.** ✅
9. **Search retrieves person context** through a row that opens the view. ✅
10. **It is not a CRM** — no roster, no enrichment, no contact fields. ✅
11. **No relationship scoring exists**, and no field could become one. ✅
12. **No migration and no new persistence noun.** Head stays at **0047**. ✅
