# LIFEOS-079 — Rules / Personal Code

**North star:** help me remember how I want to act when life gets messy.

## STATUS: COMPLETE — RULES / PERSONAL CODE READY

| | |
|---|---|
| Base SHA | `608ea8696f4c22dd7db0a1b961256e514fb36a28` (PR #84 merged) |
| Migration | **none** |
| Repository migration head | **0047**, unchanged |
| Schema capability advertisement | **not needed** — nothing was added to the wire |

---

## 1. Architecture: reuse, decided by an earlier sprint

The audit's finding was that Rules already had a home, and LIFEOS-056 wrote the
decision into the type itself:

> `boundary`, `rule`, `identity`, `aspiration`, `question` and `commitment` are
> deliberately absent. **A boundary is a negatively-stated `standard`; a rule is
> a `Protocol` (conditional) or a `standard` (unconditional).**

Every field §6 asked for already existed. So Personal Code is a **read model**
over two domains, and stores nothing of its own.

| | Home | Answers |
|---|---|---|
| **Unconditional rule** | `ConstitutionElement`, `kind: "standard"` | "Don't lie to avoid embarrassment." |
| **Conditional rule** | `Protocol` | "When I'm angry, wait before replying." |
| Constitution | `purpose`, `value`, `principle` | what I believe / what matters |
| Habit | `practices` | repeated behaviour |
| Goal | `goals` | desired outcome |
| Task | `nextActions` | executable step |

A `rules` table would have duplicated a schema, its RLS policies, an export
domain, a sync mapper, a tombstone path, a search-index entry and a revision
history that all already exist — and would have reversed a recorded
architectural decision one sprint after it was made.

### Why no migration was needed

Nothing new is persisted. `saveRule` writes an existing `ConstitutionElement` or
an existing `Protocol` through the store functions that already owned them, so
the row shapes on the wire are byte-identical to 0047's. The 0045/0047
deploy-order hazard does not arise (§41).

---

## 2. What was built

| Concern | Where |
|---|---|
| The projection — one code, both shapes | `lib/code/personal-code.ts` |
| Near-duplicate detection across both domains | `lib/code/duplicates.ts` |
| Tension surfacing across both domains | `lib/code/conflicts.ts` |
| The capture detector | `lib/code/normative.ts` |
| Store actions (`saveRule`, `retireRule`, `pauseRule`, `resumeRule`) | `lib/mvpStore.ts` |
| Memory `RULES` class | `lib/memory/query.ts`, `lib/memory/answer.ts` |
| Conditional-rule context for Today | `lib/today/indexes.ts`, `lib/today/recommend.ts` |
| The surface | `/personal-code`, `components/code/PersonalCodePage.tsx` |

**Navigation (§45):** one route, added to the existing **Learn** menu beside the
Constitution. No new top-level destination.

**Terminology (§46):** "Personal Code" and "Rule" reach the user. `standard`,
`Protocol` and `ConstitutionElement` never do — the create field routes on the
shape of the sentence, so a person never picks a domain.

---

## 3. The lifecycle asymmetry, stated rather than smoothed

The two halves genuinely differ, and Personal Code reports the difference:

| | Unconditional (`standard`) | Conditional (`Protocol`) |
|---|---|---|
| Not yet adopted | **draft** — written, not part of the code | — |
| In force | active | active |
| Held, not applied | — **no `paused` state** | **paused** |
| No longer held | retired | retired |
| Lifecycle history | full (`ConstitutionRevision`) | **none** |

`paused` was NOT added to `ConstitutionStatus` for UI symmetry (§3 of the
approval). Writing `draft` to mean "paused" would claim the user never adopted a
standard they still hold, which is a different and false statement. The Pause
control simply does not appear on an unconditional rule, and the view labels
`draft` as "Not adopted yet".

---

## 4. The Protocol-history limitation

`Protocol` carries no history, so **"when did I change this conditional rule?"
is unanswerable**, and 0048 was not written (§4, §20 of the approval).

`updatedAt` is deliberately not offered as a substitute. It moves when a typo is
fixed, so presenting it as the date a rule changed would invent a life event —
the same class of overclaiming LIFEOS-078 refused for goals.

Where this surfaces:

- `CodeRule.hasLifecycleHistory` carries the fact on the record, so no caller
  has to remember it.
- The Personal Code page prints `PROTOCOL_HISTORY_LIMITATION` whenever any
  conditional rule is shown.
- The Memory `history` aspect returns `NO_RECORDED_EVIDENCE` with that
  limitation rather than a fabricated date. A mutation that falls back to
  `updatedAt` turns the assertion red.

---

## 5. Authority and provenance

**Capture may PROPOSE a rule and can never CREATE one.** `standard` is the first
member of `CandidateKind` with authority `never_auto`, and both conversion paths
(`convertCapture` and the bulk path) refuse it, so a normative sentence reaches
the Personal Code create flow and a person decides.

`FORBIDDEN_CANDIDATE_KINDS` is unchanged — `belief`, `constitution_element` and
`principle` still cannot even be suggested. The new
`SUGGEST_ONLY_CANDIDATE_KINDS` is the narrower tier this needed.

The card says so on screen: *"Conqify will not create this for you."*

**Provenance is untouched.** `fromAiText` passes through `saveRule` with no
branch that clears it, so a wording kept from an AI suggestion still reads as
machine prose after adoption — and Memory attributes it accordingly rather than
saying "You recorded" (asserted at 79.68/79.69).

---

## 6. Capture, Today, duplicates, conflicts

**Capture (§8).** A conditional normative sentence keeps its existing working
route to `protocol`. An unconditional one is detected by a literal, reviewable
marker list, guarded by an occasion test (a dated or single-occasion sentence is
not a standing rule) and by delegating the conditional test to
`extractConditional` — the same function the protocol classifier uses, so the
two cannot drift.

**Today (§11, §15).** A conditional rule whose words overlap an action's title
is appended as one context line *after* the ordering has run, with a code absent
from `GROUNDING_CODES`. It cannot move a recommendation and cannot make an
ungrounded action recommendable. No Personal Code section was added to Today.

**Duplicates (§9).** Checked *before* the write, across both domains, with the
shared words shown. Three bounded choices, none destructive, and no merge exists
in the module at all.

**Conflicts (§10).** A tension needs opposite direction words *and* a shared
subject. Both rules are returned; there is no winner field, no score, and the
wording hedges (*"may point in different directions here"*) because whether they
truly conflict depends on a situation the product cannot see. Retired rules are
never in tension — the user already decided.

---

## 7. Evidence

| Gate | Result |
|---|---|
| `tsc --noEmit` · `eslint` · `npm run build` | clean · clean · exit 0 |
| Deterministic selftests | **4350/4350** across 43 suites |
| …of which new this sprint | **98** (`lib/code/selftest.ts`) |
| `scripts/smoke-079-personal-code.cjs` (browser, 2 viewports) | **97/97** |
| `scripts/smoke-076-sync-trust.cjs` | 281/281 |
| `scripts/smoke-078-goal-horizons.cjs` | 93/93 |
| `scripts/inject-077-schema-compatibility.cjs` | 51/51 |
| `scripts/inject-078-goal-capability.cjs` | 43/43 |
| `release:audit` · `release:routes` · `release:export` | 17/17 · 24/24 · 14/14 |
| `npm run audit:security` | RLS · secrets · routes · auth · deps all PASS |

Migration rehearsal and schema-compatibility gates were **not** re-run for
schema reasons — no schema was touched — but the compatibility harnesses were
run anyway to confirm nothing regressed.

### Performance (§40)

At **5000 rules** (2500 standards + 2500 protocols), asserted with budgets in
the suite: listing under 400ms, duplicate detection under 600ms, the Memory
answer under 900ms, tension detection under 900ms. The pair scan is the only
quadratic step, and the fixed direction vocabulary keeps both sides small; the
subjects are computed once per rule rather than once per pair.

### Three defects the tests found

- The standard detector matched a bare `i want to do`, which fires inside
  *"whether teaching is what I want to do"* — a reflection about a career turned
  into a commitment by a loose regex. Markers are now clause-anchored.
- Its conditional exclusion was a second list of connectives, and it rejected
  *"tell the truth even when it is embarrassing"* — an unconditional standard
  with a subordinate clause. It now delegates to `extractConditional`.
- Conflict detection required a shared **word**, and the brief's own example —
  *"answer promptly"* vs *"wait before replying"* — shares none. Subjects are
  now small synonym groups, and a tension names the one it matched.

### Two assertions that passed for the wrong reason

Both caught by mutating the mechanism they claimed to guard:

- **79.74** used two bare actions, which are indistinguishable on every ordering
  fact — so it returned `null` for the tie and would have passed even if a rule
  *did* ground a recommendation. Sized against an event, the fixture now
  separates them, and the mutation turns it red.
- **79.66**'s real guard is the revision lookup, not the `hasLifecycleHistory`
  filter. Mutating the fallback to `updatedAt` turns it red.

### Three harness bugs, worth recording

The browser suite failed first on its own fixtures, not on the product: `ZZ`
markers fused into the words the matchers read (`ZZAnswerPeople` is not
`answer`); the confirm host uses `role="alertdialog"`; and a document-wide text
search for "Capture" opened the nav menu instead of clicking
`[data-capture-submit]`.

---

## 8. Product claims (§48)

1. **Standards in the user's own words** — `saveRule` trims and stores verbatim; asserted at 79.5, 1.3 (browser).
2. **Distinct from Constitution, Protocols, Goals, Habits, Tasks** — a `value` never appears in Personal Code (79.2, browser 0.3); the boundary table above.
3. **AI never silently creates or changes a rule** — `never_auto`, both conversion paths refuse, and the browser proves no record is created before confirmation (7.2, 7.3).
4. **Pause/retire without erasure** — browser 3.1–3.5, 4.1–4.4.
5. **Memory retrieves chosen standards** — 79.55–79.65, browser 9.1–9.3.
6. **Context without overriding ordering** — 79.71–79.77, and the mutation proof at 79.74.
7. **Conflicts surfaced with no hidden winner** — 79.37–79.43, browser 6.1–6.4.
8. **No score or gamification** — asserted by grep over every produced string and over the whole rendered page (79.15, browser 0.4).
9. **Provenance truthful** — 79.68, 79.69.
10. **Cross-device to the strength of the domain** — see §9.

---

## 9. Limitations

- **Conditional rules have no lifecycle history.** Stated above, stated in the
  UI, stated in Memory. Fixing it is migration 0048 and was explicitly deferred.
- **Cross-device is exactly what the two domains already provide.** No new
  guarantee is claimed: `constitutionElements`, `constitutionRevisions` and
  `protocols` sync as they did before this sprint, and neither is 0045-guarded,
  so a stale later writer takes the whole row. Personal Code changed no mapper
  and added no field, so import/export/restore/account-switch carry rules
  because they already carried these records.
- **Context matching is literal.** `ruleContexts` uses a fixed word list, and
  free-text matching uses meaning-bearing word overlap. A rule phrased entirely
  outside that vocabulary will not be found by context — which is why the
  vocabulary is visible in the source rather than learned.
- **Tension detection is conservative.** A rule with no direction word is never
  reported, and only five subject groups exist. Missing a tension costs nothing;
  inventing one tells someone their own commitments are incoherent when they are
  not.

---

## 10. Verdict

**LIFEOS-079 COMPLETE — RULES / PERSONAL CODE READY.**

No migration. Repository migration head unchanged at **0047**. All final gates
green.

Nothing in §20 of the approval was begun: no 0048, no Protocol history, no
Collections, People, Calendar expansion, D-8, general D-23, Observatory, or
habit gamification.
