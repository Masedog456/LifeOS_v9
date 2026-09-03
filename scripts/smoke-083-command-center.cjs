#!/usr/bin/env node
/**
 * LIFEOS-083 §32 — DAILY COMMAND CENTER BROWSER TORTURE.
 *
 * Measured on the RENDERED page at two viewports.
 *
 * The audit's red proofs were layout facts — "the only thing above the fold was
 * Getting started 2/8", "a calm day renders two mobile screens" — so this is
 * where they are actually asserted. Several assertions read the DOM's fold
 * geometry rather than its contents, because that is the claim.
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

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: at(-9), updatedAt: at(-9), ...p });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-30), updatedAt: at(-30), ...p });

/** ZZ markers stay SEPARATE words — 079's harness learned that the hard way. */
const DENSE = () => ({ ...EMPTY(),
  goals: [goal({ id: "g1", title: "ZZgradschool degree", horizon: "medium",
    history: [{ id: "h1", at: at(-30, 8), kind: "created" }, { id: "h2", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }] })],
  events: [{ id: "ev1", title: "ZZadvisor meeting", date: dk(0), startTime: "09:00", allDay: false, createdAt: at(-5), updatedAt: at(-5) }],
  nextActions: [
    act({ id: "a1", title: "Submit ZZapplication form", dueDate: dk(-2), goalId: "g1" }),
    act({ id: "a2", title: "Draft ZZstatement purpose", dueDate: dk(0) }),
    // Deferred three times — reaches attention only through the 082 shortlist.
    act({ id: "a3", title: "Request ZZrecommendation letter",
      history: [{ id: "e1", action: "created", at: at(-9) },
        { id: "e2", action: "deferred", at: at(-6, 10), detail: dk(-4) },
        { id: "e3", action: "deferred", at: at(-4, 10), detail: dk(-2) },
        { id: "e4", action: "deferred", at: at(-2, 10), detail: dk(3) }] }),
    // Follow-up due TODAY / five days out.
    act({ id: "a4", title: "ZZtranscript request", status: "waiting", waitingOn: "the registrar", waitingSince: dk(-9), followUpDate: dk(0) }),
    act({ id: "a5", title: "Reply from ZZmaria", status: "waiting", waitingOn: "Maria", waitingSince: dk(-3), followUpDate: dk(5) }),
    // Completed YESTERDAY — recent history, never an active row.
    act({ id: "a6", title: "Buy ZZrunningshoes", status: "completed", completedAt: at(-1, 15),
      history: [{ id: "e5", action: "created", at: at(-3) }, { id: "e6", action: "completed", at: at(-1, 15) }] }),
    act({ id: "a7", title: "Renew ZZpassport", dueDate: dk(20) }),
  ],
  constitutionElements: [
    { id: "s1", kind: "standard", status: "active", statement: "Ask for a ZZrecommendation early.", adoptedAt: at(-30), linkedRefs: [], createdAt: at(-30), updatedAt: at(-30) },
    { id: "s2", kind: "standard", status: "retired", statement: "Never work ZZlatenight.", adoptedAt: at(-30), retiredAt: at(-1, 11), linkedRefs: [], createdAt: at(-30), updatedAt: at(-1, 11) },
  ],
  constitutionRevisions: [{ id: "r1", elementId: "s2", changeKind: "retired", at: at(-1, 11) }],
});

const CALM = () => ({ ...EMPTY(), nextActions: [act({ id: "c1", title: "Water the ZZplants", dueDate: dk(4) })] });

const seed = async (page, world) => {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
};

