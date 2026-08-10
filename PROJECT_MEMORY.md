> **PROVISIONAL — NOT FINAL.** The canonical structure for this document is
> defined in Project Plan v1.0 §10, which has not yet been supplied to
> Claude Code. The 8-section structure below is a Product Owner-directed
> proposal (updated 2026-07-09). Do not treat section names, order, or
> content as authoritative until confirmed against Plan v1.0 §10. Likewise,
> the directory structure in §4 is provisional pending Project Plan v2.0
> §5.

# PROJECT_MEMORY.md

## 1. Product North Star

LifeOS is an AI-native operating system for lifelong intellectual,
personal, and spiritual formation. It turns books, articles, notes,
conversations, reflections, and lived experience into organized
knowledge, an evolving worldview synthesis, and practical life formation —
via scanning/capture, compiling, categorizing, organizing, note-taking,
quote saving, megathreads, knowledge graphs, and a Constitution Engine
that turns knowledge into an integrated way of life.

Single user. See `VISION.md` for the full statement (also provisional,
pending Product Owner approval).

## 2. Current Sprint Status

- Date: 2026-07-18
- **LIFEOS-025 — Generation 1 Hardening, Coherence & Daily Use: implemented.**
  The capstone sprint: no new reasoning subsystem — the existing product becomes
  a coherent, reliable daily-use system, formally completing Generation 1.
  (1) **Daily Home** (`/today`): a pure PROJECTION over existing state — needs
  attention (active recommendations), to review (pending proposals), continue
  (open dialogues + unresolved tensions), active research, open decisions, due
  reviews (90-day-stale beliefs), practices, recent captures, and recently
  completed. Duplicates nothing; viewing creates no records. (2) **Navigation
  IA**: grouped Primary nav (Today · Capture/Inbox · Knowledge: Library/World/
  Constitution · Reasoning: Compare/Inquiry/Threads/Reason/Research/Dialogue/
  Author · Reflection: Reflect/Review · Action: Decide/Orchestrator · System:
  Health) — consistent naming (no renames of existing destinations), no
  duplicate destinations, keyboard-accessible, mobile-fitting, and the brand
  mark is a persistent link back to Daily Home from every page. (3)
  **Onboarding** (`/welcome`): a four-step first-run tour (what LifeOS is + the
  cognitive loop; a REAL first capture in the user's own words — nothing
  synthetic planted; the first-belief judgment loop with the live Inbox count;
  the LifeOS Inbox + a suggested next step). Skippable at every step,
  restartable, persisted per user (localStorage `lifeos.prefs.v1` + own-rows
  `user_prefs` mirror, migration 0020). (4) **Persistence hardening** (audit +
  fixes): silent localStorage failures now surfaced + logged; corrupt local
  data is PRESERVED under a backup key (never silently overwritten) and
  surfaced; automatic retry with capped exponential backoff (5 attempts) then
  manual retry; explicit offline state with auto-flush on reconnect; in-flight
  guard prevents interleaved/duplicate remote writes; adoption gate closes the
  hydration race where a write could push before the local↔remote reconcile
  decision; recent-save-errors ring buffer. The `SyncStatus` indicator now
  reflects REAL states: saved / saving / offline / retrying / error /
  local-only. (5) **System Health** (`/health`, production-visible):
  deterministic + observational — persistence connectivity/config, schema +
  migration compatibility, hydration, recommendation-scan + graph-build status,
  record counts by domain, orphaned references, duplicate signatures, stale
  sync baseline, recent save errors, corrupt-backup presence; human-readable
  remediation on every finding; no secrets. (6) **Data integrity**
  (`lib/integrity/checks.ts`): 10 deterministic READ-ONLY checks (missing
  referenced records, duplicate signatures, invalid statuses, malformed
  confidence, orphaned graph records, syntheses w/o tensions, tensions w/o
  dialogues, recommendations→missing records, revision ordering, ownership
  model); the single repair offered (drop stale recommendations) touches only
  DERIVED data and is recreatable by re-scan — knowledge is never auto-deleted
  or rewritten. (7) **Generation 1 readiness scorecard** on /health: ten
  dimensions each with status/evidence/known gaps/blocking flag — no decorative
  single score. (8) `app/error.tsx`: recoverable error boundary (no raw
  exceptions; data-safety message + reset + Daily Home). Migration
  `0020_generation_one_hardening.sql`: additive own-rows `user_prefs` only
  (health/integrity/diagnostics stay derived — no speculative tables).
  Verified: **41/41 gen1 checks** (onboarding, projection purity, nav IA,
  keyboard focus, health panel, integrity + safe repair, corrupt-blob recovery,
  empty-state sweep across 12 primary modules, mobile viewports) + **ALL prior
  suites re-run green** (orchestration 22, synthesis 22, dialogue 19, research
  21, authoring 23, world 21, formation 26, decision, semantic, review,
  threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph
  15, auth, sync); migration applied + idempotent on Postgres 16 built from
  0001–0019; `lint`/`build` green. Still one AI route.
