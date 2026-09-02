#!/usr/bin/env node
/**
 * LIFEOS-078 §13 — GOAL HORIZONS BROWSER TORTURE.
 *
 * Every claim measured on the RENDERED product, at two viewports.
 *
 * The reason this file exists and is not a selftest: the sprint's whole promise
 * is that a person can SEE where their life is going, and "the derivation
 * returns the right array" is not that. So the assertions read the DOM — what
 * groups appear, what a card says where "0% complete" used to sit, what the
 * history panel shows after a real click on a real select — and drive the store
 * through the page rather than calling into it.
 *
 * Run against a production build on :3111 with LIFEOS_ENABLE_DEV_ROUTES=1.
 */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const results = [];
let VP = "DESKTOP";
const ok = (n, p, d) => { results.push({ n, p, d, vp: VP }); console.log(`${p ? "PASS" : "FAIL"}  [${VP}] ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const iso = (h = 8) => `${dk(0)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const goal = (p) => ({
  title: "G", description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: iso(), updatedAt: iso(), ...p,
});
const proj = (p) => ({
  title: "P", description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: iso(), updatedAt: iso(), ...p,
});

/**
 * A life with direction at two horizons, one goal nobody has placed, one goal
 * with no work under it, and one replacement chain.
 */
const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: iso(), updatedAt: iso(), ...p,
});

const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g-now", title: "ZZFinishTheThesis", horizon: "now" }),
    goal({ id: "g-life", title: "ZZBeSomeoneTheyTrust", horizon: "life" }),
    goal({ id: "g-unset", title: "ZZNotPlacedYet" }),
    goal({ id: "g-nopath", title: "ZZLearnToSail", horizon: "near" }),
    goal({ id: "g-old", title: "ZZRunAMarathon", status: "replaced", successorGoalId: "g-new",
      history: [{ id: "h1", at: iso(9), kind: "replaced", fromStatus: "active", toStatus: "replaced", successorGoalId: "g-new" }] }),
    goal({ id: "g-new", title: "ZZMoveEveryDay", horizon: "medium" }),
    // §23.7 — a target date arriving with no active project under it. The
    // date must not become a horizon and must not manufacture urgency.
    goal({ id: "g-duesoon", title: "ZZSubmitTheApplication", horizon: "near", targetDate: dk(3) }),
    // §23.10 — a predecessor whose successor does not exist. Reachable through
    // an import or a deletion on another device.
    goal({ id: "g-dangling", title: "ZZOldDirection", status: "replaced", successorGoalId: "g-vanished",
      history: [{ id: "h9", at: iso(9), kind: "replaced", fromStatus: "active", toStatus: "replaced", successorGoalId: "g-vanished" }] }),
  ],
  projects: [proj({ id: "p1", title: "ZZChapterThree", goalId: "g-now" })],
  // §23.1 — the full ancestry chain, with a due date so it is recommendable.
  nextActions: [act({ id: "a1", title: "ZZDraftTheIntroduction", projectId: "p1", dueDate: dk(0) })],
});

