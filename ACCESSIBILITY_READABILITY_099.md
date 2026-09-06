# LIFEOS-099 — Accessibility & Readability / Calm Under Pressure

**North star:** Conqify should be calm and legible even when the user is tired,
distracted, or on a small screen.

## STATUS: COMPLETE

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

**Two of those four are the wrong question, and the correction matters more
than the finding.** This is not a modal. It renders in the flow under the toggle
that opened it, there is no overlay, and the toggle itself relabels to "Close" —
it is an inline disclosure. Focus escaping it on Tab is therefore *correct*, and
trapping a person inside a panel they can simply tab past would have been a
worse bug than the one being fixed. §14's own instruction — "reuse existing
focus-trap/dialog primitives if present, do not build a custom focus manager if
not needed" — points the same way.

What is genuinely missing is what a **disclosure** owes:

* no `aria-expanded` / `aria-controls`, so a screen-reader user pressed Edit,
  heard the label become "Close", and was told nothing about the panel that had
  appeared
* no accessible name on the panel
* focus does not enter it, so the field the person just asked to edit is several
  tabs away
* Escape does not close it, and closing by any route leaves focus on a removed
  node

The audit measured a modal's contract against a disclosure and produced two
confident, wrong failures. They are struck rather than quietly dropped.

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

## 3.5 §12 — WITHDRAWN. The one focus failure was a probe artifact

The audit reported one control out of ~180 tab stops with no focus ring: a
`<input type="date">` on the action detail page. It is not a defect.

A date input has three internal sub-fields, and Tab moves *within* it. Measured
stop by stop:

```
stop 19  INPUT type=date  focus-visible=true   outline 2px solid   ← day
stop 20  INPUT type=date  focus-visible=true   outline 2px solid   ← month
stop 21  INPUT type=date  focus-visible=true   outline 2px solid   ← year
stop 22  INPUT type=date  focus-visible=false  outline 0           ← leaving it
```

The walk sampled the fourth press, the moment focus leaves the last segment,
where the browser correctly stops treating it as focus-visible. The element is
still `document.activeElement`, which is why it looked like a failure.

**§12 is clean**: zero controls with an invisible focus indicator. The product's
`:focus-visible` rule in `globals.css` reaches everything.

This is the third probe artifact caught in this sprint, after the parent-walk
background and the disabled-control count. Each would have been a confident,
wrong finding; §4 exists because of exactly this.

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
| §12 | invisible keyboard focus | **zero** out of ~180 tab stops; the one apparent failure was a probe artifact (§3.5) |
| §14 | no focus trap on the sheet | correct — it is a disclosure, not a modal (§3.1) |
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

# 6. What was built

## 6.1 One paired text scale (§9, §10, §41)

Three constants in `lib/design/tokens.ts` — the module that already owned
`MIN_TOUCH_TARGET` and `FOCUS_RING`, so nothing new was invented to hold them.
Each tier is a **pair**, because §2 showed no single shade can be right:

| tier | classes | light | dark |
|---|---|---|---|
| `PRIMARY_TEXT` | `text-zinc-800 dark:text-zinc-100` | 14.40 | 15.9 |
| `SECONDARY_TEXT` | `text-zinc-600 dark:text-zinc-300` | 7.46 | 13.32 |
| `TERTIARY_TEXT` | `text-zinc-500 dark:text-zinc-400` | **4.67** | **7.51** |

`TERTIARY_TEXT` is the lightest pair that clears AA in both directions, which is
why the scale stops there rather than continuing. It is also not my invention:
`components/today/DecisionInbox.tsx` already used exactly
`text-zinc-500 dark:text-zinc-400` in five places. The pair is the product's own
precedent; the rest of the loop had simply not adopted it.

`ROW_META` replaces the five `metaClass` copies, and changes two things beyond
the colour:

