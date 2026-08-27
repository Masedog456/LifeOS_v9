/**
 * LIFEOS-074 §3 part 3 — REAL BROWSER failure injection.
 *
 * §9 refresh mid-mutation, and the §10 question the model layer cannot answer:
 * when a local save fails, does the person who just saw "Completed" have ANY
 * visible signal that nothing was written?
 */
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3111";
const results = [];
let MOBILE = false;
const ok = (n, p, d) => { results.push({ n, p, d, mobile: MOBILE }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const K = "lifeos.mvp.v1";
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = dk(0), OLD = dk(-120);
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const D = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = Object.fromEntries(D.map((d) => [d, []]));
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const WORLD = { nextActions: [
  act({ id: "a1", title: "ZZFileReturn", createdAt: iso(OLD), dueDate: T }),
  act({ id: "a2", title: "ZZTakeMeds", createdAt: iso(OLD), dueDate: T, recurrence: { frequency: "daily", interval: 1 } }),
  act({ id: "a3", title: "ZZSpare", createdAt: iso(OLD) }),
] };

/** Break localStorage.setItem for the app's key only, from inside the page. */
const BREAK = `(() => {
  const proto = Object.getPrototypeOf(window.localStorage);
  const real = proto.setItem;
  window.__realSetItem = real.bind(window.localStorage);
  proto.setItem = function (k, v) {
    if (k === "lifeos.mvp.v1") throw new Error("QuotaExceededError: injected");
    return real.call(this, k, v);
  };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 2200 } });
  let page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const seed = async (route) => {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(([k, e, p]) => localStorage.setItem(k, JSON.stringify({ ...e, ...p })), [K, EMPTY, WORLD]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
  };
  const goto = async (r) => { await page.goto(BASE + r, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1300); };
  const disk = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), K);
  const clickText = async (re) => {
    for (const b of await page.$$("button, a")) {
      const t = (await b.innerText()).trim();
      if (re.test(t) && await b.isVisible()) { await b.click(); await page.waitForTimeout(800); return true; }
    }
    return false;
  };
  /**
   * The save indicator, measured. Its label is a bare text node inside a span
   * that has element children, so a leaf-element text walk never sees it — that
   * is exactly what reported "no visible signal" on desktop in the first run,
   * where the element is in fact 106x16 and correct.
   */
  const syncIndicator = () => page.evaluate(() => {
    const el = document.querySelector("[data-sync-status]");
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
  });
  const visibleText = () => page.evaluate(() => {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        const s = getComputedStyle(c);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") continue;
        if (c.children.length === 0 && c.textContent.trim()) out.push(c.textContent.trim());
        walk(c);
      }
    };
    walk(document.body);
    return out.join(" | ");
  });

  // ======================================================================
  // §10. FALSE SUCCESS — desktop
  // ======================================================================
  await seed("/actions/a1");
  await page.evaluate(BREAK);
  const before = await disk();
  ok("B1 the record is on disk before the injected failure",
    before.nextActions.find((a) => a.id === "a1")?.status === "open");

  await clickText(/^Complete$/);
  await clickText(/^Mark complete$/);
  await page.waitForTimeout(900);
  const after = await disk();
  ok("B2 the local write really did fail — disk is unchanged",
    after.nextActions.find((a) => a.id === "a1")?.status === "open",
    after.nextActions.find((a) => a.id === "a1")?.status);
  const vis = await visibleText();
  ok("B3 the UI shows the mutation as applied in memory", /Done|Completed/i.test(vis), "status not updated");
  ok("B4 a success toast was shown", /Completed/.test(vis), vis.slice(0, 200));
  const ind = await syncIndicator();
  ok("B5 DESKTOP: a VISIBLE indicator contradicts the success claim",
    ind.found && /Local save failed/.test(ind.text) && ind.w > 0 && ind.h > 0 && ind.display !== "none",
    JSON.stringify(ind));

  // Reload: the mutation must be gone, and nothing may claim otherwise.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const status = await page.$eval("[data-action-status]", (n) => n.innerText.trim()).catch(() => null);
  ok("B6 after a reload the lost mutation is visibly gone (no stale success)",
    !/Done|Completed/i.test(status ?? ""), String(status));

  // ======================================================================
  // §10. FALSE SUCCESS — the health page must not claim saved
  // ======================================================================
  await seed("/actions/a1");
  await page.evaluate(BREAK);
  await clickText(/^Defer$/); await clickText(/^Someday$/);
  await page.waitForTimeout(700);
  // A FULL page load wipes module state, so a freshly-loaded health page has no
  // failure to report and honestly says "ok" — asserting on that was a harness
  // error. The real question is a CLIENT-SIDE navigation, where the failing
  // context is still alive.
  await page.evaluate(() => { window.__ctx = "alive"; });
  await page.evaluate(() => {
    const more = [...document.querySelectorAll("nav button")].find((b) => /More/.test(b.textContent || ""));
    if (more) more.click();
  });
  await page.waitForTimeout(500);
  const healthLink = await page.$('a[href="/health"]');
  if (healthLink) await healthLink.click();
  await page.waitForTimeout(1800);
  const ctxAlive = await page.evaluate(() => window.__ctx || "WIPED");
  ok("B7a the health page was reached without discarding the failing context", ctxAlive === "alive", ctxAlive);
  const health = await page.evaluate(() => document.body.innerText);
  ok("B7 System Health reports the local save failure", /Local save\s*\n?\s*Local save failed|Local save failed/i.test(health),
    JSON.stringify((health.match(/Local save[\s\S]{0,40}/) || [])[0]));
  ok("B8 …and does not claim the local copy is ok", !/Local save\s*\n\s*ok/i.test(health),
    JSON.stringify((health.match(/Local save[\s\S]{0,40}/) || [])[0]));

  // ======================================================================
  // §9. REFRESH MID-MUTATION
  // ======================================================================
  const midRefresh = async (label, arm, verify) => {
    await seed("/actions/a1");
    await arm();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const d = await disk();
    ok(label, verify(d), JSON.stringify(d.nextActions.find((a) => a.id === "a1")));
  };

  await midRefresh("B9 refresh with a defer panel OPEN applies nothing",
    async () => { await clickText(/^Defer$/); },
    (d) => d.nextActions.find((a) => a.id === "a1").status === "open");
  ok("B10 …and the panel is not left open claiming a pending action",
    !(await page.$("button:has-text('Someday')")));

  await midRefresh("B11 refresh with a delete confirm ARMED deletes nothing",
    async () => { await page.click("[data-delete-action]"); await page.waitForTimeout(400); },
    (d) => !!d.nextActions.find((a) => a.id === "a1"));
  ok("B12 …and the armed confirm does not survive the refresh",
    !(await page.$("[data-confirm-delete]")));

  await midRefresh("B13 refresh with a waiting panel open records no wait",
    async () => { await clickText(/^Wait on…$/); await page.fill("input[aria-label='Waiting on']", "Marcus"); },
    (d) => d.nextActions.find((a) => a.id === "a1").status === "open");

  // A COMMITTED mutation must survive a refresh — the other half of the claim.
  await seed("/actions/a1");
  await clickText(/^Defer$/); await clickText(/^Someday$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const d2 = await disk();
  ok("B14 a COMMITTED mutation does survive the refresh", d2.nextActions.find((a) => a.id === "a1").status === "deferred");
  ok("B15 …exactly once, with no double-submit", (d2.nextActions.find((a) => a.id === "a1").history ?? []).filter((h) => h.action === "deferred").length === 1,
    JSON.stringify((d2.nextActions.find((a) => a.id === "a1").history ?? []).map((h) => h.action)));

  // Refresh during an occurrence completion, then repeat the click.
  await seed("/today");
  await page.click("[data-complete-occurrence]");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const d3 = await disk();
  ok("B16 an occurrence completion survives a refresh exactly once",
    (d3.recurrenceCompletions ?? []).length === 1, JSON.stringify(d3.recurrenceCompletions));
  const again = await page.$("[data-complete-occurrence]");
  if (again) { await again.click(); await page.waitForTimeout(800); }
  const d4 = await disk();
  ok("B17 …and a repeat press after the refresh does not duplicate it",
    (d4.recurrenceCompletions ?? []).length === 1, JSON.stringify(d4.recurrenceCompletions));

  await goto("/today/review");
  ok("B18 Review Today after a mid-mutation refresh reflects the persisted truth",
    /ZZTakeMeds/.test(await visibleText()), "occurrence missing from the day");

  // ======================================================================
  // §10 — MOBILE: is the contradiction visible on a phone?
  // ======================================================================
  MOBILE = true;
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  await seed("/actions/a1");
  // A CALM state may still hide on a phone — that is deliberate, and asserting
  // it keeps the fix honest about what it did and did not change.
  const clean = await syncIndicator();
  ok("B19 MOBILE: a healthy save state stays out of the way on a phone",
    clean.found && clean.display === "none", JSON.stringify(clean));

  await page.evaluate(BREAK);
  await clickText(/^Complete$/);
  await clickText(/^Mark complete$/);
  await page.waitForTimeout(900);
  const mAfter = await disk();
  ok("B20 MOBILE: the local write failed", mAfter.nextActions.find((a) => a.id === "a1")?.status === "open");
  const mVis = await visibleText();
  ok("B21 MOBILE: a success toast is shown", /Completed/.test(mVis), mVis.slice(0, 160));
  const mInd = await syncIndicator();
  ok("B22 MOBILE: a FAILED save is visible on a phone",
    mInd.found && /Local save failed/.test(mInd.text) && mInd.w > 0 && mInd.h > 0 && mInd.display !== "none",
    JSON.stringify(mInd));
  ok("B23 MOBILE: …and it sits inside the viewport", mInd.found && mInd.w <= 390, JSON.stringify(mInd));

  ok("Z1 no uncaught page errors during failure injection", errors.length === 0, JSON.stringify(errors.slice(0, 3)));

  await browser.close();
  const pass = results.filter((r) => r.p).length;
  const mob = results.filter((r) => r.mobile).length;
  console.log(`\n=== ${pass}/${results.length} browser failure-injection assertions (${results.length - mob} desktop, ${mob} mobile) ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
