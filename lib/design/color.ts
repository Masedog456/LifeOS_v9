/**
 * Semantic color model (LIFEOS-041, Feature 4).
 *
 * A restrained, role-based palette — NOT a rainbow taxonomy for record types.
 * Colors carry MEANING (danger, success, selected…) never decoration, and no
 * meaning is conveyed by color alone (a self-test + the components pair every
 * status color with a text/icon label). Saturation is deliberately low. Light
 * and dark are both defined because the app already supports both cleanly via
 * `prefers-color-scheme`. Contrast is checked by `contrastRatio` against WCAG.
 */

export type ColorRole =
  | "canvas" | "surface" | "surfaceRaised" | "surfaceSunken"
  | "textPrimary" | "textSecondary" | "textMuted"
  | "borderSubtle" | "borderStrong"
  | "accent" | "focus"
  | "success" | "warning" | "danger" | "info"
  | "selected" | "archived" | "disabled";

export interface ColorPair { light: string; dark: string }

/** Hex values per role, per mode. Muted, serious, low-saturation. */
export const COLORS: Record<ColorRole, ColorPair> = {
  canvas: { light: "#ffffff", dark: "#0a0a0a" },
  surface: { light: "#ffffff", dark: "#111111" },
  surfaceRaised: { light: "#fafafa", dark: "#1a1a1a" },
  surfaceSunken: { light: "#f4f4f5", dark: "#161616" },
  textPrimary: { light: "#18181b", dark: "#f4f4f5" },
  textSecondary: { light: "#52525b", dark: "#a1a1aa" },
  textMuted: { light: "#71717a", dark: "#8b8b93" },
  borderSubtle: { light: "#e4e4e7", dark: "#27272a" },
  borderStrong: { light: "#d4d4d8", dark: "#3f3f46" },
  accent: { light: "#3f3f46", dark: "#e4e4e7" }, // near-neutral, not a bright brand hue
  focus: { light: "#2563eb", dark: "#60a5fa" },
  success: { light: "#15803d", dark: "#4ade80" },
  warning: { light: "#b45309", dark: "#fbbf24" },
  danger: { light: "#b91c1c", dark: "#f87171" },
  info: { light: "#1d4ed8", dark: "#93c5fd" },
  selected: { light: "#eef2ff", dark: "#1e293b" },
  archived: { light: "#a1a1aa", dark: "#71717a" },
  disabled: { light: "#d4d4d8", dark: "#3f3f46" },
};

/** Every status color must be paired with a non-color cue in the UI. */
export const STATUS_ROLES: ColorRole[] = ["success", "warning", "danger", "info"];

/** Parse a #rrggbb into linearized RGB for luminance. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return 0;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relLuminance(a), lb = relLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2: normal text ≥ 4.5, large text/UI ≥ 3.0. */
export function meetsAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? 3 : 4.5);
}

export function color(role: ColorRole, mode: "light" | "dark" = "light"): string {
  return COLORS[role][mode];
}

/** Emit semantic colors as CSS variables for a given mode. */
export function colorCssVars(mode: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, pair] of Object.entries(COLORS)) out[`--color-${role}`] = pair[mode];
  return out;
}
