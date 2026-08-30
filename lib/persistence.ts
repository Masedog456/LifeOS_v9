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
import type { PersistenceHealth, SyncState } from "@/lib/adapters/types";
import { reconcileAdoption, snapshotHasData, suppressDeleted } from "@/lib/persistence-reconcile";
import * as authStore from "@/lib/authStore";
import { markBootstrap } from "@/lib/security/auth-bootstrap";
import { INTERVIEW_STORAGE_KEY } from "@/lib/interview/session";
import { STORE_DOMAINS, emptyStoreState } from "@/lib/ux/backup";
import { purgeConflicts } from "@/lib/sync/conflicts-store";

const STORAGE_KEY = "lifeos.mvp.v1";
const MIGRATED_KEY = "lifeos.migrated.v1";
/** Where a corrupt local blob is preserved before starting clean (LIFEOS-025). */
const CORRUPT_BACKUP_KEY = "lifeos.mvp.v1.corrupt";
/**
 * The last FULLY successful remote push, per device (LIFEOS-076 §5).
 *
 * Runtime-only until now, so every reload reported "Not yet synced" even when
 * the account had synced minutes earlier — and the honest thing to do with an
 * unknown time was to omit it, which is what /health did. This key makes the
 * fact survive a reload without inventing it.
 *
 * Deliberately NOT a StoreState domain and never pushed: it describes THIS
 * device's relationship with the server, not the user's life. A second device
 * has its own answer, and syncing one device's clock reading to another would
 * be a new way to lie. Written only when zero domains failed.
 */
const LAST_SYNC_KEY = "lifeos.lastSync.v1";

let remote: SupabasePersistenceAdapter | null = null;
let lastSaved: StoreState | null = null;
/** The state at the last successful remote flush — for dirty-domain diffing. */
let lastSyncedState: StoreState | null = null;
/** ISO time of the last successful remote flush (LIFEOS-032 diagnostics). */
let lastSyncAt: string | null = readLastSyncAt();

/**
 * The persisted last-success time, or null when absent or unusable.
 *
 * A malformed value is treated as absent rather than repaired or displayed:
 * showing a wrong "last synced" is worse than showing none (LIFEOS-076 §5).
 */
function readLastSyncAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    // A timestamp from the future is not a clock we can reason about.
    if (t > Date.now() + 60_000) return null;
    return new Date(t).toISOString();
  } catch {
    return null;
  }
}

/** Record a CONFIRMED full sync. Never called for incomplete, failed or local. */
function writeLastSyncAt(at: string): void {
  lastSyncAt = at;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SYNC_KEY, at);
  } catch {
    // Quota or a blocked store: the in-memory value still serves this session.
  }
}
/** Domains whose last push attempt failed (LIFEOS-074 D-22). Runtime only — no
 *  new persisted domain and no migration; a reload re-derives it on next push. */
let failedDomains: string[] = [];
/** False when the last adoption could not read the deletion ledger at all
 *  (LIFEOS-074 D-24). Surfaced in diagnostics; never treated as "nothing was
 *  deleted", which is the assumption that produced the defect. */
let tombstonesReadable = true;

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
  lastSyncAt: null,
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
  // LIFEOS-076 §5: the timestamp is written by `flush` when a push actually
  // confirms, and by nothing else. This used to mint one here on any transition
  // into "synced" — including the adoption path, where nothing had been pushed
  // — so the displayed "last synced" could be the moment the app decided it had
  // nothing to do. A time the server never confirmed is not a sync time.
  health = { ...health, ...next, lastSyncAt };
  listeners.forEach((l) => l());
}

/**
 * Fill every canonical domain, defaulting to an empty array (LIFEOS-075 C-1).
 *
 * This used to be a 46-line literal repeating `STORE_DOMAINS` by hand — a
 * third copy of the domain list, alongside the backup allow-list and
 * `SYNC_DOMAIN_ORDER`. Keys unknown to `STORE_DOMAINS` are dropped, which is
 * the same allow-list behaviour `upgradeState` already applies on restore.
 */
