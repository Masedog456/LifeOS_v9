# LIFEOS-100 — Capture From Anywhere / Global Quick Capture

**North star:** no matter where I am in Conqify, Capture should be one action away.

## STATUS: COMPLETE

| | |
|---|---|
| Base SHA | `498dffac8f2ecb68159bf9ce9224d9d34ac8933a` (PR #105 merged) |
| Branch | `claude/lifeos-100-global-quick-capture` |
| Migration required | **no** (§49) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

## 1.1 Capture is already one action away from everywhere

Measured on the running build, from each scoped route: press the global
shortcut, and see whether an input is focused and the route survives.

```
route      inline #capture   ⇧⌘K opens   focus       route kept
home       true              true        TEXTAREA    true
today      false             true        TEXTAREA    true
project    false             true        TEXTAREA    true
goal       false             true        TEXTAREA    true
decisions  false             true        TEXTAREA    true
evening    false             true        TEXTAREA    true
week       false             true        TEXTAREA    true
actions    false             true        TEXTAREA    true
```

Mobile has a dedicated 44×44 button in the command bar,
`aria-label="Quick capture"`. The command palette carries two commands that
resolve to the same action (`create:capture` "New capture" and
`action:quick-capture` "Quick capture"), and the hand-off is clean:

```
palette open   dialogs 1  ["Command palette"]
after Enter    dialogs 1  ["Quick capture"]  focus TEXTAREA  route /goal/g1
after Escape   dialogs 0                     route /goal/g1
```

**So reds 1–8 of §50 do not hold.** Every one of them asks a reachability
question, and reachability was solved by LIFEOS-027: `CommandCenter` is mounted
once in the root layout, owns a single-overlay state, installs the shortcuts
through a pure `resolveKey`, and restores focus on close. §4, §5, §6, §7, §26,
§29, §34, §36 and §45 all describe infrastructure that already exists and works.

Reporting that first is the point of auditing first.

## 1.2 The red that does hold: the global doorway leads somewhere else

The premise of the sprint — "Capture is still strongest when the user is already
on Home" — is true. It is not true for the reason the brief assumes.

`components/command/QuickCapture.tsx` (LIFEOS-027) is a **second capture
implementation**, written before the Capture stack existed. It calls
`addCapture(text, sourceId)` and stops. It never calls `interpret`, never calls
`authorityFor`, never calls `suggestContext`, and never calls `commitCapture`.

One sentence — `"Email Marcus about the lease tomorrow"` — through both doorways,
against the same seeded store:

| | Home composer | global quick capture |
|---|---|---|
| captures | 1 → 2 | 1 → 2 |
| **actions** | **5 → 6** | **5 → 5** |
| **unprocessed captures** | 0 → 0 | **0 → 1** |
| what it says | `SAVED AS ACTION` · "Email Marcus about the lease" | `✓ Captured.` "It will appear on the Capture page and can become a belief in the Inbox." |

Same product, same words, one keystroke apart: one route creates the commitment
and names it back; the other leaves a raw row in an inbox and tells the person to
go and process it later.

**§50 red 9 CONFIRMED**, and it is the only one. The global path cannot reuse
Home's implementation because it *is* a different implementation — which is
exactly what §3 forbids, already shipped.

## 1.3 D–J, answered

* **D. A shell-level control worth reusing?** Yes, all of them. Shortcut
  (`⇧⌘K` / `Ctrl⇧K`), mobile `＋` button, two palette commands, and the
  `OPEN_CAPTURE_EVENT` any component can dispatch. Nothing new is needed.
* **E. Does the palette have a Capture command?** Two.
* **F. Is there shortcut infrastructure?** Yes — `lib/command/shortcuts.ts`
  resolves keys purely and `ShortcutHelp` documents them. §7's "do not build one
  from scratch" is moot; there is nothing to build.
* **G. What happens to the route after capture?** It is preserved. Measured:
  capturing from `/project/p1` leaves the user on `/project/p1`. §11 already
  holds.
* **H. Can `CaptureComposer` render outside Home?** Yes. Its entire signature is
  one optional callback:
  ```ts
  export default function CaptureComposer({ onFinished }: { onFinished?: (id: string | null) => void } = {})
  ```
  Every other piece of state is internal.
* **I. What Home state would leak?** None. `justFinished` exists only so Home can
  hide the newest row of `RecentCaptures` while the finished panel is up (095
  §18). A quick sheet renders neither, so there is nothing to coordinate — which
  also satisfies §25 by construction.
* **J. The smallest implementation.** Replace the *body* of the existing overlay
  with `<CaptureComposer />`. The shell, shortcut, mobile button, palette
  commands, focus restore, single-overlay guard and route preservation are all
  untouched.

## 1.4 Red 10 — no silent context writing anywhere

§50's tenth red asks whether any existing path already converts the current page
into record linkage. It does not. `addCapture(text, sourceId)` takes its
`sourceId` from an explicit dropdown in the overlay's advanced section, never
from the route, and `CaptureComposer` derives context only through LIFEOS-089's
`suggestContext`, which reads the capture's own words.

So §12–§17 and §42 describe a hazard the product does not currently have, and the
work is to **not introduce it** while changing the doorway. That is a real
constraint on the implementation rather than a defect to fix, and the browser
suite asserts it from a Project, a Goal, Today and a historical review.

## 1.5 §33 — dialog, and correctly so

The overlay renders `fixed inset-0` with a `bg-black/40` backdrop, a click-out
handler, `role="dialog"` and `aria-modal="true"`. It genuinely blocks the page
beneath it, so dialog semantics are correct here — the opposite of LIFEOS-099's
finding about the correction sheet, which only *looked* like a modal. §33 asks
for the choice to follow behaviour, and behaviour says dialog.

---

# 2. What will be built

One change, and a small one:

**The overlay keeps its shell and swaps its body.** `QuickCapture` becomes a thin
dialog frame around `CaptureComposer` — the same interpreter, the same authority
boundary, the same context suggestions, the same commit path, the same outcome
descriptions, the same 097 correction sheet, the same 095 auto-finish.

Everything the audit found working stays exactly as it is.

## What is deliberately removed, and why

The old overlay's advanced section (a Title field, comma-separated Tags folded
into the text as `#tags`, a reading-Source dropdown, and a "then open a dialogue
on it" destination) does not survive, because it belongs to a capture path that
produced no records. Three of the four are inputs the interpreter has never read;
the fourth is a navigation shortcut to `/dialogue`.

Its localStorage draft (`lifeos.quickcapture.draft.v1`) also does not survive.
§27 says to reuse draft preservation only if the current composer already
supports it, and to build none from scratch — `CaptureComposer` does not, and
adding it would change Home too. The trade is stated rather than hidden: the old
overlay preserved a draft of a capture that would never have become anything.

Both are recorded as known gaps (§8), not quietly dropped.

---

# 3. What was built (§10)

`components/command/QuickCapture.tsx` went from 154 lines of capture logic to a
dialog frame with none. Everything below its header is `<CaptureComposer />`,
unwrapped: the same `interpret`, the same `authorityFor`, the same 089
`suggestContext`, the same 095 auto-finish, the same 096 titles, the same 097
correction sheet, the same `commitCapture`. There is no second interpreter and
no second write path because there is no second anything.

The shell was not touched. `CommandCenter` still owns the single-overlay state,
the shortcut, the palette hand-off, the mobile trigger, the focus restore and
the route. §4–§8, §11, §26, §29, §34, §36 and §45 needed nothing.

One prop was added to `CaptureComposer`:

```ts
headline?: boolean   // default true
```

It suppresses only the visible `<h1>`. §7 of this report explains why it exists.

## 3.1 What was deliberately removed

| removed | why |
|---|---|
| Title field, comma-joined Tags folded in as `#tags`, reading-Source dropdown | inputs the interpreter has never read, belonging to a capture path that produced no records |
| "then open a dialogue on it" destination | a navigation shortcut to `/dialogue`, not a capture behaviour |
| `lifeos.quickcapture.draft.v1` | §27 permits reusing draft preservation only where the composer already has it. It does not, and adding it would change Home. The old overlay preserved a draft of a capture that would never have become anything. Cleared once on mount rather than orphaned in every existing user's storage. |
| the sheet's own focus effect and Escape handler | dead — see §7 |

---

# 4. Proof (§52, §54)

`scripts/smoke-100-global-capture.cjs` — **28/28**, against the production build
over `scripts/fixtures/lifeos-100-world.cjs` (§51).

```
 1  §7,§29   the shortcut opens a focused, empty input from all 8 scoped routes
 2  §34      opening the sheet changes no URL on any of the 8
 3  §36      shell-level — /project/p1 has no capture input until it opens
 4  §5,§8    the palette hands off to exactly one sheet, focused
 5  §28,§29  Escape and a backdrop click both close it; focus returns to the opener
 6  §26      persists nothing — abandoned text gone, no key written
 7  §6,§32   the mobile bar opens the same sheet; both controls ≥44px
 8  §3,§10   the same sentence writes the same records through both doorways
 9  §21,§60  and the success panel is the same panel, word for word
10  §18      raw source preserved identically, marked processed
11  §11      the person is still on /project/p1 afterwards
12  §19      a capture Conqify is sure about finishes without asking, in the sheet
13  §20      an uncertain one asks inside the sheet and writes nothing yet
14  §20      and says why, naming the record it may already have
15  §24      a two-part capture reports both outcomes and creates exactly two
16  §22,§28  the 097 correction sheet opens inside it; Escape unwinds one layer at a time
17  §23      Undo belongs to the composer and reverses the whole capture
18  §9,§25   one heading, one input, its button — no list, no nav
19  §32,§56  one h1, no heading jump, dialog named, field labelled, and no node
             measuring lower than Home
20  §30      open, type and submit without a mouse — ⌘↵ commits inside the sheet
21  CONTROL §12  a project NAMED in the capture IS linked, from the sheet
22  §13,§41  capturing from a Project does not assign the record to it
23  §14,§41  capturing from a Goal does not assign the record to it
24  §15      capturing from Today does not mean due today — the words decide
25  §16      capturing during an evening review dates the record now
26  §17      capturing from the decision inbox resolves nothing, touches no deferral
27  §43,§44  a live search query does not leak into the sheet or the record
28  §52      no page errors in any scenario
```

**21 is a control and it comes first on purpose.** "Capturing from a Project does
not set `projectId`" passes trivially against a product where context never works
at all, so the same sheet, from the same Project, with the project named in the
sentence, must link — and does (`p1`). Without it, 22–26 prove nothing.

**9 compares the two success panels whole**, character for character, rather than
probing for keywords. A keyword test would have needed to know in advance which
words to look for, and the point is that neither panel gets any of its own.

## 4.1 The full-revert proof (§54)

Both production files reverted to `498dffa`, rebuilt, re-run: **8/28**.

| | |
|---|---|
| still green | 1, 2, 3, 4, 5, 11, 18, 28 |
| red | 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 27 |

The eight survivors are the audit's finding, proved: reachability, focus restore
and route preservation belong to LIFEOS-027 and this sprint did not fix them.
**18 is a decoration** and is kept as a guard, not claimed as proof — the old
overlay was also a compact sheet with no nav and no recent list.

**Three of the reds are weaker than their names suggest, and this is the honest
reading of them:** 22, 23 and 26 fail against the old doorway because it created
no action to inspect, not because it wrote page context into one. Those
constraints held vacuously before. §1.4 predicted exactly this.

The first version of the suite could not run against the revert at all. It drove
`[aria-labelledby="quick-capture-heading"] #capture` — this implementation's own
markup — so `openSheet` timed out and the process died at assertion 3. **A crash
is not a caught defect.** It now finds the dialog whose *accessible name* is
"Quick capture" and drives its first textarea and whichever control commits it,
so it exercises whichever overlay the shortcut actually produced.

---

# 5. Mutation testing (§53)

Thirteen mutants, one at a time, each type-checked and built before it ran.
**All thirteen are caught by the code and suite as they now stand — but four of
them escaped first**, and those four are the most useful part of this section.
The table records both states, because "13/13" on its own would hide the work.

| | mutant | outcome |
|---|---|---|
| M1 | the sheet lets the composer render its `<h1>` again | CAUGHT 18, 19 |
| M2 | `headline` default flipped to `false` | **ESCAPED**, then CAUGHT 19 |
| M3 | *first form:* QuickCapture's focus effect removed | **ESCAPED** — dead code (§5.1) |
| M3′ | the composer's textarea loses `autoFocus` | CAUGHT 1, 4, 20 |
| M4 | *first form:* QuickCapture's Escape handler disabled | **ESCAPED** — dead code (§5.1) |
| M4′ | `CommandCenter` stops closing overlays on Escape | CAUGHT 5, 16 |
| M5 | the sheet persists a draft again | CAUGHT 6, 27 |
| M6 | the close control drops below 44px | CAUGHT 7 |
| M7 | the composer's field loses its `<label>` | CAUGHT 19 |
| M8 | the sheet seeds the input from the current route | CAUGHT 1, 6, 20, 27 |
| M9 | `aria-modal` removed | CAUGHT 19 |
| M10 | the backdrop click no longer closes it | CAUGHT 5 |
| M11 | the sheet renders a recent-captures list | CAUGHT 18 |
| M12 | auto-finish disabled when `headline` is false | CAUGHT — 15 assertions |
| M13 | the sheet goes back to `bg-white dark:bg-zinc-900` | **ESCAPED**, then CAUGHT 19 |

## 5.1 M3 and M4 were not test gaps — they were dead code

Their first forms removed **QuickCapture's own** focus effect and Escape handler,
and the suite stayed green from all eight routes. Neither was a hole in the
proof:

* **focus** — `CaptureComposer`'s textarea carries `autoFocus`. React focuses it
  when the sheet mounts. The effect re-focused an already-focused node.
* **Escape** — `CommandCenter` listens on `window` and closes whatever overlay is
  open, and `CorrectionSheet` calls `stopPropagation`, so a nested Escape never
  reaches this level at all. Measured with the correction sheet open inside the
  dialog: **the first Escape closes only the correction sheet and returns focus
  to its Edit control; the second closes the dialog.** The handler's own comment
  claimed to protect against a case another file was already handling first.

Both were deleted, and both mutants were respun onto the real mechanisms —
`autoFocus` and `CommandCenter`'s Escape branch — where they are caught. Deleting
code a mutant proved has no effect is not chasing a score; it is the finding.

The nesting behaviour is produced entirely by two files this sprint did not
touch and **nothing was pinning it**, so assertion 16 now does.

## 5.2 M2 was a real gap

Flipping `headline`'s default to `false` left the sheet correct while **Home
silently lost its `<h1>`**. The default is this sprint's own new surface and was
the half nothing pinned. Assertion 19 now asserts Home keeps exactly one.

## 5.3 M13 caught the assertion, not the product

The contrast half of 19 originally compared *which nodes* fail on each doorway.
M13 walked straight through it: reinstating `dark:bg-zinc-900` moved three nodes
from 4.08 to 3.67, and since **both numbers are under 4.5 they were on both
failure lists** and the difference cancelled to nothing. The assertion was green
against the exact regression it had been written for.

It now collects every text node's ratio on both doorways and fails on any node
measuring lower in the sheet, pass or fail. Against M13 that is **21 nodes, not
3** — the whole dark panel loses contrast on `zinc-900`, and the failure-list
version could only ever have seen the few that straddled the threshold.

---

# 6. Accessibility (§32, §56)

## 6.1 The heading regression this sprint nearly shipped

Rendering `CaptureComposer` unchanged put its own `<h1>` inside the dialog. With
the sheet open on `/project/p1` the document carried **two level-1 headings**
("Clinic launch" and "What's happening?") and the dialog's own order ran h2 then
h1, backwards. LIFEOS-099's assertion 20 pins `h1 === 1` and no heading jump but
never opens this overlay, so nothing existing could have caught it.

`headline={false}` suppresses only the visible heading. The `<label>` is a
separate node and stays, so the field keeps the same accessible name in both
places and the dialog's own `<h2>` names the doorway.

```
                chrome above the input    sheet height
before                      94px               304px
after                       50px               260px
```

Which is also most of what §9 means by "not a mini Home page".

*One honest note on the mechanism:* the "no heading jump" check flags skipped
levels going down, which is the standard definition. It does **not** flag h2
followed by h1. What caught M1 was the `h1 === 1` count.

## 6.2 The sheet's ground

The §56 sweep found three nodes below AA in the composer's asking panel. **They
fail on Home too.** LIFEOS-099's sweep visited routes and never drove Home into
that state, so this is a pre-existing gap it missed — recorded in §8, not fixed
here.

What *was* this sprint's problem is that the two doorways measured differently.
The composer's colours are tuned against the app's ground, so the sheet's own
surface reprices every ratio inside it:

| | sheet | Home |
|---|---|---|
| light | 2.62 | 2.54 |
| **dark** | **3.67** | **4.08** |

`zinc-900` is lighter than the dark ground, so light-grey metadata on it lost
0.41. `bg-background` puts the sheet on exactly what Home sits on, so it now
measures exactly what Home measures. *Sometimes better, sometimes worse* is not
a guarantee. It still reads as a panel — the border, the shadow and the dimmed
backdrop do that, not a different fill.

## 6.3 Touch targets

The close control is 44×44 below `sm` and released above it — LIFEOS-099's own
rule, not a new one. On desktop it measures 21×24 by design.

The undersized controls the sweep lists inside the asking and correcting states
(`Confirm all` 111×36, `Undo` 53×27, the record links, the correction inputs at
34px tall) are all `CaptureComposer`'s and all measure identically on Home. §8.

---

# 7. Performance (§48, §57)

Trigger → the input present *and* focused, five runs, median / worst ms:

```
home      4 /  6
today     8 /  9
project   6 / 24
goal      7 /  7
```

Submit → the outcome shown, against the 095 baseline:

```
Home                13ms median   24 worst
sheet from /project/p1   11ms median   11 worst
```

No regression. §48's "instantly" holds by any reading.

---

# 8. Known gaps

1. **The composer's asking panel fails AA on both doorways.** Three nodes at
   2.54 (light) and 4.08 (dark), against a 4.5 requirement — `"Possible
   context"`, `"Person ·"`, `"May already exist:"` and their neighbours.
   LIFEOS-099 measured pages, not this state, so it never saw them. Real, and
   out of this sprint's scope: the fix belongs in the 099 token work and would
   change Home. Assertion 19 pins that **the sheet never measures lower than
   Home**, which is the part this sprint owns.
2. **Undersized touch targets inside the asking and correcting states** —
   `Confirm all`, `Undo`, the correction sheet's inputs and selects, the record
   links. All `CaptureComposer`'s, all identical on Home, same 099 scope.
3. **No draft preservation** in the sheet. §27 forbids building it, and the trade
   is stated in §3.1 rather than hidden.
4. **`smoke-098` assertion 20 is red** — `/memory` and the weekly-review
   vocabulary. Verified identical on the base commit `498dffa` in a clean
   worktree, so it is date-dependent and pre-existing, not a regression from
   this branch.
5. **The "no heading jump" check does not flag a backwards level order.** See
   §6.1.

---

# 9. Gates (§58)

```
deterministic selftests   6150/6150 across 62 suites; failing suites: none
smoke-100                 28/28
smoke-089 capture context 66/66
smoke-094 decision inbox  47/47
smoke-095 capture home    67/67
smoke-096 clean outcomes  36/36
smoke-097 corrections     41/41
smoke-098 coherence       33/34   (see §8.4 — identical on 498dffa)
smoke-099 accessibility   22/22
smoke-083 command center  77/77   (37 desktop, 39 mobile)
release audit             PASS 17/17 · migration count 47, head unchanged
route smoke               PASS 25/25
export verify             PASS 14/14
security audit            PASS  (RLS, secrets, routes, auth, deps)
tsc --noEmit              clean
eslint                    0 errors, 2 pre-existing warnings
next build                clean
```

**Migration head 0047, unchanged.** §49 needed nothing: the sheet stores nothing
of its own, and the records it creates are the records Home already created.

---

# 10. The twelve claims (§60)

1. Capture is one action away from all eight scoped routes — measured, and it was
   before this sprint too.
2. That action now opens the **same capture system** Home opens, not a second one.
3. The same sentence produces the same records through both doorways — byte-equal
   deltas.
4. And the same success panel, character for character.
5. The raw source is preserved identically and marked processed.
6. The route is never changed, on opening or on capturing.
7. Viewing a Project, a Goal, Today, an evening review or the decision inbox
   writes none of that into the record — and a project *named in the sentence*
   still links, so that is a boundary, not a broken feature.
8. A live search query reaches neither the sheet nor the record.
9. Uncertainty still asks, inside the sheet, and writes nothing until told.
10. The 097 correction sheet and Undo work inside the overlay, owned by the
    composer; Escape unwinds one layer at a time.
11. The sheet persists nothing — no draft, no storage key, nothing across a close.
12. It is no less accessible than Home, and measurably so: one `h1`, a named
    dialog, a labelled field, 44px touch targets on a phone, and no text node
    measuring lower than the same node on Home in either theme.