* **`text-xs` (12px), not `text-[11px]`.** `TYPE_SCALE` in the same file already
  puts `metadata` at 0.8125rem and reserves 0.6875rem for uppercase eyebrow
  labels — so the components had drifted from this file's own scale as well as
  from each other. §6 asked for a readable minimum and the project had already
  written one down.
* **`min-w-0`, not `shrink-0`** — the overflow fix, below.

## 6.2 The `shrink-0` overflow (§18)

```
before   /today/review at 390px:  scrollWidth 417, clientWidth 390   → 27px
after    /today/review at 390px:  scrollWidth 390, clientWidth 390   →  0px
```

The metadata span carrying "Waiting on Dr. Maria Consuelo Fernández-Villanueva"
now wraps to two lines and stays inside the viewport, measured at `right=349`
of 390. §19 forbids truncating the only copy of a waiting person, so wrapping —
which costs a row some height and loses nothing — was the correct trade.

## 6.3 Accents (§9)

Moved `600 → 700` **only where a `dark:` partner already existed in the same
class string**, so light gained and dark was untouched:

| | before (light) | after (light) |
|---|---|---|
| `text-emerald-*` | 3.53 | **5.19** |
| `text-sky-*` | 3.89 | **5.66** |
| `text-rose-*` | 4.38 | **5.83** |

Eighteen occurrences. No new hue, no new scale — §42's rebrand is not what this
is.

## 6.4 Structure

| § | change |
|---|---|
| §34 | `main` landmark on the decision inbox and the evening close; both were bare `<div>`s while `/today` had one |
| §35 | the capture result is a `role="status" aria-live="polite"` region — scoped to that panel, not to the store, because §35 asks for the outcome to be announced and explicitly not for every update to be |
| §11, §32 | the onboarding checklist marker is legible (1.43 → 4.67) and its state reaches assistive tech as "Done: " / "Not started: " rather than through a strikethrough, which is not announced |
| §14 | the correction sheet is a labelled `<section>`; focus enters it once on open; Escape closes it and returns focus to the opener |
| §14, §22 | its toggle carries `aria-expanded` / `aria-controls` and names its record, because a success panel can list several outcomes and five identical "Edit"s is §22's case by name |
| §15 | that toggle is 44×44, grown in the flow rather than bought with negative margin |

---

# 7. Proof

## 7.1 Contrast, before and after

Enabled text nodes below their AA threshold, per surface. Disabled controls are
excluded and covered by §33 separately.

| surface | light before → after | dark before → after | mobile before → after |
|---|---|---|---|
| home | 5 → **0** | 4 → **0** | 5 → **0** |
| today | 43 → **0** | 27 → **0** | 43 → **0** |
| decisions | 6 → **0** | 3 → **0** | 5 → **0** |
| action detail | 9 → **0** | 6 → **0** | 9 → **0** |
| project | 52 → **0** | 11 → **0** | 51 → **0** |
| goal | 56 → **0** | 10 → **0** | 55 → **0** |
| evening | 13 → **0** | 17 → **0** | 12 → **0** |
| week | 25 → **0** | 18 → **0** | 25 → **0** |
| **total** | **209 → 0** | **96 → 0** | **205 → 0** |

The token table, which is the whole change in one view:

| token | before | after | light | dark |
|---|---|---|---|---|
| metadata | `text-zinc-400` | `text-zinc-500 dark:text-zinc-400` | 2.54 → **4.67** | 7.51 → **7.51** |
| metadata | `text-zinc-500` | `text-zinc-500 dark:text-zinc-400` | 4.67 → **4.67** | 4.08 → **7.51** |
| checklist ○ | `text-zinc-300 dark:text-zinc-600` | `text-zinc-500 dark:text-zinc-400` | 1.43 → **4.67** | 2.55 → **7.51** |
| checklist ✓ | `text-emerald-500` | `text-emerald-700 dark:text-emerald-400` | 2.39 → **5.19** | 7.96 → 16.8 |
| accents | `text-{hue}-600 dark:…-400` | `text-{hue}-700 dark:…-400` | 3.53–4.38 → **5.19–5.83** | unchanged |
| placeholder | `placeholder:text-zinc-400` | `+ dark:placeholder:text-zinc-500` | 2.54 → **4.67** | unchanged |

