#!/usr/bin/env node
/**
 * LIFEOS-082 §33 — EXECUTIVE GUIDANCE BROWSER TORTURE.
 *
 * Measured on the RENDERED product at two viewports.
 *
 * The claim is that asking "what should I focus on?" returns a small grounded
 * shortlist rather than a guilt inventory. So these assertions ask the real
 * question through the real input and read the real answer — and most of them
 * check what is NOT there: a weekly commitment described as avoidance, a
 * follow-up surfaced before its date, a blocker that is already finished, a
 * rule outranking a deadline, or anything at all on an empty store.
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
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-9), updatedAt: at(-9), ...p,
});
const goal = (p) => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-30), updatedAt: at(-30), ...p,
});
const proj = (p) => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: at(-30), updatedAt: at(-30), ...p,
});

/** ZZ markers stay SEPARATE words — 079's harness learned that the hard way. */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g1", title: "ZZgradschool degree", horizon: "medium" }),
    goal({ id: "g3", title: "ZZmarathon run", horizon: "long" }),
  ],
  projects: [proj({ id: "pr1", title: "ZZtraining plan", goalId: "g3" })],
  nextActions: [
    act({ id: "a1", title: "Submit ZZapplication form", dueDate: dk(-2), goalId: "g1" }),
    // Deferred three times, non-recurring.
    act({ id: "a2", title: "Request ZZrecommendation letter",
      history: [
        { id: "e1", action: "created", at: at(-9) },
        { id: "e2", action: "deferred", at: at(-6, 10), detail: dk(-4) },
        { id: "e3", action: "deferred", at: at(-4, 10), detail: dk(-2) },
        { id: "e4", action: "deferred", at: at(-2, 10), detail: dk(3) },
      ] }),
    // WEEKLY RECURRING and deferred three times. Must never be "putting off".
    act({ id: "a3", title: "ZZlabprep weekly", recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
      history: [
        { id: "e5", action: "created", at: at(-9) },
        { id: "e6", action: "deferred", at: at(-6, 10), detail: dk(-4) },
        { id: "e7", action: "deferred", at: at(-4, 10), detail: dk(-2) },
        { id: "e8", action: "deferred", at: at(-2, 10), detail: dk(3) },
      ] }),
    // Follow-up due TODAY.
    act({ id: "a4", title: "ZZtranscript request", status: "waiting", waitingOn: "the registrar", waitingSince: dk(-9), followUpDate: dk(0) }),
    // Follow-up FIVE DAYS OUT — must not surface early.
    act({ id: "a5", title: "Reply from ZZmaria", status: "waiting", waitingOn: "Maria", waitingSince: dk(-3), followUpDate: dk(5) }),
    // Blocked by OPEN work, itself due today.
    act({ id: "a6", title: "Book ZZflights", dueDate: dk(0), projectId: "pr1" }),
    act({ id: "a7", title: "Confirm ZZconference dates" }),
    // Blocked by a COMPLETED blocker — must not surface as blocked.
    act({ id: "a8", title: "Print ZZposter", dueDate: dk(0) }),
    act({ id: "a9", title: "Finalise ZZpostertext", status: "completed", completedAt: at(-1) }),
  ],
  actionDependencies: [
    { id: "d1", blockedId: "a6", blockerId: "a7", createdAt: at(-5) },
    { id: "d2", blockedId: "a8", blockerId: "a9", createdAt: at(-5) },
  ],
  constitutionElements: [
    { id: "s1", kind: "standard", status: "active", statement: "Finish every ZZapplication I start.", adoptedAt: at(-30), linkedRefs: [], createdAt: at(-30), updatedAt: at(-30) },
  ],
});

const seed = async (page, world) => {
  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
};

const ask = async (page, question) => {
  await page.fill("#memory-query", question);
  await page.waitForTimeout(120);
  await page.click("[data-memory-submit]");
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const el = document.querySelector("[data-memory-answer]");
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
  });
};

