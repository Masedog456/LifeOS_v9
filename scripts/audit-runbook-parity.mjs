#!/usr/bin/env node
/**
 * Runbook / migration parity audit (Stage-1 deployment follow-up).
 *
 * The Stage-1 bring-up found the deployment runbook still describing migrations
 * `0001 … 0031` while the repository had 47. Following it would have deployed a
 * production database sixteen migrations behind the build.
 *
 * A prose correction alone would go stale again on the next schema change, so
 * this audit makes the drift a build failure instead of a discovery. Everything
 * is DERIVED from the repository — nothing here restates a number that must be
 * hand-updated each sprint.
 *
 * What it proves:
 *   1. The migration chain is dense 1..N and its head equals its count.
 *   2. The build's declared head (EXPECTED_MIGRATION_VERSION) equals that head.
 *   3. The release-fix escape hatch names exactly head+1.
 *   4. No operational document hard-codes a migration range, head, or fix slot
 *      that contradicts the repository.
 *
 * It needs no database and no credentials, so it can run in CI on every PR.
 *
 * Deliberately NOT in scope: asserting anything about a live database. The
 * deployed schema is verified separately, at deploy time, against
 * `public.app_schema_contract()` — which is capability-oriented by design and is
 * explicitly "never the migration ledger" (migration 0046). This audit does not
 * invent one.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${pass ? "" : ` — ${detail ?? ""}`}`);
};

/**
 * Operational documents — the ones that tell a human how to deploy or release.
 *
 * Deliberately NOT every markdown file. Historical records (`PERSISTENCE_QA.md`,
 * `V1_ROLLBACK_REPORT.md`, `V1_ACCEPTANCE_REPORT.md`, the LIFEOS-nnn reports)
 * legitimately name the migration numbers that were current when they were
 * written; rewriting those would destroy evidence rather than fix drift. Only
 * instructions someone might FOLLOW are guarded.
 */
const OPERATIONAL_DOCS = [
  "V1_DEPLOYMENT_RUNBOOK.md",
  "README.md",
  // Added after the checklist was found still asserting "Chain 0001→0031" and
  // an "allowed 0032 release fix" — the same drift, one document over, which
  // this gate could not see because it was not looking here.
  "V1_RELEASE_CHECKLIST.md",
];

// ---------------------------------------------------------------- derive ----

const migDir = join(root, "supabase", "migrations");
const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const numbers = files
  .map((f) => Number(f.slice(0, 4)))
  .filter((n) => Number.isFinite(n));

const count = files.length;
const head = numbers.length ? Math.max(...numbers) : 0;
const headFile = files[files.length - 1] ?? "(none)";
const pad = (n) => String(n).padStart(4, "0");

/** Pull an exported numeric/string constant out of a TypeScript source file. */
function constFrom(relPath, name, { numeric = false } = {}) {
  const src = readFileSync(join(root, relPath), "utf8");
  const re = numeric
    ? new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*(\\d+)`)
    : new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*["'\`]([^"'\`]+)["'\`]`);
  const m = src.match(re);
  if (!m) throw new Error(`could not read ${name} from ${relPath}`);
  return numeric ? Number(m[1]) : m[1];
}

const expectedMigrationVersion = constFrom("lib/security/schema-compatibility.ts", "EXPECTED_MIGRATION_VERSION", { numeric: true });
const allowedFix = constFrom("lib/release/migrations.ts", "ALLOWED_RELEASE_FIX_MIGRATION");
const minSupported = constFrom("lib/release/versions.ts", "MIN_SUPPORTED_MIGRATION_VERSION", { numeric: true });
const clientContract = constFrom("lib/sync/contract.ts", "CLIENT_CONTRACT", { numeric: true });

console.log(`\nDerived from the repository: ${count} migrations · head ${pad(head)} (${headFile})`);
console.log(`Build declares EXPECTED_MIGRATION_VERSION=${expectedMigrationVersion} · fix slot ${allowedFix} · min supported ${minSupported} · CLIENT_CONTRACT=${clientContract}\n`);

// ----------------------------------------------------------------- chain ----

const dense = numbers.length === new Set(numbers).size && numbers.every((n) => n >= 1 && n <= count) && head === count;
ok("migration chain is dense 1..N with head == count", dense, `count=${count} head=${head}`);

ok(`build's declared head matches the chain (${expectedMigrationVersion} == ${head})`,
  expectedMigrationVersion === head,
  `EXPECTED_MIGRATION_VERSION=${expectedMigrationVersion} but chain head is ${head} — update lib/security/schema-compatibility.ts`);

const expectedFix = `${pad(head + 1)}_v1_release_fix.sql`;
ok(`release-fix slot is head+1 (${expectedFix})`,
  allowedFix === expectedFix,
  `ALLOWED_RELEASE_FIX_MIGRATION="${allowedFix}" but head+1 is "${expectedFix}" — update lib/release/migrations.ts`);

