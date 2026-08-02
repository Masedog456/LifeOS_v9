#!/usr/bin/env node
/**
 * Release checklist renderer (LIFEOS-042, Feature 28).
 *
 * Renders the executable release checklist from lib/release/checklist.ts as a
 * grouped, machine-readable report and writes release-evidence/checklist.json.
 * Exits non-zero only if the checklist model is structurally invalid (a missing
 * section, owner, evidence, or date) — NOT merely because items remain manual;
 * pending manual items are the honest state, not a failure.
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
  const cl=require(path.join(process.cwd(),"lib/release/checklist.ts"));
  const acc=require(path.join(process.cwd(),"lib/release/acceptance.ts"));
  process.stdout.write(JSON.stringify({
    items: cl.CHECKLIST, report: cl.validateChecklist(), manual: acc.manualChecksStillRequired(),
  }));
`;
const data = JSON.parse(execFileSync("node", ["-e", script], { cwd: root, encoding: "utf8" }));

if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, "checklist.json"), JSON.stringify(data, null, 2));

const bySection = {};
for (const it of data.items) (bySection[it.section] ||= []).push(it);
for (const [section, items] of Object.entries(bySection)) {
  console.log(`\n## ${section}`);
  for (const it of items) {
    const mark = it.status === "done" ? "✓" : it.status === "manual-required" ? "⚑" : it.status === "pending" ? "○" : "–";
    console.log(`  ${mark} [${it.blocker}] ${it.item}  (owner: ${it.owner}, ${it.date})`);
  }
}
const r = data.report;
console.log(`\ndone: ${r.done} · manual-required: ${r.manualRequired} · pending: ${r.pending} · open blockers: ${r.openBlockers.length}`);
console.log(`manual production checks still required: ${data.manual.length}`);
console.log(r.ok ? "CHECKLIST MODEL VALID" : "CHECKLIST MODEL INVALID: " + r.problems.join("; "));
process.exit(r.ok ? 0 : 1);
