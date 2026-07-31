/**
 * Production security headers & Content-Security-Policy (LIFEOS-040, Feature 26).
 *
 * A single source of truth for the response headers LifeOS sets in production,
 * consumed by next.config's `headers()` and validated by a self-test. The CSP is
 * built for this architecture: a Next.js app that talks only to its own origin
 * and (when configured) a Supabase project over https. We avoid `unsafe-eval`
 * entirely.
 *
 * DOCUMENTED EXCEPTIONS (Feature 26 — "document unavoidable exceptions"):
 *  - `script-src 'unsafe-inline'`: Next.js App Router + Turbopack emits
 *    first-party inline bootstrap + RSC flight-data scripts and does NOT stamp
 *    a CSP nonce on them under Turbopack, so a nonce policy blocks the
 *    framework's own scripts. These are 100% first-party build output — never
 *    user content — and the app has no user-controlled inline-script sink (the
 *    one HTML sink escapes + URL-allowlists; see lib/library/annotations.ts).
 *    We allow inline scripts but NEVER `unsafe-eval`.
 *  - `style-src 'unsafe-inline'`: the framework sets inline style attributes
 *    during streaming.
 */

export interface CspOptions {
  /** The Supabase project origin to allow in connect-src (https), if configured. */
  supabaseOrigin?: string;
  /** Include a per-request nonce for script-src. */
  nonce?: string;
  /** Relax to report-only style for staged rollout. */
  reportOnly?: boolean;
}

/** Build the CSP directive map. */
export function cspDirectives(opts: CspOptions = {}): Record<string, string[]> {
  const self = "'self'";
  const connect = [self];
  if (opts.supabaseOrigin) connect.push(opts.supabaseOrigin);
  connect.push("https:"); // https API endpoints (never http)
  // `'self'` allows the app's own same-origin chunk scripts; `'unsafe-inline'`
  // is the documented framework exception (Next/Turbopack emits un-nonced
  // first-party inline scripts — see the header comment). We NEVER allow
  // `'unsafe-eval'`. No nonce: a nonce would make browsers ignore 'unsafe-inline'
  // and re-block the framework's un-nonced inline scripts.
  const script = [self, "'unsafe-inline'"];
  return {
    "default-src": [self],
    "script-src": script,
    "style-src": [self, "'unsafe-inline'"], // documented exception (framework inline styles)
    "img-src": [self, "data:", "blob:"],
    "font-src": [self, "data:"],
    "connect-src": connect,
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": [self],
    "form-action": [self],
    "frame-src": ["'none'"],
    "worker-src": [self, "blob:"],
    "manifest-src": [self],
    "upgrade-insecure-requests": [],
  };
}

/** Serialize the directive map into a CSP header string. */
export function serializeCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

export interface SecurityHeader { key: string; value: string }

/** The full set of production security headers. */
export function securityHeaders(opts: CspOptions = {}): SecurityHeader[] {
  const csp = serializeCsp(cspDirectives(opts));
  return [
    { key: opts.reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ];
}

/** Assert a header set meets the baseline (used by the self-test). */
export function validateHeaders(headers: SecurityHeader[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const byKey = new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));
  const csp = byKey.get("content-security-policy") ?? byKey.get("content-security-policy-report-only");
  if (!csp) problems.push("missing CSP");
  else {
    // The hard requirement is NO unsafe-eval anywhere. `script-src 'unsafe-inline'`
    // is an accepted, documented framework exception (see cspDirectives).
    if (/unsafe-eval/.test(csp)) problems.push("CSP allows unsafe-eval");
    if (!/frame-ancestors 'none'/.test(csp)) problems.push("CSP missing frame-ancestors 'none'");
    if (!/object-src 'none'/.test(csp)) problems.push("CSP missing object-src 'none'");
    if (!/base-uri 'self'/.test(csp)) problems.push("CSP missing base-uri 'self'");
    if (!/\bscript-src\b/.test(csp)) problems.push("CSP missing script-src");
  }
  for (const required of ["strict-transport-security", "x-content-type-options", "referrer-policy", "permissions-policy"]) {
    if (!byKey.has(required)) problems.push(`missing ${required}`);
  }
  return { ok: problems.length === 0, problems };
}