function normalize(partial: Partial<StoreState> | null): StoreState {
  const out = emptyStoreState() as unknown as Record<string, unknown>;
  if (partial) {
    for (const d of STORE_DOMAINS as string[]) {
      const v = (partial as unknown as Record<string, unknown>)[d];
      if (Array.isArray(v)) out[d] = v;
    }
  }
  return out as unknown as StoreState;
}

/**
 * Whether a snapshot holds any of the user's records at all (LIFEOS-075 C-1).
 *
 * Delegated to the canonical, `STORE_DOMAINS`-derived predicate rather than
 * re-listing domains here. See `snapshotHasData` for why the previous
 * four-domain version cost a cold second device its entire account.
 */
const hasData = snapshotHasData;

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

function writeLocal(state: StoreState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (health.localError) setHealth({ localError: undefined });
    return true;
  } catch (e) {
    // Silent-save-failure hardening (LIFEOS-025): a quota/serialization error
    // is no longer swallowed — it is surfaced on the indicator and logged.
    const m = `Local save failed: ${msg(e)}`;
    recordSaveError(m);
    setHealth({ localError: m });
    return false;
  }
}

/**
 * Try again to write the latest state to THIS DEVICE (LIFEOS-076 §4 / E-2).
 *
 * The audit found "Local save failed" — the one state where the newest change
 * may not survive a refresh — offering no action at all. It is also the one
 * state where the obvious instinct, "reload the page", is precisely what
 * destroys the work.
 *
 * A retry is genuinely possible: the failed state is still in memory as
 * `lastSaved`, and the usual cause is a transient quota condition that clearing
 * another tab or deleting a large draft can relieve. So this re-attempts the
 * LOCAL write and nothing else — it makes no remote claim and triggers no push.
 * `writeLocal` clears `localError` itself on success, so the indicator leaves
 * the alarming state only when a durable write actually happened.
 *
 * Returns false when there is nothing to retry (nothing has been saved yet) or
 * the write failed again — the caller must not report success either way.
 */
export function retryLocalSave(): boolean {
  if (!lastSaved) return false;
  return writeLocal(lastSaved);
}

/** Is there an in-memory state that a local retry could write? */
export function canRetryLocalSave(): boolean {
  return lastSaved !== null;
}

/**
 * Are there changes this device has NOT had confirmed by the server?
 *
 * Used by the status popover and the sign-out warning (LIFEOS-076 §8). True
 * whenever remote sync is active and something is still dirty or failed —
 * deliberately false in local-only mode, where "unsynced" is not a meaningful
 * warning because nothing was ever going to sync.
 */
