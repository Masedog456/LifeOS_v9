# LifeOS

LifeOS is an AI-native operating system for lifelong intellectual, personal,
and spiritual formation — a single-user application that turns books,
notes, conversations, and reflections into organized knowledge and
practical life formation, built on Next.js, Supabase, and the Anthropic
API.

## Command center & keyboard controls

Every page has a universal command palette for capturing, finding, creating,
and navigating without hunting through menus. Open it with the **Search** button
in the nav, the mobile bar at the bottom of small screens, or a shortcut:

| Shortcut | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `K` | Open the command palette (navigate, create, or search all records) |
| `Ctrl`/`Cmd` + `Shift` + `K` | Quick capture (save a thought without leaving the page) |
| `/` | Focus global search (when not typing in a field) |
| `?` | Show the keyboard-shortcuts help |
| `Esc` | Close the palette or any dialog |
| `g` then `t` / `m` / `r` / `d` / `w` / `h` / `c` | Go to Today / Memory / Research / Dialogue / World / Health / Capture |

Search is deterministic and local (no external service): results are grouped by
record type and ranked by exact title, then prefix, then contains, then alias,
then body — with recency as a tiebreak. Star any record to **pin** it (pinned
and recently-viewed records appear in the palette and on Today). All of this is
also reachable with the mouse — shortcuts are an accelerator, never a
requirement.

## Reading companion

Import a book, article, essay, transcript, or paper at **Reading** (`/reading`)
by pasting plain text or Markdown — headings become sections and paragraphs
become passages (parsing is local and deterministic; nothing is sent anywhere).
Open a document to read it in a three-pane workspace: navigation on the left,
the passage reader in the center, and annotations + linked knowledge on the
right. You can:

- **Highlight** any selection (five colors), and add **markdown notes** to
  passages, sections, or the whole document — the source text is never modified.
- **Convert** a passage or highlight into a capture, belief, concept, question,
  research item, or synthesis. Each conversion reuses LifeOS's canonical
  creation logic and writes a **citation** back to the exact document, section,
  page, passage, and highlight — so every derived idea can always answer "where
  did this come from?" and link back.
- Track **reading progress** (Not Started · Reading · Paused · Completed ·
  Abandoned) with a per-document percentage and a reading streak on the
  dashboard.

Reader keyboard shortcuts: `J`/`K` next/previous passage, `H` highlight the
selection, `N` add a note, `Esc` clear. Documents, authors, passages,
highlights, and reading notes are all searchable from the command palette
(`Ctrl`/`Cmd`+`K`).

Your reading library is durable, per-user, and cross-device: documents,
sections, passages, highlights, annotations, and citations are stored as
first-class RLS-protected records (migration `0021_reading_library.sql`) and
mirrored from local storage when you're signed in — the sync indicator on the
Reading pages shows **Saved / Saving… / Saved locally / Sync error**. Very large
imports are warned about (and blocked past a safe size) so browser storage stays
healthy; your text is never silently truncated.

## Inbox zero & capture processing

Raw captures land in an **inbox**. Process them at **Process** (`/process`) — a
deterministic workflow that answers "what should happen to this capture?" without
ever deciding meaning for you. The queue has five views (Inbox · Processing ·
Deferred · Processed · Archived) with sort, filter, multi-select, and keyboard
navigation (`J`/`K`/`↑`/`↓` move, `Enter` open, `x` select). Open a capture for a
focused screen where the **original text is always visible and never edited in
place**, and:

- **Clarify** a clearer working version (the original stays recoverable; revert is
  one click; unsaved edits are guarded).
- **Convert** into a canonical belief, concept, decision, research note,
  reflection, principle, framework, practice, or project/workspace note — reusing
  LifeOS's existing creators, with a preview first. The source capture is
  **preserved** and linked as lineage.
- **Split** at manual boundaries, **merge** several captures (explicit selection,
  order, separator, preview), or **link** to a workspace / goal / project /
  document / entity **without converting**.
- **Defer** (tomorrow · next week · someday · a specific date — deterministic
  local dates; deferred captures return to the inbox on their own when the date
  arrives, with no notifications or background jobs), **archive** (reversible), or
  **discard** (confirmed, retained, reversible — never destroyed immediately).

Batch actions apply to multiple captures (link, tag, defer, archive, mark
processed, restore) — **but never batch conversion**; each conversion is reviewed
individually. A compact, non-judgmental inbox card on **Today** shows the count
and oldest age with no streaks, scores, or guilt. Everything is durable, per-user,
and cross-device: processing metadata is additive on the `captures` table
(migration `0026_capture_processing.sql`, existing captures default to `inbox`,
the original `text` stays immutable), and two-device edits union links/tags/
lineage/history and surface genuine conflicts through the Conflict Center. No AI,
no auto-classification, no scoring. See `CAPTURE_PROCESSING.md`.

## Unified inspector & context

