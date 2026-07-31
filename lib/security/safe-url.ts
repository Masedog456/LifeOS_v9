/**
 * Safe URL & external-link handling (LIFEOS-040, Feature 6).
 *
 * ONE centralized place that decides whether a user- or import-supplied URL may
 * be turned into a clickable link. The rule is a strict protocol allowlist:
 * only http(s) and mailto are ever emitted. javascript:, data:, file:, vbscript:,
 * blob:, about:, and anything malformed are rejected — they become plain text,
 * never an href. Nothing here fetches a URL; this module only classifies and
 * formats. Server-side fetching of arbitrary user URLs is out of scope by
 * design (see the SSRF note in SECURITY_AND_PRIVACY.md).
 *
 * No custom HTML sanitizer lives here — this is URL classification only.
 */

/** Protocols we will ever render as a real link. Everything else is text. */
export const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:"] as const;

/** Protocols we explicitly name as dangerous (for tests + messaging). */
export const BLOCKED_PROTOCOLS = ["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"] as const;

export type SafeUrlReason = "ok" | "empty" | "malformed" | "blocked-protocol" | "relative" | "too-long";

export interface SafeUrlResult {
  safe: boolean;
  /** The normalized href when safe; undefined otherwise. */
  href?: string;
  /** The parsed protocol (lowercased, with the trailing colon) when parseable. */
  protocol?: string;
  reason: SafeUrlReason;
}

/** Absolute URLs longer than this are rejected outright (DoS / abuse guard). */
export const MAX_URL_LENGTH = 2048;

/**
 * Classify a raw URL string. We require an ABSOLUTE url with an allowed
 * protocol. Relative URLs are rejected here (callers that genuinely want an
 * in-app route use Next <Link>, never this). Leading/trailing whitespace and
 * embedded control characters are stripped before parsing so that
 * "java\tscript:alert(1)" cannot smuggle a blocked scheme past the parser.
 */
export function classifyUrl(raw: string | null | undefined): SafeUrlResult {
  if (raw == null) return { safe: false, reason: "empty" };
  // Strip ASCII control chars (incl. tab/newline) that browsers ignore inside
  // a scheme, then trim. This defeats "java\nscript:" style evasion.
  const cleaned = String(raw).replace(/[\x00-\x20\x7f]/g, "").trim();
  if (!cleaned) return { safe: false, reason: "empty" };
  if (cleaned.length > MAX_URL_LENGTH) return { safe: false, reason: "too-long" };

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return { safe: false, reason: "relative" }; // no scheme/host → not an absolute link
  }
  const protocol = url.protocol.toLowerCase();
  if (!(ALLOWED_PROTOCOLS as readonly string[]).includes(protocol)) {
    return { safe: false, protocol, reason: "blocked-protocol" };
  }
  return { safe: true, href: url.href, protocol, reason: "ok" };
}

/** True iff the URL is a safe, absolute, allowlisted link. */
export function isSafeUrl(raw: string | null | undefined): boolean {
  return classifyUrl(raw).safe;
}

/** The normalized href if safe, otherwise null (never throws). */
export function safeHref(raw: string | null | undefined): string | null {
  const r = classifyUrl(raw);
  return r.safe ? r.href! : null;
}

/** Whether a safe external link is off-origin (so the UI can mark it external). */
export function isExternalHref(href: string, origin?: string): boolean {
  try {
    const u = new URL(href);
    if (u.protocol === "mailto:") return true;
    const here = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
    if (!here) return true;
    return new URL(href).origin !== new URL(here).origin;
  } catch {
    return false;
  }
}

/**
 * The rel attribute to attach when opening a link in a new tab. `noopener` and
 * `noreferrer` prevent reverse-tabnabbing and referrer leakage; `nofollow`
 * avoids lending ranking to user-entered links.
 */
export const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";

/** Props a component can spread onto an <a> for a safe external link, or null. */
export function externalLinkProps(raw: string | null | undefined): { href: string; target: "_blank"; rel: string } | null {
  const href = safeHref(raw);
  if (!href) return null;
  return { href, target: "_blank", rel: EXTERNAL_LINK_REL };
}
