# LIFEOS-004 — Persistence & Real-AI QA

> Two modes exist. **Local mode** (no Supabase env vars) is the default and
> is fully verified. **Supabase mode** (both `NEXT_PUBLIC_SUPABASE_*` vars
> set) is implemented but must be verified by you after the manual setup
> below, since it needs live credentials.

## Manual setup (do this once, in order)

### 1. Supabase database
1. In your `lifeos` Supabase project, open **SQL Editor** and run
   `supabase/migrations/0001_initial_schema.sql` (paste and execute).
2. Then run `supabase/migrations/0002_long_source_analysis.sql` (LIFEOS-007
   — adds `chunk_results` / `analysis` / `stages` jsonb columns to
   `sources`). It is additive and rerunnable (`add column if not exists`);
   it does not touch existing rows, other tables, RLS, or triggers.
3. Then run `supabase/migrations/0003_pdf_ingestion.sql` (LIFEOS-008 — adds
   `pdf_meta` / `page_map` / `extraction_status` to `sources`). Also
   additive/rerunnable. **No Supabase Storage bucket is needed:** PDF text
   is extracted client-side and only the text + metadata are stored; the PDF
   binary is never uploaded.
4. Then run `supabase/migrations/0004_retrieval.sql` (LIFEOS-009 — adds the
   append-only `retrieval_feedback` table with its own RLS: own-rows-only
   select + insert, no update/delete). Additive and rerunnable
   (`create table if not exists`, guarded policy creation); it does not
   touch migrations 0001–0003, existing rows, other tables, or their RLS.
   Retrieval itself is deterministic and in-memory — this table stores
   **only** the user's relevance feedback, never source text or beliefs.
5. Then run `supabase/migrations/0005_comparative_intelligence.sql`
   (LIFEOS-010 — adds the `comparisons` table: one row per saved comparison
   with jsonb `inputs`/`evidence`/`result`/`judgments`, own-rows RLS with
   full CRUD so append-only judgments can be added to the jsonb array).
   Additive and rerunnable; it does not touch migrations 0001–0004, existing
   rows, other tables, or their RLS. Comparison itself sends only a small,
   capped evidence packet to the AI route — never whole sources.
6. Then run `supabase/migrations/0006_dialectical_intelligence.sql`
   (LIFEOS-011 — adds the `inquiries` table: one row per saved dialectical
   inquiry with jsonb `inputs`/`evidence`/`result`/`history`/`judgments`,
   own-rows RLS with full CRUD so append-only history/judgments and the user's
   provisional conclusion can be added to an existing row). Additive and
   rerunnable; it does not touch migrations 0001–0005, existing rows, other
   tables, or their RLS. Inquiry sends only a small, capped evidence packet to
   the AI route — never whole sources.
7. Then run `supabase/migrations/0007_megathreads.sql` (LIFEOS-012 — adds the
   `megathreads` table: one row per thread with jsonb `members`/`pinned`/
   `excluded`/`synthesis`/`unresolved_questions`/`judgments`/`revisions`,
   own-rows RLS with full CRUD so curation + append-only judgments/revisions
   can be added to an existing row). Additive and rerunnable; it does not
   touch migrations 0001–0006, existing rows, other tables, or their RLS.
   Threads store only references to existing records — never copies of source
   text — and the timeline is a read-model derived at render time.
8. Then run `supabase/migrations/0008_formation_engine.sql` (LIFEOS-013 —
   adds `reflections` (immutable `response` enforced by a trigger + separate
   append-only `annotations`), `practices` (status machine + append-only
   `history`), and `review_sessions` (daily/weekly, jsonb surfaced items /
   judgments / optional synthesis). Own-rows RLS; reflections allow
   select/insert/update (update only for adding annotations — the trigger
   blocks changing `response`). Additive and rerunnable; it does not touch
   migrations 0001–0007, existing rows, other tables, or their RLS. There is
   **no** habit-tracker / streak / schedule table.
9. Then run `supabase/migrations/0009_reasoning_engine.sql` (LIFEOS-014 — adds
   the `reasonings` table: one row per saved reasoning query with jsonb
   `scope`/`evidence`/`result`/`history`/`judgments`, own-rows RLS with full
   CRUD so append-only history/judgments + the provisional conclusion can be
   added to an existing row). Additive and rerunnable; it does not touch
   migrations 0001–0008, existing rows, other tables, or their RLS. The
   `evidence` column holds references to existing records — never copies of
   source text.
10. Then run `supabase/migrations/0010_semantic_retrieval.sql` (LIFEOS-015 —
    `create extension if not exists vector`, then the `embeddings` table:
    one row per embedded record with a `content_hash` for idempotency, a
    dimensionless `vector` column, own-rows RLS, and a user-scoped
    `match_embeddings` RPC that can only ever match the caller's own vectors —
    **no cross-user similarity results**). Additive and rerunnable; it does not
    touch migrations 0001–0009, existing rows, other tables, or their RLS. The
    `embeddings` rows hold vectors + provenance — never keys or full-source
    text. Semantic retrieval is optional: with no embeddings, deterministic
    search works fully.
11. Then run `supabase/migrations/0011_decision_intelligence.sql` (LIFEOS-016
    — the `decisions` table: one jsonb-bearing row per decision with options,
    criteria, ratings, evidence references, validated analysis + append-only
    history/judgments/revisions/outcome-reviews, the user's provisional/final
    choice + rationale + stated confidence, and a freshness fingerprint;
    own-rows RLS with full CRUD). Additive and rerunnable; it does not touch
    migrations 0001–0010, existing rows, other tables, or their RLS. LifeOS
    never chooses automatically — `final_choice` is only ever written by an
    explicit user action.
12. Then run `supabase/migrations/0012_reflective_practice.sql` (LIFEOS-017
    — the `formation_sessions` table: one jsonb-bearing row per reflection
    with a typed prompt, an immutable reflection body, explicit links to the
    rest of the system, user-authored structured capture (lessons, unresolved
    questions, emotional observations, revised assumptions, belief candidates,
    follow-up reflections), evidence references, a validated cited synthesis +
    append-only history/judgments, and a freshness fingerprint; own-rows RLS
    with full CRUD). Additive and rerunnable; it does not touch migrations
    0001–0011, existing rows, other tables, or their RLS. Nothing here changes
    the Constitution, a decision, or a thread automatically — every promotion
    (belief → Inbox, attach-to-thread, new inquiry) is an explicit user action.
13. Then run `supabase/migrations/0013_world_model.sql` (LIFEOS-018 — four
    tables modeling the user's understanding of reality: `concepts`,
    `concept_relationships`, `principles`, and `frameworks`. Concepts carry a
    definition/description/aliases, cross-type links (beliefs/threads/sources/
    practices), denormalized concept↔concept structure, principle links, open
    questions, append-only history, and a fingerprint. Relationships are
    first-class edges with reason/citations/confidence/source and an `approved`
    flag — they only shape the graph after a human approves. Principles are
    reusable and many-to-many with beliefs and concepts; frameworks ORGANIZE
    concepts and principles but never own beliefs. Own-rows RLS with full CRUD
    on every table). Additive and rerunnable; it does not touch migrations
    0001–0012, existing rows, other tables, or their RLS. Deterministic-first
    and human-reviewed — nothing is inferred silently and nothing changes a
    belief or the Constitution.
14. Then run `supabase/migrations/0014_authoring_engine.sql` (LIFEOS-019 — the
    `knowledge_projects` table: one jsonb-bearing row per authoring project with
    the project's `assembly` (chosen evidence ids across every record type —
    references, never copies), generated `outline_options`, the chosen outline,
    `sections` (each with paragraph-level citations and append-only version
    history), an append-only project change log, and a freshness fingerprint;
    own-rows RLS with full CRUD). Additive and rerunnable; it does not touch
    migrations 0001–0013, existing rows, other tables, or their RLS.
    Evidence-first and human-directed — the app assembles evidence, proposes
    outlines, and drafts one section at a time on request; it never writes
    autonomously and never invents a citation.
