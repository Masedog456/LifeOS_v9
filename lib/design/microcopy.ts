/**
 * Microcopy standards (LIFEOS-041, Feature 33) + shared error-language model
 * (Feature 25) and empty-state model (Feature 24).
 *
 * Tone: calm, direct, respectful, neutral, concise, human. This module holds the
 * FORBIDDEN-phrase list a self-test scans copy against, plus the canonical
 * builders for empty states and error messages so every surface reads the same.
 */

/** Phrases banned from in-workflow copy (hype, shame, praise, judgment, jargon). */
export const FORBIDDEN_PHRASES: readonly string[] = [
  // hype / gamification
  "awesome", "amazing", "crush it", "level up", "streak", "keep it up", "you're on fire",
  "congratulations", "great job", "well done", "nailed it", "rockstar", "ninja",
  // shame / pressure
  "don't lose your", "you missed", "falling behind", "you failed", "you should have",
  "hurry", "act now", "last chance", "running out",
  // vague / unhelpful errors
  "oops", "whoops", "something went wrong.",
  // robotic jargon leaking to users
  "null", "undefined", "exception", "stack trace", "http 500",
];

/** Scan user-facing copy for forbidden phrases (case-insensitive substring). */
export function findForbidden(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((p) => lower.includes(p));
}

// ---- Empty-state model (Feature 24) ----

export type EmptyKind =
  | "account" | "route" | "filtered" | "search" | "date-range"
  | "offline" | "permission" | "archived-only" | "error-derived";

export interface EmptyStateCopy {
  kind: EmptyKind;
  /** what is absent */
  title: string;
  /** why it might be absent */
  body: string;
  /** one reasonable next action label (optional) */
  actionLabel?: string;
}

/** Canonical empty-state copy. No jokes, no shame, no sales pitch. */
export function emptyState(kind: EmptyKind, subject: string, opts: { actionLabel?: string } = {}): EmptyStateCopy {
  const S = subject;
  const table: Record<EmptyKind, { title: string; body: string }> = {
    account: { title: `No ${S} yet`, body: `This is where your ${S} will live. Add your first one to begin.` },
    route: { title: `No ${S} here`, body: `Nothing has been added to ${S} yet.` },
    filtered: { title: `No ${S} match these filters`, body: `Try clearing a filter to see more.` },
    search: { title: `No results`, body: `Nothing matched your search. Try different words.` },
    "date-range": { title: `No ${S} in this range`, body: `There is no recorded activity for the dates you selected.` },
    offline: { title: `Unavailable offline`, body: `This needs a connection. Your local data is safe and will sync when you're back.` },
    permission: { title: `Not available`, body: `Sign in to see ${S} synced across your devices.` },
    "archived-only": { title: `Only archived ${S}`, body: `Everything here is archived. Un-archive an item to bring it back.` },
    "error-derived": { title: `Couldn't load ${S}`, body: `Something interrupted loading. Your data is safe — try again.` },
  };
  const t = table[kind];
  return { kind, title: t.title, body: t.body, actionLabel: opts.actionLabel };
}

// ---- Error-language model (Feature 25) ----

export interface ErrorCopy {
  /** what could not happen */
  problem: string;
  /** whether data is safe */
  dataSafe: string;
  /** what the user can do */
  next: string;
  retryable: boolean;
  /** where diagnostics live */
  diagnostics: string;
  /** security-safe reference id, if available */
  reference?: string;
}

/** Build a standard, calm error message from a category + optional reference. */
export function errorCopy(category: string, reference?: string): ErrorCopy {
  const map: Record<string, { problem: string; next: string; retryable: boolean; dataSafe: string }> = {
    network: { problem: "We couldn't reach the server.", next: "Check your connection and try again.", retryable: true, dataSafe: "Your data is saved locally." },
    storage: { problem: "Local storage is full or unavailable.", next: "Export a backup, then remove old data.", retryable: false, dataSafe: "Nothing was lost." },
    authorization: { problem: "You don't have access to that item.", next: "If this seems wrong, sign in again.", retryable: false, dataSafe: "Your data is safe." },
    auth: { problem: "Your session needs attention.", next: "Sign in again to continue.", retryable: false, dataSafe: "Your data is safe." },
    validation: { problem: "That data wasn't valid.", next: "Adjust the highlighted field and retry.", retryable: false, dataSafe: "Nothing was changed." },
    conflict: { problem: "This changed elsewhere.", next: "Open it to choose which version to keep.", retryable: false, dataSafe: "No version was lost." },
    unknown: { problem: "That action didn't complete.", next: "Try again in a moment.", retryable: true, dataSafe: "Your data is safe." },
  };
  const m = map[category] ?? map.unknown;
  return { problem: m.problem, dataSafe: m.dataSafe, next: m.next, retryable: m.retryable, diagnostics: "See Diagnostics for details.", reference };
}
