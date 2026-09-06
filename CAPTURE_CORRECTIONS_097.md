# LIFEOS-097 — Capture Corrections / Fix What Conqify Got Wrong

**North star:** when Conqify misunderstands a capture, correcting it should take
seconds and fix the record without making the user rebuild it.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `4efc1154cb3ceecf566f53ecf3983cf1c0826f09` (PR #102 merged) |
| Branch | `claude/lifeos-097-capture-corrections` |
| Migration required | **no** (§38) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Real mistakes run through the real UI on the running build. Probes:
`scratchpad/audit97.cjs` (what the success state and the record page offer) and
`scratchpad/audit97b.cjs` (multi-outcome, matched-existing, project linkage).

## 1.1 What the user is actually offered today

Captured *"I'm waiting on Maria for the transcript Friday"*:

```
IMMEDIATE SUCCESS   "SAVED AS WAITING · Transcript Friday from Maria · Fri, Sep 11"
                    controls: [ Undo ]
                    raw source visible on the page: NO

RECENT CARD         "I'm waiting on Maria for the transcript Friday
                     Waiting · Transcript Friday from Maria · Fri, Sep 11"
                    buttons: none
                    links:   the record

THE RECORD          title "Transcript Friday from Maria"  waitingOn Maria
                    dueDate 2026-09-11   followUpDate 2026-09-11
                    history ["created","due_set","waiting"]
```

**There is no Edit anywhere in the capture flow.** Every correction begins with
a navigation to `/actions/[id]`.

## 1.2 A, B, C — What is easy, what needs a page, what has a setter

| Correction | Setter | History it writes | Reachable today |
|---|---|---|---|
| title | `updateAction` | `edited` — neutral | record page |
| due date | `setActionDueDate` | `due_set` / `due_cleared` — **neutral** | record page |
| due time | `setActionDueTime` | — | record page |
| note body/title | `updateNote` | — | notes page |
| event date/time/title | `updateEvent` | — | calendar |
| **project** | `updateAction({projectId})` | `edited` | **nowhere** |
| **goal** | `updateAction({goalId})` | `edited` | **nowhere** |
| **waiting person** | *(none that is safe)* | — | **nowhere** |
| delete a created record | `deleteAction` / `deleteNote` / `deleteEvent` | — | record page |
| un-file the capture | `restoreCapture` + `unlinkCaptureRef` | `restore` | Undo, auto-path only |

Two rows are the sprint. **`projectId` and `goalId` have a canonical setter and
no UI at all.** The record page's "Links" panel looks like it should do this and
does not: `linkActionRef` writes `linkedEntityRefs`, a different relationship
from the `projectId` that Today, the Project view and LIFEOS-089 all read.
Measured: the project appears on the record page as the text `Project: Clinic
launch` inside an `<a>`, with no remove control anywhere on the page.

**The waiting person has no safe setter.** `markActionWaiting` is the only
writer of `waitingOn`, and it **resets `waitingSince`** — correct when a wait
begins, falsifying when a name is merely corrected, because how long the wait
has run is the one dated fact the waiting signal rests on.

## 1.3 D, E — Record-type conversion

There is **no conversion primitive**. `convertCapture` converts a *capture*, not
a record. Action → Note would mean `deleteAction` + `createNote`, losing:

```
history (created / due_set / waiting / edited)   completion state
actionDependencies edges                          waitingSince
the action's own id, and every reference to it    session links
```

§17 is explicit that a conversion which loses those must not be faked. **This
sprint will not convert record types**, and will say so in the surface rather
than silently omitting the option.

## 1.4 F, G — Provenance and staleness

`sourceCaptureId` is a plain field and no setter touches it, so every
correction through `updateAction` / `setActionDueDate` preserves it for free.
`classifyOrigin` reads the record's text, not an authorship flag, so a corrected
title is not laundered into machine prose — but it is also not *claimed* as
newly user-authored (§25), because nothing in the correction path writes an
origin at all.

Staleness: the store is a single in-process singleton with no `storage`
listener — LIFEOS-094 measured this. A second tab's write is not observed until
a reload, so "the record changed elsewhere" can only mean *changed in this tab
since the sheet opened*. That is real (an Undo, another correction, a completion
from Today) and is what the revalidation guards (§32).

## 1.5 H, I — Multi-outcome and matched records

Captured *"Call the dentist tomorrow, finish the report, and Marcus still owes
me the file"*:

```
SAVED AS ACTION   Call the dentist · Mon, Sep 7
SAVED AS ACTION   Finish the report
SAVED AS WAITING  Marcus still owes me the file
undo buttons: 1        ← one button, three records
```

§21 asks for clear ownership; there is one Undo for all three and no way to
correct or remove just one.

Captured *"I finished the recommendation request"* against an existing action:

```
finished rows: []          ← nothing was created
change panel: present      ← it ASKS, it does not auto-complete
```

Good news for §23/§24: a completion is proposed, never applied silently. And
Undo exists only on the auto-finish path, which only ever creates — so
"created vs existing" currently holds *by construction*. Extending Undo to
recent cards (§29) is exactly where that could break, and is guarded.

## 1.6 A defect this sprint's own fixture found in LIFEOS-096

```
"I'm waiting on Maria for the transcript Friday"  → "Transcript Friday from Maria"
"I'm waiting on Marcus for the lease tomorrow"    → "Lease tomorrow from Marcus"
"I'm waiting on Ana for the signed form next Monday" → "Signed form next Monday from Ana"
```

`waitingFor` carries the temporal word, and 096's recomposition puts it into
the title — while `dueDate` already holds the resolved date. That is precisely
what §22 of 096 forbids, and 096's own fixtures never combined a wait with a
date. Fixed here, because it is visible in every correction screenshot this
sprint will take.

## 1.7 The reds (§39)

| # | Claim | Verdict |
|---|---|---|
| 1 | Wrong title requires navigating away | **CONFIRMED** — no Edit in the capture flow at all |
| 2 | Wrong due date requires the full record page | **CONFIRMED** — same |
| 3 | Wrong Project hard to change or remove | **CONFIRMED, and worse** — impossible anywhere in the UI |
| 4 | Wrong waiting person hard to fix | **CONFIRMED, and worse** — no safe setter exists |
| 5 | Undo cannot distinguish created from existing | **NOT CONFIRMED today** — Undo only exists where nothing pre-existing is touched. A hazard for §29, not a defect |
| 6 | Multi-outcome has no correction ownership | **CONFIRMED** — one Undo, three records |
| 7 | Correction pollutes deferral history | **NOT CONFIRMED** — `setActionDueDate` writes `due_set`, not `deferred`. A hazard to preserve, not repair |
| 8 | Raw capture inaccessible during edit | **CONFIRMED for the success panel** (it shows no source); the recent card and the record page both show it |

Six of eight, two of them worse than the brief guessed and two of them hazards
rather than defects — stated as measurements rather than dropped.

## 1.8 J — The smallest correction surface

1. **One compact sheet**, opened from the immediate result and from a recent
   card, showing the raw sentence and only the fields that record has.
2. **Per-outcome** — one sheet and one undo per created record, so a
   three-record capture has three of each.
3. **`projectId` / `goalId` / `waitingOn`**, because those are where the gap is.
   The first two already have a setter; the third needs `waitingOn` added to
   `updateAction`'s field list — extending the canonical neutral setter, not
   adding a mutation path.
4. **No type conversion**, said out loud.

---

# 2. What shipped

## 2.1 The correction taxonomy

One sheet per created record, opened from the immediate result or a recent
card, showing **only the fields that record has**:

| Record | Fields offered | Why not the others |
|---|---|---|
| Action | title · date · **time** (only once it has a date) · project · goal | `setActionDueTime` refuses a time with no day, and a control that will be refused is worse than none |
| Waiting | title · **waiting on** · follow-up date · project · goal | a follow-up is a day; a clock on it would invent precision the field has not got |
| Note | the body | §12 of 096 — the prose *is* the record |
| Event | title · date · time | |
| everything else | *(no sheet)* | its own page and its own rules; a sheet that half works is worse |

## 2.2 The setters, and the history each writes

Every save is the setter the record's own page uses (§41). Nothing
Home-specific writes to the store.

```
title, project, goal, waitingOn   updateAction        → history "edited"
due date                          setActionDueDate    → history "due_set"
due time                          setActionDueTime    → —
note body                         updateNote          → —
event title/date/time             updateEvent         → —
```

**`deferAction` is not reachable from this sheet.** That is the whole of §27's
correction-versus-life-change distinction, and it did not need a new
representation: `setActionDueDate` already writes `due_set`, so a date the
system got wrong is recorded as the date being set — not as the user deciding
to put something off. Assertion 10 checks the real history for the absence of
`deferred`.

### The one setter that changed

`waitingOn` joined `updateAction`'s field list. `markActionWaiting` was the
only writer of it and **resets `waitingSince`** — right when a wait begins,
falsifying when the name is merely corrected, because how long the wait has run
is the one dated fact the waiting signal rests on. Correcting *Maria* to
*Marcus* now writes `edited`, leaves the clock alone, and does not touch
`status` — naming somebody is not the same as starting to wait on them.

## 2.3 Undo — created versus existing (§19, §20, §23)

**Per outcome.** A three-record capture offers three undos, so "remove the
wait, keep the two actions" needs no rebuilding.

`createdBy` reads the record's own **`sourceCaptureId`**, not the link.
`commitCapture` links what it creates *and* `convertCapture` links what it
converts, but a record the interpreter merely **matched** — the existing action
a completion sentence found — has a different source or none. Undo is not
offered for it at all, while Edit still is.

`UNDOABLE_KINDS` is `action`, `note`, `event`: the kinds with a delete that
takes its dependents with it. A protocol carries `sourceCaptureId` and *is*
attributable, but has no such delete here, so it is kept rather than
half-removed and `keptRefs` reports it.

The capture returns to the inbox only once nothing it made is left — otherwise
a two-record capture would go back to the inbox while one of its records still
stood.

## 2.4 Provenance and staleness

`sourceCaptureId` is never touched by any correction path, so it survives for
free (§25). Nothing writes an origin, so a corrected title is neither laundered
into machine prose nor newly claimed as user-authored.

Before every save the sheet re-reads the store: the record must still exist,
and no field it is about to write may have moved since the sheet opened. Either
way it shows the current state rather than overwriting (§32). **The limitation,
stated plainly:** the store is one in-process singleton with no `storage`
listener, so a second tab's write is invisible until a reload. "Changed
elsewhere" can only mean *changed in this tab* — by an undo, another
correction, or a completion from Today. That is real, and it is what the guard
catches.

## 2.5 A LIFEOS-096 regression this sprint's audit found

```
"I'm waiting on Maria for the transcript Friday"  → "Transcript Friday from Maria"
```

`waitingFor` carries the temporal word while `dueDate` already holds the
resolved date — exactly what §22 of 096 forbids, and 096's fixtures never
combined a wait with a date. The interpreter's own `extractTemporal` and
`stripResolvedTemporal` do the removing, so there is still one date parser. An
**unresolved** phrase stays: "the report sometime" keeps its "sometime",
because the words are the only place that intent lives.

---

# 3. What the testing found

## 3.1 Mutation (§43) — thirteen, twelve red, one invalid

Twelve reddened: undo deleting a matched record, every linked record treated as
created, a kind with no safe delete offered for undo, kept-records reported as
none, a time control on an action with no day, a wait losing its person and
gaining a clock, the impossible conversion silently omitted, a domain with no
safe sheet given an empty one, a deleted record still claiming to stand, the
current value read from the sheet instead of the store, the resolved date put
back into the title, and the sheet showing the interpreted title where the
sentence belongs.

**M12 threw rather than reddening.** It removed the `!today` guard from the
date-stripping helper, and `extractTemporal` splits the day key it is handed.
§43 says a crash does not count, so it does not — reported as invalid rather
than counted as a catch. What it establishes anyway is that the guard is not
decorative. 97.35 asserts the behaviour it produces: with no day to resolve
against, nothing is removed.

## 3.2 Visual review (§44)

1. **"Transcript from MariaClose"** — the Edit control rendered hard against
   the title link on the success panel.
2. **The sheet read as a settings form** — five stacked full-width fields on a
   1280px page. Project and Goal share a row now, as Date and Time already did.
3. **The two unsupported reasons were louder than the controls** — dense grey
   paragraphs taking as much room as three fields, on a sheet whose job is the
   controls. They sit behind *"What can't be fixed here"*.

That last change made assertion 21 weaker than it read — `textContent` finds
text inside a collapsed `<details>`, so it would have passed even with nothing
naming the disclosure. It checks both halves now.

## 3.3 Performance (§45)

| Records | open sheet | save title | save date | change project | undo |
|---|---|---|---|---|---|
| 100 | 49 ms | 53 ms | 42 ms | 39 ms | 75 ms |
| 1,000 | 36 ms | 67 ms | 54 ms | 50 ms | 83 ms |
| 5,000 | 36 ms | **140 ms** | 101 ms | 101 ms | **196 ms** |

Opening the sheet is flat — the model reads one record and two title lookups.
The saves grow with the store because every write goes through `setState` and
re-renders Home, which already recomputes the decision count and the recent
list; no correction adds a scan of its own.

## 3.4 Known gaps

* **No record-type conversion**, and the sheet says so. Action → Note would be
  delete-and-recreate, losing history, dependency edges, completion state and
  every reference to the id.
* **`waitingFor` is not a stored field** — correcting the thing being waited
  for means correcting the title, which the sheet says.
* **Domains beyond action/note/event** get their own page rather than a sheet.
* **No cross-tab staleness detection**, per §33 — unchanged from LIFEOS-094.
* **`smoke-075-cross-device` and `smoke-076-sync-trust` time out in this
  environment**, waiting for a `synced` health state that needs a configured
  Supabase. **Verified by running them on `main` before this branch: they time
  out there too.** Pre-existing and environmental, not a regression — and not
  claimed as passing.

---

# 4. The product claims (§49)

1. **Simple mistakes fixed without rebuilding.** — *browser 1–20*
2. **Raw source unchanged and visible.** — *97.1, browser 2, 5, 30*
3. **Canonical setters.** — *browser 7, 11; no Home-specific write exists*
4. **Corrections do not become deferrals.** — *browser 10*
5. **Context links safely corrected.** — *browser 14–16*
6. **Waiting person corrected.** — *97.5, browser 17–20*
7. **Undo removes only what the capture created.** — *97.17–97.23, browser 25*
8. **Matched records never deleted.** — *97.18, browser 27–29*
9. **Unsupported conversion not faked.** — *97.12–97.16, browser 21–22*
10. **Provenance preserved.** — *97.28, browser 6*
11. **Mobile correction low-friction.** — *browser 37–39*
12. **No migration, no AI correction, no learning.** — *97.29; head 0047*

---

# 5. Files

```
lib/capture/corrections.ts             the model (new)
lib/capture/corrections-selftest.ts    41 assertions (new)
components/capture/CorrectionSheet.tsx the sheet (new)
scripts/smoke-097-capture-corrections.cjs  41 browser assertions (new)

lib/mvpStore.ts                        waitingOn joins updateAction's fields
lib/capture/titles.ts                  the 096 temporal regression
components/capture/CaptureComposer.tsx Edit on the immediate result
components/capture/RecentCaptures.tsx  Edit and per-outcome Undo
```

## Gates

```
deterministic     6051/6051 across 61 suites   (097: 41 new)
browser (097)     41/41
browser (prior)   089 66/66 · 090 69/69 · 095 67/67 · 096 36/36
                  075, 076 time out here and on main — see Known gaps
route smoke       25/25       release audit 17/17
export verify     14/14       route audit PASS   secret scan PASS
tsc clean · eslint 0 errors (2 pre-existing warnings) · build PASS
migration head    0047, unchanged
```
