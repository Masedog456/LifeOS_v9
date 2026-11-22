#!/usr/bin/env node
/**
 * `npm test` — the unified self-test runner (PR 2).
 *
 * The repository has ~70 self-test suites under `lib/` (files named
 * `*selftest.ts`, each exporting a `run…SelfTest(s)` function). Until now they
 * ran only from the /dev/* pages in a browser or through ad-hoc scripts, so a
 * failure could sit unnoticed for months: four did. This runner makes them a
 * gate.
 *
 * What it does
 *   1. Compiles the REAL modules with `tsconfig.selftest.json` (to scripts/out),
 *      the same tree the injection harnesses use. A type error fails the run.
 *   2. Discovers every compiled `*selftest.js` under scripts/out/lib.
 *   3. Runs every exported `run…SelfTest(s)` function, sequentially, each with a
 *      timeout and a fresh in-memory localStorage.
 *   4. Exits non-zero when ANY of these happens — none is ever reported as a pass:
 *        - an assertion fails
 *        - a suite throws, times out, or fails to load
 *        - a suite returns no `results` array, or zero assertions
 *        - a selftest file has no runner and is not declared as included by one
 *          (that is how a suite silently stops running)
 *
 * Isolation guarantees (enforced here, not just by CI configuration)
 *   - Credential-shaped environment variables (Supabase, Postgres, Stripe,
 *     Anthropic, OpenAI, Vercel tokens, DATABASE_URL, …) are DELETED from the
 *     process before any test module loads. A suite cannot use what is not there.
 *   - Every outbound connection to a non-loopback address throws. Suites that
 *     need a server (the SSRF fetcher suite) start one on 127.0.0.0/8.
 *
 * Options
 *   --no-compile          reuse an existing scripts/out tree
 *   --filter=<text>       run only suites whose path contains <text>
 *   --clock=<ISO time>    run with the wall clock moved to <ISO time> (it keeps
 *                         ticking from there). Used by CI to catch date-
 *                         dependent assertions like the one fixed in PR 2.
 *   --json=<path>         also write a machine-readable report
 *   --list                list discovered suites and exit
 *   --verbose             print every failing assertion in full (default: 20/suite)
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "scripts", "out");
const require = createRequire(import.meta.url);

// ------------------------------------------------------------------- options
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const known = new Set(["no-compile", "filter", "clock", "json", "list", "verbose"]);
for (const k of args.keys()) {
  if (!known.has(k)) {
    console.error(`run-tests: unknown option --${k}`);
    process.exit(2);
  }
}
const SUITE_TIMEOUT_MS = 180_000;
const inCI = process.env.GITHUB_ACTIONS === "true";

/**
 * Selftest files that intentionally export no runner because another suite
 * imports and runs their assertions. Each entry names the including suite; the
 * runner verifies that file really imports it, so a stale entry fails too.
 */
/**
 * Deterministic injection harnesses that drive the compiled modules in a child
 * process. They are run after the suites, under the same guard (preloaded with
 * --require). Harnesses already gated by `npm run audit:security` (billing,
 * extract, schema-compatibility) are not repeated here; the list of harnesses
 * deliberately NOT run, and why, is in docs/TESTING.md.
 */
const HARNESSES = [
  ["scripts/inject-074-domain-isolation.cjs", "sync: one domain's failure never blocks another (LIFEOS-074 D-22)"],
  ["scripts/inject-074-integrity-dimensions.cjs", "sync: integrity dimensions (LIFEOS-074)"],
  ["scripts/inject-074-local-failure.cjs", "sync: local-storage failure handling (LIFEOS-074)"],
  ["scripts/inject-074-remote-failure.cjs", "sync: remote failure injection (LIFEOS-074)"],
  ["scripts/audit-mappers.mjs", "store ↔ database field mappers"],
  ["scripts/audit-wiring.mjs", "feature wiring register"],
];

const INCLUDED_BY = {
  "lib/execution/horizons-selftest": "lib/execution/selftest.ts",
};

// ------------------------------------------------- 1. isolation, before loads
// Env scrub + network guard live in scripts/test-guard.cjs so spawned harnesses
// get the identical rules via `node --require`.
const guardPath = join(root, "scripts", "test-guard.cjs");
const { state: guard, probe } = require(guardPath);
const scrubbed = guard.scrubbed;
const blocked = guard.blocked;
process.env.LIFEOS_ROOT = root;

