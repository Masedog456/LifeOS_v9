# LIFEOS-099 — Accessibility & Readability / Calm Under Pressure

**North star:** Conqify should be calm and legible even when the user is tired,
distracted, or on a small screen.

## STATUS: AUDIT COMPLETE — IMPLEMENTATION IN PROGRESS

| | |
|---|---|
| Base SHA | `aba13cb3cdfd3edae0f8488d423b769718858c99` (PR #104 merged) |
| Branch | `claude/lifeos-099-accessibility-readability` |
| Migration required | **no** (§46) |
| Repository migration head | **0047**, unchanged |

---

# 1. How this was measured (§4)

Every number below comes from the running production build, through one shared
probe (`scratchpad/a11y-lib.cjs`) so a measurement and the assertion that pins
it cannot disagree about method.

**Colour.** Computed styles on this project return `lab(...)`, not `rgb(...)`.
The probe converts through a 1×1 canvas — the browser's own parser — which also
resolves `oklch()`, `color-mix()` and CSS variables for free. Backgrounds are
**composited**, not read from one declaration: the walk alpha-blends every
translucent layer up the tree until it reaches something opaque, then the page
ground, and multiplies in every inherited `opacity`.

Two probe bugs were caught and fixed before any finding was reported, which is
the whole reason §4 exists:

* The background walk started at `el.parentElement`, so every primary button —
  which paints its own background *and* its own label — measured white-on-page
  at **1.00**. Starting at the element itself gives the real number.
* Disabled controls were counted as failures. The Capture button is `opacity:
  0.3` until the field has content; its 2.70 is §33's question, not §5's, and
  conflating them would have inflated the failure count with text that is
  *supposed* to be faded.

**Surfaces.** The eight routes of the primary loop (§2), each in light, dark and
390 px. `/actions/a-long` stands in for action detail; the correction sheet is
driven through a real capture.

**Fixture.** `scripts/fixtures/lifeos-099-world.cjs` — a module, not an
`eval`-ed slice of a smoke script, which is how LIFEOS-098's probes broke twice.
It carries a 103-character action title, a 39-character person's name, an
overdue action, a wait whose follow-up passed and one due today, a blocked
action and its blocker, a cancelled and a completed record, a thrice-deferred
action, a long project and goal, a reflection, a capture with an outcome, an
event and an adopted rule.

---

# 2. The finding: no zinc shade passes AA in both themes

Measured on the real grounds — the page body and a section card are the same
colour on this product, so one column suffices.

| token | rgb | light (on `rgb(252,251,249)`) | dark (on `rgb(11,11,10)`) |
|---|---|---|---|
| `text-zinc-300` | `212,212,216` | **1.43** ✗ | 13.32 ✓ |
| `text-zinc-400` | `159,159,169` | **2.54** ✗ | 7.51 ✓ |
| `text-zinc-500` | `113,113,123` | 4.67 ✓ | **4.08** ✗ |
| `text-zinc-600` | `82,82,92` | 7.46 ✓ | **2.55** ✗ |
| `text-zinc-700` | `63,63,71` | 10.09 ✓ | **1.89** ✗ |
| `text-zinc-800` | `39,39,42` | 14.40 ✓ | **1.32** ✗ |

**There is no single shade that passes 4.5:1 in both modes.** That is the whole
shape of the problem, and it is why LIFEOS-098's report could truthfully say
"2.54 in light" and "4.08 in dark" about two different tokens on the same page.

It also rules out the obvious fix. Changing `text-zinc-400` to `text-zinc-600`
would take light from 2.54 to 7.46 and dark from 7.51 to **2.55** — §10's
"do not fix one mode and weaken the other", exactly.

The product already knows this. Beside the failing declarations sits:

```
const linkClass = "… text-zinc-800 hover:underline dark:text-zinc-100";   ✓ paired
const metaClass = "shrink-0 text-[11px] text-zinc-400";                   ✗ unpaired
```

Body text is paired and passes in both modes. Metadata is not paired, and does
not.

## 2.1 And `metaClass` is declared five times, with two different values

| file | value |
|---|---|
| `components/today/ReviewToday.tsx` | `shrink-0 text-[11px] text-zinc-500` |
| `components/today/TodayCommandCenter.tsx` | `shrink-0 text-[11px] text-zinc-500` |
| `components/memory/WeekInReview.tsx` | `shrink-0 text-[11px] text-zinc-400` |
| `components/execution/GoalCommandView.tsx` | `shrink-0 text-[11px] text-zinc-400` |
| `components/execution/ProjectWorkingState.tsx` | `shrink-0 text-[11px] text-zinc-400` |

This is LIFEOS-098's pattern again, one layer down: five copies of one decision,
already drifted into two values, neither carrying a `dark:` variant. §41's
"one repeated problematic class combination" is not hypothetical here — it is
the same constant, five times.

## 2.2 The scale of it, and the scope

Across the eleven files of the primary loop:

```
                                        zinc-400   zinc-500   with dark:
components/today/TodayCommandCenter.tsx      10         10        0
components/today/ReviewToday.tsx              1          7        0
components/today/DecisionInbox.tsx            5          5        5
components/memory/WeekInReview.tsx           11          7        0
components/execution/GoalCommandView.tsx     13         10        0
components/execution/ProjectWorkingState.tsx  9          6        0
components/capture/CorrectionSheet.tsx       11          2        0
components/capture/RecentCaptures.tsx         7          1        0
components/capture/CaptureComposer.tsx       11          7        0
components/actions/ActionDetail.tsx           8         10        0
app/page.tsx                                  1          2        0
                                            ---        ---
                                             87         67
```

Per-surface failure counts, enabled text only (disabled controls excluded and
reported separately under §33):

| surface | light | dark | mobile |
|---|---|---|---|
| home | 5 / 12 | 4 / 12 | 5 / 12 |
| today | 43 / 118 | 27 / 118 | 43 / 118 |
| decisions | 6 / 40 | 3 / 40 | 5 / 37 |
| action detail | 9 / 29 | 6 / 29 | 9 / 29 |
| project | 52 / 107 | 11 / 107 | 51 / 106 |
| goal | 56 / 98 | 10 / 98 | 55 / 97 |
| evening | 13 / 78 | 17 / 78 | 12 / 74 |
| week | 25 / 73 | 18 / 73 | 25 / 73 |

Light mode is worse because `zinc-400` (2.54) is the more common token; dark
mode fails on `zinc-500` (4.08) instead. Both modes fail; neither is safe.

---

# 3. The other measured failures

## 3.1 §14 — the correction sheet has no dialog behaviour at all

Driven through a real capture, opening LIFEOS-097's sheet from the Edit control:

```
on open      focus inside the sheet:  false          (focus sits on "Close")
             role:                    null
             aria-modal:              null
             aria-label / labelledby: null
             focusable controls:      8
tab trap     9 of 24 tab presses landed OUTSIDE the sheet
Escape       sheet still open, focus not returned to the opener
```

Four separate failures, and the third is §14's "background should not become an
accidental keyboard playground" happening literally.

## 3.2 §18 — the evening close scrolls sideways on a phone

```
/today/review at 390px:  scrollWidth 417  clientWidth 390   →  27px of horizontal scroll
```

Root cause, measured:

```
SPAN  class="shrink-0 text-[11px] text-zinc-500"  left=45 width=372 right=417
      "Waiting on Dr. Maria Consuelo Fernández-Villanueva since …"
```

`shrink-0` on a metadata span that holds a person's name. The span refuses to
shrink, overruns the viewport, and drags the fixed command bar out with it —
the same `metaClass` constant as §2.1, failing a second way.

Every other scoped surface is 0 px at 390 px.

## 3.3 §34 — two scoped surfaces have no `main` landmark

```
/today            main=1
/today/decisions  main=0
/today/review     main=0
```

Both render their content in a bare `<div>`. A screen-reader user cannot jump
to the content of the decision inbox or the evening close.

## 3.4 §35 — the capture result is shown but never announced

```
capture result node present:      true
inside an aria-live region:       false
```

Two polite live regions exist on every page (the sync-status pill and an empty
one), so the primitive is already in the product; the capture outcome is simply
not in one. A screen-reader user submits a capture and hears nothing.

## 3.5 §12 — one control with no visible focus indicator

Out of roughly 180 tab stops across the eight surfaces, exactly one:

```
/actions/a-long   INPUT "Due"   outline:none  box-shadow:none
                  class="rounded-lg border border-black/10 bg-transparent px-2 py-1 …"
```

## 3.6 §15 — tap targets, with judgement applied

Nearly every control measures under 44 px, but §16 explicitly permits inline
text links to stay visually compact. Filtering to the **primary** controls §15
names:

| control | surface | measured |
|---|---|---|
| **Edit** | Home, capture result | **19 × 17** |
| Complete | Today row | 70 × 25 |
| Not today | Today row | 72 × 27 |
| Reschedule | Today row | 78 × 27 |
| Capture (submit) | Home | 101 × 40 |
| decision options | `/today/decisions` | 27–32 tall |

Home's **Edit at 19×17 px** is the worst target in the primary loop, on the
surface a person touches most.

## 3.7 §11, §30 — colour-carried meaning and faint destructive controls

| text | classes | ratio |
|---|---|---|
| `✓` (onboarding checklist) | `text-emerald-500` | **2.39** |
| `Delete project` | `text-zinc-400` (red on hover) | **2.54** |
| `Delete permanently…` | `text-zinc-400` (rose on hover) | **2.54** |
| `Ready` | `text-emerald-600 dark:text-emerald-400` | **3.53** |
| `Open Insights →` | `text-sky-600 dark:text-sky-400` | **3.89** |
| `Cancel` | `text-rose-600 dark:text-rose-400` | **4.38** |

The checklist tick is the only colour-only case in the primary loop: `○` and `✓`
differ by glyph *and* colour, but the glyph pair is the state's only textual
carrier and the tick sits at 2.39.

---

# 4. Measured NON-failures — reds that do not hold

§47 asks for real reds, not hypothetical ones. Six of the ten it lists were
measured and came back clean. Reporting that is the point.

| § | claim | measurement |
|---|---|---|
| §22 | icon-only controls with no accessible name | **0** across all eight surfaces, 250+ controls |
| §20 | nonsensical heading jumps | **none**; every surface has exactly one `h1` and no skipped level |
| §39 | horizontal scroll at 200 % zoom | **0 px** on all seven surfaces tested at 640 CSS px |
| §17 | mobile keyboard hiding the capture submit | reachable — submit bottom 424 px, visible to 544 px with a 300 px keyboard. LIFEOS-095's fix holds |
| §12 | invisible keyboard focus | one control out of ~180 tab stops (§3.5) — not a pattern |
| §25 | placeholder used as the only label | the capture field has a real associated label; the placeholder is supplementary |

---

# 5. Known gaps — recorded, not fixed (§57)

* **Navigation-bar chevrons** render at 9 px (`text-[9px] text-zinc-400`, 2.22).
  The nav is a shared chrome component outside §2's list; it is named here so
  the next pass can take it deliberately.
* **`text-sky-600` links at 3.89** and **`text-emerald-600` at 3.53** are below
  AA. They are a different decision from the neutral metadata scale — a brand
  accent question — and changing accent hues is closer to §42's forbidden
  rebrand than to this sprint's job.
* **Truncated titles without a `title` attribute.** Long action titles are
  clipped on Today, project and goal rows. Each clipped title is a link to the
  record, so §19's "a way to inspect it" is satisfied by navigation; adding
  tooltips everywhere would be a change of pattern, not a defect fix.
* The full repository was not swept. §2 scopes this to the primary loop, and
  §57 forbids widening.

---

# 6. What will be built

Ordered by measured severity, and no wider:

1. **One paired metadata token.** `text-zinc-500 dark:text-zinc-400` — 4.67
   light, 7.51 dark, both passing, hierarchy preserved. Replaces five
   `metaClass` copies and the unpaired declarations they stand for.
2. **Drop `shrink-0`** from the metadata span so a long name wraps instead of
   overrunning the viewport.
3. **Dialog semantics and focus behaviour** for the correction sheet.
4. **A `main` landmark** on the decision inbox and the evening close.
5. **A polite live region** for the capture result.
6. **A focus ring** on the date input; **44 px** on Home's Edit control.
7. **Destructive controls** given a token that is legible at rest.

No new design system, no typography change, no persistence, no migration.
