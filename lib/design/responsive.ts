/**
 * Responsive system (LIFEOS-041, Feature 28).
 *
 * The breakpoints LifeOS commits to testing (320/375/390/768/1024/1280/1440+)
 * and the layout DECISIONS at each: navigation form, inspector form, and table
 * strategy. Pure helpers so the E2E + a self-test can assert the intended
 * behavior deterministically.
 */
import { BREAKPOINTS } from "@/lib/design/tokens";

export const TEST_WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440] as const;

export type NavForm = "bottom-bar" | "sidebar" | "sidebar-collapsible";
export type InspectorForm = "drawer" | "panel";
export type TableStrategy = "stacked-cards" | "scroll-container" | "full-table";

/** Below md → mobile; md..lg → tablet; ≥ lg → desktop. */
export function deviceClass(width: number): "mobile" | "tablet" | "desktop" {
  if (width < BREAKPOINTS.md) return "mobile";
  if (width < BREAKPOINTS.lg) return "tablet";
  return "desktop";
}

/** Mobile uses a compact bottom bar (never the whole desktop sidebar). */
export function navForm(width: number): NavForm {
  if (width < BREAKPOINTS.md) return "bottom-bar";
  if (width < BREAKPOINTS.xl) return "sidebar-collapsible";
  return "sidebar";
}

/** Inspector becomes a drawer/route below lg so it never crushes workspace width. */
export function inspectorForm(width: number): InspectorForm {
  return width < BREAKPOINTS.lg ? "drawer" : "panel";
}

/** Tables stack into cards on phones, scroll on tablets, render fully on desktop. */
export function tableStrategy(width: number): TableStrategy {
  if (width < BREAKPOINTS.md) return "stacked-cards";
  if (width < BREAKPOINTS.lg) return "scroll-container";
  return "full-table";
}
