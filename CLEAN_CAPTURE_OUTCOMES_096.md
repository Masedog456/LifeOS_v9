# LIFEOS-096 — Capture Understanding / Better Titles & Cleaner Outcomes

**North star:** when Conqify saves something, the result should read like a clean
human record, not a copy of the sentence that created it.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `193551e7299af179f69396bd46c98c54023bfa75` (PR #101 merged) |
| Branch | `claude/lifeos-096-clean-capture-outcomes` |
| Migration required | **no** (§37) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Every row below is the **real `interpret`** run against a store holding one
project ("Clinic launch"), one goal ("Graduate school") and one open action
("Send the recommendation request"). Probe: `scratchpad/audit96.cjs`.

## 1.1 The fifteen captures

| # | Raw capture | Kind | Current title | Structured fields | Verdict |
|---|---|---|---|---|---|
| 1 | I'm waiting on Maria for the transcript | waiting | *the whole sentence* | `waitingOn=Maria` `waitingFor=transcript` | **noisy — and recomposable from fields already parsed** |
| 2 | Remind me to call the dentist Friday | **note** | Remind me to call the dentist | `dueDate=2026-09-11` | classifier, not title — see §1.5 |
| 3 | Dinner with Ana next Thursday at 7 | event | **Dinner with Ana** | `dueDate` `time=19:00` | already clean |
| 4 | Finish the philosophy statement tomorrow | action | **Finish the philosophy statement** | `dueDate` | already clean |
| 5 | I need to send Marcus the lease | action | send Marcus the lease | — | framing already stripped — but **lowercase** |
| 6 | Maria owes me the recommendation letter | waiting | *the whole sentence* | `waitingOn=Maria` `waitingFor=recommendation letter` | **noisy — recomposable** |
| 7 | The interview is Tuesday at 2 | event | **The interview** | `dueDate` `time=14:00` | already clean |
| 8 | Remember that my passport expires in March | note | *the whole sentence* | unresolved `"in March"` | leave (§12, §22) |
| 9 | I realized teaching isn't what I want | note | *the whole sentence* | — | leave (§13) |
| 10 | Apply to philosophy programs | action | **Apply to philosophy programs** | — | already clean |
| 11 | My dad's birthday is October 8 | event | **My dad's birthday** | `dueDate` + yearly recurrence | already clean |
| 12 | When Marcus replies, send the lease | protocol | — | `trigger` / `response` | dependency **is** structural (§20) |
| 13 | I finished the recommendation request | **change** | — | completion match fires | do not touch (§17) |
| 14 | I'm not doing the certification anymore | note | *the whole sentence* | — | leave — negation lives in the words |
| 15 | The clinic launch is blocked by the lease | note | *the whole sentence* | — | leave — the blocker is **not** structural, so the words are the only record of it (§21) |

## 1.2 A, B — Who is already clean, and who copies the sentence

**Clean already:** every Event (dates and times are parsed out and the title is
the thing), and every Action whose sentence opened with framing —
`interpret` already strips "I need to", "I have to", "I should".

**Copies the sentence:** **Waiting**, and only Waiting. It is the one kind that
extracts two structured fields and then still titles the record with the raw
sentence.

**Notes** also carry the whole sentence, correctly — see §1.4.

## 1.3 C, D — What is safe to strip

Nothing new needs stripping. The prefixes §6 lists are **already handled by the
interpreter**, and the dates §11 lists are **already moved into fields**. The
audit's honest finding is that there is much less prefix-stripping to do than
the brief assumed — and one genuine recomposition to do that it named exactly.

What remains:

* **`waitingFor` + `waitingOn` → a title** (§8). Both fields exist and both are
  already parsed.
* **Capitalization** (§24). `"send Marcus the lease"` and `"email the
  registrar"` are what stripping "I need to" and "I have to" leaves behind, and
  a record titled in lower case reads like a fragment beside its neighbours.
* **Trailing punctuation** (§24).

## 1.4 E — What must not move

| Kept | Why |
|---|---|
| Note bodies, verbatim | §12 — the title/body distinction is weak, and `commitCapture`'s note branch writes `body \|\| title`, so a "cleaned" note title would never be stored anyway |
| Reflection prose | §13 — "I realized teaching isn't what I want" is not "Leave teaching" |
| Negation | "I don't need to call Marcus" and "I'm not applying to law school" both read as **notes**, so the negation lives in prose this sprint does not touch |
| "Research whether I should apply" | reads as a note, not an action to "apply" — 080's guard, verified |
| `"blocked by the lease"` | there is no structured blocker on a note, so the sentence is the only record of it |
| `"When Marcus replies"` | becomes a Protocol `trigger`, so the dependency **is** represented — and the title branch never runs on a protocol |

## 1.5 The two the brief asked for that this sprint cannot deliver

**"Remind me to call the dentist Friday" → "Call the dentist".** Measured, that
capture is classified as a **note**, not an action. Turning it into "Call the
dentist" would require making "remind me to" an action opener — a
**classification** change, which §15 ("this sprint cleans existing
interpretation; it does not strengthen classification") and §50 both exclude.
Reported rather than smuggled in.

**"I'm waiting for the landlord to send the lease" → "Lease from landlord".**
Measured, `waitingFor` is `"send the lease"` — a verb phrase, not the noun. The
truthful recomposition would be "Send the lease from landlord", which is worse
than the original. §8 says *do not fabricate nouns*, so this capture keeps its
sentence and the rule declines.

## 1.6 F, G — What a title change could break

* **Completion matching (§17).** `readChanges(text, state, today)` runs on the
  **raw capture** before interpretation, and matches against existing record
  titles. Cleaning the title of a *newly created* record cannot affect the
  matching of the sentence that created it. It can affect a *later* sentence
  matching *this* record — and there it helps: "I finished the transcript from
  Maria" is closer to `Transcript from Maria` than to the old sentence-title.
* **089 context matching (§26).** `matchRecords` compares record titles against
  capture text. A shorter title matches fewer capture words — so the
  duplicate-guard 095 added could fire less often. Tested in both directions.

## 1.7 H, I — The "Filed" domains (§30)

Measured directly against `describeCreated`: **eight of seventeen ref kinds have
a reader; nine do not**, and every one of the nine has an obvious title field
already in the store.

```
action  note  event  protocol  project  goal  belief  formation     → named
concept  decision  research_project  dialogue  principle
framework  practice  workspace  constitution_element                → "Filed"
```

`convertCapture` can produce every one of them. So `"Saved as Decision · Choose
graduate program"` is available from store truth today and is simply not being
read.

## 1.8 The reds (§38)

| # | Claim | Verdict |
|---|---|---|
| 1 | Waiting title copies the whole sentence | **CONFIRMED** — and both fields needed to fix it are already parsed |
| 2 | Action title includes reminder framing | **NOT CONFIRMED** — "I need to / have to / should" are already stripped. The residue is **lower case**, which is a real but smaller defect |
| 3 | Event title includes parsed date/time | **NOT CONFIRMED** — every Event in the fixture is already clean |
| 4 | Negation breakable by naive stripping | **a hazard, not a defect** — the guard has to be built, not repaired |
| 5 | Dependency text could be lost | **a hazard** — protocols already hold it structurally |
| 6 | Completion matching could regress | **a hazard** — matching runs on the raw capture, before any title exists |
| 7 | Search loses raw phrasing | **CONFIRMED as a forward risk** — an Action's search body is `title + description + notes + tags + context + waitingOn` and **never the source capture**. Shortening titles today would cost recall tomorrow |
| 8 | Home says "Filed" for supported domains | **CONFIRMED** — nine domains, all readable |

Three of eight. Reds 2 and 3 are stated as measurements rather than dropped,
because the brief predicted them and earlier sprints had already fixed them.

## 1.9 J — The smallest change that materially improves quality

1. **Recompose waiting titles** from `waitingFor` + `waitingOn`, declining when
   `waitingFor` is a verb phrase (§8's "do not fabricate nouns").
2. **Capitalize and de-punctuate** what framing-stripping leaves behind (§24).
3. **Nine more outcome readers**, one table, shared by the immediate and recent
   descriptions (§30, §32, §34).
4. **Index the source capture on the Action** so shorter titles cost no recall
   (§27).

No new classifier, no phrase dictionary, no LLM, **no migration**.

---

# 2. What shipped

## 2.1 The title rules (§39, §40)

`lib/capture/titles.ts` — pure, deterministic, no store and no clock. **Every
rule returns the original when it is not certain**, which is the part that
matters more than the rules: a title is the name a person sees for a commitment
for months, and a wrong one is worse than a long one.

Two tiers, because recomposition and formatting are different operations:

| Tier | Members | What it may do |
|---|---|---|
| `RECOMPOSABLE` | `waiting` | build a title out of `waitingFor` + `waitingOn` |
| `TIDYABLE` | `action` `waiting` `event` `goal` `project` | leading capital, trailing punctuation |

Deliberately absent from both:

* **`note`, `reflection`** — §12, §13. The prose *is* the record, and
  `commitCapture` writes `body \|\| title` regardless.
* **`protocol`** — no title at all. A trigger and a response, and §20's
  dependency lives in them.
* **`standard`** — §16. Normative wording is not this sprint's to touch, even
  in ways that look harmless.

### Waiting (§8, §9, §10)

```
waitingFor "transcript"        + waitingOn "Maria"     → Transcript from Maria
waitingFor "recommendation letter" + waitingOn "Maria" → Recommendation letter from Maria
waitingFor "review of the book"    + waitingOn "Ana"   → Review of the book from Ana
waitingFor "send the lease"                            → declines, verb-headed
waitingFor absent                                      → "Waiting on Marcus", unchanged
```

**"from", never "owed by"** (§10). "Maria owes me the recommendation letter" is
the user's framing of a relationship; the record's job is to name the thing,
not to restate a claim about what somebody owes.

The verb test asks `classify.ts`'s own `ACTION_VERBS` through a new
`startsWithActionVerb` export rather than keeping a second list — two lists
drift, and only one of them is the one the classifier trusts.

### Tidying (§24)

Leading capital only. Explicitly **not** title case, and explicitly not applied
when the first word is cased deliberately: `iPhone charger from Sam`, never
`IPhone`.

## 2.2 Outcome coverage (§30, §32, §33)

**Seventeen of seventeen** ref kinds are named, from one table rather than nine
more branches. Nine of them used to render as **"Filed"**.

```
concept · decision · research_project · dialogue · principle
framework · practice · workspace · constitution_element
```

§31's invariant survives: the table reads the **store**, so a ref the store
never wrote is claimed by none of them, and a record with no name of its own
still renders as "Filed" rather than a word this layer invented.

## 2.3 Search (§27)

An Action's search haystack now includes its **source capture's text**. Shorter
titles are a smaller haystack, and searching the phrase you actually typed had
to keep finding the record it produced.

```
record title   Transcript from Maria
search         "transcript from maria"   → found
search         "waiting on maria"        → found, through the source
```

## 2.4 No migration

Head stays at **0047**. Nothing was added to the schema; `sourceCaptureId`,
`waitingOn` and `waitingFor` all already existed.

---

# 3. What the testing found

## 3.1 Mutation (§42) — twelve, six escapes, four fixture gaps and two facts

Six reddened immediately. The other six were the useful half.

**M1, M2** added notes and reflections to the cleanable set and removed the kind
guard entirely — and nothing reddened, because every note in the fixture was
already capitalised and unpunctuated, so the tidy path would have left it alone
anyway. **Three assertions could not tell a guard from a coincidence.**
`"the clinic launch is blocked by the lease."` has a lower-case title the tidy
path *would* change, and the note kind is what stops it.

**M9** replaced the empty-title guard with a literal `"Saved"` and nothing
reddened, because no fixture had a nameless record. A concept with a blank name
now proves §33.

**M10** deleted one `OUTCOME_LABEL` entry and nothing reddened — the table still
produced the title, so the row read *"Record · Choose graduate program"* and
every assertion was happy. All seventeen labels are now asserted by name.

**M4** removed the infinitive clause from the waiting guard and nothing
reddened. Measured across nine phrasings: the interpreter strips a leading "to"
or "for" every time, so `waitingFor` never arrives with one. **Dead logic reads
like a protection the code does not have**, so it is gone rather than pinned.

**M8** stays green and is reported as a **semantic no-op**, not dressed up.
Faking the record makes `entry.name` return `undefined`, which the empty-title
guard on the next line already rejects — verified by applying the mutation and
diffing the output, which is identical. 96.20c proves the observable contract;
`if (!rec) continue` is subsumed, not independently proven, and deleting good
code to raise a mutation score would make the file worse.

## 3.2 Two earlier suites caught things this sprint changed

**LIFEOS-080** produced *"get healthier"* beside *"Book a physical"* from one
sentence, because goals were excluded from tidying on §14/§15 grounds.
Re-reading those: they forbid strengthening what the interpreter **claims**
about an aspiration; they do not require the claim it already made to read like
a fragment. Goals joined `TIDYABLE`.

Two 080 assertions were about the user's **wording**, and string equality was
only ever a proxy for it. They now assert the property directly — the goal is
the user's sentence and not a paraphrase like "Build an emergency fund" — and a
new **1.8b** pins that the sentence itself is stored exactly as typed, which is
the invariant §3 actually cares about.

**LIFEOS-095**'s two assertions about *where* the person was named were
rewritten to ask what 095 was actually asking: the row says it saved a wait,
and the row says who. Neither was deleted.

## 3.3 Visual review (§43)

Screenshots at desktop and mobile across waiting / event / action / reflection
/ rule / dense-recent / no-recent.

**The person, three times.** *"SAVED AS WAITING / Transcript from Maria /
Waiting on Maria"* — the label, the title and the detail all carrying the same
relationship, with Maria named twice. The title has to name the person (it must
stand alone in Search and Memory), so the **detail** is the half that goes, and
only when the title already names them. A wait whose title does not say who
still says who.

Nothing else: no over-short titles, no AI-sounding names, the raw capture is
visible on every recent row above the record it became.

## 3.4 Performance (§44)

| Records | interpret | cleanTitles | describeCreated | recentCaptures | buildSearchEntries |
|---|---|---|---|---|---|
| 100 | 0.45 ms | **0.01 ms** | 0.01 ms | 0.55 ms | 1.33 ms |
| 1,000 | 0.05 ms | **0.01 ms** | 0.00 ms | 0.10 ms | 4.67 ms |
| 5,000 | 0.20 ms | **0.01 ms** | 0.00 ms | 0.10 ms | 20.67 ms |

Title cleanup is a function of one candidate and costs nothing measurable. The
§27 search change adds one `Map` build over captures inside a pass that already
walks every domain — 20.67 ms at 5,000 records, and no new whole-store pass.

## 3.5 Known gaps

* **"Remind me to call the dentist Friday" is still a note.** Making it an
  Action titled "Call the dentist" is a **classification** change, which §15
  and §50 exclude. The date is parsed either way.
* **"I'm waiting for the landlord to send the lease" keeps its sentence.**
  `waitingFor` parses as a verb phrase and §8 forbids fabricating a noun.
* **Existing records are not renamed.** The rule applies at creation. A store
  full of sentence-titled waits keeps them, and nothing migrates them —
  which is the correct consequence of §37 rather than an oversight.
* **A capture filed into a domain with no name of its own** still renders as
  "Filed" (§33).

---

# 4. The product claims (§48)

1. **Raw captures unchanged and recoverable.** — *96.3, browser 3, 080 1.8b*
2. **Clean titles describe the record.** — *96.1, browser 1*
3. **Waiting titles materially clearer where evidence exists.** — *96.1, 96.4*
4. **Parsed temporal language leaves titles without losing the fact.** — *96.10, browser 10–12*
5. **Negation, blockers and dependencies never stripped.** — *96.11, 96.12, 96.13, browser 14–17b*
6. **Reflection and normative prose not rewritten.** — *96.11b, 96.6c*
7. **Completion matching still works.** — *96.14, 96.15, browser 18–19*
8. **Search retains raw-language recall.** — *96.18, 96.18b, browser 8–9*
9. **Home names stored outcomes whenever store truth permits.** — *96.20, 96.20b, browser 20–22*
10. **Immediate and recent descriptions agree.** — *browser 6, 24*
11. **No LLM rewriting, no new interpretation engine.** — one pure function over fields `interpret` already produced
12. **No migration.** — head 0047

---

# 5. Files

```
lib/capture/titles.ts              the rules (new)
lib/capture/titles-selftest.ts     60 assertions (new)
scripts/smoke-096-clean-outcomes.cjs  36 browser assertions (new)

lib/capture/classify.ts            startsWithActionVerb exported
components/capture/CaptureComposer.tsx  applied in rowsFrom, one call site
lib/capture/home.ts                nine outcome readers; the person named once
lib/command/records.ts             §27 source-capture recall
lib/capture/home-selftest.ts       095's two assertions, asked properly
scripts/smoke-080-capture-intelligence.cjs  080's wording assertions, and 1.8b
```

## Gates

```
deterministic     6010/6010 across 60 suites   (096: 60 new)
browser (096)     36/36
browser (prior)   080 111/111 · 085 54/54 · 086 53/53 · 089 66/66 · 090 69/69
                  091 87/87 · 092 59/59 · 093 57/57 · 094 47/47 · 095 67/67
route smoke       25/25       release audit 17/17
export verify     14/14       route audit PASS   secret scan PASS
tsc clean · eslint 0 errors (2 pre-existing warnings) · build PASS
migration head    0047, unchanged
```