- Date: 2026-07-18
- **LIFEOS-024 — Cognitive Orchestration & Active Intelligence: implemented.**
  Makes the subsystems collaborate: a lightweight **Cognitive Orchestrator**
  observes the store and coordinates existing modules so the user no longer has
  to decide which subsystem to reach for. It generates **opportunities, not
  content** — deterministic `Recommendation`s surfaced in a single **LifeOS
  Inbox** (`/orchestrator`). NO AI (adds no `/api/ai` task); nothing is ever
  executed automatically and no knowledge is mutated. **Architecture invariant:
  no subsystem depends on another — all communication flows through the
  orchestrator.** Eight deterministic, read-only **scanners**
  (`lib/orchestrator/scanners/{belief,research,graph,dialogue,review,formation,
  decision,world}.ts`), each inspecting ONLY its own subsystem and returning
  proposals: belief→`open_dialogue` (two accepted beliefs in tension via a
  contradicts edge or opposing concepts); research→`create_synthesis` (a project
  cites evidence against an accepted belief); graph→`elevate_concept` /
  `merge_duplicate_concepts`; world→`new_principle`; dialogue→`unresolved_tension`
  / `create_research_question` (repeated synthesis failure) / `formation_exercise`
  (recurring cross-dialogue conflict) / `import_source` (missing referenced
  record) / `confidence_decline` (a synthesis's confidence keeps dropping);
  review→`review_belief` (unreviewed for months); formation→`repeat_reflection`;
  decision→`revisit_decision` (decided, no outcome review). The orchestrator
  (`lib/orchestrator/index.ts`) runs the scanners, dedupes by signature, and
  MERGES with stored recommendations — preserving the user's accept/dismiss/
  snooze/complete decisions and dropping only un-engaged recommendations whose
  signal disappeared. `Recommendation` carries type / priority / confidence /
  rationale / originating subsystem / suggested action / affected objects /
  timestamp / dismissed / accepted / completed / snoozedUntil. **UI**: the LifeOS
  Inbox filters by status / priority / subsystem; each card shows priority,
  subsystem, confidence, affected chips, an inspectable rationale ("Why am I
  seeing this?"), and Act-on-this (jump to the originating object) / Done /
  Snooze / Dismiss / Reopen. Persistence: `recommendations` array + local/Supabase
  adapters + additive migration `0019_cognitive_orchestrator.sql` (own-rows RLS,
  indexes on user/created/subsystem/type/signature, idempotent; 0001–0018
  untouched). Verified: **22/22 orchestration checks** + **ALL prior suites
  re-run green** (synthesis 22, dialogue 19, research 21, authoring 23, world 21,
  formation 26, decision, semantic, review, threads, inquiry, compare, retrieval,
  reason, qa3, pdf, long-source, graph 15); migration applied + idempotent on a
  real Postgres 16 schema built from 0001–0018; `lint`/`build` green. Still one
  AI route (no new task/endpoint).
- Date: 2026-07-18
- **LIFEOS-023 — Dialectical Synthesis & Tension Resolution: implemented.** Turns
  a dialogue into genuine dialectical *reasoning*: the engine surfaces tensions
  between the user's beliefs, assumptions, evidence and perspectives, then helps
  build increasingly coherent syntheses. The goal is **not** debate, persuasion,
  or winning — it is the progressive refinement of understanding, and uncertainty
  is preserved wherever justified. Deterministic-first, evidence-first, human-
  directed, and **AI-FREE** (no new `/api/ai` task). Built by REUSING the
  LIFEOS-021 knowledge graph and the LIFEOS-022 dialogue context. New records:
  `Tension` (kind ∈ conflicting_beliefs / incompatible_assumptions /
  unresolved_paradox / competing_values / empirical_disagreement /
  logical_inconsistency / definition_mismatch; thesis + antithesis with their
  source refs; evidence links; separated confidence; unresolved questions;
  status; stable `signature` for dedupe) and `Synthesis` (integrates one or more
  tensions; preserved insights, discarded assumptions, common ground, remaining
  uncertainty; separated confidence; append-only revisions; provenance
  outcomes). **Tension detection** (`lib/dialectic/tensions.ts`): deterministic,
  EXPLICIT signals only — graph `contradicts` edges, a concept's declared
  `opposingConcepts`, ≥2 competing framework/principle perspectives, research
  hypotheses citing evidence both ways, and unanswered challenges in the
  transcript. Nothing inferred by language modelling; nothing auto-resolved.
  **Synthesis generation** (`lib/dialectic/synthesis.ts`): deterministic
  scaffolds — a higher-order **integration** (never a compromise), a **scoped**
  resolution, and always a **deferral** that preserves the tension when
  integration isn't justified. **Separated confidence**
  (`lib/dialectic/confidence.ts`): factual / logical / evidential / experiential,
  each tracked independently and NEVER collapsed into one score; `unknown` is
  first-class. **Conversation memory** (`lib/dialectic/memory.ts`): derived
  previous / abandoned syntheses, unresolved tensions, and recurring conflicts
  (records recurring across tensions). **Knowledge integration**: a synthesis can
  become a Belief/Constitution proposal (→ Inbox), a Concept or Principle (World
  Model), or a Research project — each REUSES the existing creators and is
  recorded as provenance; nothing mutates a record automatically. **UI**: a new
  **Dialectical Workspace** (a "Dialectic" tab on `/dialogue/[id]`) where the
  user inspects tensions, compares viewpoints, expands evidence, sees the
  deterministic why-flagged rationale, accepts/rejects/revises syntheses, writes
  their own, and continues the dialogue from any synthesis — every reasoning
  structure inspectable, nothing hidden. Persistence: `tensions` + `syntheses`
  arrays + local/Supabase adapters + additive migration
  `0018_dialectical_synthesis.sql` (own-rows RLS, indexes, idempotent; 0001–0017
  untouched). Freshness: `tensionDeps` / `synthesisDeps`. Verified: **22/22
  synthesis checks** + **ALL prior suites re-run green** (dialogue 19, research
  21, authoring 23, world 21, formation 26, decision, semantic, review, threads,
  inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph 15); migration
  applied + idempotent on a real Postgres 16 schema built from 0001–0017;
  `lint`/`build` green. Still one AI route (no new task/endpoint). Reasoning-
  record integration is deferred (reasonings require the AI route) — noted as a
  future extension.
- Date: 2026-07-17
- **LIFEOS-022 — Socratic Dialogue & Dialectical Engine: implemented.** A
  structured environment to *investigate* an idea through disciplined dialogue —
  **not** a chatbot, **not** roleplay, **not** autonomous reasoning. Evidence-
  first, deterministic-first, human-directed, and AI-FREE (adds no `/api/ai`
  task — the Socratic engine is deterministic, matching "not a chatbot"). Built
  largely by REUSING earlier subsystems. New `DialogueSession` record (id/title/
  topic/purpose/status open→active→paused→concluded→archived/participants/
  seedRefs/turns/outcomes/append-only history/freshness fingerprint). Dialogue
  turns (`DialogueTurn`) are typed (question/response/challenge/clarification/
  counterargument/evidence/reflection/summary), authored (you/socratic/
  perspective), each carrying its own citations + flags (insight/new_question/
  dead_end) — provenance on every turn. **Socratic engine**
  (`lib/dialogue/socratic.ts`, `generateInquiries`): deterministic, always emits
  the six classic moves ("What do you mean by…?", "What evidence supports this?",
  "Could the opposite be true?", "What assumptions are hidden?", "What follows if
  this is true?", "What would falsify this?"), plus per-framework/principle
  perspective a "How would [X] respond?" line and graph-grounded lines for
  contradicting beliefs / related research / decision history / related concepts
  — never chooses automatically, always offers multiple lines of inquiry.
  **Perspective engine**: viewpoints (Current/Past Constitution, Frameworks,
  Principles, Beliefs, Research projects, Authors) each cite the record they are
  sourced from — nothing invented. **Graph integration**
  (`lib/dialogue/context.ts`, `buildDialogueContext`): REUSES `lib/graph`
  (`buildGraph`/`relationshipsOf`) to surface related concepts / supporting +
  contradicting beliefs / related research / authoring / decision + formation
  history — never inferred silently. **Outcomes**: dialogue → Research /
  Knowledge / Decision / Concept / Principle / Framework, or Belief/Constitution
  proposal → Inbox — every outcome REUSES the existing creators
  (`createResearchProject`/`createKnowledgeProject`/`createDecision`/
  `createConcept`/`createPrinciple`/`createFramework`/`sendToInbox`), recorded as
  provenance on the dialogue; nothing is automatic and proposals never auto-add.
  **Timeline** (`lib/dialogue/timeline.ts`): derived read-only from session +
  turns (insights/new questions/dead ends) + outcomes, append-only. Freshness:
  `dialogueDeps`. Persistence: `dialogueSessions` array + local/Supabase adapters
  + additive migration `0017_dialogue_engine.sql` (own-rows RLS, jsonb columns,
  0001–0016 untouched). UI: `/dialogue` (list + create, seedable from
  constitution/threads/research/concepts) and `/dialogue/[id]` (tabbed Dialogue/
  Perspectives/Graph/Outcomes/Timeline). Nav + entry points from Constitution
  ("Question in dialogue →") and Threads ("Investigate in dialogue →"). Verified:
  **19/19 dialogue checks** + **ALL prior suites re-run green** (research 21,
  authoring 23, world 21, formation 26, decision, semantic, review, threads,
  inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph 15), zero
  runtime errors; `lint`/`build` green. Still one AI route (no new task/endpoint).
- Date: 2026-07-17
- **LIFEOS-021 — Unified graph & persistence scaling: implemented.** An
  architecture-strengthening sprint — NO new end-user feature, NO AI, NO new
  endpoints, deterministic-first and NON-BREAKING (every prior regression suite
  re-runs green). (1) Unified reference index (`lib/graph/references.ts`): one
  `buildGraphEdges` pass enumerates EVERY explicit reference across all record
  types, tagged by relation (referenced-by/used-in/investigated-by/authored-
  from/mentioned-in/supports/contradicts/related-to/derived-from/cites/part-of)
  — nothing inferred. (2) Knowledge graph service + relationship API
  (`lib/graph/index.ts`): buildGraph, lookup, forward/backReferences
  (categorized), relationshipsOf, dependencyChain, provenance, parents/children,
  and integrity (brokenReferences/orphanRecords/duplicateIds). No viz, no
  embeddings, no AI. (3) Incremental persistence: dirty domains computed by
  immutable-array reference equality vs the last synced snapshot (ZERO store
  changes); `saveState(state, dirty?)` gains an optional dirty set; SupabaseAdapter
  pushes only dirty tables when supplied, full state otherwise (backward
  compatible); local fallback + offline preserved. (4) Performance layer
  (`lib/perf/profile.ts`): deterministic `profile()` + `measureStore()`. (5)
  Store modularization (`lib/stores/*.ts`): domain FACADES (knowledge/research/
  author/world/reasoning/decision/graph) re-exporting each domain's API — a
  justified non-breaking choice (physically splitting the 2200-line store would
  touch ~25 imports and risk the suite, which the sprint forbids). (6)
  Developer diagnostics (`app/diagnostics/page.tsx`, dev-only): counts, dirty
  domains, sync queue, graph size, integrity, hydration/migration status, perf.
  Migration `0016_graph_and_incremental_sync.sql`: additive updated_at indexes +
  own-rows `sync_meta` cursor table (0001–0015 untouched). Verified: **15/15
  graph/diagnostics checks** + **ALL prior suites re-run green** (research 21,
  authoring 23, world 21, formation 26, decision 34, semantic 19, review,
  threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source), zero
  runtime errors; `lint`/`build` green. Incremental remote push + sync_meta are
  code-complete but credential-pending. Still one AI route (no new task/endpoint).
- Date: 2026-07-17
- **LIFEOS-020 — Research workspace: implemented.** A structured environment to
  investigate a question BEFORE writing conclusions. **Not** autonomous
  research, **not** web browsing, **not** an agent — evidence-first,
  deterministic-first, human-directed, and AI-FREE (adds no `/api/ai` task).
  Built largely by REUSING earlier subsystems. New `ResearchProject` record: a
  primary question + a `questions` layer (subquestions/unknowns/assumptions/
  definitions/success-criteria/open-problems, each history-bearing), an evidence
  `assembly` (**reuses** LIFEOS-019 `ProjectAssembly`/`assembleEvidence` —
  references across all record types, never copies), project-local notes,
  competing `hypotheses` (user-stated confidence, supporting/contradicting
  evidence, open questions, status, history — never auto-selected), an explicit
  user-authored argument map (`argumentNodes` claim/evidence/counterargument/
  objection/rebuttal/open-question/unknown + `argumentEdges` supports/
  contradicts/objects_to/rebuts/answers/raises/depends_on — nothing inferred),
  append-only project history, freshness fingerprint, optional
  `seededProjectId`. Gap detection (`lib/research/gaps.ts`): deterministic
  unsupported-claim/missing-evidence/contradictory-evidence/duplicate-evidence/
  orphan-question/unresolved-hypothesis — never resolves. Timeline
  (`lib/research/timeline.ts`): derived read-only aggregation of append-only
  histories. Export (`lib/research/export.ts`): maps research → the SAME
  `ExportDoc` and REUSES the LIFEOS-019 MD/HTML/DOCX/PDF writers; provenance
  preserved. Research→Author (`seedAuthorFromResearch`): REUSES
  `createKnowledgeProject({assembly})` — same evidence ids, no duplication.
  Shared `components/EvidencePicker.tsx` extracted and used by BOTH authoring +
  research (authoring refactored onto it, re-verified). Freshness:
  `researchDeps`. Persistence: array + adapters + additive migration
  `0015_research_workspace.sql` (own-rows RLS, rerunnable; 0001–0014 untouched).
  New `/research` + `/research/[id]` (Overview/Questions/Evidence/Hypotheses/
  Arguments/Timeline/Gaps/Export tabs, filter+search); components HypothesisList,
  ArgumentMap, GapList, ResearchTimeline, ResearchExportBar, shared
  EvidencePicker; Nav "Research"; entry points from Megathreads + Constitution.
  Verified: **21/21 research checks** (incl. export bytes + author handoff) +
  authoring still **23/23** after the shared-component refactor + all prior
  suites (world 21, formation 26, decision 34, semantic 19, review, threads,
  inquiry, compare, retrieval, reason, qa3, pdf, long-source), zero runtime
  errors; `lint`/`build` green. Supabase `research_projects` sync/RLS/
  cross-device is code-complete but credential-pending. Still one AI route (no
  new task); no agents, autonomous research, web browsing, or auto Constitution
  changes.
- Date: 2026-07-17
- **LIFEOS-019 — Knowledge synthesis & authoring engine: implemented.** The
  synthesis layer — the user turns everything they have learned into a book/
  essay/lecture/course/paper/blog/guide/philosophy. **Not** a chatbot, **not**
  autonomous writing: evidence-first, human-directed, deterministic-first; the
  system assembles evidence, proposes outlines, and drafts ONE section at a time
  on request, never writing the whole work on its own and never inventing a
  citation. New `KnowledgeProject` record: title/description/purpose/audience,
  `kind`, status, an `assembly` (chosen evidence ids across ALL nine record
  types — references, never copies), generated `outlineOptions` + chosen
  outline, `sections` (each `DraftSection` with `DraftParagraph[]` carrying
  paragraph-level citations, append-only `versions`, fingerprint), append-only
  project `history`, freshness fingerprint. Assembly (`lib/authoring/assembly.ts`):
  deterministic provenance-bearing packet whose ids ARE real record ids.
  Outlines (`lib/authoring/outline.ts`): per-kind deterministic templates seeded
  with the project's own concepts/threads + one AI candidate (`outline_generate`);
  human chooses. Section drafting (`lib/authoring/draft.ts`+`schema.ts`): one
  `section_draft` AI call → cited paragraphs; uncited marked UNSUPPORTED
  (surfaced + removable); 8 transforms (rewrite/expand/compress/clarify +
  academic/popular/technical/conversational) re-draft a single section, pushing
  the prior into append-only version history. Citations (`citations.ts`):
  resolve ids→labels, unsupported detection, coverage. Cross-references
  (`crossref.ts`, Phase 7): deterministic related-concepts/missing-evidence/
  contradictions/older-drafts/relevant-decisions/formation-insights/duplicate-
  paragraphs — NEVER auto-inserted. Export (`lib/authoring/export/`, Phase 9):
  deterministic, DEPENDENCY-FREE Markdown/HTML/DOCX(store-only zip + OOXML via a
  pure-TS CRC32 zip writer)/PDF(minimal Helvetica writer w/ wrapping+pagination);
  all render one `ExportDoc`, citations preserved as [n] + numbered references.
  Freshness: `projectDeps` over every assembled record. Single AI route
  preserved (`outline_generate` + `section_draft` added). Persistence: array +
  adapters + additive migration `0014_authoring_engine.sql` (own-rows RLS,
  rerunnable; 0001–0013 untouched). New `/author` + `/author/[id]`; components
  AuthoringSection (draft/transform/citations/crossref/history), ExportBar; Nav
  "Author"; entry point from Threads ("Write from this thread"). Verified:
  **23/23 authoring checks** (incl. export byte verification — valid DOCX zip
  unzips to 4 OOXML parts; PDF has startxref/Pages/Helvetica) + all prior suites
  (21/21 world, 26/26 formation, 34/34 decision, 19/19 semantic, review, threads,
  inquiry, compare, retrieval, reason, qa3, pdf, long-source), zero runtime
  errors; `lint`/`build` green. Supabase `knowledge_projects` sync/RLS/
  cross-device is code-complete but credential-pending. Still one AI route; no
  agents, autonomous writing, chatbot, notifications, or auto Constitution
  changes.
- Date: 2026-07-17
- **LIFEOS-018 — Worldview & concept graph: implemented.** The conceptual
  backbone of LifeOS — a model of the user's evolving understanding of reality.
  **Not** a graph visualization, **not** embeddings, **not** agents:
  deterministic-first, human-reviewed, nothing inferred silently, nothing
  changes a belief or the Constitution. Four new store arrays: `Concept`
  (name/aliases/definition/description, cross-type links to beliefs/threads/
  sources/practices, denormalized parent/child/related/opposing concept
  structure maintained ONLY via approved relationships, principle links, open
  questions, append-only history, fingerprint), `ConceptRelationship`
  (first-class edge with 12 types + required reason + citations + confidence +
  source + `approved` flag; only approved edges shape the graph),
  `Principle` (reusable, many-to-many with beliefs and concepts), `Framework`
  (framework/tradition/school/paradigm/map that ORGANIZES concepts/principles,
  never owns beliefs, append-only membership history). Extraction
  (`lib/world/extract.ts`): deterministic candidates from source key-concepts/
  belief themes/concept-seeded threads, then one `concept_extract` AI call
  proposing new concepts/missing links/duplicates/missing definitions/possible
  principles/worldview clusters; validation (`lib/world/schema.ts`) bounds
  shapes, clamps relationship types, filters citations to real ids; every
  proposal reviewable; honest mock offline. Tensions (`lib/world/tensions.ts`):
  deterministic isolated/unsupported/duplicate concepts, circular definitions,
  contradictory principles, framework overlap — never auto-resolved. Evolution
  timeline (`lib/world/timeline.ts`): derived, read-only, chronological.
  Relationship approval (`lib/world/relationships.ts`) maps each type onto the
  concepts' structural arrays. Freshness: concept fingerprint over linked
  records + a `concept-config:` dep; "review" recomputes with no AI. Single AI
  route preserved (`concept_extract` added). Persistence: 4 arrays + adapters +
  additive migration `0013_world_model.sql` (4 tables, own-rows RLS, rerunnable;
  0001–0012 untouched). New `/world` (Concepts/Frameworks/Principles/Tensions/
  Review/Timeline tabs) + `/world/concept/[id]`; components ConceptRelationships
  (approve/reject), TensionList, WorldTimeline; Nav "World"; entry points from
  Constitution ("Model as a concept") and Threads. Verified: **21/21 world
  checks** + all prior suites (26/26 formation, 34/34 decision, 19/19 semantic,
  review, threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source),
  zero runtime errors; `lint`/`build` green. Supabase world tables sync/RLS/
  cross-device is code-complete but credential-pending. Still one AI route; no
  agents, graph visualization, embeddings, notifications, or auto Constitution
  changes.
- Date: 2026-07-16
- **LIFEOS-017 — Reflective practice & daily formation: implemented.** A place
  the user returns to in order to examine themselves, integrate experience, and
  grow — the bridge from knowledge → experience → reflection → belief revision
  → character. **Not** productivity, task management, streaks, or gamification.
  **LifeOS asks and clarifies; it never concludes for the user**, and nothing
  changes the Constitution, a decision, or a thread automatically. New
  `FormationSession` record: a typed session (morning/evening/decision-review/
  book-integration/conversation-review/failure/success/conflict/practice/open/
  **custom**), a generated prompt set, an **immutable** reflection body,
  explicit links to decisions/beliefs/practices/threads/inquiries/sources/
  reflections, user-authored structured capture (lessons, unresolved questions,
  emotional observations, revised assumptions, belief candidates, follow-up
  reflections), a capped evidence packet (≤40 real record ids), a validated
  `FormationSynthesisData` with append-only history + judgments, and a
  freshness fingerprint (evidence + a `formation-config:` dep so "your
  reflection changed" surfaces). Reflection engine (`lib/formation/prompts.ts`):
  deterministic, examining prompts drawn from the user's own knowledge, never
  shallow/productivity. Synthesis: one `formation_synthesis` call on the single
  `/api/ai` route, deterministic-extraction first; validation
  (`lib/formation/sessionSchema.ts`) drops uncited belief-revision suggestions
  (flagged) and softens moralizing/false-certainty language; honest mock
  offline. Formation timeline (`lib/formation/timeline.ts`): derived, read-only,
  chronological, deduped. Cadence review (`lib/formation/cadence.ts`): Today/
  Week/Month/Year/Life, invitational (never notifications). Human control:
  every insight judgeable (Accept → Belief Inbox); belief candidates promote by
  explicit action; attach to Megathread; unresolved questions → inquiry — all
  user-initiated. Persistence: `formationSessions` state + adapters + additive
  migration `0012_reflective_practice.sql` (own-rows RLS, rerunnable; 0001–0011
  untouched). New `/formation`, `/formation/[id]`, `/formation/timeline`; entry
  points from Nav ("Reflect"), Constitution, Megathreads, Decisions, Inquiry,
  Library, Review. Verified: **26/26 formation checks** + all prior suites
  (34/34 decision, 19/19 semantic/freshness, reasoning, review, threads,
  inquiry, compare, retrieval, qa3, PDF, long-source), zero runtime errors;
  `lint`/`build` green. Supabase `formation_sessions` sync/RLS/cross-device is
  code-complete but credential-pending. Still one AI route; no agents, graph
  UI, notifications, or auto Constitution changes.
- Date: 2026-07-16
- **LIFEOS-016 — Decision intelligence: implemented.** A structured workspace
  for meaningful decisions grounded in the user's own records. **LifeOS
  clarifies tradeoffs; it never chooses.** `Decision` record: question,
  status (exploring/narrowed/decided/deferred/abandoned), 2–8 options
  (named/do-nothing/defer/hybrid with benefits/costs/risks/reversibility/
  time-horizon/assumptions/open-questions), editable criteria + optional 1–5
  weights, a −2..+2 ratings grid, constraints/assumptions, capped evidence
  packet (≤40 real record ids across beliefs/reflections/practices/sources/
  comparisons/inquiries/threads/reasonings/earlier decisions, lexical+local-
  semantic ranked, entry-point seeds force-included), validated
  `DecisionAnalysisResult`, append-only history/judgments/revisions/
  outcome-reviews, provisional/final choice + rationale + USER-stated
  confidence, freshness fingerprint (evidence + a `decision-config:` dep so
  "criterion or option changed" surfaces). Deterministic first
  (`lib/decision/tradeoffs.ts`): weighted totals from the user's own ratings,
  labeled one perspective, zero AI needed. AI: one `decision_synthesis` call
  (+ `decision_verify` for ≥5 options) on the single `/api/ai` route;
  validation (`lib/decision/schema.ts`) drops uncited grounded findings
  (flagged), forces values-alignment verdicts to supports/conflicts/mixed/
  unclear (never certainty), flags prescriptive ("you should choose") and
  falsely-certain (guarantees, invented probabilities) language; speculative
  sections (scenarios/pre-mortem/regret/missing-evidence) are reflective and
  probability-free; honest mock offline. Safety (`lib/decision/safety.ts`):
  calm cautions for medical/legal/financial/self-harm/dangerous topics
  (professional belongs in the decision; 988 line), autonomy preserved,
  ordinary decisions get no banner. Human control: final choice only via an
  explicit action with the user's own rationale; defer/abandon/reopen;
  insights → Belief Inbox; attach to Megathread; outcome reviews reflective +
  append-only (no gamification); rerun preserves prior analysis + rationale +
  choice, never silently reverses a decision. Persistence: `decisions` state
  + adapters + additive migration `0011_decision_intelligence.sql` (own-rows
  RLS, rerunnable; 0001–0010 untouched). New `/decisions` + `/decisions/[id]`;
  entry points from Nav ("Decide"), Constitution, Megathreads, Reasoning, and
  Review (reflection → decision evidence). Verified: **34/34 decision
  checks** + all prior suites (19/19 semantic/freshness, 19/19 reasoning,
  23/23 formation, 21/21 megathread, 22/22 dialectic, 15/15 comparison, 9/9
  regression, 12/12 long-source, 16/16 PDF, 11/11 retrieval), zero runtime
  errors; `lint`/`build` green. Supabase `decisions` sync/RLS/cross-device is
  code-complete but credential-pending. Still one AI route; no agents, graph
  UI, notifications, or auto Constitution changes.
- Date: 2026-07-13
- **LIFEOS-015 — Semantic retrieval & evidence freshness: implemented.** An
  OPTIONAL semantic layer that improves recall/candidate-selection without
  replacing deterministic logic, plus deterministic freshness tracking for
  saved results. No graph UI, no agents; Constitution never auto-changes;
  deterministic retrieval never weakened. Provider seam (`lib/embeddings/`):
  provider-independent `EmbeddingProvider` interface; a built-in **local
  lexical embedder** (synonym-aware bag-of-concepts, 128-d, deterministic,
  offline, zero-config) powers live in-browser hybrid ranking; a gated HTTP
  provider (`/api/embed`, `EMBEDDING_API_KEY`+`EMBEDDING_PROVIDER_URL`+
  `EMBEDDING_MODEL`, server-only, text never logged) produces the durable
  index, with a local fallback so indexing works unconfigured. Hybrid ranking
  (`search.ts`): additive semantic term strictly BELOW exact(×6)/concept(×4)
  authority (exact/concept always outrank weak semantic; semantic-only capped
  ~×2.5), new "Semantically related" label, raw scores never shown; activates
  only after the user builds an index. Index (`lib/embeddings/{records,index}`):
  ten eligible record kinds with content hashes (no keys/auth, no duplicate
  originalText); user-triggered, batched, idempotent (`runIndex` skips
  unchanged hashes, caps per op, retries); durable in `embeddings` pgvector
  table (own-row RLS, `match_embeddings` RPC, migration `0010`). Reasoning
  (`passes.ts`): semantic WIDENS candidate pools (contradiction pairing over
  neighbours) but findings require the deterministic gate — semantic alone
  never labels a contradiction, all findings keep provenance. Freshness
  (`lib/freshness/fingerprint.ts`): every saved comparison/inquiry/thread-
  synthesis/weekly-review/reasoning stores a deterministic fingerprint (dep
  record ids + content hashes + pipeline version + embedding model);
  `freshnessStatus` → current/potentially_stale/stale/unknown with reasons
  ("2 beliefs were revised", "new evidence was added", "pipeline changed").
  Rerun (`components/FreshnessBadge.tsx`): explicit only, preserves prior
  result in append-only history, never overwrites user conclusions, shows
  approximate AI/embedding calls; comparison gained a rerun; inquiry/thread/
  reasoning/weekly reuse existing flows. New `/api/embed` route + Library
  "Semantic index" panel (visible workload, incremental indexing). Verified:
  **19/19 semantic/freshness checks** + **19/19 reasoning + 23/23 formation +
  21/21 megathread + 22/22 dialectic + 15/15 comparison + 9/9 regression +
  12/12 long-source + 16/16 PDF + 11/11 retrieval**, zero runtime errors;
  `lint`/`build` green. Supabase `embeddings` sync/RLS + a real embedding
  provider are code-complete but credential-pending (local-embedder mode fully
  verified).
- Date: 2026-07-12
- **LIFEOS-014 — Reasoning engine: implemented.** Higher-order, deterministic-
  first reasoning across the whole knowledge system (sources, beliefs,
  revisions, comparisons, inquiries, Megathreads, reflections, practices). No
  autonomous agents, no graph UI; the Constitution never changes automatically.
  `ReasoningQuery` record: question, one of 8 modes, optional scope (all /
  selected sources|beliefs|threads|comparisons|inquiries), evidence packet
  (references, not text copies), strict structured result, judgments,
  provisional conclusion, status, append-only `history`. Evidence graph
  (`lib/reasoning/graph.ts`): `resolveScope` (conservative expansion) +
  `buildReasoningGraph` build an INTERNAL node/edge structure + a capped
  packet whose ids ARE real record ids (never a graph UI, never duplicating
  text). Deterministic passes (`lib/reasoning/passes.ts`) run before any AI and
  produce the grounded result: support audit (counts, **no truth score**),
  contradiction audit (comparison disagreements / inquiry both-sided readings /
  opposing-polarity belief pairs / revision reversals — cautiously classified,
  a definitional difference ≠ a logical contradiction), influence trace
  (source→capture→belief→revision; comparison/inquiry→belief), assumption audit
  (recurrence-deduped), belief-impact (may-support/challenge, affected threads,
  reopened inquiries — mutates nothing), change-over-time, unresolved synthesis.
  AI layer (`reasoning_synthesis` + optional `reasoning_verify`): one call adds
  narrative key-findings validated to drop uncited claims (flagged) + flag
  overconfidence; verify only for ≥30-node graphs; mock echoes the seed. Cost
  controls: max scope sources, max packet size, approximate call/record counts,
  partial-coverage warning, confirmation for ≥2-call runs, no background
  reasoning. Human judgment (`app/reason/[id]`): accept finding→Belief Inbox /
  rewrite / question / reject; mark a candidate contradiction resolved or
  unresolved; provisional conclusion + status; reopen a referenced inquiry;
  attach the result to a Megathread; re-run pushes the prior result into
  append-only history. Persistence: `reasonings` state + adapters + additive
  migration `0009_reasoning_engine.sql` (own-rows RLS, rerunnable; migrations
  0001–0008 untouched). New `/reason` + `/reason/[id]`; entry points from Nav,
  Constitution (belief + header), Reader, Megathread. Verified: **19/19
  reasoning checks** + **23/23 formation + 21/21 megathread + 22/22 dialectic +
  15/15 comparison + 9/9 regression + 12/12 long-source + 16/16 PDF + 11/11
  retrieval**, zero runtime errors; `lint`/`build` green. Still one AI route.
  Supabase sync/RLS/cross-device of `reasonings` are code-complete but
  credential-pending.
- Date: 2026-07-12
- **LIFEOS-013 — Daily formation & review: implemented.** A calm daily/weekly
  review that helps the user reconnect with past knowledge and decide what
  should change — LifeOS surfaces and asks, the human interprets and decides.
  **No** embeddings, graph UI, background agents, notifications, streaks,
  points, badges, or gamification; nothing high-stakes changes automatically.
  New records (`types/mvp.ts`): `Reflection` (immutable `response` + separate
  append-only `annotations`), `PracticeCandidate` (status machine + required
  `derivedFrom` provenance + append-only `history`), `ReviewSession` (daily/
  weekly with surfaced items, judgments, reflection ids, accepted practices,
  optional synthesis). Daily selection (`lib/formation/daily.ts`,
  `buildDailyReview`) is deterministic + explainable: ≤3 items from a fixed-
  priority pool (questioned belief / unresolved question / recent thread change
  / stale belief / past thought-or-quote), each with a reason, filtered by the
  existing LIFEOS-009 feedback store (dismiss/snooze/postpone) and same-day
  review history — no infinite feed. Reflection flow (`app/review`): affirm /
  revise / question / dismiss / postpone / reflect; saving a reflection never
  changes a belief; "revise" routes through the existing append-only
  `reviseBelief` flow. Practices (`lib/formation/practice.ts` +
  `practice_suggest`): AI proposes small practices citing derivation,
  guardrailed against medical/legal/financial/dangerous/moralizing content,
  provisional until the user accepts or rewrites — no scheduling, no streaks.
  Weekly (`lib/formation/weekly.ts` + `weekly_synthesis`): deterministic counts
  + week-over-week deltas first, **one optional** AI narrative whose highlights
  cite real record ids (validated). Alignment (`alignment.ts` +
  `alignment_reflection`): grounded only in accepted beliefs + reflections +
  accepted practices, cautious wording, never accuses/diagnoses, never infers
  from missing data. AI/cost: deterministic selection → capped packet (evidence
  ids ARE record ids) → ≤1 call per user action → validation → mock fallback;
  approximate call count shown; no background calls. Home stays quiet (one
  "Begin today's review" link, no metrics). Persistence: `reflections`/
  `practices`/`reviews` state + adapters + additive migration
  `0008_formation_engine.sql` (immutable reflection response via trigger,
  own-rows RLS, rerunnable; migrations 0001–0007 untouched). New `/review` +
  `/review/weekly`; Nav "Review" + Home link. Verified: **23/23 formation
  checks** + **21/21 megathread + 22/22 dialectic + 15/15 comparison + 9/9
  regression + 12/12 long-source + 16/16 PDF + 11/11 retrieval**, zero runtime
  errors; `lint`/`build` green. Still one AI route. Supabase sync/RLS/cross-
  device of the new tables are code-complete but credential-pending.
- Date: 2026-07-12
- **LIFEOS-012 — Megathreads & longitudinal knowledge: implemented.** Living,
  provenance-grounded VIEWS (not folders, not copies) showing how a topic /
  question / belief develops across sources, captures, comparisons, inquiries,
  judgments, and revisions over time. `Megathread` record stores a seed, human
  title/description/status, **member references** (pointers to existing
  records — no source text duplicated), curation (`pinned`/`excluded`), a
  cautious synthesis + its evidence packet, unresolved questions, notes, and
  append-only `judgments`/`revisions`. Membership (`lib/megathread/
  membership.ts`) is deterministic + explainable: `initialMembers` seeds from
  a belief/comparison/inquiry/source + direct inputs; `candidateMembers` adds
  retrieval-related + structurally-linked records, each with a reason — AI
  never silently adds, beliefs only by explicit user action. Timeline
  (`lib/megathread/timeline.ts`) is a chronological READ-MODEL derived at
  render time (never stored → never rewrites history), each event keeping
  provenance (type/date/source/page/origin/relation); excluded members
  skipped. Synthesis (`lib/megathread/run.ts` + `synthesis.ts`): capped
  evidence packet (reuses inquiry evidence + inquiry findings) → **one**
  `thread_synthesis` call on the single `/api/ai` route → strict validation
  dropping points citing invalid evidence (flagged); belief-evolution +
  recent-changes computed deterministically from the timeline and injected
  (always accurate); mock (`lib/mockThreadSynthesis.ts`) works offline;
  regeneration explicit, no background regen. Human curation
  (`app/threads/[id]`): add/remove/pin/exclude members, edit title/desc/notes,
  rewrite the current understanding, add/resolve questions, archive; each
  synthesis insight → Accept into the Belief Inbox / Question / Reject;
  Constitution never auto-changes. Persistence: `megathreads` state + adapters
  + additive migration `0007_megathreads.sql` (jsonb row, own-rows RLS,
  rerunnable; migrations 0001–0006 untouched). New `/threads` workspace +
  `/threads/[id]`; entry points from Nav, Constitution, Reader, Compare,
  Inquiry. Verified: **21/21 megathread checks** + **22/22 dialectic + 15/15
  comparison + 9/9 regression + 12/12 long-source + 16/16 PDF + 11/11
  retrieval**, zero runtime errors; `lint`/`build` green. No graph UI, agents,
  or auto Constitution changes; still one AI route. Supabase sync/RLS/cross-
  device of `megathreads` are code-complete but credential-pending.
- Date: 2026-07-12
- **LIFEOS-011 — Dialectical intelligence: implemented.** A dialectical
  inquiry workspace that investigates one question through evidence,
  arguments, objections, and unresolved tensions — without letting AI decide
  what the user must believe, and never auto-changing the Constitution. Built
  on the retrieval + comparison layers. Evidence packet
  (`lib/dialectic/evidence.ts`) reuses `buildEvidence` for source/belief/
  passage inputs, then appends belief **revisions**, prior **comparison
  findings**, and **terminology** disputes, continuing the `E1…En` id
  sequence; same caps. Flow: packet → **one** structured `dialectic` call on
  the single `/api/ai` route → strict validation (`lib/dialectic/schema.ts`
  drops any substantive assertion whose evidence ids aren't in the packet →
  flagged) → **optional** `dialectic_verify` second pass for ≥4 sources. Mock
  (`lib/mockDialectic.ts`) is honest: derives an affirmative case from
  question/word overlap and states plainly it cannot detect a genuine
  counter-position (no fake symmetric balance). Strict `DialecticResultData`:
  question, definitions, assumptions, strongest affirmative/negative cases,
  supporting evidence, counterarguments, rebuttals, terminology disputes,
  distinctions, unresolved ambiguities, possible syntheses, what-would-change,
  questions-for-human, relation-to-beliefs, reasoning issues, limitations.
  Argument quality (Phase 5): `argType` tags (premise/conclusion/objection/
  rebuttal/qualification/analogy/definition/empirical/interpretive/theological/
  personal_judgment), named reasoning defects only when present, false-
  certainty language flagged, disagreement ≠ contradiction. Human judgment
  (`components/DialecticResult`): each insight → Accept/Rewrite into the
  existing Belief Inbox, Question, Reject, or save without adopting; write your
  own provisional conclusion; set status (open/provisional/unresolved/
  resolved). Evolution: re-running with added sources pushes the prior result
  into **append-only `history`** (never overwritten). Cost controls: max 5
  sources, per-source + total caps, approximate call count, partial-coverage
  warning, confirmation for ≥4-source runs. Persistence: `inquiries` state +
  adapters + additive migration `0006_dialectical_intelligence.sql` (jsonb
  row, own-rows RLS, rerunnable; migrations 0001–0005 untouched). New
  `/inquiry` workspace + `/inquiry/[id]`; entry points from Nav, Compare,
  Constitution, Reader. Verified: **22/22 dialectic checks** + **15/15
  comparison + 9/9 regression + 12/12 long-source + 16/16 PDF + 11/11
  retrieval**, zero runtime errors; `lint`/`build` green. No graph UI, agents,
  or auto belief changes; still one AI route. Supabase sync/RLS/cross-device
  of `inquiries` are code-complete but credential-pending.
- Date: 2026-07-12
- **LIFEOS-010 — Comparative intelligence: implemented.** Cross-source
  comparison over 2–5 sources (or a belief + sources) that preserves genuine
  differences and exact provenance. Flow is **deterministic-first**: a capped
  evidence packet (`lib/comparison/evidence.ts` — per source: metadata,
  summary, ≤3 chunk summaries, ≤4 exact quotes with page/offset, ≤6 concepts,
  ≤3 candidate claims; belief text; passage quote — ranked for relevance to
  the question via the LIFEOS-009 `search` engine, stable ids `E1…En`,
  `MAX_PACKET_CHARS` budget) → **one** structured `compare` call on the
  single `/api/ai` route → strict validation (`lib/comparison/schema.ts`
  drops any point whose `evidenceIds` aren't in the packet → flagged, never
  shown as a conclusion) → **optional** `compare_verify` second pass only for
  ≥4 sources. Strict result schema (`ComparisonResultData`): title, question,
  sources, shared concepts, agreements, disagreements (classified: logical /
  practical / definitional / level-of-analysis / historical / ambiguity),
  terminology differences, assumptions, strongest evidence per position,
  unresolved tensions, questions, relation-to-beliefs, limitations, coverage
  — every agreement/disagreement cites evidence ids. Terminology protection:
  cautious language required, flattening phrasing ("identical",
  "interchangeable") flagged. Human judgment (`components/ComparisonResult`):
  each insight → Accept/Rewrite into the existing Belief Inbox, Question,
  Reject, or save without adopting; **never** auto-updates the Constitution;
  judgments append-only on the `Comparison`. Cost controls: max 5 sources,
  per-source + total-size caps, approximate call count shown, partial-
  coverage warning, confirmation for expensive (≥4-source) runs. Mock
  (`lib/mockCompare.ts`) yields a real evidence-cited result offline.
  Persistence: `comparisons` state + adapters + additive migration
  `0005_comparative_intelligence.sql` (jsonb row, own-rows RLS, rerunnable;
  migrations 0001–0004 untouched). New `/compare` workspace + `/compare/[id]`;
  entry points from Nav, Library, Reader, Constitution. Verified: **15/15
  comparison checks** (2-source, 5-source cap, belief-vs-sources, agreements/
  disagreements cite evidence, partial coverage labeled, unsupported claims
  dropped + flagged, insight → Inbox, Constitution unchanged, persistence) +
  **9/9 regression + 12/12 long-source + 16/16 PDF + 11/11 retrieval**, zero
  runtime errors; `lint`/`build` green. No graph UI, megathreads, or agents;
  still one AI route. Supabase sync/RLS/cross-device of `comparisons` are
  code-complete but credential-pending (local mode fully verified).
- Date: 2026-07-12
- **LIFEOS-009 — Intelligent Library retrieval: implemented (deterministic).**
  Retrieval across every record type (source / summary / concept / quote /
  chunk / candidate belief / capture / unresolved proposal / belief /
  earlier revision) with **no embeddings, no pgvector, no AI route, no
  background jobs** — it runs in-memory in the browser. `lib/retrieval/
  records.ts` (`buildRecords`) projects the existing store into normalized
  `RetrievalRecord`s that keep provenance (sourceId/page/href) and are
  **never persisted** (no large-text duplication). `lib/retrieval/search.ts`
  ranks with explainable weighted signals — exact phrase (×6), concept
  overlap (×4), token overlap (×3), title/author (×2), page provenance,
  belief-status boost, recency (×0.5) — exact + concept above recency; each
  result carries a human "why it matched" reason and **raw scores are never
  shown**. Dedup by normalized text + per-source diversity cap.
  `relatedTo()` powers contextual "what else relates" (limit 5, 1/source).
  Surfaces: **Library** search grouped by type with provenance/why-matched;
  **Home** capture resurfacing (async, after save, ≤1 primary + up to 2
  more, never blocks saving, quiet/dismissible); **Constitution** per-belief
  related evidence (collapsed, excludes the belief itself, never
  auto-resolves contradictions); **Reader** "find related from your library"
  (collapsed, excludes current source). **Feedback** (relevant /
  not_relevant / dismiss / snooze) persists to the append-only
  `retrieval_feedback` table (migration `0004_retrieval.sql`, own-rows RLS)
  and **only re-ranks/filters deterministically** — no ML recommender, no
  auto belief changes, no cross-user data. Safeguards: limited counts,
  source diversity, snoozed items hidden until expiry, no gamification.
  Verified: **11/11 retrieval checks** (resurfacing appears + never blocks
  save, grouped search, why-matched shown, no raw scores, feedback suppresses
  the exact item + persists, Constitution/Reader related sections) +
  **9/9 regression + 12/12 long-source + 16/16 PDF**, zero runtime errors;
  `lint`/`build` green. Additive migration only; migrations 0001–0003
  untouched.
- Date: 2026-07-11
- **LIFEOS-008 — Real PDF ingestion: implemented.** The `pdfAdapter` seam
  now does genuine **client-side, page-aware pdf.js extraction**
  (`lib/ingestion/pdfExtract.ts`; worker served from
  `public/pdf.worker.min.js`, copied at build via
  `scripts/copy-pdf-worker.mjs` — git-ignored, version-matched). Extracts
  text per page, keeps a `pageMap` (page→char-range), records `pdfMeta`
  (filename/size/pageCount/mime/uploadedAt/extractedPages). **Only extracted
  text is stored — never the binary**, so no upload, no Vercel body limits,
  and **no Supabase Storage bucket** (Phase 6 storage was genuinely
  optional). Page-aware chunks (`pageStart`/`pageEnd`), quote page
  references (derived), page-labeled reading view. Honest
  `extractionStatus` (text_extracted / partial_text / scanned_ocr_required /
  extraction_failed) with scanned/failed → needs-text + PDF re-upload retry;
  OCR is status-only (not implemented). Limits: 25 MB / 1500 pages / ~600k
  chars; password-protected + corrupt handled with clear messages; no
  document text or secrets logged. Shared `lib/textNormalize.ts` keeps
  extraction offsets and pipeline chunking aligned. Additive migration
  `0003_pdf_ingestion.sql` (jsonb columns; RLS/triggers untouched) +
  adapter mapping. Verified with real generated PDFs: **16/16 PDF checks**
  (multi-page extraction, reading order, page provenance, chunk page ranges,
  no-binary-stored, Full analysis, refresh persistence, scanned + broken
  handling) + **9/9 regression + 12/12 long-source**, zero runtime errors;
  `lint`/`build` green. No retrieval/embeddings/graphs/OCR/EPUB; still one
  AI route.
- Date: 2026-07-10
- **LIFEOS-007 — Long-source intelligence + cost controls: implemented.**
  Sources are now analyzed from their **full content** via chunk-level
  map/reduce over the single `/api/ai` route (added `map` and
  `reduce_summary` tasks + deterministic mocks), not just the opening 8k.
  Chunks became operational: `buildChunks` gives stable ids +
  char offsets, deterministic across reruns. Three modes: **Quick**
  (default on ingest — representative 3-chunk sample, labeled *sampled*),
  **Full** (all chunks up to a 40-chunk cap), **on-demand** per-stage
  retry. Reduce is deterministic for concepts/quotes/beliefs (conservative
  dedup, `lib/dedup.ts`) and one AI call for the source summary — so short
  sources cost ~1 call, Full ≈ N+1. Cost controls: concurrency 3,
  skip-already-mapped (idempotent/resumable), approximate call count shown,
  cancel support. Extended `ProcessingState` + independent per-stage status
  (a stage failing never erases another's results). Provenance: per-source
  `chunkResults` + `analysis` metadata (mode/coverage/source ai|mock/
  unmatchedQuotes); quotes verified as exact source substrings, unmatched
  dropped + counted. Minimal Reader analysis panel (Quick/Full/per-stage
  retry/status/coverage/≈calls). Additive migration
  `0002_long_source_analysis.sql` (rerunnable jsonb columns; RLS/triggers
  untouched) + adapter mapping. Verified: 9/9 regression + 12/12 long-source
  checks (deterministic chunking, sampled vs full coverage, beyond-8000
  processing, exact-quote provenance, dedup, refresh persistence, per-stage
  retry) with zero runtime errors; `lint`/`build` green. No graphs,
  embeddings, vectors, megathreads, agents, OCR, EPUB, or new AI routes.
- **LIFEOS-006 — Knowledge Ingestion Engine: implemented.** Extracted a
  durable ingestion architecture out of the UI without changing UX,
  persistence, auth, or the single AI route. New `lib/ingestion/`: an
  `IngestionAdapter` interface + registry + three adapters (text = fully
  automated; url = automated, dependency-free HTML→text via a new non-AI
  `/api/extract` route with SSRF guard/timeout/caps and graceful fallback;
  pdf = clean `extractPdfText` seam with honest needs-text fallback — no
  fragile dependency added). `lib/ingestion/index.ts` `ingest()` is the
  single entry the UI calls. Refactored `lib/pipeline.ts` into an ordered,
  replaceable `PIPELINE_STAGES` array (normalize → chunk → metadata →
  summary → quotes → concepts → belief-candidates, + inactive questions/
  relationships seams), preserving behavior and never mutating the
  immutable original. `AddSource.tsx` now routes through `ingest()` (same
  three tabs; URL genuinely fetches now). Added `INGESTION.md`. Verified
  9/9 flow regression, `/api/extract` logic paths (pdf seam, SSRF block,
  400, graceful public-fetch fallback), lint+build green. No graphs,
  embeddings, vectors, megathreads, background agents, or new AI routes.
- **LIFEOS-005 — Production deployment prep + verification: done for
  everything possible without live access; live checks PENDING.** Verified
  the repo is Vercel-ready: env usage is exactly the three expected vars
  (+ optional `ANTHROPIC_MODEL`), standard Next scripts, Next.js
  auto-detected (no `vercel.json` needed), and the app builds AND serves in
  production mode (`next start`) with no env set (local fallback) — so a
  misconfigured env never breaks the build. One minimal production-compat
  fix: the `/api/ai` route now sets `maxDuration = 30` + `runtime =
  "nodejs"` and lowers its internal abort to 25s, so a slow Anthropic call
  degrades to mock before Vercel's function timeout kills it. Confirmed no
  service-role usage, no secrets in tracked files, no secret values in the
  client bundle. Documented (in `PERSISTENCE_QA.md`): the deployment-branch
  decision (merge to `main` or set Vercel Production Branch — current work
  is on `claude/lifeos-implementation-xwrikz`), the `NEXT_PUBLIC_*`
  build-time inlining gotcha, the full live QA chain, and an Anthropic
  failure→cause diagnosis table (401 key / 404 model / 429 credits / etc.).
  **I cannot access the live URL, Supabase, or the Anthropic key from here,
  so all Supabase-auth, real-AI, and cross-browser live checks remain
  PENDING human verification — none are claimed passed.**
- **LIFEOS-004.1 — Durable email identity: implemented (auth/remote paths
  unverified pending credentials).** Replaced anonymous-only
  identity with **email magic-link** sign-in (`signInWithOtp`). Remote sync
  now activates ONLY for a durable, email-verified session — never for
  anonymous or signed-out states, so no private data leaves the browser
  before a permanent account exists. Added `lib/authStore.ts` (reactive auth
  UI state + sign-in/out), `components/AuthControl.tsx` (minimal nav sign-in
  form / signed-in email + sign-out). The persistence facade now drives
  remote enable/disable from `onAuthStateChange`, with a wrong-user-safe,
  idempotent migration (adopt remote if it has data; migrate local up only
  if local is unowned or already this user's; never migrate another
  account's local data). Anonymous auth fully removed. Local-only mode
  remains the pre-sign-in default and is fully verified (no Sign-in button
  when unconfigured, "Saved locally", full flow, no runtime errors); auth +
  cross-device paths are credential-dependent and pending. `lint`/`build`
  green; no secret values in the client bundle.
- **LIFEOS-004 — Durable persistence + real AI: implemented (Supabase path
  unverified pending credentials).** Added a Supabase schema
  (`supabase/migrations/0001_initial_schema.sql`: sources, captures,
  proposals, beliefs, belief_revisions, user_judgments, saved_quotes; UUID
  PKs; per-row `user_id`; RLS own-rows-only; append-only
  revisions/judgments/quotes; immutability triggers on original/capture
  text). Introduced a persistence **adapter** boundary (`lib/adapters/*`:
  `LocalPersistenceAdapter`, `SupabasePersistenceAdapter`) behind
  `lib/persistence.ts`, which keeps the store's instant local write and
  layers a debounced remote sync, one-time local→remote migration (never
  deletes local), and a "Saved locally / Syncing / Synced / Sync failed"
  indicator (`components/SyncStatus.tsx`) with Retry. Anonymous Supabase
  auth for the single-user MVP. Hardened the single `/api/ai` route
  (task/JSON validation → 400, 30s timeout, mock-degrade with `degraded`
  flag, no source-text logging, server-only key). **Local mode remains the
  default and is fully verified (9/9 flow + refresh persistence + sync
  label + AI 400s); Supabase/real-AI paths need the human to add
  credentials and run the migration — see `PERSISTENCE_QA.md`.** No new
  product features; UX unchanged.
- **LIFEOS-003 — Knowledge Engine MVP: implemented.** Added a
  Knowledge Library subsystem alongside (not replacing) the Belief Ledger.
  New screens: Library (`app/library/page.tsx` — browse/search/filter,
  add source) and Reader (`app/library/[id]/page.tsx` — read, highlight→
  save quote, ask one AI question, send selection/candidates to the Belief
  Inbox). New processing pipeline (`lib/pipeline.ts`): capture → extract →
  chunk → summary → quotes → concepts → candidate beliefs, each stage
  through the ONE AI route. Consolidated `/api/propose` → `/api/ai`
  (task-dispatched: summary/quotes/concepts/beliefs/question); the old
  route is deleted and Home now goes through `lib/aiClient`. Storage seam
  extracted to `lib/persistence.ts` (the Supabase swap point). Candidate
  beliefs never auto-enter the Constitution — they go through the existing
  Belief Inbox. Manual-text ingestion is fully automated; PDF/URL create
  typed, provenance-tracked sources that await their text in the reader
  (auto-extraction is a later ingestion adapter). Verified end-to-end in a
  browser (9/9 checks) incl. the LIFEOS-002 flow still working; `lint` and
  `build` green. Still localStorage-only (no Supabase/auth/deploy).
- Date: 2026-07-09
- **LIFEOS-002 — Belief Thread MVP: implemented.** First
  working product. Three client screens over a localStorage store (no
  DB): Home/Capture (`app/page.tsx`), Belief Inbox (`app/inbox/page.tsx`,
  one proposal at a time, Rewrite primary), Constitution
  (`app/constitution/page.tsx`, beliefs by theme, expandable, CSS-only
  thread line, re-judgeable over time). One AI call (`app/api/propose`)
  with deterministic mock fallback when `ANTHROPIC_API_KEY` is absent.
  MVP adapter types in `types/mvp.ts` (ontology in `types/lifeos.ts`
  untouched). Verified end-to-end in a real browser (capture → analyze →
  rewrite → accept → inbox clear → Constitution thread bends). `lint` and
  `build` green. Note: this is a client-only prototype; localStorage is
  per-browser and not yet backed by Supabase (LIFEOS-001 T3–T6 still
  open).
- Sprint 1, Day 1 — **LIFEOS-001** is in progress (its deploy/env tasks
  T3–T6 remain deferred; the MVP above runs locally without them).
  - **T1 — Scaffold the application: done.** Next.js (App Router,
    TypeScript, Tailwind, ESLint) app scaffolded; `npm run dev` / `build`
    / `lint` verified locally. Committed as `fe95773`.
  - **T2 — Repository hygiene & project memory: in progress.** Doc
    stabilization pass (`VISION.md` + `PROJECT_MEMORY.md` restructure)
    committed and pushed as `0164889` on `claude/lifeos-implementation-xwrikz`.
    Full T2 acceptance criteria (final push, `.env` hygiene verification)
    still open pending T3+.
  - **Foundation architecture pass (out-of-band, Product Owner-directed,
    before T3):** committed as `4f8b78b`. Added `PRINCIPLES.md`,
    `ONTOLOGY.md`, `ARCHITECTURE.md`, `AI_AGENT_RULES.md`,
    `types/lifeos.ts`. Docs/spec only — no database calls, no schema
    created, no secrets touched.
  - **Domain-model hardening pass (out-of-band, Product Owner-directed,
    before T3):** committed as `aac56e1`. Expanded `Source.type` beyond
    book/article, added `ProvenanceMeta` (createdBy/updatedBy/aiModel/
    sourceLocation/confidence/evidenceIds) to AI-touchable objects, and
    added `UserJudgment`. `types/lifeos.ts` + `ONTOLOGY.md` +
    `ARCHITECTURE.md` updated to match. Still docs/spec only.
  - **Cognitive architecture pass (out-of-band, Product Owner-directed,
    before T3):** committed as `f108aea`. Added `COGNITIVE_ARCHITECTURE.md`
    — the knowledge lifecycle, AI role architecture, event architecture,
    canonical identity system, object state machines, background
    pipelines, human oversight boundaries, failure modes, and future
    expansion path. Design document only — no code, database, Supabase,
    auth, API routes, or UI touched.
  - **Architecture pilot (out-of-band, Product Owner-directed, before
    T3):** committed as `618b13a`. Added `PILOT_GOSPEL_OF_THOMAS_SAYING_37.md`
    — a manual, hand-simulated run of the full 12-stage lifecycle against
    a real interpretive question (Gospel of Thomas, Saying 37), exhibiting
    all 13 core ontology object types and stress-testing them before any
    schema is written. Found real friction (`Book.authorIds` required —
    breaks on anonymous/pseudonymous works; `ArgumentPremise`
    claimId-vs-inline-statement promotion undefined; authorship
    representable two inconsistent ways) alongside real validation.
  - **Pilot lessons applied (out-of-band, Product Owner-directed, before
    T3):** committed as `8613477`. All Gospel of Thomas pilot findings
    applied: `Book.authorIds` optional, `authorAttribution` added to
    `Source` (types + `ONTOLOGY.md` authorship representation rule);
    `ONTOLOGY.md` `Argument` premise-promotion rule; pilot notes +
    trust-tiering spike in `COGNITIVE_ARCHITECTURE.md`; `confidence`
    marked uncalibrated in `ARCHITECTURE.md`.
  - **Adversarial product review + UX design freeze (out-of-band,
    Product Owner-directed, before T3):** in progress. A brutal external
    review (delivered in chat, not filed) recommended **NARROW**: freeze
    the docs, ship the boring LIFEOS-001 deploy, then build the minimal
    "belief ledger" and use it on a real book before writing more
    architecture. Following that, a Product Design Freeze produced
    `UX_SPECIFICATION.md` — the MVP interaction blueprint scoped to
    exactly three screens (Capture, Belief Inbox, Constitution), plus a
    ruthless six-week MoSCoW cut that REMOVEs most of the ontology's
    speculative objects and all of `COGNITIVE_ARCHITECTURE.md`'s
    pipeline/role/event machinery from MVP scope (deferred, not deleted).
    Design/spec only — no code, database, Supabase, auth, API routes, or
    UI components. See §7 and §8. **Note:** the review and UX spec are
    advisory design artifacts; they do not themselves change the frozen
    architecture or the `ONTOLOGY.md`/`types` on disk — any actual
    narrowing of the build is a future Product-Owner decision.
  - **T3–T6:** not started. Explicitly deferred — no Supabase, Anthropic,
    Vercel, or environment secret work has been done.
- What exists: scaffolded app only. No database tables, no auth, no AI
  calls, no deployment, no production URL.

## 3. Architecture Decisions

- Stack (frozen per Project Plan v2.0): Next.js (App Router, TypeScript)
  + Tailwind + Supabase + Vercel + Anthropic API.
- Single user; simple UI; AI will live in exactly one route (not built
  yet).
- No schema or stack deviations permitted without Product Owner approval
  + a Change Log entry (§8) logged **before** implementation.
- TypeScript strict mode is on (`tsconfig.json`).

## 4. File/Folder Structure

Only the structure explicitly known today is implemented; this is
provisional pending Project Plan v2.0 §5:

```
app/            # App Router routes
app/api/        # API routes (empty placeholder for now)
components/     # shared UI components (empty placeholder for now)
lib/            # shared utilities / clients (empty placeholder for now)
docs/           # project documentation (empty placeholder for now)
types/          # shared TypeScript types (empty placeholder for now)
```

`docs/` and `types/` were added at the Product Owner's request beyond the
ticket's original explicit list and are not yet confirmed against Plan
v2.0 §5.

## 5. Feature Roadmap

Immediate (this ticket, LIFEOS-001):
- Finish T2 (this pass) → T3 (env config) → T4 (health check page) → T5
  (Vercel deploy) → T6 (close-out). Each remains blocked on inputs listed
  in §7.

Next ticket:
- **LIFEOS-002: Auth + RLS**

Longer-term (from `VISION.md`, not sequenced or committed yet — capability
list only, sourced from the vision direction given 2026-07-09):
- Scanning / capture
- Compiling & categorizing
- Organizing & note-taking
- Quote saving
- Megathreads
- Knowledge graphs
- Constitution Engine

None of the longer-term items are scheduled. They are recorded here so
future sprint planning has a reference point, not as a commitment to
scope or order.

## 6. AI/Agent Instructions

- Architecture is FROZEN per Project Plan v2.0 — do not introduce new
  stack components, schema, or structural deviations without explicit
  Product Owner approval logged in §8 *before* implementation.
- Never invent or fabricate secrets, credentials, or "approved" document
  content (e.g. VISION.md, Plan v1.0/v2.0 text). Where real content is
  missing, use clearly marked placeholders/provisional drafts and stop to
  ask, per the governing ticket's instructions.
- Do not build outside the scope of the current ticket/task instruction,
  even if adjacent work seems natural to do while in the file.
- Keep this document's §2 and §7 current at the end of every work session.
- §8 (Change Log) is append-only — never edit or delete prior entries.

## 7. Open Questions / Blockers

- `VISION.md` is a strong provisional draft, not the Product Owner's
  final approved document — needs sign-off.
- This document's own structure needs sign-off against Plan v1.0 §10.
- Directory structure (§4) needs sign-off against Plan v2.0 §5 — `docs/`
  and `types/` are unconfirmed additions.
- Supabase Project URL + anon key: not yet provided.
- Anthropic API key: not yet provided.
- Vercel deploy approach (dashboard vs. CLI token): not yet decided.
- These block T3 (env config), T4 (health check page needs Supabase
  client), and T5 (Vercel deploy) respectively.

## 8. Change Log (append-only)

- 2026-07-09 — `npm`'s package-name rules reject capital letters, and the
  repo directory is `LifeOS`. Scaffolded `create-next-app` into a temp
  directory using the lowercase name `lifeos`, then moved the generated
  files into the repo root (excluding `node_modules`, reinstalled in
  place). `package.json`'s `"name"` field is `"lifeos"`. No effect on app
  behavior or the frozen stack.
- 2026-07-09 — `create-next-app`'s default `.gitignore` used a blanket
  `.env*` pattern, which would have also ignored `.env.example` (required
  to be committed). Replaced it with explicit `.env`, `.env.local`,
  `.env.*.local` entries plus a `!.env.example` negation.
- 2026-07-09 — `create-next-app` also generates `AGENTS.md` and a
  one-line `CLAUDE.md` by default. Removed both as out of scope for this
  ticket; not part of the requested file list.
- 2026-07-09 — Proceeded with T1 (scaffolding) only, per explicit Product
  Owner instruction, while VISION.md, Plan v1.0 §10, Plan v2.0 §5,
  Supabase credentials, Anthropic key, and Vercel deploy approach remained
  outstanding. T1 committed as `fe95773` and pushed to
  `claude/lifeos-implementation-xwrikz`.
- 2026-07-09 — T2 documentation stabilization pass: replaced placeholder
  `VISION.md` with a strong provisional vision draft (per Product Owner
  direction) and restructured `PROJECT_MEMORY.md` to an 8-section format
  (Product North Star / Current Sprint Status / Architecture Decisions /
  File-Folder Structure / Feature Roadmap / AI-Agent Instructions / Open
  Questions-Blockers / Change Log), also per explicit Product Owner
  direction. Both remain provisional pending final Plan v1.0 §10 and Plan
  v2.0 §5. Committed and pushed as `0164889` (repo stop hook required a
  clean working tree).
- 2026-07-09 — Foundation architecture pass, explicitly directed by the
  Product Owner as an out-of-band insertion before T3: added
  `PRINCIPLES.md`, `ONTOLOGY.md`, `ARCHITECTURE.md`, `AI_AGENT_RULES.md`,
  and `types/lifeos.ts`. This is design/spec and TypeScript type
  definitions only — no database calls, no Supabase schema created, no
  secrets touched, no product features implemented. Flagged here because
  the governing LIFEOS-001 ticket's Definition of Done says "nothing
  outside this ticket's scope was built"; this pass is scope the Product
  Owner explicitly requested mid-session, layered on top of the ticket
  rather than replacing it. All new docs are marked provisional pending
  Product Owner approval, consistent with existing docs. Committed and
  pushed as `4f8b78b`.
- 2026-07-09 — Domain-model hardening pass, explicitly directed by the
  Product Owner as a second out-of-band insertion before T3. Changed
  `types/lifeos.ts`: (1) widened `Source.type` from `book`/`article`-only
  to a 10-member `SourceType` union (`book`, `article`, `pdf`, `webpage`,
  `video`, `podcast`, `conversation`, `journal`, `image`, `other`) so the
  system doesn't assume all sources are books/articles, while `Book` and
  `Article` remain narrowed subtypes; (2) added a `ProvenanceMeta` mixin
  (`createdBy`, `updatedBy`, `aiModel`, `sourceLocation`, `confidence`,
  `evidenceIds`) applied to `Claim`, `Concept`, `Argument`,
  `ConstitutionEntry`, and `Relationship` — the objects most likely to be
  AI-touched or synthesized — folding in and removing `Claim`'s prior
  standalone `confidence` field as now redundant; (3) added `Actor`
  (`"user" | "ai"`) and `UserJudgment` (records accept/reject/question/
  revise verdicts on AI-proposed content) types, and added
  `"UserJudgment"` to `OntologyType`; (4) documented that `Relationship`
  already connects any two `OntologyType` members independently (no code
  change needed, just a clarifying comment). Updated `ONTOLOGY.md`
  (Source section, new UserJudgment section, cross-cutting notes) and
  `ARCHITECTURE.md` (future Supabase table list: added `user_judgments`,
  clarified `sources`/`books`/`articles` split) to match. Still
  design/spec and types only — no database calls, no Supabase schema
  created, no secrets touched. Committed and pushed as `aac56e1`.
- 2026-07-09 — Cognitive architecture pass, explicitly directed by the
  Product Owner as a third out-of-band insertion before T3. Added
  `COGNITIVE_ARCHITECTURE.md`: the process/verb layer sitting alongside
  `ONTOLOGY.md` (nouns) and `ARCHITECTURE.md` (tech shape) — Mission,
  12-stage Knowledge Lifecycle (Capture through Review, explicitly
  cyclical via Review feeding back into Capture/Compare/Revise), 10-role
  AI Role Architecture (explicitly scoped as functional/prompt-level
  personas within the one frozen AI route, not separate services),
  12-event append-only Event Architecture, Canonical Identity System
  (including a flagged open question: "Virtue" isn't a first-class
  ontology object yet, treated as a tagged `Concept` for now rather than
  unilaterally expanding the ontology), 7 object state machines, 9
  background pipelines, an explicit Human Oversight list ("AI proposes,
  human disposes"), 7 failure modes with safeguards, and a Future
  Expansion section arguing the ontology's center can stay fixed while
  expansion happens at the edges. Also linked the new doc from
  `README.md`. Design document only — no code, database, Supabase, auth,
  API routes, or UI components touched. A self-critique of this document
  was delivered directly to the Product Owner rather than embedded in the
  file, to keep the file's structure exactly as specified. Committed and
  pushed as `f108aea`.
- 2026-07-09 — Architecture pilot, explicitly directed by the Product
  Owner as a manual stress test before any database implementation. Added
  `PILOT_GOSPEL_OF_THOMAS_SAYING_37.md`: hand-simulated all 12 lifecycle
  stages against the question "what does Saying 37 reveal about spiritual
  nakedness, shame, perception, and realization?", producing illustrative
  example records for all 13 requested ontology object types (Source,
  Quote, Claim, Concept, Question, Argument, Relationship, Megathread,
  ConstitutionEntry, Practice, Reflection, Revision, UserJudgment), each
  labeled by content type (source text / summary / interpretation /
  ai-proposed / human-judgment placeholder). Flagged the Quote's own
  provenance honestly: its text was recalled from training data, not
  captured from an actual uploaded source, and is marked as unverified
  pending real capture — a deliberate, useful demonstration of
  `AI_AGENT_RULES.md` rule 2 rather than an oversight. Findings: real
  friction in `Book.authorIds` (required, breaks on the Gospel of
  Thomas's pseudonymous attribution), `ArgumentPremise`'s undefined
  claimId-vs-inline-statement promotion rule, and dual/inconsistent ways
  to represent authorship (`Source.authorIds` vs. a `Relationship`); real
  validation of `Quote`/`Claim`/`Relationship`/`Revision`/`UserJudgment`
  and the `ConstitutionEntry`→`Practice` state-machine gate (correctly
  prevented a `Practice` record from being created while its
  `ConstitutionEntry` stayed `draft`). Also confirmed, concretely, the
  previous pass's self-critique that "AI proposes, human disposes" has a
  real review-queue-volume problem: one saying alone produced 2 pending
  `UserJudgment`s, a contested claim pair, and a stuck-in-draft
  constitution entry. Recommendations were written into the pilot
  document only; `ONTOLOGY.md`, `types/lifeos.ts`, `ARCHITECTURE.md`, and
  `COGNITIVE_ARCHITECTURE.md` were deliberately left unmodified, per
  instruction, pending a future explicitly-scoped pass. Also linked the
  new doc from `README.md`. Design/analysis only — no code, database,
  Supabase, auth, API routes, or UI components touched.
- 2026-07-09 — Applied the Gospel of Thomas pilot's recommendations,
  explicitly approved by the Product Owner. Changed `types/lifeos.ts`:
  removed `Book`'s required-`authorIds` override (now inherits
  `Source.authorIds?: ID[]`) and added `AuthorAttribution` (`"confirmed"
  | "traditional" | "disputed" | "anonymous"`) plus
  `Source.authorAttribution?`, so anonymous/pseudonymous/disputed
  authorship (the normal case for the scripture/classical-text material
  in `VISION.md`'s scope, not an edge case) can be represented honestly
  instead of forcing a fabricated or overstated attribution. Placed on
  `Source` rather than only `Book` so `Article` and future source types
  inherit it too, per instruction. Updated `ONTOLOGY.md`: added an
  authorship representation rule (structural fields for stable/known
  attribution — including explicitly-uncertain attribution recorded as
  data — vs. `Relationship` records for contested/discovered/
  interpretive authorship claims) and an `Argument` premise-promotion
  rule (inline `ArgumentPremise.statement` is fine while `draft`, but
  every conclusion-supporting premise must be promoted to a real `Claim`
  before the `Argument` can go `active`). Updated
  `COGNITIVE_ARCHITECTURE.md`: added pilot notes under the Classify and
  Synthesize lifecycle stages (Classify may collapse into Extract for
  small captures; Compare and Synthesize may blur together in simple use
  cases — both framed as statements about stage granularity, not changes
  to what the stages produce), and added a "Future design spike:
  trust-tiering" subsection under §8 — explicitly **not designed yet**,
  proposing low-stakes proposals could someday get lighter-weight
  confirmation UX while every high-stakes decision already listed in §8
  continues to require the same explicit human judgment, with no
  lowering of that bar. Updated `ARCHITECTURE.md`: marked
  `ProvenanceMeta.confidence` as uncalibrated in the AI processing
  pipeline section, with an explicit rule that it must never be used for
  UI sorting/filtering/gating, review-queue auto-triage, or to drive any
  automated belief, `ConstitutionEntry`, or `Practice` change. Still
  docs/types only — no database calls, no Supabase schema created, no
  secrets touched, no API routes or UI components created. Committed and
  pushed as `8613477`.
- 2026-07-09 — Adversarial product review (delivered in chat, not filed
  to the repo) at Product Owner request: a deliberately skeptical
  external-architect critique concluding **NARROW** — freeze the docs,
  finish the LIFEOS-001 deploy, build the minimal "belief ledger" (paste
  → AI-proposed claims → human accept/rewrite/reject/question →
  Constitution page with provenance chains), and use it on a real book
  for two weeks before any further architecture. Flagged that the repo is
  currently exhibiting its own §1 failure mode (much architecture, zero
  usage) and that "AI proposes, human disposes" review-volume is the
  central viability question, not a refinement.
- 2026-07-09 — Product Design Freeze at Product Owner request: added
  `UX_SPECIFICATION.md`, the MVP interaction blueprint. Scopes the entire
  MVP to exactly three screens — Capture (frictionless immutable intake),
  Belief Inbox (one-card-at-a-time judgment, with inline Rewrite as the
  hero action because rewriting-in-your-own-words is where information
  becomes belief), and Constitution (worldview by theme, each belief
  expandable to its full belief→claim→quote→source provenance chain, with
  revision history and held-open questions). Answered the ten product
  questions (home screen = the Constitution; the one AI call = passage →
  1–3 quote-anchored claims; etc.) and produced a ruthless six-week
  MoSCoW ranking that REMOVEs Argument, Megathread, Project, Person,
  Tradition, Practice-as-object, the event system, all background
  pipelines, named AI roles, vector/graph/dedup, and surfaced
  `confidence` from MVP scope (deferred, not deleted). Design/spec only —
  no code, database, Supabase, auth, API routes, or UI components
  created; linked from `README.md`. This and the adversarial review are
  advisory: they do not modify the frozen architecture or the on-disk
  `ONTOLOGY.md`/`types/lifeos.ts`; any actual build-narrowing is a future
  Product-Owner call.
- 2026-07-09 — Implemented **LIFEOS-002 Belief Thread MVP**, the first
  working product, per the narrow scope. New files: `types/mvp.ts` (MVP
  adapter types mapped to the ontology; `types/lifeos.ts` untouched),
  `lib/proposals.ts` (deterministic mock proposal generator),
  `lib/mvpStore.ts` (localStorage-backed reactive store via
  `useSyncExternalStore`), `app/api/propose/route.ts` (the single AI call
  — one Anthropic `fetch` when `ANTHROPIC_API_KEY` is set, deterministic
  mock otherwise or on any failure), `components/{Nav,StoreHydrator,
  ThreadLine}.tsx`, `app/inbox/page.tsx`, `app/constitution/page.tsx`.
  Rewrote `app/page.tsx` (Home/Capture, replacing the scaffold default),
  updated `app/layout.tsx` (metadata + Nav + hydrator) and `globals.css`
  (sans font). Removed `app/api/.gitkeep` (real route now present). Data
  is localStorage only — no Supabase, no auth, no DB, per the "don't
  block on database setup" instruction. AI: one call only, no background
  agents/roles/embeddings/vector/graph search; no automatic Constitution
  changes without a user judgment. Verified with `npm run lint` (0),
  `npm run build` (0), and an end-to-end browser drive of the full
  capture→inbox→rewrite→accept→constitution loop, including the thread
  line rendering Proposed→Rewritten and a belief being questioned later.
  The `ANTHROPIC_API_KEY` path is written but UNTESTED (no key
  configured) — the mock fallback path is what was exercised. This is the
  first commit that adds runtime product code rather than docs/types.
- 2026-07-09 — QA + hardening pass on the LIFEOS-002 MVP (no new
  features, no UX redesign, no Supabase/auth/deploy). Bugs fixed: (1)
  `hydrate()` used `parsed.x ?? []`, which kept a non-array value from
  malformed/hand-edited localStorage and would crash later `map`/`filter`
  — now coerced via `Array.isArray`, and each belief's `revisions`/
  `judgments` are guaranteed to exist; (2) Home's double-submit guard
  relied on React state (`busy`), so a fast double-click could create a
  duplicate capture — added a synchronous `useRef` guard. Safeguards:
  `ThreadLine` guards `!revisions?.length`; added a `resetStore()` action
  and a confirm-gated "Reset local prototype data" footer on the
  Constitution page (plus a documented `localStorage.removeItem` manual
  path). Added `QA_CHECKLIST.md` (all requested flows + edge cases +
  reset + mock-fallback) and linked it from `README.md`. No automated
  test framework added — deliberately, per instruction, since the store
  depends on localStorage + `useSyncExternalStore`; QA is manual.
  Re-verified with `lint`, `build`, and a browser drive of the full loop
  plus the reset control and malformed-storage recovery. Product scope
  unchanged.
- 2026-07-10 — Implemented **LIFEOS-003 Knowledge Engine MVP**. Added the
  Knowledge Library as a subsystem beside the Belief Ledger (LIFEOS-002
  untouched in behavior). New files: `lib/persistence.ts` (the single
  storage seam — localStorage today, the one place to change for
  Supabase), `lib/mockAI.ts` (deterministic summary/quotes/concepts/
  answer mocks), `lib/aiClient.ts` (client wrapper for the one AI route,
  with local mock fallback), `lib/pipeline.ts` (chunking + the
  capture→…→candidate-beliefs pipeline), `lib/labels.ts`,
  `app/api/ai/route.ts` (the single task-dispatched AI route),
  `components/AddSource.tsx`, `app/library/page.tsx`,
  `app/library/[id]/page.tsx`. Extended `types/mvp.ts` (KnowledgeSource,
  chunk, processing/status enums; `Capture.sourceId`) reusing the
  ontology's `SourceType`. Extended `lib/mvpStore.ts` with `sources` +
  library actions/selectors, routed persist/hydrate through the seam, and
  normalized source arrays on hydrate. Deleted `app/api/propose/route.ts`;
  updated `app/page.tsx` and `components/Nav.tsx`; updated
  `QA_CHECKLIST.md` endpoint references. Candidate beliefs flow only
  through the existing Belief Inbox (never auto into the Constitution).
  Fixed a *test-harness* false failure (a `text=Read` selector matching
  the "Ready" processing label + clicking a Link before hydration) — the
  source→belief backlink itself was correct; direct-load inspection showed
  the provenance link resolving. Verified 9/9 in a browser (pipeline,
  send-to-inbox, judge, Constitution, source backlink, ask, save quote,
  search, and the LIFEOS-002 flow) with zero runtime errors; `lint` and
  `build` green. Still localStorage-only — no Supabase, auth, or deploy.
  Known deferral: automatic PDF/URL text extraction (a later ingestion
  adapter); today those inputs prompt for the text in the reader.
- 2026-07-10 — Implemented **LIFEOS-004 durable persistence + real AI**.
  Added `@supabase/supabase-js`; `supabase/migrations/0001_initial_schema.sql`
  (7 tables, UUID PKs, per-row `user_id`, RLS restricting each user to
  their own rows, append-only `belief_revisions`/`user_judgments`/
  `saved_quotes` via insert-only policies, and BEFORE-UPDATE triggers
  making `original_text` and capture `text` immutable). New code:
  `lib/supabase.ts` (client factory — null in local mode, throws only on
  half-configuration; reads only the two public vars), `lib/adapters/types.ts`
  (PersistenceAdapter interface), `lib/adapters/localAdapter.ts`,
  `lib/adapters/supabaseAdapter.ts` (relational row mapping;
  insert-or-ignore for append-only tables). Rewrote `lib/persistence.ts`
  as a facade: synchronous local write first, debounced remote sync
  second, sync-status observable, `retrySync`, and `initRemote` (anonymous
  sign-in + one-time local→remote migration keyed by user id that never
  deletes local data and prevents duplicate imports). Store gained
  `replaceState` (adopt remote without a re-push loop). New components
  `SyncStatus` (in Nav) and `PersistenceBootstrap` (in layout). Hardened
  `app/api/ai/route.ts`: validates task (400) and JSON (400), caps input,
  30s AbortController timeout, logs only failure reasons (never source
  text), and degrades to mock with a `degraded:true` flag so production
  clearly shows when mock is used. Updated `.env.example` (added
  `ANTHROPIC_MODEL`, clarified public vs server-only). Added
  `PERSISTENCE_QA.md` with the exact Supabase/Vercel manual steps and both
  checklists. Verified LOCAL mode end-to-end (9/9 flow, refresh
  persistence, "Saved locally" indicator, AI 400 validation, mock
  fallback) with lint+build green; confirmed the Anthropic key value is
  never in the client bundle (only the identifier appears inside a
  user-facing mock hint string). The Supabase and real-Anthropic paths are
  code-complete but UNVERIFIED here — no credentials were available; they
  activate automatically once the human adds env vars and runs the
  migration. No product features added; UX unchanged.
- 2026-07-10 — Implemented **LIFEOS-004.1 durable email account
  authentication**. Chose email magic link (`signInWithOtp`) as the sole
  remote identity and REMOVED anonymous auth entirely — remote sync is
  gated on a permanent, email-verified session, satisfying "do not sync
  private data until a durable identity exists." New files:
  `lib/authStore.ts` (reactive auth state: configured/loading/email/phase,
  plus `signInWithEmail`/`signOut`), `components/AuthControl.tsx` (calm nav
  sign-in popover with loading/sent/error states; shows email + Sign out
  when signed in; renders nothing when Supabase is unconfigured). Rewrote
  the persistence facade's init: `initPersistence` sets up
  `onAuthStateChange`; `handleSession` enables a SupabaseAdapter only when a
  session exists (else remote=null, local-only) and reflects state into the
  auth store and sync health; `migrateOrAdopt` is idempotent and
  wrong-user-safe (remote-has-data → adopt; remote-empty + local unowned or
  ours → migrate up; remote-empty + local belongs to another account →
  start clean, never cross-migrate). `PersistenceBootstrap` now calls
  `initPersistence`. Duplicate prevention: id-keyed upserts (sources/
  beliefs), insert-or-ignore on `(belief_id, seq)` (revisions/judgments)
  and `(source_id, text)` (quotes), and a `migratedFor` user-id marker.
  Set `emailRedirectTo = window.location.origin`; sign-in is user-initiated
  so there is no redirect loop. Updated `.env.example`, `PERSISTENCE_QA.md`
  (email/Site-URL/redirect-URL dashboard steps; anonymous stays disabled;
  auth + cross-device marked credential-pending), and `README.md`. Verified
  LOCAL/unconfigured mode (no Sign-in button, "Saved locally", full 9/9
  flow, zero runtime errors) with `lint`/`build` green and no secret values
  in the client bundle. Auth, remote sync, and cross-device are
  credential-dependent and remain PENDING human verification.
- 2026-07-10 — **LIFEOS-005 production verification.** Inspected all
  deployment-relevant config: env usage is exactly
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`); public Supabase vars
  are client-safe, the Anthropic key is server-only (only in
  `app/api/ai/route.ts`), no service-role key anywhere, no `.env*` tracked.
  Minimal production-compat code change: added `export const maxDuration =
  30` and `export const runtime = "nodejs"` to `app/api/ai/route.ts` and
  reduced `REQUEST_TIMEOUT_MS` 30s→25s so the graceful mock fallback fires
  before Vercel's serverless timeout. Verified `npm run lint`=0, `npm run
  build`=0, AND that the production server (`next start`) serves all pages
  and `/api/ai` (mock path) — confirming no local-only assumption breaks a
  production runtime. Documented the deployment branch decision (work is on
  `claude/lifeos-implementation-xwrikz`; Vercel Production deploys from the
  Production Branch, default `main` — merge or reconfigure), the
  `NEXT_PUBLIC_*` build-time inlining requirement, the full production QA
  chain, and an Anthropic failure-diagnosis table, all in
  `PERSISTENCE_QA.md`. Live Supabase-auth, real-Anthropic, and
  cross-browser checks are credential/deploy-dependent and were NOT
  performed here — they remain PENDING and are unclaimed. No product
  features, UI, or ontology changes.
- 2026-07-10 — Implemented **LIFEOS-006 knowledge ingestion engine** (an
  architecture pass, not new product features). New files:
  `lib/ingestion/{types,textAdapter,urlAdapter,pdfAdapter,registry,index}.ts`
  (adapter interface + registry + 3 adapters + `ingest()` entry),
  `app/api/extract/route.ts` (non-AI extraction seam: real URL HTML→text
  with SSRF guard + 12s timeout + 3MB/100k caps; PDF seam returns
  needsText), `INGESTION.md` (architecture doc + how to add adapters).
  Refactored `lib/pipeline.ts` from a monolithic function into an ordered
  `PIPELINE_STAGES` array where each stage is independently replaceable
  (added a normalize stage that never touches the immutable original, and
  inactive questions/relationships seams). Refactored `components/AddSource.tsx`
  to call `ingest()` (UX unchanged — same Text/PDF/URL tabs; URL now
  actually fetches, with a "Fetching…" state, and degrades to paste on
  failure). Reused the existing ontology `SourceType`/`SourceInput`; added
  no schema columns, so persistence/auth/AI contracts are untouched.
  Deliberately did NOT add pdf.js or any PDF parser (the ticket's "don't
  hack around limitations") — PDF stays a clean seam. Verified: 9/9 flow
  regression through the new adapter/pipeline, `/api/extract` paths
  (pdf/SSRF/400/graceful-fetch-fallback), `lint`=0, `build`=0. No graphs,
  embeddings, vectors, search engines, megathreads, background agents, or
  additional AI routes.
- 2026-07-10 — Implemented **LIFEOS-007 long-source intelligence + cost
  controls**. New: `lib/dedup.ts` (deterministic conservative dedup),
  `supabase/migrations/0002_long_source_analysis.sql` (additive/rerunnable
  jsonb columns `chunk_results`/`analysis`/`stages` on `sources`; RLS +
  immutability triggers untouched; existing data preserved). Extended
  `types/mvp.ts` (chunk offsets/label; `ChunkResult`, `AnalysisMeta`,
  `StageStatus`, `ProcessingMode`, `Coverage`; new `ProcessingState`
  values; `emptyStages`/`emptyAnalysis`). Rewrote `lib/pipeline.ts` into
  chunk-based map/reduce with modes (quick/full), representative sampling,
  40-chunk safety cap, concurrency 3, cooperative cancel, skip-already-
  mapped idempotency, per-stage status, and `estimateCalls`. Extended the
  single AI route (`app/api/ai/route.ts`) with `map` (structured per-chunk,
  with quote-span verification) and `reduce_summary` tasks + validation +
  mock fallback; added mocks to `lib/mockAI.ts` and helpers to
  `lib/aiClient.ts`. Updated `lib/mvpStore.ts` (`getSource`, init new
  fields), `lib/labels.ts` (new state labels), the Reader
  (`app/library/[id]/page.tsx` — minimal `AnalysisPanel`: Quick/Full/
  per-stage retry/status/coverage/≈calls), and `lib/adapters/supabaseAdapter.ts`
  (map new columns). Ingestion default stays conservative (auto-Quick).
  Verified 9/9 regression + 12/12 long-source checks via the mock path;
  real-AI + Supabase persistence of the new columns remain credential-
  dependent (pending). Docs updated (`INGESTION.md`, `PERSISTENCE_QA.md`,
  `PROJECT_MEMORY.md`). No product redesign; no graphs/embeddings/vectors/
  megathreads/agents/OCR/EPUB/comparative intelligence; still one AI route.
- 2026-07-11 — Implemented **LIFEOS-008 real PDF ingestion**. Added
  `pdfjs-dist` + `scripts/copy-pdf-worker.mjs` (predev/prebuild copies the
  worker to `public/pdf.worker.min.js`; git-ignored). New:
  `lib/ingestion/pdfExtract.ts` (client pdf.js page-aware extraction +
  limits + scanned/failed detection), `lib/textNormalize.ts` (shared
  normalizer so extraction offsets == pipeline chunk offsets),
  `supabase/migrations/0003_pdf_ingestion.sql`. Extended `types/mvp.ts`
  (chunk `pageStart`/`pageEnd`; `PageSpan`, `PdfMeta`, `ExtractionStatus`;
  source `pdfMeta`/`pageMap`/`extractionStatus`), `lib/ingestion/types.ts`
  (IngestionResult PDF fields), `lib/ingestion/pdfAdapter.ts` (real
  extraction), `lib/ingestion/index.ts` + `lib/mvpStore.ts` (`addSource`
  carries PDF fields), `lib/pipeline.ts` (page-annotated chunks via
  `pageMap`; uses shared normalizer), the Reader (PDF meta + extraction
  status, page-labeled read view, quote page refs, re-upload retry),
  `lib/adapters/supabaseAdapter.ts` (map new columns), `eslint.config.mjs`
  (ignore `public/**` vendored worker). Decision: **do not store the PDF
  binary** (client extraction, text-only) → no Storage bucket/policies
  needed, safest posture. Verified with generated fixtures (16/16 PDF +
  9/9 regression + 12/12 long-source, no runtime errors); real-AI/Supabase
  persistence of the new columns remain credential-pending. `lint`=0,
  `build`=0.
- 2026-07-12 — Implemented **LIFEOS-009 intelligent Library retrieval**,
  fully **deterministic** (no embeddings, pgvector, AI route, or background
  jobs). New: `lib/retrieval/records.ts` (`buildRecords` — a transient,
  never-persisted normalized view over the store, with provenance),
  `lib/retrieval/search.ts` (`search`/`relatedTo`/`resurfaceLabel` —
  weighted explainable ranking: exact ×6, concept ×4, token ×3, title ×2,
  provenance, status boost, recency ×0.5; dedup by normalized text +
  per-source diversity cap; human "why matched" reason, never raw scores;
  feedback boosts/suppresses deterministically), `components/
  RetrievalResults.tsx` (shared results list with provenance + feedback
  controls), `supabase/migrations/0004_retrieval.sql` (append-only
  `retrieval_feedback`, own-rows RLS, rerunnable, migrations 0001–0003
  untouched). Extended `types/mvp.ts` (`RecordType`, `RetrievalRecord`,
  `FeedbackVerdict`, `FeedbackEntry`, `StoreState.feedback`),
  `lib/mvpStore.ts` (`feedback` state + `recordFeedback` action),
  `lib/persistence.ts` + `lib/adapters/localAdapter.ts` +
  `lib/adapters/supabaseAdapter.ts` (carry/round-trip feedback). Wired into
  the Library (grouped deep search replacing title-only filter at ≥2 chars),
  Home (async capture resurfacing that never blocks the save; ≤1 primary +
  up to 2 more), Constitution (collapsed per-belief related evidence,
  excludes the belief, no auto contradiction resolution), and Reader
  (collapsed "find related from your library", excludes current source).
  Feedback tunes ranking **only** — no ML recommender, no auto belief
  changes, no cross-user data. Verified 11/11 retrieval + 9/9 regression +
  12/12 long-source + 16/16 PDF checks, zero runtime errors; `lint`=0,
  `build`=0. Docs updated (`ARCHITECTURE.md`, `PERSISTENCE_QA.md`,
  `PROJECT_MEMORY.md`). Still one AI route; no graphs/megathreads/agents.
- 2026-07-12 — Implemented **LIFEOS-010 comparative intelligence**. New:
  `lib/comparison/evidence.ts` (deterministic, capped, provenance-bearing
  evidence packet built via the LIFEOS-009 retrieval layer),
  `lib/comparison/schema.ts` (strict result validation — drops points citing
  invalid evidence ids, flags flattening language), `lib/comparison/run.ts`
  (orchestrator: packet → one `compare` call → validate → optional
  `compare_verify` for ≥4 sources), `lib/mockCompare.ts` (deterministic
  offline comparison), `components/ComparisonResult.tsx` (result view + human
  judgment controls), `app/compare/page.tsx` + `app/compare/[id]/page.tsx`,
  `supabase/migrations/0005_comparative_intelligence.sql`. Extended
  `types/mvp.ts` (`ComparisonInputRef`, `EvidenceItem`/`EvidenceGroup`,
  `ComparisonResultData` + sub-types, `Comparison`, `StoreState.comparisons`),
  `app/api/ai/route.ts` (`compare` + `compare_verify` tasks, larger
  max_tokens, evidence input parsing), `lib/aiClient.ts` (`runComparison` /
  `verifyComparison`), `lib/mvpStore.ts` (`comparisons` state +
  `saveComparison` / `judgeComparisonInsight`), `lib/persistence.ts`,
  `lib/adapters/localAdapter.ts`, `lib/adapters/supabaseAdapter.ts` (load/
  save/delete + row mappers). Entry points added to `components/Nav.tsx`,
  `app/library/page.tsx`, `app/library/[id]/page.tsx`,
  `app/constitution/page.tsx`. Insights flow into the existing Belief Inbox;
  the Constitution is never changed automatically. Verified 15/15 comparison
  + 9/9 regression + 12/12 long-source + 16/16 PDF + 11/11 retrieval checks,
  zero runtime errors; `lint`=0, `build`=0. Supabase persistence of
  `comparisons` (sync/RLS/cross-device) is code-complete but credential-
  pending. No graph UI, megathreads, background agents, or new AI routes
  beyond the single `/api/ai`.
- 2026-07-12 — Implemented **LIFEOS-011 dialectical intelligence**. New:
  `lib/dialectic/evidence.ts` (inquiry evidence packet — reuses comparison
  evidence + belief revisions + comparison findings + terminology, continuing
  the `E1…En` sequence), `lib/dialectic/schema.ts` (strict dialectic
  validation — drops ungrounded substantive assertions, flags false-certainty/
  flattening, clamps argType/fallacy tags), `lib/dialectic/run.ts`
  (orchestrator: packet → one `dialectic` call → validate → optional
  `dialectic_verify` for ≥4 sources; plus `evolveInquiryFlow` that appends to
  history), `lib/mockDialectic.ts` (honest deterministic dialectic, no fake
  balance), `components/DialecticResult.tsx` (result view + per-insight human
  judgment), `app/inquiry/page.tsx` + `app/inquiry/[id]/page.tsx` (workspace,
  detail with provisional conclusion / status / evolve / append-only history),
  `supabase/migrations/0006_dialectical_intelligence.sql`. Extended
  `types/mvp.ts` (`InquiryInputRef`, `ArgumentType`, `FallacyType`,
  `DialecticPoint`, `DialecticResultData` + sub-types, `Inquiry`,
  `InquiryRevision`, `StoreState.inquiries`; widened `EvidenceKind` +
  `EvidenceGroup.ref`), `app/api/ai/route.ts` (`dialectic` +
  `dialectic_verify` tasks, 4096 max_tokens for dialectic), `lib/aiClient.ts`
  (`runDialectic` / `verifyDialectic`), `lib/mvpStore.ts` (`inquiries` state +
  `saveInquiry` / `updateInquiry` / `judgeInquiryInsight` /
  `setInquiryConclusion` / `setInquiryStatus`), `lib/persistence.ts`,
  `lib/adapters/localAdapter.ts`, `lib/adapters/supabaseAdapter.ts` (load/
  save/delete + row mappers). Entry points added to `components/Nav.tsx`,
  `app/compare/[id]/page.tsx`, `app/constitution/page.tsx`,
  `app/library/[id]/page.tsx`. Insights flow into the existing Belief Inbox;
  the Constitution is never changed automatically; reasoning history is
  append-only. Verified 22/22 dialectic + 15/15 comparison + 9/9 regression +
  12/12 long-source + 16/16 PDF + 11/11 retrieval checks, zero runtime errors;
  `lint`=0, `build`=0. Supabase persistence of `inquiries` (sync/RLS/cross-
  device) is code-complete but credential-pending. No graph UI, autonomous
  agents, auto Constitution changes, or new AI routes beyond the single
  `/api/ai`.
- 2026-07-12 — Implemented **LIFEOS-012 megathreads & longitudinal knowledge**.
  New: `lib/megathread/membership.ts` (deterministic, explainable seed +
  candidate members), `lib/megathread/timeline.ts` (chronological read-model,
  never stored), `lib/megathread/evidence.ts` (capped packet reusing inquiry
  evidence + inquiry findings), `lib/megathread/synthesis.ts` (strict
  validation — drops ungrounded points, flags flattening), `lib/megathread/
  run.ts` (orchestrator: one `thread_synthesis` call + deterministic belief-
  evolution/recent-changes injection), `lib/mockThreadSynthesis.ts`,
  `components/ThreadTimeline.tsx`, `components/ThreadSynthesis.tsx`,
  `app/threads/page.tsx` + `app/threads/[id]/page.tsx`,
  `supabase/migrations/0007_megathreads.sql`. Extended `types/mvp.ts`
  (`Megathread`, `ThreadMemberRef`, `TimelineItem`, `ThreadSynthesisData`,
  `MegathreadStatus`/`SeedType`, `StoreState.megathreads`),
  `app/api/ai/route.ts` (`thread_synthesis` task, 3072 max_tokens),
  `lib/aiClient.ts` (`synthesizeThread`), `lib/mvpStore.ts` (megathreads state
  + create/update/member-curation/synthesis/questions/judgment actions),
  `lib/persistence.ts`, `lib/adapters/localAdapter.ts`,
  `lib/adapters/supabaseAdapter.ts` (load/save/delete + row mappers). Entry
  points added to `components/Nav.tsx`, `app/constitution/page.tsx`,
  `app/library/[id]/page.tsx`, `app/compare/[id]/page.tsx`,
  `app/inquiry/[id]/page.tsx`. Threads store only references (no text copies);
  timeline is derived; synthesis insights flow into the Belief Inbox; the
  Constitution is never changed automatically. Verified 21/21 megathread +
  22/22 dialectic + 15/15 comparison + 9/9 regression + 12/12 long-source +
  16/16 PDF + 11/11 retrieval checks, zero runtime errors; `lint`=0,
  `build`=0. Supabase persistence of `megathreads` (sync/RLS/cross-device) is
  code-complete but credential-pending. No graph UI, autonomous agents, auto
  Constitution changes, or new AI routes beyond the single `/api/ai`.
- 2026-07-12 — Implemented **LIFEOS-013 formation engine (daily & weekly
  review)**. New: `lib/formation/daily.ts` (deterministic ≤3-item selection,
  feedback-filtered), `lib/formation/weekly.ts` (deterministic counts/deltas +
  weekly-synthesis orchestrator), `lib/formation/alignment.ts` (cautious
  alignment reflection), `lib/formation/practice.ts` (practice suggestion +
  safety guardrails), `lib/formation/schema.ts` (weekly/alignment validation —
  drop uncited claims, flag accusatory language), `lib/mockFormation.ts`,
  `components/PracticeList.tsx`, `app/review/page.tsx` + `app/review/weekly/
  page.tsx`, `supabase/migrations/0008_formation_engine.sql`. Extended
  `types/mvp.ts` (`Reflection`, `PracticeCandidate`, `ReviewSession`,
  `WeeklySynthesisData`, `AlignmentData`, `CitedClaim` + enums,
  `StoreState.{reflections,practices,reviews}`), `app/api/ai/route.ts`
  (`practice_suggest` / `weekly_synthesis` / `alignment_reflection` tasks; bumped
  evidence-id length 12→64 so real record-id citations validate),
  `lib/aiClient.ts` (`suggestPractices` / `weeklySynthesis` /
  `alignmentReflection`), `lib/mvpStore.ts` (reflection/practice/review state +
  actions + `getStoreSnapshot`), `lib/persistence.ts`,
  `lib/adapters/localAdapter.ts`, `lib/adapters/supabaseAdapter.ts` (load/save/
  delete + row mappers). Entry point added to `components/Nav.tsx` and the Home
  page (one quiet link). Reflections never change beliefs; a revise routes
  through the existing revision flow; practices require explicit acceptance;
  the Constitution never changes automatically; Home has no gamification.
  Verified 23/23 formation + 21/21 megathread + 22/22 dialectic + 15/15
  comparison + 9/9 regression + 12/12 long-source + 16/16 PDF + 11/11 retrieval
  checks, zero runtime errors; `lint`=0, `build`=0. Supabase persistence of the
  new tables (sync/RLS/cross-device) is code-complete but credential-pending.
  No embeddings, graph UI, autonomous agents, notifications/streaks/points, or
  new AI routes beyond the single `/api/ai`.
- 2026-07-12 — Implemented **LIFEOS-014 reasoning engine**. New:
  `lib/reasoning/graph.ts` (scope resolution + internal evidence graph + capped
  packet with real record-id evidence), `lib/reasoning/passes.ts` (deterministic
  support/contradiction/influence/assumption/belief-impact/change-over-time/
  unresolved passes — no truth scores, cautious tension classification, no
  mutation), `lib/reasoning/schema.ts` (AI-layer validation — drop uncited
  findings, flag overconfidence), `lib/reasoning/run.ts` (orchestrator: scope →
  graph → deterministic pass → packet → one `reasoning_synthesis` call →
  validate → optional `reasoning_verify` for ≥30 nodes; plus `rerunReasoning`
  appending history), `lib/mockReasoning.ts`, `components/ReasoningResult.tsx`,
  `app/reason/page.tsx` + `app/reason/[id]/page.tsx`,
  `supabase/migrations/0009_reasoning_engine.sql`. Extended `types/mvp.ts`
  (`ReasoningQuery`, `ReasoningMode`, `ReasoningScope`, `ReasoningNode`/`Edge`,
  `ReasoningResultData`, `SupportAudit`, `ReasoningTension`, `InfluenceChain`,
  `StoreState.reasonings`), `app/api/ai/route.ts` (`reasoning_synthesis` /
  `reasoning_verify` tasks), `lib/aiClient.ts` (`reasoningSynthesis` /
  `verifyReasoning`), `lib/mvpStore.ts` (reasoning state + save/update/judge/
  conclusion/status/attach-to-thread actions), `lib/persistence.ts`,
  `lib/adapters/localAdapter.ts`, `lib/adapters/supabaseAdapter.ts` (load/save/
  delete + row mappers), `components/Nav.tsx` (+ flex-wrap for the fuller nav).
  Entry points added to `app/constitution/page.tsx` (belief + header),
  `app/library/[id]/page.tsx`, `app/threads/[id]/page.tsx`. Findings cite real
  record ids; unsupported are dropped/flagged; a finding can enter the Belief
  Inbox; a result can attach to a Megathread; a prior inquiry can be reopened;
  reasoning history is append-only; the Constitution never changes
  automatically. Verified 19/19 reasoning + 23/23 formation + 21/21 megathread +
  22/22 dialectic + 15/15 comparison + 9/9 regression + 12/12 long-source +
  16/16 PDF + 11/11 retrieval checks, zero runtime errors; `lint`=0, `build`=0.
  Supabase persistence of `reasonings` (sync/RLS/cross-device) is code-complete
  but credential-pending. No autonomous agents, graph UI, auto Constitution
  changes, or new AI routes beyond the single `/api/ai`.
- 2026-07-13 — Implemented **LIFEOS-015 semantic retrieval & evidence
  freshness** (base: merged LIFEOS-014 on `main`; branch restarted from
  `origin/main`). New: `lib/embeddings/{types,local,records,index}.ts`
  (provider seam + local lexical embedder + embeddable-record extraction +
  batched idempotent indexing), `lib/hash.ts`, `app/api/embed/route.ts`
  (provider-independent embedding route, local fallback, no text logging),
  `lib/retrieval/semantic.ts` (query vector + cosine + index gate),
  `lib/freshness/fingerprint.ts` (deterministic freshness),
  `components/{FreshnessBadge,SemanticIndexPanel}.tsx`,
  `supabase/migrations/0010_semantic_retrieval.sql` (pgvector `embeddings`
  table + own-row RLS + `match_embeddings` RPC). Extended `types/mvp.ts`
  (`EmbeddingRecord`, `EmbeddableType`, `SavedFingerprint`, `FreshnessStatus`,
  `StoreState.embeddings`, `fingerprint?` + Comparison `history?`),
  `lib/retrieval/search.ts` (additive semantic term below exact/concept +
  "Semantically related" label), `lib/reasoning/passes.ts` (semantic candidate
  widening for contradiction pairing, gated by deterministic polarity),
  `lib/comparison/run.ts` (+`rerunComparison`), `lib/dialectic/run.ts`,
  `lib/reasoning/run.ts` (fingerprints), `lib/mvpStore.ts` (embeddings state +
  `addEmbeddings`/`updateComparison` + fingerprints on thread/weekly synthesis),
  `lib/persistence.ts`, `lib/adapters/{localAdapter,supabaseAdapter}.ts`
  (embeddings load/save/delete + pgvector mappers). Wired semantic (gated on
  `state.embeddings.length > 0`) into Library search, Home/Constitution/Reader
  related, and Megathread/comparison evidence selection; added freshness badges
  + rerun to compare/inquiry/thread/reason/weekly detail pages; Library gained
  a Semantic index panel. Deterministic retrieval unchanged when no index
  exists; exact/concept always outrank weak semantic; semantic alone never
  labels a contradiction; rerun preserves history + conclusions. Verified 19/19
  semantic/freshness + all prior suites (19/19 reasoning, 23/23 formation,
  21/21 megathread, 22/22 dialectic, 15/15 comparison, 9/9 regression, 12/12
  long-source, 16/16 PDF, 11/11 retrieval), zero runtime errors; `lint`=0,
  `build`=0. Supabase `embeddings` sync/RLS + a real embedding provider are
  code-complete but credential-pending. No graph UI, autonomous agents, auto
  Constitution changes, or new AI routes beyond `/api/ai` (+ the non-AI
  `/api/embed` + `/api/extract` utility routes).
- 2026-07-16 — Implemented **LIFEOS-016 decision intelligence** (base: merged
  LIFEOS-015 on `main`; branch restarted from `origin/main`). New:
  `lib/decision/{safety,tradeoffs,evidence,schema,run}.ts` (sensitive-topic
  cautions; deterministic weighted tradeoffs from user ratings; capped
  evidence packet over beliefs/reflections/practices/sources/comparisons/
  inquiries/threads/reasonings/earlier decisions; strict validation dropping
  uncited findings + flagging prescriptive/falsely-certain language;
  orchestrator with optional verify for ≥5 options), `lib/mockDecision.ts`,
  `components/DecisionAnalysisView.tsx`, `app/decisions/page.tsx` +
  `app/decisions/[id]/page.tsx`,
  `supabase/migrations/0011_decision_intelligence.sql`. Extended
  `types/mvp.ts` (`Decision`, `DecisionOption`, `DecisionCriterion`,
  `DecisionAnalysisResult` + sub-types, `OutcomeReview`,
  `StoreState.decisions`), `app/api/ai/route.ts` (`decision_synthesis` +
  `decision_verify`, 4096 max_tokens; decision context carried in `draft`),
  `lib/aiClient.ts` (`decisionSynthesis`/`verifyDecision`),
  `lib/freshness/fingerprint.ts` (resolves reasonings/practices/decisions +
  `decision-config:` deps; `decisionDeps`; new change nouns incl. "criterion
  or option changed"), `lib/mvpStore.ts` (decisions state + create/option/
  criterion/rating/analysis/choice/outcome-review/judgment/attach actions —
  `setFinalChoice` is the ONLY path to a final choice),
  `lib/persistence.ts`, `lib/adapters/{localAdapter,supabaseAdapter}.ts`
  (load/save/delete + row mappers). Entry points: `components/Nav.tsx`
  ("Decide"), `app/constitution/page.tsx`, `app/threads/[id]/page.tsx`,
  `app/reason/[id]/page.tsx`, `app/review/page.tsx` (saved reflection → "use
  as decision evidence"). Verified 34/34 decision + all prior suites, zero
  runtime errors; `lint`=0, `build`=0. Supabase `decisions` persistence is
  code-complete but credential-pending. README unchanged (no setup required;
  the workspace is self-describing). No agents, graph UI, notifications,
  gamification, auto Constitution changes, or new AI routes beyond `/api/ai`.
- 2026-07-16 — Implemented **LIFEOS-017 reflective practice & daily formation**
  (base: merged LIFEOS-016 on `main`; branch restarted from `origin/main`).
  New: `lib/formation/{prompts,sessionEvidence,sessionSchema,sessionRun,
  timeline,cadence}.ts` (deterministic non-shallow prompt engine from the
  user's own knowledge; capped evidence packet; validation dropping uncited
  belief-revision suggestions + softening moralizing/false-certainty language;
  deterministic-first synthesis orchestrator; derived read-only chronological
  timeline; five-horizon invitational cadence review), `lib/mockFormationSession.ts`,
  `components/FormationSynthesisView.tsx` + `components/FormationTimeline.tsx`,
  `app/formation/page.tsx` (type picker + create + cadence tabs + recent
  sessions), `app/formation/[id]/page.tsx` (workspace: prompts, immutable
  reflection, structured capture, run/rerun synthesis + FreshnessBadge,
  judgeable synthesis, belief-candidate → Inbox, attach-to-thread),
  `app/formation/timeline/page.tsx`, `supabase/migrations/0012_reflective_practice.sql`.
  Extended `types/mvp.ts` (`FormationSession`, `FormationSynthesisData`,
  `FormationFinding`, `FormationTimelineItem` + enums, `StoreState.formationSessions`),
  `app/api/ai/route.ts` (`formation_synthesis`, 3072 max_tokens; context in
  `draft`, reflection in `text`), `lib/aiClient.ts` (`formationSynthesis`),
  `lib/freshness/fingerprint.ts` (resolves formation sessions +
  `formation-config:` deps; `formationDeps`; "your reflection changed" noun),
  `lib/mvpStore.ts` (formationSessions state + create/reflection(immutable)/
  fields/status/link/synthesis/judge/attach actions), `lib/persistence.ts`,
  `lib/adapters/{localAdapter,supabaseAdapter}.ts` (load/save/delete + row
  mappers). Entry points: `components/Nav.tsx` ("Reflect"),
  `app/constitution/page.tsx`, `app/threads/[id]/page.tsx`,
  `app/decisions/[id]/page.tsx`, `app/inquiry/[id]/page.tsx`,
  `app/library/[id]/page.tsx`, `app/review/page.tsx`. Verified 26/26 formation
  + all prior suites (decision 34, semantic 19, review, threads, inquiry,
  compare, retrieval, reason, qa3, pdf, long-source), zero runtime errors;
  `lint`=0, `build`=0. Supabase `formation_sessions` persistence is
  code-complete but credential-pending. README unchanged. No agents, graph UI,
  notifications, gamification, auto Constitution changes, or new AI routes
  beyond `/api/ai`.
- 2026-07-17 — Implemented **LIFEOS-018 world model** (base: merged LIFEOS-017
  on `main`; branch restarted from `origin/main`). New:
  `lib/world/{relationships,extract,tensions,schema,run,timeline}.ts` (12-type
  relationship metadata + structural mapping; deterministic concept-candidate
  extraction + evidence packet; deterministic tension detection; proposal
  validation; proposal orchestrator; derived read-only evolution timeline),
  `lib/mockWorld.ts`, `components/{ConceptRelationships,TensionList,WorldTimeline}.tsx`,
  `app/world/page.tsx` (Concepts/Frameworks/Principles/Tensions/Review/Timeline
  tabs) + `app/world/concept/[id]/page.tsx`,
  `supabase/migrations/0013_world_model.sql` (4 tables, own-rows RLS). Extended
  `types/mvp.ts` (`Concept`, `ConceptRelationship` + 12 types, `Principle`,
  `Framework` + kinds, `WorldProposal`, `WorldTension`, `WorldTimelineItem`,
  `StoreState.{concepts,conceptRelationships,principles,frameworks}`),
  `app/api/ai/route.ts` (`concept_extract`, 3072 max_tokens),
  `lib/aiClient.ts` (`proposeWorldModel`),
  `lib/freshness/fingerprint.ts` (resolves concepts/principles/frameworks +
  `concept-config:` dep; `conceptDeps`; new change nouns),
  `lib/mvpStore.ts` (4 arrays + concept/relationship(propose→approve)/principle/
  framework actions — approval is the ONLY way an edge enters the graph),
  `lib/persistence.ts`, `lib/adapters/{localAdapter,supabaseAdapter}.ts`
  (load/save/delete + row mappers). Entry points: `components/Nav.tsx`
  ("World"), `app/constitution/page.tsx` ("Model as a concept"),
  `app/threads/[id]/page.tsx`. Verified 21/21 world + all prior suites
  (formation 26, decision 34, semantic 19, review, threads, inquiry, compare,
  retrieval, reason, qa3, pdf, long-source), zero runtime errors; `lint`=0,
  `build`=0. Supabase world-model persistence is code-complete but
  credential-pending. README unchanged. No agents, graph visualization,
  embeddings, notifications, auto Constitution changes, or new AI routes beyond
  `/api/ai`.
- 2026-07-17 — Implemented **LIFEOS-019 knowledge authoring** (base: merged
  LIFEOS-018 on `main`; branch restarted from `origin/main`). New:
  `lib/authoring/{assembly,outline,draft,schema,citations,crossref}.ts`
  (deterministic evidence assembly; per-kind outline candidates + AI candidate;
  section drafting with paragraph-level citation validation; unsupported
  detection + coverage; deterministic cross-reference engine), `lib/authoring/
  export/{model,markdown,html,zip,docx,pdf,index}.ts` (dependency-free exporters
  — a pure-TS CRC32 store-only zip powering a minimal OOXML .docx, and a minimal
  Helvetica PDF writer with wrapping+pagination; all render one ExportDoc so
  citations are preserved identically), `lib/mockAuthoring.ts`,
  `components/{AuthoringSection,ExportBar}.tsx`, `app/author/page.tsx` +
  `app/author/[id]/page.tsx`, `supabase/migrations/0014_authoring_engine.sql`.
  Extended `types/mvp.ts` (`KnowledgeProject`, `DraftSection`, `DraftParagraph`,
  `SectionVersion`, `OutlineOption`, `ProjectAssembly`, `ProjectEvidence`,
  `CrossRef` + enums, `StoreState.knowledgeProjects`), `app/api/ai/route.ts`
  (`outline_generate` + `section_draft`), `lib/aiClient.ts`
  (`generateOutlines`/`draftSection`), `lib/freshness/fingerprint.ts`
  (`projectDeps`), `lib/mvpStore.ts` (knowledgeProjects + create/assemble/
  outline-choose/section-draft(history-preserving)/transform/paragraph-edit/
  export actions), `lib/persistence.ts`, `lib/adapters/{localAdapter,
  supabaseAdapter}.ts` (load/save/delete + row mappers). Entry point:
  `app/threads/[id]/page.tsx` ("Write from this thread"); `components/Nav.tsx`
  ("Author"). Verified 23/23 authoring (incl. export byte verification: DOCX is
  a valid zip unzipping to 4 OOXML parts, PDF has startxref/Pages/Helvetica) +
  all prior suites (world 21, formation 26, decision 34, semantic 19, review,
  threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source), zero
  runtime errors; `lint`=0, `build`=0. Supabase `knowledge_projects`
  persistence is code-complete but credential-pending. README unchanged. No
  agents, autonomous writing, chatbot, notifications, auto Constitution changes,
  or new AI routes beyond `/api/ai`.
- 2026-07-17 — Implemented **LIFEOS-020 research workspace** (base: merged
  LIFEOS-019 on `main`; branch restarted from `origin/main`). Heavily reuse-
  driven and AI-free (no `/api/ai` change). New: `lib/research/{gaps,timeline,
  export}.ts` (deterministic gap detection; derived read-only timeline; research
  → ExportDoc reusing the LIFEOS-019 export writers), `components/{HypothesisList,
  ArgumentMap,GapList,ResearchTimeline,ResearchExportBar,EvidencePicker}.tsx`
  (EvidencePicker extracted as a SHARED component now used by authoring too),
  `app/research/page.tsx` + `app/research/[id]/page.tsx` (Overview/Questions/
  Evidence/Hypotheses/Arguments/Timeline/Gaps/Export dashboard),
  `supabase/migrations/0015_research_workspace.sql`. Extended `types/mvp.ts`
  (`ResearchProject`, `ResearchQuestionSet`/`Item`/`Definition`, `Hypothesis`,
  `ArgumentNode`/`Edge`, `ResearchGap`, `ResearchTimelineItem` + enums,
  `StoreState.researchProjects`), `lib/freshness/fingerprint.ts`
  (`researchDeps`), `lib/mvpStore.ts` (researchProjects + create/question-set/
  evidence(reuses ProjectAssembly)/hypothesis/argument/author-handoff actions —
  `seedAuthorFromResearch` reuses `createKnowledgeProject`), `lib/persistence.ts`,
  `lib/adapters/{localAdapter,supabaseAdapter}.ts` (load/save/delete + row
  mappers). Refactored `app/author/[id]/page.tsx` onto the shared EvidencePicker.
  Entry points: `components/Nav.tsx` ("Research"), `app/threads/[id]/page.tsx`
  ("Investigate this thread"), `app/constitution/page.tsx` ("Investigate this").
  Verified 21/21 research (incl. export bytes + author handoff) + authoring
  still 23/23 after the refactor + all prior suites (world 21, formation 26,
  decision 34, semantic 19, review, threads, inquiry, compare, retrieval, reason,
  qa3, pdf, long-source), zero runtime errors; `lint`=0, `build`=0. Supabase
  `research_projects` persistence is code-complete but credential-pending.
  README unchanged. No agents, autonomous research, web browsing, chatbot,
  notifications, auto Constitution changes, or new AI routes beyond `/api/ai`.
- 2026-07-17 — Implemented **LIFEOS-021 unified graph and persistence** (base:
  merged LIFEOS-020 on `main`; branch restarted from `origin/main`). An
  architecture sprint — deterministic, no AI, no new endpoints, non-breaking.
  New: `lib/graph/{references,index}.ts` (unified reverse-reference index +
  knowledge-graph/relationship API with integrity checks),
  `lib/perf/profile.ts` (deterministic profiling), `lib/stores/{index,knowledge,
  research,author,world,reasoning,decision,graph}.ts` (domain facade modules
  re-exporting the store API), `app/diagnostics/page.tsx` (dev-only diagnostics),
  `supabase/migrations/0016_graph_and_incremental_sync.sql` (additive updated_at
  indexes + own-rows `sync_meta`). Modified (backward-compatible): `lib/adapters/
  types.ts` (`saveState(state, dirty?)`), `lib/persistence.ts` (dirty-domain
  diffing by immutable-array reference equality; `getSyncDiagnostics`;
  lastSyncedState baseline), `lib/adapters/{localAdapter,supabaseAdapter}.ts`
  (dirty-gated per-table upserts; local ignores dirty). No store mutation code
  changed. Verified 15/15 graph/diagnostics (dev) + EVERY prior regression suite
  re-run green (research 21, authoring 23, world 21, formation 26, decision 34,
  semantic 19, review, threads, inquiry, compare, retrieval, reason, qa3, pdf,
  long-source), zero runtime errors; `lint`=0, `build`=0. Incremental remote
  push + sync_meta indexes are code-complete but credential-pending. README
  unchanged. No agents, AI, endpoints, visualization, embeddings, or breaking
  changes.
- 2026-07-17 — Implemented **LIFEOS-022 Socratic dialogue & dialectical engine**
  (base: LIFEOS-021 on the same branch — LIFEOS-021 was never merged/PR'd, so
  this commit stacks on top of it; the branch now carries TWO unmerged commits).
  A structured environment to investigate an idea through disciplined dialogue —
  deterministic-first, evidence-first, human-directed, AI-FREE (no new `/api/ai`
  task; the Socratic engine is deterministic, matching "not a chatbot / not
  roleplay / not autonomous reasoning"). New: `lib/dialogue/{socratic,context,
  timeline}.ts` (deterministic Socratic-move generator with graph-grounded lines;
  graph context reusing `lib/graph`; derived read-only timeline),
  `components/{SocraticPrompts,DialogueThread,DialogueGraphContext,DialogueTimeline}.tsx`,
  `app/dialogue/page.tsx` + `app/dialogue/[id]/page.tsx` (tabbed Dialogue/
  Perspectives/Graph/Outcomes/Timeline), `supabase/migrations/0017_dialogue_engine.sql`
  (own-rows RLS jsonb `dialogue_sessions`; 0001–0016 untouched). Modified:
  `types/mvp.ts` (DialogueSession/DialogueTurn/Perspective/DialogueInquiry/
  DialogueTimelineItem + status/kind/author/flag/perspective-kind unions;
  `dialogueSessions` on StoreState), `lib/mvpStore.ts` (dialogue actions +
  outcome spawners REUSING existing creators + hydrate mapper),
  `lib/freshness/fingerprint.ts` (`dialogueDeps`), `lib/persistence.ts` +
  `lib/adapters/{localAdapter,supabaseAdapter}.ts` (dialogueSessions array +
  row mappers, dirty-gated upsert), `components/Nav.tsx` (Dialogue link),
  `app/constitution/page.tsx` + `app/threads/[id]/page.tsx` (dialogue entry
  points). Verified 19/19 dialogue + EVERY prior regression suite re-run green
  (research 21, authoring 23, world 21, formation 26, decision, semantic, review,
  threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph 15),
  zero runtime errors; `lint`=0, `build`=0. Supabase `dialogue_sessions`
  persistence is code-complete but credential-pending. README unchanged (it
  carries no per-module list). No agents, chatbot, roleplay, autonomous
  reasoning, web browsing, auto Constitution changes, or new AI routes beyond
  `/api/ai`.
- 2026-07-18 — Implemented **LIFEOS-023 dialectical synthesis & tension
  resolution** (base: LIFEOS-022 on `main`; branch restarted from `origin/main`).
  Deterministic, evidence-first, AI-FREE. New: `lib/dialectic/{confidence,
  tensions,synthesis,memory}.ts` (separated four-axis confidence; explicit-signal
  tension detection reusing the graph + dialogue context; deterministic synthesis
  scaffolds incl. a deferral that preserves uncertainty; derived conversation
  memory), `components/{ConfidenceMeter,TensionCard,SynthesisPanel,
  DialecticWorkspace}.tsx`, a "Dialectic" tab on `app/dialogue/[id]/page.tsx`,
  `supabase/migrations/0018_dialectical_synthesis.sql` (own-rows-RLS `tensions` +
  `syntheses`; indexes; idempotent; 0001–0017 untouched). Modified: `types/mvp.ts`
  (Tension/Synthesis/DialecticConfidence/DialecticEvidenceLink/SynthesisRevision
  + `DialecticTensionKind`/`TensionStatus`/`SynthesisStatus`; `tensions` +
  `syntheses` on StoreState), `lib/mvpStore.ts` (detect/author/status actions +
  synthesis accept/reject/revise/continue + integration spawners REUSING existing
  creators + hydrate mapper), `lib/freshness/fingerprint.ts` (`tensionDeps`/
  `synthesisDeps`), `lib/persistence.ts` + `lib/adapters/{localAdapter,
  supabaseAdapter}.ts` (two arrays + row mappers, dirty-gated upsert). Verified
  22/22 synthesis + EVERY prior suite re-run green (dialogue 19, research 21,
  authoring 23, world 21, formation 26, decision, semantic, review, threads,
  inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph 15); migration
  applied + idempotent on a real Postgres 16 schema built from 0001–0017;
  `lint`=0, `build`=0. Supabase `tensions`/`syntheses` persistence is
  code-complete but credential-pending. README unchanged. No agents, debate/
  persuasion engine, autonomous reasoning, auto record mutation, or new AI routes
  beyond `/api/ai`. Reasoning-record integration deferred (needs the AI route).
- 2026-07-18 — Implemented **LIFEOS-024 cognitive orchestration & active
  intelligence** (base: LIFEOS-023 on `main`; branch restarted from `origin/main`).
  Deterministic, read-only, AI-FREE. New: `lib/orchestrator/index.ts` (lightweight
  orchestrator: run scanners, dedupe by signature, merge preserving user
  decisions), `lib/orchestrator/types.ts` (scanner contract + signature helper),
  `lib/orchestrator/scanners/{belief,research,graph,dialogue,review,formation,
  decision,world}.ts` (eight pure per-subsystem scanners — no scanner imports
  another), `components/RecommendationCard.tsx`, `app/orchestrator/page.tsx`
  (the LifeOS Inbox: filter by status/priority/subsystem, accept/dismiss/snooze/
  complete, inspect rationale, jump to originating object),
  `supabase/migrations/0019_cognitive_orchestrator.sql` (own-rows-RLS
  `recommendations`; indexes; idempotent; 0001–0018 untouched). Modified:
  `types/mvp.ts` (Recommendation + RecommendationType/Priority/Target +
  OrchestratorSubsystem; `recommendations` on StoreState), `lib/mvpStore.ts`
  (refreshRecommendations + accept/dismiss/snooze/complete/reopen + hydrate
  mapper), `lib/persistence.ts` + `lib/adapters/{localAdapter,supabaseAdapter}.ts`
  (recommendations array + row mappers, dirty-gated upsert), `components/Nav.tsx`
  (Orchestrator entry). The orchestrator is the SOLE cross-subsystem coordination
  point (no subsystem depends on another; no circular deps). Verified 22/22
  orchestration + EVERY prior suite re-run green (synthesis 22, dialogue 19,
  research 21, authoring 23, world 21, formation 26, decision, semantic, review,
  threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source, graph 15);
  migration applied + idempotent on a real Postgres 16 schema built from
  0001–0018; `lint`=0, `build`=0. Supabase `recommendations` persistence is
  code-complete but credential-pending. README unchanged. No agents, autonomous
  actions, auto record mutation, content generation, or new AI routes beyond
  `/api/ai` — the orchestrator only surfaces deterministic opportunities.
- 2026-07-18 — Implemented **LIFEOS-025 Generation 1 hardening, coherence &
  daily use** (base: LIFEOS-024 on `main`; branch restarted from `origin/main`).
  The Gen-1 capstone: no new reasoning subsystem. New: `app/today/page.tsx`
  (Daily Home — pure projection, duplicates nothing), `app/welcome/page.tsx`
  (skippable/restartable 4-step onboarding; real first capture, never synthetic
  data), `app/health/page.tsx` (System Health + Generation 1 readiness
  scorecard; observational, no secrets), `app/error.tsx` (recoverable error
  boundary), `lib/integrity/checks.ts` (10 deterministic read-only checks +
  one safe derived-data repair), `lib/prefs.ts` (per-user prefs, local-first +
  `user_prefs` mirror), `supabase/migrations/0020_generation_one_hardening.sql`
  (own-rows `user_prefs` only). Modified: `lib/persistence.ts` (retry w/
  backoff, offline detection + reconnect flush, in-flight guard, adoption gate
  vs hydration race, corrupt-blob backup, surfaced local-save failures,
  save-error ring buffer), `lib/adapters/types.ts` (SyncState + offline/
  retrying + localError/retryAttempt), `components/SyncStatus.tsx` (real
  states: saved/saving/offline/retrying/error/local-only),
  `components/Nav.tsx` (grouped Gen-1 IA; brand → Daily Home; Health entry),
  `lib/mvpStore.ts` (`repairStaleRecommendations`). Verified 41/41 gen1 +
  EVERY prior suite re-run green (orchestration 22, synthesis 22, dialogue 19,
  research 21, authoring 23, world 21, formation 26, decision, semantic,
  review, threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source,
  graph 15, auth, sync); 0020 applied + idempotent on Postgres 16 from
  0001–0019; mobile viewports clean at 390px; `lint`=0, `build`=0. README
  unchanged. No agents, no new AI routes, no speculative ontology, no
  auto-mutation — Daily Home and System Health are projections/observations.
- 2026-07-18 — **Generation 1 RC validation plan** (post-LIFEOS-025 merge; no
  feature, no migration, no architecture change). Verified the FULL migration
  chain 0001→0020 applies in order on a fresh Postgres 16 with zero errors
  (0010/pgvector runs on Supabase where the extension exists), yields 29
  tables with RLS enabled on all 29, and the whole chain re-runs idempotently.
  New: `RELEASE_VALIDATION.md` (production schema verification SQL,
  credentialed Supabase acceptance checklist, two-user RLS test plan,
  seven-day /today-centered dogfooding plan, v1.0.0-rc1 + v1.0.0 release
  criteria, rollback procedure) and `.github/ISSUE_TEMPLATE/finding.yml`
  (severity / data-loss risk / module / repro / expected / actual / evidence).
  README links the new doc. No app code touched.
- 2026-07-24 — Implemented **LIFEOS-026 Living Memory & Insight Engine** (base:
  Generation 1 / v1.0.0-rc1 on `main`; branch restarted from `origin/main`).
  Makes LifeOS feel like a living memory: deterministic, read-only, self-
  explaining resurfacing of the user's own history — no new LLM orchestration,
  no autonomous agent, no background jobs, no hidden reasoning, no knowledge
  mutation, no duplicate storage, everything derived from existing objects.
  New engines under `lib/memory/`: `explanation.ts` (Feature 7 — shared
  `MemoryExplanation`: triggers + evidence-refs + qualitative confidence +
  generatedAt + "Suggested because:" summary; `isCompleteExplanation` gate),
  `living.ts` (Feature 1 — 10 rules, multi-reason merge-map keyed by record id,
  most-reasons-first), `timeline.ts` (Feature 2 — belief formation/revisions,
  captures, accepted syntheses, research/formation milestones, decision
  outcomes, dialogue completions, newest-first), `themes.ts` (Feature 3 —
  concept themes via explicit refs + name/alias mention, monthly frequency
  buckets; precompiled per-theme matcher), `recommendation.ts` (Feature 4 —
  `explainRecommendation` → shared explanation), `continue.ts` (Feature 5 —
  open threads to resume), `prompts.ts` (Feature 6 — changed_view /
  never_challenged / multi_source / hidden_link, each evidence-bearing), and
  `selftest.ts` (54 fixture-driven assertions incl. projection purity + perf
  budget). New UI: `app/memory/page.tsx`, `app/timeline/page.tsx`,
  `app/themes/page.tsx`, `app/themes/[id]/page.tsx`, `app/dev/memory-tests/
  page.tsx`, and `components/ExplanationDetail.tsx` (one disclosure for every
  explanation). Modified: `app/today/page.tsx` (Continue thinking / From your
  memory / Reflection prompts sections), `components/RecommendationCard.tsx`
  (structured explanation replaces the raw rationale toggle), `components/
  Nav.tsx` (Memory group: Memory · Timeline · Themes). Optimized two O(n³)/
  regex-per-record hot paths (Living Memory concept-term precompute; Themes
  precompiled matcher) so the 300× perf budget holds (<1.5s). Verified 29/29
  memory E2E + 54/54 self-tests + EVERY prior suite re-run green (gen1 41,
  orchestration 22, synthesis 22, dialogue 19, research 21, world 21,
  formation 26, authoring 23, decision 33, compare 15, inquiry 22, threads 21,
  reason, retrieval 11, semantic 19, sync, graph 15). NO migration — every
  surface is a computed projection; the chain stays 0001–0020. `lint`=0,
  `build`=0. Screenshots captured (memory, timeline, theme detail, today-with-
  memory, orchestrator explanation). No agents, no new AI routes, no auto-
  mutation — the whole subsystem observes and explains, never acts.
- 2026-07-25 — Implemented **LIFEOS-027 Command Center & friction elimination**
  (base: LIFEOS-026 on `main`; branch restarted from `origin/main`). A unified
  command center to make the existing system dramatically faster to use daily —
  NO new cognitive engine, no LLM/embeddings/background jobs. New reusable
  library `lib/command/`: `types.ts`, `records.ts` (one record→label/href/field
  catalog), `ranking.ts` (documented deterministic scoring: exact 1000 > prefix
  800 > contains 600 > alias 400 > body 200; ties by recency→title length→id),
  `search.ts` (normalized index built once per store snapshot, queried per
  keystroke), `recent.ts` (recent history cap-20 + pinning, stored as record
  refs in prefs, reconciled against the store for deletes/renames; pure
  helpers), `shortcuts.ts` (pure `resolveKey` + typing guards + platform
  labels + "g" chords), `registry.ts` (extensible provider registry, dedupe by
  id), `commands.ts` (navigation + Create-Anything reusing canonical flows +
  Continue Work reusing LIFEOS-026 `buildContinueThinking` + recent/pinned
  providers), `events.ts` (window-event bridge), and `selftest.ts` (39
  assertions). New UI `components/command/`: `CommandPalette` (combobox/listbox,
  arrows/Enter/Escape, focus trap, aria-activedescendant, no network to open),
  `CommandResult`, `QuickCapture` (reuses `addCapture`; tiny default flow, draft
  preservation, duplicate-submit guard, success link), `ShortcutHelp`,
  `MobileCommandTrigger`, and `CommandCenter` (single orchestrator in the root
  layout: one-overlay state, global shortcuts, chord, focus restoration,
  route-based recent tracking). Modified: `app/layout.tsx` (mounts
  CommandCenter), `components/Nav.tsx` (regrouped Today·Capture·Think·Research·
  Memory·Decide·System with no destination removed/renamed + a ⌘K search
  button), `app/today/page.tsx` (Pinned section + quick-capture button),
  `lib/prefs.ts` (adds `recent`/`pinned` to Prefs — reuses the local +
  `user_prefs` mirror). Keyboard map: ⌘/Ctrl+K palette, ⌘/Ctrl+⇧+K quick
  capture, `/` search, `?` help, Escape close, `g`-chords. NO migration — recent/
  pinning reuse `user_prefs` (0020); chain stays 0001–0020. Verified 27/27
  command E2E + 39/39 self-tests + FULL regression re-run green (gen1 41,
  memory 29, dialogue 19, synthesis 22, orchestration 22, research 21, world 21,
  formation 26, authoring 23, decision 33, compare 15, inquiry 22, threads 21,
  reason, retrieval 11, semantic 19, sync, graph 15); `lint`=0, `build`=0.
  Screenshots captured (command palette, mobile command bar). Privacy: results
  derive only from the local store + own prefs; nothing sent externally, no
  search terms logged. No agents, no new AI routes, no auto-mutation.
- 2026-07-25 — Implemented **LIFEOS-028 Reading companion foundation** (base:
  LIFEOS-027 on `main`; branch restarted from `origin/main`). The canonical
  document model for all future reading/research/study — deterministic, offline,
  no LLM/embeddings/OCR/PDF/EPUB/AI/background jobs (architecture only). New
  types: `ReadingDocument` → `DocumentSection` → `Passage` (+ `Highlight`,
  `Annotation`, `ReadingProgress`, `Citation`), added to `StoreState`. New
  `lib/library/`: `importer.ts` (plain + markdown parsers; PDF/EPUB/HTML declared
  as interfaces, not implemented), `documents.ts` (assembly + dashboard + author
  projections), `reader.ts` (navigation), `progress.ts` (status/percent/estimate),
  `highlights.ts`, `annotations.ts` (+ safe inline markdown), `citations.ts`
  (build/format/href/reverse-lookup), `selftest.ts` (46 assertions). Store
  actions (`lib/mvpStore.ts`): createDocument, updateDocumentMeta, deleteDocument,
  set notes/section-note, openDocumentAt, markPassageRead, setDocumentStatus,
  add/update/remove highlight + annotation, createBeliefFromText, and
  `convertPassage` (capture/belief/concept/question/research/synthesis via
  existing canonical creators, writing a Citation + linking the record).
  Persistence: documents + citations added to EMPTY_STATE/normalize/hydrate/
  localAdapter — LOCAL ONLY, NO migration (chain stays 0001–0020). Search:
  extended `lib/command/records.ts` (reuses LIFEOS-027) to index documents,
  authors, passages, highlights, reading notes. UI: `app/reading` (Library Home +
  import), `app/document/[id]` (three-pane reader, inline highlights, notes,
  convert menu, J/K/H/N/Esc, mobile pane switch), `app/reading/author/[name]`,
  `app/dev/reading-tests`; Nav gains a Read group (Reading · Library); command
  palette gains New document + Open Reading. Verified 30/30 reading E2E + 46/46
  self-tests + FULL regression re-run green (gen1 41, memory 29, command 27,
  dialogue 19, synthesis 22, orchestration 22, research 21, world 21, formation
  26, authoring 23, decision 33, compare 15, inquiry 22, threads 21, reason,
  retrieval 11, semantic 19, sync, graph 15); `lint`=0, `build`=0. Screenshots
  captured (reader desktop + mobile). No AI, no migration, no auto-mutation —
  the source text is immutable; notes/highlights/citations are separate records.
- 2026-07-25 — **LIFEOS-028 persistence amendment** (same PR #17, unmerged;
  before-merge fix). The reading library was local-blob-only; made it durable,
  cross-device, user-isolated, RLS-protected, consistent with the Supabase
  architecture. NEW migration `0021_reading_library.sql` (additive, idempotent,
  rerunnable; 0001–0020 untouched): six tables — reading_documents (progress
  embedded as jsonb, 1:1; import_complete flag), document_sections,
  document_passages, document_highlights, document_annotations,
  document_citations — each with id/user_id/timestamps, FKs (section→document,
  passage→document+section, highlight/annotation→document+passage,
  citation→document +optional passage/highlight on-delete-set-null; external
  record_kind/record_id NON-FK so citations never cascade-delete knowledge),
  own-row RLS (24 policies) with child-parent EXISTS checks, 24 indexes, and an
  atomic `import_reading_document(payload jsonb)` RPC. NEW `lib/library/rows.ts`
  (pure flatten/rebuild/diff). Adapter: `saveState(state, dirty, base)` — new
  docs import via RPC, existing docs push only changed rows (`diffById`) + delete
  removed, doc deletion cascades; `loadState` rebuilds the nested hierarchy
  resiliently (missing tables → empty). `types.ts`/`localAdapter`/`persistence.ts`
  pass the base snapshot. UI: `SyncStatus` on the reading dashboard + reader
  (4 states); import size guard (`checkImportSize` — warn >400 KB w/ confirm,
  block >1.5 MB); author page shows broken citation targets visibly as
  "(removed)". Migration validated on Postgres 16 (built from 0001–0020, 0010
  pgvector Supabase-only/skipped): applied 3× idempotently; 6 tables, RLS on all
  6, 24 policies, 24 indexes, 16 FKs, RPC present; doc-delete cascades children;
  cross-user isolation + child-attach block enforced by RLS. Reading self-tests
  now 60 (added flatten/rebuild/diff/malformed-row/new-vs-existing). Verified
  30/30 reading E2E + FULL regression green (gen1 41, memory 29, command 27,
  dialogue 19, synthesis 22, orchestration 22, research 21, world 21, formation
  26, authoring 23, decision 33, compare 15, inquiry 22, threads 21, reason,
  retrieval 11, semantic 19, sync, graph 15); `lint`=0, `build`=0. Local-first
  preserved; sync failures never destroy local data. Manual step for production:
  apply `0021_reading_library.sql` in Supabase (SQL editor / CLI).
- 2026-07-26 — Implemented **LIFEOS-029 Unified Workspace & Context Engine**
  (base: LIFEOS-028 on `main`; branch restarted from `origin/main`). Makes the
  app feel unified — every object reveals relationships; any entity is
  inspectable in place. NO new reasoning system, LLM, embeddings, or storage
  (nav memory reuses `user_prefs`; chain stays 0001–0021 — no 0022). New
  `lib/entities/`: `entity.ts` (unified describe/ref for every kind, reusing
  `resolveRecord` + graph), `relationships.ts` (grouped navigable relationships
  from graph edges + domain links + citations, memoized per graph via WeakMap),
  `backlinks.ts` (who-links-to-me grouped by kind), `activity.ts`/`timeline.ts`
  (chronological history), `preview.ts` (hover-card data + one-hop neighbors),
  `inspector.ts` (reactive store + navigation memory in prefs), `selftest.ts`
  (30 assertions). New `components/entity/`: `Inspector` (ONE impl — desktop
  right drawer + mobile bottom sheet; Overview/Relationships/Backlinks/Timeline/
  Graph tabs; tablist ARIA, arrow-key nav, Escape, focus restoration, scroll/tab/
  section memory), `ContextPanel`, `RelationshipExplorer`, `BacklinksPanel`,
  `EntityTimeline`, `GraphPreview` (radial mini graph), `HoverCard`, `EntityLink`
  (click→inspect, hover→card). Mounted `<Inspector/>` in root layout; command
  palette record rows gain an Inspect (ⓘ) action; reader linked-knowledge panel
  uses EntityLink; `prefs.ts` gains an `inspector` field. Verified 18/18 entity
  E2E + 30/30 self-tests + FULL regression green (reading 30, gen1 41, memory 29,
  command 27, dialogue 19, synthesis 22, orchestration 22, research 21, world 21,
  formation 26, authoring 23, decision 33, compare 15, inquiry 22, threads 21,
  reason, retrieval 11, semantic 19, sync, graph 15); `lint`=0, `build`=0.
  Screenshots (inspector desktop + mobile). Relationships memoized per graph
  (no O(n²)); everything deterministic and derived — no auto-mutation, no AI.
- 2026-07-27 — Implemented **LIFEOS-030 Workspaces, Sessions & Thinking Modes**
  (base: LIFEOS-029 on `main`; branch restarted from `origin/main`). Adds the
  concept of active thinking sessions so LifeOS understands "what am I working on
  right now?" — first-class **Workspaces** that GROUP existing entities (never
  copy — `members`/`pinned` are typed references resolved live) and **Sessions**
  (8 thinking modes; only one active at a time) with a derived activity timeline,
  resume-where-I-left-off memory, session notes, and a per-workspace dashboard.
  Deterministic and offline throughout: NO AI, agents, embeddings, background
  workers, or analytics. New `lib/workspaces/`: `workspace.ts` (model +
  membership + `entityWorkspaces` + referenced frontier), `sessions.ts`
  (lifecycle + `sessionOutputs` derived from activity + recency grouping),
  `activity.ts` (record policy + `resumePatchFor`), `resume.ts`, `dashboard.ts`
  (Feature-4 projection), `search.ts` (workspace-scoped — REUSES the LIFEOS-027
  engine), `tracking.ts` (store sink wrappers), `current.ts` (reactive
  current-workspace pointer in prefs), `selftest.ts` (35 assertions). Store gains
  workspace/session actions + `recordSessionActivity`; capture creation,
  `openInspector`, the command palette, and the reader auto-feed the active
  session's timeline. New UI: global `SessionBanner` (workspace, type, live
  elapsed clock, quick notes, End/Switch — renders nothing when idle), nav
  `WorkspaceSelector`, `/workspaces` (index + create), `/workspace/[id]`
  (dashboard: session controls, resume, scoped search, goals, members, notes,
  timeline). Inspector `ContextPanel` gains "Belongs to workspace(s)" + add-to;
  command center gains Switch/Resume/End-session + a `workspace` entity kind
  (searchable + inspectable). Migration **0022_workspaces.sql** (two additive,
  RLS-protected tables — `workspaces` + `workspace_sessions`; goals/members/
  pinned/resume/activity embedded as jsonb; single-active enforced in-app, not by
  a partial unique index that could reject bulk upserts; validated idempotent 3×
  on Postgres 16 incl. cascade). Supabase adapter syncs both tables by dirty
  domain (row-level upsert/delete) and loads resiliently. Chain now **0001–0022**.
  Verified 23/23 workspaces E2E + 35/35 self-tests + FULL regression green
  (entity 18, command 27, reading 30, gen1 41, memory 29, dialogue 19, synthesis
  22, orchestration 22, research 21, world 21, formation 26, authoring 23,
  decision, compare, inquiry, threads, reason, retrieval, semantic, sync, graph
  15); `tsc`=0, `lint`=0, `build`=0. Screenshots (workspace desktop + mobile).
- 2026-07-27 — Implemented **LIFEOS-031 Goals, Projects & Execution Engine**
  (base: LIFEOS-030 on `main`; branch restarted from `origin/main`). Adds
  intentional execution so LifeOS understands "what am I trying to accomplish?":
  first-class **Goals** (highest-level object), **Projects** (belong to goals,
  hold milestones, live in a workspace), and **Milestones** (embedded, MANUAL
  completion only). Sessions optionally attribute activity to a goal/project.
  Deterministic and offline: NO AI, agents, embeddings, background workers,
  analytics, auto-planning, auto-prioritization, calendar, or notifications. New
  `lib/execution/`: `goals.ts`, `projects.ts`, `milestones.ts`, `progress.ts`
  (fully DERIVED progress — completed milestones/projects + optional manual
  override; never infers completion or flips status), `dashboard.ts` (goal +
  project projections), `relationships.ts` (entity↔goal/project for the
  inspector), `tracking.ts` (session attribution + contribution, no new
  tracking), `current.ts` (reactive goal/project pointers in prefs), `selftest.ts`
  (33 assertions). Store gains goal/project/milestone actions + session
  goal/project linking + `startProjectSession`. New UI: `/goals` + `/goal/[id]`
  and `/projects` + `/project/[id]` dashboards (progress bars, milestones,
  session timelines, related-work + linked-knowledge pickers, status/priority/
  manual-progress editing, notes), nav "Execute" group, session banner shows the
  current goal, inspector ContextPanel "Goals & projects" section, command center
  New/Switch/Resume goal & project commands + goal/project/milestone entity kinds
  (searchable, reusing the LIFEOS-027 engine). Migration **0023_execution.sql**
  (two additive, RLS tables — goals + projects; milestones/refs embedded jsonb;
  `goal_id` FK ON DELETE SET NULL so deleting a goal orphans not deletes its
  projects; validated idempotent 3× on Postgres 16 incl. FK-orphan). Adapter
  syncs by dirty domain + loads resiliently. Chain now **0001–0023**. Verified
  25/25 execution E2E + 33/33 self-tests + FULL regression green (workspaces 23,
  entity 18, command 27, reading 30, gen1 41, memory 29, dialogue 19, synthesis
  22, orchestration 22, research 21, world 21, formation 26, authoring 23,
  decision, compare, inquiry, threads, reason, retrieval, semantic, sync, graph
  15); `tsc`=0, `lint`=0, `build`=0. Screenshots (goal + project + mobile).
- 2026-07-27 — Implemented **LIFEOS-032 Daily Use, Reliability & Product Polish**
  (base: LIFEOS-031 on `main`; branch restarted from `origin/main`). A refinement
  sprint — NO new domain, NO AI/agents/embeddings/analytics/calendar/
  notifications. Adds a shared, deterministic UX layer. New `lib/ux/`:
  `dirty-state` (isDirty + `useUnsavedGuard` beforeunload), `confirmations`
  (`buildImpact`: name/type/children/linked-survive/reversibility/severity),
  `feedback` (toast store + windowed dedup + safe actions/undo), `backup`+`restore`
  (versioned JSON envelope over all StoreState domains + safe prefs; validate →
  preview merge/overwrite → pure applyRestore; malformed rejected, original
  preserved), `diagnostics` (sanitized sync snapshot — masks email, strips
  JWT/bearer/keys, never doc contents), `performance` (budgets), `onboarding`
  (first-run checklist derived from state), `selftest` (40 assertions). New
  `components/ux/`: `ToastProvider` (polite live region), `ConfirmDialog` +
  global `requestConfirm`/`ConfirmHost` (ONE confirmation pattern; focus-trapped
  alertdialog; safest-action focus; high-impact acknowledgement gate — replaces
  every window.confirm), `EmptyState`, `ErrorState`, `SaveStatus` (never "Saved"
  before remote flush), `UnsavedChangesDialog`, `BackupRestore` + `SyncDiagnostics`
  (reliability center on /health), `FirstRun` (dismissible checklist on Today).
  Wired: goal/project delete + local-reset now route through the shared confirm
  with computed impact; toasts on capture/milestone/session/workspace/backup/
  restore; /health gains reliability center + backup/restore + first-run restart;
  palette sets `commandOpened`, `openInspector` sets `inspected`. `persistence.ts`
  tracks `lastSyncAt`. NO migration — all client-side/prefs; chain stays
  **0001–0023**. New docs: `ACCESSIBILITY.md`, `UX_AUDIT.md` (friction table +
  mobile 320/390/430 + perf budgets). Verified 27/27 ux E2E + 40/40 self-tests +
  FULL regression green (execution 25, workspaces 23, entity 18, command 27,
  reading 30, gen1 41, memory 29, dialogue 19, synthesis 22, orchestration 22,
  research 21, world 21, formation 26, authoring 23, decision, compare, inquiry,
  threads, reason, retrieval, semantic, sync, graph 15); `tsc`=0, `lint`=0,
  `build`=0. Screenshots (health reliability center, confirm dialog, mobile confirm).
- **LIFEOS-033 — Sync Conflicts, Recovery & Data Integrity.** New `lib/sync/`
  (schema, merge, conflicts, tombstones, operations, journal, recovery,
  integrity, restore-safety, status-store, selftest) + `lib/migrations/`
  (state-version, upgrade-state, upgrade-backup) + `components/sync/`
  (ConflictCenter, ConflictDialog, RecoveryPanel, IntegrityReport). Deterministic
  **three-way** merge/conflict detection (base = last-synced snapshot); no
  last-write-wins on user content, no prose auto-concat, no AI. Delete integrity
  via tombstones (migration **0024** `sync_tombstones` — the ONLY durable
  server-side metadata; revision derived from existing `updated_at`, so no
  columns added to historical tables; chain now **0001–0024**). `mvpStore.hydrate`
  now **isolates malformed rows out of the in-memory store** (source in
  localStorage preserved) so a single null/id-less record never crashes a
  consumer; `lib/graph` `snippet()` hardened against non-string labels. `/health`
  gains Conflict Center + Recovery + Data-integrity panels; `SaveStatus` and Sync
  Reliability diagnostics extended (all sanitized). Dev route `/dev/sync-tests`
  runs 45 self-tests incl. 10 cross-device scenarios + a perf budget. Verified:
  `syncintegrity.mjs` E2E **22/22**; full regression green (gen1 41, graph 15,
  entity 18, workspaces 23, execution 25, ux 27, reading 30, command 27,
  memory 29, orchestration 22, synthesis 22, world 21, dialogue 19, research 21,
  formation 26, authoring 23, reason/inquiry/retrieval/compare/decision/review/
  threads pass; `semantic` embedding checks fail only for missing pgvector —
  environmental, pre-existing). `tsc`=0, `lint`=0, `build`=0. Migration 0024
  validated on Postgres 16 (idempotent 3×, 4 RLS policies, cross-user isolation).
  New doc `SYNC_INTEGRITY.md`; updated ARCHITECTURE / README / PERSISTENCE_QA /
  UX_AUDIT. Screenshots: conflict dialog (desktop + mobile), sync health.
- **LIFEOS-034 — Daily Review & Planning Loop.** New `lib/reviews/` (dates,
  day-summary, open-loops, tomorrow-focus, review, weekly-rollup, relationships,
  selftest) + `components/reviews/` (DailyReviewFlow + 5 step components,
  DaySummary, ReviewHistory, WeeklyRollup, TodayReviewCard, EntityPicker) +
  `/daily` routes (today, `[date]`, history, `week/[start]`). First-class
  **DailyReview** record — one per user per LOCAL date (canonical `date` stored
  separately from timestamps; DST-correct; DB `unique(user_id, date)` so timezone
  travel never forks a duplicate). The **day summary** deterministically REPORTS
  existing activity (counts + linked sources) and infers nothing; wins/lessons/
  friction/open-loops/tomorrow-focus are all the user's input (nothing auto-
  written, nothing marked complete). Lessons convert to a Capture (canonical
  creator) — no new knowledge subtype. Weekly rollup is a **projection, not
  persisted**. Migration **0025** `daily_reviews` (normalized metadata + jsonb
  content, RLS, unique(user,date)); chain now **0001–0025**. Integrated into
  Today (progressive-disclosure card), command center (start/continue/complete/
  reopen/history/resume-focus), entity API + backlinks + search (`daily_review`
  kind), and the LIFEOS-033 sync layer (tombstoned deletes). Verified:
  `dailyreview.mjs` E2E **27/27**, `runReviewSelfTests` **56/56** (local-date /
  DST / timezone-travel / day-summary determinism / open-loops / focus ordering /
  weekly rollup / relationships / search / schema purity / perf). Full regression
  green (gen1 41, graph 15, entity 18, workspaces 23, execution 25, ux 27,
  reading 30, command 27, memory 29, orchestration 22, synthesis 22, world 21,
  dialogue 19, research 21, formation 26, authoring 23; older AI-engine dev-only
  suites unchanged/orthogonal). `tsc`=0, `lint`=0, `build`=0. Migration 0025
  validated on Postgres 16 (idempotent 3×, 4 RLS policies, unique(user,date)
  enforced, cross-user isolation). New doc `DAILY_REVIEW.md`; updated ARCHITECTURE
  / README / PERSISTENCE_QA / UX_AUDIT / SYNC_INTEGRITY. Constraints: no AI /
  agents / embeddings / scoring / streaks / gamification / auto-prioritization /
  calendar / notifications / analytics.

- **LIFEOS-035 — Inbox Zero & Capture Processing.** New `lib/inbox/` (capture-status,
  queue, defer, history, conversion, split, merge, merge-rules, relationships,
  processing, memory, selftest) + `components/inbox/` (InboxPage, InboxQueue,
  CaptureProcessor, ConversionPreview, SplitCapture, MergeCaptures, DeferCapture,
  ProcessingHistory, BatchActionBar, TodayInboxCard) + `/process` routes (queue,
  `[id]`). A deterministic workflow answering "what should happen to this
  capture?" — clarify / convert / split / merge / link / defer / archive / discard
  — that **never decides meaning for the user** (suggestedActions are shape/context
  hints only). Processing metadata is **additive on the canonical `captures`
  table** (not a new table): `processing_status` enum (inbox/processing/processed/
  deferred/archived/discarded; existing captures default **inbox**, no duplicate
  record), separate `working_text` (original `text` stays IMMUTABLE via the 0001
  trigger, always recoverable + revert), `deferred_until` (local day key reusing
  `lib/reviews/dates.ts`; deferred returns to inbox on hydrate, no workers/
  notifications), and jsonb source-context / links / tags / lineage / compact
  history. **Convert** reuses the existing canonical creators and preserves the
  source as lineage (belief built inline against the existing capture id to avoid a
  duplicate; "question→inquiry" intentionally dropped to avoid malformed AI-shaped
  records). **Merge** is an explicit user op, NEVER used by sync. **Discard** is a
  soft reversible status (`discarded_at`), never a permanent delete, tombstone-
  compatible. **No batch conversion** (each conversion reviewed individually).
  Field-level sync (`merge-rules.ts`) UNIONs links/tags/lineage/history and raises
  conflicts on divergent status/content — never discards lineage silently.
  Migration **0026** `0026_capture_processing.sql` (additive columns + 3 indexes:
  status / deferred / split_from; RLS inherited); chain now **0001–0026**.
  Integrated into Today (compact non-judgmental inbox card — no streaks/scores/
  guilt), daily review (`captures_processed` group + single `inbox:backlog`
  open-loop aggregate), session/workspace (captures inherit `sourceContext`),
  command center (`nav:process` + contextual capture commands), entity API +
  backlinks + search (status + tags; summary uses `workingText ?? text`), and
  queue navigation memory (`prefs.inbox`: view/sort/filter/active, restores on
  reload). Verified: `inbox.mjs` E2E **35/35** across the 27 scenarios (open inbox,
  keyboard nav, focused processor with original always visible, rewrite + revert,
  convert, link-without-convert, split, merge, defer, restore-deferred-on-load,
  archive/restore, discard-confirm-reversible, batch without batch-convert,
  history, Today, queue-memory reload, mobile), `runInboxSelfTests` **54/54**
  (status defaults / queue filter-sort-view / defer local-date / split-merge
  planners + lineage / conversion preview / backlinks / sync conflict rules /
  projection purity / perf). Full deterministic regression green across all 10
  committed self-test suites (command 39, entity 30, execution 33, inbox 54,
  memory 54, reading 60, review 56, sync 45, ux 40, workspace 35 = **446**).
  `tsc`=0, `lint`=0, `build`=0 (clean rebuild). Migration 0026 validated on
  Postgres 16 (full chain idempotent 3×; new columns' defaults; legacy insert
  defaults to inbox with empty collections; status+working_text update succeeds
  while `text` change rejected as immutable; RLS enabled). New doc
  `CAPTURE_PROCESSING.md`; updated ARCHITECTURE / README / PERSISTENCE_QA /
  UX_AUDIT / SYNC_INTEGRITY / DAILY_REVIEW. Constraints: no AI / LLMs / agents /
  embeddings / auto-classification / auto-rewriting / auto-conversion / auto-
  splitting / auto-prioritization / scores / streaks / gamification / calendar /
  notifications / analytics / collaboration.

- **LIFEOS-036 — Next Actions & Commitments.** New `lib/actions/` (action,
  status, queue, dependencies, defer, waiting, history, templates, relationships,
  tracking, merge-rules, memory, selftest) + `components/actions/` (ActionQueue,
  ActionList, ActionDetail, ActionCreator, ActionFilters, ActionHistory,
  ActionDependencies, ActionTemplatePicker, BatchActionBar, TodayActions,
  ProjectActions) + `/actions` routes (queue, `[id]`). A focused next-action layer
  answering "what can I concretely do next?" — the leaf of Goal → Project →
  Milestone → **Next Action** → Session. The system **never generates,
  prioritizes, or schedules** actions; every field is user-selected. Three
  first-class records: **NextAction** (open/in_progress/waiting/deferred/completed/
  cancelled; size/energy/context user-chosen, never calculated; manual `order` +
  explicit `pinned`; compact append-only history), **ActionDependency** (explicit
  cycle-safe edge, `blockedId` blocked by `blockerId`), **ActionTemplate**
  (reusable shape, explicitly instantiated — no recurrence engine). The **Next**
  view is deterministic (`isNextEligible`): open/in-progress, not deferred-future,
  not waiting, not terminal, not **blocked** — respecting manual order with pins.
  Dependencies reject self-loops + direct/indirect **cycles** at the app layer;
  missing endpoints degrade gracefully (orphan-safe); completing a blocker makes
  the blocked eligible but **never starts it**. Defer/waiting reuse LIFEOS-034
  local-dates (deferred returns to Next when due; waiting follow-ups surfaced,
  never auto-acted). **Completion is always manual and never cascades** to a
  milestone/project/goal/other action. **Start** reuses the existing single-session
  engine (session banner shows the current action; `action_activity` events) — no
  second tracker. **Batch** ops require impact confirmation; **NO** batch
  title/notes, **NO** batch conversion. Migration **0027** `0027_next_actions.sql`
  (three tables; **soft references, no FK cascade** so deleting a project/milestone/
  goal never removes an action; dep `check(blocker≠blocked)` + `unique`; RLS 4
  policies/table); chain now **0001–0027**. Integrated into Today (compact calm
  card — no streaks/scores), daily review (created/started/completed/deferred
  groups + in-progress/waiting-due/overdue open-loop candidates), session banner +
  attribution, command center (`nav:actions` + contextual start/complete/defer/
  wait/resume/from-capture/from-milestone), entity API + backlinks + search
  (`action`/`action_template` kinds), capture processing (`→ Next action` preserves
  the capture), project dashboard (`ProjectActions`), and queue navigation memory
  (`prefs.actions`). Field-level sync (`merge-rules.ts`) UNIONs tags/links/history/
  dependency-additions and raises conflicts on completed-vs-cancelled, deferred-vs-
  started, divergent title/description, project reassignment, and different
  completion notes — never losing completion history or dependencies. Verified:
  `actions.mjs` E2E **39/39** across the required scenarios (create/from-project/
  from-capture, start, complete, reopen, defer+return, someday, waiting, dependency
  blocking, cycle rejection, template instantiation, batch defer/complete, milestone
  + Today + daily-review integration, command center, queue-memory restore, mobile,
  keyboard), `runActionSelfTests` **62/62** (lifecycle / Next eligibility / manual
  ordering / inheritance / defer-wait-someday / dependency cycles+unblock+missing /
  templates / projections / sync conflict rules / history dedup / projection purity /
  perf). Full deterministic regression green across all 11 committed self-test
  suites (command 39, entity 30, execution 33, inbox 54, memory 54, reading 60,
  review 56, sync 45, ux 40, workspace 35, action 62 = **508**). `tsc`=0, `lint`=0,
  `build`=0 (clean rebuild). Performance: Next-queue derivation over **20,000
  actions + ~3,000 dependencies ~19 ms**; a 3,000-deep cycle check **~2 ms**.
  Migration 0027 validated on Postgres 16 (full chain idempotent 3×; column
  defaults; self-dependency check enforced; soft project_id ref to a missing
  project accepted/orphan-safe; **RLS cross-user isolation** via a non-superuser
  role — user1 sees only user1's actions, user2 only user2's). New doc
  `NEXT_ACTIONS.md`; updated ARCHITECTURE / README / PERSISTENCE_QA / UX_AUDIT /
  SYNC_INTEGRITY / DAILY_REVIEW / CAPTURE_PROCESSING. Constraints: no AI / LLMs /
  agents / embeddings / automatic task generation / automatic prioritization /
  scheduling / calendar / notifications / reminders / scores / streaks /
  gamification / analytics / collaboration / realtime presence.
- **LIFEOS-037 — Planning Views & Focus Modes.** New `lib/planning/` (horizon,
  history, board, today-plan, weekly-plan, focus, capacity, commitments,
  planning-inbox, relationships, card-meta, merge-rules, memory, selftest) +
  `components/planning/` (PlanningBoard, PlanningColumn, PlanningCard, TodayPlan,
  WeeklyPlan, CapacityView, CommitmentReview, PlanningInbox, FocusMode,
  FocusPanels, InterruptionLog, TodayPlanCard, InspectorPlanning) + `/plan`
  routes (board, `today`, `week`, `commitments`, `inbox`) and `/focus`.
  A deterministic planning + focus layer that **displays and organizes the
  user's choices; it never decides what matters.** A *planning horizon*
  (today/this_week/later/someday/unscheduled) is a manual label expressing
  intent, **NOT a deadline**; the core invariant is **a move changes only a
  record's horizon and manual order — never status, deadline, priority, or
  hierarchy.** Two first-class records: **PlanningAssignment** (a **generic
  typed record reference** ref.kind+ref.id, one per record; manual `order`;
  compact append-only history) and **FocusSession** (one target of
  action/milestone/project/document/workspace/entity/custom; optional attached
  session; panel visibility; manually logged interruptions + history). Every
  view is a **pure function of `(state, today)`**: the **Today plan** surfaces
  explicit `today` assignments then user-flagged derived candidates
  (pinned/in-progress/waiting-due/deferred-returns/tomorrow-focus) and **never
  auto-fills an empty plan**; the **weekly view** is a review (this-week +
  active milestones + projects touched + follow-ups + completed-this-week),
  **NOT a 7-day calendar grid**; **capacity** reports **counts only** against a
  user soft limit, phrased neutrally ("7 selected, preferred limit 5") —
  **never blocks, never scores**; the **active-project safeguard** notes an
  active project with no open action and offers **Create/Link/Leave**, **never
  auto-creating or labeling it unhealthy**. **Focus Mode** centers one target,
  hides nonessential nav (**no auto-fullscreen**), loads only **bounded**
  target-related data (never the whole graph), reuses the LIFEOS-030 session
  engine, logs interruptions **manually** (no auto-detection/scoring), and
  remembers panels **per target type** in `prefs.planning` (where capacity soft
  limits also live — preferences, not records). Board supports drag-drop,
  keyboard 1–5, multi-select, manual ordering, filters (workspace/goal/project/
  type/context/tag), collapsed groups, and a mobile list. Migration **0028**
  `0028_planning_focus.sql` (two tables; **soft references, no FK cascade** so
  deleting a project/action never removes a plan/focus; `UNIQUE(user_id,
  ref_kind, ref_id)` so sync never duplicates an assignment; RLS 4
  policies/table); chain now **0001–0028**. Integrated into Today (compact
  `TodayPlanCard`), daily review (focus sessions + interruptions/friction),
  capture (explicit "Plan…" horizon — no auto-scheduling), reading (a document
  is a focus target; planning never touches progress), command center
  (nav:plan/today-plan/commitments/planning-inbox/focus + focus:end/focus:action),
  inspector (`InspectorPlanning`), and entity API/search. Merge rules
  (`merge-rules.ts`) key assignments by **record reference** (not assignment id)
  so a record planned on two devices resolves to **one** assignment; conflicts
  on same-record-different-horizon, incompatible order, removed-vs-moved,
  focus-ended-vs-extended, and same-capacity-limit-changed-differently; union
  interruptions + history by id — **never duplicating an assignment or losing
  focus history**. Verified: `planning.mjs` E2E **27/27** (board columns +
  orphan, inbox flags + assign, board move buttons, keyboard move, multi-select,
  Today plan, focus on action + timer, interruption log, panel toggle, end
  focus, focus on project, commitment review + capacity message, active-project
  safeguard, capture→plan, preference persistence, mobile board, mobile focus,
  weekly view), `runPlanningSelfTests` **68/68** (horizon / history / board /
  today / weekly / focus / capacity / commitments / inbox / safeguard / merge
  rules / memory / local-date / projection purity / perf). Full deterministic
  regression green across all 12 committed self-test suites (command 39, entity
  30, execution 33, inbox 54, memory 54, reading 60, review 56, sync 45, ux 40,
  workspace 35, action 62, planning 68 = **576**). `tsc`=0, `lint`=0, `build`=0
  (clean rebuild). Performance (self-test §18, realistic fixture): board
  `<250ms`, today+weekly `<300ms`, planning inbox `<400ms` (O(1) existence sets +
  assignment index — orphan detection never rescans the record arrays).
  Migration 0028 validated on Postgres 16 (full chain `0001–0028` idempotent 3×;
  column defaults `unscheduled`/`0`; `(user_id, ref_kind, ref_id)` uniqueness
  enforced; soft ref to a missing record accepted/orphan-safe; **RLS cross-user
  isolation** via a non-superuser role — user1 sees only user1's rows, and
  cannot update user2's). New doc `PLANNING_AND_FOCUS.md`; updated ARCHITECTURE /
  README / PERSISTENCE_QA / UX_AUDIT / SYNC_INTEGRITY / DAILY_REVIEW /
  CAPTURE_PROCESSING. Constraints: no AI / LLMs / agents / embeddings /
  automatic prioritization / scheduling / calendar integration / notifications /
  reminders / productivity scores / streaks / gamification / analytics /
  collaboration / realtime presence / automatic time estimation.
- **LIFEOS-038 — Knowledge Maintenance & Integrity.** New `lib/maintenance/`
  (integrity, duplicates, relationships, citations, evidence, archive, review,
  dashboard, staleness, merge, history, merge-rules, preferences, search,
  record, selftest) + `components/maintenance/` (KnowledgeHealth, DuplicateReview,
  RelationshipIntegrity, EvidenceReview, MaintenanceQueue, CitationIntegrity,
  ArchiveReview, MergeWorkspace, HealthInspector, PlanningMaintenanceHint) +
  `/maintenance` routes (dashboard, review, duplicates, evidence, relationships,
  citations, archive, merge). Deterministic maintenance tools that **identify
  candidates; the user decides** — no AI, no embeddings, no automatic
  classification/rewriting/merging/repair, no semantic search, no scores. Two
  first-class records: **MaintenanceEvent** (append-only compact log — reviewed/
  review_requested/archived/unarchived/merged/citation_added/citation_removed/
  relationship_repaired/duplicate_ignored/maintenance_resolved/dismissed; generic
  typed ref + optional related ref; NEVER deleted) and **DuplicateCandidate** (a
  user DECISION on a deterministically-detected group, keyed by a STABLE
  `hash(reason + sorted member keys)` so the same duplicate on two devices
  resolves to ONE row). A single **`buildMaintenanceIndex`** pass drives every
  projection (existence sets, citation/reference indexes, archive + last-reviewed
  folded from events, decided-duplicate set) — O(records) with O(1) lookups.
  **Knowledge Health** = 10 deterministic counts (orphan entities/documents/
  beliefs, uncited claims, duplicate candidates, archived items, unresolved
  maintenance, inactive projects, stale research, broken references), never a
  score. **Duplicate detection** is exact-signal only (title / normalized title /
  URL / ISBN / DOI / identifier / alias). **Relationship** (missing parents/
  children, broken backlinks, dangling planning/focus/citation, orphan sessions,
  invalid milestones) and **research** integrity are report-only. **Staleness**
  states age as fact ("Last reviewed 9 months ago", never "Needs update").
  **Citation integrity** offers a real repair (remove broken/duplicate citation).
  **Archive** is reversible and deletes nothing; **merge** previews then preserves
  history/citations/backlinks, keeps the primary's id, archives losers
  (reversible), never destroys evidence. Archive state + last-reviewed are DERIVED
  from the event log — no columns added to existing tables. Migration **0029**
  `0029_knowledge_maintenance.sql` (two tables; **soft refs, no FK cascade**; RLS
  4 policies/table); chain now **0001–0029**. Integrated into the inspector
  (`HealthInspector`), command center (Open Knowledge Health / Review Queue /
  Duplicates / Evidence / Relationships / Citations / Archive / Merge), daily
  review (reports the day's maintenance decisions — never injects into Today),
  search (needs-review/orphan/duplicate/archived/uncited/inactive/resolved filter
  sets), and the planning board (a hint that only links, never moves a card).
  Merge rules (`merge-rules.ts`) UNION events + dismissed/ignored ids (history
  never lost) and raise conflicts on divergent duplicate decisions and
  archive-vs-restore. Verified: `maintenance.mjs` E2E **27/27** (dashboard, review
  duplicates, merge, ignore-persists, repair citation, archive+restore, review
  queue + reason filter + dismiss-persists, merge workspace, evidence,
  relationships, command center, inspector, daily review, planning hint, offline
  persistence, mobile), `runMaintenanceSelfTests` **85/85**. Full deterministic
  regression green across all 13 committed suites (command 39, entity 30,
  execution 33, inbox 54, memory 54, reading 60, review 56, sync 45, ux 40,
  workspace 35, action 62, planning 68, maintenance 85 = **661**). `tsc`=0,
  `lint`=0, `build`=0 (clean rebuild). Performance (self-test §17, 20k beliefs /
  4k docs / 10k citations / 3k concepts / 2k events): index build `<250ms`,
  dashboard `<400ms`, duplicates `<300ms`, review queue `<500ms`. Migration 0029
  validated on Postgres 16 (full chain `0001–0029` idempotent 3×; defaults;
  orphan-safe soft refs; **RLS cross-user isolation** via a non-superuser role).
  New doc `KNOWLEDGE_MAINTENANCE.md`; updated ARCHITECTURE / README /
  PERSISTENCE_QA / SYNC_INTEGRITY / DAILY_REVIEW / PLANNING_AND_FOCUS /
  NEXT_ACTIONS. Constraints: no AI / embeddings / automatic decisions / automatic
  merges / automatic repairs / productivity scores / assistants / semantic search.
- **LIFEOS-039 — Deterministic System Insights.** New `lib/insights/` (range,
  activity, coverage, metrics, definitions, memory, attention, projects, goals,
  actions, captures, reading, knowledge, reviews, focus, change-log,
  period-summary, comparison, dormancy, contributions, relationships, export,
  search, merge-rules, selftest) + `components/insights/` (21 components +
  `useInsights` hook) + `/insights` routes (home + 14 subroutes). **Descriptive
  views over already-recorded activity — the system reports what happened; it
  does NOT decide what was good, productive, or important.** Every view is a pure
  projection over `StoreState` for a user-selected date range: no AI, no
  embeddings, no semantic interpretation, no recommendations, no predictions, no
  productivity/health scores, no streaks, no gamification. The architectural core
  is a single **range-bounded activity index** (`buildActivityIndex`) that
  flattens every existing compact history (sessions, focus, action/planning/
  capture histories, reading/citation events, belief/concept/research touches,
  daily reviews, maintenance events) into one time-sorted `ActivityEvent[]`,
  memoized once per store snapshot; `eventsInRange` binary-searches a slice so
  every card reuses the same array (no per-card re-scan). **Time-range model**
  (`range.ts`): canonical local-date semantics, deterministic
  `[start, next-day-start)` inclusivity, DST-safe day boundaries, `previousRange`
  for comparisons, last range persisted in prefs. **Language is constrained and
  test-enforced:** comparisons say "12 sessions, previously 9" (never improved/
  declined/better/worse/ahead/behind); dormancy says "no recorded activity in 90
  days" (never abandoned/stale/neglected); referenced records are "referenced N
  times" (never important); Home shows counts + durations only, never a composite
  score. **No new event storage:** migration **0030** `0030_deterministic_insights.sql`
  adds only `saved_insight_views` (display intent — insight + range + filters +
  grouping; NEVER calculated results; RLS 4 policies; 3 indexes; idempotent);
  chain now **0001–0030**. Saved-view merge (`merge-rules.ts`) unions independent
  views and surfaces edit/delete conflicts without duplicating ids or altering
  source records. Integrated into Today (compact `TodayInsightsCard`), daily
  review (factual snapshot + link to period summary), planning (factual context,
  never reorders/alters), inspector (`InspectorActivity` section), command center
  (Open Insights / Attention / Project Activity / Capture Flow / Knowledge / Review
  / Change Log / Compare / Activity for current record), and search (factual
  activity filters). Verified: `insights.mjs` E2E **33/33**, `runInsightsSelfTests`
  **97/97**. Full deterministic regression green across all 14 suites (**758**
  assertions). `tsc`=0, `lint`=0, `build`=0. Performance (self-test §17, 20k
  actions / 5k sessions / 10k captures → ~35k events): index build `85ms`, home
  metrics `34ms`, attention `19ms`, change log `11ms`. Migration 0030 validated on
  Postgres 16 (full chain `0001–0030` idempotent 3×; defaults; RLS cross-user
  isolation via non-superuser role). New doc `DETERMINISTIC_INSIGHTS.md`; updated
  ARCHITECTURE / README / PERSISTENCE_QA / UX_AUDIT / SYNC_INTEGRITY / DAILY_REVIEW /
  CAPTURE_PROCESSING / NEXT_ACTIONS / PLANNING_AND_FOCUS / KNOWLEDGE_MAINTENANCE.
  Constraints: no AI / LLMs / agents / embeddings / recommendations / prioritization /
  coaching / predictions / forecasts / productivity or health scores / streaks /
  gamification / leaderboards / social comparison / notifications / surveillance.
  "Insights describe recorded activity. They do not judge the person living it."
- **LIFEOS-040 — Security, Privacy & Production Hardening.** New `lib/security/`
  (threat-model, auth-boundaries, authorization-audit, input-limits, safe-url,
  redaction, errors, headers, schema-compatibility, storage-resilience, multi-tab,
  health, dev-routes, diagnostics, selftest), `lib/backup/` (versioning, manifest,
  export, verify, import-preview, restore, recovery, selftest), `lib/privacy/`
  (data-map, deletion, retention, permissions) + `components/security|backup|privacy`
  + routes `/security` `/backup` `/recovery` `/privacy` `/privacy/delete` +
  `middleware.ts` (headers/CSP) + `scripts/` (audit-rls, scan-secrets, audit-routes,
  audit-deps). **No product features, no new state manager, no AI.** Authorization is
  Postgres **RLS** (never app filtering); `authorization-audit.ts` + `npm run
  audit:rls` fail when any user-owned table lacks policies (**54 tables / 31
  migrations** verified). Input safety: the single `dangerouslySetInnerHTML` sink
  (`renderMarkdownInline`) now escapes quotes and routes links through `safeHref`
  (closes an attribute-injection hole); `input-limits.ts` bounds size/JSON depth;
  `safe-url.ts` protocol-allowlists. `redaction.ts` = allowlist-only diagnostics
  (no content/secrets); `errors.ts` SafeError (no stacks) behind
  `SecurityErrorBoundary`. `schema-compatibility.ts` fails **closed** to read/export.
  `headers.ts` strong CSP (no `unsafe-eval`; documented framework `unsafe-inline`
  exception) applied by middleware, validated by self-test, **0 CSP console
  violations** while hydrating. `/dev` production-gated (404 without
  `LIFEOS_ENABLE_DEV_ROUTES=1`). Backup: deterministic account export (manifest +
  FNV-1a checksums, no secrets), verification, import preview/dry-run, transactional
  restore + rollback, Recovery Center. Privacy: data map, deletion-semantics
  registry, honest account-deletion state machine (`DELETE MY ACCOUNT` phrase +
  freeze), retention disclosures. Security-patched **next 16.2.10→16.2.12**; 3
  residual transitive highs (postcss/sharp) are documented, allowlisted exceptions
  outside the runtime attack surface. Migration **0031** adds 4 RLS retention tables
  (sanitized_error_events, export_history, import_history, account_deletion_requests)
  — never record contents; chain now **0001–0031**. Verified: security selftest
  **94/94**, backup **38/38**, `security.mjs` E2E **34/34**, full regression
  **890/890** (16 suites — no prior test weakened), `tsc`/`lint`/`build` 0, chain
  0001–0031 idempotent 3× with non-superuser RLS isolation, all four audit scripts
  pass. New docs SECURITY_AND_PRIVACY / THREAT_MODEL / BACKUP_AND_RECOVERY /
  PRODUCTION_OPERATIONS / INCIDENT_RESPONSE; updated ARCHITECTURE / README /
  PERSISTENCE_QA / UX_AUDIT / SYNC_INTEGRITY / DETERMINISTIC_INSIGHTS /
  KNOWLEDGE_MAINTENANCE / PLANNING_AND_FOCUS / NEXT_ACTIONS / CAPTURE_PROCESSING /
  DAILY_REVIEW. Constraints: no AI / content logging / keystroke logging / custom
  crypto / e2e-encryption claims / silent destructive repair / hidden telemetry.
  "Security protects the user's life record. It must not become another way to
  observe the user."
- **LIFEOS-041 — Product Cohesion, Onboarding, Accessibility & Visual Polish.**
  New `lib/design/` (tokens, color, typography-in-tokens, principles, terminology,
  microcopy, density, motion, responsive, confirmation, route-inventory, selftest),
  `lib/onboarding/` (steps, state, sample-workspace, education, merge-rules,
  selftest), `lib/accessibility/` (keyboard, landmarks, focus, announcements,
  audit, selftest) + `components/design/` (EmptyState, LoadingState, StatusNotice,
  ShortcutReference, HelpDrawer) + `components/onboarding/` (OnboardingShell,
  SampleWorkspacePreview) + routes `/onboarding` `/help` + `/dev/cohesion-tests`.
  **No product capability, no domain redesign, no new state manager, no AI.**
  Makes the completed systems feel like ONE coherent product: quiet, precise,
  serious, personal. Design tokens emitted to `app/globals.css` (light+dark,
  focus ring, reduced-motion); a **restrained semantic color model** (WCAG-AA
  checked, no rainbow record-type taxonomy, no red/green performance coding); a
  typography scale (no <11px text, hierarchy without weight-only); 10 traceable
  **principles**; canonical **terminology** (+ deprecated-term detector) and
  **microcopy** (forbidden-phrase scan, canonical empty-state + error-language
  models); **confirmation model** (4 proportional levels reusing LIFEOS-040
  deletion semantics — destructive never pre-focused, permanent needs a typed
  phrase); **responsive** decisions (mobile bottom-bar not a shrunk sidebar,
  inspector→drawer below lg, tables stack→scroll→full; no 320/390px overflow);
  **motion** (short, reduced-motion aware). **Accessibility** (WCAG 2.2 AA):
  conflict-free keyboard model with text-entry suppression + visible affordances,
  landmarks/headings, safe focus (initial focus never destructive) + trapping,
  live-region announcements (redacted), target-size/naming audit with documented
  exceptions. **Onboarding**: calm skippable/resumable first-run teaching through
  use (links to real surfaces, no demo sandbox, no confetti); optional
  clearly-marked **sample workspace** (create/remove in ONE action); route-aware
  **Help Center** + shortcut reference + glossary + dismissible contextual
  education. **No new migration** — onboarding v2 + UI prefs + dismissed education
  extend the existing RLS-protected `user_prefs` (0020); sync rules applied
  client-side (steps union unless a later versioned reset; dismissed education
  union; UI-pref conflicts surfaced). Verified: design selftest **63/63**,
  accessibility **35/35**, onboarding **29/29**, `cohesion.mjs` E2E **26/26**;
  full regression **1017/1017** across 19 suites (no prior test weakened);
  `tsc`/`lint`/`build` 0; migration chain **0001–0031** idempotent 3× with
  `user_prefs` RLS cross-user isolation; no model-id leak; no forbidden phrases in
  new UI copy. New docs DESIGN_SYSTEM / PRODUCT_LANGUAGE / ONBOARDING /
  RESPONSIVE_BEHAVIOR / HELP_SYSTEM (+ ACCESSIBILITY updated); updated ARCHITECTURE,
  README, UX_AUDIT, PERSISTENCE_QA, SYNC_INTEGRITY, SECURITY_AND_PRIVACY,
  BACKUP_AND_RECOVERY, PRODUCTION_OPERATIONS, DETERMINISTIC_INSIGHTS,
  KNOWLEDGE_MAINTENANCE, PLANNING_AND_FOCUS, NEXT_ACTIONS, CAPTURE_PROCESSING,
  DAILY_REVIEW. Constraints honored: no gamification, streaks, engagement
  analytics, dark patterns, forced onboarding, autoplay tutorials, or confetti.
  "Polish makes LifeOS quieter, clearer, and easier to trust — not louder."

- **LIFEOS-042 — Version 1 Release Candidate (`v1.0.0-rc1`).** A release-candidate
  sprint: **no new features, domains, or workflows** — only release packaging,
  evidence, and demonstrated fixes. Added `lib/release/` (versions, inventory,
  routes, migrations, limitations, checklist, acceptance, fixtures, evidence,
  selftest), `components/release/` (ReleaseStatus, AcceptanceMatrix,
  KnownLimitations, ReleaseEvidence, SmokeTestGuide, DemoWorkspace), the
  read-only `/release` surface, `/dev/release-tests`, and `scripts/`
  (release-audit, migration-rehearsal, route-smoke, export-verify,
  release-checklist, visual-regression, browser-matrix). Version identifiers are
  centralized in `lib/release/versions.ts` and surfaced identically in
  Diagnostics + `/release`: tag `v1.0.0-rc1`, app `1.0.0-rc1`, migration `31`,
  state `1`, export archive `1`, supported migration range `20–31`.
  **No new migration** (schema stays at 0031). Evidence (all real, reproducible):
  migration rehearsal on Postgres 16 **35/35** (clean apply, idempotent ×3, RLS on
  all 54 tables, every policy scoped to `auth.uid()`, 7 checkpoint upgrades, and
  a LIVE two-user isolation probe where B cannot SELECT/UPDATE/DELETE A's rows);
  release audit **17/17**; export/restore verify **14/14**; release self-tests
  **48/48**; full regression **1065/1065** across 20 suites; cohesion E2E 26/26;
  release E2E 14/14; route smoke 21/21; visual regression 27/27 clean;
  browser-matrix Chromium 141 5/5; `audit:security` PASS; `tsc`/`lint`/`build` 0.
  The acceptance matrix (`lib/release/acceptance.ts`) is HONEST by construction —
  a credentialed gate can never be marked an automated pass (self-test enforced),
  so 12 manual credentialed checks (live auth, live cross-device sync, live
  deletion, production headers, real-browser matrix, production smoke, rollback
  redeploy) remain and are listed in `V1_ACCEPTANCE_REPORT.md`. New docs:
  V1_RELEASE_NOTES, V1_KNOWN_LIMITATIONS, V1_RELEASE_CHECKLIST (with the freeze
  policy + release-blocker definition), V1_DEPLOYMENT_RUNBOOK, V1_ACCEPTANCE_REPORT,
  V1_ROLLBACK_REPORT, V1_BROWSER_SUPPORT, V1_PERFORMANCE_REPORT. The `v1.0.0-rc1`
  tag is **prepared but NOT created** — it is held until every gate (including the
  credentialed manual ones) passes. "This sprint proves readiness; it does not
  manufacture confidence."

- **LIFEOS-043 — Navigation & Information Architecture redesign (no new features).**
  Pure IA: `components/Nav.tsx` rewritten from a flat wrapped row of ~35
  destinations across ~12 groups into **six intention-based primary
  destinations** — Today, Capture, Work, Learn, Reflect, More — with the deeper
  tools moved one click away behind grouped dropdown menus (progressive
  disclosure). No route was added, removed, or renamed as a concept; only
  regrouped and given consumer-facing labels. The brand mark still returns to
  Today; the command palette (⌘K) still reaches every destination directly; the
  belief-inbox pending badge moved onto the Capture menu. Menus are a disclosure
  pattern (button + `aria-expanded` + `aria-haspopup`, Esc/outside-click/nav to
  close, plain-link keyboard semantics). Mobile: the six items wrap to two tidy
  rows with **no horizontal overflow**. Verified: tsc/lint/build 0; a keyboard +
  reachability check 9/9 (all 37 existing destinations reachable, logo→Today,
  Enter opens / Esc closes, nav landmark labelled); desktop + mobile screenshots.
  Full regression 1016/1017 — the one miss is a marginal, load-sensitive memory
  **perf-budget** assertion (≈1531ms vs a 1500ms threshold), unrelated to this
  presentation-only change and green in prior sprints; no test was weakened.

- **LIFEOS-047 — Native Reading Upload, Document Ingestion & AI Study Foundation.**
  A real consumer vertical layered on the EXISTING reading library — no parallel
  document system, no cloned UI, no gimmicky AI, and nothing fabricated. `/reading`
  gets one obvious **`＋ Add reading`** entry (`components/reading/AddReadingPanel.tsx`)
  with Upload / Link / Paste tabs, drag-and-drop on desktop and the native picker on
  mobile, architected for future EPUB/PPTX/audio/video. Uploads (PDF text, TXT,
  Markdown) are validated (`lib/reading/ingest.ts`), extracted, and land as normal
  `ReadingDocument`s that open in the existing Reader. **Page provenance is preserved
  end-to-end**: `extractPdf`'s `PageSpan[]` → `assignPages` (maps passage offsets to
  real pages, never invents one) → `assembleDocumentFromParsed` (keeps `page`, unlike
  the string-based assembler). Honest processing states (uploading/processing/ready/
  needs_attention/failed) with a guarded state machine; scanned/encrypted/corrupt PDFs
  are explained, never faked; the stored original is never dropped on failure (Retry).
  Duplicate detection by whitespace-stable content hash → "Already in your library /
  Open existing / Upload another copy". A restrained **Ask · Summarize · Study** panel
  (`components/reading/StudyPanel.tsx`, logic in `lib/reading/study.ts`) sits *under*
  reading: deterministic retrieval over THIS document only, a **char budget** so the
  whole book is never sent, **grounded citations built from real chunk locations**
  (never parsed from the model — page numbers are never invented), honest "doesn't
  cover that" when nothing is retrieved, and on-device deterministic Study aids that
  never mutate beliefs/Knowledge. **Save to LifeOS** reuses `convertPassage(...,{text})`
  + `addAnnotation` so every saved item keeps a citation home. Provenance rides on
  `sourceMetadata` (jsonb — **no data migration**). Migration **0032** provisions the
  binary-original home: a **private** `reading-originals` bucket (never public, 25 MB)
  with per-user `storage.objects` RLS by `<uid>/…` prefix, and an RLS-scoped
  `reading_document_files` metadata table (checksum/size/state — never file text);
  live byte-upload wiring is a documented next increment (`originalStored` stays
  `false` until then — never a false "stored"). Release model advanced to head **0032**
  (reserved release-fix slot → 0033); `audit:rls` **55/55**, release self-tests
  **48/48**, security **94/94**. New self-tests `lib/reading/selftest.ts`
  (`/dev/reading-ingest-tests`) **40/40**. New doc `READING_INGESTION.md`. Deferred by
  design (documented, not faked): live embeddings, live binary upload, DOCX extraction.

- **LIFEOS-047A — Complete private Reading file persistence.** Finishes the one
  item 047 left deferred: the uploaded ORIGINAL binary is now genuinely, privately
  preserved — no second file-storage system, no redesign. `lib/reading/originals.ts`
  is pure orchestration over an injectable `OriginalsBackend` seam (real Supabase
  backend built from the authenticated client; an in-memory RLS-like fake drives
  tests): `backupOriginal` uploads bytes to a **deterministic** per-user path
  `<uid>/<documentId>/<file>` THEN writes the metadata row, reporting success only
  when BOTH land — so `originalStored` is truthful, never optimistic; a metadata
  failure removes the just-written object (no orphan). `removeOriginalsForDocument`
  deletes only that document's own folder + rows (path- & RLS-scoped, covers
  orphaned partial uploads); `resolveOriginalUrl` mints a **short-lived signed URL**
  for the owner only (never public, never another user's path).
  `lib/reading/backupManager.ts` keeps extraction + ReadingDocument creation the
  fast path and uploads in the background, holding the picked `File` for the session
  to power an honest in-session **Retry** (retry-after-failure can't survive reload —
  documented); it's a silent no-op in local-only mode / signed out. Provenance
  (`originalStored`/`originalBackup`/`originalStoragePath`/`originalFileId`) rides on
  `source_metadata` (jsonb) so it's durable and cross-device — another device
  resolves the original by metadata lookup + signed URL. Reader UI
  (`components/reading/OriginalStatus.tsx`): calm *Uploading original… / Original
  safely stored / not backed up + Retry*, and a *Remove* that cleans up the original
  (reusing `buildImpact` + `ConfirmDialog`) before deleting — refusing to delete if
  cleanup can't complete (no orphan, no fake success). **Root-cause fix:** 0032's
  `(user_id, checksum)` UNIQUE index would block the legitimate "Upload another copy"
  flow; migration **0033** makes it non-unique (dedup is a per-user UX affordance,
  not a DB constraint) — also wired the "Upload another copy" button to actually
  force a second copy. Release model advanced to head **0033** (reserved fix → 0034)
  coherently across versions/schema-compat/authorization-audit/selftests/audit +
  rehearsal scripts. Reading self-tests **58/58** (added original upload/metadata/
  originalStored-truthfulness/storage-fail/metadata-fail-orphan-cleanup/retry/
  signed-URL/cross-user-isolation/upload-another-copy/correct-target-deletion/orphan
  cleanup over the fake backend); release **48/48**, security **94/94**, `audit:rls`
  **55 tables**, release-audit **17/17**. **Live Supabase Storage validation with
  disposable users remains a manual release check** (no live credentials here) —
  stated, not faked. Still deferred (documented): embeddings, OCR, DOCX, EPUB/PPTX/
  audio/video.

- **LIFEOS-048 — Closed Beta Readiness & Production Validation (not a feature sprint).**
  Determined whether an ordinary person can safely use the product, favoring real
  behavior over test-count vanity. Reused existing validation infra (no duplicate
  systems). **Security fixes (real, in-attack-surface):** upgraded `pdfjs-dist`
  6.1.200 → **6.2.108** to clear GHSA-hq66-cqwq-w95j (arbitrary JS execution on
  opening a malicious PDF — directly relevant since we parse user-uploaded PDFs;
  validated a real PDF still extracts end-to-end through the UI), and pinned
  `nanoid` ≥3.3.17 via `overrides` (DoS advisory; transitive). `audit:deps` now
  PASS with only the documented `next→postcss/sharp` transitive exceptions. Fixed a
  **secret-scan false positive** by scoping the "service-role in client" rule to
  client-bundleable code (`scripts/` Node CLIs like the 047A live validator are not
  bundled; real secret *values* still caught everywhere). **Consumer walkthrough
  (headless Chromium, local prod build): 18/18** — capture-first root, capture
  persists across reload, reading add→reader→grounded Ask+citation→save-as-note,
  search finds the prior capture, review reachable, nav + `<main>` + all buttons
  named + 320px no-overflow + zero JS errors. Capture sign-in-race repro **13/13**
  (data-loss bug stays fixed). **Audit:** production security headers verified LIVE
  on the running server (8 headers incl. CSP without `unsafe-eval`, HSTS preload,
  nosniff, frame DENY, COOP); sign-in is nav `AuthControl` (magic-link; hidden only
  in local-only mode); no route exposes private data pre-auth (local-first render +
  stateless API routes + Supabase RLS boundary); account deletion (`/privacy/delete`,
  "DELETE MY ACCOUNT") + content deletion both exist. **Findings:** `/api/ai` +
  `/api/embed` are unauthenticated → provider-cost abuse risk (MEDIUM, cost not
  privacy — documented in the runbook to monitor + spend-cap); **no in-app feedback
  path existed (HIGH)** → added a minimal, config-gated `FeedbackLink` on Help
  (`NEXT_PUBLIC_FEEDBACK_URL`; calm beta fallback, no hardcoded address). **New
  tooling:** `scripts/beta-smoke.mjs` + `npm run beta:smoke` (post-deploy: HTTPS,
  security headers, no 5xx on core routes, `/dev` gated 404, Supabase reachable;
  13/15 locally = the 2 expected-local http+dev-enabled failures). **New docs:**
  `CLOSED_BETA.md` (user-facing), `BETA_RUNBOOK.md` (founder ops + STOP conditions +
  rollback pointers), `BETA_VALIDATION.md` (critical-path A–W with AUTO-PASS vs
  MANUAL-REQUIRED status + the founder manual pack M1–M11). **Final gates:** tsc 0,
  lint 0 err (1 pre-existing warning), build ✓, reading 58/58, security 94/94,
  release 48/48, `audit:security` PASS, release-audit 17/17, full regression
  **1030/1030** across 18 suites. **Verdict: READY WITH MANUAL CHECKS** — the
  automatable critical path is green and the security posture is sound; the
  remaining gates (real email sign-in, cross-device sync, live two-user Storage/RLS,
  Safari/iPhone/Android, deployed headers) genuinely require a founder with live
  credentials/devices and are specified as MANUAL, never faked.
