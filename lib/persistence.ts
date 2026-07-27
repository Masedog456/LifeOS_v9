/**
 * The persistence boundary for LifeOS (LIFEOS-004).
 *
 * The store still calls loadState/saveState/clearState synchronously for an
 * instant, offline-first local write. When Supabase is configured AND the
 * user is authenticated, every local write also schedules a debounced
 * remote sync (write locally first, sync remotely second). The UI and store
 * never call Supabase directly — only this facade and the adapters do.
 *
 * Sync status ("Saved locally" / "Syncing" / "Synced" / "Sync failed") is
 * exposed as a small observable for an unobtrusive indicator.
 */

import type { Session } from "@supabase/supabase-js";
import type { StoreState } from "@/types/mvp";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { SupabasePersistenceAdapter } from "@/lib/adapters/supabaseAdapter";
import type { PersistenceHealth } from "@/lib/adapters/types";
import * as authStore from "@/lib/authStore";

const STORAGE_KEY = "lifeos.mvp.v1";
const MIGRATED_KEY = "lifeos.migrated.v1";
/** Where a corrupt local blob is preserved before starting clean (LIFEOS-025). */
const CORRUPT_BACKUP_KEY = "lifeos.mvp.v1.corrupt";

let remote: SupabasePersistenceAdapter | null = null;
let lastSaved: StoreState | null = null;
/** The state at the last successful remote flush — for dirty-domain diffing. */
let lastSyncedState: StoreState | null = null;

/**
 * Which domains changed since the last successful sync. Because the store
 * mutates immutably (`setState({...state, domain: newArray})`), an unchanged
 * domain keeps the SAME array reference — so reference inequality per top-level
 * key IS the dirty set, with zero cost and zero store changes (LIFEOS-021).
 */
function dirtyDomainsOf(next: StoreState, base: StoreState | null): Set<keyof StoreState> {
  const dirty = new Set<keyof StoreState>();
  for (const key of Object.keys(next) as (keyof StoreState)[]) {
    if (!base || next[key] !== base[key]) dirty.add(key);
  }
  return dirty;
}

let health: PersistenceHealth = {
  mode: "local",
  state: isSupabaseConfigured() ? "syncing" : "disabled",
};
const listeners = new Set<() => void>();

export function subscribeHealth(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getHealth(): PersistenceHealth {
  return health;
}
function setHealth(next: Partial<PersistenceHealth>): void {
  health = { ...health, ...next };
  listeners.forEach((l) => l());
}

function normalize(partial: Partial<StoreState> | null): StoreState {
  return {
    captures: partial?.captures ?? [],
    proposals: partial?.proposals ?? [],
    beliefs: partial?.beliefs ?? [],
    sources: partial?.sources ?? [],
    feedback: partial?.feedback ?? [],
    comparisons: partial?.comparisons ?? [],
    inquiries: partial?.inquiries ?? [],
    megathreads: partial?.megathreads ?? [],
    reflections: partial?.reflections ?? [],
    practices: partial?.practices ?? [],
    reviews: partial?.reviews ?? [],
    reasonings: partial?.reasonings ?? [],
    embeddings: partial?.embeddings ?? [],
    decisions: partial?.decisions ?? [],
    formationSessions: partial?.formationSessions ?? [],
    concepts: partial?.concepts ?? [],
    conceptRelationships: partial?.conceptRelationships ?? [],
    principles: partial?.principles ?? [],
    frameworks: partial?.frameworks ?? [],
    knowledgeProjects: partial?.knowledgeProjects ?? [],
    researchProjects: partial?.researchProjects ?? [],
    dialogueSessions: partial?.dialogueSessions ?? [],
    tensions: partial?.tensions ?? [],
    syntheses: partial?.syntheses ?? [],
    recommendations: partial?.recommendations ?? [],
    documents: partial?.documents ?? [],
    citations: partial?.citations ?? [],
    workspaces: partial?.workspaces ?? [],
    sessions: partial?.sessions ?? [],
  };
}

function hasData(s: Partial<StoreState> | null): boolean {
  return Boolean(
    s && ((s.sources?.length ?? 0) || (s.beliefs?.length ?? 0) || (s.captures?.length ?? 0) || (s.proposals?.length ?? 0)),
  );
}

// ---------------- local (synchronous) ----------------

export function loadState(): Partial<StoreState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Partial<StoreState>;
    } catch {
      // Schema-mismatch / corruption hardening (LIFEOS-025): NEVER let the next
      // save silently overwrite an unparseable blob. Preserve it for recovery,
      // record the incident, and start clean.
      try {
        window.localStorage.setItem(CORRUPT_BACKUP_KEY, raw);
      } catch {
        // Backup itself failed (quota) — nothing more we can do safely.
      }
      recordSaveError("Local data was unreadable and has been preserved under a backup key.");
      return null;
    }
  } catch {
    return null;
  }
}

