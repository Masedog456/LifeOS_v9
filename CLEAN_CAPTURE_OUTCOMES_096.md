# LIFEOS-096 — Capture Understanding / Better Titles & Cleaner Outcomes

**North star:** when Conqify saves something, the result should read like a clean
human record, not a copy of the sentence that created it.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
