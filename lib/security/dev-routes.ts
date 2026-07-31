/**
 * Development-surface lockdown (LIFEOS-040, Feature 29).
 *
 * LifeOS ships internal self-test pages under /dev/*. These must never be part
 * of a production route manifest. This module declares the prohibited prefixes
 * and provides a pure classifier + manifest auditor. The companion self-test /
 * script asserts a production build's route list contains none of them (the app
 * layout also guards /dev at runtime when NODE_ENV==='production').
 */

/** Route prefixes that must be excluded from (or gated out of) production. */
export const DEV_ONLY_PREFIXES = ["/dev/", "/dev"] as const;

/** Individual routes that are diagnostics-internal and must be auth-gated. */
export const GATED_ROUTES = ["/security", "/privacy", "/backup", "/recovery"] as const;

/** True if a route path is a development-only surface. */
export function isDevRoute(path: string): boolean {
  const p = path.trim();
  return p === "/dev" || p.startsWith("/dev/");
}

/** True when development surfaces are allowed (never in production). */
export function devSurfacesAllowed(env?: string): boolean {
  const e = env ?? (typeof process !== "undefined" ? process.env.NODE_ENV : undefined);
  return e !== "production";
}

export interface RouteAudit {
  ok: boolean;
  offending: string[];
}

/**
 * Audit a route manifest (array of route paths). In production, ANY /dev route
 * is a failure. Returns the offenders so the script can print them.
 */
export function auditRouteManifest(routes: string[], env = "production"): RouteAudit {
  if (devSurfacesAllowed(env)) return { ok: true, offending: [] };
  const offending = routes.filter(isDevRoute);
  return { ok: offending.length === 0, offending };
}
