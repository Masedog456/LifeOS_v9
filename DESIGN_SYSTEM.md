# Design System (LIFEOS-041)

LifeOS should feel like a private study joined to a restrained command center:
quiet, precise, serious, personal — warm without becoming decorative,
information-rich without becoming crowded. Not enterprise PM software, not a
gamified habit tracker, not a generic AI dashboard, not a database console, not a
brightly colored consumer task app. This document is the system; every value is
code (`lib/design/*`) and test-enforced (`design` self-tests, 63 assertions).

## Principles (`lib/design/principles.ts`)

1. Show the next meaningful decision.  2. Reveal complexity progressively.
3. Preserve context during navigation.  4. Prefer neutral language.
5. Let records feel connected, not crowded.  6. Keep destructive actions quiet
but unmistakable.  7. Make keyboard and pointer equivalent.  8. Never use visual
intensity as a substitute for hierarchy.  9. Empty space is structural.
10. The interface does not judge the user.

Every major UI change traces to ≥1 principle (`TRACEABLE`, self-test enforced).

## Tokens (`lib/design/tokens.ts`, emitted to `app/globals.css`)

Spacing (4px grid), radii, borders, control heights (per density), motion
durations (fast 120 / base 180 / slow 240 ms; no bounce), easing, focus ring
(2px, offset, always visible), content widths (reading 42rem for line length),
panel widths (nav / inspector), breakpoints (320–1536), icon sizes (one family),
and a typography scale with size / line-height / weight per role. Nothing renders
below **11px** metadata; hierarchy comes from size + space + weight, never
saturation. `tokensToCssVars()` emits `--space-*`, `--radius-*`, `--duration-*`,
`--text-<role>-*`, etc.

## Color (`lib/design/color.ts`)

A restrained, role-based semantic model — **not** a rainbow taxonomy for record
types. Roles: canvas, surface(+raised/sunken), text primary/secondary/muted,
border subtle/strong, accent (near-neutral), focus, success, warning, danger,
info, selected, archived, disabled — each with a light + dark value. Saturation
is deliberately low; destructive is clearly differentiated. **No meaning by color
alone** — every status color is paired with a text/icon cue (`StatusNotice`), and
insights use neutral labels (no red/green performance coding). `contrastRatio` +
`meetsAA` verify WCAG AA for text (≥4.5) and UI/large (≥3.0); the self-test
checks primary/secondary/muted/danger/focus in both modes.

## Typography

Roles: product title, route title, section title, card title, body, compact
body, metadata, label, button, input, code/identifier, numeric metric (tabular).
Readable to 200% zoom; reading surfaces cap line length; hierarchy stays visible
without relying only on weight.

## Density, motion, responsive

- **Density** (`density.ts`): compact / comfortable / spacious control heights &
  row padding — a bounded UI preference, never a layout redesign.
- **Motion** (`motion.ts`): short transitions for panel/modal/inspector/row/
  route/focus; `prefersReducedMotion` (OS or `prefs.ui.reducedMotion`) → 0ms;
  globals.css disables nonessential animation under reduced motion.
- **Responsive** (`responsive.ts`): deviceClass / navForm / inspectorForm /
  tableStrategy decide, per width, that mobile uses a bottom bar (never the whole
  desktop sidebar), the inspector becomes a drawer below `lg` (never crushing
  workspace width), and tables stack into cards on phones. See
  `RESPONSIVE_BEHAVIOR.md`.

## Shared components (`components/design/*`)

Canonical, reused (Feature 21): `EmptyState` (built from the microcopy model —
what's absent, why, one next action), `LoadingState` (layout-preserving
skeleton, reduced-motion aware), `StatusNotice` (color + required text cue,
role=status/alert), `ShortcutReference`, `HelpDrawer`. Confirmation levels
(`lib/design/confirmation.ts`) reuse the LIFEOS-040 deletion-semantics registry:
level 1–2 reversible (Undo), 3 destructive (never pre-focused, Enter doesn't
confirm), 4 permanent (typed phrase). Interaction states (default/hover/focus/
active/selected/disabled/loading/error) never depend on hover; focus is never
removed without a replacement.

## What did NOT change

No domain architecture, no new state manager, no AI/agents/embeddings/
recommendations/automation/collaboration/notifications/calendar, no streaks,
gamification, engagement analytics, dark patterns, or novelty animation. Polish
makes LifeOS quieter and easier to trust — never louder.

---

## Version 1 Release Candidate (LIFEOS-042)

This area is included in the Version 1 release candidate (`v1.0.0-rc1`). Release
scope, evidence, and gates live in `V1_RELEASE_NOTES.md`, `V1_ACCEPTANCE_REPORT.md`,
`V1_KNOWN_LIMITATIONS.md`, and `V1_RELEASE_CHECKLIST.md`; the `/release` surface
shows live readiness. No new features were added in this sprint — only release
packaging and demonstrated fixes.
