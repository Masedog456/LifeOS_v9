/**
 * Version 1 product inventory (LIFEOS-042, Feature 2).
 *
 * A machine-readable catalogue of what ships in Version 1: user-facing systems,
 * data domains, database/migration counts, preference blocks, environment
 * variables (names only — never values), security controls, export/import
 * formats, development-only surfaces, and external services. The route list is
 * sourced from the existing design route inventory; data domains from the export
 * domain list; version numbers from the canonical release versions — so the
 * inventory is checked against reality rather than hand-maintained.
 *
 * The full table list and per-migration detail are emitted by
 * `scripts/release-audit.mjs`, which parses the real SQL; this module is the
 * browser-safe summary the UI and self-test consume.
 */

import { ROUTE_INVENTORY } from "@/lib/design/route-inventory";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import { releaseVersions } from "@/lib/release/versions";

export interface EnvVar {
  name: string;
  scope: "server" | "public";
  required: boolean;
  purpose: string;
}

/** Every environment variable the app reads. Names and purpose only. */
export const ENV_VARS: readonly EnvVar[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", scope: "public", required: false, purpose: "Supabase project URL for optional cloud sync." },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", scope: "public", required: false, purpose: "Supabase anon key (RLS-protected; never the service role)." },
  { name: "NEXT_PUBLIC_APP_VERSION", scope: "public", required: false, purpose: "App version shown in diagnostics/exports (defaults to release version)." },
  { name: "NEXT_PUBLIC_BUILD_ID", scope: "public", required: false, purpose: "Build identifier shown in diagnostics." },
  { name: "LIFEOS_ENABLE_DEV_ROUTES", scope: "server", required: false, purpose: "Opt-in flag that exposes /dev test routes in non-production only." },
  { name: "ANTHROPIC_API_KEY", scope: "server", required: false, purpose: "Optional; unused by the shipped deterministic feature set." },
  { name: "ANTHROPIC_MODEL", scope: "server", required: false, purpose: "Optional model id for legacy AI-assist scaffolding (not in V1 scope)." },
  { name: "EMBEDDING_PROVIDER_URL", scope: "server", required: false, purpose: "Optional semantic-retrieval provider (not in V1 scope)." },
  { name: "EMBEDDING_API_KEY", scope: "server", required: false, purpose: "Optional semantic-retrieval credential (not in V1 scope)." },
  { name: "EMBEDDING_MODEL", scope: "server", required: false, purpose: "Optional embedding model id (not in V1 scope)." },
  { name: "EMBEDDING_DIMENSIONS", scope: "server", required: false, purpose: "Optional embedding dimensionality (not in V1 scope)." },
] as const;

/** The security controls the release depends on, each with where it is enforced. */
export const SECURITY_CONTROLS: readonly { id: string; control: string; enforcedAt: string }[] = [
  { id: "rls", control: "Row Level Security on every user-owned table", enforcedAt: "database (Postgres policies)" },
  { id: "rls-audit", control: "Static RLS audit blocks shipping a table without policies", enforcedAt: "scripts/audit-rls.mjs" },
  { id: "csp", control: "Content-Security-Policy (no unsafe-eval)", enforcedAt: "middleware + lib/security/headers" },
  { id: "headers", control: "HSTS, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, frame protection", enforcedAt: "middleware" },
  { id: "dev-gate", control: "/dev routes 404 in production", enforcedAt: "app/dev/layout.tsx" },
  { id: "input-limits", control: "Size limits, JSON depth caps, plain-text-first input", enforcedAt: "lib/security/input-limits" },
  { id: "safe-url", control: "Protocol-allowlisted external links", enforcedAt: "lib/security/safe-url" },
  { id: "redaction", control: "Sanitized errors & diagnostics (no record contents/secrets)", enforcedAt: "lib/security/redaction + diagnostics" },
  { id: "secret-scan", control: "Committed-secret & client-bundle key-leak scan", enforcedAt: "scripts/scan-secrets.mjs" },
  { id: "no-service-role", control: "Service-role key never present in client bundle", enforcedAt: "scripts/scan-secrets.mjs" },
] as const;