export function hasUnsyncedChanges(): boolean {
  if (!remote) return false;
  if (failedDomains.length > 0 || pending !== null) return true;
  return lastSaved ? dirtyDomainsOf(lastSaved, lastSyncedState).size > 0 : false;
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
      // The Constitution Builder keeps its in-flight answers in their own local
      // key rather than in StoreState (LIFEOS-058) — deliberately, so they are
      // never synced or exported. That decision only holds if wiping local data
      // takes them too: an unfinished answer about someone's marriage or faith
      // must not outlive the account on this machine.
      window.localStorage.removeItem(INTERVIEW_STORAGE_KEY);
      // The device's own sync clock is meaningless once its data is gone, and
      // leaving it behind would let a fresh start claim a sync that never
      // happened for the new content (LIFEOS-076 §5).
      window.localStorage.removeItem(LAST_SYNC_KEY);
    } catch {
      // no-op
    }
  }
  // A rejected write is evidence about ONE account's row on THIS device. Once
  // the account's data is gone the local half is meaningless, and worse, an
  // orphaned conflict would offer to re-apply a previous user's text into a
  // different session (LIFEOS-076 §8).
  purgeConflicts();
  lastSaved = null;
  lastSyncedState = null;
  lastSyncAt = null;
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
    const report = await remote.saveStateByDomain(snapshot, dirty, lastSyncedState);

    // ---- advance the baseline PER DOMAIN (LIFEOS-074 D-22) ----------------
    //
    // The baseline is what `dirtyDomainsOf` diffs against, and it diffs by
    // array REFERENCE per top-level key. So "this domain is now clean" is
    // expressed by taking that domain's array from the snapshot we just
    // pushed, and "this one is still dirty" by leaving the previous baseline
    // value in place. No new bookkeeping structure, and a failed domain stays
    // dirty for exactly as long as it keeps failing.
    //
    // The domains come from the SNAPSHOT, never from `pending`: a mutation that
    // lands mid-flush must stay dirty even in a domain that just synced, or the
    // successful push of the older value would silently clear the newer one.
    lastSyncedState = nextBaseline(lastSyncedState, snapshot, report.succeeded);
    failedDomains = report.failed.map((f) => f.domain);

    if (report.failed.length === 0) {
      writeLastSyncAt(new Date().toISOString());
      retryAttempt = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      setHealth({ state: "synced", error: undefined, retryAttempt: undefined, failedDomains: undefined });
    } else {
      // PARTIAL. Some rows are durable remotely and some are not, and saying
      // "Saved" here is the false success this whole repair exists to prevent.
      const detail = `${report.failed.length} of ${report.attempted.length} domain(s) failed: ${report.failed.map((f) => `${f.domain} (${f.error})`).join("; ")}`;
      recordSaveError(`Remote sync incomplete: ${detail}`);
      if (!pending) pending = snapshot;
      scheduleAutoRetry(detail, "incomplete");
    }
  } catch (e) {
    // `saveStateByDomain` does not throw per domain, so reaching here means the
    // run itself broke (an adapter without the isolated method, a client that
    // threw outside a domain). Treat it as a total failure, as before.
    recordSaveError(`Remote sync failed: ${msg(e)}`);
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

/**
 * The sync baseline after a partial push: succeeded domains adopt the pushed
 * snapshot, everything else keeps whatever it had (LIFEOS-074 D-22).
 *
 * When there was no baseline at all, a domain that did NOT succeed gets a fresh
 * empty array — reference-unequal to the snapshot's array, so it reads as dirty
 * rather than as "synced and empty".
 */
function nextBaseline(base: StoreState | null, snapshot: StoreState, succeeded: string[]): StoreState {
  const done = new Set(succeeded);
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(snapshot)) {
    if (done.has(key)) out[key] = (snapshot as unknown as Record<string, unknown>)[key];
    else if (base) out[key] = (base as unknown as Record<string, unknown>)[key];
    else out[key] = [];
  }
  return out as unknown as StoreState;
}

/**
 * `exhausted` is the state to settle on once automatic retries run out.
 *
 * A partial run settles on "incomplete", not "failed" (LIFEOS-074 D-22): some
 * domains ARE durable remotely, and flattening that to a bare failure is as
 * untrue in the pessimistic direction as "Saved" was in the optimistic one.
 */
function scheduleAutoRetry(error: string, exhausted: SyncState = "failed"): void {
  if (retryAttempt >= MAX_AUTO_RETRIES) {
    // Give up automatically retrying; the user can still retry by hand and
    // every new write re-arms the cycle. Local data is safe throughout.
    setHealth({ state: exhausted, error, retryAttempt: undefined, failedDomains: failedDomains.length ? [...failedDomains] : undefined });
    retryAttempt = 0;
    return;
  }
  retryAttempt += 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** (retryAttempt - 1), RETRY_MAX_MS);
  setHealth({ state: "retrying", error, retryAttempt, failedDomains: failedDomains.length ? [...failedDomains] : undefined });
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

/**
 * Test seams for the D-22 isolation pins (LIFEOS-074 §8).
 *
 * The flush loop, the per-domain baseline and the health transitions are the
 * thing under test, so the pins have to drive THIS module rather than a
 * reimplementation of it — and `remote` is otherwise only reachable through a
 * real authenticated Supabase session. These three change no behaviour: they
 * install an adapter, run one flush synchronously, and read the dirty set.
 * Nothing in the app calls them.
 */
