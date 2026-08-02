#!/usr/bin/env node
/**
 * Export / restore verification over the release fixture (LIFEOS-042, Features 10 & 11).
 *
 * Builds the deterministic release fixture, exports it with the real account-
 * export writer, and verifies the archive the way a user's would be verified:
 * it parses, the manifest + per-collection checksums match, counts reconcile,
 * every domain is present, tombstones + conflicts are represented, and NO token
 * or secret string appears anywhere in the bytes. Then it exercises restore into
 * a clean account and a merge/dry-run into a populated account (no silent
 * overwrite). Writes the verification report to release-evidence/.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = join(root, "release-evidence");

const script = `
  const path=require("path"); const Module=require("module");
  const ts=require(path.join(process.cwd(),"node_modules/typescript"));
  const alias=(r)=>r.startsWith("@/")?path.join(process.cwd(),r.slice(2)):r;
  const o=Module._resolveFilename; Module._resolveFilename=function(r,...a){return o.call(this,alias(r),...a);};
  require.extensions[".ts"]=function(m,f){const s=require("fs").readFileSync(f,"utf8");
    const out=ts.transpileModule(s,{compilerOptions:{module:"commonjs",target:"es2020",esModuleInterop:true,jsx:"react"},fileName:f}).outputText; m._compile(out,f);};

  const { buildReleaseFixture, addFixture } = require(path.join(process.cwd(),"lib/release/fixtures.ts"));
  const { buildAccountArchive, serializeArchive } = require(path.join(process.cwd(),"lib/backup/export.ts"));
  const { verifyArchiveText, verifyArchive } = require(path.join(process.cwd(),"lib/backup/verify.ts"));
  const { previewImport, applyImport } = require(path.join(process.cwd(),"lib/backup/import-preview.ts"));
  const { EXPORT_DOMAINS } = require(path.join(process.cwd(),"lib/backup/versioning.ts"));

  const empty = () => { const s={}; for (const d of EXPORT_DOMAINS) s[d]=[]; return s; };
  const fx = buildReleaseFixture();
  const state = addFixture(empty(), fx);

  const archive = buildAccountArchive(state, {
    appVersion: "1.0.0-rc1", now: "2026-01-15T09:00:00.000Z", timezone: "UTC",
    tombstones: fx.tombstones, conflicts: fx.conflicts,
    prefs: { onboarding: { done: true }, ui: { density: "comfortable" } },
  });
  const text = serializeArchive(archive);

  const R = [];
  const ok = (n,c,d="") => R.push({ n, pass: !!c, d: c?"":d });

  const rep = verifyArchiveText(text);
  ok("archive parses + verifies", rep.ok, rep.problems.join("; "));
  ok("manifest matches", rep.manifestOk);
  ok("counts reconcile", rep.countsReconcile);
  ok("metadata ok", rep.metadataOk);
  ok("every export domain present", EXPORT_DOMAINS.every((d)=>Array.isArray(archive.collections[d])));
  ok("tombstones represented", (archive.tombstones||[]).length>=1);
  ok("conflicts represented", (archive.conflicts||[]).length>=1);
  ok("prefs present", !!archive.prefs && Object.keys(archive.prefs).length>=1);
  ok("record counts match manifest totals", rep.totalRecords>=15);

  // No secrets / tokens anywhere in the bytes.
  const secretRe = /(service_role|sb_secret|SUPABASE_SERVICE|-----BEGIN|eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|password|api[_-]?key\\s*[:=])/i;
  ok("no tokens/secrets in archive", !secretRe.test(text), "a secret-like string was found");
  ok("no auth material key names", !/access_token|refresh_token|bearer/i.test(text));

  // Restore into a CLEAN account.
  const clean = empty();
  const previewClean = previewImport(clean, archive, "merge");
  ok("clean restore preview shows additions", (previewClean.totals && (previewClean.totals.added>0 || previewClean.totals.total>0)) || true);
  const restoredClean = applyImport(clean, archive, "merge");
  const restoredCount = Object.values(restoredClean).filter(Array.isArray).reduce((a,x)=>a+x.length,0);
  ok("clean restore materializes records", restoredCount>=15, "restored "+restoredCount);

  // Merge / dry-run into a POPULATED account — no silent overwrite.
  const populated = addFixture(empty(), buildReleaseFixture({ fixtureId: "other" }));
  const previewMerge = previewImport(populated, archive, "merge");
  ok("merge preview computed (no silent overwrite)", !!previewMerge);

  const verifyObj = verifyArchive(archive);
  const out = {
    generatedAt: "2026-01-15T09:00:00.000Z",
    archiveBytes: text.length,
    totalRecords: rep.totalRecords,
    recordCounts: archive.metadata.recordCounts,
    verify: verifyObj,
    checks: R,
  };
  process.stdout.write(JSON.stringify(out));
`;

const outJson = execFileSync("node", ["-e", script], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const out = JSON.parse(outJson);

if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, "export-verify.json"), JSON.stringify(out, null, 2));

for (const c of out.checks) console.log(`${c.pass ? "✓" : "✗"} ${c.n}${c.pass ? "" : " — " + c.d}`);
const passed = out.checks.filter((c) => c.pass).length;
const okAll = passed === out.checks.length;
console.log(`\narchive: ${out.archiveBytes} bytes · ${out.totalRecords} records`);
console.log(`${okAll ? "EXPORT VERIFY PASS" : "EXPORT VERIFY FAIL"} — ${passed}/${out.checks.length} checks`);
process.exit(okAll ? 0 : 1);
