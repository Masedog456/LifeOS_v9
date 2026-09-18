#!/usr/bin/env node
/**
 * Billing security audit + deterministic suite (LIFEOS-BILLING §24, §25).
 *
 * Three jobs, in one gate so there is one command to run and one thing to
 * believe:
 *
 *   1. STATIC — the containment properties that make the Stripe secret and the
 *      privileged database key safe to exist at all.
 *   2. PURE   — `lib/billing/selftest.ts`, run in Node against the compiled
 *      tree so it gates a PR without a browser.
 *   3. ROUTES — `scripts/inject-billing-routes.cjs`, which drives the real
 *      handlers and Stripe's real signature verifier.
 *
 * ## Why the static half is not "just a lint rule"
 *
 * `import "server-only"` is what makes a client import of the Stripe client or
 * the privileged Supabase key a BUILD failure. That guarantee is one deleted
 * line away from gone, and its absence would not be obvious in review — the
 * code would still work, right up until the bundle shipped a secret. So the
 * marker is asserted, by name, on every module that reads one.
 *
 * Needs no database, no credentials and no network.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "scripts", "out");

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${pass ? "" : ` — ${detail ?? ""}`}`);
};

/** The marker that makes a module unreachable from a client bundle. */
export const SERVER_ONLY_MARKER = /^\s*import\s+["']server-only["']\s*;?\s*$/m;

/**
 * Modules that read a secret, and therefore must carry the marker.
 *
 * Listed explicitly rather than discovered: a list that is maintained by hand
 * is a list somebody has to think about when they add the next one, and the
 * discovery rule below catches anything that slips past it anyway.
 */
const MUST_BE_SERVER_ONLY = [
  "lib/billing/stripe.ts",
  "lib/billing/admin.ts",
  "lib/billing/store.ts",
  "lib/billing/sync.ts",
];

/** Secrets that must never appear in anything the browser could receive. */
const SECRET_ENV_NAMES = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"];

const EXT = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out"]);

function sources(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) sources(p, acc);
    else if (EXT.test(entry)) acc.push(p);
  }
  return acc;
}

/**
 * Strip comments and string literals before matching.
 *
 * Load-bearing, and for the reason `scripts/audit-auth.mjs` learned the hard
 * way: this file's own doc comments name every pattern it forbids, and a raw
 * text match would either flag them or, worse, be satisfied by them.
 */
export function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');
}

/** Strip comments but KEEP string literals, so the compared value is visible. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Find entitlement decisions made outside the canonical predicate.
 *
 * §2 requires ONE predicate. The failure this catches is not hypothetical: a
 * scattered status comparison is how `cancel_at_period_end` ends up handled one
 * way in the gate and another way on the account screen.
 *
 * ## Why it is scoped to billing consumers
 *
 * `status` is a common word in LifeOS — goals, projects, actions and sync all
 * have one, and several of them have an `"active"`. A rule that flagged every
 * `status === "active"` in the repository would fire about 400 times on code
 * that has nothing to do with money, and a rule that fires 400 times is a rule
 * somebody turns off.
 *
 * So the scan runs only on files that import from `@/lib/billing` — which is
 * exactly the population that could plausibly re-decide entitlement, and the
 * only population where such a comparison would be wrong.
 *
 * Pure, so the `--selftest` below can exercise it without the filesystem.
 */
