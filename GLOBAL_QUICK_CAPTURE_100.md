# LIFEOS-100 — Capture From Anywhere / Global Quick Capture

**North star:** no matter where I am in Conqify, Capture should be one action away.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

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