/** Is a preserved corrupt-blob backup present? (Surfaced by System Health.) */
export function hasCorruptBackup(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CORRUPT_BACKUP_KEY) !== null;
  } catch {
    return false;
  }
}

function writeLocal(state: StoreState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (health.localError) setHealth({ localError: undefined });
  } catch (e) {
    // Silent-save-failure hardening (LIFEOS-025): a quota/serialization error
    // is no longer swallowed — it is surfaced on the indicator and logged.
    const m = `Local save failed: ${msg(e)}`;
    recordSaveError(m);
    setHealth({ localError: m });
  }
}

/** Write locally now, and (if remote is active) schedule a debounced sync. */
export function saveState(state: StoreState): void {
  lastSaved = state;
  writeLocal(state);
  scheduleRemotePush(state);
}

/** Write locally only — used when adopting remote data, to avoid a re-push loop. */
export function saveLocalOnly(state: StoreState): void {
  lastSaved = state;
  // Adopted data came FROM remote, so it is already synced: baseline the diff
  // against it so subsequent incremental flushes only push genuine changes.
  lastSyncedState = state;
  writeLocal(state);
}

export function clearState(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(MIGRATED_KEY);
    } catch {
      // no-op
    }
  }
  lastSaved = null;
  lastSyncedState = null;
  if (remote) {
    setHealth({ state: "syncing" });
    remote
      .deleteAll()
      .then(() => setHealth({ state: "synced", error: undefined }))
      .catch((e) => setHealth({ state: "failed", error: msg(e) }));
  }
}

// ---------------- remote sync ----------------

let pending: StoreState | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Concurrent-flush guard (LIFEOS-025): prevents interleaved/duplicate writes. */
let inFlight = false;
/** Adoption gate (LIFEOS-025): holds pushes until migrateOrAdopt has decided. */
let adoptionSettled = true;
/** Automatic retry with capped backoff (LIFEOS-025). */
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const MAX_AUTO_RETRIES = 5;

/** Ring buffer of recent save errors (LIFEOS-025) — surfaced by System Health. */
const recentSaveErrors: { at: string; message: string }[] = [];
function recordSaveError(message: string): void {
  recentSaveErrors.push({ at: new Date().toISOString(), message });
  if (recentSaveErrors.length > 20) recentSaveErrors.shift();
}
export function getRecentSaveErrors(): { at: string; message: string }[] {
  return [...recentSaveErrors];
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function scheduleRemotePush(state: StoreState): void {
  if (!remote) return;
  pending = state;
  if (isOffline()) {
    // Offline is explicit, not an error: local data is safe, and the queued
    // state flushes automatically when connectivity returns.
    setHealth({ mode: "supabase", state: "offline" });
    return;
  }
  setHealth({ mode: "supabase", state: "syncing" });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 400);
}

async function flush(): Promise<void> {
  if (!remote || !pending) return;
  if (!adoptionSettled) {
    // A write raced initial local↔remote reconciliation — hold it until the
    // adopt/migrate decision lands, then it re-flushes (hydration-race guard).
    return;
  }
  if (inFlight) return; // re-queued; the running flush re-checks `pending`
  if (isOffline()) {
    setHealth({ state: "offline" });
    return;
  }
  inFlight = true;
  const snapshot = pending;
  pending = null;
  // Incremental sync: push only the domains that changed since the last
  // successful flush. First sync (no baseline) pushes everything.
  const dirty = dirtyDomainsOf(snapshot, lastSyncedState);
  try {
    await remote.saveState(snapshot, dirty, lastSyncedState);
    lastSyncedState = snapshot;
    retryAttempt = 0;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
    setHealth({ state: "synced", error: undefined, retryAttempt: undefined });
  } catch (e) {
    recordSaveError(`Remote sync failed: ${msg(e)}`);
    // Re-queue the snapshot (unless a newer one arrived while we were failing).
    if (!pending) pending = snapshot;
    scheduleAutoRetry(msg(e));
  } finally {
    inFlight = false;
    // A newer state arrived during the flush — sync it too (no lost writes).
    if (pending && health.state === "synced") {
      timer = setTimeout(() => void flush(), 100);
    }
  }
}

function scheduleAutoRetry(error: string): void {
  if (retryAttempt >= MAX_AUTO_RETRIES) {
    // Give up automatically retrying; the user can still retry by hand and
    // every new write re-arms the cycle. Local data is safe throughout.
    setHealth({ state: "failed", error, retryAttempt: undefined });
    retryAttempt = 0;
    return;
  }
  retryAttempt += 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (retryAttempt - 1), RETRY_MAX_MS);
  setHealth({ state: "retrying", error, retryAttempt });
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flush(), delay);
}

