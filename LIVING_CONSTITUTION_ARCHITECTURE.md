# Living Constitution & Personal Observatory — Architecture Study

> **STATUS: FUTURE / POST-BETA ARCHITECTURE STUDY. NOT IMPLEMENTED.**
>
> Nothing in this document describes current behaviour. No code, schema, or
> migration was written for it. It exists to determine the *smallest coherent
> model* that could later support the Living Constitution experience, and to
> record what should deliberately **not** be built.
>
> Every claim about the current system in Part 1 was verified against the
> repository at `main` = `1638c13` and carries a file reference.

---

## 0. Executive recommendation

**Build one new noun, not thirteen.**

The audit found that Conqify already contains most of the Observatory's
machinery — it was built for knowledge and never pointed at life. Specifically:

- A **provenance contract** that already refuses to let AI synthesis inherit
  source authority (`lib/provenance/index.ts`).
- A **unified activity index** that already flattens every recorded history into
  one time-sorted stream with durations (`lib/insights/activity.ts`).
- An **attention view** that already refuses to call attention "value, importance,
  or priority" (`lib/insights/attention.ts`).
- A **dormancy view** that already says *"No recorded activity in 90 days"* and is
  documented never to say *abandoned, stale, neglected, or unhealthy*
  (`lib/insights/dormancy.ts`).
- A **coverage discloser** that already tells the user what a view cannot see
  (`lib/insights/coverage.ts`) — the exact mechanism required for *absence of data
  is not absence from life*.
- A **candidate → evidence → user decision** lifecycle, twice: once for
  recommendations (`lib/orchestrator/`) and once, in a better storage shape, for
  duplicates (`DuplicateCandidate`).
- A **graph query layer** over explicit references with no separate edge table
  (`lib/graph/index.ts`).

The single genuinely missing primitive is **ConstitutionElement**: a statement of
how the user intends to live, which the user has explicitly adopted, and which
*references* — never duplicates — the practices, protocols, actions and projects
that make it real.

Almost everything else in the brief is a **projection, a lens, or a decision
record** over data that already exists.

**Recommended first sprint is deliberately small:** one migration, two tables, no
AI, no visualization, no Integral, no patterns, no time model. See §15.

**The order in the brief should change in one place.** *Operational links* must
come before the *Life Architecture Interview*. Without links, every downstream
part — Constitution vs Reality, patterns, the Living Map — can only report "this
isn't connected to anything Conqify can observe." Links are also the cheapest
thing in the plan. See §13.

---

## 1. Current architecture audit

### 1.1 What actually exists

| Layer | Where | Notes |
|---|---|---|
| Domain types | `types/mvp.ts` (3,082 lines) | The live model. 42 collections in `StoreState`. |
| Paper ontology | `types/lifeos.ts` (366 lines) | **See §1.2 — mostly unused.** |
| Store | `lib/mvpStore.ts` | Single in-memory store + local persistence. |
| Persistence | `lib/persistence.ts`, `lib/adapters/supabaseAdapter.ts` | Local-first; Supabase sync when signed in. |
| Schema | `supabase/migrations/0001–0037` | 58 public tables, RLS on all, tombstoned deletes. |
| Export | `lib/backup/versioning.ts` | `EXPORT_DOMAINS` — 42 entries, stable order. |
| Graph | `lib/graph/index.ts`, `lib/graph/references.ts` | Derived from explicit refs. No edge table. |
| Provenance | `lib/provenance/index.ts`, `classify.ts` | Origin types, grounding authority, lineage. |
| Activity | `lib/insights/activity.ts` | `buildActivityIndex` → one sorted `ActivityEvent[]`. |
| Insights | `lib/insights/*` (24 modules) | Attention, dormancy, coverage, change-log, metrics. |
| Opportunities | `lib/orchestrator/` + 8 scanners | Deterministic; never mutates knowledge. |
| Capture routing | `lib/capture/classify.ts` | Pure, deterministic, no AI, no network. |

### 1.2 The most important finding: "Constitution" is already taken — twice

**(a) A paper ontology defines it and nothing uses it.**

`types/lifeos.ts` defines `ConstitutionEntry` (versioned, `derivedFrom`,
`supersedesEntryId`, `relatedPracticeIds`, with `ProvenanceMeta`), plus
`Revision` and `UserJudgment`. `ONTOLOGY.md` calls `ConstitutionEntry` *"the
highest-stakes object in the ontology."*

None of it is live. The **only** symbol any code imports from `types/lifeos.ts`
is `SourceType`:

```
types/mvp.ts:15   import type { SourceType } from "@/types/lifeos";
types/mvp.ts:143  export type { SourceType } from "@/types/lifeos";
```

There is no `constitution_entries` table, no `StoreState.constitutionEntries`, no
`EXPORT_DOMAINS` entry, and no UI. **This is a specification, not an
implementation** — which is good news: the design work exists and is unencumbered
by data.

**(b) The `/constitution` route renders the Belief Ledger.**

`app/constitution/page.tsx` imports `Belief`, `affirmBelief`, `questionBelief`,
`reviseBelief`. The page a user reaches at `/constitution` today is a list of
beliefs with accepted/questioned/revised/rejected status.

> **Prerequisite for any of this work:** the Belief Ledger must be renamed off
> `/constitution` (`/beliefs` is the obvious home) before a real Constitution can
> use the word. This is a routing + copy change, not a data change.

**(c) The product already promised this.** `PRINCIPLES.md` §2: *"The user remains
the author of their own worldview and Constitution."* The commitment predates the
feature.

### 1.3 Concept-by-concept verdict

Legend: **A** already clean · **B** partial · **C** expressible as
metadata/relationship · **D** needs a new primitive · **E** do not model yet.

| Concept | Verdict | Evidence / reasoning |
|---|---|---|
| **Purpose** | **D** (as a `kind`) | No record type carries "what my life is for." Same row shape as the others — costs a label, not a table. |
| **Value** | **D** (as a `kind`) | `Principle` exists but is a *world-model* object (`principles` table, migration 0013: `concept_ids`, `belief_ids`, `citations`) — it organizes knowledge, not conduct. Overloading it would conflate "what I think is true" with "how I intend to live." |
| **Principle** (constitutional) | **D** (as a `kind`) | As above. The name collision is real and must be resolved in copy. |
| **Rule** | **C** | A rule with a condition **is a Protocol** (`types/mvp.ts:2806`). A rule without one is a Standard. No new kind needed. |
| **Practice** | **A** | `PracticeCandidate` exists, with `derivedFrom`, `userWording`, `history`, and an explicit "never schedules or tracks streaks" contract. **Reference it; never copy it.** |
| **Protocol** | **A** | `Protocol` exists (0037). WHEN/IF → response, no engine, deliberately absent from Today. **Reference it.** |
| **Commitment** | **B → C** | Partially covered by `NextAction` (+ `dueDate`, 0036) and `Goal`. A standing commitment to a *person* has no home, but that gap is a missing **Person** entity, not a missing Commitment entity. Defer. |
| **Question** (standing) | **D** (as a `kind`) | Genuine hole. `Inquiry` is the *output* of a dialectical run, and `lib/notes/promotion.ts` documents that there is no simple question-creator to reuse. A standing question ("What captures my attention without earning it?") is a legitimate constitutional element. |
| **Life Area** | **C** | **A Life Area is a Workspace.** Precedent is explicit: `lib/notes/topics.ts` argues at length why Topic is a Workspace and why a `kind` discriminator was rejected — and notes that adding one later is additive. Same argument, same answer. |
| **Identity statement** | **D** (as a `kind`) | Same row shape. |
| **Boundary** | **D** (as a `kind`) | Same row shape. |
| **Standard** | **D** (as a `kind`) | Same row shape. |
| **Aspiration** | **D** (as a `kind`) | Same row shape. Must be distinguishable from an adopted commitment — see §11 "aspirational but not operational." |
| **Integral quadrant / line / state** | **C** | Lens metadata over existing records. See §7. |
| **Integral type** (Enneagram &c.) | **E — kill** | See §14. |
| **Pattern** | **E for now, then C+decision-record** | See §9. |
| **Planned vs actual time** | **B** | `PlanningAssignment` (planned band), `FocusSession` + `WorkspaceSession` (`durationMs` in the activity index) already exist. A real *Event* is missing. See §8. |

**Net:** one new table's worth of genuinely new modelling (`ConstitutionElement`,
carrying nine `kind` values), one append-only revision log, and — later, only if
beta earns it — one generic lens table and one pattern-decision table.

### 1.4 Reusable machinery, verified

