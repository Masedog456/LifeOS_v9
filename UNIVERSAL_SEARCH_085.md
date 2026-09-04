# LIFEOS-085 — Universal Search / Find Anything

**North star:** if Conqify knows it, I should be able to find it in seconds.

## STATUS: COMPLETE

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


# 2. The chosen surface (§4)

**The existing command palette, improved in place.** `⌘K` / `Ctrl+K`, the nav
button, and `MobileCommandTrigger`'s thumb bar on small screens. No
`/smart-search`, `/universal-search`, `/find` or `/retrieval-center` was
created, and the workspace-scoped search still reuses the same engine.

# 3. What was built

## 3.1 A token tier in the existing ranker

The audit's root cause was that matching was contiguous-substring only. One tier
was added below every substring tier:

```
title-exact 1000 > title-prefix 800 > title-contains 600 > title-tokens 500
   > alias 400 > body-contains 200 > body-tokens 100
```

So §7 holds by construction: a whole-phrase hit always outscores the same
field's scattered-word hit, and an exact title can never be buried.

Token matching is **prefix, one-directional** — a query word must open a real
word — plus the single morphological rule English needs here, a trailing plural
`s`, guarded on length and on `ss`. That is deliberately not a stemmer (§30).

## 3.2 `lib/search/everything.ts` — one pure `searchEverything`

| Adds | Because the audit measured |
|---|---|
| Domain words as **filters** | "rules about anger" → 0; the store says Standard, the person says rules |
| Status words as filters | "things I'm waiting on" → 0 |
| Dates via `resolveMemoryRange` | "notes from last week" → 0; and there is no second date parser |
| Capture suppression | a processed capture duplicated the action it became |
| Domain precedence | a raw inbox capture ranked above the Goal the query named |
| One-hop links | a linked Action was unreachable from the goal that named it |
| Question handoff | three answerable questions returned "No matches" |

## 3.3 Ranking semantics (§8, §9)

Scores stay inside `ranking.ts`. Every row carries a **sentence** — "Exact title
match", "Title contains your words", "Linked to Graduate school", "Status is
waiting" — and never a percentage, confidence or rank. The suite asserts no
result object contains a `score`, `relevance` or `confidence` field at all.

Ties break totally: score → recency → shorter title → id, so the order does not
depend on the order records happen to sit in the store.

## 3.4 Handoff to Memory and Guidance (§16, §17)

Question intent is **syntactic**: opens with a question word, or ends with `?`.
Deliberately not "did `planMemoryQuery` return a plan" — that also routes
"things I'm waiting on" and "my long-term goals", which are searches for records
that Search should answer itself.

A question gets a handoff row to `/memory?ask=<question>` (which `AskMemory` now
reads and answers immediately) **and** its literal matches beneath. §17 forbids
reimplementing Memory's answer, not showing records.

## 3.5 Duplicate suppression (§26, §27)

Keyed on the **recorded link**, not text similarity: `sourceCaptureId`, written
by the store when a capture is processed. A capture that became something is
folded away; one that is still raw is kept, because it may hold wording nothing
else does. Access to the source is never destroyed — the capture stays on the
inbox and stays reachable from the record it produced.

## 3.6 Provenance (§12)

`SearchEntry` now carries `origin`, classified once at index time by the same
`classifyOrigin` Memory uses. "You wrote this" is earned only by kinds whose
authorship the schema guarantees; machine prose says "Written by Conqify"; a
source says "From a source"; everything else says nothing.

---

# 4. Domain coverage (§6)

Already 27 kinds before this sprint — coverage was never the problem. What
changed is that three of them (`note`, `constitution_element`, `protocol`) were
indexed but labelled nowhere, so the palette printed their table names and
sorted them last. All three now have product labels and a place in the order,
and the suite asserts **every indexed kind has both**, so a future domain cannot
be added and left unlabelled.

Documents, passages, highlights and reading notes were already indexed by
LIFEOS-028 and surface unchanged (§25). No file ingestion system was built.

---

# 5. Verification

