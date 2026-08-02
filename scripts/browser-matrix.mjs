#!/usr/bin/env node
/**
 * Browser matrix smoke (LIFEOS-042, Feature 17).
 *
 * HONEST scope: this environment can only drive the bundled headless Chromium.
 * It runs a critical-flow smoke on Chromium (app shell, Today, Capture, Help,
 * Onboarding, Diagnostics) and records the engine/version actually tested. It
 * does NOT — and must not — claim Firefox/Safari/Edge/iOS/Android support: those
 * rows are marked "manual required" in V1_BROWSER_SUPPORT.md and must be run on
 * real browsers before GA. Writes release-evidence/browser-matrix.json.
 *
 * Usage: BASE=<url> node scripts/browser-matrix.mjs
 */

import { chromium } from "playwright-core";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://localhost:3111";
const evidenceDir = join(root, "release-evidence");

const FLOWS = [["app-shell", "/today"], ["capture", "/"], ["help", "/help"], ["onboarding", "/onboarding"], ["diagnostics", "/security"]];

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
  const version = browser.version();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { if (!localStorage.getItem("lifeos.prefs.v1")) localStorage.setItem("lifeos.prefs.v1", "{}"); });
  const page = await ctx.newPage();
  const results = [];
  for (const [name, path] of FLOWS) {
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    let ok = false;
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
      ok = !!res && res.status() < 500 && errs.length === 0;
    } catch (e) { errs.push(e.message); }
    results.push({ flow: name, ok, errs });
    console.log(`${ok ? "✓" : "✗"} chromium ${name}${errs.length ? " — " + errs[0] : ""}`);
  }
  await browser.close();

  const matrix = {
    testedAt: new Date().toISOString().slice(0, 10),
    automated: [{ engine: "Chromium (Playwright)", version, platform: "linux-headless", flows: results }],
    manualRequired: [
      { browser: "Chrome (stable)", platform: "desktop" }, { browser: "Edge (stable)", platform: "desktop" },
      { browser: "Firefox (stable)", platform: "desktop" }, { browser: "Safari (stable)", platform: "macOS" },
      { browser: "iOS Safari", platform: "iOS" }, { browser: "Android Chrome", platform: "Android" },
    ],
    note: "Only headless Chromium was automated here. Real-browser rows must be executed manually before GA; do not claim support for untested browsers.",
  };
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "browser-matrix.json"), JSON.stringify(matrix, null, 2));

  const passed = results.filter((r) => r.ok).length;
  const allPass = passed === results.length;
  console.log(`\nchromium ${version} · ${passed}/${results.length} flows · 6 real-browser rows still MANUAL`);
  console.log(allPass ? "BROWSER MATRIX (chromium) PASS" : "BROWSER MATRIX (chromium) FAIL");
  process.exit(allPass ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
