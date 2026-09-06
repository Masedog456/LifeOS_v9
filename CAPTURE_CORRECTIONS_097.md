# LIFEOS-097 — Capture Corrections / Fix What Conqify Got Wrong

**North star:** when Conqify misunderstands a capture, correcting it should take
seconds and fix the record without making the user rebuild it.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
