# LIFEOS-085 — Universal Search / Find Anything

**North star:** if Conqify knows it, I should be able to find it in seconds.

## STATUS: AUDIT WRITTEN — IMPLEMENTATION NOT STARTED

| | |
|---|---|
| Base SHA | `c630736e49ab3bce420d561b31583b3f2ce516ea` (PR #90 merged) |
| Branch | `claude/lifeos-085-universal-search` |
| Migration required | **no** — composition, indexing and UI |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Produced by running the real `buildIndex` / `searchFlat` / `searchGrouped` over a
fixture built from §3's own example: Goal "Graduate school", Project "Fall
applications", Action "Request recommendation letter" linked through it, a
reflection about philosophy and teaching, a document, two standards, a protocol
about anger, two waiting records, a note, an AI-authored note, an archived note,
and a raw capture that already produced a confirmed action.

## 1.1 A — What search surfaces exist

**One, and it is good.** LIFEOS-027's command palette (`⌘K` / `Ctrl+K`), reached
from the nav button, the keyboard, and `MobileCommandTrigger`'s thumb-reachable
bar on small screens. It already has combobox/listbox semantics,
`aria-activedescendant`, arrow/Enter/Escape, a focus trap, pinning and recent
history.

There is **no** `/search` route and no second palette. LIFEOS-030's workspace
search explicitly reuses the same engine rather than forking it.

**So §4 is already satisfied: this sprint improves the palette in place and adds
no route.**

## 1.2 B / C — Which domains are indexed

`buildSearchEntries` covers **27 kinds**, more than the sprint's target list:
actions, goals, projects, milestones, notes, reflections, events, documents,
authors, passages, highlights, annotations, captures, protocols, constitution
elements, decisions, daily reviews, workspaces, sources, and the knowledge side.

**Coverage is not the problem.** Recall is.

## 1.3 E / F — What actually matches

`scoreEntry` is **contiguous-substring only**. The whole normalized query must
appear as a literal substring of the title, an alias, or the body. There is no
token matching, no stemming and no semantic layer anywhere in the product.

That single fact produces most of what follows.

## 1.4 The measured reds

### RED 1 — the sprint's own headline query returns the three least useful records

```
Q: "grad school"   3 hits
     [title  ] capture     idea: audit a grad school seminar before applying
     [title  ] event       Advisor meeting about grad school
     [alias  ] document    Graduate programs in philosophy
```

Missing: the **Goal** "Graduate school", the **Project** "Fall applications",
the linked **Action**, the **Reflection**, and the **Rule**. "grad school" is
not a substring of "graduate school", so the goal the query names cannot be
found — while a raw inbox capture ranks first.

### RED 2 — every multi-word natural query returns nothing

```
"rules about anger"      0 hits
"things I'm waiting on"  0 hits
"my long-term goals"     0 hits
"notes from last week"   0 hits
```

Each names records that exist. `about`, `things`, `my`, `from` are not in any
title, so the contiguous phrase never matches.

### RED 3 — Personal Code is indexed and then labelled with its table name

```
Q: "anger"   groups: ["constitution_element"]
Q: "reply"   → constitution_element + protocol
Q: "application deadlines"   groups: ["note"]
```

`note`, `protocol` and `constitution_element` are all indexed but appear in
**neither `RECORD_LABELS` nor `RECORD_ORDER`**, so `searchGrouped` falls to its
defensive branch and renders the raw kind string as the group heading — §10's
prohibition verbatim — and sorts them after every labelled kind.

### RED 4 — the product answers the question and search says "No matches"

```
"what did I say about teaching?"  → 0 hits   (Memory routes: REFLECTION)
"what should I focus on?"         → 0 hits   (Memory routes: OPEN_WORK/focus)
"what changed with grad school?"  → 0 hits   (Memory routes: CHANGES/all)
```

The palette shows *"No matches. Press Esc to close."* while Memory and Guidance
would answer all three. There is no handoff (§16, §17).

### RED 5 — a raw capture duplicates the record it produced

```
Q: "recommendation"   2 hits
   action    Request recommendation letter
   capture   request recommendation letter from prof
```

The capture is `processed` — it already became that action — and adds no
wording the action lacks (§26, §27).

### RED 6 — an AI-authored note outranks a real project, unattributed

```
Q: "applications"   2 hits
   note     "AI summary: your applications are progressing well."
   project  Fall applications
```

Both score title-contains; the note wins the recency tiebreak. `SearchEntry` has
**no provenance field at all**, so nothing downstream could label it correctly
even if it wanted to (§12).

### RED 7 — a goal's horizon is not indexed

`{"kind":"goal","id":"g2","bodyLower":"run a marathon   "}` — title, description,
notes and tags only. "long-term goals" cannot work (§21).

### RED 8 — linked context is invisible

"grad school" cannot reach "Request recommendation letter", which is linked to
Project "Fall applications" under Goal "Graduate school" (§19).

## 1.5 Not reds — verified and kept as forward guards

- **Ranking precedence is already right** (§7, §9). exact 1000 → prefix 800 →
  contains 600 → alias 400 → body 200, with a total, stable tiebreak chain
  (recency → shorter title → id). Exact title already beats loose body matches.
- **Deleted records are already excluded** (§28). Archived notes, retired
  protocols, retired/draft constitution elements, rejected beliefs and archived
  concepts are all filtered at index time; the archived note in the fixture is
  absent. Hard deletions remove the row, so an index built from the store cannot
  surface them.
- **No duplicate search engine** (§2.D). Workspace search restricts the shared
  index and reruns the identical query.
- **No fake relevance score is exposed** (§8). Scores are internal; the palette
  shows `exact` / `starts with` / `title` / `alias` / `notes`.

## 1.6 J — The smallest architecture

Not a new engine. Four changes to the existing one, plus one composition layer:

1. **A token tier in `ranking.ts`**, below every substring tier, so phrase and
   exact matches keep winning. Root-causes REDs 1, 2 and 7.
2. **Labels and order for the three unlabelled kinds** — REDs 3.
3. **Provenance on `SearchEntry`**, from the existing `classifyOrigin` — RED 6.
4. **`lib/search/everything.ts`** — one pure `searchEverything(state, query,
   options)` composing the index with: question-intent handoff (reusing
   `planMemoryQuery`, not reimplementing it), one-hop linked context, capture
   suppression, date and status filters (reusing `resolveMemoryRange`, no second
   date parser), and a result cap.

## 1.7 Migration (§37)

**None.** Every input is already in the store and already indexed.

---

*Sections 2 onward are written as the implementation lands.*
