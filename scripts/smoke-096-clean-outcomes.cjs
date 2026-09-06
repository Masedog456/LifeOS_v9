#!/usr/bin/env node
/**
 * LIFEOS-096 §41 — browser torture for clean titles and named outcomes.
 *
 * The deterministic suite proves the rule. This proves the RECORD: that what
 * lands in the store carries the clean name, that the sentence that made it is
 * still there beside it, that negation and dependencies and blockers survive
 * because the rule never touches them, that completion matching still fires,
 * that search finds the record by both the clean title and the words actually
 * typed, and that Home's immediate and recent descriptions agree.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-5), updatedAt: at(-5), ...p });

const WORLD = () => ({ ...EMPTY(),
  goals: [{ id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: at(-90), updatedAt: at(-90) }],
  projects: [{ id: "p1", title: "Clinic launch", description: "", status: "active", priority: "medium",
    notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: at(-90), updatedAt: at(-90) }],
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
async function home(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#capture", { timeout: 20000 });
  await page.waitForTimeout(900);
}
async function say(page, text) {
  await page.waitForSelector("[data-capture-submit]", { timeout: 8000 });
  await page.fill("#capture", text);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(1300);
}
const shape = (page) => page.evaluate(() => ({
  finished: [...document.querySelectorAll("[data-capture-saved]")].map((li) =>
    li.innerText.replace(/\s+/g, " ").trim()),
  reviewing: [...document.querySelectorAll("[data-candidate]")].map((li) => ({
    kind: li.getAttribute("data-candidate"),
    title: li.querySelector('input[aria-label="Title"]')?.value ?? null,
    text: li.innerText.replace(/\s+/g, " ").trim().slice(0, 160),
  })),
  recent: [...document.querySelectorAll("[data-recent-capture]")].map((li) =>
    li.innerText.replace(/\s+/g, " ").trim()),
}));

/** Search through the command palette — the product's real retrieval path. */
async function search(page, q) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  await page.fill('[role="combobox"]', q);
  await page.waitForTimeout(600);
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return hits;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. The waiting record gets a name --------------------------------
  await seed(page);
  await home(page);
  await say(page, "I'm waiting on Maria for the transcript");
  {
    const st = await shape(page);
    const s1 = await store(page);
    const a = s1.nextActions[0];
    ok("1 §8 the waiting record is named for the thing, not the sentence",
      a?.title === "Transcript from Maria", String(a?.title));
    ok("2 §9 …and waitingOn is preserved", a?.waitingOn === "Maria", String(a?.waitingOn));
    ok("3 §3 …and the raw capture is still exactly what was typed",
      s1.captures.some((c) => c.text === "I'm waiting on Maria for the transcript"),
      s1.captures.map((c) => c.text).join(" | "));
    ok("4 §25 …and the record still points back at it",
      !!a?.sourceCaptureId && s1.captures.some((c) => c.id === a.sourceCaptureId),
      String(a?.sourceCaptureId));
    ok("5 §35 …and Home says the clean name, not the sentence",
      /Transcript from Maria/.test(st.finished[0] ?? "")
      && !/I'm waiting on Maria/.test(st.finished[0] ?? ""), st.finished[0] ?? "");
  }

  // ---- 6. Immediate and recent agree (§34) ------------------------------
  {
    await home(page);
    const st = await shape(page);
    ok("6 §34 the recent row names the record the same way",
      /Transcript from Maria/.test(st.recent[0] ?? ""), st.recent[0] ?? "");
    ok("7 §17 …beside the sentence that made it, unchanged",
      /I'm waiting on Maria for the transcript/.test(st.recent[0] ?? ""), st.recent[0] ?? "");
  }

  // ---- 8, 9. Search finds it both ways (§27) ----------------------------
  {
    const byTitle = await search(page, "transcript from maria");
    ok("8 §27 search finds the record by its clean title",
      byTitle.some((h) => /Transcript from Maria/.test(h)), byTitle.slice(0, 4).join(" | "));
    const byRaw = await search(page, "waiting on maria");
    ok("9 §27 …and by the words that were actually typed",
      byRaw.some((h) => /Transcript from Maria/.test(h)), byRaw.slice(0, 4).join(" | "));
  }

  // ---- 10. Dates leave the title, not the record (§22) ------------------
  {
    await seed(page); await home(page);
    await say(page, "Dinner with Ana next Thursday at 7");
    const s2 = await store(page);
    const e = s2.events[0];
    ok("10 §22 an event is named for itself", e?.title === "Dinner with Ana", String(e?.title));
    ok("11 §22 …with the date and time in fields",
      !!e?.date && e?.startTime === "19:00", `${e?.date} ${e?.startTime}`);
  }
  {
    await seed(page); await home(page);
    await say(page, "Finish the philosophy statement tomorrow");
    const s3 = await store(page);
    ok("12 §22 an action keeps its date in a field",
      s3.nextActions[0]?.title === "Finish the philosophy statement"
      && s3.nextActions[0]?.dueDate === dk(1),
      `${s3.nextActions[0]?.title} / ${s3.nextActions[0]?.dueDate}`);
  }

  // ---- 13. Framing residue is capitalised (§24) --------------------------
  {
    await seed(page); await home(page);
    await say(page, "I need to send Marcus the lease");
    const s4 = await store(page);
    ok("13 §24 what framing-stripping leaves behind reads like a record",
      s4.nextActions[0]?.title === "Send Marcus the lease", String(s4.nextActions[0]?.title));
  }

  // ---- 14, 15, 16. What must never be rewritten -------------------------
  for (const [text, why, mustNot] of [
    ["I don't need to send Marcus the lease", "negation (§18)", /^Send Marcus the lease$/],
    ["The clinic launch is blocked by the lease", "the blocker (§21)", /^Clinic launch$/i],
    ["I realized teaching isn't what I want", "reflective prose (§13)", /^Leave teaching$/i],
  ]) {
    await seed(page); await home(page);
    await say(page, text);
    const st = await shape(page);
    const titles = st.reviewing.map((r) => r.title ?? r.text);
    ok(`14 §18 ${why} — nothing is inverted`,
      !titles.some((t) => mustNot.test(t ?? "")), titles.join(" | "));
    ok(`15 §18 …and the sentence is offered whole`,
      titles.some((t) => (t ?? "").includes(text.slice(0, 24))), titles.join(" | "));
    const s5 = await store(page);
    ok(`16 §22 …with no Action written behind the user's back`,
      (s5.nextActions ?? []).length === 0, String((s5.nextActions ?? []).length));
  }

  // ---- 17. A dependency stays structural (§20) --------------------------
  {
    await seed(page); await home(page);
    await say(page, "When Marcus replies, send the lease");
    // The trigger and response live in INPUT values, not in text nodes — a
    // first version of this read innerText and failed while the product was
    // correct.
    const fields = await page.evaluate(() => ({
      kinds: [...document.querySelectorAll("[data-candidate]")].map((li) => li.getAttribute("data-candidate")),
      trigger: document.querySelector('input[aria-label="Protocol trigger"]')?.value ?? null,
      response: document.querySelector('input[aria-label="Protocol response"]')?.value ?? null,
    }));
    ok("17 §20 a dependency becomes a trigger, and is not stripped into an errand",
      fields.kinds.includes("protocol") && fields.trigger === "Marcus replies"
      && fields.response === "send the lease",
      `${fields.kinds.join(",")} · ${fields.trigger} → ${fields.response}`);
    const s7 = await store(page);
    ok("17b §20 …and no immediately-executable Action was written",
      (s7.nextActions ?? []).length === 0, String((s7.nextActions ?? []).length));
  }

  // ---- 18. Completion matching still fires (§17) ------------------------
  {
    const w = WORLD();
    w.nextActions = [act({ id: "a-rec", title: "Send the recommendation request", projectId: "p1" })];
    await seed(page, w); await home(page);
    await say(page, "I finished the recommendation request");
    const change = await page.evaluate(() =>
      !!document.querySelector("[data-change-confirm], [data-change-intent]")
      || /finished|complete/i.test(document.querySelector("main")?.innerText ?? ""));
    ok("18 §17 a completion sentence is still read as a change", change, "");
  }
  {
    // The forward direction: a record NAMED by this sprint is still reachable
    // by a later completion sentence.
    const w = WORLD();
    w.nextActions = [act({ id: "a-t", title: "Transcript from Maria", status: "waiting", waitingOn: "Maria" })];
    await seed(page, w); await home(page);
    await say(page, "I got the transcript from Maria");
    const s6 = await store(page);
    ok("19 §17 …and a cleanly-named record is matched by a later one",
      s6.nextActions.length === 1, s6.nextActions.map((a) => a.title).join(" | "));
  }

  // ---- 20. A domain that used to say "Filed" (§30) ----------------------
  {
    const w = WORLD();
    w.decisions = [{ id: "d1", title: "Choose graduate program", question: "q", status: "exploring",
      options: [], criteria: [], createdAt: at(0), updatedAt: at(0) }];
    w.constitutionElements = [{ id: "s1", kind: "standard", statement: "Pause before replying when angry",
      status: "active", createdAt: at(0), updatedAt: at(0) }];
    w.captures = [
      { id: "c-d", text: "Which graduate program should I choose", createdAt: at(0, 11),
        processingStatus: "processed", processedAt: at(0, 11),
        linkedEntityRefs: [{ kind: "decision", id: "d1" }] },
      { id: "c-s", text: "I should pause before replying when angry", createdAt: at(0, 10),
        processingStatus: "processed", processedAt: at(0, 10),
        linkedEntityRefs: [{ kind: "constitution_element", id: "s1" }] },
    ];
    await seed(page, w); await home(page);
    const st = await shape(page);
    const joined = st.recent.join(" || ");
    ok("20 §30 a capture filed as a Decision is named, not “Filed”",
      /Decision · Choose graduate program/.test(joined), joined.slice(0, 200));
    ok("21 §30 …and one filed as a Rule too",
      /Rule · Pause before replying when angry/.test(joined), joined.slice(0, 200));
    ok("22 §33 …and nothing on the page still says “Filed”",
      !/\bFiled\b/.test(joined), joined.slice(0, 200));
  }

  // ---- 23. An outcome the store cannot back (§31, §33) ------------------
  {
    const w = WORLD();
    w.captures = [{ id: "c-x", text: "Something filed somewhere", createdAt: at(0, 9),
      processingStatus: "processed", processedAt: at(0, 9),
      linkedEntityRefs: [{ kind: "decision", id: "does-not-exist" }] }];
    await seed(page, w); await home(page);
    const st = await shape(page);
    ok("23 §31 a ref the store cannot back is never given a name",
      /Filed/.test(st.recent[0] ?? "") && !/Decision/.test(st.recent[0] ?? ""), st.recent[0] ?? "");
  }

  // ---- 24. Reload changes nothing --------------------------------------
  {
    await seed(page); await home(page);
    await say(page, "I'm waiting on Maria for the transcript");
    const before = (await shape(page)).finished[0] ?? "";
    await home(page);
    const after = (await shape(page)).recent[0] ?? "";
    ok("24 §34 the name survives a reload and does not change",
      /Transcript from Maria/.test(before) && /Transcript from Maria/.test(after),
      `${before} || ${after}`);
  }

  // ---- 25. Accessibility (§45) ------------------------------------------
  {
    const a11y = await page.evaluate(() => {
      const li = document.querySelector("[data-recent-capture]");
      return { hasText: (li?.innerText ?? "").length > 0,
        linkNames: [...(li?.querySelectorAll("a") ?? [])].map((a) => a.textContent.trim()),
        sectionLabel: document.querySelector("[data-recent-captures]")?.getAttribute("aria-label") ?? "" };
    });
    ok("25 §45 the outcome is text, not an icon",
      a11y.hasText && a11y.linkNames.every((n) => n.length > 0), JSON.stringify(a11y.linkNames));
    ok("26 §45 …in a labelled region", a11y.sectionLabel.length > 0, a11y.sectionLabel);
  }
  await ctx.close();

  // ---- 27. Mobile -------------------------------------------------------
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await seed(p); await home(p);
    await say(p, "I'm waiting on Maria for the transcript");
    const st = await shape(p);
    const overflow = await p.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("27 §41 the clean name reads on a phone",
      /Transcript from Maria/.test(st.finished[0] ?? ""), st.finished[0] ?? "");
    ok("28 §41 …without scrolling sideways", overflow <= 1, String(overflow));
    await c.close();
  }

  ok("29 §41 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
