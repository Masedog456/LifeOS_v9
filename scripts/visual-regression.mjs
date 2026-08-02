#!/usr/bin/env node
/**
 * Deterministic visual-regression capture (LIFEOS-042, Feature 23).
 *
 * Captures deterministic screenshots of the key desktop and mobile surfaces
 * against a running server (BASE, default http://localhost:3111). State is
 * seeded deterministically (empty account by default) so re-runs are stable.
 * Screenshots land in release-evidence/screenshots/ for explicit human review —
 * baselines are approved by a person, never blindly overwritten.
 *
 * Usage: BASE=<url> node scripts/visual-regression.mjs
 */

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE || "http://localhost:3111";
const OUT = join(root, "release-evidence", "screenshots");
mkdirSync(OUT, { recursive: true });

const DESKTOP = [
  ["today", "/today"], ["capture", "/"], ["actions", "/actions"], ["planning", "/plan"],
  ["focus", "/focus"], ["daily", "/daily"], ["reading", "/reading"], ["knowledge", "/world"],
  ["maintenance", "/maintenance"], ["insights", "/insights"], ["help", "/help"],
  ["privacy", "/privacy"], ["backup", "/backup"], ["recovery", "/recovery"],
  ["diagnostics", "/security"], ["onboarding", "/onboarding"], ["release", "/release"],
];
const MOBILE = [
  ["today", "/today"], ["capture", "/"], ["actions", "/actions"], ["planning", "/plan"],
  ["focus", "/focus"], ["reading", "/reading"], ["maintenance", "/maintenance"],
  ["insights", "/insights"], ["recovery", "/recovery"], ["onboarding", "/onboarding"],
];

function seed() {
  if (localStorage.getItem("lifeos.prefs.v1")) return;
  localStorage.setItem("lifeos.prefs.v1", JSON.stringify({}));
}

async function shoot(browser, label, path, viewport, tag) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(OUT, `${tag}-${label}.png`), fullPage: false });
    return { label: `${tag}/${label}`, ok: errs.length === 0, overflow, errs };
  } catch (e) {
    return { label: `${tag}/${label}`, ok: false, overflow: false, errs: [e.message] };
  } finally {
    await ctx.close();
  }
}

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
  const results = [];
  for (const [label, path] of DESKTOP) results.push(await shoot(browser, label, path, { width: 1280, height: 900 }, "desktop"));
  for (const [label, path] of MOBILE) results.push(await shoot(browser, label, path, { width: 390, height: 844 }, "mobile"));
  await browser.close();

  let fails = 0;
  for (const r of results) {
    const overflowNote = r.overflow ? " [H-OVERFLOW]" : "";
    if (!r.ok || r.overflow) fails++;
    console.log(`${r.ok && !r.overflow ? "✓" : "✗"} ${r.label}${overflowNote}${r.errs.length ? " — " + r.errs[0] : ""}`);
  }
  console.log(`\n${fails === 0 ? "VISUAL REGRESSION PASS" : "VISUAL REGRESSION FAIL"} — ${results.length - fails}/${results.length} surfaces clean → ${OUT}`);
  process.exit(fails === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
