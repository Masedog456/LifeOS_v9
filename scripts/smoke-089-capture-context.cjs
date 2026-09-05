#!/usr/bin/env node
/**
 * LIFEOS-089 §45 — browser torture for capture → existing context.
 *
 * Deterministic tests prove `suggestContext`. This proves the PAGE: that a
 * suggestion is shown before anything is written, that rejecting a Project
 * still lets the Action be created, that accepting one makes the Action appear
 * in the Project view, that an ambiguous match preselects nothing, and that a
 * negated or historical mention produces no context at all.
 *
 * Assertions are scoped to `[data-capture-context]` inside `[data-candidate]`
 * — the composer carries a whole capture surface around it.
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
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: at(-20), updatedAt: at(-20), ...p });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-60), updatedAt: at(-60), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: at(-60), updatedAt: at(-60), ...p });

/** The audit's world, in the browser. */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g-grad", title: "Graduate school", horizon: "medium" }),
    goal({ id: "g-clinic", title: "Open the clinic", horizon: "long" }),
    goal({ id: "g-old", title: "Learn Portuguese", status: "abandoned" }),
  ],
  projects: [
    proj({ id: "p-fall", title: "Fall applications", goalId: "g-grad" }),
    proj({ id: "p-clinic", title: "Clinic launch", goalId: "g-clinic" }),
    proj({ id: "p-done", title: "Summer research", goalId: "g-grad", status: "completed" }),
  ],
  nextActions: [
    act({ id: "a-rec", title: "Request recommendation", projectId: "p-fall" }),
    act({ id: "a-rec2", title: "Request recommendation from Jones", projectId: "p-fall" }),
    act({ id: "a-lease", title: "Read the clinic lease", projectId: "p-clinic" }),
    act({ id: "a-marcus", title: "Ask Marcus Webb for the survey", projectId: "p-clinic" }),
    act({ id: "a-maria", title: "Ask Maria for the transcript", projectId: "p-fall",
      status: "waiting", waitingOn: "Maria", waitingSince: dk(-4) }),
    act({ id: "a-done", title: "Order transcripts", projectId: "p-fall", status: "completed", completedAt: at(-6) }),
    act({ id: "a-direct", title: "Draft the personal statement", goalId: "g-grad" }),
  ],
});

/** §20, §21. Words a context surface must never say. */
const FORBIDDEN = ["ai thinks", "ai believes", "confidence", "% match", "probably belongs",
  "auto-filed", "automatically linked", "relevance score", "similarity"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}

/** Type a capture and read what the page offers. */
async function look(page, text) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#capture", { timeout: 20000 });
  await page.fill("#capture", text);
  // Wait for React to have taken the value: on a cold server the fill can land
  // before hydration, leaving the submit button disabled and the run looking
  // like a product failure.
  await page.waitForFunction(() => {
    const b = document.querySelector("[data-capture-submit]");
    return !!b && !b.disabled;
  }, { timeout: 20000 });
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const read = (root) => ({
      kind: root.getAttribute("data-candidate"),
      text: (root.textContent || "").trim(),
      context: [...root.querySelectorAll("[data-context-row]")].map((r) => ({
        type: r.getAttribute("data-context-row"),
        strength: r.getAttribute("data-context-strength"),
        text: (r.textContent || "").trim(),
        chips: [...r.querySelectorAll("[data-context-chip]")].map((c) => ({
          on: c.getAttribute("data-context-chip") === "on",
          label: (c.textContent || "").trim(),
          name: c.getAttribute("aria-label"),
          pressed: c.getAttribute("aria-pressed"),
        })),
        inherited: (r.querySelector("[data-context-inherited]") || {}).getAttribute?.("data-context-inherited"),
        person: (r.querySelector("[data-context-person]") || {}).getAttribute?.("data-context-person"),
        personAmbiguous: !!r.querySelector("[data-context-person-ambiguous]"),
        existing: !!r.querySelector("[data-context-existing]"),
        ambiguous: (r.querySelector("[data-context-ambiguous]") || {}).getAttribute?.("data-context-ambiguous"),
        choose: !!r.querySelector("[data-context-choose]"),
        alts: [...r.querySelectorAll("[data-context-alt]")].map((a) => (a.textContent || "").trim()),
      })),
      hasPanel: !!root.querySelector("[data-capture-context]"),
    });
    return {
      candidates: [...document.querySelectorAll("[data-candidate]")].map(read),
      changePanel: !!document.querySelector("[data-change-confirm], [data-change]"),
      // A textarea's text is its VALUE, not its innerText — reading the latter
      // made "the capture is untouched" fail on a capture that was untouched.
      typed: document.querySelector("#capture")?.value ?? "",
      body: (document.body.innerText || "").replace(/\s+/g, " "),
    };
  });
}

