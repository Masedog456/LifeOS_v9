# Responsive Behavior (LIFEOS-041, Feature 28)

Breakpoints LifeOS commits to testing: **320, 375, 390, 768, 1024, 1280, 1440+**
(`lib/design/responsive.ts` + `tokens.ts`). Decisions are pure functions so the
E2E and the `design` self-test assert them deterministically.

| Width | Device | Navigation | Inspector | Tables |
| --- | --- | --- | --- | --- |
| < 768 | mobile | bottom bar (compact, not the desktop sidebar) | drawer | stacked cards |
| 768–1023 | tablet | collapsible sidebar | drawer | horizontal scroll container |
| ≥ 1024 | desktop | sidebar (collapsible < 1280) | side panel | full table |

## Rules

- **No horizontal page overflow** at any width (E2E checks 320 & 390 explicitly;
  the shell body never scrolls sideways — wide content scrolls inside its own
  container).
- **Tables** have a deliberate small-screen strategy (stack → scroll → full),
  never a desktop table merely shrunk until unreadable.
- **Dialogs** fit within the viewport; the inspector becomes a drawer/route below
  `lg` so opening it never destroys workspace width.
- **Touch targets** are ≥44×44px where practical (`MIN_TOUCH_TARGET`), with a
  documented exception list for inline-dense controls (`audit.ts`).
- **Reduced motion** removes nonessential transitions (globals.css +
  `prefs.ui.reducedMotion`).

## Verified

`cohesion.mjs` checks no overflow at 320px and 390px on onboarding and help;
prior sprints verified mobile insights, planning, focus, reading, maintenance,
backup/recovery, and command center. The responsive decision functions are
covered by the `design` self-test (`9.1–9.4`).