// Reconnect hardening (LIFEOS-025): when the browser comes back online, flush
// anything queued; when it drops offline, say so honestly.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (remote && pending) {
      setHealth({ state: "syncing" });
      void flush();
    } else if (remote) {
      setHealth({ state: "synced" });
    }
  });
  window.addEventListener("offline", () => {
    if (remote) setHealth({ state: "offline" });
  });
}

/** Diagnostics (LIFEOS-021, Phase 8): current dirty domains + sync-queue state. */
export function getSyncDiagnostics(): { dirtyDomains: string[]; queued: boolean; hasBaseline: boolean; mode: string } {
  const dirty = lastSaved ? dirtyDomainsOf(lastSaved, lastSyncedState) : new Set<string>();
  return {
    dirtyDomains: [...dirty] as string[],
    queued: pending !== null,
    hasBaseline: lastSyncedState !== null,
    mode: remote ? "supabase" : "local",
  };
}

/** Retry a failed sync by re-pushing the latest local state (manual). */
export async function retrySync(): Promise<void> {
  if (!remote || !lastSaved) return;
  pending = lastSaved;
  retryAttempt = 0; // a manual retry re-arms the automatic backoff cycle
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  setHealth({ state: "syncing" });
  await flush();
}

// ---------------- init + auth-driven remote enable/disable ----------------

let listenerSet = false;

/**
 * Called once client-side after local hydration. Configures the auth
 * listener (email identity only). Remote sync is enabled ONLY when a
 * durable, email-verified session exists — never for anonymous or
 * signed-out states. `replaceState` swaps the in-memory store to adopted
 * remote data.
 */
export async function initPersistence(
  replaceState: (s: StoreState) => void,
): Promise<void> {
  if (!isSupabaseConfigured()) {
    authStore.setUnconfigured();
    setHealth({ mode: "local", state: "disabled" });
    return;
  }
  const client = getSupabaseClient();
  if (!client) {
    authStore.setUnconfigured();
    setHealth({ mode: "local", state: "disabled" });
    return;
  }
  authStore.setConfigured();

  if (listenerSet) return;
  listenerSet = true;
  // Fires INITIAL_SESSION immediately, then on every sign-in/out.
  client.auth.onAuthStateChange((_event, session) => {
    void handleSession(session, replaceState);
  });
}

async function handleSession(
  session: Session | null,
  replaceState: (s: StoreState) => void,
): Promise<void> {
  authStore.applySession(session);

  if (!session) {
    // Signed out (or never signed in): local-only. Keep local data.
    remote = null;
    setHealth({ mode: "local", state: "disabled" });
    return;
  }

  const client = getSupabaseClient();
  if (!client) return;
  remote = new SupabasePersistenceAdapter(client);
  setHealth({ mode: "supabase", state: "syncing" });
  adoptionSettled = false; // gate pushes until the adopt/migrate decision lands
  try {
    await migrateOrAdopt(session.user.id, replaceState);
    setHealth({ state: "synced", error: undefined });
  } catch (e) {
    recordSaveError(`Initial sync failed: ${msg(e)}`);
    setHealth({ state: "failed", error: msg(e) });
  } finally {
    adoptionSettled = true;
    if (pending) void flush(); // release anything held by the gate
  }
}

/**
 * Idempotent, wrong-user-safe reconciliation between local and remote:
 *  - remote has data              → adopt remote (source of truth)
 *  - remote empty, local unowned  → migrate local up (this user owns it now)
 *  - remote empty, local is ours  → re-push local (idempotent)
 *  - remote empty, local is someone else's → do NOT migrate; start clean for
 *    this user (their data is elsewhere; nothing is deleted from remote)
 */
async function migrateOrAdopt(
  userId: string,
  replaceState: (s: StoreState) => void,
): Promise<void> {
  if (!remote) return;
  const remoteState = await remote.loadState();
  const local = loadState();
  const migratedFor = readMigratedFor();

  if (hasData(remoteState)) {
    replaceState(normalize(remoteState));
    writeMigratedFor(userId);
    return;
  }
  if (!migratedFor || migratedFor === userId) {
    if (hasData(local)) await remote.saveState(normalize(local));
    writeMigratedFor(userId);
    return;
  }
  // Local data belongs to a different account — never migrate it into this one.
  replaceState(normalize(null));
  writeMigratedFor(userId);
}

function readMigratedFor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MIGRATED_KEY);
  } catch {
    return null;
  }
}
function writeMigratedFor(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIGRATED_KEY, userId);
  } catch {
    // no-op
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}
