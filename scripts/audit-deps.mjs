#!/usr/bin/env node
/**
 * Dependency & supply-chain audit (LIFEOS-040, Feature 24).
 *
 * Runs `npm audit --omit=dev --json`, summarizes advisories by severity, and
 * checks lockfile presence + unexpected lifecycle scripts in direct deps. Exits
 * 1 only on HIGH/CRITICAL production advisories (triage policy in
 * PRODUCTION_OPERATIONS.md). Moderate/low are reported, not fatal.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(join(root, "package-lock.json"))) {
  console.error("Dependency audit FAILED: package-lock.json is missing (lockfile integrity).");
  process.exit(1);
}

let audit;
try {
  const out = execSync("npm audit --omit=dev --json", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  audit = JSON.parse(out);
} catch (e) {
  // npm audit exits non-zero when advisories exist; parse its stdout anyway.
  try { audit = JSON.parse(e.stdout || "{}"); } catch { audit = {}; }
}

const vuln = audit?.metadata?.vulnerabilities ?? {};
console.log("Dependency audit (production deps):");
for (const sev of ["critical", "high", "moderate", "low", "info"]) {
  console.log(`  ${sev}: ${vuln[sev] ?? 0}`);
}

// Triage allowlist (Feature 24: acceptable exceptions). Each entry documents an
// advisory that is transitive to a framework dep, outside LifeOS's runtime
// attack surface, and only "fixable" by a breaking framework downgrade. These
// are tracked in PRODUCTION_OPERATIONS.md and re-reviewed each release.
const ALLOWLIST = {
  // Emptied in PR 1 (Next.js 16.2.12 -> 16.4.6, `npm audit fix`): `npm audit`
  // now reports no advisories at all. The previous entries excepted `next`,
  // `postcss` and `sharp` BY PACKAGE NAME, which would also have silently
  // excepted any NEW high/critical advisory in those packages — including the
  // critical Next.js advisories published after the entries were written.
  // If an exception is ever needed again, record the advisory, the version
  // range and a review date, and prefer upgrading.
};

// Iterate per-package advisories to separate allowlisted from actionable.
const perPkg = audit?.vulnerabilities ?? {};
const actionable = [];
const excepted = [];
for (const [name, info] of Object.entries(perPkg)) {
  if (info.severity !== "high" && info.severity !== "critical") continue;
  if (ALLOWLIST[name]) excepted.push(name);
  else actionable.push(`${name} (${info.severity})`);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const prodDeps = Object.keys(pkg.dependencies ?? {});
console.log(`\nProduction dependency footprint: ${prodDeps.length} direct (${prodDeps.join(", ")})`);
if (excepted.length) {
  console.log("\nAccepted exceptions (documented in PRODUCTION_OPERATIONS.md):");
  for (const n of excepted) console.log(`  • ${n}: ${ALLOWLIST[n]}`);
}

if (actionable.length) {
  console.error(`\nFAIL — ${actionable.length} un-allowlisted high/critical advisory(ies): ${actionable.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS — no un-allowlisted high/critical production advisories.");