// In-memory browser storage. Cleared between suites so no suite depends on
// another's leftovers.
const mem = new Map();
const memStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
globalThis.localStorage ??= memStorage;

// Optional moved wall clock. Explicit dates (`new Date("2026-01-01")`) are
// untouched; only "now" moves, and it keeps ticking.
if (args.has("clock")) {
  const target = Date.parse(String(args.get("clock")));
  if (Number.isNaN(target)) {
    console.error(`run-tests: --clock must be an ISO time, got ${args.get("clock")}`);
    process.exit(2);
  }
  const RealDate = Date;
  const offset = target - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(RealDate.now() + offset);
      else super(...a);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}

// -------------------------------------------------------------- 2. compile
if (!args.has("no-compile")) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  process.stdout.write("· compiling lib/ with tsconfig.selftest.json … ");
  try {
    execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.selftest.json")], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("done");
  } catch (e) {
    console.log("FAILED");
    process.stdout.write(String(e.stdout ?? "") + String(e.stderr ?? ""));
    process.exit(1);
  }
}
if (!existsSync(join(outDir, "lib"))) {
  console.error("run-tests: scripts/out/lib is missing — run without --no-compile");
  process.exit(1);
}

// Resolve the "@/..." alias used throughout lib/ to the compiled tree.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (typeof req === "string" && req.startsWith("@/")) req = join(outDir, req.slice(2));
  return origResolve.call(this, req, ...rest);
};

// --------------------------------------------------------------- 3. discover
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/selftest\.js$/.test(f)) files.push(p);
  }
})(join(outDir, "lib"));
files.sort();

// Every source selftest must have compiled (guards against a tsconfig include
// silently dropping a directory).
const srcSelftests = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/selftest\.ts$/.test(f)) srcSelftests.push(relative(root, p).replace(/\.ts$/, ""));
  }
})(join(root, "lib"));
const compiled = new Set(files.map((f) => relative(outDir, f).replace(/\.js$/, "")));
const notCompiled = srcSelftests.filter((s) => !compiled.has(s));

const filter = args.has("filter") ? String(args.get("filter")) : null;

if (args.has("list")) {
  for (const f of files) console.log(relative(outDir, f));
  console.log(`${files.length} selftest files`);
  process.exit(0);
}

// ------------------------------------------------------------------ 4. run
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s: ${label}`)), ms).unref())]);

const suites = [];
const problems = []; // structural problems: always fatal
for (const s of notCompiled) problems.push({ suite: s, problem: "selftest source was not compiled (check tsconfig.selftest.json include)" });

// The isolation guard proves itself on every run: each probe must be refused,
// or the run fails.
{
  const p = await probe();
  for (const [k, refused] of Object.entries(p)) {
    if (!refused) problems.push({ suite: "test-guard", problem: `${k} egress was NOT blocked` });
  }
}

const t0 = Date.now();
for (const f of files) {
  const rel = relative(outDir, f).replace(/\.js$/, "");
  if (filter && !rel.includes(filter)) continue;
  let mod;
  try {
    mod = require(f);
  } catch (e) {
    problems.push({ suite: rel, problem: `failed to load: ${String(e?.message ?? e).split("\n")[0]}` });
    continue;
  }
  const runners = Object.entries(mod).filter(([k, v]) => /^run[A-Za-z0-9]*SelfTests?$/.test(k) && typeof v === "function");
  if (runners.length === 0) {
    const includer = INCLUDED_BY[rel];
    const base = rel.split("/").pop();
    if (!includer) {
      problems.push({ suite: rel, problem: "exports no run…SelfTest(s) function and is not declared in INCLUDED_BY — it would never run" });
    } else if (!readFileSync(join(root, includer), "utf8").includes(base)) {
      problems.push({ suite: rel, problem: `INCLUDED_BY says ${includer} runs it, but that file does not import it` });
    }
    continue;
  }
  for (const [name, fn] of runners) {
    const label = `${rel}:${name}`;
    mem.clear();
    const started = Date.now();
    try {
      const r = await withTimeout(Promise.resolve().then(() => fn()), SUITE_TIMEOUT_MS, label);
      const results = Array.isArray(r) ? r : r?.results;
      if (!Array.isArray(results)) {
        problems.push({ suite: label, problem: "returned no results array" });
        continue;
      }
      const failed = results.filter((x) => !x || x.pass !== true);
      if (results.length === 0) problems.push({ suite: label, problem: "reported zero assertions" });
      if (r && !Array.isArray(r) && typeof r.total === "number" && r.total !== results.length) {
        problems.push({ suite: label, problem: `reports total ${r.total} but returned ${results.length} results` });
      }
      suites.push({ suite: label, total: results.length, passed: results.length - failed.length, ms: Date.now() - started, failures: failed.map((x) => ({ name: x?.name ?? "(unnamed)", detail: x?.detail ?? "" })) });
    } catch (e) {
      problems.push({ suite: label, problem: `threw: ${String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ")}` });
    }
  }
}