const body = (page) => page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
/** Headings visible WITHOUT scrolling — the audit's actual measurement. */
const aboveFold = (page) => page.evaluate(() => {
  const vh = window.innerHeight;
  return Array.from(document.querySelectorAll("h2"))
    .filter((h) => { const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < vh; })
    .map((h) => (h.textContent || "").trim());
});
const screens = (page) => page.evaluate(() => +(document.documentElement.scrollHeight / window.innerHeight).toFixed(2));

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 1000 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    await seed(page, DENSE());

    /* ============================================================
     * 1. Hierarchy: the day first, scaffolding after (§1, §17).
     * ============================================================ */
    const fold = await aboveFold(page);
    const t1 = await body(page);
    ok("1.1 §17 the day is above the fold, not onboarding",
      !fold.includes("Getting started") && !/^Getting started/.test(fold[0] ?? ""), JSON.stringify(fold));
    ok("1.2 §17 …what is NEXT is above the fold", fold.includes("Suggested next"), JSON.stringify(fold));
    ok("1.3 §17 …and what is FIXED", fold.includes("Today"), JSON.stringify(fold));
    ok("1.4 §7 the fixed commitment shows its time", /ZZadvisor meeting/.test(t1) && /9(:00)?\s*AM/i.test(t1), (t1.match(/.{0,50}ZZadvisor.{0,30}/) ?? [""])[0]);
    ok("1.5 §1 onboarding still exists, just later",
      /Getting started/.test(t1), "onboarding must not be deleted, only demoted");
    // The scaffolding must come AFTER the day in document order.
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h2")).map((h) => (h.textContent || "").trim()));
    ok("1.6 §1 the day outranks the scaffolding in document order",
      order.indexOf("Suggested next") < order.findIndex((x) => /Getting started/.test(x)), JSON.stringify(order));

    /* ============================================================
     * 2. §22 — one entity, one prominent place.
     * ============================================================ */
    const nextTitle = await page.evaluate(() => {
      const el = document.querySelector("[data-suggested-next] a");
      return el ? (el.textContent || "").trim() : null;
    });
    ok("2.1 a recommendation is shown", !!nextTitle, String(nextTitle));
    const attentionTitles = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-attention] a")).map((a) => (a.textContent || "").trim()));
    ok("2.2 §22 the recommendation has no duplicate attention card",
      !attentionTitles.includes(nextTitle), JSON.stringify([nextTitle, attentionTitles]));
    // §23 — and the evidence is not lost. Either inline, or already in the reasons.
    const nextCard = await page.evaluate(() => {
      const el = document.querySelector("[data-suggested-next]");
      return el ? (el.textContent || "").replace(/\s+/g, " ") : "";
    });
    ok("2.3 §23 …because the row itself carries the reason", /due/i.test(nextCard), nextCard.slice(0, 200));
    // …and 083 does not ADD a second copy of it. The duplication found on the
    // rendered page was an inline reason printed under a row that already
    // listed the same sentence among its reasons.
    //
    // Asserted on the element, not by counting words over the whole card: the
    // card also carries LIFEOS-072's counterfactual, which legitimately repeats
    // the due date in a different sentence ("Was due …, and X isn't overdue").
    // That is 072's copy, it predates this sprint, and a word count cannot tell
    // the two apart.
    const inlineOnNext = await page.evaluate(() =>
      document.querySelectorAll("[data-suggested-next] [data-inline-reason]").length);
    ok("2.4 §23 …and 083 does not print it a second time",
      inlineOnNext === 0, `${inlineOnNext} inline reasons on a row that already says it`);

    /* ============================================================
     * 3. §9 — the 082 shortlist is finally visible.
     * ============================================================ */
    ok("3.1 §9 a repeatedly deferred item reaches the daily surface",
      /ZZrecommendation letter/.test(t1), (t1.match(/.{0,60}ZZrecommendation.{0,60}/) ?? [""])[0]);
    ok("3.2 §9 …with its factual count", /deferred this 3 times/i.test(t1), (t1.match(/.{0,80}deferred this.{0,20}/) ?? [""])[0]);
    ok("3.3 §16 …and the section is capped at three",
      attentionTitles.length <= 3, JSON.stringify(attentionTitles));
    ok("3.4 §13 a grounded rule appears as context",
      /Fits your rule/.test(t1), (t1.match(/.{0,40}Fits your rule.{0,50}/) ?? [""])[0]);

    /* ============================================================
     * 4. §10 — waiting: the grounded case only.
     * ============================================================ */
    ok("4.1 §10 a follow-up due today is shown", /ZZtranscript/.test(t1));
    ok("4.2 §10 a follow-up five days out is not urgent",
      !/ZZmaria.{0,40}Follow-up due/.test(t1), (t1.match(/.{0,60}ZZmaria.{0,40}/) ?? [""])[0]);

    /* ============================================================
     * 5. §11 — since yesterday.
     * ============================================================ */
    ok("5.1 §11 recent change is on the daily surface", /Since yesterday/.test(t1));
    ok("5.2 §11 …including a goal direction change",
      /ZZgradschool degree/.test(t1) && /Near → Medium/.test(t1), (t1.match(/.{0,60}Near . Medium.{0,20}/) ?? [""])[0]);
    ok("5.3 §11 …and a retired rule", /ZZlatenight/.test(t1), (t1.match(/.{0,50}ZZlatenight.{0,30}/) ?? [""])[0]);
    ok("5.4 §21 yesterday's completion is recent history, not an active row",
      /ZZrunningshoes/.test(t1), (t1.match(/.{0,50}ZZrunningshoes.{0,30}/) ?? [""])[0]);
    const activeHasCompleted = await page.evaluate(() => {
      const inSection = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent || "").join(" ");
      return /ZZrunningshoes/.test(inSection("[data-today-action]") + inSection("[data-today-also]") + inSection("[data-attention]"));
    });
    ok("5.5 §21 …and never in Today or Needs attention", !activeHasCompleted);
    const sinceCount = await page.evaluate(() => document.querySelectorAll("[data-since-yesterday]").length);
    ok("5.6 §11 capped at three", sinceCount <= 3, String(sinceCount));

    /* ============================================================
     * 6. §24 — resolutions are available, and safe.
     * ============================================================ */
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-suggested-next] button, [data-attention] button")).map((b) => (b.textContent || "").trim()));
    ok("6.1 §24 safe resolutions are offered", controls.length > 0, JSON.stringify(controls.slice(0, 8)));
    ok("6.2 §24 …and none is destructive",
      !controls.some((c) => /delete|archive|discard|remove/i.test(c)), JSON.stringify(controls));

    /* ============================================================
     * 7. §28 — stability.
     * ============================================================ */
    const before = await page.evaluate(() => Array.from(document.querySelectorAll("h2")).map((h) => h.textContent));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => Array.from(document.querySelectorAll("h2")).map((h) => h.textContent));
    ok("7.1 §28 the same state gives the same sections", JSON.stringify(before) === JSON.stringify(after),
      `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);

    /* ============================================================
     * 8. §15 — a calm day stays calm.
     * ============================================================ */
    await seed(page, CALM());
    const calmFold = await aboveFold(page);
    const calmScreens = await screens(page);
    const t8 = await body(page);
    ok("8.1 §15 a calm day raises no attention section",
      !calmFold.includes("Needs attention") && !/data-attention/.test(t8), JSON.stringify(calmFold));
    ok("8.2 §15 …and says what is true", /Nothing is due today/.test(t8), (t8.match(/.{0,20}Nothing is due.{0,60}/) ?? [""])[0]);
    ok("8.3 §14 …counting what is ahead", /1 open item is scheduled later/.test(t8), (t8.match(/.{0,30}scheduled later.{0,10}/) ?? [""])[0]);
    // Scoped to the calm line ITSELF. Swept over the whole page this matched the
    // onboarding card's "Skip" button — unrelated UI, and a false positive that
    // would have masked a real regression in either direction.
    const canWait = await page.evaluate(() => {
      const el = document.querySelector("[data-can-wait]");
      return el ? (el.textContent || "").trim() : null;
    });
    ok("8.4 §14 the calm line never says what to skip",
      !!canWait && !/(ignore|skip|don'?t bother|low priority|not important)/i.test(canWait), String(canWait));
    ok("8.5 §15 …with no manufactured urgency",
      !/(urgent|you are behind|falling behind|catch up)/i.test(t8));
    ok("8.6 §15 a calm day is shorter than a dense one", calmScreens < 2.5, `${calmScreens} screens`);

    /* ============================================================
     * 9. §20 — the same view works later in the day.
     * ============================================================ */
    await seed(page, DENSE());
    const morning = await page.evaluate(() => Array.from(document.querySelectorAll("h2")).map((h) => h.textContent));
    ok("9.1 §20 no greeting logic decides the sections",
      morning.every((h) => !/morning|afternoon|evening/i.test(h ?? "")), JSON.stringify(morning));

    /* ============================================================
     * 10. §36 — accessibility.
     * ============================================================ */
    const a11y = await page.evaluate(() => {
      const heads = Array.from(document.querySelectorAll("h2")).map((h) => (h.textContent || "").trim());
      const h1 = document.querySelectorAll("h1").length;
      const btns = Array.from(document.querySelectorAll("[data-attention] button, [data-suggested-next] button"));
      const unlabelled = btns.filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label")).length;
      const links = Array.from(document.querySelectorAll("[data-attention] a, [data-suggested-next] a"));
      const emptyLinks = links.filter((a) => !(a.textContent || "").trim()).length;
      return { heads, h1, unlabelled, emptyLinks };
    });
    ok("10.1 §36 exactly one page heading", a11y.h1 === 1, String(a11y.h1));
    ok("10.2 §36 every section heading is meaningful",
      a11y.heads.every((h) => h.length > 2), JSON.stringify(a11y.heads));
    ok("10.3 §36 every control is labelled", a11y.unlabelled === 0, String(a11y.unlabelled));
    ok("10.4 §36 every link has text", a11y.emptyLinks === 0, String(a11y.emptyLinks));
    const focusable = await page.evaluate(() => {
      const el = document.querySelector("[data-suggested-next] a");
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    });
    ok("10.5 §36 the recommendation is keyboard reachable", focusable);

    if (isMobile) {
      const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("11.1 §17 MOBILE no sideways scroll", w <= 1, `${w}px`);
      const dense = await screens(page);
      ok("11.2 §17 MOBILE a dense day stays under four screens", dense < 4, `${dense} screens`);
    }

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} command-center browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
