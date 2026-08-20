/**
 * Local beta-evidence store (LIFEOS-059).
 *
 * ## Local-first, and it stays local
 *
 * Evidence lives in ONE browser key, outside `StoreState` — not synced, not
 * exported with the user's records, not in a backup, not in a tombstone ledger.
 * Nothing here transmits anything. The tester decides whether the founder ever
 * sees it, by choosing to share a summary.
 *
 * That mirrors the two existing precedents rather than inventing a third
 * pattern: `lib/sync/journal.ts` (a bounded local log of metadata only) and
 * `lib/interview/session.ts` (a single local key, cleared by the same paths).
 *
 * ## Telemetry is subordinate to the product
 *
 * Every write is best-effort and swallowed. If the key is corrupt, if quota is
 * exhausted, if `localStorage` throws — the recording is lost and the user's
 * action proceeds untouched. A person adopting a Constitution element must
 * never see it fail because a counter could not be written. `record()` returns
 * a boolean so tests can assert the failure was absorbed, and nothing in the
 * product branches on it.
 *
 * ## Bounded
 *
 * A ring buffer of `MAX_EVENTS`, pruned oldest-first, exactly like the sync
 * journal. Evidence cannot grow without limit on a long-lived beta device.
 */

import { useSyncExternalStore } from "react";
import { buildBetaEvent, isCleanBetaEvent, MAX_EVENT_JSON, type BetaEvent } from "@/lib/beta/events";

/** The browser key. Versioned so a shape change is a discard, not a migration. */
export const BETA_EVIDENCE_KEY = "conqify.beta.evidence.v1";

/** Ring-buffer bound. Matches the sync journal's order of magnitude. */
export const MAX_EVENTS = 500;

/** Marks when instrumentation began. See `lib/beta/canary.ts` for why. */
export const BETA_START_KEY = "conqify.beta.startedAt.v1";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the log.
 *
 * Every entry is re-validated against the current contract on the way out, so a
 * payload written by an older build — or edited by hand — cannot introduce a
 * field this version forbids. Malformed entries are dropped individually rather
 * than failing the whole read: partial evidence is still useful, and a corrupt
 * log must not make the summary page unopenable.
 */
export function readEvidence(): BetaEvent[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(BETA_EVIDENCE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => isCleanBetaEvent(e) && JSON.stringify(e).length <= MAX_EVENT_JSON) as BetaEvent[];
  } catch {
    return [];
  }
}

/** When instrumentation began on this device, or `null` if it has not. */
export function evidenceStartedAt(): string | null {
  const s = storage();
  if (!s) return null;
  try {
    return s.getItem(BETA_START_KEY);
  } catch {
    return null;
  }
}

/**
 * Record one event. Returns whether it was stored.
 *
 * The return value exists for tests. No product code may branch on it — the
 * whole contract of this module is that the caller does not care.
 */
export function record(name: string, fields: Record<string, unknown> = {}): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const event = buildBetaEvent(name, fields);
    if (!event) return false;
    const json = JSON.stringify(event);
    if (json.length > MAX_EVENT_JSON) return false;

    const existing = readEvidence();
    const next = [...existing, event];
    const pruned = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    s.setItem(BETA_EVIDENCE_KEY, JSON.stringify(pruned));
    if (!s.getItem(BETA_START_KEY)) s.setItem(BETA_START_KEY, event.at);
    emit();
    return true;
  } catch {
    // Quota exhausted, storage disabled, corrupt payload — all the same here.
    // The user's action already happened; this is the part that is allowed to
    // fail, and it fails silently by design.
    return false;
  }
}

/** Delete all evidence. Called by Reset local data and by sign-out. */
export function clearEvidence(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(BETA_EVIDENCE_KEY);
    s.removeItem(BETA_START_KEY);
  } catch {
    /* no-op */
  }
  emit();
}

/** Begin instrumentation without recording an event. Idempotent. */
export function markEvidenceStart(at?: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (!s.getItem(BETA_START_KEY)) s.setItem(BETA_START_KEY, at ?? new Date().toISOString());
  } catch {
    /* no-op */
  }
  emit();
}

// ---- React binding ----
//
// Same shape as `lib/workspaces/current.ts`: a module-level version counter and
// a cached snapshot, surfaced through `useSyncExternalStore` with an explicit
// server snapshot.
//
// The server snapshot matters here specifically. Evidence lives in
// `localStorage`, which does not exist during server rendering, so seeding it in
// a `useState` initializer makes the first client render disagree with the
// server HTML and React throws away the tree (hydration error #418). A server
// snapshot of "nothing recorded" is both true on the server and the correct
// first client render; React then re-reads after hydration.

export interface BetaEvidenceSnapshot {
  events: BetaEvent[];
  startedAt: string | null;
}

const SERVER_EVIDENCE: BetaEvidenceSnapshot = { events: [], startedAt: null };

let version = 0;
let cached: BetaEvidenceSnapshot = SERVER_EVIDENCE;
let cachedVersion = -1;
const listeners = new Set<() => void>();

/**
 * Invalidate the cached snapshot and wake subscribers.
 *
 * Best-effort like every other write here: a listener that throws must not take
 * down the product action that recorded the event.
 */
function emit(): void {
  version += 1;
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a broken subscriber is not the recording's problem */
    }
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Referentially stable between emits — required by `useSyncExternalStore`. */
function getEvidenceSnapshot(): BetaEvidenceSnapshot {
  if (cachedVersion !== version) {
    cached = { events: readEvidence(), startedAt: evidenceStartedAt() };
    cachedVersion = version;
  }
  return cached;
}

export function useBetaEvidence(): BetaEvidenceSnapshot {
  return useSyncExternalStore(subscribe, getEvidenceSnapshot, () => SERVER_EVIDENCE);
}
