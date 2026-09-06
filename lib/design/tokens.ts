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

// ------------------------------------------------- text roles as classes ---

/**
 * The three text tiers of the primary loop, as Tailwind classes (LIFEOS-099).
 *
 * ## Why classes and not just the scale above
 *
 * `TYPE_SCALE` describes the sizes. It says nothing about COLOUR, and colour is
 * where this product's readability actually failed: the audit measured no zinc
 * shade that passes WCAG AA in both themes on our grounds.
 *
 *   shade        light           dark
 *   zinc-300     1.43  fail      13.32 pass
 *   zinc-400     2.54  fail       7.51 pass
 *   zinc-500     4.67  pass       4.08 fail
 *   zinc-600     7.46  pass       2.55 fail
 *   zinc-700    10.09  pass       1.89 fail
 *
 * So a single token cannot be correct, and the obvious fix is a trap: moving
 * metadata from `zinc-400` to `zinc-600` takes light from 2.54 to 7.46 and dark
 * from 7.51 to 2.55. Every tier below is therefore a PAIR, and each half was
 * measured on the real page ground rather than chosen by eye.
 *
 * The product already knew this. `linkClass` beside the failing declarations
 * pairs `text-zinc-800 dark:text-zinc-100` and passes in both modes; the
 * metadata constant next to it did not, and had drifted into two values across
 * five files.
 *
 * ## Why they live here
 *
 * `metaClass` was declared five times — twice as `text-zinc-500`, three times as
 * `text-zinc-400` — which is the same duplication LIFEOS-098 removed one layer
 * up, in words instead of styles. This is a small shared constant, not a
 * typography system (§41, §42): three strings, no component, no variants API.
 */

/** PRIMARY — a record's own title or question. 14.4:1 light, 15.9:1 dark. */
export const PRIMARY_TEXT = "text-zinc-800 dark:text-zinc-100";

/** SECONDARY — state, section labels, a fact about the record. 7.46 / 13.32. */
export const SECONDARY_TEXT = "text-zinc-600 dark:text-zinc-300";

/**
 * TERTIARY — dates, provenance, explanatory detail. 4.67 light, 7.51 dark.
 *
 * The lightest pair that clears AA in both directions. Anything fainter fails
 * one mode or the other, which is why the tier stops here rather than
 * continuing the scale.
 */
export const TERTIARY_TEXT = "text-zinc-500 dark:text-zinc-400";

/**
 * The metadata chip at the end of a commitment row.
 *
 * `text-xs` (12px), not the `text-[11px]` the five copies used: `TYPE_SCALE`
 * above already reserves 0.6875rem for uppercase eyebrow labels and puts
 * ordinary metadata at 0.8125rem, so the components had drifted from this
 * file's own scale as well as from each other.
 *
 * `min-w-0` rather than `shrink-0`, and that is a bug fix rather than a
 * preference. With `shrink-0` a metadata span holding a long name refuses to
 * shrink: the audit measured "Waiting on Dr. Maria Consuelo Fernández-Villanueva"
 * rendering 372px wide inside a 390px viewport, overrunning it by 27px and
 * dragging the fixed command bar out with it. Allowing the chip to shrink lets
 * a long fact wrap onto a second line, which costs a row some height and loses
 * nothing — §19 forbids truncating the only copy of a waiting person.
 */
export const ROW_META = `min-w-0 text-right text-xs ${TERTIARY_TEXT}`;

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
