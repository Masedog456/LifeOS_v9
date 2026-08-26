#!/usr/bin/env node
/**
 * Mapper/column coherence audit (LIFEOS-074 §2).
 *
 * ## The defect this exists to prevent
 *
 * `next_actions.due_time` and `next_actions.recurrence` were added to the
 * schema and to `NextAction` by LIFEOS-061, and the Supabase mapper was never
 * told. For three sprints a recurring action synced without its rule and came
 * back on the next device as a plain undated task. 3900 assertions and twelve
 * browser smokes all passed: every one of them exercised the store in memory,
 * and the mapper sat between the store and the database with no test on either
 * side of it.
 *
 * ## This script is a TRIAGE LIST, not a gate — and that is deliberate
 *
 * The first three versions of it tried to decide, statically, whether an
 * unmapped field was a real loss, by inferring which table each mapper feeds.
 * All three inferences were wrong in different ways: a forward window ran past
 * the end of its own statement and paired `comparisonToRow` with `inquiries`; a
 * backward anchor paired `beliefToRow` with `comparisons`; a 14-line body read
 * reported `formationSessionToRow` as dropping a field it maps on line 32, and
 * the "fix" only failed because TypeScript rejected the duplicate key.
 *
 * A checker that invents defects is worse than no checker: the next reader
 * learns to ignore its output, and the one true finding goes with it. So this
 * lists what a human should triage and asserts nothing it cannot prove.
 *
 * The reliable gate is the RUNTIME round-trip test — `lib/sync/roundtrip-selftest.ts`
 * pushes a fully-populated record through the real mapper pair and compares
 * every field. That is real evidence. Extending it per-domain is the honest way
 * to close the remaining 42, and is recommended follow-up work rather than
 * something this script can substitute for.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adapter = readFileSync(join(root, "lib/adapters/supabaseAdapter.ts"), "utf8");
const types = readFileSync(join(root, "types/mvp.ts"), "utf8");

const migDir = join(root, "supabase", "migrations");
let sql = "";
for (const f of readdirSync(migDir).sort()) sql += "\n" + readFileSync(join(migDir, f), "utf8");

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

/**
 * The FULL function body — from `function x(` to the first column-0 `}`.
 *
 * A fixed-line window is not good enough and the audit proved it: a 14-line
 * grep reported `formationSessionToRow` as dropping `fingerprint`, which it maps
 * on line 32. The compiler caught the "fix" as a duplicate key. A truncated
 * read is how a checker invents a defect.
 */
function fullBody(fn) {
  const i = adapter.indexOf(`function ${fn}(`);
  if (i < 0) return "";
  const j = adapter.indexOf("\n}", i);
  return j < 0 ? adapter.slice(i) : adapter.slice(i, j);
}

function interfaceFields(name) {
  const m = new RegExp(`export interface ${name}\\s*(?:extends [^{]+)?\\{([\\s\\S]*?)\\n\\}`).exec(types);
  if (!m) return null;
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/^\s*([a-zA-Z_][A-Za-z0-9_]*)\??\s*:/gm)].map((x) => x[1]);
}

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function columnsOf(table) {
  const m = new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`).exec(sql);
  const base = m ? [...m[1].matchAll(/^\s+([a-z_]+)\s+/gm)].map((x) => x[1]) : [];
  // Columns added later by ALTER are just as real as columns in the CREATE.
  for (const a of sql.matchAll(new RegExp(`alter table public\\.${table} add column if not exists\\s+([a-z_]+)`, "g"))) {
    base.push(a[1]);
  }
  return base;
}

// NO table inference. See the header: three separate heuristics for pairing a
// mapper with its table each produced a different phantom finding, and a
// checker that invents defects is worse than no checker — the next reader
// learns to skip its output.

const pairs = [...adapter.matchAll(/(?:export )?function (\w+ToRow)\s*\(\s*\w+\s*:\s*([A-Za-z]+)/g)];
const noColumn = [];

for (const [, fn, type] of pairs) {
  const fields = interfaceFields(type);
  if (!fields) continue;
  const body = fullBody(fn);
  if (!body) continue;
  const missing = fields.filter((f) => !new RegExp(`\\.\\s*${f}\\b`).test(body));
  if (!missing.length) continue;
  noColumn.push({ type, fn, fields: missing });
}

console.log(`Mapper audit: ${pairs.length} row mappers checked.\n`);

console.log("Domain fields not referenced by their mapper — TRIAGE LIST, not failures.");
console.log("Each is one of: sub-table storage, a vestigial type field, or a real");
console.log("loss. Only a round-trip test can tell them apart; see lib/sync/roundtrip-selftest.ts.\n");
for (const d of noColumn) console.log(`  ${d.type} -> ${d.fn}: ${d.fields.join(", ")}`);
console.log("");
ok("every mapper was parsed and reported", pairs.length >= 40, `only ${pairs.length} mappers found`);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
console.log(`\n${failed.length === 0 ? "MAPPER AUDIT PASS" : "MAPPER AUDIT FAIL"} — ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
