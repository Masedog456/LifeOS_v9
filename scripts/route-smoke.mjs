#!/usr/bin/env node
/**
 * Production route smoke (LIFEOS-042, Features 3 & 13).
 *
 * Against a running server (BASE, default http://localhost:3111), asserts every
 * production route responds without a server error and that NO /dev/* route is
 * reachable when dev routes are not enabled (production-gated). Complements the
 * static route model in lib/release/routes.ts with a live availability check.
 *
 * Usage: BASE=<url> [DEV_ENABLED=1] node scripts/route-smoke.mjs
 *   DEV_ENABLED=1 relaxes the /dev exclusion check (for a dev-enabled build).
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://localhost:3111";
const DEV_ENABLED = process.env.DEV_ENABLED === "1";

// Resolve the production route list from the release inventory.
const listScript = `
  const path=require("path"); const Module=require("module");
  const ts=require(path.join(process.cwd(),"node_modules/typescript"));
  const alias=(r)=>r.startsWith("@/")?path.join(process.cwd(),r.slice(2)):r;
  const o=Module._resolveFilename; Module._resolveFilename=function(r,...a){return o.call(this,alias(r),...a);};
  require.extensions[".ts"]=function(m,f){const s=require("fs").readFileSync(f,"utf8");
    const out=ts.transpileModule(s,{compilerOptions:{module:"commonjs",target:"es2020",esModuleInterop:true,jsx:"react"},fileName:f}).outputText; m._compile(out,f);};
  const inv=require(path.join(process.cwd(),"lib/release/inventory.ts"));
  process.stdout.write(JSON.stringify(inv.productionRoutes()));
`;
// Surfaces that are not directly-navigable index routes: /document requires a
// document id (/document/[id]) and /search is the command-palette overlay, not
// a standalone page. They are audited as surfaces, not fetched as index routes.
const NON_INDEX = new Set(["/document", "/search"]);
const routes = JSON.parse(execFileSync("node", ["-e", listScript], { cwd: root, encoding: "utf8" })).filter((r) => !NON_INDEX.has(r));

const results = [];
const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "" : detail });

async function status(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    return res.status;
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

async function run() {
  for (const r of routes) {
    const s = await status(r);
    // A production route must not be a server error and must not be a hard 404.
    ok(`route ${r} responds`, typeof s === "number" && s < 500 && s !== 404, `status ${s}`);
  }
  // /dev exclusion: a representative dev route must 404 unless dev is enabled.
  const devStatus = await status("/dev/cohesion-tests");
  if (DEV_ENABLED) {
    ok("dev route reachable (dev-enabled build)", typeof devStatus === "number" && devStatus < 500, `status ${devStatus}`);
  } else {
    ok("dev route excluded in production", devStatus === 404, `expected 404, got ${devStatus}`);
  }

  for (const r of results) console.log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : " — " + r.detail}`);
  const passed = results.filter((r) => r.pass).length;
  const allPass = passed === results.length;
  console.log(`\n${allPass ? "ROUTE SMOKE PASS" : "ROUTE SMOKE FAIL"} — ${passed}/${results.length} (BASE=${BASE}, dev ${DEV_ENABLED ? "enabled" : "excluded"})`);
  process.exit(allPass ? 0 : 1);
}
run();
