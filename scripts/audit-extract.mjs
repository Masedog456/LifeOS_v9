#!/usr/bin/env node
/**
 * Extract route & outbound fetch audit (PR 1).
 *
 * 1. Compiles lib/, types/ and the API routes the harnesses drive to
 *    scripts/out (tsconfig.selftest.json).
 * 2. Runs scripts/inject-extract-route.cjs, which drives the real
 *    /api/extract handler and the safe-fetch suite (local servers only; no
 *    request leaves this machine).
 *
 * Exit 1 on any failure. A failure here means the server may fetch internal
 * addresses on a caller's behalf. Do not deploy on this result.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.stdout.write("· compiling to scripts/out … ");
try {
  execFileSync("npx", ["tsc", "-p", "tsconfig.selftest.json"], { cwd: root, stdio: "pipe" });
  console.log("done");
} catch (e) {
  console.log("FAILED");
  console.log(String(e.stdout ?? "") + String(e.stderr ?? ""));
  console.log("\nEXTRACT AUDIT FAIL — the suite could not be built, so nothing was proved.");
  process.exit(1);
}

const run = spawnSync(process.execPath, [join(root, "scripts", "inject-extract-route.cjs")], {
  cwd: root,
  encoding: "utf8",
  timeout: 120_000,
});
const out = (run.stdout ?? "") + (run.stderr ?? "");
const m = /===\s*(\d+)\s*\/\s*(\d+)\s+extract route assertions\s*===/.exec(out);
const sf = /SAFEFETCH (\d+)\/(\d+)/.exec(out);
const failures = out.split("\n").filter((l) => /^FAIL\b/.test(l.trim()));
const pass = run.status === 0 && m && m[1] === m[2] && failures.length === 0 && Number(m[2]) >= 25;

if (!pass) console.log(out);
console.log(
  `\n${pass ? "EXTRACT AUDIT PASS" : "EXTRACT AUDIT FAIL"} — route ${m ? `${m[1]}/${m[2]}` : "did not finish"}` +
    `, safe-fetch ${sf ? `${sf[1]}/${sf[2]}` : "did not run"}`,
);
process.exit(pass ? 0 : 1);
