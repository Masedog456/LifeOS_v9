/**
 * Production health checks (LIFEOS-040, Feature 31).
 *
 * Lightweight, PUBLIC-safe availability checks. Health responses must never
 * expose secrets, table names, SQL, or user data — only a component name and a
 * coarse status. We separate the PUBLIC liveness surface (is the shell +
 * auth provider + static assets reachable) from AUTHENTICATED diagnostics (the
 * Diagnostics Center), which requires a session.
 */

export type HealthStatus = "ok" | "degraded" | "down" | "unknown";

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  /** Non-sensitive one-liner. Never a stack, SQL, or identifier. */
  note?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheck[];
  at: string;
}

/** The PUBLIC checks safe to expose without a session. */
export const PUBLIC_CHECK_NAMES = ["app-shell", "auth-provider", "static-assets"] as const;

/** Roll a set of checks into an overall status (worst wins). */
export function rollUp(checks: HealthCheck[]): HealthStatus {
  const order: HealthStatus[] = ["ok", "degraded", "down"];
  let worst: HealthStatus = "ok";
  for (const c of checks) {
    if (c.status === "unknown") continue;
    if (order.indexOf(c.status) > order.indexOf(worst)) worst = c.status;
  }
  return worst;
}

export interface HealthInputs {
  shellReachable: boolean;
  authProviderReachable: boolean | null; // null when local-only
  staticAssetsReachable: boolean;
  databaseReachable?: boolean | null;    // authenticated only
  schemaCompatible?: boolean | null;     // authenticated only
  serviceWorkerCompatible?: boolean | null;
  now?: string;
}

/** Build the PUBLIC health report (no user data, no table names). */
export function publicHealth(inputs: HealthInputs): HealthReport {
  const checks: HealthCheck[] = [
    { name: "app-shell", status: inputs.shellReachable ? "ok" : "down" },
    { name: "auth-provider", status: inputs.authProviderReachable == null ? "unknown" : inputs.authProviderReachable ? "ok" : "degraded", note: inputs.authProviderReachable == null ? "local-only mode" : undefined },
    { name: "static-assets", status: inputs.staticAssetsReachable ? "ok" : "degraded" },
  ];
  return { status: rollUp(checks), checks, at: inputs.now ?? new Date().toISOString() };
}

/** Build the AUTHENTICATED health report (still no secrets/table names). */
export function authenticatedHealth(inputs: HealthInputs): HealthReport {
  const base = publicHealth(inputs).checks;
  const checks: HealthCheck[] = [
    ...base,
    { name: "database", status: inputs.databaseReachable == null ? "unknown" : inputs.databaseReachable ? "ok" : "down" },
    { name: "schema", status: inputs.schemaCompatible == null ? "unknown" : inputs.schemaCompatible ? "ok" : "degraded", note: inputs.schemaCompatible === false ? "read-only mode" : undefined },
    { name: "service-worker", status: inputs.serviceWorkerCompatible == null ? "unknown" : inputs.serviceWorkerCompatible ? "ok" : "degraded" },
  ];
  return { status: rollUp(checks), checks, at: inputs.now ?? new Date().toISOString() };
}
