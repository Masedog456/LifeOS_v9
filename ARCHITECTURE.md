# LifeOS Architecture

> **PROVISIONAL — DESIGN/SPEC ONLY.** This document proposes a durable
> technical architecture for the LifeOS MVP. Nothing here has been
> implemented. No database tables exist, no migrations have been written,
> and no API routes call a database. This is a plan to be reconciled
> against Project Plan v1.0/v2.0 and approved before implementation
> begins (database work starts at LIFEOS-003 per the frozen roadmap).

## Guiding constraint

The stack is frozen: **Next.js (App Router, TypeScript) + Tailwind +
Supabase + Vercel + Anthropic API**, single user. This document works
within that constraint — it does not propose alternatives to it.

## Next.js app structure

```
app/                      # App Router routes (pages + layouts)
app/api/                  # Route handlers — thin, delegate to lib/
components/               # Shared, reusable UI components
lib/                      # Clients, domain logic, server-only utilities
  lib/supabase.ts         # Supabase client (browser + server variants)
  lib/db/                 # Future: typed data-access functions per ontology object
  lib/ai/                 # Future: Anthropic client + prompt/pipeline logic
docs/                     # Project documentation (this file and friends)
types/                    # Shared TypeScript types
  types/lifeos.ts         # Domain model (see below)
  types/supabase.ts       # Future: generated Supabase DB types
```

Route handlers in `app/api/` should stay thin — validate input, call a
function in `lib/`, return a response. Domain logic belongs in `lib/`,
not in route handlers or components, so it stays testable independent of
Next.js.

## TypeScript domain types

`types/lifeos.ts` defines the ontology from `ONTOLOGY.md` as TypeScript
interfaces, independent of any database representation. This is
deliberate: the domain model should be able to survive a future storage
change (e.g. a schema refactor) without every consumer of the types
changing. Supabase-generated types (`types/supabase.ts`, not created yet)
will represent the *storage* shape; a thin mapping layer in `lib/db/`
will translate between storage rows and domain types when that layer is
built.

## Supabase/Postgres tables (future — not created yet)