export function entitlementLeaks(sourceText) {
  if (!/@\/lib\/billing/.test(sourceText)) return [];
  const body = stripComments(sourceText);
  const found = [];
  // A subscription status compared to a literal, rather than passed to the
  // predicate. Only the statuses that decide access are listed: comparing to
  // `"canceled"` for wording is presentation, not an entitlement decision.
  const re = /\bstatus\s*[=!]==?\s*["'`](?:active|trialing|past_due)["'`]/g;
  let m;
  while ((m = re.exec(body)) !== null) found.push(m[0].trim());
  return found;
}

// -------------------------------------------------------------- selftest ----

if (process.argv.includes("--selftest")) {
  const billing = 'import { hasPaidAccess } from "@/lib/billing/entitlement";\n';
  const cases = [
    ["catches a scattered active check", billing + 'if (sub.status === "active") grant();', 1],
    ["catches a negated one", billing + 'if (subscription.status !== "active") deny();', 1],
    ["catches trialing", billing + 'const t = s.status === "trialing";', 1],
    ["catches past_due", billing + 'if (row.status === "past_due") warn();', 1],
    ["ignores an explanatory comment", billing + '// never write status === "active" here\nconst x = 1;', 0],
    ["ignores an unrelated status", billing + 'if (job.status === "queued") wait();', 0],
    ["ignores presentation-only wording", billing + 'const label = s.status === "canceled" ? "Ended" : "";', 0],
    ["ignores the canonical call", billing + "if (hasPaidAccess(sub)) grant();", 0],
    ["ignores a file that has nothing to do with billing", 'if (goal.status === "active") show();', 0],
  ];
  let bad = 0;
  for (const [name, text, want] of cases) {
    const got = entitlementLeaks(text).length;
    const pass = got === want;
    if (!pass) bad += 1;
    console.log(`${pass ? "✓" : "✗"} selftest: ${name}${pass ? "" : ` — expected ${want}, got ${got}`}`);
  }
  const markerCases = [
    ['import "server-only";\nconst a = 1;', true],
    ["import 'server-only'\nconst a = 1;", true],
    ['// import "server-only";\nconst a = 1;', false],
    ["const a = 1;", false],
  ];
  for (const [text, want] of markerCases) {
    const got = SERVER_ONLY_MARKER.test(text);
    const pass = got === want;
    if (!pass) bad += 1;
    console.log(`${pass ? "✓" : "✗"} selftest: marker ${want ? "detected" : "not detected"} in ${JSON.stringify(text.slice(0, 28))}`);
  }
  console.log(`\n${bad ? "SELFTEST FAIL" : "SELFTEST PASS"} — ${cases.length + markerCases.length - bad}/${cases.length + markerCases.length}`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- static ----

for (const rel of MUST_BE_SERVER_ONLY) {
  const p = join(root, rel);
  const body = existsSync(p) ? readFileSync(p, "utf8") : "";
  ok(`${rel} is marked server-only`, SERVER_ONLY_MARKER.test(body),
    "the marker that makes a client import a build error is missing");
}

const allSources = sources(join(root, "app"))
  .concat(sources(join(root, "lib")))
  .concat(sources(join(root, "components")));

// Nothing outside the billing server layer may import a server-only module.
const serverOnlySpecifiers = MUST_BE_SERVER_ONLY.map((r) => "@/" + r.replace(/\.ts$/, ""));
const ALLOWED_IMPORTERS = /^(lib[\\/]billing[\\/]|app[\\/]api[\\/]billing[\\/])/;
const badImporters = [];
const clientImporters = [];
for (const file of allSources) {
  const rel = relative(root, file);
  const raw = readFileSync(file, "utf8");
  const body = code(raw);
  const imports = serverOnlySpecifiers.filter((s) => body.includes(s));
  if (imports.length === 0) continue;
  if (!ALLOWED_IMPORTERS.test(rel)) badImporters.push(`${rel} imports ${imports.join(", ")}`);
  if (/^\s*["']use client["']/m.test(raw)) clientImporters.push(rel);
}
ok("only the billing server layer imports the server-only modules", badImporters.length === 0, badImporters.join("; "));
ok("no client component imports a server-only billing module", clientImporters.length === 0, clientImporters.join(", "));

// A secret must not be read outside a module that is provably server-side.
//
// Two things qualify. `import "server-only"` is one. The other is an App Router
// route handler: `app/**/route.ts` is never part of a client bundle — it has no
// React component to render and Next compiles it only for the server — so the
// webhook route reading STRIPE_WEBHOOK_SECRET is correct by construction rather
// than by a marker.
const ROUTE_HANDLER = /^app[\\/].*[\\/]route\.ts$/;
const secretReaders = [];
for (const file of allSources) {
  const rel = relative(root, file);
  const raw = readFileSync(file, "utf8");
  const body = code(raw);
  if (!SECRET_ENV_NAMES.some((n) => body.includes(n))) continue;
  if (SERVER_ONLY_MARKER.test(raw) || ROUTE_HANDLER.test(rel)) continue;
  secretReaders.push(rel);
}
ok("every module that names a secret is server-side by construction", secretReaders.length === 0, secretReaders.join(", "));

// A secret must never be published through NEXT_PUBLIC_.
const published = [];
for (const file of allSources) {
  const body = code(readFileSync(file, "utf8"));
  for (const name of SECRET_ENV_NAMES) {
    if (new RegExp(`NEXT_PUBLIC_[A-Z0-9_]*${name}`).test(body)) published.push(`${relative(root, file)}: ${name}`);
  }
  if (/NEXT_PUBLIC_STRIPE_SECRET|NEXT_PUBLIC_[A-Z0-9_]*WEBHOOK_SECRET/.test(body)) {
    published.push(`${relative(root, file)}: a NEXT_PUBLIC_ name carries a Stripe secret`);
  }
}
ok("no Stripe or privileged secret is exposed through NEXT_PUBLIC_", published.length === 0, published.join("; "));

// One predicate (§2).
const leaks = [];
for (const file of allSources) {
  const rel = relative(root, file);
  // The predicate itself, and the suite that proves it, necessarily name the
  // statuses. Everything else must call `hasPaidAccess`.
  if (rel === join("lib", "billing", "entitlement.ts") || rel === join("lib", "billing", "selftest.ts")) continue;
  const found = entitlementLeaks(readFileSync(file, "utf8"));
  if (found.length) leaks.push(`${rel}: ${found.join(", ")}`);
}
ok("entitlement is decided in exactly one place", leaks.length === 0, leaks.join("; "));

// The environment documentation must name the variables and carry no values.
const envExample = existsSync(join(root, ".env.example")) ? readFileSync(join(root, ".env.example"), "utf8") : "";
const documented = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_ANNUAL"];
ok(".env.example documents every Stripe variable",
  documented.every((n) => new RegExp(`^${n}=`, "m").test(envExample)),
  documented.filter((n) => !new RegExp(`^${n}=`, "m").test(envExample)).join(", "));
ok(".env.example carries no Stripe secret VALUE",
  !/^STRIPE_SECRET_KEY=\S/m.test(envExample) && !/^STRIPE_WEBHOOK_SECRET=\S/m.test(envExample),
  "a placeholder file must stay empty on the right-hand side");
ok("no live Stripe key shape appears anywhere in tracked source",
  !allSources.some((f) => /\bsk_live_[A-Za-z0-9]{10,}/.test(readFileSync(f, "utf8"))));

// ----------------------------------------------------------------- build ----

function treeIsCurrent() {
  const probe = join(OUT, "lib", "billing", "selftest.js");
  if (!existsSync(probe)) return false;
  const built = statSync(probe).mtimeMs;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (walk(p)) return true; }
      else if (/\.tsx?$/.test(e.name) && statSync(p).mtimeMs > built) return true;
    }
    return false;
  };
  return !(walk(join(root, "lib")) || walk(join(root, "types")) || walk(join(root, "app", "api", "billing")));
}

if (treeIsCurrent()) {
  console.log("\n· reusing the compiled tree at scripts/out (current)");
} else {
  process.stdout.write("\n· compiling lib/, types/ and app/api/billing to scripts/out … ");
  try {
    execFileSync("npx", ["tsc", "-p", "tsconfig.selftest.json"], { cwd: root, stdio: "pipe" });
    console.log("done");
  } catch (e) {
    console.log("FAILED");
    console.log(String(e.stdout ?? "") + String(e.stderr ?? ""));
    ok("the billing suite can be built", false, "tsc failed, so nothing below was proved");
    report();
  }
}

// ------------------------------------------------------------------ pure ----

{
  const runner = `
    const path = require("path"), Module = require("module");
    const ROOT = ${JSON.stringify(OUT)};
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (r, ...a) {
      if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2));
      try { return orig.call(this, r, ...a); }
      catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: [${JSON.stringify(join(root, "node_modules"))}] }); }
    };
    const { runBillingSelfTests } = require(path.join(ROOT, "lib/billing/selftest.js"));
    const report = runBillingSelfTests();
    for (const r of report.results) if (!r.pass) console.log("  ✗ " + r.name + " — " + (r.detail ?? ""));
    console.log("SUMMARY " + report.passed + "/" + report.total);
  `;
  const run = spawnSync(process.execPath, ["-e", runner], { cwd: root, encoding: "utf8" });
  const stdout = (run.stdout ?? "") + (run.stderr ?? "");
  const m = /SUMMARY (\d+)\/(\d+)/.exec(stdout);
  if (!m || m[1] !== m[2]) console.log(stdout);
  ok("lib/billing/selftest.ts — plans, entitlement, projection, events, gate",
    run.status === 0 && m !== null && m[1] === m[2],
    m ? `${m[1]}/${m[2]}` : "the suite did not finish");
  // A suite that silently stopped constructing assertions would report 0/0.
  ok("the pure suite still carries its assertions", m !== null && Number(m[2]) >= 90,
    m ? `only ${m[2]} assertions` : "no summary");
}

// ---------------------------------------------------------------- routes ----

{
  const harness = join(root, "scripts", "inject-billing-routes.cjs");
  const run = spawnSync(process.execPath, [harness], { cwd: root, encoding: "utf8" });
  const stdout = (run.stdout ?? "") + (run.stderr ?? "");
  const m = /===\s*(\d+)\s*\/\s*(\d+)\s+billing route assertions\s*===/.exec(stdout);
  const fails = stdout.split("\n").filter((l) => /^FAIL\b/.test(l.trim()));
  if (!m || m[1] !== m[2] || fails.length) console.log(stdout);
  ok("inject-billing-routes.cjs — checkout, portal, webhook, idempotency, isolation",
    run.status === 0 && m !== null && fails.length === 0 && m[1] === m[2],
    m ? `${m[1]}/${m[2]}, ${fails.length} explicit failure(s)` : "the harness did not finish");
  ok("the route harness still carries its assertions", m !== null && Number(m[2]) >= 60,
    m ? `only ${m[2]} assertions` : "no summary");
}

report();

function report() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${failed.length ? "BILLING AUDIT FAIL" : "BILLING AUDIT PASS"} — ${results.length - failed.length}/${results.length} checks`);
  if (failed.length) {
    console.log("\nA failure here means paid access can be granted without payment, or a");
    console.log("secret can reach a browser. Do not deploy on this result.");
    process.exit(1);
  }
  process.exit(0);
}
