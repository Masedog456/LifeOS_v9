/**
 * Production-safe error shaping (LIFEOS-040, Feature 10).
 *
 * Turns any thrown value into a SafeError the UI can show without leaking:
 * a concise explanation, a stable reference id (so a user can quote it in a
 * report without exposing anything), a coarse category, and whether a retry is
 * sensible. Stack traces, SQL, env vars, tokens, and record payloads never
 * appear in a SafeError. In development the raw detail is kept LOCALLY on the
 * object (devDetail) for the console only — it is never rendered in production
 * surfaces and never persisted.
 */

import { errorToCode } from "@/lib/security/redaction";

export interface SafeError {
  /** A short, stable reference the user can quote (e.g. "ERR-7Q2K-NETWORK"). */
  reference: string;
  /** Coarse category: network|storage|authorization|auth|validation|conflict|unknown. */
  category: string;
  /** One-sentence, non-sensitive explanation. */
  message: string;
  /** Whether retrying the same action is reasonable. */
  retryable: boolean;
  /** Dev-only raw detail (console use); never shown in production UI. */
  devDetail?: string;
}

const RETRYABLE = new Set(["network", "storage", "conflict"]);

const FRIENDLY: Record<string, string> = {
  network: "We couldn't reach the server. Your data is safe locally.",
  storage: "Local storage is full or unavailable. Export a backup to be safe.",
  authorization: "You don't have access to that item.",
  auth: "Your session needs attention. Please sign in again.",
  validation: "Something about that data wasn't valid.",
  conflict: "This changed elsewhere and needs to be reconciled.",
  unknown: "Something went wrong.",
};

/** Deterministic-ish short reference id. Not cryptographic — just quotable. */
function makeReference(category: string, seed?: string): string {
  const base = seed ?? `${Date.now()}-${Math.random()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(h, 31) + base.charCodeAt(i)) | 0;
  const code = (h >>> 0).toString(36).toUpperCase().slice(0, 6).padStart(4, "0");
  return `ERR-${code}-${category.toUpperCase()}`;
}

/**
 * Build a SafeError from any thrown value. `isDev` controls whether the raw
 * (already-redacted) summary is attached for local console use.
 */
export function toSafeError(err: unknown, opts: { isDev?: boolean; referenceSeed?: string } = {}): SafeError {
  const { code, summary } = errorToCode(err);
  const category = code;
  return {
    reference: makeReference(category, opts.referenceSeed),
    category,
    message: FRIENDLY[category] ?? FRIENDLY.unknown,
    retryable: RETRYABLE.has(category),
    devDetail: opts.isDev ? summary : undefined,
  };
}

/** The fields safe to render in production (drops devDetail). */
export function publicError(e: SafeError): Omit<SafeError, "devDetail"> {
  const { reference, category, message, retryable } = e;
  return { reference, category, message, retryable };
}
