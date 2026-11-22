#!/usr/bin/env node
/**
 * Browser regression smokes (PR 2) — `npm run test:browser`.
 *
 * Drives the feature-level Playwright scripts (scripts/smoke-0NN-*.cjs) against
 * an already-running build of the app, in LOCAL-ONLY mode: no Supabase project,
 * no AI key, no Stripe. Everything the scripts exercise lives in the browser's
 * localStorage, so nothing outside the machine is read or written.
 *
 * Usage:
 *   BASE=http://localhost:3111 CHROME=/usr/bin/google-chrome \
 *     node scripts/run-browser-smokes.mjs [--shard=1/3] [--only=094]
 *
 * A script PASSES only if it exits 0 AND its output contains no failure marker.
 * The second condition exists because at least one historical smoke
 * (smoke-074-sync-truth) prints FAILED lines and still exits 0; a gate must not
 * trust an exit code alone.
 *
 * Which scripts are in SMOKES, and which are deliberately not (with reasons), is
 * documented in docs/TESTING.md. Durations are seconds measured on a 2026-11-22
 * run and are used only to balance shards.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SMOKES = [
  ["smoke-078-goal-horizons.cjs", 25], ["smoke-079-personal-code.cjs", 25],
  ["smoke-080-capture-intelligence.cjs", 46], ["smoke-081-executive-memory.cjs", 23],
  ["smoke-082-executive-guidance.cjs", 26], ["smoke-083-command-center.cjs", 11],
  ["smoke-084-weekly-review.cjs", 9], ["smoke-085-universal-search.cjs", 25],
  ["smoke-086-people.cjs", 10], ["smoke-087-project-context.cjs", 7],
  ["smoke-088-goal-context.cjs", 8], ["smoke-089-capture-context.cjs", 26],
  ["smoke-090-replanning.cjs", 29], ["smoke-091-evening-close.cjs", 16],
  ["smoke-092-one-daily-review.cjs", 22], ["smoke-093-meaning-capture.cjs", 27],
  ["smoke-094-decision-inbox.cjs", 38], ["smoke-095-capture-home.cjs", 56],
  ["smoke-096-clean-outcomes.cjs", 38], ["smoke-097-capture-corrections.cjs", 46],
  ["smoke-098-outcome-coherence.cjs", 30], ["smoke-099-accessibility.cjs", 68],
  ["smoke-100-global-capture.cjs", 112], ["smoke-101-natural-language.cjs", 121],
  ["smoke-102-transparency.cjs", 109], ["smoke-103-follow-through.cjs", 85],
  ["smoke-104-today-surface.cjs", 45], ["smoke-105-lifecycle.cjs", 75],
  ["smoke-106-day-shape.cjs", 14], ["smoke-107-one-today.cjs", 10],
];
const FAILURE_MARKER = /^\s*(FAIL\b|✗)|\bFAILED\b/m;
const PER_SCRIPT_TIMEOUT_MS = 420_000;

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const BASE = process.env.BASE || "http://localhost:3111";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
if (!existsSync(CHROME)) {
  console.error(`run-browser-smokes: no browser at ${CHROME} (set CHROME)`);
  process.exit(1);
}
const host = new URL(BASE).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`run-browser-smokes: BASE must be a local server, got ${BASE} — these scripts never run against a deployment`);
  process.exit(1);
}
try {
  const r = await fetch(`${BASE}/today`);
  if (!r.ok) throw new Error(`status ${r.status}`);
} catch (e) {
  console.error(`run-browser-smokes: app not reachable at ${BASE}/today (${e.message}) — start it first`);
  process.exit(1);
}

// Greedy balance by measured duration so shards finish together.
let list = SMOKES.map(([f, s]) => ({ f, s }));
if (args.only) list = list.filter((x) => x.f.includes(args.only));
if (args.shard) {
  const [i, n] = args.shard.split("/").map(Number);
  if (!(i >= 1 && i <= n)) { console.error("--shard must be i/n with 1 <= i <= n"); process.exit(2); }
  const bins = Array.from({ length: n }, () => ({ t: 0, items: [] }));
  for (const x of [...list].sort((a, b) => b.s - a.s)) {
    const bin = bins.reduce((m, b) => (b.t < m.t ? b : m));
    bin.items.push(x);
    bin.t += x.s;
  }
  list = bins[i - 1].items.sort((a, b) => a.f.localeCompare(b.f));
}

const env = { ...process.env, BASE, CHROME };
for (const k of Object.keys(env)) {
  if (/(SUPABASE|POSTGRES|STRIPE|ANTHROPIC|OPENAI|SECRET|PASSWORD|API_KEY|TOKEN)/i.test(k)) delete env[k];
}

const rows = [];
for (const { f } of list) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(root, "scripts", f)], { cwd: root, env, encoding: "utf8", timeout: PER_SCRIPT_TIMEOUT_MS });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const marker = FAILURE_MARKER.test(out);
  const pass = r.status === 0 && !r.error && !marker;
  const summary = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
  rows.push({ f, pass, secs: Math.round((Date.now() - t) / 1000) });
  console.log(`${pass ? "ok  " : "FAIL"} ${f.padEnd(38)} ${String(Math.round((Date.now() - t) / 1000)).padStart(4)}s  ${summary.slice(0, 100)}`);
  if (!pass) {
    const why = r.error ? `error: ${r.error.message}` : r.status !== 0 ? `exit ${r.status}` : "exit 0 but printed a failure marker";
    console.log(`     ↳ ${why}\n${out.split("\n").filter((l) => FAILURE_MARKER.test(l) || /Error/.test(l)).slice(0, 15).map((l) => "       " + l).join("\n")}`);
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::error title=${f}::${why}`);
  }
}
const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} browser smoke scripts passed${args.shard ? ` (shard ${args.shard})` : ""}`);
console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed.length || rows.length === 0 ? 1 : 0);