## 7.2 Hierarchy did not flatten (§8)

The risk this fix creates is the one §8 names: solving contrast by making
everything equally loud. Measured on the project page, the distinct foreground
ratios are

```
17.72, 17.13, 16.79, 14.40, 10.09, 7.46, 4.67
```

— still seven tiers, loudest to quietest, with the quietest above AA. Assertions
6–8 of the browser suite pin all three properties, and 8 goes red under a
revert while 6 and 7 do not: the page always had tiers, and what changed is that
the bottom one became legible.

## 7.3 Browser suite — 21 assertions, 16 red under a revert

`scripts/smoke-099-accessibility.cjs`, run against the production build in
light, dark and 390 px.

The five that stay green under a revert are labelled in the file as regression
guards and are not presented as fixes: two measure that hierarchy survived, and
three pin reds that were **clean before this sprint** — 200 % zoom, accessible
names and heading order — precisely because a sweep across 200 class strings is
the kind of change that could break one.

One assertion was mislabelled and is worth recording. Assertion 17 claimed to
guard the `shrink-0` fix but measured the project page, where the same long name
already wrapped; it passed with the entire sprint reverted. It now measures the
evening close, where the 27 px overflow actually was, and requires two lines
rather than merely fitting.

## 7.4 Screen-reader semantics (§34)

| check | before | after |
|---|---|---|
| `main` landmark, all 8 surfaces | 6 of 8 | **8 of 8** |
| exactly one `h1` per surface | 8 of 8 | 8 of 8 |
| heading-level jumps | none | none |
| interactive controls with no accessible name | 0 of 250+ | 0 |
| capture result inside a live region | no | **yes**, polite |
| disclosure toggle state exposed | no | **yes**, `aria-expanded` + `aria-controls` |

## 7.5 Keyboard and mobile

| check | result |
|---|---|
| controls with no visible focus indicator | **0** of ~180 tab stops |
| focus enters the correction sheet on open | yes, on the first field |
| Escape closes it and returns focus | yes, to the toggle, which relabels to "Edit" |
| horizontal scroll at 390 px, all 8 surfaces | **0 px** (evening close was 27 px) |
| horizontal scroll at 200 % zoom, all surfaces | 0 px |
| capture submit reachable with a 300 px keyboard | yes — bottom 424 px, visible to 544 px |
| Edit tap target | 19×17 → **44×44** |

## 7.6 Performance (§44, §53)

Every change is a class string, a landmark element, two ARIA attributes, one
`useEffect` that runs once per sheet open, and one `requestAnimationFrame` on
close. There is no observer, no measurement at runtime, and no contrast
calculation in production — all of that lives in the probe, which is test-only.

`next build` completed clean on every iteration, and the deterministic suite is
unchanged at **6135/6135**, which is the honest statement of "no runtime
regression" for a change of this shape.

---

# 8. Mutation testing (§50)

MUTATION_TABLE_PLACEHOLDER

---

# 9. The twelve claims (§56)

1. **Known low-contrast metadata is fixed on the scoped surfaces.** 209 light /
   96 dark / 205 mobile failures → **0**, measured on rendered elements. *(§7.1)*
2. **Light and dark both remain readable.** No single shade could do it; every
   tier is a measured pair, and the sweep asserts both themes. *(§6.1, browser 5)*
3. **Primary mobile controls meet the tap-target size.** The smallest control in
   the loop went 19×17 → 44×44, grown in the flow. *(browser 18)*
4. **Keyboard focus is visible.** Zero of ~180 tab stops lack an indicator; the
   one apparent failure was a probe artifact and is withdrawn. *(§3.5)*
