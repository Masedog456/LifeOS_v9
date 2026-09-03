# LIFEOS-079 — Rules / Personal Code

**North star:** help me remember how I want to act when life gets messy.

## STATUS: DESIGN READY — AWAITING ARCHITECTURE DECISION (§4/§5)

| | |
|---|---|
| Base SHA | `608ea8696f4c22dd7db0a1b961256e514fb36a28` (PR #84 merged) |
| Branch | `claude/lifeos-079-rules-personal-code` |
| Repository migration head | 0047 |
| Migration proposed | **none — see §5 below** |

The audit's finding is unusual and worth reading before the recommendation: **the
persistence layer for Rules already exists, is complete, and was deliberately
designed for exactly this.** What is missing is a product surface and a handful
of derivations. This document proposes reuse, and asks one question (§7) before
implementation begins.

---

## 1. Audit

### A. What does Constitution represent today?

`ConstitutionElement` (LIFEOS-056, migration 0038; revisions 0038/0039).

```ts
kind: "purpose" | "value" | "principle" | "standard"
statement            // the user's own words, never rewritten
note?                // "why this matters to me", never generated
status: "draft" | "active" | "retired"
adoptedAt?           // LOAD-BEARING: unset ⇒ not constitutional
retiredAt?
supersedesId?        // replaces a prior element; never deletes it
workspaceId?         // optional Life Area
linkedRefs           // references to practices, protocols, actions, projects…
sourceCaptureId?
fromAiText?          // adoption never clears this
excludeFromAi?
```

Plus `ConstitutionRevision` — an append-only history with a change vocabulary
that already distinguishes the cases §25/§26 care about:

```
created · adopted · edited · revised · relinked · retired · readopted
```

`edited` (typo) vs `revised` (position changed) is decided deterministically by
`lib/constitution/revision.ts`, and a `revised` transition carries a
`successorId` pointing at the element the new wording produced.

The kind labels and hints already read as operating principles:

| kind | label | hint |
|---|---|---|
| `purpose` | Purpose | "What this life is for. There are usually very few." |
| `value` | Value | "What matters to you." |
| `principle` | Guiding Principle | **"How you intend to act."** |
| `standard` | Standard | **"A specific bar you hold yourself to."** |

### B. What do Protocols represent today?

`Protocol` (LIFEOS-054, migration 0037): **WHEN / IF [trigger] → [response]**.

```ts
trigger    // stored WITHOUT its leading "when"/"if"
response
reason?
status: "active" | "paused" | "retired"
sourceCaptureId?
fromAiText?
```

Its doc comment already forbids what §12 forbids: *"there is no streak, no
compliance rate and no success score… Nothing in the product schedules it,
watches for its trigger, or notifies on it — there is no rule engine here."*

### C. Is there already a "rule" or "standard" domain?

**Yes — twice, and the decision was explicit.** LIFEOS-056's own type comment
records it:

> `boundary`, `rule`, `identity`, `aspiration`, `question` and `commitment` are
> deliberately absent. **A boundary is a negatively-stated `standard`; a rule is
> a `Protocol` (conditional) or a `standard` (unconditional)**; the rest are
> deferred until beta evidence, each with a named home.

So a previous sprint asked this exact question, answered it, and wrote the answer
into the schema. Introducing a `Rule` noun now would silently overturn a recorded
architectural decision.

There is also a knowledge-side `Principle` (migration 0013) — statements that
organize concepts and beliefs. It is a **different object** and 056 already
guards the collision by labelling the constitutional one "Guiding Principle".
Rules must not land there.

### D. Where would a new Personal Code domain duplicate existing concepts?

Every field the brief's §6 asks for already exists:

| §6 asks for | Exists as |
|---|---|
| title | `ConstitutionElement.statement` (Rules are one sentence; a separate title is a second place for the wording to drift) |
| statement | `statement` |
| context / trigger | `Protocol.trigger`, or `ConstitutionElement.note` |
| status | `active / paused / retired` — Protocol exactly; Constitution has `draft/active/retired` |
| provenance | `fromAiText` + `sourceCaptureId` + the shared origin classifier |

A `rules` table would duplicate a schema, a set of RLS policies, an export
domain, a sync mapper, a search-index entry, a tombstone path and a revision
history that all already exist — the precise cost 056 refused to pay twice.

### E. Which existing domain can be reused?

Both, split by shape — which is already how the codebase thinks:

- **Unconditional DO / DON'T** → `ConstitutionElement` with `kind: "standard"`.
  *"Do not lie to avoid embarrassment." · "Tell the truth even when it's
  embarrassing." · "Protect sleep before optional work."*
- **WHEN / THEN** → `Protocol`.
  *"When I am angry, wait 20 minutes before sending a message." · "When I feel
  overwhelmed, write down the next physical action."*

Every one of §36's seven example Rules lands cleanly in one of the two.

### F. What can be represented without a new persistence noun?

Everything this sprint needs:

- **Personal Code view** — a derived projection over `standard` elements +
  Protocols. No storage.
- **Active / paused / retired grouping** — existing statuses. (`standard` has
  `draft` rather than `paused`; see §7.)
- **Rule → Constitution linkage** — `supersedesId` and the `principle`/`value`
  kinds are already there; a Rule that operationalizes a value is a `standard`
  whose `linkedRefs` name it, or simply a sibling in the same Constitution.
- **Rule → Protocol / Goal linkage** — `linkedRefs: RecordRefLite[]` already
  accepts any kind.
- **Today context** — **already built and already wired.** `buildTodayIndexes`
  constructs `constitutionByAction` from adopted elements' `linkedRefs`, and
  `recommend.ts` emits a `linked_constitution` reason. §18 of LIFEOS-072 states
  the rule 079 §14 asks for: *"the Constitution contributes CONTEXT, never rank."*
  Protocols have no equivalent bridge yet.
- **Search** — both kinds are already in the command index
  (`lib/command/records.ts`).
- **Lifecycle history** — `ConstitutionRevision` covers §25/§26 completely.
  Protocols have **no** history (a gap; see §8).
- **Provenance** — `fromAiText` is already documented as surviving adoption.
- **Capture safety** — `FORBIDDEN_CANDIDATE_KINDS` already blocks capture from
  writing `constitution`, `constitution_element` and `principle`. Capture *can*
  create Protocols, and does, on confirm.

### G. The boundary

| | Answers | Home |
|---|---|---|
| **Constitution** (`purpose`, `value`) | what I believe / what matters | `constitutionElements` |
| **Rule — unconditional** | a bar I hold myself to | `constitutionElements`, `kind: "standard"` |
| **Rule — conditional** | when X, choose Y | `protocols` |
| **Protocol (multi-step)** | the sequence for a recurring situation | `protocols` — see §7 |
| **Habit** | repeated behaviour | `practices` (`PracticeCadence`) |
| **Goal** | desired outcome | `goals` |
| **Task** | executable step | `nextActions` |

---

## 2. What is genuinely missing

Not storage. Four things:

1. **A surface.** There is no view that answers *"what standards have I chosen
   for myself?"*. `/constitution` shows all four kinds together; `/protocols`
   shows conditionals separately. A person's operating code is split across two
   pages with no shared frame.
2. **Protocol lifecycle history.** `Protocol` has no history array and no
   revision record, so §24's *"when did I change this rule?"* and §26's material
   wording change are **unanswerable for conditional rules**. Constitution
   answers both.
3. **Memory.** No goal-style query class exists for normative records, and
   `constitution_element` is on `MEMORY_EXCLUDED_KINDS` — deliberately, by 056.
   §24's seven questions currently return nothing. (See §7 — this is a real
   tension, not an oversight to steamroll.)
