#!/usr/bin/env node
/**
 * LIFEOS-107 — one canonical interpretation of today, in a real browser.
 *
 * The deterministic suite proves the projection. This proves the page: a record
 * the user planned appears ONCE on `/today` rather than once as a DO row and
 * again in the Plan card, nothing a review chose for another day leaks onto it,
 * and the planning entry point still carries what Today genuinely does not know.
 *
 * Nothing here may throw when a selector is missing — a scenario that cannot
 * find its element records a FAILED assertion, because a crash is not a caught
 * defect.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
let VP = "DESKTOP";
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail, vp: VP });
  console.log(`${cond ? "  ok  " : "  FAIL"} [${VP}] ${name}${cond ? "" : ` — ${detail}`}`);
};

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));
const day = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const st = "2026-08-01T09:00:00.000Z";
const ACT = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: st, updatedAt: st, ...p });
const REVIEW = (date, refId) => ({
  id: `rev-${date}`, date, status: "completed", summary: "", wins: [], lessons: [],
  friction: [], openLoops: [], notes: "", linkedGoals: [], linkedProjects: [],
  linkedWorkspaces: [], linkedEntities: [],
  tomorrowFocus: [{ id: `f-${date}`, text: "chosen last night",
    ref: { kind: "action", id: refId }, order: 0, createdAt: `${date}T20:00:00.000Z` }],
  createdAt: `${date}T20:00:00.000Z`, updatedAt: `${date}T20:00:00.000Z`,
});
const ASSIGN = (id) => ({ id: `pa-${id}`, ref: { kind: "action", id }, horizon: "today", order: 0,
  createdAt: st, updatedAt: st, history: [{ id: `ph-${id}`, action: "planned", at: st, toHorizon: "today" }] });

async function seed(page, world, route = "/today") {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1300);
}
const mainText = (page) => page.evaluate(() => {
  const m = document.querySelector("main"); return m ? m.textContent || "" : ""; });
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
/** How many ROWS (not prose mentions) carry this title. */
const rows = (page, title) => page.evaluate((t) => {
  const sels = "[data-today-action],[data-today-fixed],[data-plan-item],[data-open-work],section[aria-label='Plan'] p";
  return [...document.querySelectorAll(sels)].filter((e) => (e.textContent || "").includes(t)).length;
}, title);

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. one record, one row -------------------------------------------
  {
    const w = EMPTY();
    w.nextActions = [
      ACT({ id: "planned", title: "ZZPLANNED draft the brochure" }),
      ACT({ id: "prog", title: "ZZPROG in progress thing", status: "in_progress" }),
      ACT({ id: "due", title: "ZZDUE send the invoice", dueDate: day(0) }),
    ];
    w.planningAssignments = [ASSIGN("planned")];
    await seed(page, w);
    ok("1 a planned action occupies exactly one row on Today",
      (await rows(page, "ZZPLANNED")) === 1, `${await rows(page, "ZZPLANNED")} rows`);
    ok("1b an in-progress action occupies exactly one row too",
      (await rows(page, "ZZPROG")) === 1, `${await rows(page, "ZZPROG")} rows`);
    // The neighbour: it is still on the page, owned by the surface whose job it is.
    ok("1c …and it is still there, in Today's own list",
      (await mainText(page)).includes("ZZPLANNED"));
    ok("1d the planning entry point survives", (await count(page, "section[aria-label='Plan']")) === 1);
    ok("1e …still saying how much is planned",
      /in today's plan/i.test(await mainText(page)));
  }

  // ---- 2. a focus chosen for another day never reaches Today -------------
  {
    // A pinned action keeps the plan non-empty, so the COUNT is the measure:
    // the stale focus must not be added to it. (The stale record may still be
    // on the page as ordinary open work — that is Today doing its own job, and
    // is not the claim under test.)
    const w = EMPTY();
    w.nextActions = [
      ACT({ id: "old", title: "ZZSTALE chosen in january" }),
      ACT({ id: "pin", title: "ZZPIN pinned thing", pinned: true }),
    ];
    w.dailyReviews = [REVIEW("2026-01-04", "old")];
    await seed(page, w);
    const planLine = await page.evaluate(() => {
      const s = document.querySelector("section[aria-label='Plan']");
      return s ? (s.textContent || "").replace(/\s+/g, " ") : "";
    });
    ok("2 a focus chosen eight months ago is not counted in today's plan",
      /1 in today's plan/.test(planLine), planLine);
    // The neighbour: last night's choice does.
    const w2 = EMPTY();
    w2.nextActions = [ACT({ id: "live", title: "ZZFRESH chosen last night" })];
    w2.dailyReviews = [REVIEW(day(-1), "live")];
    await seed(page, w2);
    ok("2b …while last night's choice does", (await mainText(page)).includes("ZZFRESH"));
    ok("2c …once", (await rows(page, "ZZFRESH")) <= 1, `${await rows(page, "ZZFRESH")} rows`);
  }

  // ---- 3. a finished record cannot be kept alive by a focus note ---------
  {
    const w = EMPTY();
    w.nextActions = [ACT({ id: "done", title: "ZZDONE finished overnight", status: "completed" })];
    w.dailyReviews = [REVIEW(day(-1), "done")];
    await seed(page, w);
    ok("3 a completed record chosen last night does not reach Today",
      !(await mainText(page)).includes("ZZDONE"));
    ok("3b …and Today does not claim a plan it does not have",
      (await count(page, "section[aria-label='Plan']")) === 0);
  }

  // ---- 4. /plan/today describes what it actually contains ---------------
  {
    const w = EMPTY();
    w.nextActions = [ACT({ id: "p1", title: "ZZPIN pinned thing", pinned: true })];
    await seed(page, w, "/plan/today");
    const t = await mainText(page);
    ok("4 the planning page no longer claims nothing is inferred",
      !/Nothing here is inferred/i.test(t), t.slice(0, 120));
    ok("4b …and the derived item it holds is still listed",
      (await count(page, "[data-plan-item]")) === 1);
    ok("4c …with its reason on the row", /pinned/i.test(t));
  }

  // ---- 5. mobile, and nothing threw --------------------------------------
  {
    VP = "MOBILE";
    await page.setViewportSize({ width: 390, height: 844 });
    // Three actions, as in scenario 1: with only one live item it becomes the
    // SUGGESTION and is lifted out of the DO list (§24), which would leave this
    // measuring the wrong thing.
    const w = EMPTY();
    w.nextActions = [
      ACT({ id: "planned", title: "ZZPLANNED draft the brochure" }),
      ACT({ id: "prog", title: "ZZPROG in progress thing", status: "in_progress" }),
      ACT({ id: "due", title: "ZZDUE send the invoice", dueDate: day(0) }),
    ];
    w.planningAssignments = [ASSIGN("planned")];
    await seed(page, w);
    ok("5 one row on a phone too", (await rows(page, "ZZPLANNED")) === 1,
      `${await rows(page, "ZZPLANNED")} rows`);
    ok("5b …and the page does not scroll sideways",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    VP = "DESKTOP";
    ok("5c no page errors in any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} one-today browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
