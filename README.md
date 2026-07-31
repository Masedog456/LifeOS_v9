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

## Next actions & commitments

Answer "what can I concretely do next?" at **Actions** (`/actions`). A next
action is **manually created**, specific, independently completable, and small
enough to begin in a session — the leaf of Goal → Project → Milestone → Next
Action → Session. Nothing is generated, prioritized, or scheduled for you.

- The **Next** view is deterministic: open/in-progress actions that aren't
  deferred into the future, waiting, completed, or **blocked** by an unfinished
  dependency — in your **manual order**, with explicit **pins** on top. No
  importance score, no behavioral reordering.
- **Start** an action (optionally starting/reusing a session and showing it in
  the session banner), **complete** it (always manual — it never completes the
  milestone, project, goal, or other actions), **defer** (tomorrow · next week ·
  a date · someday — deferred actions return to Next when due), or mark it
  **waiting on** someone with an optional follow-up date (surfaced, never
  auto-changed).
- Add explicit **dependencies** ("B is blocked by A") — direct and indirect
  cycles are rejected; completing A makes B eligible but never starts it.
- Save reusable **templates** (weekly review, monthly backup check…) and
  **explicitly** create each instance — there is no background recurrence.
- **Batch** actions (link, tag, set context/energy/size, defer, wait, complete,
  cancel, restore) with an impact confirmation — but **never** batch title/notes
  edits and **never** batch conversion.
- Create an action from a **processed capture** (the capture is preserved), from
  a **project/milestone** (context pre-filled), or from the command center.

Views: Next · In progress · Waiting · Deferred · Completed · Cancelled · All,
with filters (context, energy, size, source, linked/unlinked, text) and keyboard
navigation (`J`/`K`/`↑`/`↓` move, `Enter` open, `x` select, `p` pin). A compact,
calm **Actions** card on Today shows pinned + in-progress + due follow-ups with no
streaks or scores. Everything is durable, per-user, and cross-device (migration
`0027_next_actions.sql`; deleting a project never cascades away its actions);
two-device edits union tags/links/history/dependencies and surface real conflicts
through the Conflict Center. No AI, no scheduler, no notifications. See
`NEXT_ACTIONS.md`.

## Planning views & focus modes

Decide what to focus on, and when — then protect the space to do it. A
**planning board** organizes plannable records (actions, milestones, projects,
documents, captures) into five manual horizons — **Today · This Week · Later ·
Someday · Unscheduled** — with drag-drop, keyboard 1–5, multi-select, manual
ordering, filters, and a mobile list. A horizon is a **choice, never a
deadline**; moving a card changes **only** its horizon and order — never its
status, deadline, priority, or hierarchy. The **Today plan** is deterministic:
it shows what you explicitly put in Today plus items you already flagged
(pinned, in-progress, follow-ups due, deferred returns) — it **never auto-fills
an empty plan**. A **weekly view** reviews the week (not a calendar grid), a
**commitments** view groups everything you're committed to, and a **planning
inbox** surfaces records that may need a decision — including an active project
with no next action (offering Create/Link/Leave, never auto-creating one).
**Capacity** shows counts against a soft limit you set, phrased neutrally and
**never blocking**. **Focus Mode** centers the screen on one target, hides
nonessential navigation, loads only that target's context, runs an optional
timer, and lets you log interruptions **by hand**. Everything is durable,
per-user, and cross-device (migration `0028_planning_focus.sql`; deleting a
record never cascades away its plan or focus). No AI, no scheduler, no
auto-prioritization, no notifications, no scores. See `PLANNING_AND_FOCUS.md`.

## Knowledge maintenance & integrity

Knowledge decays over years — projects end, ideas duplicate, documents go out of
date, references break. A **Knowledge Health** dashboard summarizes what might
need maintenance as plain counts (orphan entities/documents/beliefs, uncited
claims, duplicate candidates, archived items, unresolved items, inactive
projects, stale research, broken references) — **counts, never a grade or
score**. **Duplicate detection** finds exact-signal candidates (same title, URL,
ISBN, DOI, or a shared alias) and lets you **merge** (with a preview that
preserves history, citations, and backlinks and archives the rest — never
deletes) or ignore; nothing merges automatically. **Relationship** and
**citation integrity** report broken backlinks, dangling references, and
duplicate/broken citations, with a real repair (remove a broken citation).
**Evidence review** surfaces uncited beliefs and research without sources; an
**archive review** proposes finished work to archive (reversible); a unified
**review queue** gathers every candidate with manual dismiss/archive/resolve.
Records expose **staleness** as a fact ("Last reviewed 9 months ago", never
"Needs update"). Everything is deterministic, durable, per-user, and cross-device
(migration `0029_knowledge_maintenance.sql`; deleting a record never loses its
maintenance history). No AI, no embeddings, no automatic decisions, no scores —
the system identifies candidates; you decide. See `KNOWLEDGE_MAINTENANCE.md`.

## Deterministic system insights

LifeOS records a lot of activity — sessions, focus intervals, actions moving
through their lifecycle, captures flowing out of the inbox, documents opened,
beliefs reviewed, records maintained, reviews completed. **Insights** turns that
into calm, descriptive views for a date range you choose (today, last 7/30 days,
this/last month, this year, or a custom range): an **Insights Home** of counts
and durations; an **Attention View** of where recorded attention went; **Project**
and **Goal** activity; **Action Flow** and **Capture Flow**; **Reading**,
**Knowledge**, **Review**, and **Focus** activity; a filterable **Change Log**; a
**Period Summary** (Started / Continued / Completed / Changed / Reviewed /
Learned / Deferred / Waiting / Archived); **Compare Periods**; a **Dormancy View**;
and a bounded **Contribution Map**. Every number is a count, a duration, or an
arithmetic difference — **there is no composite score, no ranking the system
asserts, and no interpretation.** Comparisons read "12 sessions, previously 9"
(never better/worse); dormancy reads "no recorded activity in 90 days" (never
neglected/stale). Every metric has a plain-language definition, every view
discloses its data coverage, and any view exports to CSV or JSON with its range,
timezone, filters, and timestamp. It all computes locally from existing activity
— no new event storage, no AI, no predictions, no productivity scores. The only
persisted addition is **saved views** (migration `0030_deterministic_insights.sql`),
which store your chosen insight, range, filters, and grouping — never calculated
results. Insights describe recorded activity; they do not judge the person living
it. See `DETERMINISTIC_INSIGHTS.md`.

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

## Security, privacy & your data

LifeOS is built to be trusted with years of personal knowledge. Access is
isolated by Postgres **Row Level Security** on every table (audited so a new
table can't ship without it). You can **export everything** you own as a
deterministic JSON archive (with checksums, no secrets), **verify** it, and
**restore** it with a preview and dry-run — destructive restores always ask
first, and nothing is silently overwritten. A **Recovery Center** surfaces
discarded, archived, and conflicting items with a preview of impact. A
**Diagnostics** page shows a fully sanitized status report (no record contents,
no tokens) you can copy or download. A **Privacy Center** explains, in plain
language, what's stored and where (local-first, optionally synced to your own
Supabase), and account **deletion** is staged and honest — it never pretends to
erase instantly what backups may briefly retain. Inputs are size-limited and
plain-text-first; external links are protocol-allowlisted; errors never leak
stacks or secrets; and a strong Content-Security-Policy (no `unsafe-eval`) ships
on every response. No AI, no content logging, no hidden telemetry. See
`SECURITY_AND_PRIVACY.md`.
