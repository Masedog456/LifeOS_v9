/**
 * Sync schema constants & record versioning (LIFEOS-033, Feature 1).
 *
 * Records already carry `updatedAt` (an ISO timestamp, server-preferred when the
 * adapter supplies it). We derive a monotonic-ish `revision` from it for display
 * and coarse ordering, but conflict DECISIONS are made structurally (three-way
 * diff), never by client clock alone. This module centralizes the version
 * constants so nothing hard-codes them.
 */

/** Current persisted local StoreState schema version (see lib/migrations). */
export const STATE_SCHEMA_VERSION = 1;

/** A record's revision label, derived from its server/updated timestamp. */
export function recordRevision(rec: { updatedAt?: string; createdAt?: string }): number {
  const t = Date.parse(rec.updatedAt ?? rec.createdAt ?? "");
  return Number.isNaN(t) ? 0 : t;
}

/** Prefer a server timestamp when present; fall back to the client value. */
export function effectiveUpdatedAt(rec: { updatedAt?: string; serverUpdatedAt?: string }): string {
  return rec.serverUpdatedAt ?? rec.updatedAt ?? "";
}
