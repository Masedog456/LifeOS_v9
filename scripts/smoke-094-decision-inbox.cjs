#!/usr/bin/env node
/**
 * LIFEOS-094 §46 — browser torture for "Needs your decision".
 *
 * The deterministic suite proves the derivation. This proves the PAGE: that
 * open work never leaks onto it, that each row's buttons are the ones its model
 * named, that answering a question makes the row disappear with nothing left
 * behind, that the count on Today appears and vanishes with the queue, and that
 * a reload restores nothing because nothing was stored.
 *
 * It also pins the boundary §40 assumed away: this app observes no cross-tab
 * write at all, so "the record changed in another tab" is not a race the queue
 * can lose — it is a state the queue does not see until a reload.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const QUEUE = "/today/decisions";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-30), updatedAt: at(0, 18), ...p });
const h = (action, atIso, extra = {}) => ({ action, at: atIso, ...extra });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: at(-90), updatedAt: at(-90), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at(-90), updatedAt: at(-90), ...p });

/** Three deferrals, spread over real days, with the returns between them. */
const THRICE = [h("created", at(-30)), h("deferred", at(-9, 17)), h("returned", at(-8, 6)),
  h("deferred", at(-5, 17)), h("returned", at(-4, 6)), h("deferred", at(-1, 19))];