LifeOS is navigable through ideas, not just menus. Any object — a belief,
concept, document, decision, dialogue, author, passage, and more — can be
**inspected in place** without leaving the page: the inspector opens as a
right-side panel on desktop and a bottom sheet on mobile. Open one from the
**Inspect (ⓘ)** action on a command-palette search result, or by clicking any
linked entity (e.g. a passage's linked knowledge in the reader).

The inspector has five tabs — **Overview** (summary, dates, tags, status, notes,
citations, pinned state), **Relationships** (references, supports, contradicts,
derived-from, related documents/authors/themes/decisions — all one click to
follow), **Backlinks** (who links here, grouped by type), **Timeline** (the
object's history — creation, edits, highlights, conversions, reading and
decision activity), and **Graph** (a miniature relationship graph of immediate
neighbors). Hovering any entity link shows an instant preview card. The inspector
remembers your last entity, tab, expanded sections, and scroll position across
sessions, and is fully keyboard-navigable (arrow keys switch tabs, `Esc` closes).

## Workspaces & thinking sessions

LifeOS understands **what you're working on right now**, not just what you own.
A **Workspace** (`/workspaces`) groups existing work — beliefs, documents,
decisions, dialogues, concepts — around a project or life area (Philosophy
Thesis, Pool Business, Peace Corps). Nothing is duplicated: a workspace only
references what you already have, so a belief can live in several workspaces and
still be the same belief.

Inside a workspace you begin a focused **thinking session** in one of eight
modes — Thinking, Reading, Research, Writing, Planning, Decision, Review,
Reflection. Only one session is active at a time. While it runs, a slim global
banner shows the current workspace, a live elapsed clock, and a quick-notes field
(a markdown scratchpad independent of your captures), with **End session** and
**Switch** controls. The session quietly records a **timeline** of what you did —
entities and documents opened, searches, captures, belief/decision edits,
inspector and command usage — with no analytics or scoring, just a record.

Each workspace has a dashboard with goals, pinned entities, recent work,
reading progress, themes, a graph-neighbor frontier, and a **session timeline**
(Today · Yesterday · This Week · Past) with each session's duration and derived
outputs. **Resume** returns you to exactly where you left off — the last entity
inspected, document read, or search. Search can be **scoped to the current
workspace** (it reuses the global search engine — there's no second index), and
every object shows which workspaces it **belongs to** in its inspector. Switch
workspaces, start / resume / end sessions from the nav selector or the command
palette (`Ctrl`/`Cmd`+`K`).

Workspaces and sessions are durable, per-user, and RLS-protected (migration
`0022_workspaces.sql`) and sync across devices. Everything is deterministic and
offline — no AI, no background work.

## Goals, projects & execution

LifeOS understands **what you're trying to accomplish**, not just what you know.
A **Goal** (`/goals`) is the highest-level object — Finish Philosophy Thesis,
Grow Pool Business, Read 100 Books. Goals hold **Projects** (`/projects`) —
concrete work that lives in a workspace — and projects hold **milestones**.
Sessions can be attributed to a goal/project, so the work you do rolls up into
what you're pursuing.

Progress is **derived and deterministic**: a project's progress comes from its
completed milestones (which you check off manually — nothing is ever inferred as
done), and a goal's progress is the average of its projects'. You can always set
a manual progress override, which wins. Each goal and project has a dashboard
showing progress, milestones, the sessions that contributed, related documents
and knowledge, and a timeline. Start a thinking session directly from a project
and the session banner shows the goal you're advancing.

Everything gains execution relationships in its inspector — *contributes to*
which goal, *related to* which project — and goals, projects, and milestones are
searchable from the command palette (`Ctrl`/`Cmd`+`K`), which can also create,
switch, and resume them. Goals and projects are durable, per-user, and
RLS-protected (migration `0023_execution.sql`) and sync across devices. No AI, no
auto-planning, no auto-prioritization — you decide, LifeOS keeps the structure.

## Reliability, backup & everyday polish

LifeOS is built to be trustworthy day to day. Destructive actions (deleting a
goal, project, document, or resetting local data) go through **one confirmation
dialog** that shows exactly what will be affected — the record, its child records,
whether linked records survive, and whether it can be undone — and high-impact
actions require an explicit acknowledgement. Actions give quiet, consistent
**toast feedback** (capture created, milestone completed, session ended, backup
exported) with a polite screen-reader announcement, and save status is honest —
it never says "Saved" before a remote sync has actually succeeded.

**System Health** (`/health`) includes a **Sync Reliability Center** (adapter,
auth, local/remote status, last successful sync, dirty domains, pending changes,
sanitized recent errors — never secrets or document contents) with **Retry sync**
and **Copy diagnostics**, plus **Backup & Restore**: export all your data to a
versioned JSON file, or import one with validation, a per-domain preview, and a
**merge or overwrite** choice. Malformed files are rejected and your current data
is never silently overwritten. A dismissible **first-run checklist** on Today
guides you through real actions (capture → workspace → session → goal → project →
document → inspect → command center) and can be restarted from Health.

See [UX_AUDIT.md](./UX_AUDIT.md) (friction, mobile, performance) and
[ACCESSIBILITY.md](./ACCESSIBILITY.md). Everything here is deterministic and
offline — no AI, no analytics, no telemetry.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values (see comments in .env.example)
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

Other useful commands:

```bash
npm run build   # production build
npm run lint    # lint check
```

## Semantic retrieval (optional)

LifeOS has an **optional** semantic layer (LIFEOS-015) that finds
conceptually related material even when the wording differs. It is off until
you build an index, and **deterministic search always works without it** —
you never have to configure anything.

- **Zero-config (default):** a built-in local lexical embedder runs entirely
  on-device — no keys, no network, fully private. Open **Library → Semantic
  index → Update index** to build it. Indexing is incremental (only new or
  changed records are embedded) and user-triggered; nothing runs in the
  background.
- **Optional higher-quality provider:** to use a real embedding model, set
  these **server-only** variables (never prefix them with `NEXT_PUBLIC_`):

  ```bash
  EMBEDDING_PROVIDER_URL=https://api.openai.com/v1/embeddings  # any OpenAI-compatible /embeddings endpoint
  EMBEDDING_API_KEY=<your embedding provider key>
  EMBEDDING_MODEL=<embedding model id>
  EMBEDDING_DIMENSIONS=1536
  ```

  The provider is called only from the server route `/api/embed`; the key
  never reaches the browser and source text is never logged. If these are
  unset, the local embedder is used. LifeOS does **not** assume Anthropic
  provides embeddings — the provider is independent of `ANTHROPIC_API_KEY`.
- **Durable index (optional):** when signed in with Supabase configured, run
  `supabase/migrations/0010_semantic_retrieval.sql` to store embeddings in a
  pgvector table (own-row RLS — no cross-user results). See
  [PERSISTENCE_QA.md](./PERSISTENCE_QA.md).

Saved comparisons, inquiries, Megathreads, weekly reviews, and reasoning
sessions also show an **evidence-freshness** badge and a one-click re-run when
their underlying records change; re-running preserves prior history and never
overwrites your own conclusions.

## Project memory & foundation docs

- [PROJECT_MEMORY.md](./PROJECT_MEMORY.md) — current project state, what's
  next, and the change log
- [VISION.md](./VISION.md) — product direction
- [PRINCIPLES.md](./PRINCIPLES.md) — product principles that constrain
  design and engineering decisions
- [ONTOLOGY.md](./ONTOLOGY.md) — the first-class objects LifeOS is built
  around
- [COGNITIVE_ARCHITECTURE.md](./COGNITIVE_ARCHITECTURE.md) — how knowledge
  moves through the system: the lifecycle, AI roles, events, and human
  oversight boundaries (design only — nothing here is implemented yet)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — proposed technical architecture
  (design/spec only — nothing here is implemented yet)
- [INGESTION.md](./INGESTION.md) — the ingestion architecture: adapters,
  the extraction seam, and the replaceable processing pipeline (LIFEOS-006)
- [AI_AGENT_RULES.md](./AI_AGENT_RULES.md) — rules AI agents must follow
  when working on this codebase
- [PILOT_GOSPEL_OF_THOMAS_SAYING_37.md](./PILOT_GOSPEL_OF_THOMAS_SAYING_37.md)
  — a manual pilot walkthrough stress-testing the ontology and cognitive
  architecture against a real use case, with findings and recommendations
- [UX_SPECIFICATION.md](./UX_SPECIFICATION.md) — the MVP interaction
  blueprint: three screens (Capture, Belief Inbox, Constitution) and a
  ruthless six-week feature prioritization (design only — nothing built)
- [QA_CHECKLIST.md](./QA_CHECKLIST.md) — manual QA steps for the
  implemented Belief Thread MVP local trial
- [PERSISTENCE_QA.md](./PERSISTENCE_QA.md) — Supabase/Vercel setup steps
  (incl. email magic-link auth) and QA for durable persistence + real AI
  (LIFEOS-004 / 004.1)
- [RELEASE_VALIDATION.md](./RELEASE_VALIDATION.md) — the v1.0.0-rc1 → v1.0.0
  release-validation plan: production schema verification, credentialed
  Supabase acceptance, two-user RLS test plan, seven-day dogfooding,
  release criteria, and rollback procedure
- [TRIAL_GUIDE.md](./TRIAL_GUIDE.md) — how to use the local prototype for
  the two-week personal trial, and how to judge whether it's valuable
- [SYNC_INTEGRITY.md](./SYNC_INTEGRITY.md) — cross-device conflict detection,
  three-way merge, tombstones, corruption recovery, restore safety, and the ten
  cross-device scenarios (LIFEOS-033)

- [DAILY_REVIEW.md](./DAILY_REVIEW.md) — the deterministic daily review &
  planning loop: review lifecycle, day-summary sources, open-loop rules,
  tomorrow-focus, weekly rollup, and local-date/timezone semantics (LIFEOS-034)

All of the above are provisional drafts pending final Product Owner
sign-off (see the notice at the top of each file).