const text = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
}, sel);

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2000 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    await page.goto(`${BASE}/goals`, { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(WORLD())]);
    await page.goto(`${BASE}/goals`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);

    /* ============================================================
     * 1. The index groups a life by horizon.
     * ============================================================ */
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll("[data-horizon-group]")].map((el) => ({
        h: el.getAttribute("data-horizon-group"),
        titles: [...el.querySelectorAll("[data-goal-card]")].map((c) => (c.querySelector("h3")?.textContent || "").trim()),
      })));

    ok("1.1 the goals index is grouped by horizon", groups.length >= 3, JSON.stringify(groups.map((g) => g.h)));
    ok("1.2 …nearest first, with the unplaced group LAST",
      groups[groups.length - 1].h === "unset", JSON.stringify(groups.map((g) => g.h)));
    ok("1.3 …and the order between horizons is now → near → medium → life",
      groups.filter((g) => g.h !== "unset").map((g) => g.h).join(",") === "now,near,medium,life",
      groups.map((g) => g.h).join(","));
    ok("1.4 a goal appears under the horizon it was given",
      (groups.find((g) => g.h === "life")?.titles ?? []).includes("ZZBeSomeoneTheyTrust"),
      JSON.stringify(groups.find((g) => g.h === "life")));
    ok("1.5 a goal with no horizon is shown, not hidden",
      (groups.find((g) => g.h === "unset")?.titles ?? []).includes("ZZNotPlacedYet"),
      JSON.stringify(groups.find((g) => g.h === "unset")));
    // A replaced goal is history; its successor is what is being pursued.
    const allTitles = groups.flatMap((g) => g.titles);
    ok("1.6 the SUCCESSOR appears on the index", allTitles.includes("ZZMoveEveryDay"), JSON.stringify(allTitles));

    // §11/§43 — the whole page, checked for a fabricated number.
    const pageText = await page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
    ok("1.7 §11 no goal card reports 0% of anything", !/\b0%/.test(pageText), (pageText.match(/.{0,40}0%.{0,20}/) ?? [""])[0]);
    ok("1.8 §43 no score, streak or alignment rating anywhere on the page",
      !/(alignment|momentum|streak|score)/i.test(pageText),
      (pageText.match(/.{0,40}(alignment|momentum|streak|score).{0,20}/i) ?? [""])[0]);
    ok("1.9 §11 …and unmeasured progress SAYS it is unmeasured",
      /Not measured yet/.test(pageText), "no honest empty-progress wording found");

    // The absence, which is the point of the view.
    const empty = await text(page, "[data-empty-horizons]");
    ok("1.10 horizons with nothing at them are stated once",
      !!empty && /Long/.test(empty), String(empty));
    ok("1.11 …without a verdict attached",
      !!empty && !/should|need|behind|neglect|empty life/i.test(empty), String(empty));

    if (isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("1.12 MOBILE the grouped index does not scroll sideways", overflow <= 1, `${overflow}px overflow`);
    }

    /* ============================================================
     * 2. The goal page: horizon, facts, lifecycle, history.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-now`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);

    const horizonValue = await page.evaluate(() => document.querySelector("[data-goal-horizon]")?.value ?? null);
    ok("2.1 the goal page shows the horizon the user set", horizonValue === "now", String(horizonValue));

    const facts = await text(page, "[data-goal-facts]");
    ok("2.2 alignment is reported as counts", !!facts && /1 active project/.test(facts), String(facts));
    ok("2.3 …and as a date, never a trend",
      !!facts && /(Last recorded activity|No recorded activity)/.test(facts), String(facts));
    ok("2.4 §11 the facts panel contains no percentage",
      !!facts && !/%/.test(facts), String(facts));

    // A real interaction, then a real re-read: the transition must be RECORDED.
    await page.selectOption("[data-goal-horizon]", "medium");
    await page.waitForTimeout(500);
    const history = await text(page, "[data-goal-history]");
    ok("2.5 changing the horizon records a dated transition",
      !!history && /Horizon Now → Medium/.test(history), String(history));
    ok("2.6 …and the change persisted to storage", await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k) || "{}");
      return (s.goals || []).find((g) => g.id === "g-now")?.horizon === "medium";
    }, KEY));
    // Append-only: selecting the SAME value again must not pad the record.
    const before = await page.evaluate(() => document.querySelector("[data-goal-history]")?.getAttribute("data-goal-history"));
    await page.selectOption("[data-goal-horizon]", "medium");
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.querySelector("[data-goal-history]")?.getAttribute("data-goal-history"));
    ok("2.7 re-selecting the same horizon writes no second entry", before === after, `${before} -> ${after}`);

    /* ============================================================
     * 3. A goal with no work under it says so — factually.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-nopath`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const missing = await text(page, "[data-goal-path-missing]");
    ok("3.1 a goal with no active project says so", !!missing && /No active project/.test(missing), String(missing));
    ok("3.2 …as a statement about the RECORD, not about the person",
      !!missing && !/(stuck|drift|behind|risk|failing|neglect|should)/i.test(missing), String(missing));
    ok("3.3 …and offers the move without performing it",
      await page.evaluate(() => !!document.querySelector('[data-goal-path-missing] a[href*="/projects?new=1"]')));

    /* ============================================================
     * 4. Replacement reads as a chain, not a graveyard.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-old`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const lineage = await text(page, "[data-goal-lineage]");
    ok("4.1 a replaced goal shows the chain it belongs to",
      !!lineage && /ZZRunAMarathon/.test(lineage) && /ZZMoveEveryDay/.test(lineage), String(lineage));
    const oldHistory = await text(page, "[data-goal-history]");
    ok("4.2 …and its history names what it became",
      !!oldHistory && /Replaced by .ZZMoveEveryDay./.test(oldHistory), String(oldHistory));
    const statusDisabled = await page.evaluate(() => {
      const sels = [...document.querySelectorAll("select")];
      const s = sels.find((x) => [...x.options].some((o) => o.value === "abandoned"));
      return s ? s.disabled : null;
    });
    ok("4.3 a replaced goal's status is not silently re-editable", statusDisabled === true, String(statusDisabled));

    // The predecessor is history; the successor is the live pursuit.
    await page.goto(`${BASE}/goal/g-new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const newLineage = await text(page, "[data-goal-lineage]");
    ok("4.4 the successor shows the SAME chain, read from the other end",
      !!newLineage && /ZZRunAMarathon/.test(newLineage), String(newLineage));

    /* ============================================================
     * 5. A goal that has never been touched is honest about it.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-unset`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const bare = await page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
    ok("5.1 §11 an untouched goal does not report 0% progress", !/\b0%/.test(bare), (bare.match(/.{0,40}0%.{0,20}/) ?? [""])[0]);
    ok("5.2 …it says the progress is not measured", /Not measured yet/.test(bare));
    ok("5.3 …and its horizon reads as unset, not as a default",
      await page.evaluate(() => document.querySelector("[data-goal-horizon]")?.value === ""));

    if (isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("5.4 MOBILE the goal page does not scroll sideways", overflow <= 1, `${overflow}px overflow`);
    }

    /* ============================================================
     * 6. §23.1 — Today ancestry, on the rendered Today page.
     *
     * Goal → Project → Action, with a due date so the action is
     * recommendable at all. The ancestry line is the sprint's only
     * change to Today, and §14 forbids it altering ordering.
     * ============================================================ */
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const why = await text(page, "[data-suggested-why]");
    ok("6.1 the recommendation explains which goal it serves",
      !!why && /Supports ZZFinishTheThesis through ZZChapterThree/.test(why), String(why));
    ok("6.2 §14 …and the explanation never mentions a horizon",
      !!why && !/\b(now|near|medium|long|life)\b/i.test(why.replace(/ZZ\w+/g, "")), String(why));
    const todayText = await page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
    ok("6.3 §14 no Goals dashboard section was added to Today",
      !/Goals? (dashboard|overview|horizons)/i.test(todayText),
      (todayText.match(/.{0,40}Goals? (dashboard|overview|horizons).{0,20}/i) ?? [""])[0]);
    ok("6.4 §15 a goal with no active project is reported factually on Today",
      !/no path forward|drifting|stuck/i.test(todayText),
      (todayText.match(/.{0,50}(no path forward|drifting|stuck).{0,20}/i) ?? [""])[0]);

    /* ============================================================
     * 7. §23.3/§23.4 — pause and achieve, through the real control,
     *    and the transitions they must record.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-life`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const statusSel = 'select:below(:text("Status"))';
    await page.evaluate(() => {
      const sels = [...document.querySelectorAll("select")];
      const s = sels.find((x) => [...x.options].some((o) => o.value === "paused"));
      if (s) { s.value = "paused"; s.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await page.waitForTimeout(500);
    const pausedHistory = await text(page, "[data-goal-history]");
    ok("7.1 §23.3 pausing a goal records the transition, naming both ends",
      !!pausedHistory && /Active → Paused/.test(pausedHistory), String(pausedHistory));
    await page.evaluate(() => {
      const sels = [...document.querySelectorAll("select")];
      const s = sels.find((x) => [...x.options].some((o) => o.value === "completed"));
      if (s) { s.value = "completed"; s.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await page.waitForTimeout(500);
    const achievedHistory = await text(page, "[data-goal-history]");
    ok("7.2 §23.4 achieving it records a SECOND entry, keeping the first",
      !!achievedHistory && /Paused → Achieved/.test(achievedHistory) && /Active → Paused/.test(achievedHistory),
      String(achievedHistory));
    ok("7.3 §16 …and a title edit does NOT pollute the lifecycle record",
      await page.evaluate(async () => {
        const before = document.querySelector("[data-goal-history]")?.getAttribute("data-goal-history");
        const ta = document.querySelector("#goal-notes");
        if (ta) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(ta, "a working note, typed");
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 400));
        return document.querySelector("[data-goal-history]")?.getAttribute("data-goal-history") === before;
      }));
    ok("7.4 §16 …and no history entry copies the goal's body",
      !!achievedHistory && !/a working note, typed/.test(achievedHistory), String(achievedHistory));

    /* ============================================================
     * 8. §23.6/§23.7 — dates and horizons stay independent.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-duesoon`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    ok("8.1 §23.7 a goal with an approaching target and no active project says so",
      !!(await text(page, "[data-goal-path-missing]")));
    ok("8.2 §11 …without manufacturing urgency about the date",
      await page.evaluate(() => !/(urgent|running out|hurry|only \d+ days)/i.test(document.body.textContent || "")));
    ok("8.3 §5 …and the target date did NOT become a horizon",
      await page.evaluate(() => document.querySelector("[data-goal-horizon]")?.value === "near"));
    await page.goto(`${BASE}/goal/g-life`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    ok("8.4 §23.6 a life goal with no target date is not asked for one",
      await page.evaluate(() => !/(needs a date|set a target|missing target)/i.test(document.body.textContent || "")));

    /* ============================================================
     * 9. §23.10 — the successor is gone. Degrade, never print an id.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-dangling`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const danglingText = await page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
    ok("9.1 a deleted successor degrades to a sentence",
      /has since been deleted/.test(danglingText),
      (danglingText.match(/.{0,60}deleted.{0,20}/) ?? [""])[0]);
    ok("9.2 …and the raw id is never rendered",
      !/g-vanished/.test(danglingText),
      (danglingText.match(/.{0,40}g-vanished.{0,20}/) ?? [""])[0]);
    ok("9.3 …while the predecessor itself survives intact",
      /ZZOldDirection/.test(danglingText));

    /* ============================================================
     * 10. §23.8 — an AI suggestion that is not confirmed changes nothing.
     *
     * Read at the capture boundary, which is where the authority rule
     * actually lives: a goal candidate is a SUGGESTION, and no goal
     * exists until a person confirms it.
     * ============================================================ */
    const goalsBefore = await page.evaluate((k) => (JSON.parse(localStorage.getItem(k) || "{}").goals || []).length, KEY);
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const goalsAfter = await page.evaluate((k) => (JSON.parse(localStorage.getItem(k) || "{}").goals || []).length, KEY);
    ok("10.1 §23.8 opening a suggestion surface creates no goal",
      goalsAfter === goalsBefore, `${goalsBefore} -> ${goalsAfter}`);

    /* ============================================================
     * 11. §23.9 — the three fields survive a reload from storage.
     * ============================================================ */
    await page.goto(`${BASE}/goal/g-new`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const persisted = await page.evaluate((k) => {
      const g = (JSON.parse(localStorage.getItem(k) || "{}").goals || []).find((x) => x.id === "g-old");
      return g ? { h: g.horizon ?? null, s: g.successorGoalId ?? null, n: (g.history || []).length } : null;
    }, KEY);
    ok("11.1 §22 successor and history survive a full page reload",
      !!persisted && persisted.s === "g-new" && persisted.n === 1, JSON.stringify(persisted));

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} goal-horizon browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