| Gate | Result |
|---|---|
| Deterministic, all suites | **5031 / 5031**, 49 suites (was 4928 / 4928, 48) |
| `search` suite | **103 / 103** |
| Browser torture, 085 | **54 / 54** |
| Mutation proofs | **25 / 25 caught** |
| 078 / 079 / 080 / 081 / 082 / 083 / 084 browser | 93 / 97 / 109 / 72 / 64 / 77 / 62 — all pass |
| release-audit · rls · auth · routes · wiring · mappers | pass |
| export-verify · scan-secrets | pass |
| route-smoke (production build) | 24 / 24 |
| `tsc --noEmit` · `eslint` · `next build` | clean (2 pre-existing warnings) |
| Performance, 10,000 records | five queries of each shape under 3000ms |

## 5.1 The three mutations that escaped

None needed rewording; each test was measuring something other than its claim.

- **One-directional prefix matching** was probed with `"sch ool"`, which matches
  in *neither* direction — so making the matcher bidirectional changed nothing.
  Now probed with `"running"` against "Run a marathon", where the wrong
  direction visibly matches.
- **The stable-tiebreak test asked the same store twice.**
  `Array.prototype.sort` is stable, so an absent tiebreak simply preserves
  insertion order and both answers agree. It now searches the same records with
  the store array **reversed**.
- **The chip-intersection test** asserted `every(=== "goal")` over a list that
  was empty either way. It now uses a query where a widened chip would visibly
  match a Project, with a positive control proving that chip alone returns rows.

## 5.2 What §41's visual review found

Three defects that 95 deterministic and 54 browser assertions all missed,
because each row was individually plausible:

1. **"You wrote this" over a PDF written by Jane Reed.** `classifyOrigin`
   returns `unknown` for a Goal, an Action, an Event and a Document — nothing in
   the schema says who wrote their text — and the attribution helper treated
   anything not machine-produced as the user's own. That is exactly what the
   classifier's own documentation forbids: *uncertainty must not be rounded up
   into authorship.*
2. **A raw ISO key** where every other surface says "Tue, Aug 25".
3. **A linked row hardcoded `user_authored`**, so it claimed authorship directly
   beneath a Goal row that correctly claimed none. Both paths now ask the same
   classifier.

---

# 6. Known gaps, stated

- **No morphology beyond a plural `s`.** Searching "anger" does not reach a
  protocol phrased "angry": matching is prefix-based and the two words diverge
  after "ang". Each record is reachable by its own words, and a word both share
  ("reply") returns both. Bridging them needs a real stemmer, which §30 says not
  to build for this sprint.
- **No semantic search**, because the product has none to compose. Nothing was
  invented to fill the gap.
- **One hop only.** An Action linked to a matched Goal or Project appears; a
  record two hops away does not.
- **Attribution is conservative by design.** Most kinds say nothing about
  authorship, because the schema does not record it. That is the honest answer,
  not a missing feature.

---

# 7. Product claims (§45)

1. **One entry point finds records across domains** — `⌘K`, 27 kinds. ✅
2. **Exact matches outrank weaker ones** — asserted as a tier ordering, and
   mutation-proved three ways. ✅
3. **Personal Code is searchable** — Standards *and* Protocols, labelled Rule
   and Protocol. ✅
4. **Reflections are searchable with correct provenance** — and an AI note can
   never say "You wrote". ✅
5. **Current waiting is retrievable** — "things I'm waiting on". ✅
6. **Historical questions hand off to Memory.** ✅
7. **Guidance questions hand off to Guidance.** ✅
8. **Deleted items do not appear** — archived notes, retired standards and
   protocols, excluded at index time. ✅
9. **Raw source capture creates no duplicate spam** — keyed on the recorded
   link, and an unlinked capture is still kept. ✅
10. **Documents appear where indexing supports them.** ✅
11. **Search is stable and deterministic** — order independent of store order. ✅
12. **No migration and no new persistence noun.** Head stays at **0047**; the
    suite asserts no `searchHistory`, `searchIndexes` or `savedSearches`
    appeared, and that searching mutates nothing. ✅
