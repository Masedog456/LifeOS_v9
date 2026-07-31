/**
 * Multi-tab coordination (LIFEOS-040, Feature 23).
 *
 * LifeOS runs the same local-first store in every open tab. We use two
 * browser-native primitives — BroadcastChannel for events and the `storage`
 * event as a fallback — to keep tabs honest about a few safety-critical
 * transitions: sign-out, account-deletion freeze, schema-upgrade in progress,
 * and an import/export lock. This is coordination, NOT realtime collaboration:
 * we broadcast small typed signals, never record contents.
 */

export type TabSignalType =
  | "signed-out"
  | "signed-in"
  | "deletion-freeze"
  | "schema-upgrading"
  | "import-lock"
  | "import-unlock"
  | "export-lock"
  | "export-unlock";

export interface TabSignal {
  type: TabSignalType;
  at: string;
  /** Optional sender tab id (never a user identifier). */
  from?: string;
}

const CHANNEL = "lifeos.tabs.v1";
const STORAGE_PING = "lifeos.tabs.ping.v1";

type Handler = (sig: TabSignal) => void;

let channel: BroadcastChannel | null = null;
const handlers = new Set<Handler>();

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (ev) => {
    const sig = ev.data as TabSignal;
    if (sig && typeof sig.type === "string") handlers.forEach((h) => h(sig));
  };
  return channel;
}

/** Broadcast a signal to other tabs (BroadcastChannel, with a storage fallback). */
export function broadcast(type: TabSignalType, from?: string): void {
  const sig: TabSignal = { type, at: new Date().toISOString(), from };
  const ch = ensureChannel();
  if (ch) {
    ch.postMessage(sig);
    return;
  }
  // Fallback: bump a storage key so other tabs get a `storage` event.
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_PING, JSON.stringify(sig));
  } catch { /* storage may be unavailable */ }
}

/** Subscribe to cross-tab signals. Returns an unsubscribe function. */
export function subscribe(handler: Handler): () => void {
  handlers.add(handler);
  ensureChannel();
  let onStorage: ((e: StorageEvent) => void) | null = null;
  if (typeof window !== "undefined") {
    onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_PING || !e.newValue) return;
      try {
        const sig = JSON.parse(e.newValue) as TabSignal;
        if (sig && typeof sig.type === "string") handler(sig);
      } catch { /* ignore malformed ping */ }
    };
    window.addEventListener("storage", onStorage);
  }
  return () => {
    handlers.delete(handler);
    if (onStorage && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * A tiny lock protocol for import/export. Because tabs share one store, we keep
 * a lock marker in localStorage with an expiry; a stale lock (crashed tab) is
 * reclaimable after `ttlMs`. This is advisory — it prevents two tabs from
 * running a destructive restore at once, not a distributed mutex.
 */
const LOCK_KEY = "lifeos.op.lock.v1";
export interface OpLock { op: "import" | "export"; at: number; ttlMs: number; owner: string }

export function acquireLock(op: "import" | "export", owner: string, ttlMs = 120_000, store?: Storage): boolean {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return true; // no storage → single-context, nothing to coordinate
  try {
    const existing = s.getItem(LOCK_KEY);
    if (existing) {
      const lock = JSON.parse(existing) as OpLock;
      if (lock.at + lock.ttlMs > Date.now() && lock.owner !== owner) return false; // held & fresh
    }
    s.setItem(LOCK_KEY, JSON.stringify({ op, at: Date.now(), ttlMs, owner } as OpLock));
    return true;
  } catch {
    return true;
  }
}

export function releaseLock(owner: string, store?: Storage): void {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return;
  try {
    const existing = s.getItem(LOCK_KEY);
    if (!existing) return;
    const lock = JSON.parse(existing) as OpLock;
    if (lock.owner === owner) s.removeItem(LOCK_KEY);
  } catch { /* ignore */ }
}

export function currentLock(store?: Storage): OpLock | null {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return null;
  try {
    const existing = s.getItem(LOCK_KEY);
    if (!existing) return null;
    const lock = JSON.parse(existing) as OpLock;
    return lock.at + lock.ttlMs > Date.now() ? lock : null;
  } catch {
    return null;
  }
}
