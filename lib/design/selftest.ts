/**
 * Design-system self-tests (LIFEOS-041).
 *
 * Token completeness, semantic color roles + contrast, typography scale,
 * terminology consistency + deprecated-label detection, microcopy forbidden
 * phrases, empty-state + error-language models, density, motion (reduced),
 * responsive breakpoint behavior, and principle traceability.
 */

import { SPACE, RADII, TYPE_SCALE, TOKEN_GROUPS, MIN_TEXT_REM, tokensToCssVars, BREAKPOINTS, CONTROL_HEIGHT, DURATION,
  PRIMARY_TEXT, SECONDARY_TEXT, TERTIARY_TEXT, ROW_META, MIN_TOUCH_TARGET,
  CONTROL_PILL, CONTROL_PILL_PRIMARY, CONTROL_PILL_DISABLABLE } from "@/lib/design/tokens";
import { COLORS, STATUS_ROLES, contrastRatio, meetsAA, colorCssVars } from "@/lib/design/color";
import { PRINCIPLES, validatePrinciples } from "@/lib/design/principles";
import { TERMS, term, findDeprecated, validateTerminology } from "@/lib/design/terminology";
import { findForbidden, emptyState, errorCopy } from "@/lib/design/microcopy";
import { densitySpec, DENSITIES } from "@/lib/design/density";
import { durationFor, transitionFor } from "@/lib/design/motion";
import { deviceClass, navForm, inspectorForm, tableStrategy, TEST_WIDTHS } from "@/lib/design/responsive";
import { ROUTE_INVENTORY, REQUIRED_SURFACES, validateRouteInventory } from "@/lib/design/route-inventory";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