15. Then run `supabase/migrations/0015_research_workspace.sql` (LIFEOS-020 — the
    `research_projects` table: one jsonb-bearing row per investigation with a
    primary question plus `questions` (subquestions/unknowns/assumptions/
    definitions/success-criteria/open-problems, each with history), an evidence
    workspace (`assembly` — references across every record type, never copies),
    project-local `notes`, competing `hypotheses` (user-stated confidence,
    supporting/contradicting evidence, open questions, status, history), an
    explicit user-authored argument map (`argument_nodes` + `argument_edges`),
    an append-only project change log, a freshness fingerprint, and an optional
    `seeded_project_id` (the authoring project it seeded); own-rows RLS with
    full CRUD). Additive and rerunnable; it does not touch migrations 0001–0014,
    existing rows, other tables, or their RLS. Not autonomous, not web-browsing,
    not an agent — evidence-first, deterministic-first, human-directed; gap
    detection never resolves anything and hypotheses are never auto-selected.
16. Then run `supabase/migrations/0016_graph_and_incremental_sync.sql`
    (LIFEOS-021 — supports incremental sync/load: additive per-user `updated_at`
    (or `added_at`/`created_at`) indexes on the domain tables so a loader can
    fetch only rows changed since a cursor, plus a `sync_meta` table (own-rows
    RLS) recording per-user/per-domain sync cursors. The knowledge-graph layer
    itself is DERIVED in memory and needs no tables). Additive and rerunnable;
    it does not modify migrations 0001–0015, any existing row, table, or RLS
    policy — the whole-state sync path keeps working unchanged, and the new
    incremental path pushes only changed domains. Each incremental-load index is
    created only if its target table and columns already exist (guarded by a
    `do $$` block), so applying 0016 on a database that has not yet run every
    earlier feature migration simply **skips** that domain's index (emitting a
    `NOTICE`) instead of aborting — it never creates a placeholder table. Apply
    the missing feature migration (e.g. `0006_dialectical_intelligence.sql` for
    `inquiries`) and re-run 0016 to add the skipped index (0016 is idempotent).
17. Then run `supabase/migrations/0017_dialogue_engine.sql` (LIFEOS-022 — adds
    the `dialogue_sessions` table for the Socratic dialogue engine: one row per
    dialogue with jsonb `participants`/`seed_refs`/`turns`/`outcomes`/`history`/
    `fingerprint` columns, own-rows RLS with full CRUD, and `user_id` +
    `updated_at` indexes for incremental sync). Additive and rerunnable; it does
    not touch migrations 0001–0016, existing rows, other tables, or their RLS.
    The dialogue engine adds no AI route — the Socratic prompt generation is
    fully deterministic.
