#!/usr/bin/env node
/**
 * Closed-beta production smoke test (LIFEOS-048).
 *
 * A fast, NON-DESTRUCTIVE post-deploy check that answers one question:
 * "Can a user still safely reach and load the core product?"
 *
 * Run after any deployment:
 *   BETA_URL=https://your-app.example npm run beta:smoke
 *
 * It checks only what can be verified from the outside without touching a real
 * user's data:
 *   - production reachable (root 200/OK)
 *   - security headers present (CSP without unsafe-eval, HSTS, nosniff, frame deny)
 *   - core client routes load without a server error (no 5xx)
 *   - /dev test routes are NOT reachable in production (gated)
 *   - Supabase project reachable IF NEXT_PUBLIC_SUPABASE_URL is provided
 *
 * Deep authenticated persistence / two-user RLS is intentionally OUT OF SCOPE
 * here — that is the job of `npm run validate:reading-originals-live` (disposable
 * users) and the manual founder pack. This smoke never signs in, never writes,
 * and never deletes anything. Exit 0 only if every mandatory check passes.
 */

const BASE = (process.env.BETA_URL || process.env.PROD_URL || "").replace(/\/+$/, "");
if (!BASE) {
  console.error("beta-smoke: set BETA_URL=https://your-deployed-app  (the production URL to check).");
  process.exit(2);
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };

async function head(path) {
  try { const r = await fetch(`${BASE}${path}`, { redirect: "manual" }); return r; } catch (e) { return { status: `ERR:${e.message}`, headers: new Map() }; }
}

async function run() {
  // 1. Root reachable + is HTTPS.
  ok("uses HTTPS", BASE.startsWith("https://"), BASE.split("://")[0]);
  const root = await head("/");
  const rs = root.status;
  ok("production root reachable", typeof rs === "number" && rs < 500 && rs !== 404, `status ${rs}`);

  // 2. Security headers on the document response.
  const h = (k) => (root.headers?.get ? root.headers.get(k) : undefined) || "";
  const csp = h("content-security-policy");
  ok("CSP present", !!csp, csp ? "set" : "missing");
  ok("CSP has no unsafe-eval", !!csp && !/unsafe-eval/.test(csp), csp && /unsafe-eval/.test(csp) ? "FOUND unsafe-eval" : "");
  ok("CSP frame-ancestors none", /frame-ancestors 'none'/.test(csp));
  ok("HSTS present", !!h("strict-transport-security"));
  ok("X-Content-Type-Options nosniff", h("x-content-type-options").toLowerCase() === "nosniff");
  ok("Referrer-Policy present", !!h("referrer-policy"));
  ok("Frame protection (X-Frame-Options/CSP)", h("x-frame-options").toUpperCase() === "DENY" || /frame-ancestors 'none'/.test(csp));

  // 3. Core client routes load without a server error.
  for (const r of ["/today", "/reading", "/review", "/privacy", "/help"]) {
    const s = (await head(r)).status;
    ok(`route ${r} no server error`, typeof s === "number" && s < 500, `status ${s}`);
  }

  // 4. /dev test surfaces must be gated OFF in production.
  const dev = (await head("/dev/reading-ingest-tests")).status;
  ok("/dev routes gated in production", dev === 404, `expected 404, got ${dev}`);

  // 5. Supabase reachable (only if the public URL is provided to this smoke).
  if (SUPABASE_URL) {
    let up = false;
    try { const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/health`); up = r.status < 500; } catch { up = false; }
    ok("Supabase auth endpoint reachable", up);
  } else {
    console.log("  (skipping Supabase reachability — NEXT_PUBLIC_SUPABASE_URL not provided to the smoke)");
  }

  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const allPass = passed === results.length;
  console.log(`\n${allPass ? "BETA SMOKE PASS" : "BETA SMOKE FAIL"} — ${passed}/${results.length} (${BASE})`);
  process.exit(allPass ? 0 : 1);
}
run();
