/**
 * Sync Reliability Center diagnostics (LIFEOS-032, Feature 7).
 *
 * A small, SANITIZED projection of the persistence + auth state for a System-
 * facing diagnostics view: adapter, auth status, local/remote status, last
 * successful sync, dirty domains, retry state, pending local changes. It NEVER
 * exposes secrets, tokens, credentials, or document contents — only domain names
 * and counts. No analytics, no network beyond a user-triggered retry (elsewhere).
 */

import { getHealth, getSyncDiagnostics, getLastSyncAt, getRecentSaveErrors } from "@/lib/persistence";
import { getAuth } from "@/lib/authStore";

export interface SyncDiagnosticsSnapshot {
  adapter: "local" | "supabase";
  authenticated: boolean;
  authEmailMasked: string | null;
  localStatus: "ok" | "error";
  localError?: string;
  remoteStatus: string;
  remoteError?: string;
  lastSyncAt: string | null;
  dirtyDomains: string[];
  pendingLocalChanges: boolean;
  hasBaseline: boolean;
  retrying: boolean;
  retryAttempt?: number;
  recentErrors: { at: string; message: string }[];
}

/** Mask an email so diagnostics can be copied/shared without leaking it. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  const head = user.slice(0, 1);
  return `${head}${"•".repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/** Strip anything that could carry a secret or document content from a message. */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/(eyJ[\w-]{6,})/g, "«jwt»")               // JWT-ish tokens
    .replace(/(sk-[A-Za-z0-9]{6,}|key-[A-Za-z0-9]{6,})/g, "«key»")
    .replace(/(Bearer\s+[\w.-]+)/gi, "Bearer «token»")
    .slice(0, 300);
}

/** Build the sanitized diagnostics snapshot from the live persistence/auth state. */
export function syncDiagnostics(): SyncDiagnosticsSnapshot {
  const health = getHealth();
  const diag = getSyncDiagnostics();
  const auth = getAuth();
  return {
    adapter: health.mode,
    authenticated: Boolean(auth.email),
    authEmailMasked: maskEmail(auth.email),
    localStatus: health.localError ? "error" : "ok",
    localError: health.localError ? sanitizeMessage(health.localError) : undefined,
    remoteStatus: health.state,
    remoteError: health.error ? sanitizeMessage(health.error) : undefined,
    lastSyncAt: getLastSyncAt(),
    dirtyDomains: diag.dirtyDomains,
    pendingLocalChanges: diag.queued || diag.dirtyDomains.length > 0,
    hasBaseline: diag.hasBaseline,
    retrying: health.state === "retrying",
    retryAttempt: health.retryAttempt,
    recentErrors: getRecentSaveErrors().map((e) => ({ at: e.at, message: sanitizeMessage(e.message) })),
  };
}

/** Human, copyable plain-text form of a snapshot (no secrets). */
export function diagnosticsText(s: SyncDiagnosticsSnapshot): string {
  return [
    "LifeOS sync diagnostics",
    `adapter: ${s.adapter}`,
    `authenticated: ${s.authenticated ? "yes" : "no"}${s.authEmailMasked ? ` (${s.authEmailMasked})` : ""}`,
    `local: ${s.localStatus}${s.localError ? ` — ${s.localError}` : ""}`,
    `remote: ${s.remoteStatus}${s.remoteError ? ` — ${s.remoteError}` : ""}`,
    `lastSyncAt: ${s.lastSyncAt ?? "never"}`,
    `dirtyDomains: ${s.dirtyDomains.join(", ") || "none"}`,
    `pendingLocalChanges: ${s.pendingLocalChanges ? "yes" : "no"}`,
    `retrying: ${s.retrying ? `yes (attempt ${s.retryAttempt ?? "?"})` : "no"}`,
    `recentErrors: ${s.recentErrors.length}`,
  ].join("\n");
}
