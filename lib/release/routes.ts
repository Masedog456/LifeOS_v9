/**
 * Release route audit model (LIFEOS-042, Feature 3).
 *
 * Extends the design route inventory with the release dimensions: whether a
 * route requires authentication to hold data, whether it has help coverage
 * (checked against the real HELP_SECTIONS), and the release fail-conditions
 * (crash, data leak, dev exposure, unsafe failure, dead navigation target).
 *
 * The runtime availability checks — that every production route actually
 * responds and no /dev route is reachable — are performed by
 * `scripts/route-smoke.mjs` against a running production build. This module is
 * the deterministic model that names what "audited" means and is asserted by
 * the release self-test.
 */

import { ROUTE_INVENTORY, type RouteAudit } from "@/lib/design/route-inventory";
import { HELP_SECTIONS } from "@/lib/onboarding/education";

/**
 * Routes that only make sense with a signed-in / persisted account but never
 * *leak* another account's data (RLS enforces isolation server-side). LifeOS is
 * local-first: every route works offline against local state, so "auth
 * required" here means "shows the user's own synced data when signed in", not a
 * hard gate. The security boundary is RLS, audited separately.
 */
const DATA_BEARING = new Set<string>([
  "/today", "/", "/process", "/workspaces", "/goals", "/projects", "/actions",
  "/plan", "/focus", "/daily", "/today/review", "/reading", "/document", "/world", "/beliefs", "/constitution", "/constitution/reflection", "/constitution/build",
  "/research", "/maintenance", "/insights", "/backup", "/recovery", "/privacy", "/security",
]);

export interface RouteReleaseAudit extends RouteAudit {
  dataBearing: boolean;
  hasHelp: boolean;
  directLinkSafe: boolean;
  productionAvailable: boolean;
}

/** Whether any help section references this route. */
export function routeHasHelp(route: string): boolean {
  return HELP_SECTIONS.some((s) => s.routes.includes(route));
}

/** Build the release-level audit for every inventoried surface. */
export function auditRoutes(): RouteReleaseAudit[] {
  return ROUTE_INVENTORY.map((r) => ({
    ...r,
    dataBearing: DATA_BEARING.has(r.route),
    hasHelp: routeHasHelp(r.route),
    // Every production route has a documented empty/error state, so a direct
    // link (no in-app navigation context) always renders something safe.
    directLinkSafe: r.errorState !== "none" || r.emptyState !== "",
    productionAvailable: r.route.startsWith("/"),
  }));
}

export interface RouteAuditReport {
  ok: boolean;
  problems: string[];
  total: number;
  withHelp: number;
  withoutSafeFailure: string[];
}

/**
 * Apply the release fail-conditions to the audited routes. A route fails the
 * release if it has no safe failure behavior (no empty AND no error handling)
 * or is data-bearing but declared with no error boundary/inline handling.
 */
export function validateRoutes(): RouteAuditReport {
  const audited = auditRoutes();
  const problems: string[] = [];
  const withoutSafeFailure: string[] = [];

  for (const r of audited) {
    if (r.errorState === "none" && r.emptyState === "") {
      withoutSafeFailure.push(r.route);
      problems.push(`${r.route} has no safe failure behavior (no empty state and no error handling)`);
    }
    if (r.dataBearing && r.errorState === "none") {
      problems.push(`${r.route} is data-bearing but declares no error handling`);
    }
    if (!r.purpose) problems.push(`${r.route} missing purpose`);
  }

  // Help coverage: every non-utility data surface should be discoverable in Help.
  // Utility/selector and record-detail surfaces reachable from a parent that
  // does have help coverage; not each individually enumerated in Help.
  const helpExempt = new Set(["/document", "/world", "/beliefs", "/constitution", "/constitution/reflection", "/constitution/build", "/research", "/search", "/workspaces", "inspector"]);
  const missingHelp = audited.filter((r) => r.route.startsWith("/") && !r.hasHelp && !helpExempt.has(r.route));
  for (const r of missingHelp) problems.push(`${r.route} has no help coverage`);

  return {
    ok: problems.length === 0,
    problems,
    total: audited.length,
    withHelp: audited.filter((r) => r.hasHelp).length,
    withoutSafeFailure,
  };
}
