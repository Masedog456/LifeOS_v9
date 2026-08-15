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

/**
 * Supabase error codes that all mean **this address has no account and we will
 * not create one** (LIFEOS-050C).
 *
 * `otp_disabled` is what `shouldCreateUser: false` returns for an unknown
 * address; `signup_disabled` is what the project returns when new signups are
 * turned off in the dashboard; `user_not_found` covers the remaining shape.
 * Treating all three alike lets the founder enable either control — or both —
 * without the sign-in copy going wrong.
 */
const CLOSED_BETA_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

/**
 * True when a sign-in error means "not part of the closed beta" rather than a
 * genuine fault.
 *
 * The distinction matters in both directions. Classifying a real outage as a
 * refusal tells a legitimate tester they were never invited and hides a live
 * incident; classifying a refusal as a fault dumps a raw provider string on
 * someone who simply isn't on the list.
 */
export function isClosedBetaRefusal(code: string | undefined): boolean {
  return code ? CLOSED_BETA_CODES.has(code) : false;
}

/**
 * Copy shown when sign-in is refused because the address isn't invited.
 *
 * Deliberately does NOT confirm or deny that the address has an account, which
 * keeps the no-enumeration stance of `neutralAuthError` above. It differs from
 * that helper in one respect that matters here: it never says "check your email
 * for a link", because in this case no link was sent and telling someone to
 * wait for one would be false. It states the rule, and points to the invitation.
 */
export function closedBetaRefusal(): string {
  return "LifeOS is in closed beta — sign-in links are only sent to invited addresses. If yours was invited, check your inbox; otherwise reply to your invitation and we'll add you.";
}

/** Map a raw auth state into a coarse category for diagnostics (no identifiers). */
export function categorize(state: { loading: boolean; email: string | null; expiresInSec?: number }): AuthCategory {
  if (state.loading) return "loading";
  if (!state.email) return "signed-out";
  if (typeof state.expiresInSec === "number" && state.expiresInSec <= 0) return "expired";
  return "signed-in";
}
