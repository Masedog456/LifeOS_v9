# LIFEOS-089 — Capture → Existing Context

**North star:** when I tell Conqify something new, it should connect it to what
it already knows before asking me to organize it.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `3664a223a4fcd98af7300e25ee99280daa40315e` (PR #94 merged) |
| Branch | `claude/lifeos-089-capture-existing-context` |
| Migration required | **no** — interpretation plus existing relationship writes (§43) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured, not read. A world with two live Goals, two live Projects, an abandoned
Goal, a completed Project, six Actions (one already completed, one waiting, one
linked directly to a Goal with no Project, and two that both plausibly answer
"the recommendation request") was run through the **actual** pipeline:
`readChanges` → `detectTemporalEdit` → `detectCompletion` → `interpret` →
`matchRecords`.

Fixture: `scratchpad/fx89.js`. Probes: `probe89.cjs`, `p89b.cjs`, `p89c.cjs`.

## 1.1 A — What existing-context matching already happens

Two mechanisms, both real, both narrow:

**`matchRecords` (LIFEOS-060)** — whole-title, whole-word containment against
Projects, then Goals, then Workspaces. Archived, completed and abandoned records
are already excluded. Single-word generic titles ("Work", "Home") are excluded.
Projects win outright over Goals. Result is `strong` / `ambiguous` / `none`, and
it already rides on every candidate as `Candidate.association`.

**`matchEditTargets` + `authorityFor` (LIFEOS-065/066)** — content-word coverage
against existing Actions and Events, with an exact-title tiebreak and **no
recency tiebreak**. `authorityFor` is purely `0 → no_match`, `1 → unambiguous`,
`>1 → ambiguous`.

## 1.2 B — Which candidate types can already match an existing record

| Path | Matches existing? | Evidence |
|---|---|---|
| Completion language | **yes** — Actions/Events | `detectCompletion` → `matchEditTargets` |
| Temporal edit language | **yes** — Actions/Events | `detectTemporalEdit` |
| Any candidate | Project / Goal / Workspace, whole-title only | `Candidate.association` |
| Waiting, Reflection, Protocol, Note | same whole-title association, nothing more | — |

## 1.3 C — Where Capture still creates disconnected records

Measured on the brief's own sentences (`today = 2026-09-05`):

```
"Email Marcus about the clinic lease tomorrow."
  → action/high  dueDate 2026-09-06  association: NONE
    (project "Clinic launch" exists; open action "Read the clinic lease" exists)

"I'm waiting on Maria for the transcript."
  → waiting/high  waitingOn "Maria"  association: NONE
    (open waiting action "Ask Maria for the transcript" in "Fall applications" exists)

"I'm worried about the grad school applications."
  → note/possible  association: NONE
    (goal "Graduate school" and project "Fall applications" both exist)

"When I'm overwhelmed with applications, do one school at a time."
  → protocol/high  association: NONE
```

Every one of these is the north star's failure mode: the rest of the user's life
is treated as blank.

The reason is precise and not a bug — `matchRecords` requires the record's
**whole title** to appear as whole words. "clinic lease" does not contain
"Clinic launch"; "grad school" does not contain "Graduate school". When a title
does appear verbatim it works exactly as designed:

```
"Send the Fall applications checklist to Priya."
  → action/high  association: STRONG project "Fall applications"
```

## 1.4 D — Can Goal / Project matching be reused safely

Yes, and it must be. `matchRecords` already carries the status filter (§40), the
generic-title guard, the project-over-goal precedence, and the
strong/ambiguous/none authority the confirmation UI already renders. LIFEOS-089
extends it with a second, looser tier **behind** it — never in front (§22).

## 1.5 E — People (§14, §36)

`personHint` / `longerForms` / `namesPerson` from LIFEOS-086 apply unchanged. A
name in a capture is a **text reference**, not an identity. "Marcus" and "Marcus
Webb" stay distinct. No Person domain, no merging.

## 1.6 F / §32 — Search reuse

`buildIndex` (`lib/command/search.ts`) builds one entry per record with a
lowercased title and aliases. It is the right shape but the wrong cost model for
this: Capture needs *which records share a distinctive word with this clause*,
which is an inverted index question, not a ranked-search question. Building a
title-token index **once per interpretation** answers it in one pass and avoids
re-scanning the store per candidate (§42). Full universal-search UI logic is not
run per clause.

## 1.7 G / H — Which links can be proposed, and which can be written

Everything this sprint proposes is already representable **and already
writable**:

* `CommitCandidate` carries `projectId`, `goalId` and `workspaceId`.
* `toCommitCandidate` applies them through `associationFields`.
* `commitCapture` → `createAction` persists them.
* `updateAction(id, { projectId, goalId })` is the domain setter for an existing
  record (§29). No raw store writes from the UI.
* `Project.goalId` already exists, so **Goal context is inherited through a
  Project** and needs no second link (§13).

**No schema. No migration. Head stays at 0047.**

## 1.8 I — Where matching becomes ambiguous

Three distinct places, all of which must produce a question rather than a pick:

1. **Two existing Actions cover the same query** — already handled:
   `"the recommendation request"` → `ambiguous`, two targets, nothing
   preselected.
2. **Two records share the same distinctive word** — new, and must degrade to
   `AMBIGUOUS` rather than choosing.
3. **A Goal and a Project both match** — *not* ambiguity. §11 says show both.

## 1.9 J — The smallest composition layer

`lib/capture/context.ts`: `buildCaptureContext(candidate, state, idx, today)`
returning `CaptureContextSuggestion[]`. Pure, derived, never persisted. It adds
**one** matching idea to the codebase — a shared *distinctive* title token — and
reuses everything else.

## 1.10 The measured reds

### RED 1 (§9) — a new Action gets no Project context

`"Email Marcus about the clinic lease tomorrow."` produces an Action with
`association: none`, while `Clinic launch` and its open action `Read the clinic
lease` sit in the store. **Confirmed.**

### RED 2 (§13) — Goal ancestry is never shown

Even in the working case (`Fall applications` matched STRONG), the Goal that
Project supports — `Graduate school` — is never surfaced. The user is shown one
level and has to remember the other. **Confirmed.**

### RED 3 (§10, §16) — a reflection gets no Goal context

`"I'm worried about the grad school applications."` becomes a plain **note**
with no context at all. **Confirmed.**

### RED 4 (§17) — a Protocol candidate gets no Goal context

`"When I'm overwhelmed with applications, do one school at a time."` →
`protocol/high`, `association: none`. **Confirmed.**

### RED 5 (§15) — a waiting candidate gets no context

`"I'm waiting on Maria for the transcript."` → `waiting/high`, `waitingOn:
"Maria"`, `association: none`, despite an existing open wait on Maria for the
transcript inside `Fall applications`. **Confirmed.**

### RED 6 (§38) — a negated mention is offered as context

```
"This isn't about graduate school anymore."
  → association: STRONG goal "Graduate school"
```

`detectStance` returns `asserted`, correctly: its contract is the *commitment
operator* ("I no longer want…", "I used to…"), and this sentence negates
**aboutness**, not wanting. Widening `stance.ts` would break the distinction it
exists to hold, so the reference-scoped guard belongs in the new module.
**Confirmed.**

### RED 7 (§39) — a historical mention links to the current Goal

```
"When I was applying to graduate school, I hated recommendation letters."
  → association: STRONG goal "Graduate school"   (and, separately, protocol/high)
```

`detectStance` again says `asserted` for the same reason. The historical frame
is in the *clause around the mention*, not in the commitment operator.
**Confirmed.**

## 1.11 Not reds — verified, and kept as forward guards

The brief's §44.1, §44.6, §44.7 and §44.8 were measured and are **already
correct**. They become mutation targets, not fixes.

* **§44.1 / §6 — completion matches an existing Action before creating.**
  `readChanges` runs *before* `interpret` in `CaptureComposer.look()`.
  `"I finished the recommendation request."` yields
  `operation: "complete"`, `targetQuery: "recommendation request"`,
  `authority: "ambiguous"`, two candidate matches. It never reaches the
  create path. My first probe read the wrong field and appeared to show a
  duplicate; the pipeline was right and the probe was wrong.
* **§44.6 / §24 — ambiguity is never resolved silently.** `authorityFor` has no
  recency tiebreak, by explicit design in `completion.ts`.
* **§8 — completed records.** `"I finished the deployment."` → `no_match` with a
  refusal that says nothing was marked complete. A completed Action can still be
  *matched* by `matchEditTargets` (`"Order transcripts"` returns the completed
  one) — so the new layer must filter live-only itself.
* **§44.7 / §12 — no Project is invented.** Nothing in the pipeline creates a
  Project to hold an Action.
* **§44.8 / §40 — an abandoned Goal is not offered.**
  `"Practise Portuguese for twenty minutes."` → `association: none`, because
  `matchRecords` already filters `abandoned` / `completed` / `archived`.
* **§41 — deleted records.** `deleteAction` removes the row from the array; there
  is no in-store tombstone a matcher could see. Satisfied by construction.

## 1.12 Migration (§43)

**None required.** Every proposed link is `Action.projectId`, `Action.goalId`, or
the inherited `Project.goalId` — all existing, all writable through existing
domain setters. `0048` is not written.

---

# 2. The existing-context architecture

`lib/capture/context.ts` — pure, derived, never persisted (§4).

```
buildCaptureContextIndex(state)     once per interpretation (§42)
suggestContext(candidate, state, index)  → CaptureContextSuggestion[]
contextFields(accepted, kind)       → { projectId?, goalId? }
contextKnowledgeGoal(accepted, kind) → a Goal id, for note-shaped kinds
```

## 2.1 The one new matching idea

A **shared distinctive title word**. A capture word grounds a match against a
live Project or Goal when it is a **prefix** of a word in that record's title
AND no other record of that kind is reached by the same word.

* **Prefix** is LIFEOS-085's rule, taken for 085's reason: it is what lets
  "grad school" find "Graduate school", and it is one-directional, so "school"
  never matches "sch".
* **Distinctive** is what keeps it honest. A word reaching two Projects is a
  coin flip, so it grounds no link — there is no threshold to tune, and the
  explanation names the word (§20, §21).
* **Not semantic.** "Call Maria" cannot reach "Call Marcus": they share only
  "call", which reaches both (§7).
* **Verbs are excluded.** A verb is what you DO, not what a Project is ABOUT,
  and titles routinely open with one.

## 2.2 The tiers, in precedence order (§22)

| Tier | Source | Class |
|---|---|---|
| 1 | `matchRecords` — whole title, verbatim (060) | `exact` |
| 2 | `matchEditTargets` — every content word covered (065/066), live only | `strong` |
| 2b | ≥2 shared distinctive words against a live Action | `possible` |
| 3 | 1 shared distinctive word against a live Project / Goal | `possible` |
| — | several records reached equally | `ambiguous` |
| 4 | LIFEOS-086 name references | `possible`, never a link |

An exact match is taken first and a looser one never displaces it, so a fuzzy
recent Project cannot outrank an exact old one.

# 3. Action match semantics (§6, §7, §8)

**Completion language is not this layer's job and was already correct.**
`readChanges` runs *before* `interpret` in `CaptureComposer.look()`, so
"I finished the recommendation request." becomes a `complete` intent with two
candidate matches and `ambiguous` authority. It never reaches the create path.
089 asserts this rather than changing it.

Where this layer does surface an existing Action, it is a **handoff, not a
mutation** (§27): the row links to the record and says "Nothing has been
changed." Completed Actions are filtered out (§8) — `matchEditTargets` returns
them, so the filter lives here rather than being assumed.

# 4. Project and Goal context (§9–§13)

A Project's Goal arrives **inherited**, never as a second link:
`Project.goalId` already carries it and 087/088 already read it, so writing
`action.goalId` alongside would say the same thing twice.

**Goal-only linkage is first-class** (§12). A Goal match never forces a Project
into existence, and no code path in this layer can create one.

**One hop** (§23): candidate → Project → its Goal, and it stops.

## 4.1 What each kind can actually hold

"Can be linked" turned out to be two questions, not one:

```
FIELD_LINKABLE_KINDS   action, waiting, event            → projectId
GOAL_LINKABLE_KINDS    action, waiting, event, project   → goalId
everything else        note, reflection, protocol        → goal.linkedKnowledge
```

A new Project has no `projectId` and *does* take a `goalId` —
`commitCapture` passes one straight to `createProject`. A note-shaped kind has
neither, so a Project match on one is **promoted to the Goal that Project
supports** before it ever reaches the user, and attaches through
`linkGoalKnowledge` (§16, §17, §33).

# 5. People (§14, §36)

LIFEOS-086 unchanged. A name is a **text reference**, never an identity.
"Marcus" and "Marcus Webb" stay two references and the longer form travels with
the shorter as unresolved ambiguity. No Person domain, no merging, no id on a
person suggestion — inventing one would be the first step toward the domain the
brief forbids.

A word that is part of a Project or Goal title is **not** a person: `personHint`
finds a name anywhere in the store, and where it found "Portuguese" and "Fall"
was a record title.

# 6. Ambiguity (§24)

Three shapes, all of which produce a question:

1. two records reached by two different distinctive words
2. **one word reaching two records** — this was silently dropped in the first
   draft, and hiding an ambiguity is the defect §24 exists to prevent
3. two open Actions covering the same clause

Nothing is ever preselected, and `contextFields` writes nothing from an
ambiguous row.

# 7. Authority and relationship writes (§5, §29, §30, §37)

Nothing in `lib/capture/context.ts` writes anything. Every link is
`confirm`-tier; a person reference is `auto_safe` and is not a link at all.

Writes go through paths that already exist: `CommitCandidate.projectId` /
`.goalId` → `commitCapture` → `createAction` / `createProject`, and
`linkGoalKnowledge` for note-shaped kinds. No raw store writes from the UI.

**No existing record is reorganized** (§37). The layer proposes context for the
record being created; it never moves an Action between Projects.

**Provenance is untouched** (§30). A user-written capture stays user-authored;
accepting a Project link changes no authorship field.

# 8. Performance (§42)

The index is built **once per interpretation**, not once per candidate.
Measured in the suite at 100 / 1,000 / 5,000 actions: index build under 500ms
and five matches under 1,500ms at every size, with the real numbers far below.

# 9. Verification

| Gate | Result |
|---|---|
| Deterministic (53 suites) | **5,513 / 5,513** |
| LIFEOS-089 suite | **99** assertions |
| Mutation testing (§46) | **24 applied, 24 caught, 0 escaped** |
| Browser torture 089 (§45) | **66 / 66** (desktop + mobile) |
| Browser 078 / 079 / 080 / 081 | 97 / 97 / 109 / 72 |
| Browser 082 / 083 / 084 / 085 | 64 / 77 / 62 / 54 |
| Browser 086 / 087 / 088 | 53 / 52 / 83 |
| Release audit · export verify | 17/17 · 14/14 |
| Security audit · route smoke | pass · 24/24 |
| `tsc` · `eslint` · `next build` | clean |

## 9.1 What the mutations found

Five mutations survived a first run and one patch failed to apply. **None was a
product defect.**

* **Two fixture gaps** — nothing had a Project and an *unrelated* Goal both
  matching, and nothing produced more suggestions than the cap. A fixture that
  never exceeds a cap cannot test the cap.
* **One assertion aimed at the wrong thing** — 89.15 claimed to prove the
  prefix direction but only asserted the tokenizer kept the word; the match was
  carried by a different record entirely.
* **Two assertion gaps the refactor opened** — only the `possible` tier's
  inherited Goal was asserted, and the `projectId` guard was only ever
  exercised with rows that had no Project in them.
* **One semantic no-op** — reverting the title-side word filter cannot change
  behaviour while the capture side still filters. Replaced with one that does.
* **One failed patch**, which the harness refuses to count as an escape.

One dead branch was **removed** rather than left as code no test could redden.

## 9.2 What the visual review found (§47)

* The inherited-Goal line printed *"Supports Goal Open the clinic. This Project
  already supports that Goal."* — the same fact twice, in two wordings.
* A Protocol was offered a **Project chip that could never be honoured**.
  `contextFields` returns nothing for a protocol, so the chip would look
  accepted and write nothing — the exact defect the composer's own comment
  records from LIFEOS-080. Fixing it exposed the coarse kinds list in §4.1.

## 9.3 One prior-sprint fixture was fixed

085's browser assertion 25 pinned a note to `at(-5)` and queried "notes from
last week". The window jumps once a week; a day offset slides once a day, so
the note sat on the last day of the window and fell out of it the next morning.
It now derives midweek of the previous week from the same boundary the query
uses. **Not a regression from 089** — this sprint touched no search code.

# 10. Known gaps

* **"I'm worried about the grad school applications." is classified `note`, not
  `reflection`.** That is LIFEOS-080's classifier, and §53 says close 089 only.
  The context behaviour is identical for both kinds.
* **An existing-Action match does not expose that Action's own Project or
  Goal.** Candidate → Action → Goal is a second hop, and §23 asks for restraint.
* **A capture reaching an Action under a paused Project gets no Project
  context.** The paused state is the user's decision about that work.
* **The mobile command bar overlays the context panel** on a narrow viewport.
  Pre-existing and global, not introduced here.
* **Names are still plain strings.** 086's limitation, unchanged by design.

# 11. Product claims (§51)

1. Capture matches a likely existing Action before creating a duplicate —
   through `readChanges` for completion language, and through a
   distinctive-word tier for everything else.
2. Ambiguous matches require a choice, whether two records were reached by two
   words or by the same one.
3. New Actions receive grounded Project suggestions, each naming the word it
   matched on.
4. Goal-only context works, and no Project is ever invented.
5. A Project's ancestry exposes its Goal as inherited fact, stated once.
6. Reflections carry context without becoming tasks.
7. Protocols carry context without being created.
8. Person references stay textual and unmerged under 086's rules.
9. Every consequential link requires confirmation; nothing in the layer writes.
10. Confirmed links appear in the 087 Project view and the 088 Goal view with
    no 089-specific storage.
11. The raw capture is preserved exactly, including where context is withheld.
12. No migration, no new graph system, no embeddings, no Person domain.
    Migration head stays at **0047**.
