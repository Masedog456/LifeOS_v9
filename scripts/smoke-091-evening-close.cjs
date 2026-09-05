#!/usr/bin/env node
/**
 * LIFEOS-091 §39 — browser torture for the evening close.
 *
 * The deterministic suite proves `buildEveningClose`. This proves the PAGE:
 * that a completion appears once and not twice, that a goal's movement is a
 * count of completed linked work, that a deferral and a reschedule are never
 * pooled, that a resolved wait reads as done while an open one reads as still
 * open, that "tomorrow already has" and "possible carry-forward" are two lists,
 * that nothing moves until the carry button is pressed, and that a machine's
 * sentence never appears under "in your own words".
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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

/** The audit's day. Field names checked against the schema, not guessed. */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g-grad", title: "Graduate school", priority: "high" }),
    goal({ id: "g-clinic", title: "Open the clinic", horizon: "long",
      history: [{ id: "gh1", kind: "horizon", at: at(0, 11), fromHorizon: "medium", toHorizon: "long" }] }),
    goal({ id: "g-move", title: "Move out of the flat", status: "completed", horizon: "near",
      history: [{ id: "gh2", kind: "status", at: at(0, 16), fromStatus: "active", toStatus: "completed" }] }),
  ],
  projects: [{ id: "p-apps", title: "Graduate applications", goalId: "g-grad", description: "",
    status: "active", priority: "high", notes: "", milestones: [], relatedDocuments: [],
    relatedEntities: [], createdAt: at(-90), updatedAt: at(-90) }],
  nextActions: [
    act({ id: "a-send", title: "Send application", projectId: "p-apps", status: "completed",
      completedAt: at(0, 14), dueDate: dk(0),
      history: [h("created", at(-1)), h("completed", at(0, 14), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "a-stmt", title: "Draft personal statement", projectId: "p-apps", status: "completed",
      completedAt: at(0, 10),
      history: [h("created", at(-8)), h("completed", at(0, 10), { fromStatus: "in_progress", toStatus: "completed" })] }),
    act({ id: "a-rec", title: "Request recommendation", projectId: "p-apps", status: "deferred",
      deferredUntil: dk(1),
      history: [h("created", at(-20)), h("deferred", at(-5, 17)), h("returned", at(-4, 6)),
        h("deferred", at(-2, 18)), h("returned", at(-1, 6)), h("deferred", at(0, 19))] }),
    act({ id: "a-dentist", title: "Dentist", dueDate: dk(2),
      history: [h("created", at(-7)), h("due_set", at(0, 12), { detail: dk(2) })] }),
    act({ id: "a-transcript", title: "Transcript from Maria", projectId: "p-apps",
      history: [h("created", at(-15)),
        h("waiting", at(-13, 9), { detail: "Maria", fromStatus: "open", toStatus: "waiting" }),
        h("edited", at(0, 15), { detail: "Maria", fromStatus: "waiting", toStatus: "open" })] }),
    act({ id: "a-lease", title: "Lease approval", status: "waiting", waitingOn: "Marcus",
      waitingSince: at(-8), followUpDate: dk(2),
      history: [h("created", at(-8)), h("waiting", at(-8, 9), { detail: "Marcus", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-final", title: "Send final draft", projectId: "p-apps", dueDate: dk(0),
      history: [h("created", at(-6))] }),
    act({ id: "a-legal", title: "Need legal review", history: [h("created", at(-6))] }),
    act({ id: "a-fee", title: "Pay the application fee", projectId: "p-apps", dueDate: dk(-3),
      history: [h("created", at(-10))] }),
    act({ id: "a-submit", title: "Submit the second application", projectId: "p-apps", dueDate: dk(1),
      history: [h("created", at(-4))] }),
    act({ id: "a-someday", title: "Read the funding guide", history: [h("created", at(-25))] }),
    act({ id: "a-drop", title: "Apply to the fifth school", projectId: "p-apps", status: "cancelled",
      history: [h("created", at(-30)), h("cancelled", at(0, 13), { fromStatus: "open", toStatus: "cancelled" })] }),
  ],
  actionDependencies: [{ id: "dep1", blockedId: "a-final", blockerId: "a-legal", createdAt: at(-6) }],
  events: [{ id: "e-dentist", title: "Dentist appointment", date: dk(1), startTime: "10:00",
    allDay: false, createdAt: at(-7), updatedAt: at(-7) }],
  reflections: [{ id: "r1", prompt: "What stood out today?",
    response: "The statement finally sounds like me rather than a form.",
    createdAt: at(0, 21), annotations: [] }],
  notes: [
    { id: "n1", title: "Fee waiver", body: "Ask the department whether the fee waiver still applies.",
      createdAt: at(0, 17), updatedAt: at(0, 17), tags: [], linkedEntityRefs: [] },
    { id: "n2", title: "Summary",
      body: "_AI-generated — Summary of this project:_\n\nGenerated overview of the application timeline.",
      createdAt: at(0, 17, 30), updatedAt: at(0, 17, 30), tags: [], linkedEntityRefs: [] },
  ],
  constitutionElements: [{ id: "c1", kind: "standard", statement: "I send one application per week.",
    status: "active", createdAt: at(0, 20), updatedAt: at(0, 20) }],
  constitutionRevisions: [{ id: "cr1", elementId: "c1", changeKind: "adopted", at: at(0, 20),
    newStatement: "I send one application per week.", evidenceRefs: [] }],
});

/** §22, §23, §36. Words a memory surface must never say about someone's day. */
const FORBIDDEN = ["great job", "well done", "productive day", "challenging but",
  "you struggled", "you seem", "falling behind", "unproductive", "productivity score",
  "% complete", "you should have", "only managed", "failed to"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const actionOf = async (page, id) => (await store(page)).nextActions.find((a) => a.id === id);

async function review(page) {
  await page.goto(`${BASE}/today/review`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(700);
}

/** Every section id present, and the text inside each. */
const sections = (page) => page.evaluate(() =>
  Object.fromEntries([...document.querySelectorAll("[data-review-section]")]
    .map((s) => [s.getAttribute("data-review-section"), (s.textContent || "").replace(/\s+/g, " ").trim()])));

const textsOf = (page, sel) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()), sel);

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page);
  await review(page);

  // ---- 1, 2. A completion is done — once, and with its goal (§6, §7) ------
  let done = await textsOf(page, "[data-review-completed]");
  ok("1 §6 a completed action is done", done.some((t) => /Send application/.test(t)), JSON.stringify(done));
  ok("2 §6 …and so is the other one", done.some((t) => /Draft personal statement/.test(t)));
  let moved = await textsOf(page, "[data-review-movement]");
  ok("3 §28 the goal behind them is named", moved.some((t) => /Graduate school/.test(t)), JSON.stringify(moved));
  ok("4 §28 …with a count of completed linked work",
    moved.some((t) => /2 linked actions completed/.test(t)), JSON.stringify(moved));
  ok("5 §36 …and no percentage or score anywhere on the page",
    !/\d+%|score/i.test(await page.evaluate(() => document.body.innerText)));

  // ---- RED 1. Once, not twice --------------------------------------------
  const all = await page.evaluate(() => document.body.innerText);
  ok("6 RED 1 'Send application' appears exactly once",
    (all.match(/Send application/g) || []).length === 1,
    String((all.match(/Send application/g) || []).length));
  ok("7 RED 1 …and so does the other completion",
    (all.match(/Draft personal statement/g) || []).length === 1,
    String((all.match(/Draft personal statement/g) || []).length));
  let changedTexts = await textsOf(page, "[data-review-changed]");
  ok("8 RED 1 the changed list holds no completion",
    !changedTexts.some((t) => /Send application|Draft personal statement/.test(t)),
    JSON.stringify(changedTexts));

  // ---- 3, 4, 5. Defer, reschedule, and the count (§9, §10) ---------------
  const deferred = await textsOf(page, "[data-review-deferred]");
  ok("9 §9 a deferred action is listed as deferred",
    deferred.some((t) => /Request recommendation/.test(t) && /Deferred/.test(t)), JSON.stringify(deferred));
  const resched = await textsOf(page, "[data-review-rescheduled]");
  ok("10 §9 a neutral reschedule is listed as a date change",
    resched.some((t) => /Dentist/.test(t) && /Date changed/.test(t)), JSON.stringify(resched));
  ok("11 §9 …and never as a deferral",
    !deferred.some((t) => /Dentist/.test(t)), JSON.stringify(deferred));
  ok("12 §9 …nor the deferral as a reschedule",
    !resched.some((t) => /Request recommendation/.test(t)));
  ok("13 §9 the page never pools them under one word",
    !/postponed/i.test(all), "postponed");
  const repeated = await textsOf(page, "[data-review-repeated]");
  ok("14 §10 the repeated deferral states its count",
    repeated.some((t) => /3 recorded deferrals/.test(t)), JSON.stringify(repeated));
  ok("15 §10 …factually, with no warning language",
    !FORBIDDEN.some((w) => repeated.join(" ").toLowerCase().includes(w)), JSON.stringify(repeated));

  // ---- 6, 7. Waiting, split (§12) ----------------------------------------
  const resolved = await textsOf(page, "[data-review-waiting-resolved]");
  ok("16 §6, §12 a wait that ended reads as done",
    resolved.some((t) => /Transcript from Maria/.test(t)), JSON.stringify(resolved));
  ok("17 §12 …naming the person it was on",
    resolved.some((t) => /Maria/.test(t)));
  const stillWaiting = await textsOf(page, "[data-review-waiting]");
  ok("18 §12 a wait still open reads as still open",
    stillWaiting.some((t) => /Lease approval/.test(t) && /Marcus/.test(t)), JSON.stringify(stillWaiting));
  ok("19 §12 …and the resolved one is not also still waiting",
    !stillWaiting.some((t) => /Transcript from Maria/.test(t)));
  ok("20 §12 …with the recorded follow-up date, and no claim about Marcus",
    stillWaiting.some((t) => /follow up/.test(t)) && !/owes|should have replied|chasing/i.test(all));

  // ---- 8, 9. Still open (§11, §13) ---------------------------------------
  const open = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-open]")].map((e) => ({
      kind: e.getAttribute("data-review-open"),
      text: (e.textContent || "").replace(/\s+/g, " ").trim(),
    })));
  ok("21 §11 still open is bounded to three", open.length <= 3, String(open.length));
  ok("22 §9.9 an overdue open action is there",
    open.some((o) => /Pay the application fee/.test(o.text)), JSON.stringify(open.map((o) => o.kind)));
  ok("23 §13 blocked work names its blocker",
    open.some((o) => o.kind === "blocked" && /Need legal review/.test(o.text)),
    JSON.stringify(open.map((o) => o.text.slice(0, 50))));
  ok("24 §13 …and inactivity is never called blocked",
    !open.some((o) => o.kind === "blocked" && /Read the funding guide/.test(o.text)));
  ok("25 §11 a completed action is never still open",
    !open.some((o) => /Send application/.test(o.text)));
  ok("26 §17 an open row carries the SAME resolver every surface uses",
    await page.evaluate(() => !!document.querySelector("[data-review-open] [data-resolution]")));

  // ---- 10, 11. Tomorrow: two lists (§14, §15, §16) -----------------------
  const scheduled = await textsOf(page, "[data-review-tomorrow]");
  ok("27 §14 work already dated tomorrow is under 'already has'",
    scheduled.some((t) => /Submit the second application/.test(t)), JSON.stringify(scheduled));
  ok("28 §16 …and so is a deferral returning tomorrow",
    scheduled.some((t) => /Request recommendation/.test(t)));
  const carry = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-carry-item]")].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()));
  ok("29 §15 the carry list offers genuinely unresolved work",
    carry.some((t) => /Pay the application fee/.test(t)), JSON.stringify(carry));
  ok("30 §14, §16 …and never what tomorrow already holds",
    !carry.some((t) => /Submit the second application|Request recommendation/.test(t)), JSON.stringify(carry));
  ok("31 §15 …nor work dated later than tomorrow",
    !carry.some((t) => /Dentist/.test(t)), JSON.stringify(carry));
  ok("32 §15 …nor open undated work invented into tomorrow",
    !carry.some((t) => /Read the funding guide/.test(t))
    && !scheduled.some((t) => /Read the funding guide/.test(t)));
  ok("33 §14 the two headings are visibly different",
    /Tomorrow already has/.test(all) && /Possible carry-forward/.test(all));
  ok("34 §16 …and the page says nothing moves on its own",
    await page.evaluate(() => /until you/i.test(document.querySelector("[data-review-carry-note]")?.textContent || "")));

  // ---- 11, 12. Carry: nothing moves until pressed ------------------------
  let a = await actionOf(page, "a-fee");
  ok("35 §16 the candidate has NOT been moved by being shown",
    a.status === "open" && !a.deferredUntil, JSON.stringify({ status: a.status, until: a.deferredUntil }));
  await page.click('[data-review-carry-confirm="a-fee"]');
  await page.waitForTimeout(800);
  a = await actionOf(page, "a-fee");
  ok("36 §17 pressing carries it through the existing setter",
    a.status === "deferred" && a.deferredUntil === dk(1),
    JSON.stringify({ status: a.status, until: a.deferredUntil }));
  ok("37 §17 …recording it as a deferral, like any other",
    a.history.some((x) => x.action === "deferred"), a.history.map((x) => x.action).join(">"));
  await review(page);
  const scheduled2 = await textsOf(page, "[data-review-tomorrow]");
  ok("38 §14 …and it now reads as scheduled rather than as a candidate",
    scheduled2.some((t) => /Pay the application fee/.test(t)), JSON.stringify(scheduled2));
  const carry2 = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-carry-item]")].map((e) => (e.textContent || "").trim()));
  ok("39 §14 …in exactly one of the two lists",
    !carry2.some((t) => /Pay the application fee/.test(t)), JSON.stringify(carry2));

  // ---- Every candidate must be work a press can actually move -----------
  //
  // The first run offered a GOAL — "Open the clinic · no active project is
  // linked to this goal" — and pressing it wrote nothing to the store while
  // announcing "Open the clinic — back tomorrow". A success message for a
  // mutation that never happened is worse than no button at all. This walks
  // EVERY candidate on a fresh day, so the loop cannot pass by being empty.
  await seed(page);
  await review(page);
  {
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll("[data-review-carry-confirm]")]
        .map((e) => e.getAttribute("data-review-carry-confirm")));
    ok("39a §15 the day offers at least one candidate to check",
      offered.length > 0, JSON.stringify(offered));
    const st2 = await store(page);
    ok("39b §15 every carry candidate is work, not a goal or a rule",
      offered.every((id) => st2.nextActions.some((a) => a.id === id)),
      offered.filter((id) => !st2.nextActions.some((a) => a.id === id)).join(","));
    for (const id of offered) {
      const before = JSON.stringify(await store(page));
      await page.click(`[data-review-carry-confirm="${id}"]`);
      await page.waitForTimeout(600);
      const changedStore = JSON.stringify(await store(page)) !== before;
      ok(`39c §16 pressing carry on ${id} really changes the record`,
        changedStore, changedStore ? "" : "the store was untouched");
    }
  }

  // ---- Carrying a WAIT must not orphan it (LIFEOS-090 §33, RED 1) -------
  //
  // "Carry to tomorrow" called `deferAction` directly at first. Pressing it on
  // a wait set `status: "deferred"` and left `waitingOn: "Marcus"` sitting on
  // the record — the wait gone from every surface that asks what you are
  // waiting on, while the person still owed a reply. Measured here, in the
  // browser, before it was routed through `planReplan`.
  {
    const waits = WORLD();
    ["Marcus", "Priya"].forEach((n, i) => waits.nextActions.push(act({
      id: `w${i}`, title: `Reply from ${n}`, status: "waiting", waitingOn: n,
      waitingSince: at(-10), followUpDate: dk(i - 2),
      history: [h("created", at(-10)),
        h("waiting", at(-10, 9), { detail: n, fromStatus: "open", toStatus: "waiting" })] })));
    await seed(page, waits);
    await review(page);
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll("[data-review-carry-confirm]")]
        .map((e) => e.getAttribute("data-review-carry-confirm")));
    const wid = offered.find((id) => /^w\d/.test(id));
    ok("39d §12 a due wait can reach the carry list", !!wid, JSON.stringify(offered));
    if (wid) {
      await page.click(`[data-review-carry-confirm="${wid}"]`);
      await page.waitForTimeout(800);
      const w = await actionOf(page, wid);
      ok("39e §11 …and carrying it NEVER orphans the wait",
        !(w.status === "deferred" && !!w.waitingOn),
        JSON.stringify({ status: w.status, waitingOn: w.waitingOn }));
      ok("39f §12 …it is still a wait, on the same person",
        w.status === "waiting" && w.waitingOn === (wid === "w0" ? "Marcus" : "Priya"),
        JSON.stringify({ status: w.status, waitingOn: w.waitingOn }));
      ok("39g §12 …with the wait's start date untouched",
        w.waitingSince === at(-10), String(w.waitingSince));
      ok("39h §11 …and the follow-up date is what moved",
        w.followUpDate === dk(1), String(w.followUpDate));
    }
  }

  // ---- 13, 14. The user's own words (§19, §22) --------------------------
  await seed(page);
  await review(page);
  const words = await textsOf(page, "[data-review-words]");
  ok("40 §19 a user reflection is shown",
    words.some((t) => /sounds like me/.test(t)), JSON.stringify(words));
  ok("41 §19 a user note is shown", words.some((t) => /fee waiver/i.test(t)), JSON.stringify(words));
  ok("42 §19, §22 a machine-authored note is NEVER 'in your own words'",
    !words.some((t) => /Generated overview/.test(t)), JSON.stringify(words));
  ok("43 §22 …and its text is not on the page under any heading",
    !/Generated overview of the application timeline/.test(await page.evaluate(() => document.body.innerText)));

  // ---- 20. The optional memory prompt (§20, §21) ------------------------
  ok("44 §20 an optional prompt is offered",
    await page.evaluate(() => !!document.querySelector('[data-meaning-prompt="remember"]')));
  ok("45 §20 …phrased as optional, never as an assignment",
    !/complete your|required|daily journal/i.test(await page.evaluate(() => document.body.innerText)));
  const beforeR = (await store(page)).reflections.length;
  // LIFEOS-093 replaced the single input with a chosen prompt and one composer.
  // What 091 asserts is unchanged — an optional answer reaches the existing
  // reflection path with its prompt preserved — so only the selectors move.
  await page.click('[data-meaning-prompt="remember"]');
  await page.waitForSelector('[data-meaning-input="remember"]', { timeout: 10000 });
  await page.fill('[data-meaning-input="remember"]', "Sent the first application after four months.");
  await page.click("[data-meaning-save]");
  await page.waitForTimeout(800);
  const st = await store(page);
  ok("46 §21 an answer is stored through the existing reflection path",
    st.reflections.length === beforeR + 1, `${beforeR} → ${st.reflections.length}`);
  // Find it, do not assume where the store puts it — `addReflection` prepends,
  // so reading the last element returned the pre-existing fixture reflection
  // and the assertions below failed against the wrong record.
  const newest = st.reflections.find((r) => /four months/.test(r.response || "")) || {};
  ok("47 §21 …with the prompt preserved as provenance",
    /worth remembering/i.test(newest.prompt || ""), JSON.stringify(newest.prompt));
  ok("48 §21 …and the user's own words as the response",
    /four months/.test(newest.response || ""), JSON.stringify(newest.response));
  ok("49 §21 no new record type was invented for it",
    !Object.keys(st).some((k) => /diary|journal/i.test(k)), Object.keys(st).filter((k) => /diary|journal/i.test(k)).join(","));

  // ---- 15, 16. Direction is not movement (§8) ---------------------------
  const direction = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-direction]")].map((e) => ({
      kind: e.getAttribute("data-review-direction"),
      text: (e.textContent || "").replace(/\s+/g, " ").trim(),
    })));
  ok("50 §8 a goal horizon change is shown as a change",
    direction.some((d) => d.kind === "goal_horizon_changed" && /Open the clinic/.test(d.text)),
    JSON.stringify(direction.map((d) => d.kind)));
  ok("51 §8 …with both ends of the transition",
    direction.some((d) => d.kind === "goal_horizon_changed" && /→/.test(d.text)),
    JSON.stringify(direction.find((d) => d.kind === "goal_horizon_changed")?.text));
  ok("52 §8, §7 …and never as movement",
    !(await textsOf(page, "[data-review-movement]")).some((t) => /Open the clinic/.test(t)));
  ok("53 §39.16 an achieved goal is a recorded change",
    direction.some((d) => d.kind === "goal_status_changed" && /Move out of the flat/.test(d.text)));
  ok("54 §39.16 …with no demand for a next action about it",
    !/what.s next for|add a next action for Move out/i.test(await page.evaluate(() => document.body.innerText)));
  ok("55 §29 a standard adopted today is a change",
    direction.some((d) => d.kind === "rule_adopted"), JSON.stringify(direction.map((d) => d.kind)));
  ok("56 §29 …and there is no default Rules section",
    !(await sections(page)).rules);

  // ---- 17. A quiet day (§24) --------------------------------------------
  await seed(page, { ...EMPTY() });
  await review(page);
  ok("57 §24 a quiet day says what was recorded, factually",
    await page.evaluate(() => /No completed or changed commitments were recorded today/.test(
      document.querySelector("[data-review-quiet]")?.textContent || "")));
  const quietBody = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  ok("58 §24 …with no guilt anywhere on the page",
    !FORBIDDEN.some((w) => quietBody.includes(w)),
    FORBIDDEN.filter((w) => quietBody.includes(w)).join(","));
  const quietSections = await sections(page);
  ok("59 §5 …and empty sections are omitted rather than shown empty",
    !quietSections.done && !quietSections.changed && !quietSections["still-open"],
    JSON.stringify(Object.keys(quietSections)));

  // ---- 18. A dense day stays bounded (§11, §41) -------------------------
  {
    const dense = WORLD();
    for (let i = 0; i < 40; i += 1) {
      dense.nextActions.push(act({ id: `bulk${i}`, title: `Overdue chore ${i}`, dueDate: dk(-4),
        history: [h("created", at(-30))] }));
    }
    await seed(page, dense);
    await review(page);
    const denseOpen = await page.evaluate(() => document.querySelectorAll("[data-review-open]").length);
    const denseCarry = await page.evaluate(() => document.querySelectorAll("[data-review-carry-item]").length);
    ok("60 §11 forty overdue chores do not become forty rows", denseOpen <= 3, String(denseOpen));
    ok("61 §11 …and the carry list stays bounded", denseCarry <= 3, String(denseCarry));
    ok("62 §5 …with at most five primary sections",
      Object.keys(await sections(page)).length <= 5, JSON.stringify(Object.keys(await sections(page))));
  }

  // ---- §5. The section budget on a full day ------------------------------
  await seed(page);
  await review(page);
  const full = await sections(page);
  ok("63 §5 a full day runs five sections at most",
    Object.keys(full).length <= 5, JSON.stringify(Object.keys(full)));
  ok("64 §5 …and they are the five the brief names",
    Object.keys(full).every((k) => ["done", "changed", "still-open", "reflections", "tomorrow"].includes(k)),
    JSON.stringify(Object.keys(full)));

  // ---- §26. The previous day ---------------------------------------------
  await page.click("[data-review-prev]");
  await page.waitForTimeout(700);
  const prevText = await page.evaluate(() => document.body.innerText);
  ok("65 §26 the previous day can be reviewed",
    !/Send application/.test(prevText), "today's completion is absent from yesterday");
  ok("66 §26 …and the heading is that day, not 'Today'",
    await page.evaluate(() => !/^Review today/i.test(document.querySelector("h1")?.textContent || "")),
    await page.evaluate(() => document.querySelector("h1")?.textContent || ""));
  ok("67 §20 …and the optional prompt is not offered for a past day",
    await page.evaluate(() => !document.querySelector("[data-meaning-prompt]")));
  await page.click("[data-review-next]");
  await page.waitForTimeout(700);
  ok("68 §26 …and you can come back to today",
    await page.evaluate(() => /Send application/.test(document.body.innerText)));

  // ---- §22, §32, §36. Language and consistency ---------------------------
  const body = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  ok("69 §22, §36 the page never evaluates the day",
    !FORBIDDEN.some((w) => body.includes(w)),
    FORBIDDEN.filter((w) => body.includes(w)).join(","));
  ok("70 §22 …and never narrates it",
    !/today was|it was a .* day|overall, you/i.test(body));
  ok("71 §24 …and says what it covers in a day's words, not a week's",
    await page.evaluate(() => /complete record of your day/.test(
      document.querySelector("[data-review-coverage]")?.textContent || "")),
    await page.evaluate(() => document.querySelector("[data-review-coverage]")?.textContent || ""));

  // ---- 20. Reload keeps the facts (§39.20) -------------------------------
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const after = await sections(page);
  ok("72 §39.20 the same facts survive a reload",
    JSON.stringify(Object.keys(after)) === JSON.stringify(Object.keys(full)),
    `${JSON.stringify(Object.keys(after))} vs ${JSON.stringify(Object.keys(full))}`);

  // ---- 19. Mobile (§41, §43) --------------------------------------------
  {
    const m = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    m.on("pageerror", (e) => errors.push(String(e)));
    await seed(m);
    await review(m);
    ok("73 §41 the review renders on a phone",
      await m.evaluate(() => document.querySelectorAll("[data-review-section]").length > 0));
    ok("74 §41 no horizontal overflow at 390px",
      await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await m.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
    ok("75 §43 exactly one h1", await m.evaluate(() => document.querySelectorAll("h1").length) === 1);
    ok("76 §43 every section has a real heading",
      await m.evaluate(() => [...document.querySelectorAll("[data-review-section]")]
        .every((s) => !!s.querySelector("h2")?.textContent?.trim())));
    ok("77 §43 the optional prompt is labelled once opened",
      await m.evaluate(async () => {
        document.querySelector("[data-meaning-prompt]")?.click();
        await new Promise((r) => setTimeout(r, 300));
        const i = document.querySelector("[data-meaning-input]");
        return !!i && !!document.querySelector(`label[for="${i.id}"]`);
      }));
    ok("78 §43 the carry confirmation is keyboard reachable",
      await m.evaluate(() => {
        const b = document.querySelector("[data-review-carry-confirm]");
        if (!b) return true;
        b.focus();
        return document.activeElement === b;
      }));
    await m.close();
  }

  ok("79 no page errors in any of the above", errors.length === 0, errors.slice(0, 2).join(" | "));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ${r.name} — ${r.detail}`));
  }
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})();