| Requirement in the brief | Already built | Where |
|---|---|---|
| Source ≠ AI synthesis ≠ user adoption | `OriginType`, `GroundingAuthority {source, self}`, `effectiveOrigin` (least-privileged wins), `lineagePreservesSource` | `lib/provenance/index.ts` |
| AI prose kept by the user stays marked | `fromAiText` columns (0035, 0037), `withAttribution` text markers | `lib/provenance/index.ts:111` |
| "Why am I seeing this?" | `Recommendation.rationale`, `ReviewSurfacedItem.reason`, `WorldTension.detail`, `dormancyPhrase` | 4 independent precedents |
| Candidate → user decision, no auto-action | `Recommendation` (dismiss/accept/snooze/complete, `signature` dedupe) | `lib/orchestrator/index.ts` |
| Derive the candidate, persist only the decision | `DuplicateCandidate` — group derived on demand, decision keyed by a deterministic hash so two devices converge | `types/mvp.ts:2703` |
| Non-judgmental absence wording | `dormancyPhrase` → *"No recorded activity in 90 days."* | `lib/insights/dormancy.ts:89` |
| Disclose what the view cannot see | `buildCoverage` → *"Activity history begins on…"*, *"includes locally available synced records"* | `lib/insights/coverage.ts` |
| Never store computed results | `SavedInsightView` stores *display intent only*, "so a saved view can never present stale numbers as current" | `types/mvp.ts:2890` |
| Time-sorted life stream with durations | `buildActivityIndex` / `eventsInRange` (binary search) | `lib/insights/activity.ts` |
| Relationship traversal | `buildGraph`, `backReferences`, `dependencyChain`, `provenance`, `graphIntegrity` | `lib/graph/index.ts` |

### 1.5 Verified gaps

1. **The graph is a knowledge graph, not a life graph.** `buildNodes`
   (`lib/graph/index.ts:38`) registers sources, captures, proposals, beliefs,
   comparisons, inquiries, megathreads, reflections, practices, reviews,
   reasonings, decisions, formations, concepts, principles, frameworks, knowledge
   projects and research projects. It registers **no** `nextActions`, `notes`,
   `protocols`, `workspaces`, `goals`, `projects`, or `documents`. Any Living Map
   that claims to show a life must extend this.
2. **`LineageLink` is defined but never persisted.** `lib/provenance/index.ts`
   specifies `quoted_from | derived_from | imported_from`, and nothing stores a
   `lineage` array today — provenance is currently *derived* from structure plus
   `fromAiText`. Constitution elements would be the first records to persist it
   explicitly, which is appropriate: they are the first records whose whole point
   is where they came from.
3. **`tags text[]` exists on exactly one table** (`notes`, 0035). There is no
   cross-record tagging mechanism, so "one record in many lenses" has no home.
4. **A new collection that misses `EXPORT_DOMAINS` silently vanishes from
   export.** This is not hypothetical — LIFEOS-052 fixed nine domains that had
   been dropped (`nextActions`, `dailyReviews`, `actionDependencies`,
   `actionTemplates`, `planningAssignments`, `focusSessions`, `maintenanceEvents`,
   `duplicateCandidates`, `savedInsightViews`).
5. **No Person entity, no Event entity, no recurrence engine.** All three are
   real absences; all three are correctly deferred.

---

## 2. Proposed domain model

> **Superseded in part by §20.** The kind list below is narrowed to four in
> §20.2, and the deletion semantics are made explicit in §20.3.

### 2.1 `ConstitutionElement` — the one new noun

```
ConstitutionElement
  id                uuid
  userId            uuid
  kind              purpose | value | principle | standard | boundary
                    | identity | aspiration | question | commitment
  statement         text        -- the user's words. Never overwritten silently.
  elaboration       text?       -- optional "why this matters to me"
  lifeAreaId        uuid?       -- → workspaces.id   (a Life Area IS a Workspace)
  status            draft | active | retired
  adoptedAt         timestamptz?  -- NULL means NOT part of the Constitution
  supersedesId      uuid?       -- retirement references; never deletes
  order             int
  linkedRefs        jsonb       -- RecordRefLite[] → practices, protocols,
                                --   actions, projects, notes, documents…
  lineage           jsonb       -- LineageLink[] (lib/provenance) — where it came from
  sourceCaptureId   uuid?
  fromAiText        boolean     -- text originated as machine prose the user kept
  excludeFromAi     boolean     -- see §12.2 — a column, not a later migration
  tags              text[]
  createdAt / updatedAt
```

**Why one table and not thirteen.** Purpose, Value, Principle, Standard,
Boundary, Identity, Aspiration and Question differ in *prompt and presentation*,
not in structure. Every one of them is: a sentence the user wrote, that the user
adopted, that points at real records. Giving each its own table would produce
eight identical schemas, eight sets of RLS policies, eight export domains, eight
sync paths and eight places to forget a tombstone — for zero representational
gain. `Note` (0035) is the precedent for refusing structure that earns nothing.

**Why `Rule`, `Practice` and `Protocol` are absent as kinds.** They already exist
as records with their own semantics. A constitutional element **links** to a
Practice; it does not contain one. Duplicating them here would create exactly the
"second way to make the same record" that `lib/notes/promotion.ts` documents as a
mistake to avoid.

**Why `commitment` is a `kind` but stays thin.** A commitment to *do* something
is a `NextAction` or a `Goal`. The `commitment` kind exists only for standing
commitments *to a person or a relationship*, which have no home today. It is
listed last and should be the last one shipped — ideally after a `Person` entity
makes it meaningful.

**The load-bearing field is `adoptedAt`.** A row with `adoptedAt = NULL` is not
part of the Constitution, is excluded from every projection in §10 and §11, and
is never described to the user as something they believe. This is the schema-level
enforcement of *AI proposes; the user adopts*.

### 2.2 `ConstitutionRevision` — append-only history

```
ConstitutionRevision
  id            uuid
  userId        uuid
  elementId     uuid           -- may reference a retired or superseded element
  changeKind    added | restated | elaborated | relinked | retired | readopted
  previousValue jsonb          -- null on `added`
  newValue      jsonb
  reason        text?          -- the user's own words for why
  evidenceRefs  jsonb          -- RecordRefLite[] — reflections, patterns,
                               --   reading passages that informed the change
  actor         user | ai_proposed
  at            timestamptz
```

