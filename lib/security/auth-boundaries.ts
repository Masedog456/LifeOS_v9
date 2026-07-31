/**
 * Authentication boundary rules (LIFEOS-040, Feature 2).
 *
 * Pure predicates that express the auth invariants the UI must honor. They take
 * a small AuthContext (never the raw token) and decide what is permitted:
 * whether protected data may render, whether protected writes may proceed, and
 * how a redirect target is validated. No custom cryptography — Supabase owns
 * tokens; this module owns the *rules* around them so they are testable.
 */

export type AuthCategory = "signed-out" | "loading" | "signed-in" | "expired";

export interface AuthContext {
  category: AuthCategory;
  /** Seconds until token expiry, if known (negative → expired). */
  expiresInSec?: number;
  /** A deletion freeze blocks all writes regardless of auth. */
  deletionFreeze?: boolean;
  /** Schema gate result: false blocks writes. */
  writesAllowedBySchema?: boolean;
}

/** Protected data may only render once a session is confirmed signed-in. */
export function mayRenderProtected(ctx: AuthContext): boolean {
  return ctx.category === "signed-in";
}

/** Expired sessions fail CLOSED: no protected UI, no writes. */
export function isExpired(ctx: AuthContext): boolean {
  if (ctx.category === "expired") return true;
  if (typeof ctx.expiresInSec === "number" && ctx.expiresInSec <= 0) return true;
  return false;
}

/** Protected writes require signed-in, not expired, not frozen, schema-OK. */
export function mayWriteProtected(ctx: AuthContext): boolean {
  if (ctx.category !== "signed-in") return false;
  if (isExpired(ctx)) return false;
  if (ctx.deletionFreeze) return false;
  if (ctx.writesAllowedBySchema === false) return false;
  return true;
}

/**
 * Validate a post-auth redirect target. Only same-origin, path-only redirects
 * are allowed — never an absolute URL to another origin (open-redirect guard).
 * Returns a safe path or the fallback.
 */
export function safeRedirect(target: string | null | undefined, fallback = "/today"): string {
  if (!target) return fallback;
  const t = String(target).trim();
  // Reject protocol-relative (//host) and absolute URLs.
  if (t.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(t)) return fallback;
  if (!t.startsWith("/")) return fallback;
  // Reject backslash tricks and control chars.
  if (/[\\\x00-\x1f]/.test(t)) return fallback;
  return t;
}

/** Neutral auth error copy — never reveals whether an account exists. */
export function neutralAuthError(): string {
  return "We couldn't complete that sign-in. Check your email for a link, or try again.";
}

/** Map a raw auth state into a coarse category for diagnostics (no identifiers). */
export function categorize(state: { loading: boolean; email: string | null; expiresInSec?: number }): AuthCategory {
  if (state.loading) return "loading";
  if (!state.email) return "signed-out";
  if (typeof state.expiresInSec === "number" && state.expiresInSec <= 0) return "expired";
  return "signed-in";
}
