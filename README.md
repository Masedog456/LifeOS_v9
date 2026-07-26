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

All of the above are provisional drafts pending final Product Owner
sign-off (see the notice at the top of each file).
