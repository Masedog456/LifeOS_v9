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

// ---- the file path, link by link (LIFEOS-075 §17) --------------------------
//
// The 074 register works at FILE level, which is right for whole stranded
// modules but blind to the shape 075 found: `lib/reading/originals.ts` was
// imported (for backup) while `resolveOriginalUrl` inside it had no caller at
// all, and `lib/reading/semanticIndex.ts` was imported (for delete) while
// `indexDocument` had none. A module can be alive and its most important
// function dead.
//
// So the file-storage chain is pinned CALL BY CALL. "Exists" is not the
// question — each link asserts that some production file other than the
// definition actually calls the next one.
const prodFiles = [...src.entries()].filter(([f]) => {
  const r = rel(f);
  return !isTest(f) && /^(lib|app|components)\//.test(r);
});
/** Production files that CALL `sym`, excluding the modules it is defined in. */
const callersOf = (sym, exclude = []) => prodFiles
  .filter(([f]) => !exclude.some((e) => rel(f) === e))
  .filter(([, t]) => new RegExp(`\\b${sym}\\s*\\(`).test(t))
  .map(([f]) => rel(f));

const CHAIN = [
  ["upload UI reaches the backup manager", "startOriginalBackup", ["lib/reading/backupManager.ts"]],
  ["the backup manager reaches the storage orchestration", "backupOriginal", ["lib/reading/originals.ts"]],
  ["upload computes a checksum from the RAW FILE BYTES", "sha256Hex", ["lib/reading/fileIntegrity.ts"]],
  ["the reader reaches signed-URL resolution", "resolveStoredOriginal", ["lib/reading/backupManager.ts"]],
  ["…which reaches the one signed-URL implementation", "resolveOriginalUrl", ["lib/reading/originals.ts"]],
  ["delete reaches blob removal", "removeStoredOriginal", ["lib/reading/backupManager.ts"]],
  ["…which reaches the folder-scoped object delete", "removeOriginalsForDocument", ["lib/reading/originals.ts"]],
  ["adoption reaches the deletion ledger", "loadTombstones", ["lib/adapters/supabaseAdapter.ts"]],
  ["adoption reaches tombstone suppression", "suppressDeleted", ["lib/persistence-reconcile.ts"]],
];

// The sync indicator is checked separately rather than through `callersOf`:
// it PASSES `getHealth` and `subscribeHealth` to `useSyncExternalStore` instead
// of calling them, so a call-shaped sweep finds the diagnostics pages and not
// the indicator — evidence that would not match the claim.
{
  const status = src.get(join(ROOT, "components/SyncStatus.tsx")) ?? "";
  ok("chain: the sync indicator reads the live health store",
    /from "@\/lib\/persistence"/.test(status) &&
    /useSyncExternalStore\(\s*subscribeHealth,\s*getHealth/.test(status),
    "SyncStatus no longer subscribes to the real persistence health store");
  ok("chain: …and its retry button reaches the real retry path",
    /retrySync\(\)/.test(status), "the Retry control is not wired to retrySync");
}
console.log("\nFILE-PATH CHAIN (LIFEOS-075 §17):");
for (const [label, sym, exclude] of CHAIN) {
  const cs = callersOf(sym, exclude);
  console.log(`  ${cs.length ? "✓" : "✗"} ${sym} <- ${cs.join(", ") || "(NO PRODUCTION CALLER)"}`);
  ok(`chain: ${label}`, cs.length > 0, `${sym} has no production caller`);
}

// The document delete must reach the tombstone write, not merely the row delete.
const adapterDocDelete = adapter.slice(adapter.indexOf("private async syncReadingDocuments"));
const docBlock = adapterDocDelete.slice(0, adapterDocDelete.indexOf("\n  }"));
ok("chain: deleting a reading writes a deletion marker",
  /writeTombstones\("documents"/.test(docBlock),
  "syncReadingDocuments deletes reading_documents without a tombstone (LIFEOS-075 C-2)");

/**
 * Functions that are DELIBERATELY unwired — the register, not an allowlist.
 *
 * `indexDocument` builds the reading semantic index. It is complete and tested
 * and nothing in production calls it, so `reading_chunk_embeddings` is never
 * populated and retrieval never loads a vector. LIFEOS-075 §13 decided NOT to
 * wire it: extracted-text cross-device durability is the sprint's claim, and
 * semantic-index durability is not. Waking a dormant subsystem because it
 * exists is how it got here. The entry stays until someone decides otherwise,
 * and the check below fails if it is quietly wired without retiring the entry.
 */
const KNOWN_UNWIRED_FUNCTIONS = [["indexDocument", ["lib/reading/semanticIndex.ts"]]];
for (const [sym, exclude] of KNOWN_UNWIRED_FUNCTIONS) {
  const cs = callersOf(sym, exclude);
  ok(`register: ${sym} is still unwired, as recorded`, cs.length === 0,
    `${sym} is now called from ${cs.join(", ")} — retire its register entry and state the decision`);
}

const failed = results.filter((r) => !r.pass);
console.log("");
for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
console.log(`\n${failed.length === 0 ? "WIRING REGISTER PASS" : "WIRING REGISTER FAIL"} — ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
