/**
 * Recent history & pinning (LIFEOS-027).
 *
 * Both are lists of record REFERENCES (kind + id + a cached title), stored in
 * per-user `prefs` (localStorage + best-effort `user_prefs` mirror when signed
 * in) — no new table, no domain-blob pollution, no analytics. On read, each ref
 * is reconciled against the live store so:
 *   - deleted records silently disappear,
 *   - renamed records show their current title + href,
 *   - there are never duplicate entries (deduped by kind+id).
 * Recent is capped and most-recent-first; pinned is ordered by pin time
 * (deterministic).
 */

import type { StoreState } from "@/types/mvp";
import { readPrefs, writePrefs, type RecordRef } from "@/lib/prefs";
import { resolveRecord } from "@/lib/command/records";
import type { PinnedItem, RecentItem } from "@/lib/command/types";

export const RECENT_CAP = 20;

const dedupeKey = (r: RecordRef): string => `${r.kind}:${r.id}`;

/** Record that a record was just opened. Moves it to the top; caps the list. */
export function recordVisit(kind: string, id: string, title: string, now: number = Date.now()): void {
  if (!kind || !id) return;
  const at = new Date(now).toISOString();
  const prev = readPrefs().recent ?? [];
  const key = `${kind}:${id}`;
  const next: RecordRef[] = [{ kind, id, title, at }, ...prev.filter((r) => dedupeKey(r) !== key)].slice(0, RECENT_CAP);
  writePrefs({ recent: next });
}

/** Live recent list: stored refs reconciled against the store (renames/deletes). */
export function getRecent(state: StoreState): RecentItem[] {
  const stored = readPrefs().recent ?? [];
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const r of stored) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    const live = resolveRecord(state, r.kind, r.id);
    if (!live) continue; // deleted → drop
    seen.add(key);
    out.push({ kind: r.kind, id: r.id, title: live.title, at: r.at });
  }
  return out;
}

/** Is this record pinned? */
export function isPinned(kind: string, id: string): boolean {
  return (readPrefs().pinned ?? []).some((p) => p.kind === kind && p.id === id);
}

/** Toggle a record's pin. Returns the new pinned state. Idempotent per call. */
export function togglePin(kind: string, id: string, title: string, now: number = Date.now()): boolean {
  const prev = readPrefs().pinned ?? [];
  const key = `${kind}:${id}`;
  const exists = prev.some((p) => dedupeKey(p) === key);
  if (exists) {
    writePrefs({ pinned: prev.filter((p) => dedupeKey(p) !== key) });
    return false;
  }
  const next: RecordRef[] = [...prev, { kind, id, title, at: new Date(now).toISOString() }];
  writePrefs({ pinned: next });
  return true;
}

/** Live pinned list: stored refs reconciled against the store, ordered by pin time. */
export function getPinned(state: StoreState): PinnedItem[] {
  const stored = readPrefs().pinned ?? [];
  const seen = new Set<string>();
  const out: PinnedItem[] = [];
  for (const p of stored) {
    const key = dedupeKey(p);
    if (seen.has(key)) continue;
    const live = resolveRecord(state, p.kind, p.id);
    if (!live) continue;
    seen.add(key);
    out.push({ kind: p.kind, id: p.id, title: live.title, at: p.at });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1)));
  return out;
}

/**
 * Pure helpers (no I/O) — the deterministic core the self-tests exercise
 * directly, so the reconciliation/dedupe/cap logic is verifiable without a
 * store or localStorage.
 */
export function applyVisit(prev: RecordRef[], ref: RecordRef, cap = RECENT_CAP): RecordRef[] {
  const key = `${ref.kind}:${ref.id}`;
  return [ref, ...prev.filter((r) => dedupeKey(r) !== key)].slice(0, cap);
}
export function applyToggle(prev: RecordRef[], ref: RecordRef): { next: RecordRef[]; pinned: boolean } {
  const key = `${ref.kind}:${ref.id}`;
  if (prev.some((p) => dedupeKey(p) === key)) return { next: prev.filter((p) => dedupeKey(p) !== key), pinned: false };
  return { next: [...prev, ref], pinned: true };
}
export function reconcile(refs: RecordRef[], resolve: (kind: string, id: string) => { title: string } | undefined): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  for (const r of refs) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    const live = resolve(r.kind, r.id);
    if (!live) continue;
    seen.add(key);
    out.push({ ...r, title: live.title });
  }
  return out;
}
