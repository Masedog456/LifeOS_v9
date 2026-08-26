#!/usr/bin/env node
/**
 * Canonical release audit (LIFEOS-042, Features 2 & 5).
 *
 * A static, no-database audit that parses the real migration SQL and cross-checks
 * it against the declared release model (lib/release/*). It verifies:
 *
 *   - migration count + dense numbering + no duplicate numbers
 *   - only an allowed 0035 release-fix migration may be added
 *   - expected public table count
 *   - every user-owned (user_id) table enables RLS and has policies (delegates
 *     the deep policy check to audit-rls.mjs, invoked separately)
 *   - version alignment (tag / app / migration / state / export)
 *   - inventory, routes, limitations, checklist, acceptance, fixture validators
 *
 * Emits a concise machine-readable JSON summary + a human report, and the full
 * machine-readable inventory to release-evidence/inventory.json.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migDir = join(root, "supabase", "migrations");
const evidenceDir = join(root, "release-evidence");

const results = [];
const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "" : detail });

// ---- Parse migrations statically ----
const files = readdirSync(migDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const numbers = files.map((f) => Number(f.slice(0, 4)));
ok("migration count == 43", files.length === 43, `found ${files.length}`);
ok("dense numbering 1..N", numbers.every((n, i) => n === i + 1), `numbers: ${numbers.join(",")}`);
ok("no duplicate migration numbers", new Set(numbers).size === numbers.length);
// Head is 0041 (0041_external_calendar_identity.sql, LIFEOS-067). A
// release-blocking DB defect would add exactly one narrowly-scoped
// 0042_v1_release_fix.sql beyond it — the escape hatch is one unplanned
// migration, not an open door, and it moves with the head.
const beyondHead = files.filter((f) => Number(f.slice(0, 4)) > 43);
ok("no migration beyond 0043 except allowed 0044 fix", beyondHead.every((f) => f === "0044_v1_release_fix.sql"), `unexpected: ${beyondHead.join(", ")}`);

let allSql = "";
for (const f of files) allSql += "\n" + readFileSync(join(migDir, f), "utf8");
const createTable = (allSql.match(/create table if not exists/gi) || []).length;
// 60, not 58: LIFEOS-056 added constitution_elements + constitution_revisions
// (0038). 0040 adds a COLUMN, not a table, so this count is unchanged.
// 62 since LIFEOS-061 added `events` and `recurrence_completions`.
// 65 since LIFEOS-068's 0042 added three: integration_accounts and
// integration_oauth_states in `public`, and integration_credentials in the
// `private` schema — which is why this total is THREE higher while the public
// table count the rehearsal asserts only rose by two.
ok("65 CREATE TABLE IF NOT EXISTS", createTable === 65, `found ${createTable}`);
const userOwned = (allSql.match(/user_id\s+uuid\s+not null\s+default\s+auth\.uid\(\)/gi) || []).length;
ok("user-owned tables default user_id to auth.uid()", userOwned >= 40, `found ${userOwned}`);
ok("every table uses IF NOT EXISTS (rerunnable)", (allSql.match(/create table\b/gi) || []).length === createTable, "found a CREATE TABLE without IF NOT EXISTS");
ok("policies use DROP POLICY IF EXISTS (rerunnable)", (allSql.match(/drop policy if exists/gi) || []).length >= (allSql.match(/create policy/gi) || []).length);

// ---- Cross-check the declared release model via the TS runner ----
function runTs(expr) {
  const script = `
    const path=require("path"); const Module=require("module");
    const ts=require(path.join(process.cwd(),"node_modules/typescript"));
    const alias=(r)=>r.startsWith("@/")?path.join(process.cwd(),r.slice(2)):r;
    const o=Module._resolveFilename; Module._resolveFilename=function(r,...a){return o.call(this,alias(r),...a);};
    require.extensions[".ts"]=function(m,f){const s=require("fs").readFileSync(f,"utf8");
      const out=ts.transpileModule(s,{compilerOptions:{module:"commonjs",target:"es2020",esModuleInterop:true,jsx:"react"},fileName:f}).outputText; m._compile(out,f);};
    ${expr}
  `;
  return execFileSync("node", ["-e", script], { cwd: root, encoding: "utf8" });
}

const modelJson = runTs(`
  const ev=require(path.join(process.cwd(),"lib/release/evidence.ts"));
  const inv=require(path.join(process.cwd(),"lib/release/inventory.ts"));
  const e=ev.gatherEvidence(${files.length});
  process.stdout.write(JSON.stringify({
    versionOk:e.version.ok, versionProblems:e.version.problems,
    inventoryOk:e.inventory.ok, routesOk:e.routes.ok, routeProblems:e.routes.problems,
    limitationsOk:e.limitations.ok, checklistOk:e.checklist.ok, acceptanceOk:e.acceptance.ok,
    fixtureOk:e.fixture.ok, migrationsOk:e.migrations.ok,
    deterministicGatesPass:e.deterministicGatesPass, openBlockers:e.openBlockerCount,
    manualChecksRequired:e.manualChecksRequired, tagReady:e.tagReady,
    inventory: inv.buildInventory([${JSON.stringify("cohesion-tests")},${JSON.stringify("release-tests")}]),
  }));
`);
const model = JSON.parse(modelJson);
ok("version alignment ok", model.versionOk, (model.versionProblems || []).join("; "));
ok("inventory valid", model.inventoryOk);
ok("route audit valid", model.routesOk, (model.routeProblems || []).join("; "));
ok("limitations complete", model.limitationsOk);
ok("checklist complete", model.checklistOk);
ok("acceptance matrix integrity", model.acceptanceOk);
ok("release fixture valid", model.fixtureOk);
ok("migration model valid", model.migrationsOk);
ok("deterministic gates pass", model.deterministicGatesPass);

// ---- Emit machine-readable artifacts ----
if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
const inventoryOut = { ...model.inventory, migrationFiles: files, tableCount: createTable };
writeFileSync(join(evidenceDir, "inventory.json"), JSON.stringify(inventoryOut, null, 2));

const passed = results.filter((r) => r.pass).length;
const summary = {
  ok: passed === results.length,
  checks: results.length,
  passed,
  tagReady: model.tagReady,
  openBlockers: model.openBlockers,
  manualChecksRequired: model.manualChecksRequired,
  migrationCount: files.length,
  tableCount: createTable,
};
writeFileSync(join(evidenceDir, "release-audit.json"), JSON.stringify(summary, null, 2));

for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : " — " + r.detail}`);
console.log(`\ntag-ready(deterministic): ${model.tagReady} · open blockers: ${model.openBlockers} · manual checks required: ${model.manualChecksRequired}`);
console.log(`${summary.ok ? "RELEASE AUDIT PASS" : "RELEASE AUDIT FAIL"} — ${passed}/${results.length} checks`);
process.exit(summary.ok ? 0 : 1);
