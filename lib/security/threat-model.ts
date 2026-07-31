/**
 * Threat model (LIFEOS-040, Feature 1).
 *
 * A structured, machine-readable enumeration of the threats LifeOS reasons
 * about. It is deliberately honest: `remainingRisk` and `validation` are filled
 * in truthfully, and there are NO fictional guarantees. THREAT_MODEL.md is
 * generated from this data so the prose and the code never drift. A self-test
 * asserts every threat has a protection, a validation method, and an owner.
 */

export type Likelihood = "low" | "medium" | "high";
export type Impact = "low" | "medium" | "high" | "critical";

export interface Threat {
  id: string;
  title: string;
  surface: string;
  impact: Impact;
  likelihood: Likelihood;
  currentProtection: string;
  remainingRisk: string;
  validation: string;
  owner: string; // module or doc that owns the mitigation
}

export const THREATS: readonly Threat[] = [
  { id: "T01", title: "Unauthorized account access", surface: "auth", impact: "critical", likelihood: "medium",
    currentProtection: "Supabase email/OTP auth; no anonymous remote sync; RLS ties every row to auth.uid().", remainingRisk: "Account is only as safe as the user's email inbox; no app-level MFA yet.", validation: "auth E2E (expired/revoked session), RLS isolation tests.", owner: "lib/security/auth-boundaries.ts" },
  { id: "T02", title: "Cross-user data exposure", surface: "database", impact: "critical", likelihood: "medium",
    currentProtection: "Row Level Security on every user-owned table (4 policies), enforced by Postgres not the app.", remainingRisk: "A missing policy on a future table; mitigated by the RLS audit that fails CI.", validation: "authorization-audit + non-superuser RLS isolation + ownership-boundary tests.", owner: "lib/security/authorization-audit.ts" },
  { id: "T03", title: "Compromised session token", surface: "auth", impact: "high", likelihood: "low",
    currentProtection: "Supabase-managed tokens, autoRefresh; sign-out clears protected UI; tabs coordinate sign-out.", remainingRisk: "A stolen refresh token is valid until expiry/rotation; no device binding.", validation: "sign-out clears UI E2E, cross-tab sign-out E2E.", owner: "lib/authStore.ts" },
  { id: "T04", title: "Malicious record input", surface: "editors", impact: "medium", likelihood: "high",
    currentProtection: "React escapes by default; the single HTML sink is escape-first + URL-allowlisted; input limits reject oversized/deep data.", remainingRisk: "New rich-text surfaces could reintroduce a sink; mitigated by the plain-text-first policy.", validation: "input-limits + safe-url self-tests, stored-XSS E2E.", owner: "lib/security/input-limits.ts" },
  { id: "T05", title: "Stored / reflected XSS", surface: "reader annotations", impact: "high", likelihood: "medium",
    currentProtection: "renderMarkdownInline escapes &<>\"' first, then whitelists only http(s) links via safeHref.", remainingRisk: "Any future dangerouslySetInnerHTML must route through the same policy.", validation: "annotation render self-test with attribute-injection payload; stored-XSS E2E.", owner: "lib/library/annotations.ts" },
  { id: "T06", title: "Unsafe URL handling", surface: "citations/documents/links", impact: "high", likelihood: "medium",
    currentProtection: "Centralized safe-url: protocol allowlist (http/https/mailto), control-char stripping, rel=noopener.", remainingRisk: "Users can still click a valid https link to a hostile site (expected).", validation: "safe-url self-tests (javascript:/data:/file: rejected), unsafe-URL E2E.", owner: "lib/security/safe-url.ts" },
  { id: "T07", title: "Injection (SQL/command)", surface: "database", impact: "high", likelihood: "low",
    currentProtection: "No raw SQL from client; Supabase parameterized queries; no server-side shell.", remainingRisk: "RPCs must stay parameterized.", validation: "code review; no string-built SQL in adapter.", owner: "lib/adapters/supabaseAdapter.ts" },
  { id: "T08", title: "Insecure exports", surface: "export/backup", impact: "medium", likelihood: "medium",
    currentProtection: "Exports contain no tokens/secrets; JSON is data-only; import never trusts archive HTML/URLs.", remainingRisk: "An export file is as sensitive as the data; user must store it safely.", validation: "export manifest self-test asserts no secret fields; verify + import-preview tests.", owner: "lib/backup/export.ts" },
  { id: "T09", title: "Accidental deletion", surface: "records", impact: "medium", likelihood: "high",
    currentProtection: "Deletion-semantics registry drives honest confirmation copy; discard/archive are reversible; Recovery Center.", remainingRisk: "Permanent deletes are irreversible by design (clearly labeled).", validation: "deletion-semantics self-test; recovery-candidate tests.", owner: "lib/privacy/deletion.ts" },
  { id: "T10", title: "Destructive synchronization", surface: "sync", impact: "high", likelihood: "medium",
    currentProtection: "Three-way merge, tombstones, conflict surfacing; schema-compat gate blocks writes when incompatible.", remainingRisk: "A truly novel conflict shape could need manual reconciliation (surfaced, never auto-destroyed).", validation: "sync self-tests, schema-compat self-test, sync-conflict E2E.", owner: "lib/security/schema-compatibility.ts" },
  { id: "T11", title: "Stale offline client", surface: "sync", impact: "high", likelihood: "medium",
    currentProtection: "Schema-compat read-only mode when the server is ahead; idempotent mutation ids; bounded retry.", remainingRisk: "Very old clients must update before writing (by design).", validation: "schema mismatch read-only E2E.", owner: "lib/security/schema-compatibility.ts" },
  { id: "T12", title: "Sensitive logging", surface: "diagnostics", impact: "high", likelihood: "medium",
    currentProtection: "Allowlist-only diagnostic events; redaction of tokens/emails/hex; no content ever logged.", remainingRisk: "A careless console.log could bypass the policy; mitigated by the redaction helpers + review.", validation: "redaction self-tests; diagnostic-event cleanliness test.", owner: "lib/security/redaction.ts" },
  { id: "T13", title: "Leaked secrets", surface: "build/config", impact: "critical", likelihood: "low",
    currentProtection: "Only NEXT_PUBLIC_* anon values in client; service role/API keys never referenced client-side; secret-scan rules.", remainingRisk: "A committed .env could leak; mitigated by .gitignore + secret scan.", validation: "secret-scan script; bundle inspection.", owner: "scripts/scan-secrets.mjs" },
  { id: "T14", title: "Compromised dependencies", surface: "supply chain", impact: "high", likelihood: "medium",
    currentProtection: "Minimal dependency footprint (4 prod deps); npm audit; lockfile; no unexpected lifecycle scripts.", remainingRisk: "A transitive advisory can appear at any time; triage policy documented.", validation: "npm audit script; dependency-audit doc.", owner: "PRODUCTION_OPERATIONS.md" },
  { id: "T15", title: "DoS via oversized records", surface: "editors/import", impact: "medium", likelihood: "medium",
    currentProtection: "Per-field size caps, JSON depth cap, import batch cap, URL length cap.", remainingRisk: "A user can still create many small records (expected usage).", validation: "input-limits self-tests (size, depth, batch).", owner: "lib/security/input-limits.ts" },
  { id: "T16", title: "Privilege escalation", surface: "auth/database", impact: "critical", likelihood: "low",
    currentProtection: "No roles beyond the row owner; service role never in client; RLS uses auth.uid() only.", remainingRisk: "Server-side functions must run with least privilege.", validation: "RLS isolation with a non-superuser role.", owner: "lib/security/authorization-audit.ts" },
  { id: "T17", title: "Insecure development routes", surface: "routing", impact: "medium", likelihood: "medium",
    currentProtection: "/dev/* excluded/gated in production; route-manifest audit fails when a dev route ships.", remainingRisk: "A new dev route must follow the /dev prefix convention.", validation: "dev-route audit self-test + production route-manifest script.", owner: "lib/security/dev-routes.ts" },
];

/** Validate the model is complete (used by the self-test). */
export function validateThreatModel(threats: readonly Threat[] = THREATS): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const t of threats) {
    if (ids.has(t.id)) problems.push(`duplicate id ${t.id}`);
    ids.add(t.id);
    if (!t.currentProtection) problems.push(`${t.id} missing protection`);
    if (!t.validation) problems.push(`${t.id} missing validation`);
    if (!t.owner) problems.push(`${t.id} missing owner`);
    if (!t.remainingRisk) problems.push(`${t.id} missing remainingRisk (no fictional guarantees)`);
  }
  return { ok: problems.length === 0, problems };
}
