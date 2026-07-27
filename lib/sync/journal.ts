/**
 * Privacy-safe sync journal (LIFEOS-033, Feature 6).
 *
 * A bounded local log of sync operations used for retries, diagnostics, and
 * idempotency. Each entry stores ONLY metadata — operation id, domain, record
 * id, mutation type, timestamps, attempt count, status, and a SANITIZED failure
 * category. It never stores document text, note contents, tokens, credentials,
 * or secrets. Pure helpers here; persistence is a thin localStorage wrapper.
 */

import type { MutationType } from "@/lib/sync/operations";

export type JournalStatus = "pending" | "in_flight" | "succeeded" | "failed";
export type FailureCategory = "network" | "auth" | "conflict" | "server" | "validation" | "unknown";

export interface JournalEntry {
  opId: string;
  domain: string;
  recordId: string;
  type: MutationType;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  status: JournalStatus;
  failureCategory?: FailureCategory;
}

/** Categorize a raw error into a coarse, non-sensitive bucket. */
export function categorizeFailure(message: string): FailureCategory {
  const m = message.toLowerCase();
  if (/(network|fetch|timeout|offline|econn|dns)/.test(m)) return "network";
  if (/(auth|401|403|jwt|unauthorized|forbidden|session)/.test(m)) return "auth";
  if (/(conflict|409|version|stale)/.test(m)) return "conflict";
  if (/(400|422|invalid|malformed|constraint|violat)/.test(m)) return "validation";
  if (/(500|502|503|server|internal)/.test(m)) return "server";
  return "unknown";
}

export function makeEntry(opId: string, domain: string, recordId: string, type: MutationType, at: string): JournalEntry {
  return { opId, domain, recordId, type, createdAt: at, updatedAt: at, attempts: 0, status: "pending" };
}

export function recordAttempt(e: JournalEntry, at: string): JournalEntry {
  return { ...e, attempts: e.attempts + 1, status: "in_flight", updatedAt: at };
}
export function markSucceeded(e: JournalEntry, at: string): JournalEntry {
  return { ...e, status: "succeeded", failureCategory: undefined, updatedAt: at };
}
export function markFailed(e: JournalEntry, at: string, category: FailureCategory): JournalEntry {
  return { ...e, status: "failed", failureCategory: category, updatedAt: at };
}

/** Upsert an entry into a journal by opId (idempotent — retries update in place). */
export function upsertEntry(journal: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const i = journal.findIndex((e) => e.opId === entry.opId);
  if (i === -1) return [...journal, entry];
  const next = journal.slice();
  next[i] = entry;
  return next;
}

const MAX_ENTRIES = 500;
/** Trim + drop succeeded entries older than the completed retention. */
export function pruneJournal(journal: JournalEntry[]): JournalEntry[] {
  const kept = journal.filter((e) => e.status !== "succeeded");
  const recentSucceeded = journal.filter((e) => e.status === "succeeded").slice(-50);
  const all = [...kept, ...recentSucceeded];
  return all.length > MAX_ENTRIES ? all.slice(all.length - MAX_ENTRIES) : all;
}

export function pendingEntries(journal: JournalEntry[]): JournalEntry[] {
  return journal.filter((e) => e.status === "pending" || e.status === "in_flight" || e.status === "failed");
}
export function journalDepth(journal: JournalEntry[]): number {
  return pendingEntries(journal).length;
}
export function oldestPending(journal: JournalEntry[]): JournalEntry | undefined {
  return pendingEntries(journal).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}
export function clearCompleted(journal: JournalEntry[]): JournalEntry[] {
  return journal.filter((e) => e.status !== "succeeded");
}

// ---- thin persistence (metadata only; no content ever) ----
const KEY = "lifeos.sync.journal.v1";
export function loadJournal(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try { const raw = window.localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as JournalEntry[]) : []; }
  catch { return []; }
}
export function saveJournal(journal: JournalEntry[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(pruneJournal(journal))); } catch { /* non-critical */ }
}