// -------------------------------------------------------------- 4b. harnesses
const harnesses = [];
for (const [file, what] of HARNESSES) {
  if (filter && !file.includes(filter)) continue;
  const started = Date.now();
  const r = spawnSync(process.execPath, ["--require", guardPath, join(root, file)], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: SUITE_TIMEOUT_MS,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const last = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
  const passedH = r.status === 0 && !r.error;
  harnesses.push({ file, what, passed: passedH, status: r.status, ms: Date.now() - started, last, out: passedH ? "" : out.slice(-3000) });
}

// ---------------------------------------------------------------- 5. report
const total = suites.reduce((a, s) => a + s.total, 0);
const passed = suites.reduce((a, s) => a + s.passed, 0);
const failing = suites.filter((s) => s.failures.length);
const cap = args.has("verbose") ? Infinity : 20;

for (const s of suites) {
  const mark = s.failures.length ? "FAIL" : "ok  ";
  console.log(`${mark} ${String(s.passed).padStart(5)}/${String(s.total).padEnd(5)} ${s.suite}  (${s.ms} ms)`);
}
if (harnesses.length) {
  console.log("\nHarnesses (child processes, same guard):");
  for (const h of harnesses) console.log(`${h.passed ? "ok  " : "FAIL"} ${h.file}  — ${h.last.slice(0, 90)}  (${h.ms} ms)`);
}
if (failing.length) {
  console.log("\nFailed assertions:");
  for (const s of failing) {
    console.log(`\n  ${s.suite}`);
    for (const f of s.failures.slice(0, cap)) {
      console.log(`    ✗ ${f.name}${f.detail ? `  — ${String(f.detail).slice(0, 300)}` : ""}`);
      if (inCI) console.log(`::error title=${s.suite}::${f.name} ${String(f.detail).slice(0, 200).replace(/\n/g, " ")}`);
    }
    if (s.failures.length > cap) console.log(`    … ${s.failures.length - cap} more (use --verbose)`);
  }
}
for (const h of harnesses.filter((x) => !x.passed)) {
  console.log(`\n  ✗ harness ${h.file} exited ${h.status}:\n${h.out}`);
  if (inCI) console.log(`::error title=${h.file}::harness exited ${h.status}: ${h.last.slice(0, 200)}`);
}
if (problems.length) {
  console.log("\nSuite problems (each fails the run):");
  for (const p of problems) {
    console.log(`  ✗ ${p.suite}: ${p.problem}`);
    if (inCI) console.log(`::error title=${p.suite}::${p.problem}`);
  }
}

const clockNote = args.has("clock") ? ` · clock ${args.get("clock")}` : "";
const tzNote = ` · TZ ${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`;
const hPassed = harnesses.filter((h) => h.passed).length;
console.log(
  `\n${passed}/${total} assertions passed across ${suites.length} suites; harnesses ${hPassed}/${harnesses.length} in ${((Date.now() - t0) / 1000).toFixed(1)} s${clockNote}${tzNote}`,
);
console.log(`isolation: ${scrubbed.length} credential-like env var(s) removed; ${blocked.length} non-loopback connection(s) blocked`);
if (blocked.length) console.log(`  blocked hosts: ${[...new Set(blocked)].join(", ")}`);

if (args.has("json")) {
  const p = resolve(String(args.get("json")));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ passed, total, suites, harnesses, problems, clock: args.get("clock") ?? null, tz: process.env.TZ ?? null, blocked }, null, 2));
}

const ok = failing.length === 0 && problems.length === 0 && harnesses.every((h) => h.passed) && total > 0 && !(filter === null && suites.length === 0);
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);
