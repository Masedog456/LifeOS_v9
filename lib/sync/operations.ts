/**
 * Idempotent mutation identity (LIFEOS-033, Feature 7).
 *
 * Every remote mutation gets a STABLE operation id so a retried write cannot
 * create duplicates or replay a destructive op incorrectly. Because all domains
 * are keyed by record `id` and synced via upsert, an insert/update replay is a
 * no-op upsert; a delete replay targets an already-absent id (harmless). The
 * operation id lets the journal dedupe attempts and lets diagnostics count
 * distinct pending work. Pure and deterministic — the same mutation always
 * yields the same id (content-addressed by domain+id+type+revision).
 */

export type MutationType = "insert" | "update" | "delete" | "import" | "restore" | "session_end" | "milestone_complete";

export interface Operation {
  domain: string;
  recordId: string;
  type: MutationType;
  /** Revision the mutation is based on (record updatedAt ms, or 0). */
  revision: number;
}

/** A stable, content-addressed id for an operation (safe to retry). */
export function operationId(op: Operation): string {
  return `${op.domain}:${op.recordId}:${op.type}:${op.revision}`;
}

/** Deduplicate a list of operations by their stable id (last wins for status). */
export function dedupeOperations(ops: Operation[]): Operation[] {
  const map = new Map<string, Operation>();
  for (const op of ops) map.set(operationId(op), op);
  return [...map.values()];
}

/**
 * Whether applying `op` again is safe given it was already applied. Insert/update
 * are idempotent upserts; delete is idempotent (absent id); import/restore carry
 * their own id so a replay is a no-op. Always true here — documented + tested so
 * the invariant is explicit.
 */
export function isIdempotent(op: Operation): boolean {
  return ["insert", "update", "delete", "import", "restore", "session_end", "milestone_complete"].includes(op.type);
}

/** Apply a set of upsert operations to a keyed collection idempotently. */
export function applyUpserts<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((r) => [r.id, r]));
  for (const r of incoming) map.set(r.id, r); // re-applying the same row is a no-op
  return [...map.values()];
}

/** Apply deletes idempotently (deleting an absent id changes nothing). */
export function applyDeletes<T extends { id: string }>(current: T[], deleteIds: string[]): T[] {
  const drop = new Set(deleteIds);
  return current.filter((r) => !drop.has(r.id));
}