4. **Conflict surfacing** (§32) and **near-duplicate detection** (§20) — neither
   exists for normative records.

---

## 3. Recommendation

**Reuse. No new persistence noun, no migration.**

"Personal Code" becomes a **user-facing frame over two existing domains**, not a
third domain. The word "Rule" names what the user sees; `standard` and `Protocol`
remain what the system stores.

This is the LIFEOS-052 `Note` precedent and the 056 decision, applied
consistently rather than reversed one sprint later.

---

## 4. Open questions — I need decisions on these before implementing

### Q1. `standard` has no `paused` state (§11)

`ConstitutionStatus` is `draft | active | retired`. `ProtocolStatus` is
`active | paused | retired`. §11 asks for `active / paused / retired`.

For an unconditional Rule, "paused" would have to map to `draft` (never adopted)
or `retired` (no longer adopted) — and neither means *"I still hold this, I'm
just not applying it right now."*

Options:
- **(a) Accept the difference.** Conditional Rules pause; unconditional ones are
  adopted or retired. The Personal Code view says so plainly. **No migration.**
- **(b) Add `paused` to `ConstitutionStatus`.** `status` is plain `text` in 0038
  with **no CHECK constraint**, so this needs **no migration** — but it changes
  the meaning of a shipped normative domain and touches `activeConstitution`,
  the revision vocabulary, and the adopt/retire flows.

**My recommendation: (a).** It is honest about what the two domains mean, and it
avoids editing the semantics of the Constitution to make a new view tidier.

