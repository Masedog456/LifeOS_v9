#!/usr/bin/env node
/**
 * LIFEOS-092 §35 — browser torture for the consolidated daily review.
 *
 * The deterministic suite proves the SOURCE says there is one review surface.
 * This proves the running app behaves as though there is: that every door leads
 * to the same page, that old bookmarks land rather than 404, that a dated
 * bookmark lands on its day, that the facts are still LIFEOS-091's, that the
 * reflection is skippable, and that reviewing yesterday cannot move today.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CANONICAL = "/today/review";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9, m = 0) => `${dk(o)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-20), updatedAt: at(0, 18), ...p });
const h = (action, atIso, extra = {}) => ({ action, at: atIso, ...extra });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: at(-90), updatedAt: at(-90), ...p });

/** LIFEOS-091's day, so the two sprints can be compared row for row. */
const WORLD = () => ({ ...EMPTY(),
  goals: [goal({ id: "g-grad", title: "Graduate school", priority: "high" })],
  projects: [{ id: "p-apps", title: "Graduate applications", goalId: "g-grad", description: "",
    status: "active", priority: "high", notes: "", milestones: [], relatedDocuments: [],
    relatedEntities: [], createdAt: at(-90), updatedAt: at(-90) }],
  nextActions: [
    act({ id: "a-send", title: "Send application", projectId: "p-apps", status: "completed",
      completedAt: at(0, 14), dueDate: dk(0),
      history: [h("created", at(-1)), h("completed", at(0, 14), { fromStatus: "open", toStatus: "completed" })] }),
    // Completed YESTERDAY — the day-selection tests turn on this one.
    act({ id: "a-yest", title: "Book the venue", projectId: "p-apps", status: "completed",
      completedAt: at(-1, 15),
      history: [h("created", at(-6)), h("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-rec", title: "Request recommendation", projectId: "p-apps", status: "deferred",
      deferredUntil: dk(1),
      history: [h("created", at(-20)), h("deferred", at(-5, 17)), h("returned", at(-4, 6)),
        h("deferred", at(-2, 18)), h("returned", at(-1, 6)), h("deferred", at(0, 19))] }),
    act({ id: "a-dentist", title: "Dentist", dueDate: dk(2),
      history: [h("created", at(-7)), h("due_set", at(0, 12), { detail: dk(2) })] }),
    act({ id: "a-lease", title: "Lease approval", status: "waiting", waitingOn: "Marcus",
      waitingSince: at(-8), followUpDate: dk(-1),
      history: [h("created", at(-8)), h("waiting", at(-8, 9), { detail: "Marcus", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-fee", title: "Pay the application fee", projectId: "p-apps", dueDate: dk(-3),
      history: [h("created", at(-10))] }),
    act({ id: "a-submit", title: "Submit the second application", projectId: "p-apps", dueDate: dk(1),
      history: [h("created", at(-4))] }),
  ],
  events: [{ id: "e-dentist", title: "Dentist appointment", date: dk(1), startTime: "10:00",
    allDay: false, createdAt: at(-7), updatedAt: at(-7) }],
  reflections: [{ id: "r1", prompt: "What stood out today?",
    response: "The statement finally sounds like me rather than a form.",
    createdAt: at(0, 21), annotations: [] }],
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const actionOf = async (page, id) => (await store(page)).nextActions.find((a) => a.id === id);
const path = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

async function settle(page, ms = 900) { await page.waitForTimeout(ms); }

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page);

  // ---- 1. Today → Review, and only one way there (§20) -------------------
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await settle(page, 1200);
  const ctas = await page.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => /review today|close (the )?day|daily review/i.test(a.textContent || ""))
      .map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href") })));
  ok("1 §20 Today offers exactly one way to review the day",
    ctas.length === 1, JSON.stringify(ctas));
  ok("2 §20 …and it is the canonical route",
    ctas[0]?.href === CANONICAL, JSON.stringify(ctas));
  ok("3 §20 no link on Today points at the retired surface",
    await page.evaluate(() => ![...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/daily")));
  await page.click(`a[href="${CANONICAL}"]`);
  await settle(page);
  ok("4 §6 …and following it lands on the canonical review",
    path(page) === CANONICAL, path(page));

  // ---- 2. The old bookmark (§27, §35.16) ---------------------------------
  const before = (await store(page)).dailyReviews.length;
  const resp = await page.goto(`${BASE}/daily`, { waitUntil: "domcontentloaded" });
  ok("5 §27 an old /daily bookmark does not 404", resp.status() === 200, String(resp.status()));
  await settle(page, 1400);
  ok("6 §5, §27 …it lands on the canonical review", path(page) === CANONICAL, path(page));
  ok("7 §16 …and reading a day still creates no record",
    (await store(page)).dailyReviews.length === before,
    `${before} -> ${(await store(page)).dailyReviews.length}`);
  ok("8 §26 …with no trace of the wizard's steps",
    await page.evaluate(() => !/Wins|Friction|Confirm & complete|Tomorrow’s focus/.test(document.body.innerText)));
  ok("9 §25, §37 …and no stepper",
    await page.evaluate(() => !document.querySelector('nav[aria-label="Review steps"]')));

  // ---- 3. The dated bookmark keeps its day (§7, §17) ---------------------
  const y = dk(-1);
  const r2 = await page.goto(`${BASE}/daily/${y}`, { waitUntil: "domcontentloaded" });
  ok("10 §27 a dated bookmark does not 404", r2.status() === 200, String(r2.status()));
  await settle(page, 1400);
  ok("11 §7, §17 …and carries its day across the redirect",
    path(page) === `${CANONICAL}?date=${y}`, path(page));
  ok("12 §18 …showing THAT day's facts",
    await page.evaluate(() => /Book the venue/.test(document.body.innerText)),
    await page.evaluate(() => document.querySelector("h1")?.textContent || ""));
  ok("13 §18 …and not today's",
    await page.evaluate(() => !/Send application/.test(document.body.innerText)));
  ok("14 §17 a nonsense date still lands on a review, not an error",
    await (async () => {
      const r = await page.goto(`${BASE}/daily/not-a-date`, { waitUntil: "domcontentloaded" });
      await settle(page, 1300);
      return r.status() === 200 && path(page).startsWith(CANONICAL);
    })(), path(page));

  // ---- 4. Command palette (§28) ------------------------------------------
  await seed(page);
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await settle(page, 1100);
  await page.keyboard.press("Control+k");
  await settle(page, 600);
  await page.keyboard.type("review today");
  await settle(page, 700);
  const palette = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"], [data-command-item], li')]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .filter((t) => /review/i.test(t) && t.length < 80));
  ok("15 §28 the palette finds the review", palette.length > 0, JSON.stringify(palette.slice(0, 6)));
  ok("16 §28 …and never names the retired surface",
    !palette.some((t) => /daily review/i.test(t)), JSON.stringify(palette.slice(0, 6)));
  {
    // The first run of this suite returned ["☑Review today", "☑Review today"] —
    // two identical rows, one from nav and one from the contextual provider.
    // "Do not expose both" is about doors, not just names.
    const same = palette.filter((t) => /review today/i.test(t));
    ok("16a §28 …and lists the review exactly once",
      same.length <= 1, JSON.stringify(same));
    ok("16b §28 …offering no action the product cannot perform",
      !palette.some((t) => /complete daily review|reopen daily review/i.test(t)),
      JSON.stringify(palette.slice(0, 6)));
  }
  await page.keyboard.press("Escape");

  // ---- 5–8. The facts are still LIFEOS-091's -----------------------------
  await seed(page);
  await page.goto(`${BASE}${CANONICAL}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const sections = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("[data-review-section]")]
      .map((s) => [s.getAttribute("data-review-section"), (s.textContent || "").replace(/\s+/g, " ")])));
  ok("17 §10 a completed action reads as done",
    /Send application/.test(sections.done || ""), (sections.done || "").slice(0, 90));
  ok("18 §10 …and nothing merely created or changed is called done",
    !/Date changed|Deferred/.test(sections.done || ""), (sections.done || "").slice(0, 90));
  ok("19 §11 a deferred action is a change, with its count",
    /Request recommendation/.test(sections.changed || "")
    && /3 recorded deferrals/.test(sections.changed || ""), (sections.changed || "").slice(0, 140));
  ok("20 §11 a neutral reschedule is a date change, not a deferral",
    /Dentist/.test(sections.changed || "") && /Date changed/.test(sections.changed || ""));
  ok("21 §11 …and the page never pools them under one word",
    await page.evaluate(() => !/postponed/i.test(document.body.innerText)));
  ok("22 §12 still open stays bounded",
    await page.evaluate(() => document.querySelectorAll("[data-review-open]").length) <= 3,
    String(await page.evaluate(() => document.querySelectorAll("[data-review-open]").length)));
  ok("23 §13 tomorrow keeps its two lists",
    /Tomorrow already has/.test(sections.tomorrow || "")
    && /Possible carry-forward/.test(sections.tomorrow || ""), (sections.tomorrow || "").slice(0, 120));

  // ---- 8. Waiting stays safe through the carry path (§14) ----------------
  {
    const w = await actionOf(page, "a-lease");
    ok("24 §14 the due wait is present as a wait", w.status === "waiting", w.status);
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll("[data-review-carry-confirm]")].map((e) => e.getAttribute("data-review-carry-confirm")));
    if (offered.includes("a-lease")) {
      await page.click('[data-review-carry-confirm="a-lease"]');
      await settle(page, 800);
      const after = await actionOf(page, "a-lease");
      ok("25 §14 …and carrying it never orphans it",
        !(after.status === "deferred" && !!after.waitingOn),
        JSON.stringify({ status: after.status, waitingOn: after.waitingOn }));
      ok("26 §14 …it is still a wait on the same person",
        after.status === "waiting" && after.waitingOn === "Marcus",
        JSON.stringify({ status: after.status, waitingOn: after.waitingOn }));
    } else {
      ok("25 §14 …and carrying it never orphans it", true, "not offered as a candidate — also safe");
      ok("26 §14 …it is still a wait on the same person", w.waitingOn === "Marcus");
    }
  }

  // ---- 9, 10. Reflection is one prompt, and skippable (§15, §16) ---------
  await seed(page);
  await page.goto(`${BASE}${CANONICAL}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  ok("27 §15 there is exactly one reflection prompt",
    await page.evaluate(() => document.querySelectorAll("[data-review-memory-input]").length) === 1,
    String(await page.evaluate(() => document.querySelectorAll("[data-review-memory-input]").length)));
  ok("28 §15 …and no second journaling flow beside it",
    await page.evaluate(() => !/Wins|Lessons|Friction/.test(document.body.innerText)));
  ok("29 §16 …it is labelled optional",
    await page.evaluate(() => /optional|or nothing at all/i.test(document.body.innerText)));
  ok("30 §16 skipping it leaves the review complete and useful",
    Object.keys(sections).length >= 3
    && await page.evaluate(() => !/incomplete|unfinished|finish your review/i.test(document.body.innerText)),
    Object.keys(sections).join(","));
  ok("31 §16 …with no progress meter",
    await page.evaluate(() => !document.querySelector("progress, [role='progressbar']")
      && !/\b\d\s*(of|\/)\s*7\b/.test(document.body.innerText)));
  ok("32 §32 …and no score anywhere",
    await page.evaluate(() => !/\b\d+\s*%|day score|streak/i.test(document.body.innerText)));

  // ---- 11, 12. Yesterday, and acting from it (§18) -----------------------
  await seed(page);
  await page.goto(`${BASE}${CANONICAL}?date=${y}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  ok("33 §18 yesterday shows yesterday's completion",
    await page.evaluate(() => /Book the venue/.test(document.body.innerText)));
  ok("34 §18 …and not today's",
    await page.evaluate(() => !/Send application/.test(document.body.innerText)));
  ok("35 §16 …and the optional prompt is not offered for a past day",
    await page.evaluate(() => !document.querySelector("[data-review-memory-input]")));
  {
    // §18. A forward-looking action taken while reviewing yesterday must aim at
    // the day AFTER today, never at yesterday's tomorrow.
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll("[data-review-carry-confirm]")].map((e) => e.getAttribute("data-review-carry-confirm")));
    ok("36 §18 a past day still offers its unresolved work", offered.length > 0, JSON.stringify(offered));
    if (offered.length) {
      const id = offered[0];
      await page.click(`[data-review-carry-confirm="${id}"]`);
      await settle(page, 800);
      const a = await actionOf(page, id);
      const landed = a.deferredUntil ?? a.followUpDate;
      ok("37 §18 …and carrying from it never lands in the past",
        !landed || landed >= dk(0), JSON.stringify({ id, landed, today: dk(0) }));
    } else {
      ok("37 §18 …and carrying from it never lands in the past", true, "nothing offered");
    }
  }

  // ---- 13. The week link (§21) -------------------------------------------
  await seed(page);
  await page.goto(`${BASE}${CANONICAL}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  ok("38 §21 the daily review links to the week",
    await page.evaluate(() => document.querySelector("[data-review-week]")?.getAttribute("href") === "/memory"),
    await page.evaluate(() => document.querySelector("[data-review-week]")?.getAttribute("href") || "(none)"));
  ok("39 §21 …without embedding weekly content",
    await page.evaluate(() => !/this week you|Weekly rollup|Week in review/i.test(document.body.innerText)));
  ok("40 §26 …and past reviews stay reachable",
    await page.evaluate(() => !!document.querySelector("[data-review-history]")));
  {
    const r = await page.goto(`${BASE}/daily/history`, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    ok("41 §26 review history still works", r.status() === 200 && path(page) === "/daily/history",
      `${r.status()} ${path(page)}`);
    ok("42 §6 …and its link back is the canonical one",
      await page.evaluate(() => ![...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/daily")));
  }

  // ---- 17. A quiet day is still calm (§37) -------------------------------
  await seed(page, { ...EMPTY() });
  await page.goto(`${BASE}${CANONICAL}`, { waitUntil: "domcontentloaded" });
  await settle(page);
  ok("43 §37 a quiet day states what was recorded",
    await page.evaluate(() => !!document.querySelector("[data-review-quiet]")));
  ok("44 §37 …with no leftover call to close a day already being reviewed",
    await page.evaluate(() => ![...document.querySelectorAll("a,button")]
      .some((e) => /^(close (the )?day|start .*review)/i.test((e.textContent || "").trim()))));

  // ---- 14, 15. Mobile and desktop (§24, §25) -----------------------------
  {
    const m = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    m.on("pageerror", (e) => errors.push(String(e)));
    await seed(m);
    await m.goto(`${BASE}${CANONICAL}`, { waitUntil: "domcontentloaded" });
    await settle(m);
    ok("45 §24 the review is one scroll on a phone, with no pagination",
      await m.evaluate(() => !document.querySelector('nav[aria-label="Review steps"]')
        && ![...document.querySelectorAll("button")].some((b) => /^(next|← back|skip)$/i.test((b.textContent||"").trim()))));
    ok("46 §24 no horizontal overflow at 390px",
      await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await m.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
    ok("47 §38 exactly one h1", await m.evaluate(() => document.querySelectorAll("h1").length) === 1);
    ok("48 §38 the date control is labelled",
      await m.evaluate(() => {
        const b = document.querySelector("[data-review-prev]");
        return !!b && (b.textContent || "").trim().length > 1;
      }));
    ok("49 §38 the optional prompt is labelled",
      await m.evaluate(() => {
        const i = document.querySelector("[data-review-memory-input]");
        return !!i && !!document.querySelector(`label[for="${i.id}"]`);
      }));
    ok("50 §38 the day control is keyboard reachable",
      await m.evaluate(() => {
        const b = document.querySelector("[data-review-prev]");
        b?.focus();
        return document.activeElement === b;
      }));
    // §38. The redirect must not trap focus or strand a reader.
    await m.goto(`${BASE}/daily`, { waitUntil: "domcontentloaded" });
    await settle(m, 1400);
    ok("51 §38 the redirect lands on a real page on mobile too",
      new URL(m.url()).pathname === CANONICAL, new URL(m.url()).pathname);
    ok("52 §38 …and the landed page takes focus normally",
      await m.evaluate(() => {
        const b = document.querySelector("[data-review-prev]");
        b?.focus();
        return document.activeElement === b;
      }));
    await m.close();
  }

  ok("53 no page errors in any of the above", errors.length === 0, errors.slice(0, 2).join(" | "));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ${r.name} — ${r.detail}`));
  }
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})();