/**
 * One of everything the queue must show, and one of everything it must not.
 *
 * The exclusions are the point: a plain overdue action, a wait whose follow-up
 * is three weeks out, a single deferral, a blocked action and its blocker, a
 * goal that already has work, an achieved goal, and a capture already filed.
 */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g-none", title: "Learn to sail" }),
    goal({ id: "g-ok", title: "Graduate school", priority: "high" }),
    goal({ id: "g-done", title: "Move out of the flat", status: "completed" }),
  ],
  projects: [
    proj({ id: "p-apps", title: "Graduate applications", goalId: "g-ok", priority: "high" }),
    proj({ id: "p-teach", title: "Teaching portfolio" }),
  ],
  nextActions: [
    // ---- decisions --------------------------------------------------------
    act({ id: "a-wait-due", title: "Transcript from Maria", projectId: "p-apps", status: "waiting",
      waitingOn: "Maria", waitingSince: at(-9), followUpDate: dk(0),
      history: [h("waiting", at(-9), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-thrice", title: "Request recommendation", projectId: "p-apps", status: "deferred",
      deferredUntil: dk(5), history: THRICE }),
    // ---- never decisions --------------------------------------------------
    act({ id: "a-overdue", title: "Pay the application fee", projectId: "p-apps", dueDate: dk(-4) }),
    act({ id: "a-soon", title: "Draft the personal statement", goalId: "g-ok", dueDate: dk(1) }),
    act({ id: "a-wait-future", title: "Lease approval", status: "waiting", waitingOn: "Marcus",
      waitingSince: at(-4), followUpDate: dk(21),
      history: [h("waiting", at(-4), { detail: "Marcus", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-once", title: "Book the hall", history: [h("created", at(-30)), h("deferred", at(-1, 19))] }),
    act({ id: "a-blocked", title: "Send final draft", projectId: "p-apps", dueDate: dk(0) }),
    act({ id: "a-blocker", title: "Need legal review" }),
  ],
  actionDependencies: [{ id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-30) }],
  captures: [
    { id: "c1", text: "Follow up on the applications and the portfolio review",
      createdAt: at(0, 10), processingStatus: "inbox", linkedEntityRefs: [] },
    { id: "c2", text: "Follow up on the applications and the portfolio review",
      createdAt: at(0, 9), processingStatus: "processed", processedAt: at(0, 9), linkedEntityRefs: [] },
  ],
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

async function queue(page) {
  await page.goto(`${BASE}${QUEUE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-decision-inbox]", { timeout: 20000 });
  await page.waitForTimeout(700);
}
const rows = (page) => page.evaluate(() =>
  [...document.querySelectorAll("[data-decision]")].map((li) => ({
    kind: li.getAttribute("data-decision"),
    id: li.getAttribute("data-decision-entity"),
    question: li.querySelector("[data-decision-question]")?.textContent ?? "",
    reason: li.querySelector("[data-decision-reason]")?.textContent ?? "",
    controls: [...li.querySelectorAll("[data-resolution],[data-decision-option]")]
      .map((b) => b.textContent.trim()),
  })));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. The four kinds render, and nothing else does -------------------
  await seed(page);
  await queue(page);
  let r = await rows(page);
  const ids = r.map((x) => x.id);
  ok("1 §5 the queue renders exactly the four decisions", r.length === 4, ids.join(","));
  for (const [id, why] of [
    ["c1", "the contested capture"], ["a-wait-due", "the due follow-up"],
    ["g-none", "the goal with no path"], ["a-thrice", "the thrice-deferred action"],
  ]) ok(`2 §5 ${id} is present — ${why}`, ids.includes(id), ids.join(","));

  // ---- 3. §17. Open work never leaks onto this page ----------------------
  for (const [id, why] of [
    ["a-overdue", "plain overdue"], ["a-soon", "due tomorrow"],
    ["a-wait-future", "a follow-up three weeks out"], ["a-once", "one deferral"],
    ["a-blocked", "blocked"], ["a-blocker", "an ordinary open action"],
    ["g-ok", "a goal that has work"], ["g-done", "an achieved goal"],
    ["c2", "a capture already filed"],
  ]) ok(`3 §17 ${id} is absent — ${why}`, !ids.includes(id), ids.join(","));

  // ---- 4. §20. Every row leads with a question ---------------------------
  ok("4 §20 every row leads with a question", r.every((x) => x.question.trim().endsWith("?")),
    r.map((x) => x.question).join(" | "));
  ok("5 §38 …and states why underneath", r.every((x) => x.reason.trim().length > 0),
    r.map((x) => x.reason).join(" | "));

  // ---- 6. §21. The controls are the model's options, really rendered -----
  const deferral = r.find((x) => x.id === "a-thrice");
  ok("6 §21 the deferral row can be answered both ways",
    deferral.controls.includes("Stop doing this")
    && (deferral.controls.includes("Reschedule") || deferral.controls.includes("Not today")),
    deferral.controls.join(" | "));
  const wait = r.find((x) => x.id === "a-wait-due");
  ok("7 §21 the wait offers keeping it and ending it",
    wait.controls.includes("Set next follow-up") && wait.controls.includes("Stop waiting"),
    wait.controls.join(" | "));
  const goalRow = r.find((x) => x.id === "g-none");
  ok("8 §21 the goal offers a path and a way to look",
    goalRow.controls.includes("Add a project") && goalRow.controls.includes("Open goal"),
    goalRow.controls.join(" | "));
  const cap = r.find((x) => x.id === "c1");
  ok("9 §21 the capture names both projects and the third answer",
    cap.controls.some((c) => /Graduate applications/.test(c))
    && cap.controls.some((c) => /Teaching portfolio/.test(c))
    && cap.controls.includes("Neither"),
    cap.controls.join(" | "));
  ok("10 §21 every row offers two to four controls",
    r.every((x) => x.controls.length >= 2 && x.controls.length <= 4),
    r.map((x) => `${x.id}:${x.controls.length}`).join(" "));

  // ---- 11. §22. Nothing is preselected and nothing ran on load -----------
  const before = await store(page);
  ok("11 §22 rendering the queue changed no record",
    JSON.stringify(before.nextActions) === JSON.stringify(WORLD().nextActions),
    "");
  ok("12 §22 no control is preselected",
    await page.evaluate(() => ![...document.querySelectorAll("[data-decision] button")]
      .some((b) => b.getAttribute("aria-pressed") === "true" || b.dataset.selected === "true")));

  // ---- 13. §39. Answering makes the row disappear, with no bookkeeping ---
  await page.click('[data-decision-entity="a-wait-due"] [data-resolution="stop_waiting"]');
  await page.waitForSelector("[data-resolution-confirm]", { timeout: 10000 });
  await page.click("[data-resolution-confirm]");
  await page.waitForTimeout(900);
  r = await rows(page);
  ok("13 §39 stopping the wait removes its row",
    !r.some((x) => x.id === "a-wait-due"), r.map((x) => x.id).join(","));
  const afterStop = await store(page);
  ok("14 §39 …and the record, not a queue row, is what changed",
    afterStop.nextActions.find((a) => a.id === "a-wait-due").status !== "waiting",
    afterStop.nextActions.find((a) => a.id === "a-wait-due").status);
  ok("15 §24 nothing about a queue was written to the store",
    !JSON.stringify(afterStop).includes("decisionInbox")
    && !JSON.stringify(afterStop).includes("dismissedDecision"),
    "");

  // ---- 16. §41. A reload restores nothing, because nothing was stored ----
  await queue(page);
  const reloaded = (await rows(page)).map((x) => x.id);
  ok("16 §41 the reloaded queue is derived, not remembered",
    !reloaded.includes("a-wait-due") && reloaded.length === 3, reloaded.join(","));

  // ---- 17. §40. Stopping, and the boundary the brief assumed away --------
  //
  // §40 asks what happens when the record changed "in another tab". The honest
  // answer is that this product has no such event: `lib/mvpStore.ts` registers
  // no `storage` listener, so a second tab's write is not observed at all until
  // a reload. `decisionStillStands` is real and is proven deterministically
  // (94.35-94.38) against a state that already moved; what a BROWSER can prove
  // is the reachable half — the stop works — and the shape of the boundary.
  await seed(page);
  await queue(page);
  await page.click('[data-decision-entity="a-thrice"] [data-decision-option="stop"]');
  await page.waitForTimeout(900);
  const afterStop2 = await store(page);
  ok("17 §21 stopping the thrice-deferred action ends it",
    afterStop2.nextActions.find((a) => a.id === "a-thrice").status === "cancelled",
    afterStop2.nextActions.find((a) => a.id === "a-thrice").status);
  ok("18 §39 …and its row goes with it",
    !(await rows(page)).some((x) => x.id === "a-thrice"),
    (await rows(page)).map((x) => x.id).join(","));
  {
    // The boundary, asserted as behaviour rather than described in a comment.
    await seed(page);
    await queue(page);
    const other = await ctx.newPage();
    await other.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await other.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.goals.find((g) => g.id === "g-none").status = "abandoned";
      localStorage.setItem(k, JSON.stringify(s));
    }, KEY);
    await page.waitForTimeout(900);
    const live = (await rows(page)).map((x) => x.id);
    ok("19 §40 a second tab's write is not observed live — this app has no cross-tab sync",
      live.includes("g-none"), live.join(","));
    await queue(page);
    const reread = (await rows(page)).map((x) => x.id);
    ok("20 §40 …and a reload derives the queue from what is actually stored",
      !reread.includes("g-none"), reread.join(","));
    await other.close();
  }

  // ---- 18. §35. Zero is a calm, complete page ---------------------------
  await seed(page, { ...EMPTY() });
  await queue(page);
  const empty = await page.evaluate(() => ({
    text: document.querySelector("[data-decision-empty]")?.textContent ?? "",
    rows: document.querySelectorAll("[data-decision]").length,
  }));
  ok("21 §35 an empty world says so in one calm sentence",
    empty.rows === 0 && /Nothing needs your decision right now\./.test(empty.text), empty.text);
  ok("22 §35 …with no exclamation, no praise and no queue metaphor",
    !/!|caught up|inbox zero|well done|great/i.test(empty.text), empty.text);

  // ---- 20. §36. The cap holds and the remainder is stated ---------------
  {
    const big = WORLD();
    for (let i = 0; i < 12; i++) big.goals.push(goal({ id: `gx${i}`, title: `Direction ${i}` }));
    await seed(page, big);
    await queue(page);
    const shown = (await rows(page)).length;
    const more = await page.evaluate(() =>
      document.querySelector("[data-decision-remainder]")?.textContent ?? "");
    ok("23 §36 the page shows at most five", shown === 5, String(shown));
    ok("24 §36 …and states the remainder rather than dropping it",
      /11 more waiting on a decision\./.test(more), more);
  }

  // ---- 22. §26, §27. Today carries the count, and loses it at zero -------
  await seed(page);
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-orientation]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  const todayLine = await page.evaluate(() => ({
    link: document.querySelector("[data-decision-count-link]")?.textContent ?? "",
    body: document.body.innerText,
  }));
  ok("25 §26 Today links to the queue",
    /Needs your decision/.test(todayLine.link), todayLine.link);
  ok("26 §27 …states the count once, in the orientation line, in its own words",
    /4 needing your decision/.test(todayLine.body)
    && !/Needs your decision · /.test(todayLine.link),
    `${todayLine.link} | ${(todayLine.body.match(/[^\n]*needing your decision[^\n]*/) ?? [""])[0]}`);
  await seed(page, { ...EMPTY() });
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  ok("27 §26 an empty queue takes no space on Today",
    await page.evaluate(() => !document.querySelector("[data-decision-count-link]")));

  // ---- 25. §28. The evening close points at it, once ---------------------
  await seed(page);
  await page.goto(`${BASE}/today/review`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(900);
  const ev = await page.evaluate(() => ({
    n: document.querySelectorAll("[data-review-decisions]").length,
    text: document.querySelector("[data-review-decisions]")?.textContent ?? "",
    questions: document.querySelectorAll("[data-decision-question]").length,
  }));
  ok("28 §28 the evening close points at the queue exactly once",
    ev.n === 1 && /Needs your decision · 4/.test(ev.text), `${ev.n} · ${ev.text}`);
  ok("29 §28 …and does not render the questions a second time", ev.questions === 0, String(ev.questions));

  // ---- 27. §32. The palette finds it, and does not collide ---------------
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  await page.fill('[role="combobox"]', "needs your decision");
  await page.waitForTimeout(500);
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()));
  ok("30 §32 the palette finds the queue by its name",
    hits.some((x) => /Needs your decision/.test(x)), hits.slice(0, 5).join(" | "));
  await page.fill('[role="combobox"]', "decisions");
  await page.waitForTimeout(500);
  const both = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()));
  ok("31 §4 …and the knowledge Decision kind is still its own entry",
    both.some((x) => /Open Decisions/.test(x)) && both.some((x) => /Needs your decision/.test(x)),
    both.slice(0, 6).join(" | "));
  await page.keyboard.press("Escape");

  // ---- 29. Keyboard and mobile ------------------------------------------
  await queue(page);
  // Bounded, because the queue sits below the app chrome and the number of
  // stops before it is not this sprint's business — only that it is reachable.
  let focused = null;
  for (let i = 0; i < 40 && !(focused && focused.inside); i++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? "",
      label: (document.activeElement?.textContent ?? "").trim().slice(0, 40),
      inside: !!document.activeElement?.closest("[data-decision-inbox]"),
    }));
  }
  ok("32 §50 tabbing reaches a real control inside the queue",
    !!focused && focused.inside && /BUTTON|A|INPUT/.test(focused.tag), JSON.stringify(focused));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("33 §46 the page does not scroll sideways on a phone", overflow <= 1, String(overflow));
  await page.setViewportSize({ width: 1280, height: 1400 });

  // ---- 31. §44, §10. Nothing on the page reads the person ---------------
  await queue(page);
  const text = await page.evaluate(() => document.querySelector("[data-decision-inbox]").innerText);
  const banned = ["avoiding", "avoidance", "afraid", "fear", "resistance", "self-sabotage",
    "procrastinat", "you keep", "failing", "should have", "urgent", "critical", "at risk", "score"];
  const hitWords = banned.filter((w) => new RegExp(w, "i").test(text));
  ok("34 §44 the page diagnoses nobody", hitWords.length === 0, hitWords.join(","));
  ok("35 §10 the deferral row states the count and stops",
    /deferred this 3 times/.test(text), (text.match(/deferred[^.]*\./) ?? [""])[0]);

  ok("36 §46 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