export function __setRemoteForTest(adapter: SupabasePersistenceAdapter | null): void {
  remote = adapter;
  lastSyncedState = null;
  lastSyncAt = null;
  failedDomains = [];
  retryAttempt = 0;
  adoptionSettled = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  if (timer) { clearTimeout(timer); timer = undefined; }
  health = { mode: "supabase", state: "syncing", lastSyncAt: null };
}
export async function __flushNowForTest(state: StoreState): Promise<void> {
  pending = state;
  lastSaved = state;
  await flush();
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
  if (timer) { clearTimeout(timer); timer = undefined; }
}
/** Drive the live health store, so the RENDERED indicator can be measured in
 *  each state (LIFEOS-074 D-22 §9). Used by the /dev/sync-tests harness. */
export function __setHealthForTest(next: Partial<PersistenceHealth>): void {
  setHealth(next);
}
export function __dirtyAgainstForTest(state: StoreState): string[] {
  return [...dirtyDomainsOf(state, lastSyncedState)] as string[];
}

/** Diagnostics (LIFEOS-021, Phase 8): current dirty domains + sync-queue state. */
export function getSyncDiagnostics(): { dirtyDomains: string[]; failedDomains: string[]; tombstonesReadable: boolean; queued: boolean; hasBaseline: boolean; mode: string } {
  const dirty = lastSaved ? dirtyDomainsOf(lastSaved, lastSyncedState) : new Set<string>();
  return {
    dirtyDomains: [...dirty] as string[],
    // Which domains the LAST push could not write, as opposed to which are
    // merely unsent (LIFEOS-074 D-22).
    failedDomains: [...failedDomains],
    tombstonesReadable,
    queued: pending !== null,
    hasBaseline: lastSyncedState !== null,
    mode: remote ? "supabase" : "local",
  };
}

/** ISO time of the last successful remote flush, or null (LIFEOS-032). */
export function getLastSyncAt(): string | null {
  return lastSyncAt;
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
/** Startup resolves the session exactly once — see `initPersistence`. */
let initialSessionHandled = false;

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
  markBootstrap({ bootstrapStarted: true });

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
  markBootstrap({ supabaseConfigured: true });

  if (listenerSet) return;
  listenerSet = true;

  // 1. Register the listener FIRST, so a sign-in that completes while we are
  //    reading the current session cannot slip between the two steps.
  //
  //    `INITIAL_SESSION` and the explicit read below describe the SAME startup
  //    session, so exactly one of them may drive adoption — running
  //    `migrateOrAdopt` twice over one sign-in would race two `replaceState`
  //    calls against each other. Whichever arrives first claims it; later
  //    sign-in / sign-out / refresh events are unaffected.
  client.auth.onAuthStateChange((event, session) => {
    markBootstrap({ initialSessionReceived: true, sessionPresent: !!session });
    if (event === "INITIAL_SESSION") {
      if (initialSessionHandled) return;
      initialSessionHandled = true;
    }
    void queueSession(session, replaceState);
  });
  markBootstrap({ listenerRegistered: true });

  // 2. Then ASK for the session explicitly.
  //
  //    This is the repair. Previously the only thing that could ever clear
  //    `loading` in the configured path was `applySession`, reachable only from
  //    the callback above — so the entire signed-out UI depended on an
  //    `INITIAL_SESSION` event the app never actually requested. When that event
  //    was slow or never arrived, the header sat in `loading` forever: no "Get
  //    started", no email field, no error. `getSession()` is the smallest
  //    supported way to resolve the current session deterministically, and it
  //    introduces no second identity system.
  try {
    const { data, error } = await withTimeout(client.auth.getSession(), AUTH_BOOTSTRAP_TIMEOUT_MS);
    if (error) throw new Error("getSession_error");
    markBootstrap({ initialSessionReceived: true, sessionPresent: !!data?.session });
    if (initialSessionHandled) {
      // The listener got there first; just wait for its work to finish.
      await sessionChain;
    } else {
      initialSessionHandled = true;
      await queueSession(data?.session ?? null, replaceState);
    }
  } catch (e) {
    // 3. Fail HONESTLY rather than sitting silently in "Saved locally". The
    //    sign-in control still renders, so the person can always act.
    const label = e instanceof Error && e.message === "auth_timeout" ? "auth_timeout" : "getsession_failed";
    markBootstrap({ resolvedByFallback: true, failure: label });
    authStore.setAuthUnavailable("Couldn't check your sign-in status. You can still sign in.");
    setHealth({ mode: "local", state: "disabled" });
  }
}

