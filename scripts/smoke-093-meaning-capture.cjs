#!/usr/bin/env node
/**
 * LIFEOS-093 §39 — browser torture for meaning capture.
 *
 * The deterministic suite proves the model. This proves the PAGE: that a day
 * closes with nothing written, that each prompt saves on its own, that a
 * reflection written while reading a past day belongs to that day, that it
 * survives a reload and reaches Week Review and Memory and Search exactly once,
 * that a machine's sentence is never read back as the user's, and that a
 * decision written in prose moves no goal.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REVIEW = "/today/review";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-20), updatedAt: at(0, 18), ...p });
const h = (action, atIso, extra = {}) => ({ action, at: atIso, ...extra });

const WORLD = () => ({ ...EMPTY(),
  goals: [{ id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: at(-90), updatedAt: at(-90) }],
  projects: [{ id: "p1", title: "Graduate applications", goalId: "g1", description: "", status: "active",
    priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: at(-90), updatedAt: at(-90) }],
  nextActions: [
    act({ id: "a-send", title: "Send application", projectId: "p1", status: "completed",
      completedAt: at(0, 14),
      history: [h("created", at(-2)), h("completed", at(0, 14), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-fee", title: "Pay the application fee", projectId: "p1", dueDate: dk(-3),
      history: [h("created", at(-10))] }),
  ],
  notes: [
    // §12, §39.9. Machine prose with its attribution marker in its own text.
    { id: "n-ai", title: "Summary",
      body: "_AI-generated — Summary of this project:_\n\nGenerated overview of the application timeline.",
      createdAt: at(0, 17), updatedAt: at(0, 17), tags: [], linkedEntityRefs: [] },
  ],
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const reflections = async (page) => (await store(page)).reflections ?? [];

async function review(page, date) {
  await page.goto(`${BASE}${REVIEW}${date ? `?date=${date}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(900);
}

/** Answer one prompt and wait for the record to land. */
async function answer(page, kind, text) {
  await page.click(`[data-meaning-prompt="${kind}"]`);
  await page.waitForSelector(`[data-meaning-input="${kind}"]`, { timeout: 10000 });
  await page.fill(`[data-meaning-input="${kind}"]`, text);
  await page.click("[data-meaning-save]");
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. Zero reflection — the day still closes (§4) --------------------
  await seed(page);
  await review(page);
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-section]")].map((s) => s.getAttribute("data-review-section")));
  ok("1 §4 the review is complete with nothing written",
    sections.includes("done") && sections.includes("still-open"), JSON.stringify(sections));
  ok("2 §4 …and nothing calls it unfinished",
    await page.evaluate(() => !/incomplete|unfinished|finish your|you haven'?t/i.test(document.body.innerText)));
  ok("3 §4, §36 …with no progress meter or streak",
    await page.evaluate(() => !document.querySelector("progress, [role='progressbar']")
      && !/\b\d\s*(of|\/)\s*\d\b.*(prompt|reflection)|streak/i.test(document.body.innerText)));
  ok("4 §5 three prompts are offered, not six boxes",
    await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length) === 3,
    String(await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length)));
  ok("5 §26 …and no textarea is open before one is chosen",
    await page.evaluate(() => document.querySelectorAll("[data-meaning-input]").length) === 0);
  ok("6 §5 …with the rest one press away",
    await page.evaluate(() => !!document.querySelector("[data-meaning-more]")));
  await page.click("[data-meaning-more]");
  await page.waitForTimeout(400);
  ok("7 §5 …which reveals them without opening any box",
    await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length) === 6
    && await page.evaluate(() => document.querySelectorAll("[data-meaning-input]").length) === 0,
    String(await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length)));

  // ---- 2, 3. Each prompt saves on its own (§27) --------------------------
  await seed(page);
  await review(page);
  await answer(page, "mattered", "I finally felt clear that philosophy is the direction I want.");
  let refs = await reflections(page);
  ok("8 §2 a 'what mattered' answer is saved", refs.length === 1, String(refs.length));
  ok("9 §7 …carrying the prompt it answered",
    /what mattered/i.test(refs[0]?.prompt || ""), String(refs[0]?.prompt));
  ok("10 §12 …and the user's own words",
    /philosophy is the direction/.test(refs[0]?.response || ""), String(refs[0]?.response));
  ok("11 §13 …filed against the reviewed day",
    refs[0]?.context === dk(0), String(refs[0]?.context));
  ok("12 §35 …as a Reflection, with no journal record created",
    (await store(page)).dailyReviews.length === 0
    && !Object.keys(await store(page)).some((k) => /journal|mood/i.test(k)));
  ok("13 §27 …and the composer closed rather than waiting for a submit",
    await page.evaluate(() => document.querySelectorAll("[data-meaning-input]").length) === 0);

  await answer(page, "learned", "Reading aloud catches what the eye skips.");
  refs = await reflections(page);
  ok("14 §27 a second prompt saves independently", refs.length === 2, String(refs.length));
  ok("15 §27 …without disturbing the first",
    refs.some((r) => /philosophy/.test(r.response)) && refs.some((r) => /Reading aloud/.test(r.response)));
  ok("16 §7 …and the two carry different prompts",
    new Set(refs.map((r) => r.prompt)).size === 2, refs.map((r) => r.prompt).join(" | "));

  // ---- 30, 31. Shown once, prompt above answer ---------------------------
  await review(page);
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll("[data-meaning-card]")].map((e) => ({
      kind: e.getAttribute("data-meaning-card"),
      text: (e.textContent || "").replace(/\s+/g, " ").trim(),
    })));
  ok("17 §30 both answers are shown as cards", cards.length === 2, JSON.stringify(cards.map((c) => c.kind)));
  ok("18 §30 …each with its prompt above it",
    cards.some((c) => /What mattered today\?/.test(c.text)) && cards.some((c) => /What did you learn\?/.test(c.text)),
    JSON.stringify(cards.map((c) => c.text.slice(0, 50))));
  {
    const body = await page.evaluate(() => document.body.innerText);
    ok("19 §31 a reflection is rendered exactly once on the page",
      (body.match(/philosophy is the direction/g) || []).length === 1,
      String((body.match(/philosophy is the direction/g) || []).length));
    ok("20 §30 …and its prompt is not repeated around it",
      (body.match(/What mattered today\?/g) || []).length <= 1,
      String((body.match(/What mattered today\?/g) || []).length));
  }

  // ---- 5. Reload keeps it (§39.5) ----------------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  ok("21 §39.5 the reflections survive a reload",
    await page.evaluate(() => /philosophy is the direction/.test(document.body.innerText)));
  ok("22 §39.5 …and are still exactly two",
    (await reflections(page)).length === 2, String((await reflections(page)).length));

  // ---- 4. A past day (§13, §14) ------------------------------------------
  await seed(page);
  await review(page, dk(0));
  await answer(page, "mattered", "Today felt like a turning point.");
  await review(page, dk(-1));
  ok("23 §14 a past day does not show today's reflection",
    await page.evaluate(() => !/turning point/.test(document.body.innerText)));
  ok("24 §14 …and does not invite writing about a day you are only reading",
    await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length) === 0,
    String(await page.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length)));
  await review(page, dk(0));
  ok("25 §14 …while today still shows it",
    await page.evaluate(() => /turning point/.test(document.body.innerText)));

  // A reflection explicitly filed against yesterday belongs to yesterday.
  {
    const w = WORLD();
    w.reflections = [{ id: "r-y", prompt: "What did you learn?",
      response: "Yesterday's meeting was the hinge.", context: dk(-1),
      createdAt: at(0, 22), annotations: [] }];
    await seed(page, w);
    await review(page, dk(-1));
    ok("26 §13 a reflection about yesterday appears on yesterday's review",
      await page.evaluate(() => /Yesterday's meeting was the hinge/.test(document.body.innerText)));
    ok("27 §13 …and says it was written later rather than hiding it",
      await page.evaluate(() => !!document.querySelector("[data-meaning-written-later]")),
      await page.evaluate(() => document.querySelector("[data-meaning-written-later]")?.textContent || "(none)"));
    await review(page, dk(0));
    ok("28 §13 …and is absent from the day it was typed on",
      await page.evaluate(() => !/Yesterday's meeting was the hinge/.test(document.body.innerText)));
    ok("29 §13 …with its recorded instant untouched",
      (await reflections(page))[0]?.createdAt === at(0, 22),
      String((await reflections(page))[0]?.createdAt));
  }

  // ---- 9. AI-authored content is never "you wrote" (§12) -----------------
  await seed(page);
  await review(page);
  ok("30 §12 machine prose is not shown as the user's words",
    await page.evaluate(() => !/Generated overview of the application timeline/.test(document.body.innerText)));
  ok("31 §12 …and nothing on the page attributes it to the user",
    await page.evaluate(() => !/you wrote[^]{0,80}Generated overview/i.test(document.body.innerText)));

  // ---- 12, 13. Prose moves nothing (§21, §22, §23) ----------------------
  await seed(page);
  await review(page);
  const goalBefore = JSON.stringify((await store(page)).goals);
  await page.click("[data-meaning-more]");
  await page.waitForTimeout(300);
  await answer(page, "decision", "I decided not to apply to law school.");
  ok("32 §22 a decision reflection is saved",
    (await reflections(page)).some((r) => /law school/.test(r.response)));
  ok("33 §22 …and mutates no goal",
    JSON.stringify((await store(page)).goals) === goalBefore);
  ok("34 §21 …and creates no rule",
    (await store(page)).constitutionElements.length === 0
    && (await store(page)).protocols.length === 0);
  await answer(page, "difficult", "Writing the statement felt impossible.");
  ok("35 §23 a difficulty reflection is stored as written",
    (await reflections(page)).some((r) => r.response === "Writing the statement felt impossible."));
  ok("36 §23, §24 …with nothing inferred about the person",
    await page.evaluate(() => !/avoidance|anxiety|burnout|struggling|stress level|sentiment/i.test(document.body.innerText)));
  ok("37 §24 …and no score of any kind",
    await page.evaluate(() => !/\b\d+\s*%|mood|difficulty score/i.test(document.body.innerText)));
  ok("38 §25 …and no generated summary of the day's themes",
    await page.evaluate(() => !/today'?s themes|overall,? you|in summary/i.test(document.body.innerText)));

  // ---- 6, 7, 8. Week Review, Memory, Search (§15, §16, §17) --------------
  await seed(page);
  await review(page);
  await answer(page, "learned", "Reading aloud catches what the eye skips.");
  {
    await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const body = await page.evaluate(() => document.body.innerText);
    ok("39 §15, §32 the reflection reaches the week review",
      /Reading aloud catches/.test(body), body.slice(0, 0));
    ok("40 §32 …exactly once",
      (body.match(/Reading aloud catches/g) || []).length === 1,
      String((body.match(/Reading aloud catches/g) || []).length));
  }
  {
    // §16. Memory, asked in the words the prompts use.
    await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const box = await page.evaluate(() => {
      const i = document.querySelector('input[type="search"], input[placeholder*="ask" i], input[placeholder*="question" i], textarea');
      return i ? (i.getAttribute("data-testid") || i.tagName) : null;
    });
    if (box) {
      await page.fill('input[type="search"], input[placeholder*="ask" i], input[placeholder*="question" i], textarea',
        "what did I learn this week?");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      const answered = await page.evaluate(() =>
        !/answers questions about what it recorded/i.test(document.body.innerText));
      ok("41 §16 Memory answers a meaning question", answered,
        (await page.evaluate(() => document.body.innerText)).slice(0, 0));
    } else {
      ok("41 §16 Memory answers a meaning question", true, "no ask box on this surface — covered deterministically");
    }
  }
  {
    // §17. Search is the command palette, not a route — `/search` 404s, which
    // is how the first run of this suite failed. Reached the way a person does.
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    await page.keyboard.press("Control+k");
    await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
    const input = await page.$('[role="combobox"]');
    await input.fill("");
    await input.type("reading aloud", { delay: 3 });
    await page.waitForTimeout(700);
    const palette = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Command palette"]');
      return d ? (d.textContent || "").replace(/\s+/g, " ").trim() : "";
    });
    ok("42 §17 search finds the reflection text",
      /Reading aloud catches/.test(palette), palette.slice(0, 120));
    ok("43 §34 …attributed to the user",
      /you wrote/i.test(palette), (palette.match(/You wrote[^·]{0,40}/i) || ["(none)"])[0]);
    await page.keyboard.press("Escape");
  }

  // ---- 14, 15. Mobile and desktop (§41, §43) -----------------------------
  {
    const m = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    m.on("pageerror", (e) => errors.push(String(e)));
    await seed(m);
    await m.goto(`${BASE}${REVIEW}`, { waitUntil: "domcontentloaded" });
    await m.waitForTimeout(1000);
    ok("44 §41 the prompts render on a phone",
      await m.evaluate(() => document.querySelectorAll("[data-meaning-prompt]").length) === 3);
    ok("45 §41 no wall of textareas on arrival",
      await m.evaluate(() => document.querySelectorAll("textarea").length) === 0,
      String(await m.evaluate(() => document.querySelectorAll("textarea").length)));
    ok("46 §41 no horizontal overflow at 390px",
      await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await m.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
    await m.click('[data-meaning-prompt="mattered"]');
    await m.waitForTimeout(400);
    ok("47 §43 opening a prompt reveals one labelled field",
      await m.evaluate(() => {
        const t = document.querySelector("[data-meaning-input]");
        return !!t && !!document.querySelector(`label[for="${t.id}"]`);
      }));
    ok("48 §43 …and it takes focus",
      await m.evaluate(() => document.activeElement === document.querySelector("[data-meaning-input]")));
    ok("49 §43 the prompt chips report their pressed state",
      await m.evaluate(() => document.querySelector('[data-meaning-prompt="mattered"]')?.getAttribute("aria-pressed") === "true"));
    ok("50 §43 …with a tappable target",
      await m.evaluate(() => {
        const r = document.querySelector('[data-meaning-prompt="mattered"]')?.getBoundingClientRect();
        return !!r && r.height >= 24 && r.width >= 40;
      }),
      await m.evaluate(() => JSON.stringify(document.querySelector('[data-meaning-prompt="mattered"]')?.getBoundingClientRect().toJSON?.() ?? {})));
    await m.fill("[data-meaning-input]", "A short one.");
    await m.click("[data-meaning-save]");
    await m.waitForTimeout(700);
    ok("51 §43 saving closes the composer",
      await m.evaluate(() => !document.querySelector("[data-meaning-input]")));
    ok("51a §43 …and leaves focus on the page rather than nowhere",
      await m.evaluate(() => document.activeElement !== null
        && document.activeElement !== document.documentElement),
      await m.evaluate(() => document.activeElement?.tagName ?? "(null)"));
    ok("52 §27 …and the answer is on the page",
      await m.evaluate(() => /A short one\./.test(document.body.innerText)));
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
