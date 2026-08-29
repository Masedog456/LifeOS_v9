/**
 * Tombstones & delete integrity (LIFEOS-033, Feature 5).
 *
 * A tombstone records that a record was deleted, so a stale device that still
 * holds an old copy cannot silently RESURRECT it on the next sync. A tombstone
 * suppresses a record only when the deletion is newer than the record's own
 * `updatedAt` — an edit made AFTER the delete (a genuine resurrection intent)
 * still surfaces as a delete-vs-edit conflict instead. Privacy-safe: a tombstone
 * stores only `{domain, recordId, deletedAt}` — never the deleted content.
 * Retention is bounded; old tombstones are cleaned up. Pure and deterministic.
 *
 * ## Wired into adoption by LIFEOS-074 (D-24)
 *
 * For three sprints nothing called this. `applyTombstones` had no caller and
 * `loadState` never selected `sync_tombstones`, so the table was write-only and
 * the suppression below never ran — a record deleted on one device was
 * resurrected by any other client that still held it. `SupabasePersistenceAdapter.loadTombstones`
 * now reads the ledger and `suppressDeleted` in `lib/persistence-reconcile.ts`
 * applies these functions before adoption can push a stale record back.
 *
 * `cleanupTombstones` below remains deliberately UNWIRED: tombstones are
 * permanent today, which is the conservative choice — an expired marker would
 * let an old client resurrect a record again, and inventing a retention policy
 * was out of scope for the repair.
 */

export interface Tombstone {
  domain: string;
  recordId: string;
  deletedAt: string; // ISO
}

const key = (domain: string, id: string) => `${domain}:${id}`;

export function makeTombstone(domain: string, recordId: string, deletedAt: string): Tombstone {
  return { domain, recordId, deletedAt };
}

/** Whether a tombstone should suppress a (re-appearing) record. */
export function shouldSuppress(t: Tombstone, rec: { updatedAt?: string; createdAt?: string }): boolean {
  const recAt = Date.parse(rec.updatedAt ?? rec.createdAt ?? "");
  const delAt = Date.parse(t.deletedAt);
  if (Number.isNaN(delAt)) return false;
  if (Number.isNaN(recAt)) return true; // no timestamp → treat delete as authoritative
  return delAt >= recAt; // deleted at/after the record's last edit → stay deleted
}

/**
 * Filter a domain's records against tombstones, removing resurrected ones.
 * Returns the surviving records plus the ids that were suppressed and the ids
 * that are "resurrection conflicts" (edited AFTER the delete).
 */
export function applyTombstones(domain: string, records: { id: string; updatedAt?: string; createdAt?: string }[], tombstones: Tombstone[]): {
  survivors: { id: string; updatedAt?: string }[];
  suppressed: string[];
  resurrected: string[];
} {
  const tomb = new Map(tombstones.filter((t) => t.domain === domain).map((t) => [t.recordId, t]));
  const survivors: { id: string; updatedAt?: string }[] = [];
  const suppressed: string[] = [];
  const resurrected: string[] = [];
  for (const r of records) {
    const t = tomb.get(r.id);
    if (!t) { survivors.push(r); continue; }
    if (shouldSuppress(t, r)) suppressed.push(r.id);
    else { survivors.push(r); resurrected.push(r.id); }
  }
  return { survivors, suppressed, resurrected };
}

/** A record deleted since the base snapshot → its tombstone (for the journal/remote). */
export function tombstonesForDeletions(domain: string, base: { id: string }[], current: { id: string }[], deletedAt: string): Tombstone[] {
  const curIds = new Set(current.map((r) => r.id));
  return base.filter((r) => !curIds.has(r.id)).map((r) => makeTombstone(domain, r.id, deletedAt));
}

export const DEFAULT_RETENTION_DAYS = 90;

/** Drop tombstones older than the retention window (cleanup). */
export function cleanupTombstones(tombstones: Tombstone[], nowMs = Date.now(), retentionDays = DEFAULT_RETENTION_DAYS): Tombstone[] {
  const cutoff = nowMs - retentionDays * 86400000;
  return tombstones.filter((t) => Date.parse(t.deletedAt) >= cutoff);
}

/** Merge two tombstone sets, keeping the latest deletedAt per record. */
export function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const k = key(t.domain, t.recordId);
    const prev = map.get(k);
    if (!prev || Date.parse(t.deletedAt) > Date.parse(prev.deletedAt)) map.set(k, t);
  }
  return [...map.values()];
}