18. Then run `supabase/migrations/0018_dialectical_synthesis.sql` (LIFEOS-023 —
    adds two tables for the dialectical engine: `tensions` (one jsonb-bearing row
    per represented tension — thesis/antithesis with their source refs, evidence
    links, four-axis `confidence`, unresolved questions, status, a stable
    `signature` for dedupe) and `syntheses` (one row per synthesis — preserved
    insights, discarded assumptions, common ground, remaining uncertainty,
    four-axis `confidence`, append-only revisions, provenance outcomes). Both
    carry own-rows RLS with full CRUD plus `user_id`/`updated_at`/`dialogue_id`
    indexes. Additive and rerunnable (`create table/index if not exists`, guarded
    policy creation); it does not touch migrations 0001–0017, existing rows, other
    tables, or their RLS. The dialectical engine adds no AI route — tension
    detection and synthesis scaffolding are fully deterministic, and no record is
    mutated automatically.
19. Then run `supabase/migrations/0019_cognitive_orchestrator.sql` (LIFEOS-024 —
    adds the `recommendations` table backing the unified LifeOS Inbox: one row
    per deterministic recommendation with type, priority, four-value confidence,
    rationale, originating subsystem, suggested action + `action_href`, a jsonb
    `affected` array (references, not copies), a stable `signature` for dedupe,
    and `dismissed`/`accepted`/`completed`/`snoozed_until` lifecycle fields.
    Own-rows RLS with full CRUD; indexes on user/created, subsystem, type, and
    signature. Additive and rerunnable (`create table/index if not exists`,
    guarded policy creation); it does not touch migrations 0001–0018, existing
    rows, other tables, or their RLS. The orchestrator adds no AI route — every
    scanner is deterministic — and never mutates knowledge; recommendations are
    opportunities the user accepts, dismisses, snoozes, or completes.
20. Then run `supabase/migrations/0020_generation_one_hardening.sql`
    (LIFEOS-025 — adds the `user_prefs` key/value table: per-user preferences,
    currently onboarding state, so the first-run tour follows the user across
    devices. Own-rows RLS with full CRUD; `(user_id, key)` primary key +
    `updated_at` index). Additive and rerunnable; it does not touch migrations
    0001–0019, existing rows, other tables, or their RLS. System-health
    reporting, sync diagnostics, and integrity findings are deliberately
    DERIVED at view time — no tables are added for them.
21. Then run `supabase/migrations/0021_reading_library.sql` (LIFEOS-028
    amendment — the durable Reading Companion library). Adds six independently
    durable, own-rows-RLS tables: `reading_documents` (reading progress embedded
    as jsonb, 1:1; `import_complete` flag), `document_sections`,
    `document_passages`, `document_highlights`, `document_annotations`,
    `document_citations`, plus the atomic `import_reading_document(payload jsonb)`
    RPC. Foreign keys: section→document, passage→document+section,
    highlight/annotation→document+passage, citation→document (+optional
    passage/highlight `on delete set null`); deleting a document CASCADES to its
    owned children. A citation's link to an external knowledge record is
    `record_kind`+`record_id` with NO FK — deleting a document never deletes the
    belief/concept it produced. RLS: four own-row CRUD policies per table (24),
    with child inserts/updates additionally requiring the parent to belong to the
    same user. Additive and rerunnable; it does not touch migrations 0001–0020,
    existing rows, other tables, or their RLS.
22. **Project Settings → API**: copy the **Project URL** and the **anon
   public** key. (Never copy the **service-role** key into this project.)

### 1b. Supabase authentication (email magic link)
LifeOS signs in with a durable **email** identity — remote sync only starts
after a permanent account exists. Configure:

1. **Authentication → Providers → Email**: enabled (on by default). The
   default "Magic Link" flow is what LifeOS uses (`signInWithOtp`). No
   password is required.
2. **Authentication → Providers → Anonymous**: **leave DISABLED.** LifeOS
   deliberately does not use anonymous auth for sync — pre-sign-in usage is
   local-only. Enabling it is unnecessary and not recommended.
3. **Authentication → URL Configuration**:
   - **Site URL**: your production URL (e.g. `https://lifeos.vercel.app`).
   - **Redirect URLs** (add both): `http://localhost:3000/**` and
     `https://<your-vercel-domain>/**`. The magic link redirects back to the
     app's origin; these must be allowlisted or sign-in will fail.
4. (Optional) **Authentication → Email Templates → Magic Link**: customize
   wording. The default works.

### 2. Local `.env.local` (never committed)
```
NEXT_PUBLIC_SUPABASE_URL=<your Project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon public key>
ANTHROPIC_API_KEY=<your Anthropic key>     # server-only; blank = mock
ANTHROPIC_MODEL=claude-sonnet-5            # optional
# --- Optional embedding provider (LIFEOS-015). All server-only. If unset, a
# --- built-in local lexical embedder is used and everything still works.
EMBEDDING_PROVIDER_URL=<OpenAI-compatible /embeddings endpoint>  # optional
EMBEDDING_API_KEY=<embedding provider key>                       # optional, server-only
EMBEDDING_MODEL=<embedding model id>                             # optional
EMBEDDING_DIMENSIONS=1536                                        # optional
```

The embedding credentials are **server-only** (no `NEXT_PUBLIC_` prefix) and
must never be exposed to the browser. Semantic retrieval is optional: with no
embedding provider configured, indexing uses the local lexical embedder and
deterministic retrieval is unaffected.

### 3. Vercel (Production + Preview scopes)
Add the same four variables in **Project → Settings → Environment
Variables**. `NEXT_PUBLIC_*` are exposed to the browser (safe);
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are server-only — do **not**
prefix them with `NEXT_PUBLIC_`. Never paste the Supabase **service-role**
key anywhere in this project.

> **Build-time gotcha:** `NEXT_PUBLIC_*` values are inlined into the client
> bundle **at build time**. They must be present in Vercel's env for the
> environment being built (Production and/or Preview) **before** the build
> runs, or the browser will see them as undefined and stay in local-only
> mode. After adding/changing them, trigger a fresh deployment.

### 4. Deployment branch (LIFEOS-005)
All LifeOS work to date is on `claude/lifeos-implementation-xwrikz`. Vercel
builds its **Production** environment from the project's **Production
Branch** (default: `main`). Choose one:
- **Recommended:** merge this branch into `main` and let Vercel deploy
  Production from `main`. Pushes to the feature branch then produce Preview
  deployments (using Preview-scoped env vars).
- **Or:** set **Vercel → Settings → Git → Production Branch** to
  `claude/lifeos-implementation-xwrikz`.

Vercel auto-detects **Next.js** — no `vercel.json` is needed. Defaults are
correct: Framework = Next.js, Build = `next build`, Install = `npm install`,
Output = `.next`. The app builds cleanly with **no** env vars set (it falls
back to local mode), so a misconfigured env never breaks the build — it only
changes runtime behavior.

---

## A. Local mode (verified — no credentials needed)

- [x] Sync indicator reads **"Saved locally"** when Supabase is unset.
- [x] Add manual-text source → pipeline → summary/quotes/concepts/candidate beliefs.
- [x] Save a quote in the reader.
- [x] Send a belief candidate to the Inbox.
- [x] Rewrite/accept it in the Inbox.
- [x] It appears in the Constitution.
- [x] The reader shows "Beliefs from this source".
- [x] Refresh the browser → all data remains (localStorage).
- [x] `/api/ai` invalid task → HTTP 400; invalid JSON → HTTP 400.
- [x] `/api/ai` with no key → deterministic mock (`"source":"mock"`).
- [x] **Comparison (LIFEOS-010):** compare 2 sources → structured result;
      agreements/disagreements cite exact evidence chips; shared concepts
      shown; partial-coverage sources labeled; an insight → Belief Inbox
      (proposal + capture created, Constitution unchanged); unsupported AI
      claims (bad evidence ids) dropped from conclusions + flagged; saved
      comparison persists after refresh; 5-source select cap + 6th disabled;
      belief-vs-sources runs. (15/15 automated checks, mock mode.)
- [x] **Inquiry (LIFEOS-011):** investigate a question with 2 sources →
      structured dialectic; affirmative/negative cases + counterarguments cite
      exact evidence chips; terminology disputes preserved; challenge a belief
      (relation-to-beliefs shown); accept an insight → Belief Inbox (proposal +
      capture, Constitution unchanged); save a provisional conclusion + status;
      unsupported AI assertions dropped from conclusions + flagged; evolve with
      an added source → prior result kept in append-only history + conclusion
      preserved; 5-source cap + verification confirm; persistence after refresh.
      (22/22 automated checks, mock mode.)
- [x] **Megathreads (LIFEOS-012):** seed a thread from a belief / comparison /
      inquiry (auto-members include the seed + its direct inputs); candidate
      membership is deterministic + explainable; include/exclude items;
      timeline is chronological with page/source provenance and shows belief
      evolution; comparisons/inquiries appear in context; generate a synthesis
      that cites valid evidence chips; unsupported synthesis points dropped +
      flagged; accept an insight → Belief Inbox (Constitution unchanged);
      thread + synthesis persist after refresh. (21/21 automated checks, mock
      mode.)
- [x] **Formation engine (LIFEOS-013):** daily review shows ≤3 items, each with
      an explicit reason; reflection saves without changing beliefs (response
      immutable); a "revise" enters the existing revision flow (append-only);
      practice candidates cite their derivation and require explicit
      acceptance (no auto-accept); dismissed/snoozed items don't immediately
      return; weekly counts reflect real activity and the optional synthesis
      cites valid record ids; alignment wording stays cautious + non-accusatory;
      no Constitution changes automatically; Home shows one quiet entry point
      with no streaks/points/metrics; review sessions persist after refresh.
      (23/23 automated checks, mock mode.)
- [x] **Reasoning engine (LIFEOS-014):** a belief support audit runs (counts,
      no truth score); a contradiction audit runs across beliefs and preserves
      distinct tension kinds (not all flattened to "contradiction"); influence
      tracing reaches the original source; the assumption audit finds a
      recurring assumption; belief-impact analysis mutates nothing; findings
      cite valid evidence and unsupported ones are dropped + flagged; a finding
      enters the Belief Inbox; a result attaches to a Megathread; a prior
      inquiry can be reopened; re-run keeps append-only history; the
      Constitution never changes automatically; results persist after refresh.
      (19/19 automated checks, mock mode.)
- [x] **Semantic retrieval & freshness (LIFEOS-015):** deterministic search
      works with no index; after user-triggered indexing, semantic search finds
      a paraphrase (labeled "Semantically related") while an exact match still
      outranks a weak semantic one; unchanged records are not re-embedded and
      changed records get a new embedding (content-hash idempotency); semantic
      similarity alone never labels two beliefs contradictory (opposing polarity
      still required); a saved result detects changed evidence and shows why;
      re-running preserves prior history and never overwrites the user's
      provisional conclusion. (19/19 automated checks, local-embedder mode.)
- [x] **Decision intelligence (LIFEOS-016):** a decision runs with 2 options
      and safely up to the 8-option cap; criteria are editable and weighted;
      deterministic weighted tradeoffs compute with NO AI and are labeled one
      perspective; relevant beliefs/sources retrieved with provenance;
      grounded findings cite valid evidence and unsupported ones are dropped +
      flagged; prescriptive "you should choose" language is flagged; values
      alignment never claims certainty; missing evidence, reversibility,
      regret, pre-mortem, and probability-free scenarios all render; nothing
      is chosen automatically — the final choice takes an explicit action with
      the user's own rationale + stated confidence; the Constitution never
      changes; decisions attach to Megathreads; outcome reviews are reflective,
      append-only, and preserve the original decision (no gamification);
      freshness detects a revised belief and rerun preserves prior analysis +
      rationale + choice; sensitive (medical) questions show a professional-
      care caution; decisions persist after refresh. (34/34 automated checks,
      mock mode.)
- [x] **Reflective practice & formation (LIFEOS-017):** the reflection engine
      generates thoughtful, non-shallow prompts from the user's own knowledge
      (never productivity/streak prompts); a session is created from any of the
      built-in types (and custom); the reflection body is immutable once saved;
      structured capture (lessons, unresolved questions, emotional observations,
      revised assumptions, belief candidates, follow-ups) saves independently;
      one synthesis runs deterministically-first with honest mock provenance;
      belief-revision suggestions cite valid evidence and uncited ones are
      dropped + flagged; every synthesis insight is judgeable (Accept → Inbox);
      belief candidates promote to the Inbox only by explicit action (nothing
      touches the Constitution automatically); the freshness badge shows Current
      after synthesis and flips stale when the reflection's own capture changes,
      with history-preserving re-run; the derived formation timeline is
      chronological and read-only; cadence review switches across Today/Week/
      Month/Year/Life; entry points from Constitution/Threads/Decisions/Inquiry/
      Library open a linked session; sessions persist after refresh; no secret
      value leaks into the page. (26/26 automated checks, mock mode.) All prior
      suites still green (decision 34, semantic 19, review, threads, inquiry,
      compare, retrieval, reason, qa3, pdf, long-source).
- [x] **Worldview & concept graph (LIFEOS-018):** concepts are created and
      listed; a concept's definition/description/aliases/questions save with
      append-only history; a relationship is proposed and only shapes the graph
      after explicit approval, editable and removable; cross-type links to
      beliefs/threads/sources/practices toggle; the concept freshness badge
      resolves and "review" records a fresh fingerprint (no AI); tensions
      surface deterministically (isolated, unsupported, and duplicate concepts
      detected; nothing auto-resolves); the Review panel runs one proposal pass
      (deterministic-first) labeling AI/mock provenance and every proposal is
      reviewable — creating a concept/principle/framework only by explicit
      action; frameworks organize concepts without owning beliefs; principles
      are created and many-to-many with beliefs/concepts; the world timeline is
      derived + read-only; concepts persist after refresh; entry points from
      Constitution ("Model as a concept") and Threads open the workspace; no
      secret value leaks into the page. (21/21 automated checks, mock mode.)
      All prior suites still green (formation 26, decision 34, semantic 19,
      review, threads, inquiry, compare, retrieval, reason, qa3, pdf,
      long-source).
- [x] **Knowledge synthesis & authoring (LIFEOS-019):** a project is created
      for any kind (book/essay/lecture/course/paper/blog/guide/philosophy);
      evidence is assembled across every record type with provenance; multiple
      outline candidates are generated (deterministic + AI/mock) and the human
      chooses one, which seeds sections; a section drafts one at a time from the
      assembled evidence with paragraph-level citation chips; unsupported
      paragraphs are flagged and removable; transforms (rewrite/expand/compress/
      clarify + academic/popular/technical/conversational) re-draft one section,
      pushing the prior into append-only version history; cross-references
      surface deterministically and are labelled suggestion-only (never
      inserted); citation coverage + unsupported counts render; deterministic
      export to Markdown, HTML, DOCX, and PDF all download with valid signatures
      (# / <!doctype html> / ZIP "PK" with word/document.xml / %PDF- with
      trailer) and preserve citations as a numbered reference list; projects
      persist after refresh; entry point from Threads ("Write from this thread");
      no secret value leaks into the page. (23/23 automated checks incl. export
      byte verification, mock mode.) All prior suites still green (world 21,
      formation 26, decision 34, semantic 19, review, threads, inquiry, compare,
      retrieval, reason, qa3, pdf, long-source).
- [x] **Research workspace (LIFEOS-020):** an investigation is created; the
      question layer takes subquestions/unknowns/assumptions/definitions/
      success-criteria/open-problems (each history-bearing, resolvable,
      removable); the evidence workspace attaches records across every type with
      provenance (references only) and supports filter/search; multiple
      competing hypotheses are created with user-stated confidence, status, and
      supporting/contradicting evidence toggles (none auto-selected); the
      argument map takes user-authored claim/evidence/counterargument/objection/
      rebuttal/open-question/unknown nodes and explicit edges (nothing inferred);
      gap detection surfaces unsupported claims / missing / contradictory /
      duplicate evidence / orphan questions / unresolved hypotheses
      deterministically and resolves nothing; the research timeline is derived +
      read-only; deterministic export (Markdown/HTML/DOCX/PDF, reusing the
      authoring writers) downloads with valid signatures and preserves
      provenance; the Research→Author handoff seeds a KnowledgeProject with the
      SAME evidence ids (no duplication) and both sides link; projects persist
      after refresh; entry points from Threads/Constitution; no secret value
      leaks. (21/21 automated checks incl. export bytes + author handoff, mock
      mode.) The shared `EvidencePicker` refactor left the authoring suite green
      (23/23). All prior suites still green (world 21, formation 26, decision 34,
      semantic 19, review, threads, inquiry, compare, retrieval, reason, qa3,
      pdf, long-source).
- [x] **Unified graph & incremental persistence (LIFEOS-021):** the derived
      knowledge graph builds correct nodes + edges from EXPLICIT references only
      (verified 7 records → 7 nodes → 7 edges across capture/proposal/belief/
      concept/authoring/research links); integrity is clean on a well-formed
      store (0 broken / 0 duplicate / 0 orphan) and a dangling reference is
      detected (concept → non-existent id → 1 broken reference, listed); the
      deterministic diagnostics page (dev-only) renders record counts, graph
      size, sync mode/dirty-domains, integrity, performance timings, largest
      domains, and the migration list incl. 0016; incremental sync tracks dirty
      domains by immutable-array reference equality (zero store changes) and the
      SupabaseAdapter pushes only dirty tables when a dirty set is supplied
      (full push otherwise — backward compatible); local fallback + offline
      preserved. (15/15 graph/diagnostics checks, dev build.) **The refactor is
      non-breaking: ALL prior suites re-run green** — research 21, authoring 23,
      world 21, formation 26, decision 34, semantic 19, review, threads,
      inquiry, compare, retrieval, reason, qa3, pdf, long-source. Incremental
      remote push (dirty-table gating) and the `sync_meta`/`updated_at` indexes
      are code-complete and credential-pending like all remote sync.
- [x] **Socratic dialogue & dialectical engine (LIFEOS-022):** a dialogue is
      created from an idea; the deterministic Socratic engine emits the classic
      moves ("What do you mean…", "What would falsify this", "Could the opposite
      be true") and never returns an answer/chatbot reply; "Ask" adds a typed
      question turn (author: socratic) and a user response turn is added with its
      own citations; perspectives (Current Constitution + a framework) are added,
      each citing its own record, and a framework perspective yields a "How would
      [X] respond?" line of inquiry; the Graph tab REUSES the knowledge graph to
      surface a related concept (Free will) and supporting/contradicting beliefs;
      an outcome creates a Research project (reusing the research engine) recorded
      as provenance on the dialogue, and a belief proposal is routed to the Inbox
      (never auto-added); a flagged insight appears on the derived read-only
      timeline; the dialogue persists across reload; Nav + the Constitution entry
      point ("Question in dialogue") are present. (19/19 dialogue checks.) **Non-
      breaking: ALL prior suites re-run green** — research 21, authoring 23,
      world 21, formation 26, decision, semantic, review, threads, inquiry,
      compare, retrieval, reason, qa3, pdf, long-source, graph 15. No new AI route
      (Socratic generation is deterministic). Supabase `dialogue_sessions`
      persistence is code-complete and credential-pending like all remote sync.
- [x] **Dialectical synthesis & tension resolution (LIFEOS-023):** on a
      dialogue's new **Dialectic** tab, "Detect tensions" surfaces a tension from
      EXPLICIT signals only (here two opposing concepts, "Free will" vs
      "Determinism"); the tension shows thesis + antithesis grounded in the user's
      own records, the deterministic "why flagged" rationale, unresolved
      questions, and **confidence on four separate axes** (factual / logical /
      evidential / experiential — never a single collapsed score); "Suggest
      candidates" offers deterministic scaffolds including a higher-order
      integration (not a compromise) and a **deferral** that preserves the tension
      when integration isn't justified; a candidate can be added, accepted (which
      resolves its tension), rejected, or revised (append-only revisions); the
      user can author their own synthesis and continue the dialogue from any
      synthesis (a reflection turn citing it); integrating a synthesis routes a
      belief proposal to the **Inbox** (never auto-added) and records provenance;
      conversation memory summarises accepted/abandoned syntheses and unresolved/
      recurring tensions; tensions + syntheses persist across reload. (22/22
      synthesis checks.) **Non-breaking: ALL prior suites re-run green** — dialogue
      19, research 21, authoring 23, world 21, formation 26, decision, semantic,
      review, threads, inquiry, compare, retrieval, reason, qa3, pdf, long-source,
      graph 15. No new AI route (detection + synthesis are deterministic).
      Migration `0018_dialectical_synthesis.sql` applies cleanly and is idempotent
      on a Postgres 16 schema built from 0001–0017; Supabase `tensions`/`syntheses`
      persistence is code-complete and credential-pending like all remote sync.
- [x] **Cognitive orchestration & active intelligence (LIFEOS-024):** the
      **LifeOS Inbox** (`/orchestrator`) renders; "Scan now" runs all eight
      deterministic scanners and aggregates recommendations from distinct
      subsystems — verified simultaneously: belief→open-a-dialogue (two accepted
      beliefs on opposing concepts), review→review-a-stale-belief,
      graph→merge-duplicate-concepts, world→possible-new-principle,
      formation→repeat-reflection, decision→revisit-a-decision,
      dialogue→unresolved-tension + import-a-missing-source, research→build-a-
      synthesis (evidence vs an accepted belief); each card shows priority,
      subsystem, confidence, affected-object chips and an inspectable rationale;
      filtering by subsystem narrows the list; **dismiss** removes a
      recommendation from the active view and it remains under the "dismissed"
      filter; **snooze** hides it from the active view; a card carries an
      "Act on this →" jump to the originating object; re-scanning is **idempotent**
      (deduped by signature); recommendations persist across reload; and the
      Constitution's beliefs are unchanged — **the orchestrator never modified
      knowledge**. (22/22 orchestration checks.) **Non-breaking: ALL prior suites
      re-run green** — synthesis 22, dialogue 19, research 21, authoring 23, world
      21, formation 26, decision, semantic, review, threads, inquiry, compare,
      retrieval, reason, qa3, pdf, long-source, graph 15. No new AI route (every
      scanner is deterministic). Migration `0019_cognitive_orchestrator.sql`
      applies cleanly and is idempotent on a Postgres 16 schema built from
      0001–0018; Supabase `recommendations` persistence is code-complete and
      credential-pending like all remote sync.
- [x] **Generation 1 hardening (LIFEOS-025):** the four-step onboarding runs
      end-to-end (real first capture in the user's own words, live proposal
      count, finish lands on the LifeOS Inbox), persists per user, and is
      restartable; **Daily Home** (`/today`) projects pending proposals, recent
      captures, open work, and recently-completed items while creating ZERO
      records (verified by count); the grouped Primary nav has an accessible
      name, no duplicate destinations, keyboard-reachable links, and the brand
      mark returns to Daily Home; **System Health** (`/health`) reports real
      persistence connectivity, schema/migration compatibility, hydration,
      scan/graph status, per-domain counts, and all 10 integrity checks with
      remediation text and NO secrets; a seeded stale recommendation is
      detected and the safe repair removes only that derived record;
      **persistence hardening** verified live: an unparseable local blob is
      PRESERVED under `lifeos.mvp.v1.corrupt` (byte-identical) and surfaced on
      /health instead of being silently overwritten; the indicator shows real
      local-only state; all 12 primary modules render meaningful empty states
      with no raw exceptions; Daily Home and the LifeOS Inbox fit a 390px
      mobile viewport with no horizontal scroll. (41/41 gen1 checks.)
      **Non-breaking: ALL prior suites re-run green** — orchestration 22,
      synthesis 22, dialogue 19, research 21, authoring 23, world 21, formation
      26, decision, semantic, review, threads, inquiry, compare, retrieval,
      reason, qa3, pdf, long-source, graph 15, auth, sync. Migration
      `0020_generation_one_hardening.sql` applies cleanly and is idempotent on
      a Postgres 16 schema built from 0001–0019; `user_prefs` mirroring is
      code-complete and credential-pending like all remote sync.
- [x] **Reading library durable persistence (LIFEOS-028 amendment, migration
      0021).** Validated on Postgres 16 against a schema built from 0001–0020
      (0010's pgvector is Supabase-only and skipped locally, and 0021 is
      independent of it): `0021_reading_library.sql` applies successfully and is
      IDEMPOTENT applied **3×** (create-if-not-exists + drop/create policies).
      Verified present: all **6 tables** (`reading_documents`,
      `document_sections`, `document_passages`, `document_highlights`,
      `document_annotations`, `document_citations`); **RLS enabled on all 6**;
      **24 policies** (4 own-row CRUD each); **24 indexes** (user_id, document_id,
      section_id, passage_id, updated_at, status, citation target); **16 foreign
      keys** with the intended `on delete` actions; the atomic
      `import_reading_document` RPC. Behavior verified: deleting a document
      **cascades** to its sections/passages/highlights/annotations/citations
      (children → 0), while the external knowledge record a citation points at is
      NOT deleted (no FK). Cross-user isolation verified as a non-superuser role:
      user B sees **0** of user A's documents, user A sees their own, and user B
      is **blocked by RLS** from inserting a section into user A's document
      ("new row violates row-level security"). No prior table (0001–0020) is
      modified. Remote reading sync is code-complete and credential-pending like
      all remote sync; local-first persistence is fully exercised by the reading
      E2E + self-tests (row flatten/rebuild/diff, malformed-row resilience,
      one-annotation-edit-is-one-row).
- [x] `npm run lint` = 0, `npm run build` = 0.
- [x] **Production build** (`next start`) serves `/`, `/library`, `/inbox`,
      `/constitution`, and `/api/ai` (verifies no local-only assumption
      breaks a production server — the same runtime Vercel uses).
- [x] No secret **value** in the client bundle (only the identifier string
      "ANTHROPIC_API_KEY" inside a user-facing mock hint — not the key).

## B. Authentication + sync (run after setup — CREDENTIAL-DEPENDENT, pending)

- [ ] Configured but **signed out** → indicator shows **"Saved locally"**,
      a **"Sign in"** control appears, and NOTHING syncs remotely yet
      (Supabase tables stay empty).
- [ ] Click **Sign in**, enter email → "Check your email" → click the magic
      link → you return signed in; the email shows in the nav.
- [ ] On first sign-in, existing local data **migrates once** to your
      account (rows appear in `sources`/`beliefs`), and local data is **not**
      deleted. Indicator goes **Syncing… → Synced**.
- [ ] Reload → no duplicate rows (migration is one-time; upserts idempotent).
- [ ] Add a source / accept a belief while signed in → row appears in
      Supabase; indicator shows **Synced**.
- [ ] **Sign out** → back to local-only ("Saved locally"); local data
      remains usable.
- [ ] Belief revisions/judgments are **append-only** in `belief_revisions` /
      `user_judgments` (new `seq` rows only; none updated/deleted).
- [ ] `original_text`, capture `text`, and `saved_quotes.text` cannot be
      overwritten (DB triggers / append-only RLS reject it).
- [ ] Row-level security: a second account cannot read the first's rows.

## B2. Cross-device (CREDENTIAL-DEPENDENT, pending)

- [ ] Browser A: sign in, create a source and a belief.
- [ ] Browser B (or another device): sign in with the **same email**.
- [ ] Browser B loads the same Library, Inbox, Constitution, quotes,
      revisions, and judgments.
- [ ] No wrong-user migration: if a different email signs in on a browser
      that already held another account's data, that data is **not** pushed
      into the new account (it stays in its owner's account).
- [ ] Saved comparisons sync: create a comparison in Browser A → it appears
      in Browser B (same email). A second account cannot read it (RLS on
      `comparisons`).
- [ ] Saved inquiries sync: create an inquiry (and evolve it) in Browser A →
      it appears in Browser B with its full append-only history. A second
      account cannot read it (RLS on `inquiries`).
- [ ] Megathreads sync: create a thread (with members + a synthesis) in
      Browser A → it appears in Browser B with its members and synthesis. A
      second account cannot read it (RLS on `megathreads`).
- [ ] Formation sync: write a reflection, accept a practice, and run a weekly
      review in Browser A → they appear in Browser B. A second account cannot
      read them (RLS on `reflections`/`practices`/`review_sessions`). The
      reflection `response` cannot be overwritten (DB trigger).
- [ ] Reasoning sync: run a reasoning query (and re-run it) in Browser A → it
      appears in Browser B with its full append-only history. A second account
      cannot read it (RLS on `reasonings`).
- [ ] Semantic index sync + RLS: build the index in Browser A → embeddings
      appear in Browser B (same email). A second account's `match_embeddings`
      never returns the first account's vectors (own-row RLS on `embeddings`).
- [ ] (If a real embedding provider is configured) provider calls contain only
      the required text; the embedding key is server-only and never in the
      client bundle; no source text is logged.
- [ ] Decisions sync: create a decision (with an analysis, a final choice, and
      an outcome review) in Browser A → it appears in Browser B intact. A
      second account cannot read it (RLS on `decisions`).

## C. Real Anthropic (CREDENTIAL-DEPENDENT, pending)

Verify each task returns `"source":"ai"` (real) rather than `"mock"`:
```bash
for t in summary quotes concepts beliefs; do
  curl -s -X POST https://<prod-url>/api/ai -H "content-type: application/json" \
    -d "{\"task\":\"$t\",\"text\":\"Attention is the beginning of devotion.\"}" ; echo
done
```
- [ ] All four tasks (and a reader question) return `"source":"ai"`.
- [ ] Quote spans still resolve (candidate beliefs highlight correctly).
- [ ] Bad key / network fault → response is `"source":"mock","degraded":true`;
      the app keeps working (never a hard error to the user).

**Distinguishing real vs mock**: the JSON response `source` field is `"ai"`
for real Anthropic output and `"mock"` otherwise; a failed real attempt also
includes `"degraded":true`. In the UI, a source processed with real AI drops
the small "mock" tag.

**Diagnosing a failed real call** — check the Vercel function logs for
`[ai] task=… failed: <reason>` (source text and keys are never logged):

| Log reason        | Likely cause                                   |
|-------------------|------------------------------------------------|
| `anthropic_401`   | missing/invalid/expired `ANTHROPIC_API_KEY`    |
| `anthropic_400`   | malformed request / bad model params           |
| `anthropic_404`   | unsupported/misspelled `ANTHROPIC_MODEL`       |
| `anthropic_429`   | rate limited or **insufficient credits**       |
| `anthropic_5xx`   | Anthropic upstream issue                        |
| `The operation was aborted` | timeout (>25s) — rare; or Vercel runtime |
| `no JSON in response` / `empty proposals` | model output didn't parse |

If `source` is always `"mock"` even with a key set: the key isn't reaching
the server env (not set for that Vercel environment, or `NEXT_PUBLIC_`-
prefixed by mistake, or set only on Preview while testing Production).

## D. Failure resilience

- [ ] Simulate remote failure (wrong URL, or offline): writes still succeed
      locally ("Saved locally"/"Sync failed" with a **Retry** action);
      nothing is lost. Fix connectivity → **Retry** re-syncs.

## E. Full production chain (CREDENTIAL-DEPENDENT, pending)

Run against the live URL, signed in by email:
1. [ ] Open the live URL. 2. [ ] Sign in by email (magic link).
3. [ ] Add a manual text source. 4. [ ] Run analysis (real AI).
5. [ ] Save a quote. 6. [ ] Send a belief candidate to the Inbox.
7. [ ] Rewrite/accept it. 8. [ ] It appears in the Constitution.
9. [ ] Refresh → all data remains. 10. [ ] Second browser, same email →
same data loads. 11. [ ] Ask a Reader question → real Anthropic answer.

---

## Known limitations
- Supabase + email-auth mode is code-complete but **unverified in this
  environment** (no credentials were available); local mode is fully
  verified.
- Sync is whole-state debounced upsert (fine for single-user volume), not
  real-time collaboration.
- Identity is **email magic link only** (durable, cross-device). Anonymous
  auth is intentionally not used for sync; pre-sign-in usage is local-only.
- If you edit data locally while signed out on a device whose account
  already has remote data, then sign in, the remote copy is adopted as the
  source of truth (those particular offline edits are not merged). Append-
  only history is never lost. Sign in before editing to avoid this.
- **Reading library (LIFEOS-028):** remote reading sync is code-complete and
  validated against Postgres, but — like all remote sync in this repo — is
  **credential-pending** (no Supabase credentials in this environment). Row-level
  incremental sync means editing one annotation writes one row; brand-new
  documents import atomically via the `import_reading_document` RPC. A partial
  remote import leaves the document `import_complete = false` and is recoverable
  (the local store re-pushes on the next flush); local data is never destroyed by
  a sync failure. Per-document import is soft-warned above ~400 KB and
  hard-blocked above ~1.5 MB to keep the localStorage blob under the browser cap.

## Backup, restore & sync diagnostics (LIFEOS-032)

- **Backup export** (`/health` → Backup & restore) writes a versioned JSON
  envelope: `{ schemaVersion, exportedAt, appVersion?, prefs, data }` where
  `data` is every canonical `StoreState` domain and `prefs` is the safe,
  restore-useful subset (onboarding, recent, pinned, workspace/execution
  pointers — never anything sensitive; prefs hold no secrets). Deterministic
  given a fixed clock. Client-side only — no cloud provider.
- **Restore import** validates before touching anything: non-JSON, a missing
  `schemaVersion`, a missing `data`, or a malformed domain (not a list) is
  **rejected** with a clear error and the current data + original file are
  preserved. A newer `schemaVersion` is accepted with a warning; unknown domains
  are ignored (warned). The user picks **merge** (union by `id`, incoming wins on
  conflict) or **overwrite** (replace each domain), sees a per-domain preview
  (now / in file / after), and must confirm through the shared confirmation
  dialog. Nothing is ever silently overwritten.
- **Sync Reliability Center** (`/health`) shows a **sanitized** snapshot: adapter,
  auth (email masked), local + remote status, **last successful sync**, dirty
  domains, pending local changes, retry state, and recent errors with tokens/JWTs/
  API keys stripped. It never displays secrets, credentials, or document
  contents. Actions: **Retry sync** and **Copy diagnostics**. `persistence.ts`
  records `lastSyncAt` on each successful remote flush.
- **Manual production checks (credential-pending):** with Supabase configured and
  signed in — (1) confirm `SaveStatus` shows "Saving…" then "Saved" only after the
  remote flush; (2) export a backup, sign in on a second device, import with
  **merge**, confirm no data loss; (3) force a network failure and confirm the
  reliability center shows `failed` + a sanitized error and **Retry sync**
  recovers; (4) confirm `lastSyncAt` advances after a successful sync.

### Sync conflicts, recovery & integrity (LIFEOS-033)

- Cross-device conflicts are detected **three-way** (base / local / remote) and
  never resolved by silent last-write-wins on user content. Unresolved conflicts
  surface in the **Conflict Center** on `/health`; `SaveStatus` shows
  "Conflict — resolution required (n)" until the user resolves them.
- **Delete integrity:** `sync_tombstones` (migration `0024`) stops a stale
  device from resurrecting a deleted record. It stores only `user_id / domain /
  record_id / deleted_at` — never content — and is RLS-isolated per user
  (validated: idempotent 3×, cross-user isolation confirmed on Postgres 16).
- **Corruption recovery:** malformed rows are isolated out of the store on
  hydrate (source in `localStorage` untouched) and reported in the Recovery
  panel; the app never crashes on a single bad record.
- **Restore safety:** import runs upgrade → validate → preview → apply and
  offers a one-click **rollback** until the next mutation.
- Diagnostics additions (unresolved conflicts, journal depth, oldest pending op,
  skipped malformed records, recovery mode, local schema version) are all
  sanitized — no content, tokens, or secrets. See `SYNC_INTEGRITY.md`.

### Daily reviews (LIFEOS-034)

- Daily reviews are first-class synced records (migration `0025`,
  `daily_reviews`): row-level dirty-domain upsert/delete in the Supabase adapter,
  deletes tombstoned under domain `dailyReviews`, resilient load if the table is
  absent. Exactly one review per user per **local date**, enforced by a database
  `unique (user_id, date)` constraint — validated on Postgres 16 (idempotent 3×,
  four RLS policies, cross-user isolation, duplicate-date rejection).
- The canonical `date` (yyyy-mm-dd) is stored separately from timestamps so a
  timezone change or clock skew never forks a duplicate review; day boundaries
  are DST-correct and never hardcoded to UTC. See `DAILY_REVIEW.md`.
- **Manual production check (credential-pending):** with Supabase configured and
  signed in — (1) complete a review on device A, confirm it appears on device B
  after sync; (2) edit the same review on both devices offline, reconnect, and
  confirm the sync-integrity layer surfaces the conflict rather than dropping the
  newer edit; (3) confirm no duplicate review is created for the same local date
  after switching timezones.

## Capture processing (LIFEOS-035)

- Processing metadata is **additive on the existing `captures` table** (migration
  `0026_capture_processing.sql`), not a new table — captures already sync there.
  New columns: `processing_status` (`not null default 'inbox'`), `working_text`,
  `deferred_until`, `archived_at`, `discarded_at`, and `jsonb` source-context /
  links / tags / lineage / compact-history / notes.
- **Existing captures are preserved and default to `inbox`** — the column default
  plus a defensive `update … where processing_status is null` backfill; no
  capture's meaning is rewritten and no duplicate inbox record is created.
- The verbatim `text` column stays **immutable** (the 0001 `captures_immutable_text`
  trigger is untouched). Clarifications live in `working_text`, so the original is
  always recoverable; **discard is soft and reversible** (`discarded` status +
  `discarded_at`), never a permanent delete, and stays tombstone-compatible with
  the LIFEOS-033 sync layer.
- Validated on Postgres 16: full chain `0001–0026` applies **idempotently 3×**;
  new columns carry correct types/defaults; a legacy-shaped insert (no processing
  columns) defaults to `inbox` with empty jsonb collections; a status +
  `working_text` update succeeds while an attempt to change `text` is rejected as
  immutable; RLS remains enabled and is inherited from the table's per-user
  policies (no new policy needed).
- Indexes: `captures_status_idx (user_id, processing_status)`,
  `captures_deferred_idx (user_id, deferred_until)`,
  `captures_split_from_idx (split_from_id)`.
- **Manual production check (credential-pending):** signed in — (1) process a
  capture on device A (rewrite + link), confirm the working version and links
  appear on device B after sync while the original text is unchanged; (2) offline
  on both devices, archive on A and convert on B, reconnect, and confirm the
  conflict surfaces (lineage/history not silently discarded); (3) defer a capture
  to tomorrow and confirm it returns to the inbox on the next local day without
  any notification. See `CAPTURE_PROCESSING.md`.

## Next actions & commitments (LIFEOS-036)

- Three additive tables (migration `0027_next_actions.sql`): `next_actions`,
  `action_dependencies` (first-class edges), `action_templates`. Bounded links /
  tags / compact history are jsonb; lifecycle/context are normalized columns.
- **Soft references, no destructive cascade:** `project_id` / `milestone_id` /
  `goal_id` / `workspace_id` / `source_capture_id` / `source_review_id` are plain
  uuids **without foreign keys**, so deleting a project/milestone/goal never
  cascades away an action, and an orphaned reference degrades gracefully (the
  projections are orphan-safe). Cancel/complete are reversible statuses, not
  deletes; deletes are tombstone-compatible with the LIFEOS-033 layer.
- **Dependency safety:** a DB `check (blocker_id <> blocked_id)` plus a
  `unique(user_id, blocker_id, blocked_id)`; direct and indirect cycles are
  rejected at the application layer before an edge is ever written.
- Validated on Postgres 16: full chain `0001–0027` applies **idempotently 3×**;
  a bare insert defaults to `open` / `unspecified` with empty jsonb collections;
  the self-dependency check is enforced; a soft `project_id` reference to a
  non-existent project is accepted (orphan-safe); **RLS isolates users** — a
  non-superuser role with `auth.uid()` = user1 sees only user1's actions, and
  user2 only user2's (4 policies per table).
- Performance (20,000 actions + ~3,000 dependencies): Next-queue derivation
  **~19 ms**; a 3,000-deep cycle check **~2 ms** (indexed maps, deterministic
  projections; no global deep comparison on edit).
- **Manual production check (credential-pending):** signed in — (1) create + start
  an action on device A, confirm status/history appear on device B after sync;
  (2) offline on both, complete on A and cancel on B, reconnect, confirm the
  conflict surfaces (completion history not lost); (3) add different dependency
  edges on each device and confirm they union without a cycle. See
  `NEXT_ACTIONS.md`.

## Planning views & focus modes (LIFEOS-037)

- Two additive tables (migration `0028_planning_focus.sql`): `planning_assignments`
  (a **generic typed record reference** `ref_kind`+`ref_id`, one per record;
  `horizon`, manual `"order"`, compact jsonb history) and `focus_sessions` (one
  target, optional `session_id`, `panels`/`interruptions`/`history` as bounded
  jsonb). Capacity soft limits + board/focus UI prefs live in `user_prefs`, not
  here — they are preferences, not records.
- **One assignment per record:** `UNIQUE(user_id, ref_kind, ref_id)` — a move
  updates the row in place; sync (keyed by record ref, not assignment id) can
  never create a duplicate assignment for the same record.
- **Soft references, no destructive cascade:** `ref_kind`/`ref_id`, `session_id`,
  and the focus target are plain values **without foreign keys**, so deleting a
  project/action/document never cascades away a planning assignment or focus
  session, and an orphaned reference degrades gracefully (projections are
  orphan-safe; the planning inbox surfaces orphans for a manual decision).
  Deletes are tombstone-compatible with the LIFEOS-033 layer.
- **A move changes only horizon + order** — nothing in this migration mutates
  another table (no status/deadline/priority/hierarchy side effects).
- Validated on Postgres 16: full chain `0001–0028` applies **idempotently 3×**;
  a bare insert defaults to `unscheduled` / `order 0` with empty jsonb
  collections; the `(user_id, ref_kind, ref_id)` unique constraint is enforced;
  a soft ref to a non-existent record is accepted (orphan-safe); **RLS isolates
  users** — a non-superuser role with `auth.uid()` = user1 sees only user1's
  rows and cannot update user2's (4 policies per table); structure confirms
  `planning_assignments` 9 cols / 6 indexes, `focus_sessions` 14 cols / 5
  indexes.
- Performance (self-test §18, realistic fixture: 20k actions / 1k projects /
  3k milestones / 5k assignments / one year of history / hundreds of focus
  sessions): board `<250ms`, today+weekly `<300ms`, planning inbox `<400ms`
  (O(1) existence sets + assignment index; no rescans of the record arrays).
- **Manual production check (credential-pending):** signed in — (1) move a record
  to Today on device A, confirm the horizon + history appear on B after sync;
  (2) offline on both, move the same record to different horizons, reconnect,
  confirm the conflict surfaces (no duplicate assignment); (3) start focus + log
  an interruption on A and a different interruption on B, confirm both survive
  the union. See `PLANNING_AND_FOCUS.md`.

## Knowledge maintenance & integrity (LIFEOS-038)

- Two additive tables (migration `0029_knowledge_maintenance.sql`):
  `maintenance_events` (append-only decision log — generic typed `ref_kind`/
  `ref_id` + optional `related_kind`/`related_id`, `kind`, `detail`, `at`) and
  `duplicate_candidates` (one decision per detected group; `members`/`history`
  jsonb; `status` open|ignored|merged; **stable text `id`** = hash of reason +
  sorted member keys). Review filters / dashboard layout / dismissed ids /
  ignored-duplicate mirror are PREFERENCES in `user_prefs`, not here.
- **Only decisions persist.** The dashboard, review queue, orphan/staleness/
  citation/relationship reports, archive candidates, and merge previews are all
  DERIVED at read time. Archive state and last-reviewed are folded from the
  append-only event log — **no columns are added to any existing table.**
- **Soft references, no destructive cascade:** every `ref`/`related`/duplicate
  member is a plain value **without a foreign key**, so deleting any record never
  cascades away its maintenance history, and an orphaned reference degrades
  gracefully (projections are orphan-safe; the review queue surfaces the orphan).
  Deletes are tombstone-compatible with the LIFEOS-033 layer.
- **The same duplicate never duplicates:** the stable `duplicate_candidates.id`
  means the same group detected on two devices resolves to exactly one row.
- Validated on Postgres 16: full chain `0001–0029` applies **idempotently 3×**;
  a bare insert defaults `duplicate_candidates.status`=`open` / `members`=`[]`
  and `maintenance_events.at`=`now()`; soft refs to non-existent records are
  accepted (orphan-safe); **RLS isolates users** — a non-superuser role with
  `auth.uid()`=user1 sees only user1's rows and cannot update user2's (4 policies
  per table).
- Performance (self-test §17, 20k beliefs / 4k docs / 10k citations / 3k
  concepts / 2k events): index build **< 250 ms**, dashboard **< 400 ms**,
  duplicate detection **< 300 ms**, review queue **< 500 ms** — one shared index,
  O(records) with O(1) lookups.
- **Manual production check (credential-pending):** signed in — (1) review + a
  archive on device A, confirm the events + archive state appear on B after sync;
  (2) offline on both, ignore a duplicate on A and merge the same group on B,
  reconnect, confirm the conflict surfaces (no lost history, one row); (3) archive
  on A and restore on B, reconnect, confirm both events survive and latest wins.
  See `KNOWLEDGE_MAINTENANCE.md`.