When LIFEOS-003 implements the database, the expected table shape
(subject to the Product Owner's Plan v2.0 §5 confirmation) is one table
per concrete ontology object in `ONTOLOGY.md`, plus shared tables for the
generic cross-cutting objects (`Relationship`, `Revision`,
`UserJudgment`):

```
sources, books, articles, notes, quotes, claims, concepts, people,
traditions, arguments, questions, megathreads, constitution_entries,
practices, reflections, projects
relationships    -- generic typed edges (fromType/fromId/toType/toId)
revisions        -- generic append-only version history
user_judgments   -- generic append-only human verdicts on AI-proposed content
```

`sources` covers the full `SourceType` union (`book`, `article`, `pdf`,
`webpage`, `video`, `podcast`, `conversation`, `journal`, `image`,
`other`) via its `type` column; `books` and `articles` hold only the
fields specific to those two narrowed subtypes. The other source types
have no dedicated table yet — they live in `sources` alone until/unless a
narrowed subtype is warranted.

Notes on this shape, for future implementation:

- `books` and `articles` likely reference a shared `sources` row (or use
  table inheritance / a `source_type` discriminator column) rather than
  duplicating shared fields — exact approach to be decided at
  implementation time, not now.
- Row-level security (RLS) is explicitly out of scope until LIFEOS-002.
  Since this is a single-user system, RLS today would be scoped to "rows
  belong to the one authenticated user" — a decision to make concretely
  in LIFEOS-002, not here.
- `revisions` and `quotes` (and other immutable-by-design objects) should
  have database-level protections against UPDATE/DELETE on the immutable
  fields once implemented (e.g. triggers or RLS policies), not just
  application-level discipline — enforcing `PRINCIPLES.md` §6 at the data
  layer, not just in the UI.

## Retrieval layer (LIFEOS-009 — implemented, deterministic)

Intelligent Library retrieval is **implemented and deterministic** — no
embeddings, no `pgvector`, no AI route, no background jobs. It runs
entirely in the browser over the in-memory store.

- **Records as a view, not a copy** (`lib/retrieval/records.ts`).
  `buildRecords(state)` projects the existing store into normalized
  `RetrievalRecord`s (one per source / summary / concept / quote / chunk /
  candidate belief / capture / unresolved proposal / belief / earlier
  revision). Records are rebuilt transiently on demand and are **never
  persisted** — they duplicate no large source text on disk. Every record
  keeps provenance (`sourceId`, `page`, `href`) so results are explainable.
- **Explainable ranking** (`lib/retrieval/search.ts`). `search()` scores
  each record with weighted, inspectable signals: exact phrase (×6),
  concept overlap (×4), token overlap (×3), title/author match (×2), page
  provenance, belief-status boost, and recency (×0.5) — exact and concept
  matches are deliberately weighted above recency. Each result carries a
  human "why it matched" `Reason`; **raw scores are never shown in the
  UI**. Results are deduped by normalized text and diversified with a
  per-source cap. `relatedTo(text, …)` is the same engine tuned for
  contextual "what else relates to this" (limit 5, one per source).
- **Feedback tunes ranking only** (`retrieval_feedback`, migration 0004).
  `relevant` boosts, `not_relevant`/`dismissed` suppress, `snoozed` hides
  until `snooze_until`. This is a deterministic re-rank/filter — **not** an
  ML recommender, and it never changes a belief or its status.
- **Where it surfaces.** Library search (grouped by type, with provenance
  and why-matched), Home capture resurfacing (async, after save, ≤1
  primary + up to 2 more, never blocking the save), Constitution
  per-belief related evidence (collapsed, never auto-resolving
  contradictions), and Reader "find related from your library" (collapsed,
  excludes the current source).

The section below describes a *possible future* semantic layer. It is
**not** a description of today's retrieval, which is the deterministic
engine above. A future migration to embeddings would sit behind the same
`search`/`relatedTo` seams.

## Comparative intelligence (LIFEOS-010 — implemented)

Cross-source comparison is **implemented** on top of the deterministic
retrieval layer. It compares 2–5 sources (or a belief + sources) while
preserving genuine differences and exact provenance. No graph UI, no
megathreads, no background agents, and it never changes beliefs or the
Constitution automatically.

- **Deterministic evidence packet** (`lib/comparison/evidence.ts`).
  `buildEvidence(state, inputs, question)` assembles a small, provenance-
  bearing packet from data already in the store: per source — metadata,
  summary, ≤3 representative chunk summaries, ≤4 exact quotes (page/offset),
  ≤6 concepts, ≤3 candidate claims; per belief — its text; per passage — the
  exact quote. The LIFEOS-009 retrieval engine (`search`) ranks which
  quotes/chunks are most relevant to the comparison question. Per-source
  caps plus a total `MAX_PACKET_CHARS` budget keep whole books from being
  sent. Every item gets a stable id (`E1…En`) and records AI/mock origin +
  coverage.
- **One structured AI call, then verification** (`lib/comparison/run.ts`).
  The packet → a single `compare` call on the existing `/api/ai` route →
  strict validation (`lib/comparison/schema.ts`) that **drops any point
  whose `evidenceIds` are not in the packet** (unsupported prose never
  becomes a conclusion; it is flagged). For larger comparisons (≥4 sources)
  an optional second `compare_verify` pass reviews the draft. The mock
  (`lib/mockCompare.ts`) produces a real, evidence-cited result offline, so
  the whole flow works with no API key.
- **Terminology & contradiction care** (Phases 7–8). The prompt and
  validator require cautious language ("resembles", "may parallel", "differs
  because") and flag flattening phrasing ("identical", "interchangeable").
  Each disagreement is classified (logical / practical / definitional /
  level-of-analysis / historical / ambiguity) — not every difference is a
  contradiction.
- **Human judgment** (`components/ComparisonResult.tsx`). Every insight is a
  proposal: Accept → the existing Belief Inbox, Rewrite → Inbox, Question,
  Reject, or just save the comparison. Judgments are append-only on the
  `Comparison`; the Constitution is never touched automatically.
- **Persistence.** A comparison is one row (`comparisons`, migration
  `0005_comparative_intelligence.sql`) with jsonb `inputs`/`evidence`/
  `result`/`judgments`, own-rows RLS. Local fallback stores it in the same
  state blob. Entry points: Nav, Library, Reader ("compare with another
  source"), Constitution ("compare this belief with sources").

## Dialectical intelligence (LIFEOS-011 — implemented)

Structured reasoning is **implemented** on top of the retrieval (LIFEOS-009)
and comparison (LIFEOS-010) layers. An **inquiry** investigates one question
through evidence, arguments, objections, and unresolved tensions — it never
decides what the user must believe, and never changes the Constitution.

- **Evidence packet** (`lib/dialectic/evidence.ts`). `buildInquiryEvidence`
  reuses the comparison evidence builder for source/belief/passage inputs,
  then appends dialectic-specific evidence — belief **revisions**, prior
  **comparison findings**, and **terminology** disputes — continuing the same
  `E1…En` id sequence. Same per-source + total caps; whole books are never
  sent.
- **One structured call, then verification** (`lib/dialectic/run.ts`). Packet
  → a single `dialectic` call on `/api/ai` → strict validation
  (`lib/dialectic/schema.ts`) that **drops any substantive assertion whose
  `evidenceIds` are not in the packet** (flagged, never shown as grounded) →
  optional `dialectic_verify` second pass for ≥4 sources. The mock
  (`lib/mockDialectic.ts`) is deliberately honest: it derives an affirmative
  case from question/word overlap and states plainly that it cannot detect a
  genuine counter-position, rather than fabricating fake symmetric balance.
- **Argument quality** (Phase 5). Points carry an `argType` (premise /
  conclusion / objection / rebuttal / qualification / analogy / definition /
  empirical / interpretive / theological / personal_judgment); the schema
  names reasoning defects (invalid inference, hidden assumption, equivocation,
  circular reasoning, unsupported generalization) only when present, flags
  false-certainty language ("proves", "definitively") over interpretive
  evidence, and never treats all disagreement as logical contradiction.
- **Strict result** (`DialecticResultData`): question, definitions,
  assumptions, strongest affirmative/negative cases, supporting evidence,
  counterarguments, rebuttals, terminology disputes, distinctions, unresolved
  ambiguities, possible syntheses, what-would-change-the-conclusion, questions
  for the human, relation-to-beliefs, reasoning issues, limitations/coverage.
- **Human judgment + evolution** (`components/DialecticResult.tsx`,
  `app/inquiry/[id]`). Each insight is a proposal: Accept/Rewrite → the
  existing Belief Inbox, Question, Reject, or save without adopting. The user
  writes their own provisional conclusion and sets status
  (open/provisional/unresolved/resolved). Re-running with added sources pushes
  the prior result into **append-only `history`** — reasoning is never
  overwritten.
- **Persistence.** One row (`inquiries`, migration
  `0006_dialectical_intelligence.sql`) with jsonb `inputs`/`evidence`/
  `result`/`history`/`judgments`, own-rows RLS. Entry points: Nav, Compare
  ("investigate this question"), Constitution ("challenge this belief"),
  Reader ("investigate this passage").

## Megathreads & longitudinal knowledge (LIFEOS-012 — implemented)

Megathreads are **implemented** as living, provenance-grounded VIEWS over
existing records — not folders and not copies. A thread shows how a topic,
question, or belief develops across sources, captures, comparisons,
inquiries, judgments, and revisions over time. No graph UI, no autonomous
agents, and it never changes the Constitution.

- **Record** (`Megathread`). Stores a seed (type + id + label), human
  title/description/status, **member references** (pointers to existing
  records — no source text is duplicated), curation state (`pinned`,
  `excluded`), a cautious synthesis + its evidence packet, unresolved
  questions, notes, append-only `judgments` and a `revisions` change log.
- **Membership** (`lib/megathread/membership.ts`). Deterministic and
  EXPLAINABLE: `initialMembers` seeds a thread from a belief/comparison/
  inquiry/source and its direct inputs; `candidateMembers` scans records for
  retrieval relatedness (LIFEOS-009 `search`) plus structural links (shared
  source/belief ids in comparisons/inquiries), each with a human-readable
  reason. AI never silently adds members; beliefs are only ever added by
  explicit user action.
- **Timeline** (`lib/megathread/timeline.ts`). A chronological READ-MODEL
  built at render time from existing records — never stored, so it never
  rewrites history. Each event keeps provenance (type, date, source, page,
  human/AI origin, relationship to the thread). Excluded members are skipped.
- **Synthesis** (`lib/megathread/run.ts`, `synthesis.ts`). Capped evidence
  packet (reuses the inquiry evidence builder + appends inquiry findings) →
  ONE `thread_synthesis` call on `/api/ai` → strict validation dropping any
  point whose evidence ids aren't in the packet (flagged, never grounded).
  Belief-evolution and recent-changes are computed deterministically from the
  timeline and injected, so they are always accurate. The mock
  (`lib/mockThreadSynthesis.ts`) produces an evidence-cited synthesis offline.
  Regeneration is explicit; nothing runs in the background.
- **Curation + judgment** (`app/threads/[id]`,
  `components/Thread{Timeline,Synthesis}.tsx`). Add/remove/pin/exclude
  members, edit title/description/notes, rewrite the current understanding,
  add/resolve questions, archive. Each synthesis insight → Accept into the
  Belief Inbox / Question / Reject. The Constitution is never touched
  automatically.
- **Persistence.** One row (`megathreads`, migration `0007_megathreads.sql`)
  with jsonb `members`/`pinned`/`excluded`/`synthesis`/`revisions`, own-rows
  RLS. Entry points: Nav, Constitution ("create Megathread"), Reader ("add to
  Megathread"), Compare/Inquiry ("create thread").

## Formation engine — daily & weekly review (LIFEOS-013 — implemented)

The Formation Engine is **implemented**: a calm daily/weekly review that
helps the user reconnect with past knowledge and decide what should change.
It surfaces and asks; the human interprets and decides. No embeddings, no
graph UI, no background agents, and **no notifications, streaks, points,
badges, or gamification of any kind**. Nothing high-stakes changes
automatically.

- **Records** (`types/mvp.ts`). `Reflection` (immutable `response` + a
  SEPARATE append-only `annotations` list), `PracticeCandidate` (a
  status machine — proposed/accepted/paused/completed/rejected — with
  `derivedFrom` provenance and append-only `history`), and `ReviewSession`
  (daily/weekly, with surfaced items, judgments, reflection ids, accepted
  practices, and an optional narrative synthesis).
- **Daily selection** (`lib/formation/daily.ts`). `buildDailyReview` returns
  **at most three** items, each with an explicit reason, from a fixed-priority
  pool (a questioned belief / an unresolved question / a recent thread change /
  a belief not revisited in a while / a past thought or quote). It is fully
  deterministic and filters items the user dismissed/snoozed/postponed — via
  the existing LIFEOS-009 feedback store — or already reviewed today. No
  infinite feed.
- **Reflection flow** (`app/review`). Per item: affirm / revise / question /
  dismiss / postpone / reflect. Saving a reflection NEVER changes a belief; a
  "revise" routes through the existing append-only `reviseBelief` revision
  flow.
- **Practices** (`lib/formation/practice.ts` + `practice_suggest`). AI
  proposes small, modest practices that must cite their derivation; a
  guardrail rejects medical/legal/financial/dangerous directives and
  moralizing language. Suggestions are provisional — the user must accept or
  rewrite. No scheduling, no streaks.
- **Weekly + alignment** (`lib/formation/weekly.ts`, `alignment.ts`).
  Deterministic counts and week-over-week deltas first; **one optional**
  `weekly_synthesis` narrative whose highlights must cite real record ids
  (validated). The alignment reflection (`alignment_reflection`) is grounded
  ONLY in accepted beliefs, the user's reflections, and accepted practices,
  uses cautious wording ("You reported…", "would you like to examine this?"),
  never accuses or diagnoses, and never infers behavior from missing data.
- **AI + cost** (Phase 9). Deterministic selection → capped provenance packet
  (evidence ids ARE real record ids) → **at most one** AI call per
  user-triggered action → deterministic validation → mock fallback. No
  automatic background calls; the approximate call count is shown before any
  optional synthesis.
- **Home + persistence.** Home stays quiet — one "Begin today's review" link,
  no dashboard/metrics. Records persist to `reflections`/`practices`/
  `review_sessions` (migration `0008_formation_engine.sql`; the reflection
  response is immutable via a DB trigger; own-rows RLS).

## Reasoning engine (LIFEOS-014 — implemented)

Higher-order reasoning across the whole knowledge system is **implemented**,
deterministic-first. It answers questions like "which beliefs are weakly
supported?", "what contradictions exist?", "what shaped this view?". No
autonomous agents, no graph UI, and it never changes the Constitution.

- **Record** (`ReasoningQuery`): question, one of eight modes, optional scope
  (entire library / selected sources / beliefs / threads / comparisons /
  inquiries), the evidence packet (references, not text copies), the strict
  structured result, human judgments, provisional conclusion, status, and an
  append-only `history` of prior runs.
- **Modes**: support audit · contradiction audit · influence trace ·
  assumption audit · belief-impact analysis · unresolved-question synthesis ·
  change-over-time analysis · open inquiry. One workspace, not a page per mode.
- **Evidence graph** (`lib/reasoning/graph.ts`). `resolveScope` resolves a
  scope to concrete id sets and expands conservatively from a selection;
  `buildReasoningGraph` builds an INTERNAL node/edge structure (source, quote,
  belief, revision, comparison, inquiry, thread, reflection, practice …; edges
  derived_from / revised_from / references / compared_with / investigated_by /
  belongs_to …) plus a capped evidence packet whose ids ARE real record ids.
  Never rendered as a graph, never duplicates source text.
- **Deterministic passes** (`lib/reasoning/passes.ts`) run BEFORE any AI and
  produce the grounded result: support audit (counts, **no truth score**),
  contradiction audit (comparison disagreements, inquiry both-sided readings,
  opposing-polarity belief pairs, revision reversals — each classified
  cautiously so a definitional difference is not a logical contradiction),
  influence trace (source→capture→belief→revision, comparison/inquiry→belief),
  assumption audit (recurrence-deduped), belief-impact (may-support /
  may-challenge / affected threads / reopened inquiries — mutates nothing),
  change-over-time, and unresolved synthesis.
- **AI layer** (`reasoning_synthesis` + optional `reasoning_verify`). One call
  adds a narrative key-findings layer over the deterministic result; validation
  (`lib/reasoning/schema.ts`) drops any finding whose evidence ids aren't in
  the packet (flagged) and flags overconfident wording. A verification pass runs
  only for large graphs (≥30 nodes). Mock fallback echoes the deterministic seed.
- **Cost controls** (Phase 6). Max scope sources, max evidence packet size,
  approximate call count + record/evidence counts shown, partial-coverage
  warning, explicit confirmation for expensive (≥2-call) runs, no background
  reasoning.
- **Human judgment + history** (`app/reason/[id]`,
  `components/ReasoningResult.tsx`). Accept a finding → Belief Inbox, rewrite,
  question, reject; mark a candidate contradiction resolved/unresolved; write a
  provisional conclusion; reopen a referenced inquiry; attach the result to a
  Megathread (adds a note); re-run (pushes the prior result into append-only
  history). Persisted as `reasonings` (migration `0009_reasoning_engine.sql`,
  own-rows RLS). Entry points: Constitution belief ("audit support") + header
  ("find tensions"), Reader source ("trace influence"), Megathread ("reason
  across this thread"), Nav.

## Semantic retrieval & evidence freshness (LIFEOS-015 — implemented)

An **optional** semantic layer improves recall and candidate selection
without replacing deterministic logic, plus deterministic freshness tracking
for every saved result. No graph UI, no autonomous agents, and the
Constitution is never auto-changed.

- **Provider seam** (`lib/embeddings/`). A provider-independent
  `EmbeddingProvider` interface (name/model/dimensions/health/embed/
  embedBatch/cost). A built-in **local lexical embedder** (`local.ts`:
  synonym-aware bag-of-concepts, 128-d, deterministic, offline, zero-config)
  powers **live in-browser hybrid ranking**. A configured HTTP provider
  (`/api/embed`, `EMBEDDING_API_KEY` + `EMBEDDING_PROVIDER_URL` +
  `EMBEDDING_MODEL`, server-only) produces the durable index; the route falls
  back to local vectors so indexing works with no configuration. Text is
  never logged; credentials never reach the browser.
- **Hybrid ranking** (`lib/retrieval/search.ts`). Adds an **additive**
  semantic term strictly **below** exact (×6) and concept (×4) authority — an
  exact or concept match always outranks a weak semantic match; a
  semantic-only candidate is capped (~×2.5). New reason label "Semantically
  related"; raw vector scores are never shown. Semantic activates only once
  the user has built an index (`state.embeddings.length > 0`) — deterministic
  retrieval is unchanged otherwise.
- **Index** (`lib/embeddings/{records,index}.ts`). `embeddableItems` projects
  the ten eligible record kinds with content hashes (never keys/auth, never
  duplicate `originalText` when chunks exist). `runIndex` is user-triggered,
  batched, and idempotent — only new/changed hashes are (re-)embedded, capped
  per operation, with retries. Stored durably (`embeddings` table, pgvector,
  own-row RLS, `match_embeddings` RPC — migration `0010_semantic_retrieval.sql`).
- **Reasoning use** (`lib/reasoning/passes.ts`). Semantic **widens candidate
  pools** (e.g. contradiction pairing over semantic neighbours) but a finding
  is only recorded when the deterministic gate holds (opposing polarity) — so
  **semantic similarity alone never labels two beliefs contradictory**, and
  every finding still cites provenance.
- **Freshness** (`lib/freshness/fingerprint.ts`). Every saved comparison /
  inquiry / thread synthesis / weekly review / reasoning stores a
  deterministic fingerprint (dependency record ids + content hashes + pipeline
  version + embedding model). `freshnessStatus` recomputes and diffs →
  `current` / `potentially_stale` / `stale` / `unknown`, with reasons ("2
  beliefs were revised", "new evidence was added", "the processing pipeline
  changed"). Pure and offline — no AI, no embeddings required.
- **Rerun** (`components/FreshnessBadge.tsx`). Explicit, never automatic:
  preserves the prior result in append-only history, generates a new result
  from current evidence, and **never overwrites the user's conclusions**. The
  approximate AI (and embedding) call count is shown before running.

## Decision intelligence (LIFEOS-016 — implemented)

A structured workspace for reasoning through meaningful decisions using the
user's own sources, beliefs, threads, reflections, inquiries, practices, and
prior decisions. LifeOS clarifies tradeoffs; **it never chooses**. No agents,
no graph UI, no gamification, no automatic changes to beliefs/practices/the
Constitution, and no medical/legal/financial-trading conclusions.

- **Record** (`Decision`). Title, question, status (exploring/narrowed/
  decided/deferred/abandoned), 2–8 options (named / do-nothing / defer /
  hybrid; each with benefits, costs, risks, reversibility, time horizon,
  assumptions, open questions), editable criteria with OPTIONAL 1–5 weights,
  a user ratings grid (−2..+2), constraints/assumptions, evidence packet
  (references — never text copies), a validated analysis with append-only
  `history`, the user's provisional/final choice + rationale + **stated**
  confidence (never computed), append-only judgments/revisions/outcome
  reviews, and a freshness fingerprint.
- **Deterministic first** (`lib/decision/tradeoffs.ts`). Weighted totals are
  pure arithmetic over the user's own ratings, shown explicitly as ONE
  PERSPECTIVE with no implied precision — and they work with zero AI.
- **Evidence** (`lib/decision/evidence.ts`). A capped packet (≤40 items)
  ranked by lexical overlap + local semantic similarity (when the LIFEOS-015
  index exists) across beliefs, reflections, accepted practices, sources
  (+ top quote inline), comparisons, inquiries, threads, reasoning results,
  and earlier decisions. Evidence ids ARE real record ids; entry-point seeds
  are force-included; missing data is never treated as fact.
- **AI** (`decision_synthesis` + optional `decision_verify` for ≥5 options).
  One structured call over the packet + the user's stated options/criteria/
  ratings context. Validation (`lib/decision/schema.ts`) drops uncited
  grounded findings (tradeoffs, values alignment, assumptions, risks,
  strongest cases — flagged, never shown as conclusions), forces values-
  alignment verdicts to supports/conflicts/mixed/**unclear** (never
  certainty), and flags prescriptive ("you should choose") or falsely-certain
  (guarantees, invented probabilities) language. Speculative sections
  (scenarios best/expected/worst/wildcard, pre-mortem, regret, missing
  evidence) are reflective prompts, bounded but not citation-gated. Honest
  mock offline.
- **Safety** (`lib/decision/safety.ts`). Medical/legal/financial/self-harm/
  dangerous topics get a calm caution (a qualified professional belongs in
  the decision; 988 for self-harm) — autonomy preserved, nothing blocked, no
  harmful action plans. Ordinary decisions get no banner at all.
- **Human control + outcome review**. Final choices happen only via an
  explicit button with the user's own rationale; decisions can be deferred,
  abandoned, or reopened; insights → Belief Inbox; decisions attach to
  Megathreads. Outcome reviews are reflective and append-only (what
  happened, surprises, wrong assumptions, lessons) — never a score.
- **Freshness + rerun.** The fingerprint covers the evidence records AND a
  `decision-config:` dep (options/criteria/weights/ratings), so "criterion or
  option changed" surfaces alongside "belief was revised". Rerun preserves
  the prior analysis in history and never touches the user's rationale or
  choice. Persisted as `decisions` (migration
  `0011_decision_intelligence.sql`, own-rows RLS). Entry points: Nav,
  Constitution, Megathreads, Reasoning, Review.

## Reflective practice & daily formation (LIFEOS-017 — implemented)

A place the user returns to in order to examine themselves, integrate
experience, and grow — the bridge between **knowledge → experience →
reflection → belief revision → character**. Not productivity, not task
management, not streaks or habit gamification. LifeOS asks and clarifies;
**it never concludes for the user**, and nothing here changes the
Constitution, a decision, or a thread automatically.

- **Record** (`FormationSession`). A typed session (morning / evening /
  decision review / book integration / conversation review / failure /
  success analysis / conflict / practice reflection / open / **custom**),
  its generated prompt set, an **immutable** reflection body, explicit links
  to decisions/beliefs/practices/threads/inquiries/sources/reflections,
  user-authored structured capture (lessons, unresolved questions, emotional
  observations, revised assumptions, belief candidates, follow-up
  reflections), an evidence packet (references — never text copies), a
  validated cited synthesis with append-only `history`, append-only
  judgments, a freshness fingerprint, and a status.
- **Reflection engine** (`lib/formation/prompts.ts`). Deterministic, offline
  prompt generation drawn from the user's OWN knowledge — questioned beliefs,
  recent revisions, unresolved inquiries, aging decisions, fast-growing
  threads — tuned per session type. Prompts EXAMINE ("What surprised you?",
  "What assumption changed?", "What are you avoiding?"); never productivity or
  streaks.
- **Evidence** (`lib/formation/sessionEvidence.ts`). A capped packet (≤40)
  ranked by lexical overlap + local semantic similarity across beliefs,
  reflections, accepted practices, sources, threads, inquiries, and decisions;
  linked records and entry-point seeds are force-included; evidence ids ARE
  real record ids; missing data is never treated as fact.
- **Synthesis** (`formation_synthesis`). One structured call, deterministic
  extraction first. Returns themes, recurring tensions, possible belief
  revisions (grounded — MUST cite), decision/inquiry/thread follow-ups,
  possible practices, questions worth revisiting, items needing evidence, and
  limitations. Validation (`lib/formation/sessionSchema.ts`) drops uncited
  belief-revision suggestions (flagged) and softens away moralizing ("you
  should", "you failed") and false-certainty ("this proves") language — a
  synthesis surfaces possibilities, never verdicts. Honest mock offline.
- **Timeline** (`lib/formation/timeline.ts`, Phase 6). A DERIVED, read-only,
  chronological, deduped view of reflections, belief revisions, decisions +
  outcome reviews, inquiries, practice changes, and new threads. Built fresh
  each render; never stored, never editable.
- **Cadence** (`lib/formation/cadence.ts`, Phase 7). Five horizons — Today /
  This Week / This Month / This Year / Life — surfacing changes, unfinished
  thinking, stale decisions, aging inquiries, un-revisited beliefs, and
  fast-growing threads. Every item carries an explicit, gentle invitation;
  nothing is a notification, nothing is urgent.
- **Human control.** Every synthesis insight is judgeable (Accept → Belief
  Inbox / Question / Set aside); belief candidates promote to the Inbox only
  by explicit action; reflections attach to Megathreads and unresolved
  questions become inquiries only when the user chooses. Sensitive topics get
  the same calm caution as decisions.
- **Freshness + rerun.** The fingerprint covers the evidence records AND a
  `formation-config:` dep (the reflection + structured capture), so "your
  reflection changed" surfaces alongside "belief was revised". Rerun preserves
  prior syntheses in history. Persisted as `formation_sessions` (migration
  `0012_reflective_practice.sql`, own-rows RLS). Entry points: Nav (Reflect),
  Constitution, Megathreads, Decisions, Inquiry, Library, Review.

## Worldview & concept graph (LIFEOS-018 — implemented)

The conceptual backbone: a model of the user's evolving understanding of
reality — concepts, the relationships between them, reusable principles, and
the frameworks that organize them. **Not** a graph visualization (everything
is text lists), **not** embeddings, **not** agents. Deterministic-first and
human-reviewed: nothing is inferred silently, and nothing changes a belief or
the Constitution.

- **Concept** (`Concept`). name, aliases, definition, description, cross-type
  links (beliefs/threads/sources/practices), denormalized concept↔concept
  structure (parent/child/related/opposing — maintained ONLY by approved
  relationships), principle links, open questions, append-only `history`,
  status, and a freshness fingerprint.
- **Relationship** (`ConceptRelationship`, first-class). A richly-annotated
  edge with one of 12 types (supports, depends_on, contradicts, extends,
  refines, contains, requires, explains, analogous_to, historically_related,
  terminologically_related, part_of), a required `reason`, `citations`,
  `confidence`, `source`, and an `approved` flag. Proposed edges stay off the
  graph until a human approves; approval maps the type onto the two concepts'
  structural arrays (`lib/world/relationships.ts`). Nothing inferred silently.
- **Principle** (`Principle`, Phase 6). Reusable, many-to-many with beliefs
  and concepts — a principle supports many beliefs; a belief derives from many
  principles.
- **Framework** (`Framework`, Phase 5). A worldview layer
  (framework/tradition/school/paradigm/map) that ORGANIZES concepts and
  principles with append-only membership history. Frameworks never own beliefs.
- **Extraction** (`lib/world/extract.ts`, Phase 4). Deterministic candidates
  from the user's own material (source key-concepts, belief themes, concept-
  seeded threads); then one `concept_extract` AI call proposes new concepts,
  missing links, duplicates, missing definitions, possible principles, and
  worldview clusters. Validation (`lib/world/schema.ts`) bounds shapes, clamps
  relationship types, and filters citations to real record ids. Every proposal
  is REVIEWABLE — nothing is applied automatically. Honest mock offline.
- **Tensions** (`lib/world/tensions.ts`, Phase 7). Deterministic detection of
  isolated concepts, unsupported concepts, duplicates (name/alias/definition
  overlap), circular definitions (parent cycles + definition name-reference
  cycles), contradictory principles, and framework overlap. Nothing resolves
  automatically — each is an invitation to look.
- **Evolution + timeline** (`lib/world/timeline.ts`, Phase 8). Every concept/
  relationship/principle/framework change is append-only; a derived, read-only
  timeline shows the model's evolution.
- **Freshness.** A concept carries a fingerprint over its linked records AND a
  `concept-config:` dep (definition + links), so "concept definition changed"
  surfaces. "Review" recomputes it with no AI call.
- Persisted as `concepts` / `concept_relationships` / `principles` /
  `frameworks` (migration `0013_world_model.sql`, own-rows RLS). UI: `/world`
  (Concepts / Frameworks / Principles / Tensions / Review / Timeline tabs) and
  `/world/concept/[id]`. Entry points: Nav (World), Constitution, Megathreads.

## Knowledge synthesis & authoring (LIFEOS-019 — implemented)

The synthesis layer: the user turns everything they have learned into a book,
essay, lecture, course, research paper, blog series, guide, or a statement of
their own philosophy. **Not** a chatbot, **not** autonomous writing —
evidence-first, human-directed, deterministic-first. The system assembles
evidence, proposes outlines, and drafts one section at a time on request; it
never writes the whole work on its own and never invents a citation.

- **Record** (`KnowledgeProject`). title/description/purpose/audience, `kind`,
  status, an `assembly` (chosen evidence ids across all nine record types —
  references, never copies), generated `outlineOptions` + the chosen outline,
  `sections` (each a `DraftSection` with `DraftParagraph[]`, append-only
  `versions`, and a fingerprint), an append-only project `history`, and a
  freshness fingerprint.
- **Assembly** (`lib/authoring/assembly.ts`, Phase 3). Deterministically
  resolves the chosen sources/beliefs/concepts/threads/reasonings/frameworks/
  principles/formation-sessions/decisions into a flat, provenance-bearing
  packet whose ids ARE real record ids.
- **Outlines** (`lib/authoring/outline.ts`, Phase 4). Per-kind deterministic
  templates seeded with the project's own concepts/threads, plus one AI
  candidate (`outline_generate`). Several are offered; the human chooses one,
  which seeds empty sections.
- **Section drafting** (`lib/authoring/draft.ts` + `schema.ts`, Phase 5/6). One
  `section_draft` AI call over the assembled evidence produces cited paragraphs;
  validation filters citations to real ids and marks uncited paragraphs
  UNSUPPORTED (surfaced + removable). Eight transforms (rewrite/expand/compress/
  clarify + academic/popular/technical/conversational) re-draft a single
  section in a new register — never the whole work. Honest mock offline.
- **Citations** (`lib/authoring/citations.ts`, Phase 6). Resolves ids → labels
  + hrefs, finds unsupported statements across the project, and computes
  coverage (how much assembled evidence is actually cited).
- **Cross-references** (`lib/authoring/crossref.ts`, Phase 7). Deterministic
  suggestions while writing — related concepts, missing evidence, contradictions
  (questioned beliefs / opposing concepts both cited), older drafts, relevant
  decisions, formation insights, and duplicate paragraphs. NEVER inserted
  automatically.
- **Revision history** (Phase 8). Section drafts are append-only `versions`
  (human/ai/mock tagged); the project keeps an append-only change log. Earlier
  text is never overwritten.
- **Export** (`lib/authoring/export/`, Phase 9). Deterministic, **dependency-
  free** writers for Markdown, HTML, DOCX (a store-only ZIP + minimal OOXML,
  via a pure-TS CRC32 zip writer), and PDF (a minimal Helvetica PDF writer with
  wrapping + pagination). All render one `ExportDoc`, so citations are preserved
  identically as inline [n] markers + a numbered reference list.
- **Freshness.** `projectDeps` covers every assembled evidence record, so
  "source changed" / "belief was revised" surface against the work.
- Persisted as `knowledge_projects` (migration `0014_authoring_engine.sql`,
  own-rows RLS). UI: `/author` (list + create) and `/author/[id]` (assemble →
  outline → draft/transform → citations + cross-refs + history → export). Entry
  points: Nav (Author), Megathreads ("Write from this thread").

## Research workspace (LIFEOS-020 — implemented)

A structured environment to investigate a question BEFORE writing conclusions.
**Not** autonomous research, **not** web browsing, **not** an agent —
evidence-first, deterministic-first, human-directed, and (notably) **AI-free**:
the whole sprint is deterministic, so it adds no `/api/ai` task. Built largely
by REUSING earlier subsystems rather than duplicating them.

- **Record** (`ResearchProject`). A primary question plus a `questions` layer
  (subquestions/unknowns/assumptions/definitions/success-criteria/open-problems,
  each history-bearing — Phase 3), an evidence `assembly` (**reuses** the
  LIFEOS-019 `ProjectAssembly` + `assembleEvidence` — references across all
  record types, never copies — Phase 4), project-local `notes`, competing
  `hypotheses` (Phase 5), an explicit user-authored argument map
  (`argumentNodes` + `argumentEdges` — Phase 6), an append-only project
  `history`, a freshness fingerprint, and an optional `seededProjectId`.
- **Hypotheses** (Phase 5). statement, USER-stated confidence, supporting /
  contradicting evidence (real record ids), open questions, status. Users hold
  multiple competing hypotheses; LifeOS never selects a winner.
- **Argument map** (Phase 6). Nodes (claim/evidence/counterargument/objection/
  rebuttal/open_question/unknown) and edges (supports/contradicts/objects_to/
  rebuts/answers/raises/depends_on). Every node and edge is user-authored —
  reusing the LIFEOS-018 "explicit, nothing inferred" pattern (no approval flow
  needed since the human creates each one directly).
- **Gap detection** (`lib/research/gaps.ts`, Phase 8). Deterministic:
  unsupported claims, missing evidence, contradictory evidence (a record cited
  both for and against), duplicate evidence, orphan questions, and unresolved
  hypotheses. Never resolves anything — reuses the tension/cross-ref detector
  pattern.
- **Timeline** (`lib/research/timeline.ts`, Phase 7). A derived, read-only,
  chronological aggregation of the append-only histories — reuses the
  world/formation timeline pattern.
- **Export** (`lib/research/export.ts`, Phase 9). Maps a research project into
  the SAME `ExportDoc` model as the Authoring Engine and **reuses its
  deterministic MD/HTML/DOCX/PDF writers** — questions, hypotheses, argument
  map, gaps, and evidence render with provenance as a numbered reference list.
- **Research → Author** (Phase 10). `seedAuthorFromResearch` **reuses**
  `createKnowledgeProject({ assembly })` to hand the same evidence ids to the
  Authoring Engine — no content duplication; both sides record the handoff.
- **Shared component.** The evidence-selection UI was extracted to
  `components/EvidencePicker.tsx` and is now used by BOTH `/author/[id]` and
  `/research/[id]` (the authoring page was refactored onto it, re-verified by
  its E2E).
- **Freshness.** `researchDeps` covers assembled evidence + evidence cited on
  hypotheses. Persisted as `research_projects` (migration
  `0015_research_workspace.sql`, own-rows RLS). UI: `/research` (list + create)
  and `/research/[id]` (Overview / Questions / Evidence / Hypotheses / Arguments
  / Timeline / Gaps / Export tabs, with filter + search). Entry points: Nav
  (Research), Megathreads, Constitution.

## Unified graph & incremental persistence (LIFEOS-021 — implemented)

An architecture-strengthening sprint: no new end-user feature, no AI, no new
endpoints. It makes every module faster and more connected and readies the
persistence layer for scale — **deterministic-first and non-breaking** (all
prior regression suites re-run green).

- **Unified reference index** (`lib/graph/references.ts`, Phase 2). One pass
  (`buildGraphEdges`) enumerates EVERY explicit reference across all record
  types, tagged by relation (referenced-by / used-in / investigated-by /
  authored-from / mentioned-in / supports / contradicts / related-to /
  derived-from / cites / part-of). An edge exists only where a record literally
  stores another record's id — nothing inferred.
- **Knowledge graph service + relationship API** (`lib/graph/index.ts`, Phase
  3 + 7). One deterministic query layer: `buildGraph`, `lookup`,
  `forwardReferences`, `backReferences` (categorized), `relationshipsOf`,
  `dependencyChain`, `provenance` (to root sources), `parents`/`children`, and
  integrity (`brokenReferences`, `orphanRecords`, `duplicateIds`). Replaces
  ad-hoc reverse lookups. No visualization, no embeddings, no AI.
- **Incremental persistence** (`lib/persistence.ts` + adapters, Phase 4). The
  store mutates immutably, so an unchanged domain keeps the SAME array
  reference — dirty domains are computed by reference-equality against the last
  synced snapshot with **zero store changes**. `saveState(state, dirty?)` gains
  an optional dirty set; the SupabaseAdapter pushes only dirty tables when it's
  supplied and the whole state otherwise (backward compatible). Local fallback
  and offline-first are preserved (localStorage stays a single blob).
- **Performance layer** (`lib/perf/profile.ts`, Phase 5). Deterministic
  `profile()` timing + `measureStore()` (counts, byte sizes, and timings for
  graph build/lookup, integrity, timeline, and assembly).
- **Store modularization** (`lib/stores/*.ts`, Phase 6). Domain FACADES
  (knowledge / research / author / world / reasoning / decision / graph)
  re-export each domain's public API. A deliberate, justified non-breaking
  choice: physically splitting the 2200-line store would touch ~25 page imports
  and risk the suite, which the sprint forbids — the facades give a modular API
  surface while `useStore()` remains the single source of state.
- **Developer diagnostics** (`app/diagnostics/page.tsx`, Phase 8). Dev-only,
  read-only: record counts, dirty domains, sync queue, graph size, integrity
  (orphan / broken references, duplicate ids), hydration + migration status,
  and performance metrics.
- **Persistence.** Migration `0016_graph_and_incremental_sync.sql` — additive
  `updated_at` indexes (incremental loads) + an own-rows `sync_meta` cursor
  table. No table/row/RLS/migration 0001–0015 is modified.

## Socratic dialogue & dialectical engine (LIFEOS-022 — implemented)

A structured environment to *investigate* an idea through disciplined dialogue —
**not** a chatbot, **not** roleplay, **not** autonomous reasoning. Evidence-
first, deterministic-first, human-directed, and **AI-FREE** (adds no `/api/ai`
task — the Socratic engine is deterministic, which is precisely what "not a
chatbot" requires). Built largely by REUSING earlier subsystems (reasoning,
research, world model, knowledge graph, authoring, decision intelligence).

- **Record** (`DialogueSession`). id / title / topic / purpose / status
  (open → active → paused → concluded → archived) / `participants`
  (perspectives) / `seedRefs` / `turns` / `outcomes` / append-only `history` /
  freshness `fingerprint`. Seedable from a belief, thread, research project, or
  concept.
- **Dialogue turns** (`DialogueTurn`). Typed (question / response / challenge /
  clarification / counterargument / evidence / reflection / summary), authored
  (you / socratic / perspective), each carrying its own `citations` and `flags`
  (insight / new_question / dead_end). Provenance lives on every turn — a turn
  says who spoke, from which viewpoint, and on what evidence.
- **Socratic engine** (`lib/dialogue/socratic.ts`, `generateInquiries`).
  Deterministic. Always offers the six classic moves — "What do you mean by…?",
  "What evidence supports this?", "Could the opposite be true?", "What
  assumptions are hidden?", "What follows if this is true?", "What would falsify
  this?" — plus, per framework/principle perspective, a "How would [X] respond?"
  line, and graph-grounded lines for contradicting beliefs, related research,
  decision history, and related concepts. It never chooses for you: it presents
  multiple lines of inquiry as prompts, and only the user turns them into turns.
- **Perspective engine** (participants). Viewpoints drawn from the user's own
  knowledge — Current / Past Constitution, Frameworks, Principles, Beliefs,
  Research projects, Authors (sources). Each perspective cites the record it is
  sourced from; nothing is invented or roleplayed.
- **Graph integration** (`lib/dialogue/context.ts`, `buildDialogueContext`).
  REUSES the LIFEOS-021 knowledge graph (`buildGraph` / `relationshipsOf`) to
  surface, from EXPLICIT references only, related concepts, supporting +
  contradicting beliefs, related research, authoring, and decision + formation
  history around the dialogue's anchors (seedRefs + topic-named concepts +
  perspective refs). Never inferred silently.
- **Outcomes** (`lib/mvpStore.ts` spawners). A dialogue can become a Research /
  Knowledge / Decision project, a Concept / Principle / Framework, or a Belief /
  Constitution proposal — each REUSES the existing creator
  (`createResearchProject` / `createKnowledgeProject` / `createDecision` /
  `createConcept` / `createPrinciple` / `createFramework` / `sendToInbox`) and is
  recorded as provenance on the dialogue. Nothing is automatic; belief and
  Constitution proposals always route to the Inbox for human judgment.
- **Timeline** (`lib/dialogue/timeline.ts`, `buildDialogueTimeline`). Derived,
  read-only aggregation of the session's creation, turns (surfacing insights,
  new questions, and dead ends via turn flags), and outcomes — append-only,
  newest-first. Same derived-timeline pattern as research/formation.
- **UI.** `/dialogue` (list + create, with seed params from constitution /
  threads / research / concepts) and `/dialogue/[id]` (tabbed Dialogue /
  Perspectives / Graph / Outcomes / Timeline). Nav gains "Dialogue"; the
  Constitution page offers "Question in dialogue →" on a belief and Threads
  offers "Investigate in dialogue →".
- **Freshness + persistence.** `dialogueDeps` (seedRefs + participant refs +
  turn citations) feeds the shared freshness fingerprint. `dialogueSessions`
  array persists through both adapters; migration `0017_dialogue_engine.sql`
  adds an own-rows-RLS `dialogue_sessions` table (jsonb participants / seed_refs
  / turns / outcomes / history / fingerprint). No table/row/RLS/migration
  0001–0016 is modified.

## Dialectical synthesis & tension resolution (LIFEOS-023 — implemented)

Turns a dialogue into genuine dialectical *reasoning*: the engine surfaces
tensions between the user's beliefs, assumptions, evidence and perspectives, then
helps build increasingly coherent syntheses. The goal is **not** debate,
persuasion, or winning — it is the progressive refinement of understanding, and
uncertainty is preserved wherever justified. Deterministic-first, evidence-first,
human-directed, and **AI-FREE** (adds no `/api/ai` task). REUSES the LIFEOS-021
knowledge graph and the LIFEOS-022 dialogue context.

- **Records** (`Tension`, `Synthesis`). A `Tension` explicitly represents a
  thesis and antithesis, the records each rests on, evidence links, four-axis
  confidence, unresolved questions, a `kind` (conflicting_beliefs /
  incompatible_assumptions / unresolved_paradox / competing_values /
  empirical_disagreement / logical_inconsistency / definition_mismatch), a status
  lifecycle, and a stable `signature` so re-detection never duplicates it. A
  `Synthesis` integrates one or more tensions and records preserved insights,
  discarded assumptions, common ground, remaining uncertainty, four-axis
  confidence, append-only revisions, and provenance outcomes.
- **Tension detection** (`lib/dialectic/tensions.ts`, `detectTensions`).
  Deterministic and EXPLICIT-signal only: graph `contradicts` edges between
  in-context beliefs, a concept's declared `opposingConcepts`, ≥2 competing
  framework/principle perspectives, research hypotheses that cite evidence both
  for and against, and challenge/counterargument turns left unanswered in the
  transcript. Nothing is inferred by language modelling; nothing is auto-resolved.
- **Synthesis generation** (`lib/dialectic/synthesis.ts`, `generateSyntheses`).
  Deterministic scaffolds — a higher-order **integration** (each side captures a
  real part; the mutual-exclusivity assumption is discarded), a **scoped**
  resolution (each side holds under stated conditions), and always a **deferral**
  that preserves the tension when integration is not yet justified. A synthesis
  is never a mere compromise, and the user authors/edits/accepts/rejects — the
  engine decides nothing.
- **Separated confidence** (`lib/dialectic/confidence.ts`). Factual / logical /
  evidential / experiential are tracked as four independent axes and NEVER
  collapsed into a single score; `unknown` is a first-class value, and the engine
  defaults to the conservative reading (evidential strength is the *weaker*-
  supported side, not the average). This is the primary guard against false
  certainty.
- **Conversation memory** (`lib/dialectic/memory.ts`, `buildDialecticMemory`).
  Derived, read-only: previous (accepted) syntheses, abandoned (rejected/
  superseded) syntheses, unresolved tensions, and recurring conflicts (records
  that participate in more than one tension). Built fresh each render.
- **Knowledge integration** (`lib/mvpStore.ts`). A synthesis can become a
  Belief/Constitution proposal (→ Inbox), a Concept or Principle (World Model), or
  a Research project — each REUSES the existing creators (`sendToInbox` /
  `createConcept` / `createPrinciple` / `createResearchProject`) and is recorded
  as provenance on the synthesis. Nothing mutates a belief, concept, research
  project, or dialogue automatically; every integration is an explicit user act.
  (Reasoning-record integration is deferred because reasonings require the AI
  route — see the sprint's future-work note.)
- **UI — Dialectical Workspace.** A "Dialectic" tab on `/dialogue/[id]`
  (`components/DialecticWorkspace.tsx` + `TensionCard` / `SynthesisPanel` /
  `ConfidenceMeter`) where the user inspects tensions, compares the two poles
  with their evidence, reads the deterministic why-flagged rationale, sees the
  four confidence axes, accepts/rejects/revises syntheses, writes their own, and
  continues the dialogue from any synthesis. Every intermediate reasoning
  structure is inspectable — nothing is hidden.
- **Freshness + persistence.** `tensionDeps` / `synthesisDeps` feed the shared
  freshness fingerprint. `tensions` + `syntheses` arrays persist through both
  adapters (dirty-gated). Migration `0018_dialectical_synthesis.sql` adds
  own-rows-RLS `tensions` and `syntheses` tables (jsonb bodies, four-axis
  confidence, indexes); additive and idempotent. No table/row/RLS/migration
  0001–0017 is modified.

## Cognitive orchestration & active intelligence (LIFEOS-024 — implemented)

Makes the subsystems collaborate. A lightweight **Cognitive Orchestrator**
observes the store and coordinates the existing modules so the user no longer
has to decide which subsystem to reach for. It generates **opportunities, not
content**: deterministic `Recommendation`s surfaced in a single **LifeOS Inbox**.
No AI (adds no `/api/ai` task); nothing is executed automatically and no
knowledge is ever mutated.

- **Architecture invariant.** *No subsystem depends on another — all
  coordination flows through the orchestrator.* Each scanner is a pure,
  deterministic read over `StoreState` that inspects ONLY its own subsystem and
  returns proposals; scanners never import one another. The orchestrator
  (`lib/orchestrator/index.ts`) is the sole merge point, so there are no circular
  dependencies and the coupling surface stays flat.
- **Recommendation** (`types/mvp.ts`). type / priority / confidence (the
  LIFEOS-023 four-value `ConfidenceLevel`) / rationale / originating `subsystem` /
  `suggestedAction` / `actionHref` / `affected` (references) / stable `signature` /
  createdAt / `dismissed` / `accepted` / `completed` / `snoozedUntil`.
- **Scanners** (`lib/orchestrator/scanners/*.ts`, one per subsystem):
  - **belief** → `open_dialogue` — two accepted beliefs in tension (a
    `contradicts` edge, or resting on declared opposing concepts) with no
    dialogue yet investigating them.
  - **research** → `create_synthesis` — a project references an accepted belief
    and holds a hypothesis with contradicting evidence.
  - **graph** → `elevate_concept` (well-connected but under-structured) /
    `merge_duplicate_concepts` (same name or alias overlap).
  - **world** → `new_principle` — a concept underpins several beliefs but is not
    yet a principle.
  - **dialogue** → `unresolved_tension`, `create_research_question` (a tension's
    syntheses keep failing), `formation_exercise` (a record recurs in tensions
    across dialogues), `import_source` (a dialogue cites a record that no longer
    exists), `confidence_decline` (a synthesis's confidence keeps dropping).
  - **review** → `review_belief` — held for months without review.
  - **formation** → `repeat_reflection` — an accepted recurring practice.
  - **decision** → `revisit_decision` — decided but never outcome-reviewed.
- **The orchestrator.** `runScanners(state)` runs every scanner and dedupes by
  signature; `mergeRecommendations(existing, proposals, …)` refreshes matching
  recommendations while **preserving the user's accept/dismiss/snooze/complete
  decisions**, adds new ones, keeps engaged-with recommendations whose signal has
  gone (audit trail), and drops only un-engaged stale ones. Sorted
  most-actionable first (priority, then recency; stable within a scan).
- **UI — the LifeOS Inbox** (`app/orchestrator/page.tsx` + `RecommendationCard`).
  Filter by status / priority / subsystem; each card shows its priority,
  subsystem, confidence, affected-object chips, and an inspectable rationale
  ("Why am I seeing this?"), with **Act on this →** (jump to the originating
  object), **Done**, **Snooze**, **Dismiss**, and **Reopen**. Nothing is executed
  automatically — accepting merely marks the recommendation and navigates.
- **Persistence.** `recommendations` array persists through both adapters
  (dirty-gated). Migration `0019_cognitive_orchestrator.sql` adds an
  own-rows-RLS `recommendations` table (jsonb `affected`, lifecycle flags,
  indexes on user/created, subsystem, type, and signature); additive and
  idempotent. No table/row/RLS/migration 0001–0018 is modified.

## Generation 1 hardening, coherence & daily use (LIFEOS-025 — implemented)

The Generation 1 capstone: no new reasoning subsystem — the existing product
becomes a coherent, reliable daily-use system. Current boundaries are
preserved: Daily Home is a projection layer (not a new source of truth), System
Health is observational, integrity checks are deterministic, and no module
mutates another by being viewed. No new AI route.

- **Daily Home** (`app/today/page.tsx`). A pure projection composing what needs
  attention (active recommendations), what to review (pending proposals +
  90-day-stale beliefs), what to continue (open dialogues, unresolved tensions,
  active research, open decisions), practices, recent captures, and recently
  completed work. Every card links to the record itself — nothing duplicated,
  nothing created on view. The brand mark in the nav returns here from every
  page.
- **Navigation IA** (`components/Nav.tsx`). One destination per capability,
  grouped by kind of work: Today · Capture (Capture, Inbox) · Knowledge
  (Library, World, Constitution) · Reasoning (Compare, Inquiry, Threads,
  Reason, Research, Dialogue, Author) · Reflection (Reflect, Review) · Action
  (Decide, Orchestrator) · System (Health). No renames of existing
  destinations, no duplicates, plain keyboard-focusable links, `aria-label`ed
  primary nav, mobile-fitting.
- **Onboarding** (`app/welcome/page.tsx` + `lib/prefs.ts`). Four steps: the
  cognitive loop; a REAL first capture (the user's words — nothing synthetic is
  planted); the first-belief judgment loop with the live Inbox count; Daily
  Home + the LifeOS Inbox as the daily anchors with one suggested next step.
  Skippable at every step, restartable, persisted per user (localStorage
  `lifeos.prefs.v1`, mirrored best-effort to own-rows `user_prefs` when signed
  in).
- **Persistence hardening** (`lib/persistence.ts`). Fixes from an end-to-end
  audit: (a) silent localStorage failures now surfaced on the indicator and
  logged; (b) an unparseable local blob is PRESERVED under a backup key and
  surfaced — never silently overwritten by the next save; (c) automatic retry
  with capped exponential backoff (5 attempts) plus manual retry; (d) explicit
  `offline` state with automatic flush on reconnect; (e) an in-flight guard
  prevents interleaved/duplicate remote writes; (f) an adoption gate closes the
  hydration race where a write could push local state before the local↔remote
  reconcile decision; (g) a recent-save-errors ring buffer feeds System Health.
  `SyncStatus` reflects REAL states: saved / saving / offline / retrying /
  error / local-only.
- **System Health** (`app/health/page.tsx`). Deterministic and observational:
  persistence connectivity + configuration, schema/migration compatibility,
  hydration, recommendation-scan and graph-build status, per-domain record
  counts, integrity findings with remediation guidance, corrupt-backup
  presence, and recent save errors. No secrets. Includes the **Generation 1
  readiness scorecard**: ten dimensions (functional completeness, persistence
  reliability, test coverage, data integrity, navigation coherence,
  accessibility, performance, onboarding, observability, recovery behavior),
  each with status, evidence, known gaps, and a blocking flag — deliberately
  not one decorative score.
- **Data integrity** (`lib/integrity/checks.ts`). Ten read-only deterministic
  checks: missing referenced records, duplicate signatures, invalid status
  values, malformed confidence structures, orphaned graph records, syntheses
  without valid tensions, tensions without valid dialogues, recommendations
  pointing at missing records, revision-history ordering, and the ownership
  model (local records carry no user id by design; remote rows are owned via
  RLS defaults). The single repair (`repairStaleRecommendations`) removes only
  derived recommendations — recreatable by re-scan; knowledge is never
  auto-deleted or rewritten.
- **Error containment** (`app/error.tsx`). A recoverable route-segment error
  boundary: no raw exceptions reach the user; local-first writes mean no data
  loss; reset + Daily Home escape hatch.
- **Persistence.** Migration `0020_generation_one_hardening.sql` adds only the
  own-rows-RLS `user_prefs` key/value table (onboarding state). Health,
  diagnostics, and integrity findings are derived at view time by design. No
  table/row/RLS/migration 0001–0019 is modified.

## Living Memory & Insight Engine (LIFEOS-026 — implemented)

Makes LifeOS feel like a living memory rather than a database: it proactively
reconnects the user with meaningful ideas from their own history, always in
transparent, deterministic ways. No opaque AI, no new orchestration, no
autonomous agent, no background jobs, no new persistence — every surface is a
read-only projection over existing objects (`StoreState` + the LIFEOS-021
graph), computed at view time and self-explaining. Nothing here mutates
knowledge or stores a duplicate.

- **Memory Explanation API** (`lib/memory/explanation.ts`, Feature 7). The
  shared foundation every surface reuses. A `MemoryExplanation` always exposes
  the exact `triggers` that fired (machine `rule` + human `label`), the
  supporting records (`evidence` — references, never copies), a qualitative
  `confidence` (from `lib/dialectic/confidence.ts`, derived deterministically
  from the number of independent triggers unless supplied), a `generatedAt`
  timestamp (injectable for test determinism), and a one-line "Suggested
  because: …" summary. `isCompleteExplanation` is the integrity gate — no
  surfaced item may be unexplained.
- **Living Memory** (`lib/memory/living.ts`, Feature 1). Ten deterministic
  rules resurface records: not-revisited (stale accepted beliefs),
  related-to-recent-capture (concept-term overlap), recurring concept,
  unfinished dialogue, unresolved tension, abandoned research, forgotten
  decision, recurring theme, anniversary, and frequently-referenced. A single
  record accumulates MULTIPLE reasons via a merge-map keyed by record id (e.g.
  "last reviewed 96 days ago; connected to 3 recent captures; unresolved
  dialogue still exists"), sorted most-reasons-first. All thresholds are
  explicit constants. Surfaced at `/memory`.
- **Insight Timeline** (`lib/memory/timeline.ts`, Feature 2). A newest-first
  chronology of intellectual evolution — beliefs forming and each non-proposed
  revision, important captures, accepted syntheses, research/formation
  milestones, decision outcomes, dialogue completions — every entry carrying
  its evidence. Surfaced at `/timeline`, grouped by month.
- **Theme Evolution** (`lib/memory/themes.ts`, Feature 3). A theme is an
  existing world-model concept; `buildTheme` gathers every connected belief,
  capture, research project, dialogue, synthesis, and open tension via EXPLICIT
  id links OR name/alias text mention (each connection tagged `reference` vs
  `mention`), plus monthly frequency buckets. Surfaced at `/themes` and
  `/themes/[id]`, everything clickable back to the record.
- **Explain This Recommendation** (`lib/memory/recommendation.ts`, Feature 4).
  `explainRecommendation` maps any orchestrator `Recommendation` into the shared
  explanation (triggers = the recommendation type's "because" phrase + the
  originating subsystem; evidence = affected records; confidence + timestamp
  from the recommendation itself). `components/RecommendationCard.tsx` now
  renders this structured disclosure — every recommendation is visibly
  explained, never a bare suggestion.
- **Continue Thinking** (`lib/memory/continue.ts`, Feature 5). Every open
  thread the user can pick back up: unfinished dialogues, in-progress research,
  open/under-synthesis tensions, stale/ questioned belief reviews, candidate
  syntheses, and stale decisions — a primary re-entry point surfaced on Daily
  Home and linking straight to the record.
- **Reflection Prompts** (`lib/memory/prompts.ts`, Feature 6). Evidence-bearing
  prompts from records alone: changed_view (a belief revised ≥3×),
  never_challenged (an accepted belief with no contradiction/dialogue/
  questioning), multi_source (an idea backed by ≥3 independent sources),
  hidden_link (two beliefs that share a concept with no direct edge). Each
  carries the exact records it derived from.
- **Shared explanation UI** (`components/ExplanationDetail.tsx`). One
  disclosure component renders any `MemoryExplanation` — summary, triggers with
  their rule ids, evidence as links back to the real record, confidence, and a
  "derived from your existing records — nothing stored" note. Used by Living
  Memory, Themes, Recommendations, and Daily Home so explanation looks and
  behaves identically everywhere.
- **Daily Home integration** (`app/today/page.tsx`). Three new projection
  sections — Continue thinking, From your memory (each item self-explaining),
  and Reflection prompts — composed from the same engines.
- **Testing.** `lib/memory/selftest.ts` holds 54 fixture-driven unit
  assertions (explanation contract, per-rule surfacing, multi-reason
  accumulation, determinism, timeline ordering, theme connections,
  recommendation explanation, Continue Thinking, reflection prompts, PROJECTION
  PURITY — engines never mutate the store — and a performance budget), surfaced
  at the dev route `/dev/memory-tests` and asserted by the `memory.mjs` E2E
  suite (29 checks: surfacing, timeline, themes, recommendation explanation,
  Continue Thinking, reflection prompts, projection purity via record-count,
  nav).
- **Persistence.** NONE. No migration is added — every memory surface is a
  computed projection derived from existing objects, satisfying the "prefer
  computed projections; only migrate if persistent storage is absolutely
  required" constraint. The migration chain remains 0001–0020, unmodified.

## Command Center & friction elimination (LIFEOS-027 — implemented)

A unified command center that makes the existing system faster to use every day —
capture, find, create, continue, and navigate in far fewer clicks — for both
mouse/mobile users and keyboard-first power users. No new cognitive engine, no
LLM, no embeddings, no background jobs. Everything is deterministic, local, and
scoped to the single user; search and history never leave the device beyond the
existing best-effort `user_prefs` mirror.

- **Command library** (`lib/command/`). Reusable, framework-free modules:
  - `types.ts` — `CommandItem`, `SearchEntry/Result/Group`, `RecentItem`,
    `PinnedItem`.
  - `records.ts` — ONE catalog mapping every searchable/openable record kind to
    a label, href, and how to read its title/body/status/timestamp; used by
    search, recent, and pinning so there's a single source of truth.
  - `search.ts` + `ranking.ts` — a normalized index built once per store
    snapshot and queried per keystroke (allocation-free hot path). Ranking is
    documented and deterministic: **exact title (1000) > title prefix (800) >
    title contains (600) > alias/concept (400) > body/notes (200)**, ties broken
    by recency, then shorter title, then id (a total, reproducible order).
    Matching is case-insensitive, partial, and punctuation-tolerant (query and
    fields are normalized identically).
  - `recent.ts` — recent history (cap 20, most-recent-first, deduped) and
    pinning, both stored as record REFERENCES in `prefs` and reconciled against
    the live store on read (deleted records vanish, renamed records refresh).
    Pure helpers (`applyVisit`/`applyToggle`/`reconcile`) make the logic
    unit-testable without a store.
  - `shortcuts.ts` — a pure `resolveKey` that turns a key event + context
    (typing? chord pending? mac?) into an outcome; single-key shortcuts and "g"
    chords never fire while typing; modifier combos (⌘K, ⇧⌘K) are always safe.
  - `registry.ts` — an **extensible** registry: future modules register a static
    list or a provider without touching the palette; `build(ctx)` merges all,
    de-duplicated by id (first wins).
  - `commands.ts` — built-in navigation, Create-Anything (each opens the
    existing canonical creation flow — no shadow forms), and providers for
    Continue Work (reuses the LIFEOS-026 `buildContinueThinking` projection),
    recent, and pinned.
  - `events.ts` — a tiny window-event bridge so the nav/Today/mobile buttons open
    the palette or quick capture without prop-drilling.
- **UI** (`components/command/`). `CommandPalette` (combobox/listbox semantics,
  arrow/Enter/Escape, focus trap, `aria-activedescendant`, opens with no network
  round trip), `CommandResult` (selection shown by background AND
  `aria-selected` — never color alone; inline pin toggle), `QuickCapture` (Feature
  5 — tiny default flow reusing `addCapture`, collapsible advanced fields, draft
  preservation across accidental closes, duplicate-submit guard, success link),
  `ShortcutHelp` (platform-correct labels), `MobileCommandTrigger` (a visible
  bottom bar with large tap targets on small screens). `CommandCenter` is the
  single orchestrator mounted in the root layout: it owns the "which overlay is
  open" state (so duplicate dialogs are impossible), installs global shortcuts,
  manages the "g" chord, restores focus to the previously-focused element on
  close, and tracks recently-viewed records from the route.
- **Keyboard map.** ⌘/Ctrl+K command palette · ⌘/Ctrl+⇧+K quick capture · `/`
  focus search (when not typing) · `?` shortcut help · Escape close · `g` then
  `t/m/r/d/w/h/c` navigation chords. Everything is reachable without the
  keyboard.
- **Navigation cleanup** (`components/Nav.tsx`). Regrouped (no destination
  removed or renamed) into Today · Capture · Think · Research · Memory · Decide ·
  System, so the daily workflow reads apart from the deep knowledge modules and
  Memory/Timeline/Themes are easy to find. A search button (⌘K) is added to the
  nav for discoverability.
- **Privacy & isolation.** All results derive only from the in-memory store and
  the user's own `prefs`; nothing is sent to an external search service and no
  search terms or record contents are logged. Recent/pinned are per-user via the
  same local + `user_prefs` mechanism as onboarding.
- **Performance.** The palette opens with no network round trip; the search index
  is built once per store snapshot (memoized) and reused across keystrokes; the
  self-test's fixture-based budget builds the index over a 400×-scaled store and
  runs five queries well under budget.
- **Persistence.** NONE added. Recent history and pinning are stored in `prefs`
  (localStorage + the existing own-rows `user_prefs` key/value table from
  migration 0020). The migration chain remains **0001–0020, unmodified** — no
  `0021` was needed.
- **Testing.** `lib/command/selftest.ts` (surfaced at `/dev/command-tests`,
  asserted by `command.mjs`) covers registration + duplicate prevention, ranking
  (all five fields), grouped output, stable sorting, recent dedupe/cap/
  reconciliation (deleted + renamed), pinning, shortcut guards, user isolation,
  projection purity, and performance.

## Reading companion foundation (LIFEOS-028 — implemented)

The canonical document model for all future reading, research, and study — so a
user can READ inside LifeOS, not merely store. A document can be gradually
transformed into captures, beliefs, concepts, questions, research, and syntheses
while every derived record keeps a citation back to the exact source location.
Everything is deterministic and offline: no LLM, no embeddings, no OCR, no PDF/
EPUB parsing, no AI summarization, no background jobs (all explicitly out of
scope; this sprint establishes the architecture only).

- **Document model** (`types/mvp.ts`). `ReadingDocument` → `DocumentSection[]` →
  `Passage[]`; a passage carries `highlights`, `annotations`, and `linked`
  record refs. `Highlight` is a colored character span (+ note + linked
  records); `Annotation` is a markdown note that never edits the source text;
  `ReadingProgress` tracks status/percent/position/read-passages; `Citation` is
  the reusable source reference (record → document/section/page/passage/
  highlight). Authors are plain names (deduped by normalized name) — LifeOS has
  no separate Author entity, so no duplicate author objects are created.
- **Import pipeline** (`lib/library/importer.ts`, Feature 11). Deterministic
  parsers behind a `DocumentParser` interface: **plain text** (paragraphs →
  passages) and **Markdown** (`#`/`##` → sections, `###`+ → passage headings,
  blank-line blocks → passages) are implemented; **PDF/EPUB/HTML** are declared
  against the same interface but throw "not implemented" so future formats plug
  in without touching callers.
- **Assembly & projections** (`lib/library/documents.ts`). `assembleDocument`
  turns parsed input into a canonical document (ids, order, deterministic cover
  tint, author de-dup); `readingDashboard` derives Currently Reading / Continue
  Reading / Unread / Completed / Recent Highlights / Recent Notes / reading
  streak; `authors`/`documentsByAuthor` derive the author projection.
- **Reader navigation** (`lib/library/reader.ts`, Feature 14). Flatten passages,
  next/prev, section jump, progress position — the pure core the React reader
  wires to J/K and section controls.
- **Progress** (`lib/library/progress.ts`, Feature 8). Pure transforms:
  mark-read → recompute percent → derive status (not_started → reading →
  completed); explicit status set; estimated minutes remaining (word count at a
  fixed WPM). Statuses: Not Started · Reading · Paused · Completed · Abandoned.
- **Highlights & annotations** (`lib/library/highlights.ts`,
  `annotations.ts`, Features 4–5). Deterministic factories; a small safe inline
  markdown renderer for notes. General/section/passage notes are separate from
  the immutable passage text.
- **Citation system** (`lib/library/citations.ts`, Features 7 & 13). `makeCitation`
  builds the reference; `formatCitation` renders it; `citationHref` returns the
  reader to the cited passage/highlight; `citationsForRecord` /
  `citationsForDocument` resolve it in both directions; `reconcileCitation`
  keeps cached titles fresh after renames.
- **Knowledge conversion** (`lib/mvpStore.ts` `convertPassage`, Feature 6). From
  a passage (or a specific highlight), create a **capture / belief / concept /
  question / research / synthesis** using ONLY the existing canonical creators
  (`addCapture`, `createBeliefFromText`, `createConcept`, `createResearchProject`,
  `createDialogue`) — no duplicated forms. Each conversion writes a `Citation`
  and links the new record to the passage and highlight. (Inquiry and standalone
  synthesis pipelines require the AI dialectic flow, which is out of scope, so
  "Question" maps to a research question and "Synthesis" opens a synthesis
  dialogue — both deterministic and documented.)
- **Reading workspace** (`app/reading/page.tsx`, `app/document/[id]/page.tsx`,
  `app/reading/author/[name]/page.tsx`, Feature 3). `/reading` is Library Home
  (import + dashboard). `/document/[id]` is a three-pane reader — left
  navigation, center passage reader with inline highlight marks, right
  annotations + linked knowledge + notes — collapsing to a single column with a
  pane switcher on mobile. Highlighting captures exact selection offsets
  (`selectionOffsets` walks the passage container). Keyboard: J/K passages, H
  highlight, N note, Esc clear — guarded against typing.
- **Search integration** (`lib/command/records.ts`, Feature 9). The LIFEOS-027
  index is extended (not duplicated) to cover documents, authors, passages,
  highlights, and reading notes; results group under Documents / Authors /
  Passages / Highlights / Reading notes.
- **Command & nav** — a "New document" create command, an "Open Reading"
  navigation command, document recent-history tracking, and a new **Read** nav
  group (Reading · Library). Documents are pinnable via the existing prefs
  mechanism.
- **Testing.** `lib/library/selftest.ts` (surfaced at `/dev/reading-tests`,
  asserted by `reading.mjs`) covers import parsing, section/passage generation,
  assembly, reader navigation, progress, highlights, annotations, citation
  generation + source-reference lookup, search integration, and a performance
  budget (assemble + index a large document under 1s).

### Durable persistence (LIFEOS-028 amendment — migration 0021)

The reading library is a first-class, user-owned, RLS-protected set of NORMALIZED
tables — durable across sessions/browsers/devices — not a browser-local JSON
blob. Local-first still holds: the whole `StoreState` (documents + citations
included) persists to localStorage synchronously, and remote sync is an additive
mirror.

- **Schema** (`supabase/migrations/0021_reading_library.sql`). Six independently
  durable tables: `reading_documents` (with reading progress embedded as jsonb —
  a 1:1 lifecycle — plus an `import_complete` flag), `document_sections`,
  `document_passages`, `document_highlights`, `document_annotations`,
  `document_citations`. Every row carries `id`, `user_id` (defaulted to
  `auth.uid()`), and timestamps. Small nested metadata (authors, tags,
  source_metadata, progress, per-highlight/passage `linked` refs) is jsonb;
  every major independently-changing entity is its own row.
- **Foreign keys & deletion.** section→document, passage→document+section,
  highlight→document+passage, annotation→document+passage,
  citation→document (+optional passage/highlight `on delete set null`). Deleting
  a document CASCADES to its owned sections/passages/highlights/annotations/
  citations. A citation's link to an EXTERNAL knowledge record is
  `record_kind`+`record_id` with NO foreign key — deleting a document never
  deletes the belief/concept it produced.
- **RLS.** Enabled on all six tables; four own-row CRUD policies each (24 total).
  Child inserts/updates additionally require (via `exists`) that the parent
  document/section/passage belongs to `auth.uid()`, so a row can never be
  attached to another user's document. Verified on Postgres: a second user sees
  zero of the first user's documents and is blocked from inserting into their
  tree.
- **Adapter** (`lib/adapters/supabaseAdapter.ts` + pure `lib/library/rows.ts`).
  `loadState` fetches the six tables and rebuilds the nested hierarchy
  (`rowsToDocuments`), resilient to missing tables (degrades to an empty reading
  library rather than failing the whole load). `saveState` now receives the
  last-synced `base` snapshot and syncs with ROW-LEVEL granularity: brand-new
  documents import atomically through the `import_reading_document` RPC (one
  transaction — a partial import can't look complete); existing documents push
  only their changed rows (`diffById`) and delete only removed ones; a removed
  document deletes its row (DB cascades children). Editing one annotation
  therefore writes one row, not the library. Deletes run child→parent; upserts
  parent→child (FK-safe).
- **Offline-first sync.** Unchanged from LIFEOS-021/025: writes go to
  localStorage immediately; the debounced remote flush pushes only dirty
  domains, re-queues + auto-retries on failure (never destroying local data),
  and flushes automatically on reconnect. Offline-created reading data
  synchronizes on reconnect; repeated syncs are idempotent (upsert by id).
- **Import consistency.** The atomic RPC gives all-or-nothing import; the
  `import_complete` flag marks a document whose children are still being written
  (recoverable — the local store re-pushes). The reader and dashboard surface
  the four sync states via `SyncStatus`: **Saved** (fully synced) · **Saving…** ·
  **Saved locally / Offline — saved locally** (waiting to sync) · **Sync error**
  (with Retry).
- **Citation integrity.** Citations store STABLE ids (document/section/passage/
  highlight/record ids), never display strings; labels are re-derived from the
  live referenced records on hydration (rename-safe). A broken target (deleted
  knowledge record) renders visibly as "(removed)", never a crash.
- **Storage safety.** `checkImportSize` warns above ~400 KB (explicit confirm
  required) and hard-blocks above ~1.5 MB per document to keep the localStorage
  blob under the browser cap; user text is never silently truncated.

## Unified workspace & context engine (LIFEOS-029 — implemented)

Makes the whole app feel like one connected space instead of disconnected pages:
every object reveals its relationships, and any entity can be inspected in place
without navigating away. A pure projection layer over the existing LIFEOS-021
graph, LIFEOS-027 record catalog, and LIFEOS-028 reading/citation model — no new
reasoning system, no LLM, no embeddings, no new storage (navigation memory reuses
`user_prefs`). Everything is deterministic and cached.

- **Unified entity API** (`lib/entities/`). ONE way to describe any object —
  capture, belief, concept, theme, research, dialogue, decision, synthesis,
  tension, formation, question, author, document, passage, highlight, and every
  graph node kind:
  - `entity.ts` — `describeEntity` / `entityRef`: title, href, existence,
    summary, timestamps, tags, status, notes for ANY kind, reusing
    `resolveRecord` and extending it for graph-only + reading kinds. A shared
    `EntityContext` carries the store + a graph built once.
  - `relationships.ts` — grouped, navigable relationships (References /
    Referenced by / Supports / Contradicts / Derived from / Part of / Contains /
    Mentions / Related themes / documents / authors / decisions / Citations) from
    graph edges (both directions) + domain links (dialogue/tension/synthesis/
    reading) + citations. Memoized per graph (`WeakMap`) so repeated inspector
    opens are O(1).
  - `backlinks.ts` — deterministic "who links to me?", grouped by source kind,
    from incoming graph edges + reverse domain links + reading citations.
  - `activity.ts` / `timeline.ts` — a chronological (newest-first) history per
    entity: creation, edits, belief revisions/judgments, highlights, annotations,
    conversions, reading + decision activity, dialogue turns/conclusions.
  - `preview.ts` — `entityPreview` (hover-card data) and `entityNeighbors` (the
    one-hop neighborhood for the mini graph).
  - `inspector.ts` — a tiny reactive store (`useSyncExternalStore`) for the open
    entity + tab + expanded sections, with **navigation memory** persisted to
    `prefs` (last entity, tab, expanded sections, scroll) so the workspace
    resumes across sessions.
  - `selftest.ts` — 30 fixture-driven assertions.
- **Unified inspector** (`components/entity/Inspector.tsx`). ONE implementation
  mounted in the root layout: a right-side drawer on desktop, a bottom sheet on
  mobile. Opening any entity (`openInspector`) updates it in place. Tabs —
  **Overview / Relationships / Backlinks / Timeline / Graph** — with `role`
  tab/tablist/tabpanel semantics, arrow-key tab navigation, Escape to close,
  focus restoration to the trigger, and scroll/tab/section memory. Tab bodies:
  `ContextPanel` (Feature 1 — summary, created/updated, tags, status, notes,
  citations, relationship/backlink counts, pinned state, cross-links),
  `RelationshipExplorer`, `BacklinksPanel`, `EntityTimeline`, `GraphPreview`
  (a deterministic radial mini graph of immediate neighbors; nodes clickable +
  keyboard-focusable).
- **EntityLink + HoverCard** (`components/entity/`). The universal entity
  reference: clicking (or Enter) opens the inspector; hovering/focusing shows an
  instant `HoverCard` (title, type, summary, relationship + backlink counts,
  pinned state, last edit, Open button). One component, reused everywhere
  (reader linked-knowledge panel, inspector rows, graph nodes).
- **Cross-surface entry points.** The command palette's record results gain an
  **Inspect** (ⓘ) action that opens any record in the inspector — so every
  searchable object is inspectable from anywhere. The reader's linked-knowledge
  panel uses `EntityLink`.
- **Performance.** Relationships + backlinks are memoized per graph snapshot
  (built once per store change); querying is a map lookup. No O(n²) scans; the
  self-test builds 400 relationship views over a 300×-scaled store under budget.
- **Persistence.** NONE added. Every context surface is derived at view time;
  navigation memory lives in `prefs` (localStorage + the `user_prefs` mirror from
  migration 0020). The migration chain remains **0001–0021, unmodified** — no
  `0022` was required.
- **Testing.** `lib/entities/selftest.ts` (surfaced at `/dev/entity-tests`,
  asserted by `entity.mjs`) covers relationship generation, backlinks, timeline,
  context description, previews/hover cards, graph neighbors, navigation-memory
  shape, determinism, and a performance budget.

## Workspaces, sessions & thinking modes (LIFEOS-030 — implemented)

Turns LifeOS from "what information do I own?" into "what am I working on right
now?" by adding first-class **Workspaces** and active thinking **Sessions**.
Deterministic and offline throughout: no AI, no agents, no embeddings, no
analytics, no background workers. Everything the product shows is derived at view
time from a small amount of new durable state.

- **Workspace model (`lib/workspaces/workspace.ts`).** A `Workspace` GROUPS
  existing entities around a project or life area (Philosophy Thesis, Pool
  Business, Peace Corps). It never copies what it groups — `members` and `pinned`
  hold typed references (`{kind,id}`) resolved live against the store through the
  LIFEOS-029 entity API, so renames and deletions are handled for free. Goals are
  a simple checklist; membership derivations (`workspaceEntities`,
  `entityWorkspaces`, `workspaceReferenced`) power the dashboard and the
  inspector's "Belongs to workspace(s)" surface (Feature 10).
- **Session model (`lib/workspaces/sessions.ts`).** A `WorkspaceSession` is an
  active (or completed) thinking mode — thinking / reading / research / writing /
  planning / decision / review / reflection. **Only one session is active at a
  time** (`endedAt === undefined`); starting one ends the current one. Outputs
  (entities opened, documents read, captures created, decisions made) are DERIVED
  from the session's activity timeline via `sessionOutputs` — never a second
  source of truth. `groupSessionsByRecency` buckets a workspace's sessions into
  Today / Yesterday / This Week / Past (Feature 7).
- **Automatic activity (`lib/workspaces/activity.ts` + `tracking.ts`).** During a
  session, opening entities/documents, searching, capturing, editing beliefs and
  decisions, reading, and inspector/command usage feed a deterministic activity
  timeline (Feature 5). `tracking.ts` wrappers call the single store sink
  `recordSessionActivity`, which no-ops when no session is active and dedupes
  immediate repeats (`shouldRecord`). Tracking is wired at the source — capture
  creation in the store, `openInspector`, the command palette, and the reader —
  so it captures activity everywhere without per-page plumbing. Timeline only; no
  scoring.
- **Resume (`lib/workspaces/resume.ts`, Feature 6).** Each workspace remembers
  the last entity inspected, document read, inspector target, command search, and
  scroll — persisted ON the workspace record. Activity events map to a resume
  patch (`resumePatchFor`) so "Resume" returns the user to exactly where they
  left off; `resumeTarget` picks the freshest, still-existing destination.
- **Dashboard (`lib/workspaces/dashboard.ts`, Feature 4).** One deterministic
  projection: overview, goals, pinned, recent work / documents / decisions /
  captures, themes, reading progress, session timeline, and a one-hop
  graph-neighbor frontier.
- **Workspace search (`lib/workspaces/search.ts`, Feature 9).** REUSES the
  LIFEOS-027 index + ranking; it only restricts the shared index to a workspace's
  scope (members, a member document's passages/highlights/notes/authors, and the
  referenced frontier) before the identical ranked query — no second engine.
- **UI.** A global `SessionBanner` (current workspace, session type, a live
  elapsed clock, quick notes, End / Switch — renders nothing when idle), a nav
  `WorkspaceSelector` (current + recent + pinned + switch), `/workspaces` (index
  + create), and `/workspace/[id]` (the full dashboard with session controls,
  resume, workspace-scoped search, goals, members, notes, and timeline). The
  command center gains Switch / Resume / End-session commands and a `workspace`
  entity kind (searchable + inspectable).
- **Persistence & migration (`0022_workspaces.sql`).** Two additive,
  RLS-protected tables: `workspaces` and `workspace_sessions` (goals / members /
  pinned / resume and the activity timeline embedded as jsonb, matching how the
  rest of the schema embeds owned sub-structures). Single-active is enforced in
  the app layer, not by a partial unique index (which could transiently reject
  the whole-array bulk upsert). The Supabase adapter syncs both tables with
  row-level upsert/delete keyed on the dirty-domain set, and loads them
  resiliently (a missing 0022 table degrades to empty). The current-workspace
  pointer + recent/pinned workspace ids are UI memory in `prefs` (mirrored to
  `user_prefs`). The migration chain is now **0001–0022**.
- **Testing.** `lib/workspaces/selftest.ts` (surfaced at `/dev/workspace-tests`,
  asserted by `workspaces.mjs`) covers membership, session lifecycle & outputs,
  activity policy & resume memory, workspace-scoped search, entity↔workspace
  relationships, the session timeline, the dashboard projection, determinism, and
  a performance budget (200 workspace dashboards under budget).

## Goals, projects & execution (LIFEOS-031 — implemented)

Turns LifeOS from "what do I know?" into "what am I trying to accomplish?".
**Goals** are the highest-level object; **Projects** belong to Goals; **Milestones**
belong to Projects; **Sessions** (0030) optionally attribute their activity to a
Goal/Project. Deterministic and offline throughout: no AI, no auto-planning, no
auto-prioritization, no analytics, no calendar/notifications.

- **Models (`lib/execution/goals.ts`, `projects.ts`, `milestones.ts`).** A Goal
  never copies the work it organizes — its projects are found by
  `Project.goalId`, and `linkedWorkspaces`/`linkedKnowledge` are typed references
  resolved live via the LIFEOS-029 entity API. Projects reference (not copy)
  their related documents/entities and embed their Milestones. Milestone
  completion is **manual only** — a helper toggles `status`/`completedDate`;
  nothing infers it.
- **Progress engine (`lib/execution/progress.ts`, Feature 7).** Fully derived and
  deterministic: a project's progress = completed milestones ÷ total (or its
  explicit status when it has none); a goal's = the average of its live projects'
  progress. An optional `manualProgress` (0–100) always wins. **No function ever
  changes a status to "completed"** — completion is always a human act.
- **Session attribution (`lib/execution/tracking.ts`, Feature 6).** Sessions gain
  optional `goalId`/`projectId`. This module attributes a session's
  already-tracked activity (LIFEOS-030) to its goal/project and derives a
  contribution summary — it introduces no new tracking and never scores.
  `startProjectSession` reuses the workspace-session lifecycle in the project's
  workspace, linking goal + project.
- **Relationships (`lib/execution/relationships.ts`, Feature 8).** For any
  entity: the Goals it contributes to (via linked knowledge) and Projects it is
  related to; for a goal/project entity: its children / parent. Surfaced in the
  inspector's ContextPanel ("Goals & projects").
- **Dashboards (`lib/execution/dashboard.ts`, Features 4 & 5).** One deterministic
  projection each — a Goal dashboard (progress, projects, next milestones,
  reading/captures/decisions, a graph frontier, session timeline) and a Project
  dashboard (progress, workspace, goal, milestones, related work, reading,
  activity timeline, notes).
- **Search (Feature 11).** Goals, projects, and milestones are added to the
  LIFEOS-027 index (`buildSearchEntries` + `resolveRecord`) — one engine, one
  ranking; milestones resolve into their project's page.
- **UI.** `/goals` + `/goal/[id]` and `/projects` + `/project/[id]`; nav
  "Execute" group (Goals, Projects); the session banner shows the current goal;
  the command center gains New/Switch/Resume goal & project commands and
  goal/project/milestone entity kinds. Progress bars are deterministic.
- **Persistence & migration (`0023_execution.sql`).** Two additive,
  RLS-protected tables — `goals` and `projects` (goals/tags/refs and the
  milestone list embedded as jsonb, matching how 0022 embeds session activity).
  `projects.goal_id` FKs to goals `ON DELETE SET NULL` (deleting a goal orphans,
  never deletes, its projects); `workspace_id` is a soft reference. The adapter
  syncs both tables by dirty domain (row-level upsert/delete) and loads them
  resiliently (a missing 0023 table degrades to empty). Current goal/project
  pointers are UI memory in `prefs` (mirrored to `user_prefs`). The migration
  chain is now **0001–0023**.
- **Testing.** `lib/execution/selftest.ts` (surfaced at `/dev/execution-tests`,
  asserted by `execution.mjs`) covers models, milestones, the progress engine
  (including "never infers completion"), relationships, session attribution,
  search, dashboards, determinism, and a performance budget (200 goal dashboards
  under budget).

## Daily use, reliability & product polish (LIFEOS-032 — implemented)

A refinement sprint (no new domain, no AI) that makes the whole product
dependable and pleasant. A shared, deterministic UX layer replaces ad-hoc
patterns:

- **`lib/ux/` engine.** `dirty-state` (structural `isDirty` + a registry and
  `useUnsavedGuard` `beforeunload` hook), `confirmations` (`buildImpact` — record
  name/type, affected children, whether linked external records survive,
  reversibility, severity), `feedback` (a `useSyncExternalStore` toast store with
  windowed dedup + optional safe actions), `backup`/`restore` (versioned JSON
  envelope `schemaVersion`+`exportedAt`+all `STORE_DOMAINS`+safe prefs; validate →
  preview (merge vs overwrite) → pure `applyRestore`; malformed files rejected),
  `diagnostics` (sanitized sync snapshot — masks emails, strips JWT/bearer/api
  keys; never document contents), `performance` (budget helpers), `onboarding`
  (first-run checklist derived from state), `selftest` (40 assertions).
- **`components/ux/` primitives.** `ToastProvider` (polite live region, mounted
  globally), `ConfirmDialog` + global `requestConfirm`/`ConfirmHost` (one
  confirmation pattern app-wide — focus-trapped `alertdialog`, safest-action
  focus, acknowledgement gate for high-impact actions; replaces every
  `window.confirm`), `EmptyState`, `ErrorState`, `SaveStatus` (honest local vs
  remote — never "Saved" before a remote flush succeeds), `UnsavedChangesDialog`,
  `BackupRestore` and `SyncDiagnostics` (the reliability center on `/health`),
  and `FirstRun` (dismissible checklist on Today).
- **Wiring.** Destructive actions (delete goal/project, reset local data) route
  through `requestConfirm` with a computed impact; representative flows emit
  toasts (capture created, milestone completed, session ended, workspace
  switched, backup exported, data restored); `/health` gains the reliability
  center + backup/restore + a first-run restart; the command palette records the
  `commandOpened` first-run flag; `openInspector` records `inspected`.
- **Persistence.** `persistence.ts` now tracks `lastSyncAt` (surfaced, sanitized,
  by diagnostics). NO migration — backup/restore is client-side over the existing
  store; first-run + diagnostics read existing prefs/health. The migration chain
  stays **0001–0023**.
- **Testing.** `lib/ux/selftest.ts` (`/dev/ux-tests`, asserted by `ux.mjs`)
  covers dirty detection, confirmation impact, toast dedup, backup serialization,
  restore validation/preview/merge/overwrite/malformed-rejection, diagnostics
  sanitization, determinism, and performance budgets over a 5k-record fixture.
  See `UX_AUDIT.md` (friction/mobile/perf) and `ACCESSIBILITY.md`.

## Future vector search layer

Not implemented. When built, the expected approach is `pgvector` on
Supabase/Postgres (avoiding a second database system, consistent with the
frozen stack) with embeddings generated via the Anthropic API or a
dedicated embedding model, stored alongside (not replacing) the
full-text/relational data. Vector search is additive — a way to find
relevant `Note`/`Quote`/`Claim`/`Concept` records — not a replacement for
the `Relationship`-based graph structure.

## Future graph/relationship layer

The `Relationship` object (see `ONTOLOGY.md`) is the graph layer: typed
edges between any two ontology objects, stored relationally rather than
in a separate graph database — again, consistent with the frozen stack
(no new database system). Graph traversal queries (e.g. "everything that
supports this Claim, transitively") are expected to be recursive CTEs in
Postgres or an application-level traversal over `relationships` rows, to
be decided at implementation time based on actual query patterns once
there's real data.

## Document ingestion pipeline (future)

Not implemented. Expected shape, for planning purposes only:

1. **Capture** — user submits raw material (pasted text, a URL, an
   uploaded file, or a quote typed directly).
2. **Parse/normalize** — extract clean text, metadata (title, author,
   date where available), and structural markers (pages, paragraphs).
3. **Source creation** — a `Source` (and `Book`/`Article` subtype) record
   is created or matched against an existing one (avoid duplicate
   Sources for the same book/article).
4. **Segment capture** — `Quote`/`Note` records are created from
   user-selected or user-written material, always linked back to the
   `Source`.
5. **Optional AI-assisted extraction** — AI may propose `Claim`/`Concept`
   links as *proposals* (status: `ai-proposed` / `proposed`), never as
   accepted facts — the user confirms or rejects (`AI_AGENT_RULES.md`,
   `PRINCIPLES.md` §2).

No AI calls are implemented as part of this architecture pass — this is
a description of the intended future shape only.

## AI processing pipeline (future)

Not implemented. The Anthropic API key exists only in `.env.local` /
`.env.example` today and is referenced nowhere in code (per LIFEOS-001
T3). When built, AI involvement is expected to be scoped to exactly one
route (per the frozen constraint "AI will live in exactly one route"),
and to only ever:

- Propose (not assert) `Claim`, `Concept`, or `Relationship` records for
  user confirmation
- Draft (not finalize) summaries, tagging suggestions, or
  `ConstitutionEntry` synthesis proposals, always attributable and always
  reviewable before becoming `active`/`accepted`
- Never write directly to `Quote.text`, `Reflection.body`, or any other
  field this document or `ONTOLOGY.md` marks immutable

**`confidence` is uncalibrated — do not build against it as if it means
anything yet.** `ProvenanceMeta.confidence` exists in `types/lifeos.ts`
today as a bare `0–1` number with no defined scoring method. The Gospel
of Thomas pilot assigned confidence values "by feel" when illustrating
example records, which is exactly the failure mode to avoid in real
code: a number that *looks* meaningful without *being* meaningful is more
dangerous than no number at all, because it invites downstream logic to
trust it. Concretely, until a calibration approach is designed and
documented:

- Do not sort, filter, or gate any UI list by `confidence`.
- Do not use `confidence` to auto-triage the human review queue (see
  `COGNITIVE_ARCHITECTURE.md` §8's trust-tiering design spike — that
  spike, when it happens, is the place calibration would need to be
  solved first, not `confidence` as it exists today).
- **`confidence` must never drive an automated belief change, a
  `ConstitutionEntry` status transition, or a `Practice` change of any
  kind** — those remain human-only decisions regardless of what any
  confidence number says (`COGNITIVE_ARCHITECTURE.md` §8).

## Export/backup strategy (future)

Not implemented. Required property, per `PRINCIPLES.md` §5: the user must
always be able to get all their data out in a usable, non-proprietary
form. Planned approach:

- A full-export function producing structured JSON (one file/section per
  ontology object type) that round-trips through the domain types in
  `types/lifeos.ts` — not a database dump tied to Supabase internals.
- Supabase's own automated backups cover disaster recovery; the export
  feature is a separate, user-facing guarantee against lock-in and is not
  satisfied by Supabase backups alone.

## Error handling principles

- Fail loud locally, fail soft in the UI. `lib/supabase.ts` (built in
  T3) throws a clear error at startup if required env vars are missing —
  that pattern (explicit, human-readable errors at the boundary) should
  extend to any future `lib/` client.
- User-facing surfaces (like the T4 health check) must never crash or
  blank-screen on a backend failure — they degrade to a clear status
  message instead. This applies to all future features touching
  Supabase/Anthropic, not just the health check.
- Errors that touch data integrity (a failed `Revision` write, a failed
  ingestion step) must not silently drop data — partial failures should
  leave the system in a recoverable state (e.g. a `Source` created but
  its `Quote`s not yet linked, rather than losing the captured text).

## Security and secret-handling principles

- Secrets live only in `.env.local` (git-ignored) and the deployment
  platform's environment variable store (Vercel) — never in code, never
  committed, never logged.
- `.env.example` documents required variable names with placeholder
  values only — this is already true today and must stay true as new
  variables are added.
- The Anthropic key specifically stays unreferenced in code until the
  one AI route is actually built (frozen constraint, T3).
- Once RLS is implemented (LIFEOS-002), it is the enforcement boundary
  for data access — application-level checks are a UX convenience, not a
  substitute for RLS.
- No secret, credential, or API key is ever invented or fabricated by an
  AI agent working on this repo — see `AI_AGENT_RULES.md`.

## Sync integrity (LIFEOS-033)

Cross-device trust lives in `lib/sync/` + `components/sync/`, deliberately
isolated so it is unit-testable without a live backend. It is **deterministic**
— three-way merge and conflict detection compare `base` (last-synced snapshot),
`local`, and `remote` structurally; there is no AI, no embedding, and no
last-write-wins on user content. Delete integrity uses a privacy-safe tombstone
ledger (`sync_tombstones`, migration `0024` — the only durable server-side
metadata added; revision is derived from existing `updated_at`). Corruption
isolation runs on hydrate in `lib/mvpStore.ts`: malformed rows are dropped from
the in-memory store (source in `localStorage` preserved) so a single bad record
never crashes a consumer, and the graph query layer (`lib/graph`) is hardened to
tolerate partially-formed records. See `SYNC_INTEGRITY.md` for the full design.

## Daily review & planning loop (LIFEOS-034)

A deterministic daily review lives in `lib/reviews/` + `components/reviews/`,
with routes under `/daily`. A first-class `DailyReview` record (migration `0025`,
`daily_reviews`) captures one local calendar day's reflection — summary, wins,
lessons, friction, chosen open loops, and ordered tomorrow-focus. Every part is
the user's own input; the deterministic **day summary** (`day-summary.ts`) only
*reports* existing activity (counts + linked source records) and infers nothing.
Local-date semantics (`dates.ts`) keep the canonical `date` separate from
timestamps, are DST-correct, and — with a DB `unique(user_id, date)` constraint —
make review creation idempotent across timezone travel. The weekly rollup
(`weekly-rollup.ts`) is a projection, never persisted. It reuses the entity API,
inspector, command center, session/execution/reading engines, UX primitives, and
the LIFEOS-033 sync layer — no new state system, no AI, no scoring. See
`DAILY_REVIEW.md`.

## Inbox zero & capture processing (LIFEOS-035)

A deterministic capture-processing workflow lives in `lib/inbox/` +
`components/inbox/`, with routes under `/process`. It answers "what should happen
to this capture?" — clarify, connect, convert, defer, archive, or discard — while
**never deciding meaning for the user** (the system may *suggest* from a record's
shape and context; nothing is auto-rewritten, auto-classified, auto-converted,
auto-split, or auto-prioritized). Processing metadata is **additive on the
canonical `captures` table** (migration `0026`): a `processing_status` enum
(`inbox`/`processing`/`processed`/`deferred`/`archived`/`discarded`, existing
captures default to `inbox`), a separate `working_text` (the original `text`
stays immutable via the 0001 trigger, so clarifications never destroy the
original), `deferred_until` (local day key, reusing `lib/reviews/dates.ts`),
`jsonb` links/tags/lineage/compact-history/source-context, and status timestamps.
The queue (`queue.ts`) is a pure projection; deferred captures return to the
inbox when their date arrives (`defer.ts`, applied by the store on hydrate, no
workers/notifications). Conversion reuses the existing canonical creators and
preserves the source capture as lineage. Merge is an explicit user op, never used
by sync; field-level sync rules (`merge-rules.ts`) union links/tags/lineage/
history and raise conflicts on divergent status/content, never discarding lineage
silently. It reuses the entity API, inspector, command center, search, session,
daily-review, UX primitives, and the LIFEOS-033 sync/tombstone layer — no new
state system, no AI, no scoring, no gamification. See `CAPTURE_PROCESSING.md`.
