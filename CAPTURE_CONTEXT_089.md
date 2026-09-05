# LIFEOS-089 — Capture → Existing Context

**North star:** when I tell Conqify something new, it should connect it to what
it already knows before asking me to organize it.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
