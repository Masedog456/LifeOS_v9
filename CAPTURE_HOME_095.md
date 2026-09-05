# LIFEOS-095 — Capture Home / One Place to Tell Conqify Anything

**North star:** open Conqify, say what's happening, and get back to your life.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `b66f69b8f20192d102db23bc02bbff1e0d4a73c4` (PR #100 merged) |
| Branch | `claude/lifeos-095-capture-home` |
| Migration required | **no** (§38) |
| Repository migration head | **0047**, unchanged |

---

# 1. The audit (§2)

Measured against the running production build with Playwright, on two
viewports × two users. Probes: `scratchpad/audit95.cjs` (geometry, above-fold,
everything rendered before the input) and `scratchpad/audit95b.cjs` (the submit
flow, six real captures, and the mobile keyboard).

## 1.1 A, B — What is above the fold

**The capture input is already above the fold in all four cases, and it is
autofocused.** That is worth saying first, because two of the briefed reds
assume otherwise.

| | viewport | input top | input fits | submit | focus on load |
|---|---|---|---|---|---|
| desktop / fresh | 1280×800 | 334 | yes | 516 | `#capture` |
| desktop / returning | 1280×800 | 418 | yes | 600 | `#capture` |
| mobile / fresh | 390×844 | 400 | yes | 582 | `#capture` |
| mobile / returning | 390×844 | **529** | yes | **711** | `#capture` |

What sits above the input, measured in document order rather than guessed:

```
0–110    nav (two rows on mobile) + search row
123–241  "YOU ONCE WROTE" — the resurfaced-belief card   (returning only)
284–348  "YOU LIVE. CONQIFY KEEPS TRACK."                 tagline
         "What's on your mind?"                            h1
         "Errands, appointments, ideas, things you're …"    2-line paragraph
418      the textarea
```

Three stacked pieces of copy, then the input.

## 1.2 C — Clicks to type

**Zero.** `autoFocus` is on the textarea and the cursor is in it on load. The
front door is not behind a modal, a button, or a route change. §4 is already
satisfied.

## 1.3 D — What competes with capture

* **The resurfaced-belief card**, above the composer on every returning user.
  It costs 129 px, and on mobile it is what pushes the input to 529.
* **The bottom bar on mobile** — a persistent search field and a `+` FAB. In
  the screenshot it **clips the helper text under the Capture button**.
* **Three capture entry points** in one viewport: this page, the nav's
  "Capture ▾" menu, and the FAB.

## 1.4 E — What appears after a successful capture

Measured by confirming a real capture and reading the page:

```
url:    /
toast:  ""                       ← gone within 1.2 s
main:   the empty composer, exactly as before
```

The toast is `"Saved 1 thing."` — it names nothing, links to nothing, offers no
undo, and vanishes. **After a successful capture the page is indistinguishable
from a page where nothing happened.** There is no recent list, no result, no
trace. This is the sharpest finding in the audit.

## 1.5 F — What makes capture feel unfinished

Every capture requires a **second press**. `authorityFor` already grades a
high-confidence Action, Waiting, Note and Event as `auto_with_undo` — but that
grade only decides whether a checkbox arrives *ticked*. The commit still waits
for "Confirm all". So the flow for the most ordinary sentence in the product is

```
type → Capture → read a card → press Confirm all → toast vanishes → nothing
```

§31's auto-safe tier exists in the model and is not used at the one moment it
was built for.

## 1.6 G — Where context suggestions are noisy

Measured on `"Email Marcus about the lease tomorrow"` against a store holding
the matching Action:

```
POSSIBLE CONTEXT
Looks like this may refer to: Email Marcus about the lease
“marcus” and “lease” match an open Action. Nothing has been changed.
Person · Marcus
Name appears in the capture.
```

Thirteen nodes: a section heading, a lead-in sentence, the record's title, a
quoted-token explanation, a disclaimer, a second row, and a second reason.
§12's "bad" example almost verbatim.

It is also **the same sentence three times on one screen** — in the textarea,
as the candidate's title, and again inside the context block (§18).

## 1.7 H — Decisions surfaced too aggressively

Not on Home. `/today/decisions` (094) is not reproduced here and Home shows no
decision count at all. The gap is the other way: §14's small secondary
indicator does not exist.

## 1.8 I — Onboarding

**Nothing onboarding-shaped renders on `/`.** The "Getting started" checklist
lives on `/today`, below the fold. §19's premise does not hold on this route,
and there is nothing to move.

## 1.9 J — What can be deleted or collapsed

* The tagline **"YOU LIVE. CONQIFY KEEPS TRACK."** — a slogan above the primary
  input.
* The two-line instructional paragraph — §7 says avoid these.
* The three-clause placeholder, which is a paragraph in a text field (§8).
* The context block's lead-in sentence and disclaimer.
* The belief card's position, not the card.

## 1.10 The reds (§39)

| # | Claim | Verdict |
|---|---|---|
| 1 | Capture not above fold on mobile | **NOT CONFIRMED** — 400 (fresh) / 529 (returning) of 844 |
| 2 | Capture not above fold on desktop | **NOT CONFIRMED** — 334 / 418 of 800 |
| 3 | Onboarding competes with capture | **NOT CONFIRMED on `/`** — no onboarding renders here |
| 4 | Success leaves the user in a workflow | **CONFIRMED** — and worse: it leaves them with nothing |
| 5 | Same capture appears multiple times | **CONFIRMED** — textarea, title, context lead-in |
| 6 | Context suggestions too verbose | **CONFIRMED** — 13 nodes, §12's bad example |
| 7 | Ambiguous capture lacks a local choice | **NOT CONFIRMED** — 089's chooser is local and works |
| 8 | Recent captures / results absent or noisy | **CONFIRMED — absent entirely** |

Four of eight. The three "not confirmed" are stated as measurements rather than
quietly dropped, because the brief predicted them and the build had already
fixed them.

### A red the brief did not predict

**The mobile keyboard.** Simulated at a 508 px visible height (390×844 phone
with a standard keyboard), on a returning user:

```
input  top 529  → below the visible area
submit top 711  → below the visible area
```

Neither the field nor the button is reachable without scrolling past 529 px of
chrome, slogan and helper copy. §26 makes this the requirement that matters
most, and it is the one that fails.

## 1.11 What the audit says to build

Nothing about the *engine*. `interpret`, `suggestContext`, `authorityFor` and
`commitCapture` all work and none of them are touched. The gap is entirely in
what Home does with them:

1. **Use the authority tier that already exists** — commit an all-auto-safe
   capture on submit, with undo, instead of asking for a press (§31).
2. **Say what happened** — a finished state naming the record, replacing a
   toast that names nothing (§10).
3. **Show the last few captures and what they became** — derived from
   `sourceCaptureId`, which is already persisted (§15, §16, §17).
4. **Cut the copy above the input** and move the belief card below it (§5, §7).
5. **Compress the context block** to one line per suggestion (§12).

No new route (§37). No migration (§38). No new interpretation engine.
