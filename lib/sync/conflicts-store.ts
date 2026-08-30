"use client";

/**
 * Rejected local intent, kept so it can be recovered (LIFEOS-076 §7, §8).
 *
 * ## Why this exists at all
 *
 * Migration 0045 stops a stale write from destroying a durable fact on the
 * SERVER. On its own that is only half a repair: if the client responded by
 * fetching the authoritative row, replacing local state and forgetting what it
 * had tried to write, it would fix server corruption and recreate F-2 locally —
 * the user's own text would still vanish from their own machine, which is
 * exactly the failure that made F-2 a P1.
 *
 * So a rejection preserves the local value. This is the smallest structure that
 * can explain what was refused and offer it back.
 *
 * ## Why it is PERSISTED
 *
 * §8 asks for that justification. The rejected value is user-authored prose or
 * a consequential state change; if it lived only in memory, a reload — the most
 * ordinary thing a person does — would destroy it, and P1 protection would rest
 * on volatile state. It is stored under its own device-local key, never pushed,
 * and never becomes a StoreState domain: it is a record of a sync event on this
 * device, not a fact about the user's life.
 *
 * ## What this is NOT
 *
 * Not a conflict engine. `merge.ts`, `conflicts.ts` and the six `merge-rules.ts`
 * modules (D-8) stay dormant. Nothing here merges, scores or resolves anything.
 * It holds two versions and lets the person choose.
 */

const KEY = "lifeos.conflicts.v1";

/** The only domains 0045 guards. Deliberately not widened (§12). */
export type GuardedDomain = "nextActions" | "notes";

export interface StaleConflict {
  domain: GuardedDomain;
  id: string;
  /** The record this device tried to write and the server refused. */
  local: unknown;
  /** The authoritative row at the moment of rejection. */
  remote: unknown;
  detectedAt: string;
  reason: "stale_write";
}

const listeners = new Set<() => void>();
let cache: StaleConflict[] | null = null;

function read(): StaleConflict[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as StaleConflict[]) : [];
  } catch {
    // A corrupt conflict file must not take the app down, and must not be
    // silently rewritten either — it is dropped from memory only.
    cache = [];
  }
  return cache;
}

function write(next: StaleConflict[]): void {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Quota. The in-memory copy still serves this session; losing the
      // rejected text is bad, but so is throwing inside a sync callback.
    }
  }
  listeners.forEach((l) => l());
}

export function subscribeConflicts(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getConflicts(): StaleConflict[] {
  return read();
}

export function conflictFor(domain: GuardedDomain, id: string): StaleConflict | undefined {
  return read().find((c) => c.domain === domain && c.id === id);
}

/**
 * Record rejections. One conflict per record: a second rejection for the same
 * row replaces the first, because the newer local attempt is the one the person
 * still means, and stacking every attempt would turn this into the growing
 * ledger §8 rules out.
 */
export function recordConflicts(next: StaleConflict[]): void {
  if (!next.length) return;
  const keep = read().filter((c) => !next.some((n) => n.domain === c.domain && n.id === c.id));
  write([...keep, ...next]);
}

/** Clear one conflict — the user kept the current version, or reapplied theirs. */
export function resolveConflict(domain: GuardedDomain, id: string): void {
  const rest = read().filter((c) => !(c.domain === domain && c.id === id));
  if (rest.length !== read().length) write(rest);
}

export function clearAllConflicts(): void {
  if (read().length) write([]);
}

/**
 * Drop the in-memory copy WITHOUT touching what is stored.
 *
 * §8 asks for the persistence claim to be justified; a test that asserts it
 * while reading the same cache the writer just filled proves nothing, so this
 * exists to make the cold read real.
 */
export function __dropCacheForTest(): void {
  cache = null;
}

/** Conflicts belong to one account on one device; a sign-out or wipe clears them. */
export function purgeConflicts(): void {
  cache = [];
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(KEY); } catch { /* nothing more to do */ }
  }
  listeners.forEach((l) => l());
}
