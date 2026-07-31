/**
 * Design tokens (LIFEOS-041, Feature 3).
 *
 * ONE source of truth for the reusable design values LifeOS uses — spacing,
 * radii, borders, typography, control heights, motion, focus rings, content and
 * panel widths, breakpoints, and semantic color/surface roles. Components read
 * these as Tailwind utility classes today; this module makes the *scale*
 * explicit, testable, and emit-able as CSS variables (`tokensToCssVars`) so the
 * scale can never silently drift. No new styling framework — Tailwind stays.
 *
 * Avoid one-off magic numbers where one of these shared tokens fits.
 */

/** Spacing scale (rem). 4px base grid. */
export const SPACE = { 0: 0, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1, 5: 1.25, 6: 1.5, 8: 2, 10: 2.5, 12: 3, 16: 4, 20: 5, 24: 6 } as const;

/** Corner radii (rem). */
export const RADII = { none: 0, sm: 0.375, md: 0.5, lg: 0.75, xl: 1, "2xl": 1, full: 9999 } as const;

/** Border widths (px). */
export const BORDERS = { hairline: 1, strong: 1.5 } as const;

/** Control (button/input) heights (rem) by density. */
export const CONTROL_HEIGHT = { compact: 1.75, comfortable: 2.25, spacious: 2.75 } as const;

/** Minimum touch target (px) — WCAG 2.2 AA target-size baseline. */
export const MIN_TOUCH_TARGET = 44;

/** Motion durations (ms). Short and calm; nothing bounces. */
export const DURATION = { instant: 0, fast: 120, base: 180, slow: 240 } as const;

/** Easing curves. No spring/bounce. */
export const EASING = { standard: "cubic-bezier(0.2, 0, 0, 1)", exit: "cubic-bezier(0.4, 0, 1, 1)" } as const;

/** Focus ring spec — always visible, 2px, offset. */
export const FOCUS_RING = { width: 2, offset: 2, style: "solid" } as const;

/** Content widths (rem) — reading surfaces stay narrow for line length. */
export const CONTENT_WIDTH = { reading: 42, standard: 48, wide: 64, full: 80 } as const;

/** Panel / navigation / inspector widths (rem). */
export const PANEL_WIDTH = { nav: 15, navCollapsed: 3.5, inspector: 22, inspectorWide: 26 } as const;

/** Responsive breakpoints (px). Mirror Tailwind + explicit small sizes. */
export const BREAKPOINTS = { xs: 320, sm: 375, sm2: 390, md: 768, lg: 1024, xl: 1280, "2xl": 1536 } as const;

/** Icon sizes (px). One family, consistent sizing. */
export const ICON_SIZE = { sm: 14, md: 16, lg: 20, xl: 24 } as const;

/**
 * Typography scale: size (rem) / line-height (unitless) / weight, per role.
 * Hierarchy must remain visible without relying on weight alone (size + color
 * + spacing carry it too).
 */
export const TYPE_SCALE = {
  productTitle: { size: 1.125, line: 1.3, weight: 600 },
  routeTitle: { size: 1.5, line: 1.25, weight: 600 },
  sectionTitle: { size: 1, line: 1.35, weight: 600 },
  cardTitle: { size: 0.9375, line: 1.4, weight: 600 },
  body: { size: 0.9375, line: 1.6, weight: 400 },
  compactBody: { size: 0.875, line: 1.5, weight: 400 },
  metadata: { size: 0.8125, line: 1.4, weight: 400 },
  label: { size: 0.6875, line: 1.3, weight: 500 },
  button: { size: 0.8125, line: 1, weight: 500 },
  input: { size: 0.875, line: 1.4, weight: 400 },
  code: { size: 0.8125, line: 1.5, weight: 400 },
  metric: { size: 1.5, line: 1.1, weight: 600 },
} as const;

export type TypeRole = keyof typeof TYPE_SCALE;

/**
 * Smallest metadata size (rem). No text may be smaller than this — Feature 5
 * "no tiny metadata text". `label` (0.6875rem = 11px) is the floor, used only
 * for uppercase eyebrow labels with adequate contrast + letter-spacing.
 */
export const MIN_TEXT_REM = 0.6875;

/** Every token group must be present — a self-test asserts this. */
export const TOKEN_GROUPS = ["SPACE", "RADII", "BORDERS", "CONTROL_HEIGHT", "DURATION", "EASING", "FOCUS_RING", "CONTENT_WIDTH", "PANEL_WIDTH", "BREAKPOINTS", "ICON_SIZE", "TYPE_SCALE"] as const;

/** Emit the tokens as CSS custom properties (for :root in globals.css). */
export function tokensToCssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(SPACE)) out[`--space-${k}`] = `${v}rem`;
  for (const [k, v] of Object.entries(RADII)) out[`--radius-${k}`] = typeof v === "number" && v < 100 ? `${v}rem` : `${v}px`;
  for (const [k, v] of Object.entries(DURATION)) out[`--duration-${k}`] = `${v}ms`;
  for (const [k, v] of Object.entries(CONTENT_WIDTH)) out[`--content-${k}`] = `${v}rem`;
  for (const [k, v] of Object.entries(PANEL_WIDTH)) out[`--panel-${k}`] = `${v}rem`;
  out["--focus-ring-width"] = `${FOCUS_RING.width}px`;
  out["--focus-ring-offset"] = `${FOCUS_RING.offset}px`;
  out["--min-touch-target"] = `${MIN_TOUCH_TARGET}px`;
  for (const [role, s] of Object.entries(TYPE_SCALE)) {
    out[`--text-${role}-size`] = `${s.size}rem`;
    out[`--text-${role}-line`] = `${s.line}`;
    out[`--text-${role}-weight`] = `${s.weight}`;
  }
  return out;
}

/** A CSS string of the token variables, ready to drop into :root { }. */
export function tokensCss(): string {
  const vars = tokensToCssVars();
  return Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n");
}
