#!/usr/bin/env node
/**
 * Wiring register — "built but not wired" detection (LIFEOS-074 §4).
 *
 * ## The pattern this exists to catch
 *
 * D-24: implementation existed, tests existed, documentation said LIVE, and no
 * production path called it — `sync_tombstones` was written and never read for
 * three sprints while `SYNC_INTEGRITY.md` listed tombstones under "Live today".
 * D-8 and D-9 were the same shape. Presence is not evidence of life.
 *
 * ## What it does and does NOT assert
 *
 * It reports FILE-level reachability only. An earlier symbol-level version
 * produced 383 candidates because a helper called solely inside its own module
 * looks uncalled while being perfectly reachable — the same phantom problem the
 * mapper audit hit. Whole modules with no importer are the real signal.
 *
 * The KNOWN lists below are a register, not an allowlist of good things: each
 * entry is understood and accepted debt. The script FAILS when the register goes
 * out of date in either direction, so a newly-stranded module is noticed and a
 * newly-wired one gets its entry retired.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    if (["node_modules", ".next", ".git", "out"].includes(e)) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  }
})(ROOT);
const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");
const isTest = (f) => /selftest|\/dev\/|\.test\./.test(rel(f));

/** Modules with NO importer at all — not even a self-test. Dead as shipped. */
const KNOWN_DEAD = [
  "lib/accessibility/announcements.ts",
  "lib/adapters/localAdapter.ts",
  "lib/inbox/processing.ts",
  "lib/insights/search.ts",
  "lib/maintenance/search.ts",
  "lib/sync/schema.ts",
];

/** Product routes with no in-app navigation. `/dev/*` is deliberately unlinked. */
const KNOWN_UNLINKED_ROUTES = ["/plan/week"];

const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

// ---- module reachability ---------------------------------------------------
const dead = [], testOnly = [];
for (const f of files) {
  const r = rel(f);
  if (!/^lib\//.test(r) || isTest(f) || /\/types?\.ts$/.test(r) || basename(r) === "index.ts") continue;
  const spec = "@/" + r.replace(/\.tsx?$/, "");
  let prod = 0, test = 0;
  for (const [g, gtext] of src) {
    if (g === f) continue;
    if (!gtext.includes(`"${spec}"`) && !gtext.includes(`'${spec}'`)) continue;
    if (isTest(g)) test++; else prod++;
  }
  if (prod === 0 && test === 0) dead.push(r);
  else if (prod === 0) testOnly.push(r);
}

console.log(`Wiring register: ${files.length} source files scanned.\n`);
console.log(`DEAD — no importer at all (${dead.length}):`);
for (const d of dead) console.log(`  ${d}`);
console.log(`\nTEST-ONLY — imported only by selftests or /dev (${testOnly.length}):`);
for (const t of testOnly) console.log(`  ${t}`);

const newDead = dead.filter((d) => !KNOWN_DEAD.includes(d));
const revived = KNOWN_DEAD.filter((d) => !dead.includes(d));
ok("no NEWLY dead module appeared", newDead.length === 0, newDead.join(", "));
ok("no registered dead module was quietly revived without retiring its entry",
  revived.length === 0, revived.join(", "));

// ---- route reachability ----------------------------------------------------
const prodText = [...src.entries()].filter(([f]) => !isTest(f)).map(([, t]) => t).join("\n");
const routes = files
  .filter((f) => /^app\/.*\/page\.tsx$/.test(rel(f)))
  .map((f) => "/" + rel(f).replace(/^app\//, "").replace(/\/page\.tsx$/, ""))
  .filter((r) => !r.includes("[") && !r.startsWith("/dev/") && r !== "/");
const unlinked = routes.filter((r) => !new RegExp(`["'\`]${r}["'\`/]`).test(prodText));
console.log(`\nUNLINKED product routes (${unlinked.length}):`);
for (const u of unlinked) console.log(`  ${u}`);
const newUnlinked = unlinked.filter((u) => !KNOWN_UNLINKED_ROUTES.includes(u));
ok("no NEWLY unlinked product route appeared", newUnlinked.length === 0, newUnlinked.join(", "));

// ---- write-only tables (the exact D-24 shape) ------------------------------
const adapter = src.get(join(ROOT, "lib/adapters/supabaseAdapter.ts")) ?? "";
const tables = new Set([...adapter.matchAll(/from\("([a-z_]+)"\)/g)].map((m) => m[1]));
const writeOnly = [...tables].filter((t) =>
  new RegExp(`from\\("${t}"\\)[\\s\\S]{0,60}?\\.(upsert|insert|delete)`).test(adapter) &&
  !new RegExp(`from\\("${t}"\\)[\\s\\S]{0,60}?\\.select`).test(adapter));
console.log(`\nTables the adapter WRITES but never READS (${writeOnly.length}): ${writeOnly.join(", ") || "(none)"}`);
ok("no table is written and never read (the D-24 shape)", writeOnly.length === 0, writeOnly.join(", "));

const failed = results.filter((r) => !r.pass);
console.log("");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
console.log(`\n${failed.length === 0 ? "WIRING REGISTER PASS" : "WIRING REGISTER FAIL"} — ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