ok("minimum supported migration version is below the head",
  minSupported < head, `min ${minSupported} >= head ${head}`);

// ------------------------------------------------------- document drift ----
//
// These patterns are the exact shapes that went stale. Each carries a number
// that must equal the derived head; anything else is drift.

const patterns = [
  { label: "migration range end", re: /0001\s*(?:…|\.\.\.|->|→|–|-|to)\s*0*(\d{2,4})\b/g },
  { label: "supported range end", re: /range\s*\(?`?\s*\d+\s*(?:–|-|to)\s*0*(\d{2,4})\s*`?\)?/gi },
  { label: "migration version", re: /migration version\s*\(?`?\s*0*(\d{1,4})\s*`?\)?/gi },
  { label: "release-fix slot", re: /`?0*(\d{2,4})_v1_release_fix\.sql`?/g },
  // The deploy-time parity expectation. This one said `"contract": 2` — the
  // signature of a database one migration BEHIND the head — which would have
  // certified an under-migrated production as correct. It is checked against
  // CLIENT_CONTRACT rather than the migration head, because the contract
  // generation moves only when client-visible capability does.
  { label: "schema contract generation", re: /`?"?contract"?`?\s*[:=]\s*`?(\d+)`?/g, against: "contract" }
];

/**
 * Find migration references in `text` that contradict `expectedHead`.
 * Pure, so the selftest below can exercise it without touching the filesystem.
 */
function findDrift(text, expectedHead, expectedContract = null) {
  const drift = [];
  for (const { label, re } of patterns) {
    // Contract drift is only checkable when a contract expectation was supplied.
    if (label === "schema contract generation" && expectedContract === null) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const found = Number(m[1]);
      // A release-fix slot must name head+1; every other pattern must name the head.
      const expected = label === "release-fix slot" ? expectedHead + 1
        : label === "schema contract generation" ? expectedContract
        : expectedHead;
      if (found !== expected) {
        drift.push({ label, found, expected, match: m[0], line: text.slice(0, m.index).split("\n").length });
      }
    }
  }
  return drift;
}

// --selftest proves the detector still detects, so a future refactor cannot
// quietly turn this gate into a no-op that always passes.
if (process.argv.includes("--selftest")) {
  const cases = [
    ["catches a stale range", "Apply migrations `0001 … 0031` in order.", 47, 1],
    ["catches a stale supported range", "within the supported migration range (`20–31`)", 47, 1],
    ["catches a stale migration version", "record the migration version (`31`).", 47, 1],
    ["catches a stale release-fix slot", "would add exactly `0032_v1_release_fix.sql`", 47, 1],
    ["accepts a correct range", "Apply migrations `0001 … 0047` in order.", 47, 0],
    ["accepts a correct fix slot", "would add exactly `0048_v1_release_fix.sql`", 47, 0],
    ["ignores unrelated numbers", "The app version is 1.0.0-rc1 and 31 tables exist.", 47, 0],
    // The parity expectation. A doc naming the PREVIOUS generation would have an
    // operator certify a database one migration behind as correct.
    ["catches a stale contract generation", 'confirm `contract: 2`', 47, 1, 3],
    ["accepts the current contract generation", 'confirm `contract: 3`', 47, 0, 3],
    ["ignores contract talk when no expectation is supplied", 'confirm `contract: 2`', 47, 0, null]
  ];
  let bad = 0;
  for (const [name, text, h, want, contract = null] of cases) {
    const got = findDrift(text, h, contract).length;
    const pass = got === want;
    if (!pass) bad += 1;
    console.log(`${pass ? "✓" : "✗"} selftest: ${name}${pass ? "" : ` — expected ${want} drift, got ${got}`}`);
  }
  console.log(`\n${bad ? "SELFTEST FAIL" : "SELFTEST PASS"} — ${cases.length - bad}/${cases.length}`);
  process.exit(bad ? 1 : 0);
}

let driftFound = 0;
for (const doc of OPERATIONAL_DOCS) {
  let text;
  try {
    text = readFileSync(join(root, doc), "utf8");
  } catch {
    continue;
  }
  for (const d of findDrift(text, head, clientContract)) {
    driftFound += 1;
    console.log(`  ✗ ${doc}:${d.line} — ${d.label} says ${d.found}, repository says ${d.expected}: ${JSON.stringify(d.match)}`);
  }
}
ok("no operational document contradicts the repository migration head", driftFound === 0,
  `${driftFound} stale reference(s) above`);

// ---------------------------------------------------------------- report ----

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "RUNBOOK PARITY FAIL" : "RUNBOOK PARITY PASS"} — ${results.length - failed.length}/${results.length} checks`);
if (failed.length) {
  console.log("\nA deployment run from these instructions could leave production behind the build.");
  process.exit(1);
}