/** Rows, read structurally — never by slicing concatenated textContent. */
const rows = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-memory-items] li")).map((li) =>
    (li.textContent || "").replace(/\s+/g, " ").trim()));

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2200 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    await seed(page, WORLD());

    /* ============================================================
     * 1. The shortlist: small, grounded, explained.
     * ============================================================ */
    const a1 = await ask(page, "What should I focus on?");
    const r1 = await rows(page);
    ok("1.1 §9 the focus question returns a shortlist", r1.length > 0 && r1.length <= 5, `${r1.length} rows`);
    ok("1.2 §9 …of three by default", r1.length === 3, `${r1.length}`);
    ok("1.3 §10 every row says why", r1.every((t) => t.length > 20), JSON.stringify(r1));
    ok("1.4 §33.1 the overdue item appears", /ZZapplication form/.test(a1 || ""), (a1 || "").slice(0, 200));
    ok("1.5 §10 …with a factual reason", /Was due/.test(a1 || ""), (a1 || "").slice(0, 220));
    ok("1.6 §7 no score is shown anywhere", !/\b\d+\s*%|\bscore\b|\brank\b/i.test(a1 || ""));

    /* ============================================================
     * 2. Repeated deferral — factual, and never recurring work.
     *
     * On its OWN seed, deliberately. In the full world above, `blocked` and
     * `follow_up_due` both outrank `repeated_deferral`, so it is fourth and the
     * cap correctly cuts it — a first draft asserted it in the top three and
     * failed, which was the cap working rather than a defect. Testing it here
     * proves the kind reaches guidance without pretending the cap is not there.
     * ============================================================ */
    const DEFER_WORLD = { ...EMPTY(), nextActions: [
      WORLD().nextActions.find((a) => a.id === "a2"),
      WORLD().nextActions.find((a) => a.id === "a3"),
    ] };
    await seed(page, DEFER_WORLD);
    const a2 = await ask(page, "What should I focus on?");
    ok("2.1 §16 a repeatedly deferred item reaches the shortlist",
      /ZZrecommendation letter/.test(a2 || ""), (a2 || "").slice(0, 250));
    ok("2.2 §16 …with a factual count", /deferred this 3 times/i.test(a2 || ""), (a2 || "").slice(0, 250));
    // THE §16 guard, on the page. Both were deferred three times; only one is
    // a standing weekly commitment, and it must not be called avoidance.
    ok("2.3 §16 a weekly recurring task is never repeated deferral",
      !/ZZlabprep/.test(a2 || ""), (a2 || "").slice(0, 250));
    ok("2.4 §26 …and nothing psychologizes",
      !/(procrastinat|avoiding|afraid|resistance|lazy|failing|neglect)/i.test(a2 || ""));
    ok("2.5 §9 the cap is what kept it out of the full list above",
      !/ZZrecommendation letter/.test(a1 || "") && r1.length === 3, `${r1.length}`);
    await seed(page, WORLD());

    /* ============================================================
     * 3. Waiting — the grounded case only (§17).
     * ============================================================ */
    const a3 = await ask(page, "What needs my attention?");
    ok("3.1 §17 a follow-up due today appears", /ZZtranscript/.test(a3 || ""), (a3 || "").slice(0, 250));
    ok("3.2 §17 a follow-up five days out does NOT",
      !/ZZmaria/.test(a3 || ""), (a3 || "").slice(0, 250));

    /* ============================================================
     * 4. Blocked — live blockers only (§18).
     * ============================================================ */
    ok("4.1 §18 an item blocked by open work appears", /ZZflights/.test(a3 || ""), (a3 || "").slice(0, 300));
    ok("4.2 §18 …naming the blocker", /ZZconference dates/.test(a3 || ""), (a3 || "").slice(0, 300));
    ok("4.3 §18 an item whose blocker is finished is not called blocked",
      !/ZZposter.{0,60}Blocked by/i.test(a3 || ""), (a3 || "").slice(0, 320));

    /* ============================================================
     * 5. Goal wording matches the predicate (§14).
     * ============================================================ */
    const a5 = await ask(page, "Which goal needs attention?");
    ok("5.1 §14 a goal with no project is named", /ZZgradschool/.test(a5 || ""), (a5 || "").slice(0, 250));
    ok("5.2 §14 …described by the predicate",
      /No active project is linked to this goal/i.test(a5 || ""), (a5 || "").slice(0, 250));
    ok("5.3 §14 …and never as a verdict",
      !/(no path forward|stuck|at risk|drifting)/i.test(a5 || ""), (a5 || "").slice(0, 250));
    ok("5.4 §14 a goal that HAS a project is not listed", !/ZZmarathon run/.test(a5 || ""), (a5 || "").slice(0, 250));

    /* ============================================================
     * 6. Personal Code is context, not rank (§21).
     * ============================================================ */
    ok("6.1 §21 a relevant rule is shown as context",
      /Your Personal Code includes/.test(a1 || ""), (a1 || "").slice(0, 300));
    // The rule mentions "application"; the overdue item is first because it is
    // overdue, not because a rule mentions it. First row must be the overdue one.
    ok("6.2 §21 …and does not move the item up the list",
      /ZZapplication form/.test(r1[0] ?? ""), JSON.stringify(r1[0] ?? ""));

    /* ============================================================
     * 7. Entity scope (§25).
     * ============================================================ */
    const a7 = await ask(page, "What needs attention with ZZgradschool?");
    ok("7.1 §25 an entity-scoped question is scoped", /ZZgradschool|ZZapplication/.test(a7 || ""), (a7 || "").slice(0, 250));
    ok("7.2 §25 …and excludes unrelated records",
      !/ZZtranscript|ZZflights|ZZrecommendation/.test(a7 || ""), (a7 || "").slice(0, 300));

    /* ============================================================
     * 8. Stability (§28) — same state, same answer.
     * ============================================================ */
    const again = await ask(page, "What should I focus on?");
    const r2 = await rows(page);
    ok("8.1 §28 the same state gives the same shortlist",
      JSON.stringify(r1) === JSON.stringify(r2), `${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
    ok("8.2 §28 …and the same wording", (a1 || "") === (again || ""));

    /* ============================================================
     * 9. Resolution reuse (§12) — the same controls Today offers.
     * ============================================================ */
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-memory-items] button")).map((b) => (b.textContent || "").trim()));
    ok("9.1 §12 resolutions are offered on the shortlist", controls.length > 0, JSON.stringify(controls.slice(0, 8)));
    ok("9.2 §11 …and none is destructive",
      !controls.some((c) => /delete|archive|remove|discard/i.test(c)), JSON.stringify(controls));

    /* ============================================================
     * 10. An empty store stays empty (§38.10).
     * ============================================================ */
    await seed(page, EMPTY());
    const a10 = await ask(page, "What should I focus on?");
    const r10 = await rows(page);
    ok("10.1 §38.10 nothing is invented on an empty store", r10.length === 0, JSON.stringify(r10));
    ok("10.2 …and the wording is calm, not an error",
      !/can'?t answer|error/i.test(a10 || ""), (a10 || "").slice(0, 200));
    ok("10.3 …bounded to the record, never 'all caught up'",
      !/caught up|well done|great job|nice work/i.test(a10 || ""), (a10 || "").slice(0, 200));

    if (isMobile) {
      await seed(page, WORLD());
      await ask(page, "What should I focus on?");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("11.1 MOBILE the shortlist does not scroll sideways", overflow <= 1, `${overflow}px`);
    }

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} executive-guidance browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
