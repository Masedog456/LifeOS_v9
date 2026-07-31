/**
 * Local-storage resilience (LIFEOS-040, Feature 22).
 *
 * Every localStorage touchpoint should route through here so failures are
 * classified, never swallowed. The guiding rule: PREFERENCES may reset safely,
 * but USER CONTENT must never be silently discarded. When storage is
 * unavailable, quota-exceeded, or the blob is malformed, we return a typed
 * result the UI can surface (with export/recovery guidance) instead of throwing
 * deep in a reducer.
 */

import { safeJsonParse } from "@/lib/security/input-limits";

export type StorageStatus = "ok" | "unavailable" | "quota-exceeded" | "corrupt" | "empty";

export interface StorageProbe {
  available: boolean;
  status: StorageStatus;
  detail?: string;
}

/** Detect whether localStorage can be read AND written (private mode fails). */
export function probeStorage(store?: Storage): StorageProbe {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return { available: false, status: "unavailable", detail: "No localStorage in this context." };
  const k = "__lifeos_probe__";
  try {
    s.setItem(k, "1");
    s.removeItem(k);
    return { available: true, status: "ok" };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (/quota/i.test(name) || /quota/i.test(String(e))) return { available: false, status: "quota-exceeded", detail: "Storage quota exceeded." };
    return { available: false, status: "unavailable", detail: "Storage is not writable (private mode?)." };
  }
}

export type ReadResult<T> =
  | { status: "ok"; value: T }
  | { status: "empty" }
  | { status: "corrupt"; error: string }
  | { status: "unavailable"; error: string };

/**
 * Read + parse a JSON blob. A CORRUPT blob is reported (never thrown, never
 * silently replaced) so a caller can decide whether it holds user content
 * (quarantine it) or only preferences (reset safely).
 */
export function readJson<T = unknown>(key: string, store?: Storage): ReadResult<T> {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return { status: "unavailable", error: "No localStorage." };
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch (e) {
    return { status: "unavailable", error: e instanceof Error ? e.message : "read failed" };
  }
  if (raw == null) return { status: "empty" };
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return { status: "corrupt", error: parsed.error };
  return { status: "ok", value: parsed.value as T };
}

export type WriteResult = { status: "ok" } | { status: "quota-exceeded"; error: string } | { status: "unavailable"; error: string };

/** Write a JSON blob. Quota errors are reported so the UI can prompt an export. */
export function writeJson(key: string, value: unknown, store?: Storage): WriteResult {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return { status: "unavailable", error: "No localStorage." };
  try {
    s.setItem(key, JSON.stringify(value));
    return { status: "ok" };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (/quota/i.test(name) || /quota|exceeded/i.test(String(e))) {
      return { status: "quota-exceeded", error: "Local storage is full. Export a backup, then remove old data." };
    }
    return { status: "unavailable", error: "Could not save locally (private mode or storage disabled)." };
  }
}

/**
 * Quarantine a corrupt blob under a timestamped key so its bytes are preserved
 * for recovery instead of being overwritten. Returns the quarantine key or null.
 */
export function quarantineCorrupt(key: string, store?: Storage): string | null {
  const s = store ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (raw == null) return null;
    const qkey = `${key}.corrupt.${Date.now()}`;
    s.setItem(qkey, raw);
    return qkey;
  } catch {
    return null;
  }
}

/** Whether a key holds user content (quarantine on corruption) vs prefs (reset ok). */
export function isUserContentKey(key: string): boolean {
  return key === "lifeos.mvp.v1" || key.startsWith("lifeos.mvp.");
}