/** Startup must never hang on a network call; the UI has to resolve. */
export const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

/**
 * Session handling is serialized. Two overlapping `migrateOrAdopt` runs would
 * interleave their `replaceState` calls, so each session is applied in turn.
 * A rejection is absorbed here because `handleSession` already records failures
 * in health; it must not break the chain for the next event.
 */
let sessionChain: Promise<void> = Promise.resolve();
function queueSession(
  session: Session | null,
  replaceState: (s: StoreState) => void,
): Promise<void> {
  sessionChain = sessionChain.then(() => handleSession(session, replaceState)).catch(() => {});
  return sessionChain;
}

/** Reject with `auth_timeout` if a promise does not settle in time. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("auth_timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
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
    // Only claim "synced" when there is nothing left to push. If adoption kept
    // local-only records (e.g. a capture typed during sign-in), a push is queued
    // and the released flush reports synced/failed honestly — we must not say
    // "Saved" before that write is confirmed.
    if (!pending) setHealth({ state: "synced", error: undefined });
  } catch (e) {
    recordSaveError(`Initial sync failed: ${msg(e)}`);
    setHealth({ state: "failed", error: msg(e) });
  } finally {
    adoptionSettled = true;
    if (pending) void flush(); // release anything held by the gate
  }
}

/**
 * Idempotent, wrong-user-safe, LOCAL-FIRST reconciliation between local and
 * remote. Delegates the decision to the pure `reconcileAdoption`, then installs
 * the result:
 *  - remote has data              → adopt remote, but MERGE local-only records
 *                                   (a capture typed during sign-in is never
 *                                   dropped) and push those up.
 *  - remote empty, local is ours  → keep local and push it up.
 *  - remote empty, local is else's → start clean for this user (remote untouched).
 *
 * The critical fix: `local` is read AFTER `remote.loadState()` resolves, so any
 * record created during that async window is included, and adoption merges
 * rather than replaces — so a newly-created Capture is never rolled back on disk
 * or in memory.
 */
async function migrateOrAdopt(
  userId: string,
  replaceState: (s: StoreState) => void,
): Promise<void> {
  if (!remote) return;
  const remoteState = await remote.loadState();
  // The deletion ledger, read on the SAME authoritative path as the snapshot
  // (LIFEOS-074 D-24). Every adoption goes through here — INITIAL_SESSION, a
  // second device, a re-auth — so there is no UI route with its own rules.
  const tombstones = await remote.loadTombstones();
  // Read local AFTER the remote load — this window is exactly when a user can
  // create a capture; it must survive.
  const local = loadState();
  const migratedFor = readMigratedFor();
  const empty = normalize(null);

  // Suppress BEFORE reconciling. Doing it afterwards would still let a record
  // deleted elsewhere be marked `pushLocalOnly` and written back, which is what
  // D-24 reproduced. `tombstones === null` means the ledger could not be read at
  // all: suppress nothing (there is no evidence of any deletion) and let the
  // caller report the sync honestly rather than pretend deletion is durable.
  const localNormalized = tombstones ? suppressDeleted(normalize(local), tombstones) : normalize(local);
  tombstonesReadable = tombstones !== null;

  const decision = reconcileAdoption({
    remote: normalize(remoteState),
    local: localNormalized,
    remoteHasData: hasData(remoteState),
    localHasData: hasData(localNormalized),
    migratedFor,
    userId,
    empty,
  });

  // Install the reconciled state locally (writes localStorage, updates the store,
  // baselines lastSyncedState to `decision.state`).
  replaceState(decision.state);
  writeMigratedFor(userId);

  if (decision.pushLocalOnly) {
    // There are local records remote doesn't have yet. Baseline the diff against
    // the confirmed-synced remote so exactly those records are pushed, and queue
    // the push through the normal (debounced + auto-retrying) path — so a failed
    // remote write is retried and NEVER rolls back the durable local copy.
    lastSyncedState = decision.baseline;
    scheduleRemotePush(decision.state);
  }
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