### Q2. Memory and the Constitution exclusion (§24 vs LIFEOS-056)

`MEMORY_EXCLUDED_KINDS = ["belief", "constitution_element"]`, and 056's comment
is emphatic: *"The Constitution and Beliefs are what the user holds to be true
about themselves, not a record of what happened… A question about last week has
no business reaching either."*

§24 asks Memory to answer *"what rules do I live by?"*. That is **not** a
question about last week — it is a direct question about the Constitution, asked
by its owner.

Options:
- **(a) A dedicated `RULES` query class** that reads normative records only when
  the question explicitly asks about rules, leaving `MEMORY_EXCLUDED_KINDS`
  intact for every retrieval-shaped question. The exclusion keeps doing its job:
  "what did I finish last week?" still cannot reach the Constitution.
- **(b) Remove the exclusion.** Rejected — it would let topical retrieval pull
  constitutional statements into unrelated answers, which is what 056 forbade.

**My recommendation: (a).** It is the same shape as LIFEOS-078's `GOALS` class,
and it preserves the 056 boundary rather than deleting it.

### Q3. Protocol history (§24, §25, §26)

Conditional Rules cannot answer "when did I change this?" because `Protocol` has
no history.

Options:
- **(a) Report the limitation.** §24 explicitly permits this: *"If the
  persistence model cannot support lifecycle history: report the limitation."*
  Personal Code shows lifecycle history for unconditional Rules and says plainly
  that conditional ones record only their current state.
- **(b) Add `history jsonb` to `protocols`.** This is **migration 0048**, and
  under §41/077 it needs the capability-advertisement analysis and a contract
  bump — the same Type B shape as 0047. It would make the two halves of Personal
  Code behave identically.

**My recommendation: (a) for this sprint**, with the limitation stated in the
report and the tests. (b) is a real improvement but it is a migration, and §5
says stop before writing one. If you want (b), say so and I will return the
exact schema proposal before writing any SQL.

### Q4. Where the surface lives (§45)

§45 prefers no new top-level destination. `/constitution` is already under
**Learn**, which is the wrong menu for "how do I want to act" — and Protocols
sits under **Capture**, which is also wrong.

Options:
- **(a) A `/personal-code` route, linked from the existing Constitution page**
  and added to the **Reflect** menu, with `/protocols` kept as-is.
- **(b) A tab/section inside `/constitution`.** No new route at all, but it
  buries conditional Rules inside a page named for something else.

**My recommendation: (a).** One new route, one new nav entry under an existing
menu, no new top-level destination.

---

## 5. Migration decision

**No migration is required for the recommended path.**

- `standard` and `Protocol` already carry every field §6 asks for.
- `ConstitutionStatus` is unconstrained `text`, so even Q1(b) would need none.
- Only Q3(b) — Protocol history — would require **0048**, and I have not written
  it and will not without approval.

Because nothing is added to the wire, **no schema capability advertisement is
needed** and the 0045/0047 deploy-order hazard does not arise (§41).

---

## 6. What I will build once these are answered

Scoped to the brief, and no wider:

- `lib/code/` — the Personal Code projection: unify `standard` elements and
  Protocols into one read model, group by status, filter by context.
- Near-duplicate detection over normative statements, reusing the existing
  `lib/dedup.ts` machinery (§20). Suggest only; never merge.
- Conflict surfacing (§32) — deterministic, both sides shown, no winner.
- A `RULES` Memory class (Q2a).
- A Protocol→Today context bridge mirroring `constitutionByAction`, so
  conditional Rules can contextualize an action the same way (§14) — context
  only, absent from `GROUNDING_CODES`, ordering untouched.
- Capture: suggest-confirm for normative statements (§18/§19), reusing the
  existing conditional→protocol path and adding a bounded choice when a sentence
  could be a Rule, a value or a Goal.
- `/personal-code` (Q4a), a fast create path (§30), and a Rule card (§29).
- Red proofs (§38), browser torture (§37), performance (§40), provenance
  regression (§44).

---

## 7. Verdict

**LIFEOS-079 DESIGN READY — AWAITING ARCHITECTURE DECISION.**

No migration proposed. The four questions in §4 are the decisions I need; my
recommendation on each is **Q1(a) · Q2(a) · Q3(a) · Q4(a)**, which requires no
schema change at all.

If you approve those four as recommended, I will implement without returning for
further approval. If you want **Q3(b)** — Protocol lifecycle history — that is a
migration, and I will return the exact 0048 proposal first, per §5.

Nothing in §52 has been begun.
