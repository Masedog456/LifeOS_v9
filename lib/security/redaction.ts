/**
 * Sensitive logging & redaction policy (LIFEOS-040, Feature 9).
 *
 * ONE place that decides what may leave the app as a diagnostic. The rule is a
 * strict ALLOWLIST: a diagnostic event may only carry the scoped fields below.
 * User content — captures, notes, beliefs, research, document text, completion
 * evidence, export contents, raw sync payloads — is NEVER logged, and neither
 * are tokens, passwords, or private URLs. `redactMessage` scrubs anything that
 * looks like a secret from an error string; `buildDiagnosticEvent` constructs a
 * whitelisted event so callers physically cannot attach content.
 *
 * There is no telemetry here. Nothing is transmitted. These helpers only shape
 * data the USER can choose to copy or download from the Diagnostics Center.
 */

/** The ONLY fields a diagnostic event may contain. Anything else is dropped. */
export const ALLOWED_DIAGNOSTIC_FIELDS = [
  "event",
  "at",
  "userScope",     // masked/scoped id, never the raw email
  "recordType",    // e.g. "capture" — a TYPE, never contents
  "operation",     // e.g. "sync.save"
  "durationMs",
  "result",        // "ok" | "error" | "skipped"
  "errorCode",     // sanitized short code, never a stack
  "appVersion",
  "schemaVersion",
  "migrationVersion",
] as const;

export type DiagnosticField = (typeof ALLOWED_DIAGNOSTIC_FIELDS)[number];
export type DiagnosticEvent = Partial<Record<DiagnosticField, string | number>> & { event: string; at: string };

/** Patterns that indicate a secret/credential/token in a free-text message. */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "«jwt»"], // JWT
  [/eyJ[A-Za-z0-9_-]{10,}/g, "«jwt»"],                                       // JWT-ish
  [/\b(sb[ps]?_[A-Za-z0-9]{10,})\b/g, "«supabase-key»"],                     // supabase keys
  [/\bsk-[A-Za-z0-9]{10,}\b/g, "«api-key»"],                                 // openai-style
  [/\bBearer\s+[\w.\-]+/gi, "Bearer «token»"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "«email»"],        // emails
  [/([?&](?:access_token|token|key|apikey|password|secret)=)[^&\s]+/gi, "$1«redacted»"], // secrets in query strings
  [/\b[0-9a-f]{32,}\b/gi, "«hex»"],                                          // long hex secrets/hashes
];

/** Scrub anything secret-looking from a message and bound its length. */
export function redactMessage(message: string | null | undefined, maxLen = 300): string {
  if (!message) return "";
  let out = String(message);
  for (const [re, repl] of SECRET_PATTERNS) out = out.replace(re, repl);
  return out.slice(0, maxLen);
}

/** Mask an email so it can appear in a scoped diagnostic without leaking. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/**
 * Reduce a raw error into a stable, non-sensitive short code + redacted summary.
 * Never returns a stack, SQL, env var, token, or record payload.
 */
export function errorToCode(err: unknown): { code: string; summary: string } {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const summary = redactMessage(raw);
  // Derive a coarse, stable category code from the sanitized text.
  const lower = summary.toLowerCase();
  let code = "unknown";
  if (/network|fetch|timeout|offline|connection/.test(lower)) code = "network";
  else if (/quota|storage|exceeded/.test(lower)) code = "storage";
  else if (/permission|unauthor|forbidden|rls|policy/.test(lower)) code = "authorization";
  else if (/auth|session|token|login|expired/.test(lower)) code = "auth";
  else if (/parse|json|schema|validation|invalid/.test(lower)) code = "validation";
  else if (/conflict|version|stale/.test(lower)) code = "conflict";
  return { code, summary };
}

/**
 * Build a diagnostic event from arbitrary input, keeping ONLY allowlisted
 * fields. Content fields a caller mistakenly passes are physically discarded.
 * `errorCode` and any `userScope` email are always redacted/masked.
 */
export function buildDiagnosticEvent(input: Record<string, unknown>): DiagnosticEvent {
  const out = { event: String(input.event ?? "event"), at: String(input.at ?? new Date().toISOString()) } as DiagnosticEvent;
  for (const field of ALLOWED_DIAGNOSTIC_FIELDS) {
    if (field === "event" || field === "at") continue;
    const v = input[field];
    if (v == null) continue;
    if (field === "userScope") { out.userScope = maskEmail(String(v)) ?? "•••"; continue; }
    if (field === "errorCode") { out.errorCode = redactMessage(String(v), 60); continue; }
    out[field] = typeof v === "number" ? v : String(v);
  }
  return out;
}

/** True if an object is a clean diagnostic event (no stray/content fields). */
export function isCleanDiagnosticEvent(obj: Record<string, unknown>): boolean {
  const allowed = new Set<string>(ALLOWED_DIAGNOSTIC_FIELDS);
  return Object.keys(obj).every((k) => allowed.has(k));
}