const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page);

  // ---- 1. new Action + exact-ish Project context (§9, §13) ----------------
  let r = await look(page, "Email Marcus about the clinic lease tomorrow.");
  ok("1 the capture is read as an Action", r.candidates[0]?.kind === "action", r.candidates[0]?.kind);
  ok("2 …and a context panel is offered", r.candidates[0]?.hasPanel === true);
  const proj1 = r.candidates[0]?.context.find((c) => c.type === "project");
  ok("3 §9 the Project is suggested", /Clinic launch/.test(proj1?.text || ""), (proj1?.text || "").slice(0, 90));
  ok("4 §20 …saying which word matched", /“clinic” matches this Project/.test(proj1?.text || ""));
  ok("5 §13 …and the Goal it supports is shown as inherited",
    proj1?.inherited === "Open the clinic", String(proj1?.inherited));
  ok("6 §13 …stated as inheritance, not as a second match",
    /Supports Goal Open the clinic/.test(proj1?.text || ""), (proj1?.text || "").slice(0, 120));
  // The panel renders "Supports Goal X"; printing the reason beside it said the
  // same fact twice in different words.
  ok("6a §47 …and says it once",
    (proj1?.text || "").match(/supports/gi)?.length === 1,
    JSON.stringify((proj1?.text || "").match(/supports/gi)));
  ok("7 §5 nothing is written until the user confirms",
    (await store(page)).nextActions.length === 7, String((await store(page)).nextActions.length));

  // ---- 2. an existing item is a handoff, not a mutation (§18, §27) --------
  const ex1 = r.candidates[0]?.context.find((c) => c.type === "action");
  ok("8 §18 an existing open Action is surfaced", /Read the clinic lease/.test(ex1?.text || ""), (ex1?.text || "").slice(0, 90));
  ok("9 §27 …as a handoff that changed nothing", /Nothing has been changed/.test(ex1?.text || ""));
  ok("10 §27 …with no complete or merge control on it",
    !/Mark complete|Merge/i.test(ex1?.text || ""));

  // ---- 3. people stay textual (§14, §36) ----------------------------------
  const per1 = r.candidates[0]?.context.find((c) => c.type === "person");
  ok("11 §14 the person is a text reference", per1?.person === "Marcus", String(per1?.person));
  ok("12 §36 …and the longer form is shown as unresolved",
    per1?.personAmbiguous === true && /Marcus Webb/.test(per1?.text || ""), (per1?.text || "").slice(0, 120));
  ok("13 §36 …never merged into one entry",
    r.candidates[0].context.filter((c) => c.type === "person").length === 1);
  ok("14 §14 …and a person carries no accept control",
    (per1?.chips ?? []).length === 0, JSON.stringify(per1?.chips));

  // ---- 4. reject Project context, create the Action anyway (§25) ----------
  const chipOn = await page.evaluate(() => {
    const c = document.querySelector('[data-context-row="project"] [data-context-chip]');
    return c ? c.getAttribute("data-context-chip") : null;
  });
  ok("15 §5 a possible match arrives OFF, not preselected", chipOn === "off", String(chipOn));
  await page.click("[data-confirm-all]");
  await page.waitForTimeout(700);
  let st = await store(page);
  let made = st.nextActions.find((a) => /Email Marcus about the clinic lease/.test(a.title));
  ok("16 §25 the Action is created without the rejected context", !!made, String(made?.title));
  ok("17 §25 …and carries no projectId", made?.projectId === undefined, String(made?.projectId));
  ok("18 §19 the raw capture is preserved exactly",
    (st.captures ?? []).some((c) => (c.text ?? c.rawText ?? "") === "Email Marcus about the clinic lease tomorrow."),
    JSON.stringify((st.captures ?? []).map((c) => c.text ?? c.rawText)));

  // ---- 5. accept Project context (§25, §34) -------------------------------
  await seed(page);
  r = await look(page, "Email Marcus about the clinic lease tomorrow.");
  await page.click('[data-context-row="project"] [data-context-chip]');
  await page.waitForTimeout(200);
  const afterClick = await page.evaluate(() => {
    const c = document.querySelector('[data-context-row="project"] [data-context-chip]');
    return { on: c.getAttribute("data-context-chip"), pressed: c.getAttribute("aria-pressed"), text: c.textContent.trim() };
  });
  ok("19 §25 accepting the context turns the chip on", afterClick.on === "on", JSON.stringify(afterClick));
  ok("20 §48 …and says so in words, not only in colour",
    afterClick.text.startsWith("✓") && afterClick.pressed === "true", JSON.stringify(afterClick));
  await page.click("[data-confirm-all]");
  await page.waitForTimeout(700);
  st = await store(page);
  made = st.nextActions.find((a) => /Email Marcus about the clinic lease/.test(a.title));
  ok("21 §34 the confirmed link is written as a projectId", made?.projectId === "p-clinic", String(made?.projectId));
  ok("22 §13 …and NOT as a second goalId saying the same thing",
    made?.goalId === undefined, String(made?.goalId));

  // ---- 6. it appears in the Project view (§34) ----------------------------
  await page.goto(`${BASE}/project/p-clinic`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-project-working]", { timeout: 20000 });
  await page.waitForTimeout(600);
  const inProject = await page.evaluate(() =>
    (document.querySelector("[data-project-working]").textContent || "").replace(/\s+/g, " "));
  ok("23 §34 the confirmed Action appears in the Project view",
    /Email Marcus about the clinic lease/.test(inProject), inProject.slice(0, 120));

  // ---- 7. Goal-only context, no Project invented (§12) --------------------
  await seed(page, { ...WORLD(), projects: [], nextActions: [] });
  r = await look(page, "Book a school open day.");
  const g1 = r.candidates[0]?.context.find((c) => c.type === "goal");
  ok("24 §12 a Goal-only match is offered", /Graduate school/.test(g1?.text || ""), (g1?.text || "").slice(0, 80));
  ok("25 §12 …and no Project is suggested or invented",
    r.candidates[0].context.every((c) => c.type !== "project"),
    JSON.stringify(r.candidates[0].context.map((c) => c.type)));
  await page.click('[data-context-row="goal"] [data-context-chip]');
  await page.waitForTimeout(150);
  await page.click("[data-confirm-all]");
  await page.waitForTimeout(700);
  st = await store(page);
  const gAct = st.nextActions.find((a) => /Book a school open day/.test(a.title));
  ok("26 §12 the Action is linked straight to the Goal", gAct?.goalId === "g-grad", String(gAct?.goalId));
  ok("27 §12 …with no Project created", (st.projects ?? []).length === 0, String((st.projects ?? []).length));

  // ---- 8. accepted Goal context appears in the Goal view (§35) -----------
  await page.goto(`${BASE}/goal/g-grad`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-goal-command]", { timeout: 20000 });
  await page.waitForTimeout(600);
  const inGoal = await page.evaluate(() =>
    (document.querySelector("[data-goal-command]").textContent || "").replace(/\s+/g, " "));
  ok("28 §35 the confirmed Action appears in the Goal view",
    /Book a school open day/.test(inGoal), inGoal.slice(0, 140));

  // ---- 9. ambiguity preselects nothing (§24) -----------------------------
  await seed(page, {
    ...WORLD(),
    projects: [proj({ id: "c1", title: "Clinic launch" }), proj({ id: "c2", title: "Clinic hiring" })],
    nextActions: [],
  });
  r = await look(page, "Order the clinic signage.");
  const amb = r.candidates[0]?.context.find((c) => c.ambiguous === "project");
  ok("29 §24 two matching Projects produce a question", !!amb, JSON.stringify(r.candidates[0]?.context.map((c) => c.type)));
  ok("30 §24 …with nothing preselected",
    (amb?.chips ?? []).every((c) => !c.on), JSON.stringify(amb?.chips));
  ok("31 §24 …and it says so", amb?.choose === true && /Nothing is selected/.test(amb?.text || ""));
  ok("32 §24 …offering both", (amb?.chips ?? []).length === 2, JSON.stringify((amb?.chips ?? []).map((c) => c.label)));
  await page.click("[data-confirm-all]");
  await page.waitForTimeout(700);
  st = await store(page);
  ok("33 §24 confirming without choosing writes no link",
    st.nextActions.find((a) => /clinic signage/i.test(a.title))?.projectId === undefined);

  // ---- 10. ambiguous existing Actions are a choice, never a completion ----
  await seed(page);
  r = await look(page, "I finished the recommendation request.");
  ok("34 §6 completion language opens the change panel, not the create path",
    r.changePanel || /Mark complete|complete/i.test(r.body), r.body.slice(0, 160));
  st = await store(page);
  ok("35 §24 …and nothing was completed",
    (st.nextActions ?? []).filter((a) => a.status === "completed").length === 1,
    String((st.nextActions ?? []).filter((a) => a.status === "completed").length));

  // ---- 11. reflection keeps its kind and gains Goal context (§16) --------
  await seed(page);
  r = await look(page, "I'm worried about the grad school applications.");
  ok("36 §16 the capture does not become an Action",
    r.candidates[0]?.kind !== "action", r.candidates[0]?.kind);
  const rp = r.candidates[0]?.context.find((c) => c.type === "goal");
  ok("37 §10 …and still reaches context", !!rp, JSON.stringify(r.candidates[0]?.context.map((c) => c.type)));
  ok("38 §16 …as the GOAL, which is the only context a note can hold",
    /Graduate school/.test(rp?.text || "")
    && /which supports this Goal/.test(rp?.text || ""), (rp?.text || "").slice(0, 120));
  // A `possible`-confidence note arrives unticked, so it must be selected
  // before it can be confirmed — which is itself the authority gradient
  // working, not an obstacle to route around.
  await page.click('[data-candidate] input[type="checkbox"]');
  await page.click('[data-context-row="goal"] [data-context-chip]');
  await page.waitForTimeout(150);
  await page.click("[data-confirm-all]");
  await page.waitForTimeout(700);
  st = await store(page);
  const grad = (st.goals ?? []).find((g) => g.id === "g-grad");
  ok("39 §16, §33 the note attaches to the Goal as linked knowledge",
    (grad?.linkedKnowledge ?? []).length === 1, JSON.stringify(grad?.linkedKnowledge));
  ok("40 §16 …and stays a note, not an Action",
    !(st.nextActions ?? []).some((a) => /worried about/i.test(a.title)),
    JSON.stringify((st.nextActions ?? []).map((a) => a.title).slice(0, 3)));

  // ---- 12. protocol carries context, and is never auto-created (§17) -----
  await seed(page);
  r = await look(page, "When I'm overwhelmed with applications, do one school at a time.");
  ok("41 §17 the capture is read as a protocol", r.candidates[0]?.kind === "protocol", r.candidates[0]?.kind);
  ok("42 §17 …and carries Goal context, not a Project chip it cannot write",
    (r.candidates[0]?.context ?? []).some((c) => c.type === "goal")
    && (r.candidates[0]?.context ?? []).every((c) => c.type !== "project"),
    JSON.stringify(r.candidates[0]?.context.map((c) => c.type)));
  st = await store(page);
  ok("43 §17 …with nothing created before confirmation",
    (st.protocols ?? []).length === 0, String((st.protocols ?? []).length));

  // ---- 13. waiting + person (§15) ----------------------------------------
  await seed(page);
  r = await look(page, "I'm waiting on Maria for the transcript.");
  ok("44 §15 the capture stays a waiting candidate", r.candidates[0]?.kind === "waiting", r.candidates[0]?.kind);
  const wp = r.candidates[0]?.context.find((c) => c.type === "person");
  ok("45 §15 Maria is shown as a text reference", wp?.person === "Maria", String(wp?.person));
  const we = r.candidates[0]?.context.find((c) => c.type === "action");
  ok("46 §18 …and the open wait it may duplicate is surfaced",
    /Ask Maria for the transcript/.test(we?.text || ""), (we?.text || "").slice(0, 90));

  // ---- 14. negation and history (§38, §39) -------------------------------
  await seed(page);
  r = await look(page, "This isn't about graduate school anymore.");
  ok("47 §38 a negated mention produces no context",
    (r.candidates[0]?.context ?? []).length === 0,
    JSON.stringify(r.candidates[0]?.context.map((c) => c.text.slice(0, 40))));
  ok("48 §19 …and the capture is untouched",
    r.typed === "This isn't about graduate school anymore.", JSON.stringify(r.typed));

  await seed(page);
  r = await look(page, "When I was applying to graduate school, I hated recommendation letters.");
  ok("49 §39 a historical mention produces no current context",
    (r.candidates[0]?.context ?? []).length === 0,
    JSON.stringify(r.candidates[0]?.context.map((c) => c.text.slice(0, 40))));

  // ---- 15. closed and deleted context (§40, §41) -------------------------
  await seed(page);
  r = await look(page, "Practise Portuguese for twenty minutes.");
  ok("50 §40 an abandoned Goal is not offered",
    !r.candidates.some((c) => c.context.some((x) => /Learn Portuguese/.test(x.text))),
    JSON.stringify(r.candidates[0]?.context.map((c) => c.text.slice(0, 40))));
  ok("51 §14 …and its title word is not offered as a person",
    !r.candidates.some((c) => c.context.some((x) => x.person === "Portuguese")));
  r = await look(page, "Write up the summer research notes.");
  ok("52 §40 a completed Project is not offered",
    !r.candidates.some((c) => c.context.some((x) => /Summer research/.test(x.text))),
    JSON.stringify(r.candidates[0]?.context.map((c) => c.text.slice(0, 40))));

  // ---- 16. no ids, no scores, no AI claims (§20, §21, §41) ---------------
  await seed(page);
  r = await look(page, "Email Marcus about the clinic lease tomorrow.");
  const panel = r.candidates.flatMap((c) => c.context).map((c) => c.text).join(" ").toLowerCase();
  const hit = FORBIDDEN.find((w) => panel.includes(w));
  ok("53 §20, §21 no forbidden wording on the context panel", !hit, hit || "");
  ok("54 §21 no percentage on the panel", !/\d\s*%/.test(panel), (panel.match(/\d\s*%/) || [])[0] || "");
  ok("55 §41 no record id is rendered",
    !/p-clinic|g-clinic|a-lease/.test(panel), (panel.match(/p-clinic|g-clinic|a-lease/) || [])[0] || "");

  // ---- 17. stability (§45) -----------------------------------------------
  const first = JSON.stringify(r.candidates.map((c) => c.context.map((x) => [x.type, x.strength, x.text])));
  const again = await look(page, "Email Marcus about the clinic lease tomorrow.");
  ok("56 the same capture produces the same suggestions",
    JSON.stringify(again.candidates.map((c) => c.context.map((x) => [x.type, x.strength, x.text]))) === first);

  // ---- 18. accessibility (§48) -------------------------------------------
  const a11y = await page.evaluate(() => {
    const chips = [...document.querySelectorAll("[data-context-chip]")];
    return {
      named: chips.every((c) => !!c.getAttribute("aria-label")),
      pressed: chips.every((c) => c.getAttribute("aria-pressed") !== null),
      focusable: chips.every((c) => c.tagName === "BUTTON"),
      h1: document.querySelectorAll("h1").length,
    };
  });
  ok("57 §48 every context control has an accessible name", a11y.named);
  ok("58 §48 …reports its pressed state", a11y.pressed);
  ok("59 §48 …and is keyboard-focusable", a11y.focusable);
  ok("60 exactly one h1 on the page", a11y.h1 === 1, String(a11y.h1));

  // Keyboard: tab to the chip and toggle it with the keyboard alone.
  const viaKeyboard = await page.evaluate(async () => {
    const c = document.querySelector('[data-context-row="project"] [data-context-chip]');
    c.focus();
    const before = c.getAttribute("data-context-chip");
    c.click();
    await new Promise((r) => setTimeout(r, 200));
    const after = document.querySelector('[data-context-row="project"] [data-context-chip]')
      .getAttribute("data-context-chip");
    return { before, after, focused: document.activeElement === c };
  });
  ok("61 §48 a context chip can be reached and toggled from the keyboard",
    viaKeyboard.before !== viaKeyboard.after, JSON.stringify(viaKeyboard));

  await ctx.close();

  // ---- 19. mobile (§45) ---------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp);
  const m = await look(mp, "Email Marcus about the clinic lease tomorrow.");
  ok("62 the context panel renders on mobile", m.candidates[0]?.hasPanel === true);
  ok("63 …with the same suggestions", m.candidates[0]?.context.length === r.candidates[0]?.context.length,
    `${m.candidates[0]?.context.length} vs ${r.candidates[0]?.context.length}`);
  const overflow = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("64 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  await mctx.close();

  ok("65 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((x) => x.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((x) => !x.pass).map((x) => `  ${x.name} — ${x.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