This is `Revision` from `types/lifeos.ts` and `ONTOLOGY.md`, narrowed to one
target type. It is **immutable and never deleted**, matching `MaintenanceEvent`
("Events are NEVER deleted (history is never silently lost) and always union on
sync").

### 2.3 What is deliberately *not* a table

| Not a table | Instead |
|---|---|
| Constitution (the document) | A **derived view** over active elements. |
| Constitution version / edition | A derived view over `ConstitutionRevision`. See §5. |
| Life Area | A `Workspace`. |
| Rule | A `Protocol` (conditional) or a `standard` element (unconditional). |
| Candidate element awaiting adoption | A `Recommendation` (existing lifecycle) or a jsonb candidate inside an interview session. See §6. |
| Integral quadrant / line / state | Lens assignment. See §7. |
| Candidate pattern | Derived on demand; only the decision is stored. See §9. |
| Time entry | An interpretation attached to an interval that already exists. See §8. |

---

## 3. Relationship model

> **Superseded by §20.1**, which audits the three relationship mechanisms that
> already exist and specifies the shared reader that keeps `linkedRefs` from
> becoming a fourth island.

**Rule: the Constitution references; it never owns.**

```
ConstitutionElement --linkedRefs--> Practice | Protocol | NextAction | Project
                                     | Goal | Note | ReadingDocument | Reflection
ConstitutionElement --lifeAreaId--> Workspace
ConstitutionElement --supersedesId--> ConstitutionElement
ConstitutionElement --lineage--> LineageLink { quoted_from | derived_from
                                               | imported_from } → RecordRefLite
ConstitutionRevision --elementId--> ConstitutionElement
ConstitutionRevision --evidenceRefs--> any record
```

Three consequences fall out for free:

1. **Back-references work in both directions** once constitution elements are
   registered in `buildNodes` / `buildGraphEdges` — a Practice page can show
   "this serves: *Attention is a form of stewardship*" with no extra storage.
2. **Activity rolls up.** `ActivityEvent` already carries `workspaceId`,
   `goalId`, `projectId`, `milestoneId`. An element linked to a project inherits
   that project's recorded activity, which is what makes §10 computable at all.
3. **Deleting a linked record cannot corrupt the Constitution.** `RecordRefLite`
   is already used this way throughout, and every projection in the codebase is
   documented as orphan-safe ("a dangling `ref` degrades gracefully").

**The graph extension required** (`lib/graph/index.ts`): add node kinds
`constitution_element`, plus the missing life kinds `action`, `note`, `protocol`,
`workspace`, `goal`, `project`, `document`; add edges for `linkedRefs`,
`lifeAreaId`, `supersedesId`. No new storage — `buildGraph` derives everything
from explicit references.

---

## 4. Constitution lifecycle

```
                     ┌─────────────────────────────────────────┐
                     │  SOURCES OF A CANDIDATE                 │
                     │  · Life Architecture Interview          │
                     │  · Reading passage / Note / Reflection   │
                     │  · A confirmed Pattern                  │
                     │  · The user simply typing it            │
                     └────────────────┬────────────────────────┘
                                      │
                          ┌───────────▼───────────┐
                          │  CANDIDATE            │   ← not a Constitution row
                          │  Recommendation, or   │   ← never counted, never shown
                          │  interview jsonb      │      as something the user holds
                          └───────────┬───────────┘
                                      │
                  ┌───────────────────┼───────────────────┐
                  │                   │                   │
             ┌────▼────┐        ┌─────▼─────┐       ┌─────▼─────┐
             │ REJECT  │        │   EDIT    │       │  ACCEPT   │
             │ (logged,│        │ (user     │       │  as-is    │
             │  no row)│        │  rewrites)│       │           │
             └─────────┘        └─────┬─────┘       └─────┬─────┘
                                      │                   │
                                      │  fromAiText=false │  fromAiText=true
                                      │  (a rewrite IS    │  (kept machine prose
                                      │   authorship)     │   stays marked)
                                      └─────────┬─────────┘
                                                │
                                   ┌────────────▼────────────┐
                                   │  ADOPTED ELEMENT        │
                                   │  status=active          │
                                   │  adoptedAt=<now>        │
                                   │  + ConstitutionRevision │
                                   │      changeKind=added   │
                                   └────────────┬────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
            ┌───────▼───────┐          ┌────────▼────────┐         ┌────────▼────────┐
            │ OPERATIONALISE│          │  OBSERVE        │         │  REVISE         │
            │ link Practice │          │  §10 comparison │         │  restate /      │
            │ Protocol,     │─────────▶│  §11 audit      │────────▶│  elaborate /    │
            │ Action, …     │          │  §9 patterns    │         │  retire         │
            └───────────────┘          └─────────────────┘         └────────┬────────┘
                                                                            │
                                                          ┌─────────────────▼──────────────────┐
                                                          │ RETIRED (never deleted)            │
                                                          │ status=retired                     │
                                                          │ successor.supersedesId = this.id   │
                                                          │ + ConstitutionRevision(retired,    │
                                                          │     reason, evidenceRefs)          │
                                                          └────────────────────────────────────┘
```

**The rewrite rule is the ethical hinge.** `lib/provenance/index.ts:86` already
states it for text: *"If the user deletes the marker while rewriting the text in
their own words, that is a deliberate authoring act — which is exactly when
authorship should transfer. We never infer adoption from a Save click; we do
honour a rewrite."* The Constitution inherits that rule unchanged.

---

## 5. Versioning

> **Extended by §20.3**, which separates historical retirement from true deletion
> and gives deletion a cascade guarantee.

**Do not snapshot the Constitution.**

A version table would duplicate every element on every change, drift from the
live rows, and force a merge policy on sync. Instead:

- **Truth** = the current `ConstitutionElement` rows.
- **History** = the append-only `ConstitutionRevision` log.
- **"Version N"** = a *derived* view: replay revisions up to an instant.

`SavedInsightView` is the precedent — it "stores ONLY display intent … It NEVER
stores calculated results (results are always re-derived deterministically), so a
saved view can never present stale numbers as current."

This answers *"What changed in how I say I want to live?"* directly:

```
diffConstitution(fromInstant, toInstant) →
  added[]    · restated[] (with both wordings)
  relinked[] · retired[]  (with reason + evidenceRefs)
```

**Optional, deferred: `constitution_editions`.** If beta users want to *name* a
moment ("v1 — before the move"), that is a three-column bookmark table
(`id, label, at, note`) — not a snapshot. Recommend deferring until someone asks.

**The newest version never invalidates history.** Retirement writes
`supersedesId` rather than deleting, exactly as `ONTOLOGY.md` specifies for
`ConstitutionEntry` and as `Belief.revisions` already behaves.

---

## 6. Life Architecture Interview

### 6.1 Shape

```
LifeInterviewSession
  id, userId
  status         open | paused | synthesized | closed
  domainsTouched text[]            -- which of the ~16 domains have been visited
  turns          jsonb             -- append-only: { at, questionId, questionText,
                                    --   answerText, followUpOf? }
  candidates     jsonb             -- un-adopted candidate elements, with evidence
  createdAt / updatedAt
```

**One table.** The question *bank* lives in **code**, not data — same reasoning as
`lib/capture/classify.ts`: *"no latency, no cost, no provider dependency, and no
risk of a model quietly changing its mind between releases."* A versioned question
bank in git is auditable; a question bank in a database is not.

### 6.2 Branching

```
broad question  →  answer  →  DETERMINISTIC ROUTER  →  next question
                                       │
                                       └── (optional) AI CLARIFIER
                                           may only ask; may not conclude
```

The **spine is deterministic**: domain coverage, follow-up triggers (a mentioned
person, a mentioned recurring failure, a stated conflict), and stop conditions are
rules. AI's permitted role is a *clarifying question* when an answer is too short
or ambiguous to route — and the interview must remain completable with AI
unavailable, matching the existing deterministic-fallback discipline.

### 6.3 What the interview is looking for

Not personality. Five observable things, each mapping to a candidate:

| Discovery | Candidate produced |
|---|---|
| What repeatedly goes wrong | `question` element, or a Protocol candidate |
| What matters | `value` / `purpose` element |
| What responsibilities exist | `commitment` element + a Life Area (Workspace) |
| What conflicts | Recorded as a **tension**, never resolved for the user |
| What they will actually do | Practice / Protocol candidate — the *operational* half |

### 6.4 Hard limits

- The interview **never** writes a `ConstitutionElement`. It writes candidates.
- It is **resumable and abandonable** without penalty. No completion percentage,
  no "your profile is 60% complete."
- No trait inference, no scoring, no developmental placement, no diagnosis.
- Domain list is a menu, not a checklist — skipping "spirituality" is not a gap.

---

## 7. Integral lens architecture

**Integral Theory is a *view*, never a schema.** The user must never need the
vocabulary; the product must never depend on the theory being true.

### 7.1 The one new mechanism (Stage E, not before)

```
LensAssignment
  id, userId
  ref        jsonb    -- RecordRefLite → ANY record
  lensKind   text     -- "quadrant" | "line" | "state" | user-defined
  value      text     -- "interior_individual" | "moral" | "flow" | …
  assignedBy user | suggested
  at         timestamptz
```

One sparse, generic, user-controlled table. It is the only way to get *one record
in many lenses without duplication*, and it deliberately does **not** privilege
Integral: Integral is one `lensKind` vocabulary among any the user invents. If
Integral turns out to be wrong or unwanted, the table survives; only the
vocabulary is discarded.

### 7.2 Per-lens rules

| Lens | Storage | Assignment rule |
|---|---|---|
| **Four quadrants** | Not stored by default | **Derived** from a published, inspectable `kind → quadrant` mapping (a Reflection is interior-individual; a NextAction is exterior-individual; a Protocol naming another person is interior-collective). The mapping is shown whenever a quadrant is shown. A user override becomes a `LensAssignment` with `assignedBy: user`. |
| **Developmental lines** | `LensAssignment(lensKind: "line")` | **User-assigned or suggested-then-confirmed.** Never inferred from activity. A line is not a score and has no level. |
| **States** | Attach to an interval that already exists | Reuse `Reflection.context` (an existing mood/context field) and `FocusSession`. **Only ever self-reported.** A dedicated `state_checkins` table is Stage G, and only if beta shows people want to log states outside a reflection. |
| **Types** | **Never** | See §14. |

### 7.3 The three inference bans

1. **A developmental level or altitude is never computed, displayed, or stored.**
2. **A state is never inferred** from typing speed, session length, time of day,
   or language. Only the user says how they were.
3. **A quadrant is never silently applied** — the deterministic mapping that
   produced it is always one click away, and always overridable.

### 7.4 The usability rule

Every lens must have a plain-English name that works without theory: *Inner /
Outer / Together / Around me* for quadrants; *Areas of growth* for lines; *How I
was* for states. Integral vocabulary is an optional display toggle for users who
want it, not the default surface.

---

## 8. Time & Attention architecture

### 8.1 What already works with zero migrations

An **Attention River** can ship today on `buildActivityIndex` + `attentionView` +
`eventsInRange`, grouped by workspace / goal / project / milestone / action /
document / entity / focus target, with `durationMs` from completed sessions and
focus sessions. That is a real, honest, non-judgmental time view built entirely
from history the product already records.

This is the highest-value/lowest-cost item in the whole study.

### 8.2 The distinctions the brief asks for

They are **interpretations, not measurements** — so they must be stored as the
user's interpretation of an interval that already exists:

```
TimeInterpretation           (Stage G)
  id, userId
  ref        jsonb   -- → FocusSession | WorkspaceSession | manual check-in
  label      text    -- focused_work | rest | recreation | necessary
                     -- | fragmented | drift | unclassified
  note       text?
  at         timestamptz
```

Non-negotiables:

- **Default is `unclassified`.** The system never assigns a label.
- **"Wasted" is not in the vocabulary.** Only the user's own `note` can say it.
- **`rest` and `recreation` are first-class, positive labels** — the schema itself
  must not encode leisure as residue. *Rest is not failure.*
- **`drift` is self-reported only.** Nothing detects it.

### 8.3 Planned vs lived

| Already exists | Missing |
|---|---|
| `PlanningAssignment` — the user's chosen attention band, documented as "never a deadline" | A real **Event** (a bounded instant with a start and end) |
| `NextAction.dueDate` (by when), `deferredUntil` (not before), `followUpDate` (check back) | Calendar ingestion |
| `Goal/Project/Milestone.targetDate` | Recurrence |

`Event` is the one genuinely new time primitive, and the existing decision rule
already governs it (`CLOSED_BETA_EXECUTION.md` §6: Calendar moves up *"when
repeatedly named as missing life context, especially unprompted"*).

### 8.4 The surveillance line

- No device integration, no app usage tracking, no idle detection, no keystroke
  or focus-loss inference — **ever, without an explicit per-source authorization
  the user can revoke**, and not in any stage in this plan.
- Every time view carries `buildCoverage` disclosures, so "3 hours recorded" is
  never mistaken for "3 hours lived."
- **No productivity score, no utilization percentage, no streak.** `PracticeCadence`
  is already documented as *"a cadence SUGGESTION only — LifeOS never schedules or
  tracks streaks."*

---

## 9. Pattern architecture

### 9.1 Does Pattern need a first-class model? **Not yet — and when it does, only half of one.**

Follow `DuplicateCandidate`, not `Recommendation`:

- **Candidates are derived on demand** by pure detectors over
  `buildActivityIndex`. Nothing is stored. A detector that finds nothing costs
  nothing and leaves no residue.
- **Only the user's decision is persisted:**

```
PatternDecision
  id         text        -- DETERMINISTIC hash: detector + period + sorted evidence refs
  userId     uuid
  detector   text        -- "rhythm" | "return" | "neglect" | …
  status     confirmed | rejected | ignored
  note       text?
  createdAt / updatedAt
  history    jsonb       -- append-only, like DuplicateCandidate.history
```

The deterministic id is what makes two devices converge on one decision — the
exact reasoning already written for `DuplicateCandidate`: *"keyed by a STABLE
deterministic id … so the same group detected on two devices resolves to exactly
one record. `open` decisions are never persisted."*

### 9.2 Every candidate must carry its own explanation

```
PatternCandidate (derived, never stored)
  detector      · what fired
  claim         · plain language, hedged: "appears", "in recorded activity"
  evidence      · RecordRefLite[]  — the actual records, clickable
  period        · { start, end }   — always stated
  why           · why this surfaced, in the detector's own words
  limitations   · what this cannot see (from buildCoverage)
  strength      · qualitative only — ConfidenceLevel, never a percentage
```

`Recommendation` already models exactly this discipline: `confidence:
ConfidenceLevel` is documented as *"How strongly the deterministic signal fired
(qualitative, never a fake score)."*

### 9.3 Lifecycle

```
detector fires → candidate (derived) → evidence shown → user confirms / rejects
    → PatternDecision(confirmed) → optional promotion → Reflection | Protocol
                                                       | Practice | Constitution revision
```

Promotion reuses existing creators, following `NOTE_PROMOTIONS`' rule: *"Only
promotions that reuse an existing creator are offered."*

### 9.4 Bans

- **No hidden behavioral scoring**, no engagement metric, no adherence rate.
- **A statistical relationship is not a truth.** Copy must stay in the register of
  `dormancyPhrase`: what was *recorded*, over what *period*.
- **No detector may name a cause.** "These three actions were rescheduled four
  times" is a pattern. "You avoid difficult work" is a diagnosis.
- **A rejected pattern stays rejected** and must not resurface identically.

---

## 10. Living Map visualization architecture

### 10.1 The architecture rule, already precedented

**No visualization-specific records.** `SavedInsightView` stores *display intent
only* and never results; the Living Map inherits that rule verbatim. A saved map
is a query, not a picture.

### 10.2 What each view consumes

| View | Consumes | New storage |
|---|---|---|
| 1. Constitution Constellation | `lib/graph` + constitution elements | none |
| 2. Integral Quadrants | `LensAssignment` + deterministic mapping | Stage E only |
| 3. Development Lines | `LensAssignment(line)` + activity index | Stage E only |
| 4. Life Areas | `Workspace` + activity rollup | none |
| 5. Time & Attention | `buildActivityIndex` + `attentionView` | none |
| 6. Development Timeline | `ConstitutionRevision` + `MaintenanceEvent` + activity | none |
| 7. Relationship / knowledge graph | `lib/graph` (**needs the §1.5 node extension**) | none |
| 8. Constitution vs Reality | §11 | none |
| 9. Pattern view | derived candidates + `PatternDecision` | Stage F only |
| 10. Calendar | needs `Event` | Stage G |

**Eight of ten views require no new storage at all.** That is the strongest
argument in this document for the staging in §13.

### 10.3 Do not add a graph engine

`lib/graph/index.ts` is already a deterministic query layer with lookup,
forward/back references, transitive `dependencyChain`, `provenance` roots,
parent/child traversal and an integrity report — built from explicit references
with no edge table and no dependencies. What it needs is **more node kinds**
(§1.5), not a replacement. A graph library would add a second source of truth
about relationships, which is precisely the "data island" the brief forbids.

### 10.4 One life, many lenses — enforced structurally

A record appears in multiple views because of its **references and lens
assignments**, never because a view copied it. Concretely: no view may write to
any record; every view is a pure function of `(StoreState, range, lens)`.

---

## 11. Constitution vs Reality

### 11.1 The computation

For each **adopted, active** element over a user-chosen range:

```
linked          = element.linkedRefs (+ records inside a linked Workspace/Project)
observedEvents  = eventsInRange(activityIndex, range) filtered to `linked`
representation  = { eventCount, distinctDays, lastTouched }
```

No weighting, no normalization, no aggregate. Three plain numbers and a date.

### 11.2 The wording contract

Inherited from `lib/insights/dormancy.ts` and `lib/insights/attention.ts`, which
are already documented never to say *abandoned, stale, neglected, unhealthy*, and
never to call attention *value, importance or priority*.

| Say | Never say |
|---|---|
| "Creativity is prominent in your Constitution but has had little **observable representation in Conqify** during the last 30 days." | "You neglected creativity." |
| "No recorded activity linked to this in 47 days." | "This is failing." |
| "This element isn't linked to anything Conqify can observe." | "This element is inactive." |
| "12 recorded events across 6 days." | "Creativity: 34/100." |

**The zero-link case is a distinct message, not a low score.** An element with no
links is not under-lived — it is unobservable, and the honest response is to offer
to link it (which is also the most useful thing the product can do).

### 11.3 Always attached

- **Why am I seeing this?** — the element, the range, the links traversed, the
  event count.
- **Coverage disclosures** from `buildCoverage`, unmodified: when history begins,
  open sessions excluded, local-sync caveat, deleted-record caveat.
- **Six responses**, all equal in weight, none defaulted:
  Reflect · Plan something · This doesn't need attention · My priorities changed ·
  Revise Constitution · Dismiss.

"This doesn't need attention" and "My priorities changed" must be **as easy as**
"Plan something." A UI that makes acting easier than dismissing is a scoring
system wearing a disguise.

### 11.4 The governing sentence

> **Absence of data is not absence from life.** Conqify observes what was recorded
> in Conqify. It has no access to the rest of a life, and every comparison must
> say so.

---

## 12. Constitution structural audit

Deterministic, explainable, evidence-bearing, dismissible. Modeled on
`WorldTension` (`kind`, `title`, `detail` — "Why this surfaced — always shown")
and `graphIntegrity`.

| Audit | Deterministic rule | Ship? |
|---|---|---|
| **Aspirational but not operational** | Adopted element with zero `linkedRefs` | ✅ Stage D |
| **Dormant element** | Reuse `dormancyView` over linked records | ✅ Stage D |
| **Duplicated elements** | Reuse the normalized-title machinery behind `DuplicateCandidate` | ✅ Stage D |
| **Unsupported commitment** | `commitment` element with no linked Action/Practice/Protocol | ✅ Stage D |
| **Excessive daily obligations** | Count of linked `daily`-cadence practices exceeds a **user-set** threshold | ⚠️ Only with a user-set threshold; no default "too many" |
| **Conflicting rules** | **Only** from user-declared opposition — never inferred from text | ⚠️ Requires an explicit "these are in tension" gesture first |
| **Vague principle** | Structural only (no verb / below N words) | ⚠️ Opt-in; trivially dismissible; never called "bad" |
| **Large mismatch, stated vs represented** | §11, phrased as observation | ⚠️ Must never aggregate across elements |
| **Punitive structure** | — | ❌ **Kill.** Requires judging the user's moral tone. |
| **Constitution health score** | — | ❌ **Kill.** Explicitly forbidden by the brief and by every precedent in the codebase. |

**The conflict rule matters most.** `lib/orchestrator/scanners/belief.ts`
establishes the standard: tension is emitted only when *"EXPLICIT: either a direct
`contradicts` edge between the two beliefs, or the two beliefs rest on concepts
the user has declared as opposing."* Inferring a contradiction between two of a
person's values from their wording is exactly the AI-authored-ideology failure the
brief forbids.

---

## 13. AI authority matrix

| Capability | AI may | AI may not | Enforced by |
|---|---|---|---|
| Ask an interview question | ✅ clarify, follow up | ❌ conclude, score, diagnose | Deterministic router owns the spine (§6.2) |
| Summarize the user's answers | ✅ | ❌ present the summary as the user's view | `fromAiText`, `withAttribution` |
| Suggest element wording | ✅ as a candidate | ❌ write a `ConstitutionElement` row | `adoptedAt` NULL ⇒ not constitutional |
| Detect a tension | ✅ surface as a candidate with evidence | ❌ resolve it, rank it, or call one side right | `PRINCIPLES.md` §4 |
| Compare user-chosen sources | ✅ | ❌ arbitrate which tradition is correct | `canGroundSource(ai) === false` |
| Suggest a relationship / link | ✅ | ❌ create the link | Existing approval gate on `ConceptRelationship` |
| Propose a Practice / Protocol | ✅ | ❌ create one | Capture classifier precedent: *even "Call the dentist" yields a proposal, never an action* |
| Surface a candidate pattern | ✅ with evidence, period, limitations | ❌ persist it, name a cause, or score behaviour | Candidates derived, never stored (§9) |
| Explain evidence | ✅ | ❌ fabricate, extrapolate, or cite what it did not read | `AI_AGENT_RULES.md` §2 |
| Read the Constitution | ✅ only on a user-initiated action | ❌ in background jobs; ❌ elements with `excludeFromAi` | §12.2 |
| Anything normative | — | ❌ **create a value, commitment, or belief; alter the Constitution; declare a developmental level; assign spiritual maturity; judge worth; call leisure waste; diagnose mental health; reinterpret source authority** | Adoption gate + provenance + kill list |

**One sentence governs all of it:** *every normative change requires an explicit
user confirmation, and the schema — not the UI — is what enforces it.*

---

## 14. Privacy & provenance analysis

### 14.1 Provenance: already solved, needs wiring

The required chain is expressible today with no new provenance work:

```
ReadingDocument/Passage   origin = original_source        canGroundSource ✅
  └ Citation (quoted_from)                                 authority preserved
      └ AI explanation    origin = conqify_ai              canGroundSource ❌
          └ candidate     Recommendation (no row)
              └ element   user_authored (rewritten) | fromAiText (kept verbatim)
```

`effectiveOrigin` already returns the **least-privileged** constituent, and
`lineagePreservesSource` already revokes source authority the moment a single
`derived_from` appears in the chain. So *"a source saying something does not mean
the user believes it"* and *"AI synthesis does not become source authority"* are
both already enforceable — the Constitution just has to record its `lineage`.

### 14.2 Sensitivity controls — the minimum that is architecturally necessary

This will hold the most sensitive material in Conqify: beliefs, religion,
relationships, sexuality, health, money, private struggle.

**Recommend exactly two additions, both in Stage A:**

1. **`excludeFromAi boolean` on `ConstitutionElement`.** Necessary *now*, not
   later: once Stage C/F want to read the Constitution in bulk, retrofitting the
   flag means a migration plus a backfill decision about rows that are already
   sensitive. Default `false`; a single toggle; excluded rows never leave the
   device in an AI request.
2. **Retire ≠ delete, stated in the UI.** Retiring preserves history (required by
   §5). Deleting must actually delete the element *and* its revisions. Both must
   exist, and the difference must be visible before the click — the product
   already has `requestConfirm` + `buildImpact` for exactly this.

**Deliberately not recommended:** per-element encryption, a separate vault, a PIN,
a "private mode". Each adds real complexity and none is architecturally forced —
RLS, local-first storage, and account deletion already cover the threat model in
`THREAT_MODEL.md`.

### 14.3 Non-negotiable checklist for any new collection

Learned the hard way in LIFEOS-052, when nine domains silently vanished from
export:

- [ ] `EXPORT_DOMAINS` entry (`lib/backup/versioning.ts`)
- [ ] `StoreState` collection + `normalize()` default
- [ ] Supabase adapter read/write + **tombstone** registration
- [ ] RLS policies (select/insert/update/delete, `auth.uid() = user_id`)
- [ ] `user_id` defaults to `auth.uid()`
- [ ] Account-deletion coverage
- [ ] Restore round-trip test
- [ ] `TABLE_REGISTRY` entry for `audit:rls`

### 14.4 Not building surveillance

No background AI. No passive collection. No third-party analytics. No device or
app integration. Every observation in §11 derives from history the user's own
actions already wrote, and every view says what it cannot see.

---

## 15. Staged roadmap

Ordering differs from the brief in one place, for a reason the audit supports:
**operational links move ahead of the interview**, because eight of ten Living Map
views and the entire Constitution-vs-Reality surface depend on links existing, and
links are the cheapest item in the plan.

---

### Stage A — Constitution foundation

- **Problem solved:** "I have never written down how I actually want to live, and
  the one page in this app called Constitution shows me a list of beliefs."
- **Entities:** `ConstitutionElement`, `ConstitutionRevision`.
- **Migrations:** 1 (2 tables, RLS, indexes, tombstones).
- **Routes/UI:** rename Belief Ledger → `/beliefs` (**prerequisite**); new
  `/constitution`; element editor; revision history.
- **AI:** **none.**
- **Privacy:** `excludeFromAi` column ships here (§14.2).
- **Risks:** the naming collision; kind-list bikeshedding (ship 5 kinds:
  purpose · value · principle · standard · question).
- **Beta evidence that justifies it:** none needed — this is a stated founder
  intent and `PRINCIPLES.md` §2 already promises it. It is also the only stage
  everything else depends on.

### Stage B — Operational links

- **Problem solved:** "My principles have nothing to do with my week."
- **Entities:** no new tables. `linkedRefs` + graph extension (§1.5).
- **Migrations:** 0.
- **UI:** link picker on an element; "serves" back-reference on Practice /
  Protocol / Action / Project pages.
- **AI:** none.
- **Risks:** back-reference clutter on busy records; graph node-kind expansion
  must not slow `buildGraph` on large stores.
- **Beta evidence:** users create elements in Stage A and ask what to do with them.

### Stage C — Constitution vs Reality (read-only)

- **Problem solved:** "Is what I said I care about visible in what I actually do?"
- **Entities:** none.
- **Migrations:** **0** — runs entirely on `buildActivityIndex`, `attentionView`,
  `dormancyView`, `buildCoverage`.
- **UI:** one comparison surface + the six responses + coverage disclosures.
- **AI:** none.
- **Risks:** **highest wording risk in the whole plan.** Every string needs
  review against §11.2. Ship behind copy review, not a feature flag.
- **Beta evidence:** Stage B links exist for ≥2 users with ≥2 weeks of activity.

### Stage D — Structural audit

- Entities: none · Migrations: 0 · AI: none.
- Ships only the four ✅ rows in §12; the ⚠️ rows wait for evidence; the ❌ rows
  never ship.

### Stage E — Life Architecture Interview

- **Problem solved:** "I don't know where to start."
- **Entities:** `LifeInterviewSession` · **Migrations:** 1.
- **AI:** clarifying questions only; must be completable with AI unavailable.
- **Risks:** the highest AI-authority risk in the plan; interview fatigue;
  candidates that feel like the app telling you who you are.
- **Beta evidence:** users who *want* a Constitution but produce fewer than ~3
  elements unaided.
- **Deliberately after A–D** so the element model has survived real use before a
  large generative surface starts producing elements at volume.

### Stage F — Lens layer (incl. Integral)

- Entities: `LensAssignment` · Migrations: 1 · AI: suggestion only, never
  assignment.
- **Beta evidence:** users ask for grouping the existing Life Areas cannot express.
- **Never ships:** types, levels, altitudes, inferred states.

### Stage G — Pattern decisions

- Entities: `PatternDecision` (+ pure detectors) · Migrations: 1 · AI: candidate
  surfacing only.
- **Beta evidence:** ≥3 users independently describe a recurring dynamic Conqify
  could have shown them from records it already holds.

### Stage H — Time, Events, Calendar

- Entities: `Event`, `TimeInterpretation` · Migrations: 1–2.
- **Largest and most speculative.** Governed by the pre-recorded decision rule:
  Calendar moves up *"when repeatedly named as missing life context, especially
  unprompted."*
- Note: the **Attention River ships in Stage C** with zero migrations. This stage
  is only about *planned* time and *interpreted* time.

### Stage I — Living Map

- Entities: none (display intent only, `SavedInsightView` pattern).
- Last, because it consumes every prior stage. A minimal Constitution
  Constellation can ship inside Stage B as a graph view.

---

## 16. Explicit kill list

Not "later." **Not built.**

1. **Constitution health score**, alignment percentage, or any aggregate number
   describing how well someone is living.
2. **Streaks, compliance rates, adherence percentages.** (`PracticeCadence`
   already forbids them.)
3. **Developmental level / altitude / stage** — computed, displayed, or stored.
4. **Personality typology** (Enneagram, MBTI, and relatives). Typology fixes
   identity and is the fastest route to the software telling a person who they are.
5. **Spiritual maturity assessment.**
6. **Automatic classification of leisure as waste.** "Wasted" is not a system
   vocabulary word at all.
7. **Inferred emotional states** from typing, timing, session length, or language.
8. **A trigger engine for Protocols.** No detection, no firing, no notification —
   `types/mvp.ts:2787` already commits to this.
9. **AI-authored constitutional content that lands without confirmation.**
10. **Punitive-structure detection** (§12) — requires judging moral tone.
11. **Contradiction inferred from the wording of two values.** User-declared only.
12. **Device/app usage tracking** of any kind.
13. **A second graph engine, a second retrieval island, or visualization-only
    records.**
14. **A Constitution snapshot table.** History is the revision log.
15. **Separate tables for Purpose / Value / Principle / Standard / Boundary /
    Identity / Aspiration.** One table, one `kind`.
16. **Background AI reading the Constitution.**

---

## 17. Explicit answers

> **Answers 2, 4 and 6 are revised by §20.** Where they differ, §20 governs.

**1. One entity or many?**
**One** — `ConstitutionElement` with a `kind` discriminator, plus an append-only
`ConstitutionRevision` log. Eight of the brief's thirteen concepts share an
identical shape; three (Rule, Practice, Protocol) already exist as records and
must be *referenced*; Life Area is a Workspace.

**2. Smallest schema?**
`id, userId, kind, statement, elaboration?, lifeAreaId?, status, adoptedAt?,
supersedesId?, order, linkedRefs, lineage, sourceCaptureId?, fromAiText,
excludeFromAi, tags, createdAt, updatedAt` — plus the revision log in §2.2. Ship
five kinds first.

**3. Versioning?**
Element rows are truth; the append-only revision log is history; "version N" is
**derived** by replay. Retirement writes `supersedesId` and never deletes. No
snapshot table. Named editions are a deferred three-column bookmark.

**4. Sources without laundering authorship?**
Use `lib/provenance` unchanged: persist `lineage: LineageLink[]`, let
`effectiveOrigin` return the least-privileged constituent, and keep
`canGroundSource(conqify_ai) === false`. A rewrite transfers authorship; keeping
machine prose keeps `fromAiText: true`. Adoption is a separate, explicit act from
either.

**5. Which existing entities already support this?**
`Workspace` (Life Area / Topic), `Practice`, `Protocol`, `NextAction` (+`dueDate`),
`Goal`, `Project`, `Note`, `Reflection`, `ReadingDocument`/`Citation`/`Passage`,
`Recommendation` (candidate lifecycle), `DuplicateCandidate` (decision-record
pattern), `MaintenanceEvent` (append-only log), `SavedInsightView` (display-intent
storage), plus `lib/graph`, `lib/provenance`, and the whole `lib/insights` stack.

**6. Genuinely new primitives?**
Required: **`ConstitutionElement`**, **`ConstitutionRevision`**.
Conditional on beta evidence: `LifeInterviewSession`, `LensAssignment`,
`PatternDecision`, `Event`, `TimeInterpretation`.
Everything else in the brief is metadata, a relationship, or a projection.

**7. Does Pattern need a first-class model?**
**No — only half of one.** Candidates are derived on demand and never stored; only
the user's decision persists, keyed by a deterministic hash so devices converge.
This is `DuplicateCandidate`'s design, and it is the correct one.

**8. Where does Integral metadata live?**
In a **generic `LensAssignment` edge over any record** — not on records, not in
tags, not in a dedicated Integral schema. Quadrants are derived from a published
mapping with a user override; lines are user-assigned; states are self-reported on
intervals that already exist; types are never modeled.

**9. Time & Attention without surveillance?**
Ship the Attention River on the **existing** activity index — zero migrations.
Add `TimeInterpretation` as the *user's* label on intervals that already exist,
defaulting to `unclassified`, with `rest` and `recreation` as first-class positive
labels and no "wasted" value in the vocabulary. Never infer; always disclose
coverage; no device integration.

**10. How does the Living Map reuse the graph?**
By extending `buildNodes` / `buildGraphEdges` with the missing life kinds (§1.5),
not by adding an engine. Views are pure functions of `(StoreState, range, lens)`;
saved maps store display intent only.

**11. Cleanest path from principle to revision?**
```
element --linkedRefs--> practice/protocol/action/project
   → those records emit history → buildActivityIndex
      → §11 comparison ("little observable representation…", + coverage)
         → detector → PatternCandidate (evidence, period, limitations)
            → user confirms → PatternDecision
               → promote → Reflection
                  → user revises element → ConstitutionRevision
                       (reason + evidenceRefs pointing back at that Reflection)
```
Every arrow is either an existing mechanism or a reference — no step invents a
parallel store, and the loop closes with the evidence still attached.

**12. What should explicitly not be built?**
§16, all sixteen items.

**13. What waits for beta evidence?**
The Interview (E), lenses (F), patterns (G), Events/Calendar/time interpretation
(H), the full Living Map (I), the ⚠️ audits in §12, named Constitution editions,
`Person`, `Commitment` as a distinct entity, and any recurrence engine.

**14. Smallest first implementation after beta?**
See §18.

---

## 18. Smallest recommended first sprint

**LIFEOS-056 — Constitution elements: write it down, adopt it, link it.**

**In scope**

1. Rename the Belief Ledger off `/constitution` → `/beliefs` (routes, nav, copy,
   internal links). No data change.
2. One migration: `constitution_elements`, `constitution_revisions` — RLS,
   indexes, tombstones, `auth.uid()` defaults, following the 0035/0037 pattern
   exactly.
3. Store collections + `normalize()` defaults + Supabase adapter + tombstone
   registration + **`EXPORT_DOMAINS`** + `TABLE_REGISTRY` + account-deletion
   coverage + restore round-trip test (§14.3 checklist, all eight boxes).
4. Five kinds only: **purpose · value · principle · standard · question**.
5. Adoption is explicit: create → `draft`; adopt → `active` + `adoptedAt` +
   `ConstitutionRevision(added)`.
6. Retire (never delete) with `supersedesId`, a reason, and optional evidence refs.
   Delete exists, is separate, and says what it removes.
7. `linkedRefs` link picker to Practice, Protocol, NextAction, Project, Note.
8. `excludeFromAi` toggle.
9. Register constitution elements + the missing life node kinds in `lib/graph`,
   so back-references work both directions.
10. A revision-history view answering *"what changed in how I say I want to live?"*

**Explicitly out of scope**

No AI anywhere. No interview. No Integral. No lenses. No patterns. No time model.
No Calendar. No visualization beyond a plain list. No comparison surface. No audit.
No score, ever.

**Why this is the right first cut**

It is the only stage everything else depends on; it needs no beta evidence because
the founder's intent and `PRINCIPLES.md` §2 already justify it; it introduces no
AI and therefore no new AI-authority surface; and it makes the founder's own
Constitution linkable, which is the fastest way to learn whether Stage C's
comparison is worth building at all.

---

## 19. The principles this design protects

| Principle | Structural enforcement |
|---|---|
| **One life, many lenses** | Lenses are edges over shared records; no view owns data; no visualization-only records. |
| **The human authors; the system remembers** | `adoptedAt` gates constitutional status; AI can only produce candidates; a rewrite transfers authorship. |
| **Observation is not judgment** | Wording contract inherited from `dormancyPhrase` / `attentionView`; no aggregate, no score, anywhere. |
| **AI proposes; the user adopts** | Enforced by the schema, not the UI: an un-adopted element is not part of the Constitution. |
| **Rest is not failure** | `rest` and `recreation` are first-class labels; "wasted" is absent from the vocabulary; the system never labels an interval. |
| **Absence of data is not absence from life** | `buildCoverage` disclosures attached to every observation; the zero-link case is its own message, not a low score. |
| **Every pattern must explain itself** | A candidate without `evidence`, `period`, `why` and `limitations` is not renderable. |

---

# Part 20 — Pre-LIFEOS-056 architecture resolution

> **This part supersedes §2.1 (kinds), §3 (relationship model), §5 (retirement)
> and answers 2, 4 and 6 in §17 wherever they differ.** It was written after a
> second audit specifically targeting relationship storage, kind vocabulary and
> deletion guarantees. Still analysis only — no code, no schema, no migration.

## 20.1 Relationship storage — audit

### What actually exists

The repository has **three** relationship mechanisms, not one:

| # | Mechanism | Where | Covers |
|---|---|---|---|
| 1 | **Derived reference index** — edges computed from typed id fields | `lib/graph/references.ts` `buildGraphEdges` | 18 `RecordKind`s, all knowledge-side |
| 2 | **Embedded typed refs** — `RecordRefLite[]` stored on the row | `linkedEntityRefs` on Capture/NextAction/Note; `members`/`pinned` on Workspace; `linkedWorkspaces`/`linkedKnowledge` on Goal; ~30 sites total | any kind (`kind` is a free string) |
| 3 | **First-class edge tables** | `ConceptRelationship` (concept↔concept), `ActionDependency` (action↔action) | one pair each |

Plus `Citation` (document→record) and single-ref fields (`PlanningAssignment.ref`,
`MaintenanceEvent.ref`, `FocusSession.ref`).

### The three findings that decide this

**Finding 1 — `RecordKind` cannot name six of the seven targets we need.**

```
lib/graph/references.ts:14
  "source" | "capture" | "proposal" | "belief" | "comparison" | "inquiry"
| "megathread" | "reflection" | "practice" | "review" | "reasoning"
| "decision" | "formation" | "concept" | "principle" | "framework"
| "knowledge_project" | "research_project"
```

Of the Constitution's intended targets — Practice, Protocol, Action, Project,
Note, Workspace, Reading document — **only `practice` is present.** The graph is
a knowledge graph. It is not able to represent a life today.

**Finding 2 — the islands already exist, and embedding is not what caused them.**

`NextAction.linkedEntityRefs` and `Note.linkedEntityRefs` are the *same field
shape*. Actions got a bespoke reverse lookup:

```
lib/actions/relationships.ts:39
  /** Actions that reference a given record (any kind) via linkedEntityRefs. */
  (state.nextActions ?? []).filter((a) => (a.linkedEntityRefs ?? [])
    .some((r) => r.kind === kind && r.id === id))
```

Notes got nothing. Neither is visible to `buildGraphEdges`, which never reads
`state.nextActions` or `state.notes` at all. So an Action↔Note link is
representable, storable, syncable, exportable — and completely invisible to every
graph consumer.

**The island is not caused by embedding. It is caused by the absence of a shared
reader.** Adding a fourth mechanism would not fix that; adding a shared reader
would fix it for the Constitution *and* retroactively for Actions and Notes.

**Finding 3 — `GraphEdge.to` is an untyped bare string.**

```
lib/graph/references.ts:26
  export interface GraphEdge { from: string; fromKind: RecordKind; to: string; … }
```

Target kind is recovered by looking the id up in `graph.nodes`. That works only
because ids are globally unique UUIDs, and it fails *silently* — an edge to an
unregistered kind becomes a `brokenReferences` entry in `graphIntegrity` rather
than an edge. This is why extending `RecordKind` is a precondition, not an
optional nicety.

### Answers

**A. Can the relationships be represented cleanly with existing infrastructure?**

**Representation: yes. Traversal: no.**
`RecordRefLite { kind: string; id: string }` already names every target we need
and is the established convention at ~30 sites. But nothing reads those refs
generically, and `RecordKind` cannot name six of the seven targets, so no
existing consumer could traverse a Constitution link.

**B. Should `ConstitutionElement` avoid an embedded `linkedRefs` field?**

**No — keep it embedded, and add the missing reader.** Embedding is right here:

- It matches the convention already used by the three most life-adjacent records
  (Capture, NextAction, Note).
- It sync-merges correctly with machinery that already exists —
  `lib/actions/merge-rules.ts:53` unions `linkedEntityRefs` across base/local/remote
  with `uniqRefs`, so a link added on two devices converges rather than conflicts.
- It exports and deletes with the row, so §20.3's deletion guarantee needs no
  cascade reasoning for links.
- It requires **zero** relationship migrations.

**C. Would `linkedRefs` create another entity-specific island?**

**Only if it ships without a shared reader — and that is the actual risk to
close.** Mitigation is a single declarative table plus one generic pass in
`buildGraphEdges`:

```
REF_SOURCES: { collection, kind, field }[]      // ~12 entries, data not code
  constitutionElements · constitution_element · linkedRefs
  nextActions          · action                · linkedEntityRefs   ← existing island, fixed
  notes                · note                  · linkedEntityRefs   ← existing island, fixed
  captures             · capture               · linkedEntityRefs
  workspaces           · workspace             · members / pinned
  goals                · goal                  · linkedWorkspaces / linkedKnowledge
  …
```

One loop consumes it. `lib/actions/relationships.ts:39` then becomes a thin
wrapper over `backReferences` instead of a bespoke scan.

**D. Smallest generic typed relationship representation without a graph rewrite?**

**Do not add a `relationships` table. Add three small things to what exists:**

1. **Extend `RecordKind`** with the missing life kinds: `action`, `note`,
   `protocol`, `workspace`, `goal`, `project`, `document`,
   `constitution_element`. (`buildNodes` needs matching registrations.)
2. **Carry `toKind` on `GraphEdge`** where the source knows it — which a
   `RecordRefLite` always does. Bare-string targets stay valid for the existing
   17 typed-id call sites; nothing is rewritten.
3. **One generic `REF_SOURCES` pass** over embedded `RecordRefLite[]` fields.

That is roughly 40 lines and zero migrations. It is explicitly **not** a graph
platform: no query language, no inference, no edge metadata, no traversal engine
beyond the `dependencyChain` that already exists.

### Explicitly rejected

- **A generic `relationships` table** (the `Relationship` type in
  `types/lifeos.ts`). It would become the *fourth* mechanism, would need its own
  migration, RLS, tombstones, export domain, merge policy and deletion cascade,
  and would leave mechanisms 1–3 in place — strictly more islands, not fewer.
- **Edge metadata on constitution links** (`reason`, `confidence`, `approved`, as
  `ConceptRelationship` carries). Speculative now. `RecordRefLite` lives in
  `jsonb`, so enriching it later needs no migration.
- **Migrating `linkedEntityRefs` on Action/Note into a new table.** Rewrites
  working, tested, merge-safe code for no user-visible gain.

---

## 20.2 Final initial kind vocabulary

**Recommendation: four kinds — `purpose`, `value`, `principle`, `standard`.**

The test applied to each candidate: *does the user file it differently, **and**
does the product behave differently?* A kind that fails the second half is a
taxonomy the user must learn for nothing — the failure mode
`lib/notes/topics.ts` already argues against at length.

### Included

| Kind | Why it earns a slot |
|---|---|
| **purpose** | Few, global, not area-scoped. Deliberately **not** expected to show daily observable representation, so §11 must treat it differently from conduct kinds. That behavioural difference is real. |
| **value** | The word people actually reach for. Dropping it would leave the obvious slot missing and push everything into `principle`. |
| **principle** | A sentence about how to act. The core conduct kind and the primary target of the §12 "aspirational but not operational" audit. |
| **standard** | A checkable threshold ("I reply within 24 hours"). Distinct from a principle precisely because it is checkable, which changes what the audit can say about it. |

### Excluded from the founder's proposed five

| Kind | Verdict | Where it goes instead |
|---|---|---|
| **boundary** | **Wait.** A boundary is a standard stated negatively — "I don't take work calls after 7pm" is "I keep evenings free." The product behaves identically, so the kind buys a filing decision at every capture and nothing downstream. | `standard`. **Add it the moment beta users write negative standards and say the word "boundary" unprompted** — it is a one-line enum addition with no migration. |

### Excluded from the comparison set

| Kind | Verdict | Where it goes instead |
|---|---|---|
| **rule** | **Never a kind.** | Conditional → `Protocol` (exists, migration 0037, WHEN/IF → response). Unconditional → `standard`. Adding `rule` would duplicate a shipped record type. |
| **commitment** | **Wait.** | A commitment to *do* something is a `NextAction` (with `dueDate`, 0036) or a `Goal`. The genuine residue — a standing commitment *to a person* — needs a `Person` entity that does not exist. Ship `Person` first or not at all. |
| **aspiration** | **Wait, and be careful.** | An aspiration inside the Constitution makes the §12 "aspirational but not operational" audit meaningless — everything aspirational is *supposed* to be unoperationalized, so the audit would fire on correct data. Model as a `Goal` (which has `targetDate`) or as an element left at `status: draft`. |
| **identity** | **Wait.** | "I am someone who keeps their word" is a grammatical variant of a value or principle. It also carries the highest risk of the product appearing to tell someone who they are — the exact failure the brief forbids. |
| **question** | **Wait. This reverses §2.1 of this study.** | I previously recommended `question` in the initial five. On re-examination a standing question is already well served by a `Note`: a Note has no status, no lifecycle and no epistemic standing (`types/mvp.ts:2828`), which is exactly right for an open question. Revisit in Stage E, when the Interview starts generating questions at volume and the Note list stops being a good home. |

**Net: five kinds deferred, four shipped, every deferral with a named home and a
named trigger.**

---

## 20.3 Retirement vs deletion semantics

### The risk being closed

`ConstitutionRevision.previousValue` stores the **prior statement text**. Without
an explicit rule, a user who deletes a sensitive element would leave that text
sitting in the revision log — sensitive content made undeletable by the existence
of history. That must not happen.

### Two operations, two guarantees. No third.

| | **A. Retire** | **B. Delete** |
|---|---|---|
| Means | "This was once part of my Constitution; I changed my mind." | "I do not want this stored anymore." |
| Element row | kept, `status: retired` | **removed** |
| Revisions | kept in full | **removed (cascade)** |
| Statement text | preserved deliberately | **gone** |
| Visible in | history views, version diffs, `supersedesId` chains | nothing |
| Tombstoned | no | yes — under both domains |
| Reversible | yes (re-adopt) | no |
| Counts as constitutional | no (`status: retired` is excluded from every §10/§11 projection) | n/a |

### The schema rules that enforce it

```
constitution_revisions.element_id
    references constitution_elements(id) on delete cascade
        -- deletion of an element destroys its history WITH it.
        -- Retirement never deletes the row, so retirement never triggers this.

constitution_elements.supersedes_id
    references constitution_elements(id) on delete set null
        -- deleting a superseded element must not delete its successor,
        -- and must not leave the successor holding a dangling id.
        -- Matches the existing `on delete set null` convention used for
        -- workspace_id and source_capture_id in migration 0035.
```

Cascade-on-delete is what makes the guarantee real: there is no code path where
the element is gone and its previous wording is not.

### What survives a delete, and why that is correct

- **A tombstone** — `{domain, recordId, deletedAt}` only. `lib/sync/tombstones.ts`
  is explicit: *"Privacy-safe: a tombstone stores only `{domain, recordId,
  deletedAt}` — never the deleted content."* It exists so a stale device cannot
  resurrect the element, which is a deletion *guarantee*, not a leak.
- **The user's own writing elsewhere.** If a Reflection quotes the element,
  deleting the element cannot reach into the Reflection — and should not. That is
  the user's own text in their own record. **It must be disclosed at delete
  time**, using the existing `requestConfirm` + `buildImpact` machinery
  (`lib/ux/confirmations.ts`), the same way every other destructive action in the
  product already discloses its reach.
- **Nothing else.** `evidenceRefs` on revisions are references, not copies, and
  go with the cascade regardless.

### Retirement does not substitute for deletion

Both must be reachable from the element itself, labelled in the user's language
("Retire — keep the history" / "Delete — remove it completely"), with delete never
hidden behind retire. `lib/privacy/retention.ts` already commits to the honest
disclosure this inherits, including the backup caveat: *"Database backups kept by
the hosting provider are purged as they roll off; we cannot guarantee instant
removal from backups."*

---

## 20.4 Confirmations

All ten points are confirmed as stated, with these implementation notes:

1. **`/constitution` becomes the Living Constitution; Belief Ledger moves to
   `/beliefs`.** ✅ Confirmed — and it is a hard prerequisite, not a nicety.
   `app/constitution/page.tsx` imports `Belief`, `affirmBelief`,
   `questionBelief`, `reviseBelief` today.
2. **`excludeFromAi` ships with the primitive.** ✅ Confirmed. Retrofitting it
   later means a migration plus a backfill decision about rows that are already
   sensitive.
3. **Adoption is always explicit.** ✅ Confirmed, enforced by schema:
   `adoptedAt IS NULL` ⇒ excluded from every projection.
4. **AI output or source material cannot become adopted Constitution content
   through a Save/transform.** ✅ Confirmed. Save is not adoption and adoption is
   not authorship — `lib/provenance/index.ts:86` already states the rule for
   text; `fromAiText` survives adoption unless the user rewrites the statement.
5. **Elements reference operational objects; never duplicate them.** ✅ Confirmed
   — via §20.1's embedded refs plus the shared reader.
6. **Pattern stays derived + decision-persistence.** ✅ Confirmed (§9).
7. **Integral stays a lens.** ✅ Confirmed (§7); `LensAssignment` is generic and
   Integral is one vocabulary among any the user invents.
8. **System vocabulary never classifies time as "wasted"; users may label their
   own time.** ✅ Confirmed. `TimeInterpretation.label` has no `wasted` value; a
   user's free-text `note` is theirs and is never parsed, scored, or aggregated.
9. **Retirement does not substitute for deletion.** ✅ Confirmed (§20.3).
10. **Relationships must not become per-entity islands.** ✅ Confirmed — and
    §20.1 finds this is *already violated* by Action/Note `linkedEntityRefs`;
    LIFEOS-056 should fix it rather than add to it.

---

## 20.5 Revised LIFEOS-056 scope

**Title: Constitution elements — write it down, adopt it, link it.**

### In scope

**Prerequisite**
1. Move the Belief Ledger `/constitution` → `/beliefs`: route, nav, internal
   links, copy. No data change, no schema change.

**Schema — one migration (`0038_constitution.sql`)**
2. `constitution_elements` — `id, user_id, kind, statement, elaboration,
   life_area_id → workspaces(id) on delete set null, status, adopted_at,
   supersedes_id → self on delete set null, sort_order, linked_refs jsonb,
   lineage jsonb, source_capture_id → captures(id) on delete set null,
   from_ai_text, exclude_from_ai, tags text[], created_at, updated_at`.
3. `constitution_revisions` — `id, user_id, element_id → elements(id)
   **on delete cascade**, change_kind, previous_value jsonb, new_value jsonb,
   reason, evidence_refs jsonb, actor, at`.
4. RLS on both (select/insert/update/delete, `auth.uid() = user_id`), indexes,
   `auth.uid()` defaults, rerunnable/idempotent — following 0035/0037 exactly.

**Plumbing — the eight-box checklist (§14.3)**
5. `StoreState` collections + `normalize()` defaults; adapter read/write;
   tombstone registration under `constitution_elements` / `constitution_revisions`;
   `EXPORT_DOMAINS`; `TABLE_REGISTRY`; account-deletion coverage; restore
   round-trip test; merge rule reusing `uniqRefs` for `linked_refs`.

**Behaviour**
6. Four kinds: `purpose`, `value`, `principle`, `standard`.
7. Create → `draft`; **adopt** → `active` + `adopted_at` + revision `added`.
8. Retire (keeps history) and Delete (cascades) as two distinct, separately
   labelled operations with `buildImpact` disclosure on delete.
9. `linked_refs` picker → Practice, Protocol, NextAction, Project, Note.
10. `exclude_from_ai` toggle.
11. Revision-history view answering *"what changed in how I say I want to live?"*

**Relationship reader (§20.1 D)**
12. Extend `RecordKind` + `buildNodes` with `constitution_element`, `action`,
    `note`, `protocol`, `workspace`, `goal`, `project`, `document`.
13. Add `toKind` to `GraphEdge` where the source knows it.
14. Add the declarative `REF_SOURCES` pass — which also brings existing
    `NextAction`/`Note`/`Capture` `linkedEntityRefs` into the graph.
15. Re-point `lib/actions/relationships.ts` at `backReferences`.

### Migrations required

**Exactly one:** `0038_constitution.sql`, two tables. Additive, idempotent,
rerunnable, no destructive statements, no change to 0001–0037. The relationship
work in items 12–15 requires **no migration at all**.

### Explicit non-goals

No AI anywhere in 056 · no Life Architecture Interview · no Integral, lenses, or
`LensAssignment` · no patterns or detectors · no time model, `Event`, or Calendar
· no Constitution-vs-Reality comparison · no structural audit · no visualization
beyond a plain list · no `boundary`/`identity`/`aspiration`/`question`/`rule`/
`commitment` kinds · no `Person` · no generic `relationships` table · no
`constitution_editions` · no score, percentage, streak, or aggregate of any kind ·
no migration of existing Beliefs, Principles or Practices into Constitution
elements (historical intent is not inferred — the precedent is migration 0037,
which migrated no existing practice for exactly this reason).

---

## 20.6 Architecture risks discovered

**R1 — WITHDRAWN. Graph expansion is not a performance risk.** ~~`buildGraph` is
already at its performance budget, and 056 would make it heavier.~~

This risk was asserted without measurement, and measurement disproved it. On the
300× store `buildGraph` costs **1–7 ms of roughly 1000 ms (~0.6%)**, while
`buildThemes` accounts for **88–92%** and never touches the graph at all. The
memory suite's perf assertion is sensitive to container load, not to graph
construction, so adding node kinds and a generic reference pass is not a
meaningful cost. LIFEOS-056 shipped both and the full regression is green.

What was real and worth doing anyway: two orchestrator scanners each rebuilt an
identical graph inside one pass, and the Today page built one in
`buildLivingMemory` and another in `buildReflectionPrompts` on every render. Both
were fixed in the graph-hardening sprint (2 → 1 builds on each path). The
remaining sensitivity is `buildThemes`, which is outside the Constitution work.

**R2 — `buildGraphEdges` reads collections without `?? []` guards.**
`for (const c of state.captures)` and its siblings assume the collection exists,
while `buildActivityIndex` uses `state.sessions ?? []` throughout. A new
collection reached through a generic pass must be guarded, or a partially-restored
store will throw inside a read-only query layer. `lib/graph/index.ts:33` already
documents the intent — *"the graph is a read-only query layer and must never crash
on imperfect store data"* — so this is a gap against a stated contract.

**R3 — a `principle` kind and the `principles` table share a word.** The live
`principles` table (migration 0013) organizes *knowledge*: `concept_ids`,
`belief_ids`, `citations`. A constitutional `principle` governs *conduct*. They
are different objects with the same name, and both are user-visible. This needs a
copy decision before 056 ships, not after.

**R4 — `Practice.constitutionEntryId` in the paper ontology is a required
field.** `types/lifeos.ts:282` declares `Practice.constitutionEntryId: ID`
(non-optional) and `ONTOLOGY.md` says a Practice *"implements one
ConstitutionEntry."* The live `PracticeCandidate` has no such field, and 056 must
**not** add one: making a Practice require a Constitution element would make the
Constitution mandatory to use Practices. The link direction is
element → practice, and only element → practice.

**R5 — `EXPORT_DOMAINS` order is stable and load-bearing.** Two new domains must
be **appended**, never inserted, or existing archives change meaning. The nine
domains silently dropped before LIFEOS-052 are the standing evidence for why this
checklist is not optional.

**R6 — the `question` reversal is a genuine change of recommendation.** §2.1 and
§17 of this study list `question` among the initial kinds; §20.2 defers it. Where
the two disagree, **§20.2 governs.**
