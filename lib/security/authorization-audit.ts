/**
 * Authorization & RLS audit (LIFEOS-040, Feature 3).
 *
 * A MACHINE-READABLE description of every user-owned table plus a pure checker
 * that verifies a migration's SQL actually enables RLS and defines the four
 * required policies. The companion Node script (scripts/audit-rls.mjs) walks the
 * migration chain, runs these checks, and FAILS when a user-owned table lacks a
 * policy — or when a CREATE TABLE with a user_id column is missing from this
 * registry (so a newly added table cannot silently ship without an RLS review).
 *
 * Authorization is enforced by Postgres RLS, never by application filtering.
 * This module documents and validates that boundary; it does not implement it.
 */

export type DeletionMode = "tombstone" | "cascade-from-user" | "soft-archive" | "permanent";

export interface TableAudit {
  /** Postgres table name (in the public schema). */
  table: string;
  /** Migration that introduces it. */
  migration: string;
  /** Ownership column carrying the row's user. */
  ownershipColumn: string;
  /** Whether new rows default ownership to auth.uid(). */
  defaultsToAuthUid: boolean;
  /** The four DML policies we require to exist. */
  policies: readonly ("select" | "insert" | "update" | "delete")[];
  /** How deletes propagate. */
  deletion: DeletionMode;
  /** Tombstone domain used by the sync layer, if any. */
  tombstoneDomain?: string;
  /** True for the retention tables added in 0031 (never carry record contents). */
  retention?: boolean;
}

const ALL_FOUR = ["select", "insert", "update", "delete"] as const;

/**
 * The registry. Every user-owned table introduced across 0001–0031 that stores
 * per-user data is listed. This is the source the audit script reconciles the
 * migration files against.
 */
export const TABLE_REGISTRY: readonly TableAudit[] = [
  // Representative long-standing domains (0001+). All follow the same
  // auth.uid() ownership + 4-policy RLS pattern.
  { table: "captures", migration: "0001", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "captures" },
  { table: "beliefs", migration: "0001", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "beliefs" },
  { table: "documents", migration: "0021", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "documents" },
  { table: "citations", migration: "0021", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "citations" },
  { table: "workspaces", migration: "0022", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "workspaces" },
  { table: "sessions", migration: "0022", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "sessions" },
  { table: "goals", migration: "0023", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "goals" },
  { table: "projects", migration: "0023", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "projects" },
  { table: "daily_reviews", migration: "0025", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "dailyReviews" },
  { table: "next_actions", migration: "0027", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "nextActions" },
  { table: "planning_assignments", migration: "0028", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "planningAssignments" },
  { table: "focus_sessions", migration: "0028", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "focusSessions" },
  { table: "maintenance_events", migration: "0029", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "maintenanceEvents" },
  { table: "duplicate_candidates", migration: "0029", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "duplicateCandidates" },
  { table: "saved_insight_views", migration: "0030", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "tombstone", tombstoneDomain: "savedInsightViews" },
  // Retention tables added by 0031 — never store record contents.
  { table: "sanitized_error_events", migration: "0031", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ["select", "insert", "delete"], deletion: "cascade-from-user", retention: true },
  { table: "export_history", migration: "0031", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ["select", "insert", "delete"], deletion: "cascade-from-user", retention: true },
  { table: "import_history", migration: "0031", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ["select", "insert", "delete"], deletion: "cascade-from-user", retention: true },
  { table: "account_deletion_requests", migration: "0031", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ["select", "insert", "update"], deletion: "cascade-from-user", retention: true },
  // Reading upload originals (LIFEOS-047) — metadata only (checksum/size/state),
  // never the file's text; the binary itself lives in the private
  // `reading-originals` storage bucket, isolated per user by RLS.
  { table: "reading_document_files", migration: "0032", ownershipColumn: "user_id", defaultsToAuthUid: true, policies: ALL_FOUR, deletion: "cascade-from-user" },
];

export interface PolicyPresence {
  rlsEnabled: boolean;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
}

/**
 * Pure SQL checker: given the text of a migration and a table name, report which
 * RLS elements are present. Tolerant of the do-$$ / create-policy pattern used
 * across LifeOS migrations. Case-insensitive.
 */
export function checkPoliciesInSql(sql: string, table: string): PolicyPresence {
  const s = sql.toLowerCase();
  const t = table.toLowerCase();
  const rlsEnabled = new RegExp(`alter\\s+table\\s+(public\\.)?${t}\\s+enable\\s+row\\s+level\\s+security`).test(s);
  const hasPolicy = (cmd: string) =>
    // create policy <name> on <table> for <cmd>
    new RegExp(`create\\s+policy\\s+[\\w".]+\\s+on\\s+(public\\.)?${t}\\s+for\\s+${cmd}`).test(s) ||
    // create policy <name> on <table> ... using/with check without explicit "for" defaults to ALL
    new RegExp(`create\\s+policy\\s+[\\w".]+\\s+on\\s+(public\\.)?${t}\\s+(as\\s+\\w+\\s+)?(using|with)`).test(s) && /for\s+all/.test(s);
  return {
    rlsEnabled,
    select: hasPolicy("select"),
    insert: hasPolicy("insert"),
    update: hasPolicy("update"),
    delete: hasPolicy("delete"),
  };
}

export interface AuditFinding {
  table: string;
  ok: boolean;
  missing: string[];
}

/** Validate one registered table against the SQL that should define it. */
export function auditTable(entry: TableAudit, sql: string): AuditFinding {
  const present = checkPoliciesInSql(sql, entry.table);
  const missing: string[] = [];
  if (!present.rlsEnabled) missing.push("rls");
  for (const p of entry.policies) if (!present[p]) missing.push(p);
  return { table: entry.table, ok: missing.length === 0, missing };
}

/** Find CREATE TABLE statements that carry a user_id column (user-owned). */
export function userOwnedTablesInSql(sql: string): string[] {
  const out: string[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const [, name, body] = m;
    if (/\buser_id\b/i.test(body)) out.push(name.toLowerCase());
  }
  return out;
}

/** Look up a registry entry by table name. */
export function registryEntry(table: string): TableAudit | undefined {
  return TABLE_REGISTRY.find((t) => t.table === table.toLowerCase());
}