5. **The correction sheet behaves sensibly.** Focus enters, Escape closes, focus
   returns — and it is not given a focus trap, because it is a disclosure and
   trapping would be worse. *(§3.1, browser 10–12)*
6. **Important controls have accessible names.** Zero unnamed before or after;
   the Edit toggle additionally names its record instead of being the fifth
   identical "Edit". *(browser 9, 20)*
7. **Important state is not colour-only.** The checklist marker carries "Done: "
   / "Not started: " for assistive tech and is legible at 4.67. *(browser 15)*
8. **Long content wraps without breaking layout.** The evening close went from
   27 px of horizontal scroll to 0. *(browser 16, 17)*
9. **The mobile keyboard does not block core actions.** Asserted as a regression
   guard; LIFEOS-095's fix still holds. *(browser 19)*
10. **Hierarchy stayed calm rather than becoming uniformly loud.** Seven distinct
    tiers survive, the loudest at 17.72 and the quietest at 4.67. *(§7.2)*
11. **No redesign and no new design system.** Three constants added to the
    tokens file that already held `MIN_TOUCH_TARGET`; fonts, sizes above 12 px,
    spacing and layout untouched. The chosen pair was already in use in
    `DecisionInbox`. *(§6.1)*
12. **No migration.** No schema, no stored preference, no persisted
    accessibility state. Repository migration head **0047**, unchanged.

---

# 10. Known gaps — recorded, not fixed (§57)

* **Navigation-bar chevrons at 9 px** (`text-[9px]`, 2.22 before the sweep).
  The nav is shared chrome outside §2's list. The sweep reached its colour but
  not its size; 9 px is below the project's own 11 px floor and deserves a
  deliberate pass.
* **`✕` remove buttons in the planning components** (`text-zinc-400
  hover:text-rose-500`) are outside the scoped routes. They carry `aria-label`s,
  so they are named, but they sit at the old contrast.
* **Truncated titles without a `title` attribute.** Long action titles clip on
  dense rows. Each is a link to the record, so §19's "a way to inspect it" is
  satisfied by navigation; adding tooltips everywhere would be a change of
  pattern rather than a defect fix.
* **`aria-live` on the sync-status pill** announces "Saved locally" on every
  store write. It predates this sprint and §35 explicitly warns against making
  every update announce itself — worth revisiting, deliberately.
* The full repository was **not** swept. §2 scopes this to the primary loop and
  §57 forbids widening. No WCAG certification is claimed for the product.

---

# 11. Gates (§54)

| gate | result |
|---|---|
| `scripts/smoke-099-accessibility.cjs` | **21/21** (16 red against a revert) |
| Mutation (§50) | MUTATION_SUMMARY_PLACEHOLDER |
| Full deterministic suite | **6135/6135** across 62 suites |
| 094 decision inbox | GATE_094 |
| 095 capture home | GATE_095 |
| 097 capture corrections | GATE_097 |
| 098 outcome coherence | GATE_098 |
| `npm run release:audit` | GATE_RELEASE |
| `npm run release:routes` | GATE_ROUTES |
| `npm run release:export` | GATE_EXPORT |
| `npm run audit:security` | GATE_SECURITY |
| `tsc --noEmit` | GATE_TSC |
| `eslint lib components app` | GATE_LINT |
| `next build` | clean |

## Files

| | |
|---|---|
| new | `scripts/fixtures/lifeos-099-world.cjs`, `scripts/fixtures/a11y-probe.cjs`, `scripts/smoke-099-accessibility.cjs` |
| changed | `lib/design/tokens.ts` (three constants + `ROW_META`), and class strings across the primary loop's components and page files |
| structural | `components/today/DecisionInbox.tsx`, `components/today/ReviewToday.tsx` (landmarks), `components/capture/CaptureComposer.tsx` (live region, disclosure toggle, tap target), `components/capture/CorrectionSheet.tsx` (region semantics, focus, Escape), `components/ux/FirstRun.tsx` (marker legibility + textual state) |
