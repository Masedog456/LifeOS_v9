#!/usr/bin/env node
/**
 * Runtime schema compatibility gate.
 *
 * LifeOS refuses to push a domain whose capability the deployed database does
 * not advertise. That protection is real and end-to-end: `app_schema_contract()`
 * → `SupabasePersistenceAdapter.loadSchemaContract()` → `probeCompatibility()`
 * → `evaluateContract()` → `compat.gatedDomains`, consumed by the flush loop in
 * `lib/persistence.ts` before the push, so a gated domain stays dirty and can
 * never be reported as synced.
 *
 * It is also proved — 94 behavioural assertions across the two harnesses below,
 * driving the real persistence module against a fake backend whose advertised
 * contract is settable per test.
 *
 * WHY THIS FILE EXISTS: none of that ran. The harnesses needed a CommonJS build
 * of `lib/` at `scripts/out` that no npm script produced, so they were run once,
 * during their own sprint, and never again. A later audit re-read the pre-repair
 * diagnostic (`scripts/audit-077-f3.cjs`, which by design still reports the
 * defect it was written to measure) and concluded from it that LifeOS had NO
 * runtime schema protection at all — a conclusion that reached the deployment
 * runbook as a "known gap" and was wrong. The protection was never missing. The
 * evidence for it was simply not executable.
 *
 * So the repair is not more protection. It is making the existing proof run.
 *
 * Needs no database and no credentials: the backend is a fake whose contract
 * payload each test sets. Runs in CI on every PR.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const OUT = join(root, "scripts", "out");

/**
 * The harnesses this gate runs, and the assertion count each must reach.
 *
 * The count is asserted, not just the absence of FAIL: a harness that silently
 * stopped constructing its fixtures would otherwise report "0 failures" and
 * pass. It is the one number here that is maintained by hand, and deliberately
 * so — adding an assertion should be a visible edit, and deleting one must not
 * be silent.
 */
const HARNESSES = [
  { file: "inject-077-schema-compatibility.cjs", expect: 51, what: "contract evaluation, gating, and the write-path consumption point" },
  { file: "inject-078-goal-capability.cjs", expect: 43, what: "the goal_horizons capability end to end, including the migration's own shape" },
];

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${pass ? "" : ` — ${detail ?? ""}`}`);
};

/**
 * Read a harness's trailing `=== N/M ... ===` summary.
 *
 * Returns null when the line is absent, which is itself a failure: a harness
 * that threw before its report is not a harness that passed.
 */
export function parseSummary(stdout) {
  const m = /===\s*(\d+)\s*\/\s*(\d+)\s+[^=]*===/.exec(stdout);
  if (!m) return null;
  return { passed: Number(m[1]), total: Number(m[2]) };
}

/** Any explicitly failed assertion, regardless of what the summary claims. */
export function failedLines(stdout) {
  return stdout.split("\n").filter((l) => /^FAIL\b/.test(l.trim()));
}

// ------------------------------------------------------------- selftest ----

if (process.argv.includes("--selftest")) {
  const cases = [
    ["a clean run is read as complete", "PASS x\n\n=== 51/51 schema-compatibility assertions ===", { passed: 51, total: 51 }, 0],
    ["a failing assertion is seen even when the summary is whole", "FAIL  A1 something\n=== 51/51 assertions ===", { passed: 51, total: 51 }, 1],
    ["a short count is not hidden", "=== 50/51 assertions ===", { passed: 50, total: 51 }, 0],
    ["a harness that died before reporting has no summary", "PASS  A1 fine\nTypeError: boom", null, 0],
    ["indented FAIL lines still count", "  FAIL  C3 gated\n=== 1/1 ===", { passed: 1, total: 1 }, 1],
    ["the word 'failed' inside a passing detail is not a failure", "PASS  C6 health does NOT report failed\n=== 1/1 ===", { passed: 1, total: 1 }, 0],
  ];
  let bad = 0;
  for (const [name, input, wantSummary, wantFails] of cases) {
    const gotSummary = parseSummary(input);
    const gotFails = failedLines(input).length;
    const pass =
      JSON.stringify(gotSummary) === JSON.stringify(wantSummary) && gotFails === wantFails;
    if (!pass) bad += 1;
    console.log(`${pass ? "✓" : "✗"} selftest: ${name}${pass ? "" : ` — got ${JSON.stringify(gotSummary)} / ${gotFails} fails`}`);
  }
  console.log(`\n${bad ? "SELFTEST FAIL" : "SELFTEST PASS"} — ${cases.length - bad}/${cases.length}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- build ----

/** Is the compiled tree newer than every source it was built from? */
function treeIsCurrent() {
  const probe = join(OUT, "lib", "persistence.js");
  if (!existsSync(probe)) return false;
  const built = statSync(probe).mtimeMs;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (walk(p)) return true; }
      else if (e.name.endsWith(".ts") && statSync(p).mtimeMs > built) return true;
    }
    return false;
  };
  return !(walk(join(root, "lib")) || walk(join(root, "types")));
}

if (process.argv.includes("--no-build") && treeIsCurrent()) {
  console.log("· reusing the compiled tree at scripts/out (current)\n");
} else {
  process.stdout.write("· compiling lib/ and types/ to scripts/out … ");
  try {
    execFileSync("npx", ["tsc", "-p", "tsconfig.selftest.json"], { cwd: root, stdio: "pipe" });
    console.log("done\n");
  } catch (e) {
    console.log("FAILED\n");
    console.log(String(e.stdout ?? "") + String(e.stderr ?? ""));
    console.log("SCHEMA COMPATIBILITY FAIL — the harnesses cannot be built, so nothing was proved.");
    process.exit(1);
  }
}

// ----------------------------------------------------------------- run ----

for (const h of HARNESSES) {
  const path = join(root, "scripts", h.file);
  if (!existsSync(path)) {
    ok(`${h.file} exists`, false, "harness missing — the protection it proves is now unguarded");
    continue;
  }
  const run = spawnSync(process.execPath, [path], { cwd: root, encoding: "utf8" });
  const stdout = (run.stdout ?? "") + (run.stderr ?? "");
  const summary = parseSummary(stdout);
  const fails = failedLines(stdout);

  if (fails.length || !summary || summary.passed !== summary.total || summary.total !== h.expect) {
    console.log(stdout);
  }
  ok(`${h.file} — ${h.what}`,
    run.status === 0 && summary !== null && fails.length === 0 && summary.passed === summary.total,
    summary ? `${summary.passed}/${summary.total}, ${fails.length} explicit failure(s)` : "no summary line — the harness did not finish");
  ok(`${h.file} still carries all ${h.expect} assertions`,
    summary !== null && summary.total === h.expect,
    summary ? `found ${summary.total}` : "no summary line");
}

// -------------------------------------------------------------- report ----

const failed = results.filter((r) => !r.pass);
const total = results.length;
console.log(`\n${failed.length ? "SCHEMA COMPATIBILITY FAIL" : "SCHEMA COMPATIBILITY PASS"} — ${total - failed.length}/${total} checks`);
if (failed.length) {
  console.log("\nThe runtime gate that stops this build writing to a database that cannot");
  console.log("accept the write is no longer proved. Do not deploy on this result.");
  process.exit(1);
}
