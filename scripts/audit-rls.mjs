#!/usr/bin/env node
/**
 * RLS / authorization audit (LIFEOS-040, Feature 3).
 *
 * Walks every migration in supabase/migrations, finds each CREATE TABLE that
 * carries a `user_id` column (i.e. a user-owned table), and asserts it enables
 * RLS and defines SELECT/INSERT/DELETE policies (UPDATE where the table is
 * mutable). FAILS (exit 1) when a user-owned table is missing a required policy,
 * so a newly added table cannot ship without an RLS review.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migDir = join(root, "supabase", "migrations");

// Tables that legitimately carry a user_id but are append-only / immutable /
// retention and intentionally omit UPDATE and/or DELETE. These reflect
// deliberate historical design (e.g. reflections has a before-update
// immutability trigger; retrieval_feedback is an append-only feedback log).
// No historical migration is rewritten — the audit simply documents intent.
const APPEND_ONLY = new Set([  // no UPDATE policy required
  "sanitized_error_events", "export_history", "import_history",
  "belief_revisions", "user_judgments", "session_activity", "retrieval_feedback",
]);
const NO_DELETE = new Set([    // no DELETE policy required
  "account_deletion_requests", "reflections", "retrieval_feedback",
]);

function userOwnedTables(sql) {
  const out = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
  let m;
  while ((m = re.exec(sql))) { if (/\buser_id\b/i.test(m[2])) out.push(m[1].toLowerCase()); }
  return out;
}

function checkPolicies(sql, table) {
  const s = sql.toLowerCase();
  // Explicit policy: `create policy <name> on <table> for <cmd>`.
  const explicit = (cmd) => new RegExp(`create\\s+policy\\s+[\\w".]+\\s+on\\s+(public\\.)?${table}\\s+for\\s+${cmd}`).test(s) ||
    (new RegExp(`create\\s+policy\\s+[\\w".]+\\s+on\\s+(public\\.)?${table}\\s+(as\\s+\\w+\\s+)?(using|with)`).test(s) && /for\s+all/.test(s));
  // Format-loop generator: `format('create policy %I_<cmd> on public.%I for <cmd> ...', t)`
  // applied to a list of table names that INCLUDES this table (as a quoted literal).
  // The placeholder may be %I, %s, %1$s, %1$i, etc.
  const PH = "%(?:[is]|\\d+\\$[is])";
  const generatorFor = (cmd) => new RegExp(`create\\s+policy\\s+${PH}_${cmd}\\s+on\\s+public\\.${PH}\\s+for\\s+${cmd}`).test(s) && new RegExp(`'${table}'`).test(s);
  const has = (cmd) => explicit(cmd) || generatorFor(cmd);
  const rlsExplicit = new RegExp(`alter\\s+table\\s+(public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`).test(s);
  const rlsGenerator = new RegExp(`execute\\s+format\\('alter\\s+table\\s+public\\.${PH}\\s+enable\\s+row\\s+level\\s+security'`).test(s) && new RegExp(`'${table}'`).test(s);
  return {
    rls: rlsExplicit || rlsGenerator,
    select: has("select"), insert: has("insert"), update: has("update"), delete: has("delete"),
  };
}

const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
// Per-file: LifeOS defines a table's RLS in the SAME migration that creates it,
// so we check policy coverage within each file (explicit OR format-loop generator).
const perFile = files.map((f) => ({ f, sql: readFileSync(join(migDir, f), "utf8") }));

const tableToFile = new Map();
for (const { sql } of perFile) for (const t of userOwnedTables(sql)) if (!tableToFile.has(t)) tableToFile.set(t, sql);

const tables = [...tableToFile.keys()];
let failures = 0;
const rows = [];
for (const t of tables) {
  const p = checkPolicies(tableToFile.get(t), t);
  const required = ["select", "insert"];
  if (!APPEND_ONLY.has(t)) required.push("update");
  if (!NO_DELETE.has(t)) required.push("delete");
  const missing = [];
  if (!p.rls) missing.push("rls");
  for (const r of required) if (!p[r]) missing.push(r);
  const ok = missing.length === 0;
  if (!ok) failures++;
  rows.push({ table: t, ok, missing });
}

console.log(`RLS audit: ${tables.length} user-owned tables across ${files.length} migrations`);
for (const r of rows.sort((a, b) => Number(a.ok) - Number(b.ok))) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.table}${r.ok ? "" : "  missing: " + r.missing.join(", ")}`);
}
if (failures) { console.error(`\nFAIL — ${failures} user-owned table(s) lack required RLS policies.`); process.exit(1); }
console.log("\nPASS — every user-owned table enables RLS with the required policies.");