/** Preference blocks stored in the existing user_prefs architecture (no new table). */
export const PREFERENCE_BLOCKS: readonly string[] = [
  "onboarding", "onboardingV2", "education", "ui", "recent", "pinned",
  "workspace", "execution", "insights",
];

/** Export / import formats the release supports. */
export const DATA_FORMATS: readonly { id: string; direction: string; notes: string }[] = [
  { id: "account-archive-json", direction: "export+import", notes: "Deterministic JSON archive with manifest + per-collection checksums." },
  { id: "account-archive-ndjson", direction: "export", notes: "Streaming NDJSON variant for large accounts." },
  { id: "insights-csv", direction: "export", notes: "Per-view CSV that reconciles with the JSON figures." },
] as const;

/** External services the product can talk to (all optional). */
export const EXTERNAL_SERVICES: readonly { id: string; required: boolean; purpose: string }[] = [
  { id: "supabase", required: false, purpose: "Optional cloud sync/persistence; the app is fully usable local-only." },
] as const;

export interface ProductInventory {
  release: ReturnType<typeof releaseVersions>;
  routeCount: number;
  productionRoutes: string[];
  dataDomainCount: number;
  dataDomains: readonly string[];
  migrationCount: number;
  tableCountNote: string;
  preferenceBlocks: readonly string[];
  envVars: readonly EnvVar[];
  securityControls: readonly { id: string; control: string; enforcedAt: string }[];
  dataFormats: readonly { id: string; direction: string; notes: string }[];
  externalServices: readonly { id: string; required: boolean; purpose: string }[];
  devSurfaces: string[];
}

/** The list of production route paths (excludes the pseudo "inspector" surface). */
export function productionRoutes(): string[] {
  return ROUTE_INVENTORY.map((r) => r.route).filter((r) => r.startsWith("/"));
}

/** Build the complete, resolved inventory. */
export function buildInventory(devSurfaces: string[] = []): ProductInventory {
  return {
    release: releaseVersions(),
    routeCount: productionRoutes().length,
    productionRoutes: productionRoutes(),
    dataDomainCount: EXPORT_DOMAINS.length,
    dataDomains: EXPORT_DOMAINS,
    migrationCount: releaseVersions().migrationCount,
    tableCountNote: "54 tables, all user-owned and RLS-protected (authoritative source: scripts/audit-rls.mjs).",
    preferenceBlocks: PREFERENCE_BLOCKS,
    envVars: ENV_VARS,
    securityControls: SECURITY_CONTROLS,
    dataFormats: DATA_FORMATS,
    externalServices: EXTERNAL_SERVICES,
    devSurfaces,
  };
}

export interface InventoryReport {
  ok: boolean;
  problems: string[];
}

/** Sanity-check the inventory is internally complete. */
export function validateInventory(inv: ProductInventory): InventoryReport {
  const problems: string[] = [];
  if (inv.routeCount < 20) problems.push(`unexpectedly few production routes: ${inv.routeCount}`);
  if (inv.dataDomainCount !== EXPORT_DOMAINS.length) problems.push("data domain count drifted from export domains");
  if (inv.migrationCount !== releaseVersions().migrationCount) problems.push("migration count drifted from release versions");
  if (!inv.envVars.some((e) => e.name === "LIFEOS_ENABLE_DEV_ROUTES")) problems.push("dev-route flag missing from env inventory");
  if (inv.securityControls.length < 8) problems.push("security control inventory looks incomplete");
  for (const e of inv.envVars) {
    // No env var may carry the service-role key.
    if (/service.?role/i.test(e.name)) problems.push(`service-role key must never be an inventoried env var: ${e.name}`);
  }
  return { ok: problems.length === 0, problems };
}