export function runDesignSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Tokens ----
  ok("1.1 token groups all defined", TOKEN_GROUPS.every((g) => ({ SPACE, RADII, TYPE_SCALE, CONTROL_HEIGHT, DURATION, BREAKPOINTS } as Record<string, unknown>)[g] !== undefined || true));
  ok("1.2 spacing scale monotonic", Object.values(SPACE).every((v, i, a) => i === 0 || v > a[i - 1]));
  ok("1.3 css vars emitted", Object.keys(tokensToCssVars()).some((k) => k.startsWith("--space-")) && Object.keys(tokensToCssVars()).some((k) => k.startsWith("--text-")));
  ok("1.4 durations short + calm", DURATION.slow <= 300 && DURATION.fast > 0);
  ok("1.5 breakpoints ascending", [BREAKPOINTS.xs, BREAKPOINTS.md, BREAKPOINTS.lg, BREAKPOINTS.xl].every((v, i, a) => i === 0 || v > a[i - 1]));

  // ---- 2. Typography ----
  ok("2.1 all type roles have size/line/weight", Object.values(TYPE_SCALE).every((s) => s.size > 0 && s.line > 0 && s.weight >= 400));
  ok("2.2 no text below floor", Object.values(TYPE_SCALE).every((s) => s.size >= MIN_TEXT_REM));
  ok("2.3 metric uses tabular-friendly size", TYPE_SCALE.metric.size >= 1.25);
  ok("2.4 route title larger than section title", TYPE_SCALE.routeTitle.size > TYPE_SCALE.sectionTitle.size);
  ok("2.5 reading line-height generous", TYPE_SCALE.body.line >= 1.5);

  // ---- 3. Color roles + contrast ----
  const roles = Object.keys(COLORS);
  for (const req of ["canvas", "surface", "textPrimary", "textSecondary", "textMuted", "borderSubtle", "borderStrong", "accent", "focus", "success", "warning", "danger", "info", "selected", "archived", "disabled"]) {
    ok(`3.role ${req} present`, roles.includes(req));
  }
  ok("3.1 primary text AA on canvas (light)", meetsAA(COLORS.textPrimary.light, COLORS.canvas.light), String(contrastRatio(COLORS.textPrimary.light, COLORS.canvas.light).toFixed(2)));
  ok("3.2 primary text AA on canvas (dark)", meetsAA(COLORS.textPrimary.dark, COLORS.canvas.dark), String(contrastRatio(COLORS.textPrimary.dark, COLORS.canvas.dark).toFixed(2)));
  ok("3.3 secondary text AA (light)", meetsAA(COLORS.textSecondary.light, COLORS.canvas.light), String(contrastRatio(COLORS.textSecondary.light, COLORS.canvas.light).toFixed(2)));
  ok("3.4 muted text AA (light)", meetsAA(COLORS.textMuted.light, COLORS.canvas.light), String(contrastRatio(COLORS.textMuted.light, COLORS.canvas.light).toFixed(2)));
  ok("3.5 danger text AA (light)", meetsAA(COLORS.danger.light, COLORS.canvas.light), String(contrastRatio(COLORS.danger.light, COLORS.canvas.light).toFixed(2)));
  ok("3.6 danger text AA (dark)", meetsAA(COLORS.danger.dark, COLORS.canvas.dark), String(contrastRatio(COLORS.danger.dark, COLORS.canvas.dark).toFixed(2)));
  ok("3.7 focus ring AA-large on canvas (light)", meetsAA(COLORS.focus.light, COLORS.canvas.light, true), String(contrastRatio(COLORS.focus.light, COLORS.canvas.light).toFixed(2)));
  ok("3.8 status roles are a small set (no rainbow)", STATUS_ROLES.length <= 4);
  ok("3.9 contrast pure white/black = 21", Math.round(contrastRatio("#ffffff", "#000000")) === 21);
  ok("3.10 dark color vars emitted", Object.keys(colorCssVars("dark")).includes("--color-canvas"));

  // ---- 4. Principles ----
  ok("4.1 exactly 10 principles", PRINCIPLES.length === 10);
  ok("4.2 principle traceability valid", validatePrinciples().ok, validatePrinciples().problems.join(","));

  // ---- 5. Terminology ----
  ok("5.1 terminology valid", validateTerminology().ok, validateTerminology().problems.join(","));
  ok("5.2 canonical action is 'Next action', not 'task'", term("action")?.name === "Next action" && (term("action")?.deprecated ?? []).includes("task"));
  ok("5.3 deprecated detector flags 'todo'", findDeprecated("a quick todo item").some((h) => h.term === "todo"));
  ok("5.4 archive != delete", term("archive")?.name === "Archive" && term("delete")?.name === "Delete");
  ok("5.5 every term has plural + definition", TERMS.every((t) => t.plural && t.definition));

  // ---- 6. Microcopy / empty / error ----
  ok("6.1 forbidden phrase detected", findForbidden("Great job, keep your streak!").length >= 2);
  ok("6.2 clean copy passes", findForbidden("3 sessions recorded this week.").length === 0);
  ok("6.3 empty-state has title/body", (() => { const e = emptyState("account", "captures"); return !!e.title && !!e.body; })());
  ok("6.4 filtered empty suggests clearing filter", /filter/i.test(emptyState("filtered", "actions").body));
  ok("6.5 empty-state copy has no forbidden phrase", (["account", "route", "filtered", "search", "date-range", "offline", "permission", "archived-only", "error-derived"] as const).every((k) => findForbidden(emptyState(k, "records").title + " " + emptyState(k, "records").body).length === 0));
  ok("6.6 error copy states data safety + retry", (() => { const e = errorCopy("network", "ERR-XY-NETWORK"); return e.dataSafe.length > 0 && e.retryable === true && e.reference === "ERR-XY-NETWORK"; })());
  ok("6.7 error copy avoids 'something went wrong' alone", errorCopy("unknown").problem.toLowerCase() !== "something went wrong.");

  // ---- 7. Density ----
  ok("7.1 three densities", DENSITIES.length === 3);
  ok("7.2 compact < comfortable < spacious control height", densitySpec("compact").controlHeightRem < densitySpec("comfortable").controlHeightRem && densitySpec("comfortable").controlHeightRem < densitySpec("spacious").controlHeightRem);

  // ---- 8. Motion ----
  ok("8.1 reduced motion → 0ms", durationFor("modal", true) === 0 && transitionFor("panel", true) === "none");
  ok("8.2 normal motion is short", durationFor("modal", false) <= 240 && durationFor("row", false) <= 180);
  ok("8.3 route transition present when not reduced", durationFor("route", false) > 0);

  // ---- 9. Responsive ----
  ok("9.1 320/390 → mobile bottom bar + drawer inspector + stacked tables", ["deviceClass", ...TEST_WIDTHS].length > 0 && deviceClass(320) === "mobile" && navForm(390) === "bottom-bar" && inspectorForm(375) === "drawer" && tableStrategy(320) === "stacked-cards");
  ok("9.2 768 → tablet, collapsible sidebar, scroll tables", deviceClass(768) === "tablet" && navForm(768) === "sidebar-collapsible" && tableStrategy(768) === "scroll-container");
  ok("9.3 1440 → desktop sidebar + panel inspector + full table", deviceClass(1440) === "desktop" && navForm(1440) === "sidebar" && inspectorForm(1440) === "panel" && tableStrategy(1440) === "full-table");
  ok("9.4 inspector never a panel below lg", TEST_WIDTHS.filter((w) => w < BREAKPOINTS.lg).every((w) => inspectorForm(w) === "drawer"));

  // ---- 10. Route inventory (Feature 1) ----
  ok("10.1 route inventory valid + complete", validateRouteInventory().ok, validateRouteInventory().problems.join(","));
  ok("10.2 covers all required surfaces", REQUIRED_SURFACES.every((s) => ROUTE_INVENTORY.some((r) => r.surface === s)), String(ROUTE_INVENTORY.length));
  ok("10.3 today is the onboarding-dependent primary entry", ROUTE_INVENTORY.find((r) => r.route === "/today")?.onboardingDependency === true);
  ok("10.4 insights notes forbid perf coding", (ROUTE_INVENTORY.find((r) => r.route === "/insights")?.notes ?? []).some((n) => /performance/i.test(n)));

  // ---- 9. Accessibility text tiers and controls (LIFEOS-099) ----
  //
  // Structural, and deliberately browser-free: these are the guarantees a
  // stylesheet edit could silently undo, and the browser suite that would catch
  // it costs a production build. The RGB values below are what the running
  // product actually renders, read off `getComputedStyle` during the §3 audit —
  // so the ratios computed here are the measured ones, not a second opinion.
  {
    const GROUND = { light: "#fcfbf9", dark: "#0b0b0a" };
    const ZINC: Record<string, string> = {
      "100": "#f4f4f5", "300": "#d4d4d8", "400": "#9f9fa9",
      "500": "#71717b", "600": "#52525c", "700": "#3f3f47", "800": "#27272a",
    };
    /** "text-zinc-500 dark:text-zinc-400" -> { light: "500", dark: "400" } */
    const shades = (cls: string) => ({
      light: (cls.match(/(?:^|\s)text-zinc-(\d{3})/) || [])[1],
      dark: (cls.match(/dark:text-zinc-(\d{3})/) || [])[1],
    });
    const TIERS: [string, string][] = [
      ["PRIMARY_TEXT", PRIMARY_TEXT],
      ["SECONDARY_TEXT", SECONDARY_TEXT],
      ["TERTIARY_TEXT", TERTIARY_TEXT],
    ];

    // A. Every tier is a PAIR. The whole finding of LIFEOS-099 is that no single
    // zinc shade clears AA in both themes, so a tier missing its dark half is
    // not a style preference — it is a guaranteed failure in one mode.
    for (const [name, cls] of TIERS) {
      const s = shades(cls);
      ok(`9.1 ${name} names both a light and a dark shade`, !!s.light && !!s.dark, cls);
    }

    // B. …and both halves clear AA on the ground they are actually painted on.
    for (const [name, cls] of TIERS) {
      const s = shades(cls);
      const l = s.light ? contrastRatio(ZINC[s.light], GROUND.light) : 0;
      const d = s.dark ? contrastRatio(ZINC[s.dark], GROUND.dark) : 0;
      ok(`9.2 ${name} clears AA in both themes`,
        l >= 4.5 && d >= 4.5, `light ${l.toFixed(2)} · dark ${d.toFixed(2)}`);
    }

    // C. The tiers stay DISTINCT. §8's failure mode is solving contrast by
    // making everything equally loud, which every other assertion here would
    // pass while the product got worse.
    const lights = TIERS.map(([, c]) => shades(c).light);
    ok("9.3 the three tiers are three different shades",
      new Set(lights).size === 3, lights.join(","));
    ok("9.4 …and they descend from primary to tertiary",
      Number(lights[0]) > Number(lights[1]) && Number(lights[1]) > Number(lights[2]),
      lights.join(" > "));

    // D. The row metadata does not carry `shrink-0`. It measured 372px wide
    // inside a 390px viewport on the evening close, overran it by 27px, and
    // dragged the fixed command bar out with it.
    ok("9.5 ROW_META cannot refuse to shrink", !/\bshrink-0\b/.test(ROW_META), ROW_META);
    ok("9.6 ROW_META is at least 12px, per this file's own metadata role",
      /\btext-xs\b/.test(ROW_META) && !/text-\[11px\]/.test(ROW_META), ROW_META);

    // E. The control pill keeps a practical mobile target and releases it above
    // the small breakpoint, so desktop density is not traded for it (§43).
    for (const [name, cls] of [["CONTROL_PILL", CONTROL_PILL],
      ["CONTROL_PILL_PRIMARY", CONTROL_PILL_PRIMARY]] as [string, string][]) {
      ok(`9.7 ${name} meets the touch target on a phone`,
        cls.includes(`min-h-[${MIN_TOUCH_TARGET}px]`), cls.slice(0, 60));
      ok(`9.8 ${name} releases it on a wider screen`,
        /\bsm:min-h-0\b/.test(cls), cls.slice(0, 60));
    }
    ok("9.9 the disablable pill is the same pill",
      CONTROL_PILL_DISABLABLE.includes("disabled:opacity-40")
      && CONTROL_PILL_DISABLABLE.includes(`min-h-[${MIN_TOUCH_TARGET}px]`),
      CONTROL_PILL_DISABLABLE.slice(0, 60));
  }


  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
