#!/usr/bin/env node
/**
 * LIFEOS-090 §39 — browser torture for replanning.
 *
 * Deterministic tests prove `planReplan` and the resolution vocabulary. This
 * proves the PAGE: that "Not today" leaves Today and keeps the work open, that
 * a wait is never offered the control that would orphan it, that a recurring
 * row says why one occurrence cannot move, that a blocked row leads with its
 * blocker, and that a mixed batch shows its exceptions before anything moves.
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

const WORLD = () => ({ ...EMPTY(),
  goals: [{ id: "g1", title: "Open the clinic", description: "", status: "active", priority: "medium",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], history: [], horizon: "medium",
    createdAt: at(-60), updatedAt: at(-60) }],
  projects: [{ id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
    priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: at(-60), updatedAt: at(-60) }],
  nextActions: [
    act({ id: "a-over", title: "Send the signed lease", projectId: "p1", dueDate: dk(-2) }),
    act({ id: "a-plain", title: "Pay the deposit", projectId: "p1", dueDate: dk(0) }),
    act({ id: "a-wait", title: "Transcript from Maria", projectId: "p1", status: "waiting",
      waitingOn: "Maria", waitingSince: at(-9), followUpDate: dk(0) }),
    act({ id: "a-blocked", title: "Send final draft", projectId: "p1", dueDate: dk(0) }),
    act({ id: "a-blocker", title: "Need legal review", projectId: "p1" }),
    act({ id: "a-recur", title: "Water the plants", projectId: "p1", dueDate: dk(0),
      recurrence: { frequency: "weekly", interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] } }),
    act({ id: "a-direct", title: "Draft the business plan", goalId: "g1", dueDate: dk(0) }),
  ],
  actionDependencies: [{ id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-5) }],
});

/** §32, §35. Words a replanning surface must never say. */
const FORBIDDEN = ["ai recommends", "you seem", "overloaded", "you should really",
  "falling behind", "be honest with yourself", "priority raised"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const actionOf = async (page, id) => (await store(page)).nextActions.find((a) => a.id === id);

/** The controls a given action's row offers, read from the actions page. */
async function rowControls(page, id) {
  await page.goto(`${BASE}/actions/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-action-replan]", { timeout: 20000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => [...document.querySelectorAll("[data-action-replan] [data-resolution]")].map((b) => ({
    kind: b.getAttribute("data-resolution"),
    label: (b.textContent || "").trim(),
    disabled: b.disabled === true,
    title: b.getAttribute("title") || "",
  })));
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page);

  // ---- 1. Today offers "Not today" on the recommendation (§5, §20) -------
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-suggested-next]", { timeout: 20000 });
  await page.waitForTimeout(700);
  let controls = await page.evaluate(() =>
    [...document.querySelectorAll("[data-suggested-next] [data-resolution]")].map((b) => ({
      kind: b.getAttribute("data-resolution"), label: (b.textContent || "").trim(),
    })));
  ok("1 §5 the suggested row offers 'Not today'",
    controls.some((c) => c.kind === "not_today" && c.label === "Not today"), JSON.stringify(controls));
  ok("2 §20 …in a compact menu, not a control panel", controls.length <= 3, String(controls.length));
  ok("3 §5 …and 'Defer' is not shown beside it under a second name",
    !controls.some((c) => c.kind === "defer"), JSON.stringify(controls.map((c) => c.kind)));

  // ---- 2. "Not today" → tomorrow (§5, §6, §28) ---------------------------
  await page.click('[data-suggested-next] [data-resolution="not_today"]');
  await page.waitForTimeout(300);
  const choices = await page.evaluate(() =>
    [...document.querySelectorAll("[data-resolution-choice]")].map((b) => ({
      id: b.getAttribute("data-resolution-choice"), label: (b.textContent || "").trim(),
    })));
  ok("4 §5 the quick choices open on one press", choices.length > 0, JSON.stringify(choices));
  ok("5 §5 …leading with tomorrow", choices[0]?.id === "tomorrow", JSON.stringify(choices[0]));
  ok("6 §8 …and offering next week", choices.some((c) => c.id === "next_week"));
  ok("7 §5 …and someday", choices.some((c) => c.id === "someday"));
  ok("8 §7 …with no invented 'later this week'",
    !choices.some((c) => /later this week/i.test(c.label)), JSON.stringify(choices.map((c) => c.label)));

  await page.click('[data-resolution-choice="tomorrow"]');
  await page.waitForTimeout(700);
  let a = await actionOf(page, "a-over");
  ok("9 §5 the item is deferred, not completed", a.status === "deferred", a.status);
  ok("10 §5 …to tomorrow", a.deferredUntil === dk(1), String(a.deferredUntil));
  ok("11 §46.2 …and it is still open work, not cancelled",
    a.status !== "completed" && a.status !== "cancelled", a.status);
  ok("12 §4 …with the deferral recorded as a deferral",
    a.history.some((h) => h.action === "deferred"), a.history.map((h) => h.action).join(">"));
  ok("13 §22 …and its Project link intact", a.projectId === "p1", String(a.projectId));

  // ---- 3. Suggested Next recomputes (§21) --------------------------------
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const nextTitle = await page.evaluate(() => {
    const el = document.querySelector("[data-suggested-next]");
    return el ? (el.textContent || "").replace(/\s+/g, " ") : "";
  });
  ok("14 §21 the deferred item is no longer suggested",
    !/Send the signed lease/.test(nextTitle), nextTitle.slice(0, 100));

  // ---- 4. Neutral reschedule leaves no deferral (§4, §24) ----------------
  await seed(page);
  controls = await rowControls(page, "a-plain");
  ok("15 §4 an ordinary row offers Reschedule as well as Not today",
    controls.some((c) => c.kind === "reschedule") && controls.some((c) => c.kind === "not_today"),
    JSON.stringify(controls.map((c) => c.kind)));
  await page.click('[data-resolution="reschedule"]');
  await page.waitForTimeout(300);
  await page.click('[data-resolution-choice="tomorrow"]');
  await page.waitForTimeout(700);
  a = await actionOf(page, "a-plain");
  ok("16 §4 a reschedule moves the due date", a.dueDate === dk(1), String(a.dueDate));
  ok("17 §4 …and leaves the status alone", a.status === "open", a.status);
  ok("18 §24, §26 …and writes NO deferral fact",
    !a.history.some((h) => h.action === "deferred"), a.history.map((h) => h.action).join(">"));

  // ---- 5. Waiting stays waiting (§11) ------------------------------------
  await seed(page);
  controls = await rowControls(page, "a-wait");
  ok("19 §11 a waiting row never offers a plain reschedule",
    !controls.some((c) => c.kind === "reschedule"), JSON.stringify(controls.map((c) => c.kind)));
  ok("20 §11 …and never an enabled 'Not today'",
    !controls.some((c) => c.kind === "not_today" && !c.disabled),
    JSON.stringify(controls.map((c) => `${c.kind}${c.disabled ? "(off)" : ""}`)));
  ok("21 §11 …it offers the follow-up instead",
    controls.some((c) => c.kind === "set_follow_up"), JSON.stringify(controls.map((c) => c.kind)));
  ok("22 §11 …and a way to end the wait explicitly",
    controls.some((c) => c.kind === "stop_waiting"), JSON.stringify(controls.map((c) => c.kind)));
  await page.click('[data-resolution="set_follow_up"]');
  await page.waitForTimeout(300);
  await page.click('[data-resolution-choice="next_week"]');
  await page.waitForTimeout(700);
  a = await actionOf(page, "a-wait");
  ok("23 §11 the follow-up date moves", a.followUpDate === dk(7), String(a.followUpDate));
  ok("24 §11 …and it is STILL waiting", a.status === "waiting", a.status);
  ok("25 §11 …on the same person", a.waitingOn === "Maria", String(a.waitingOn));
  ok("26 §11 …with the wait's start date untouched",
    a.waitingSince === at(-9), String(a.waitingSince));

  // ---- 6. Blocked keeps its blocker and leads with it (§13) --------------
  await seed(page);
  controls = await rowControls(page, "a-blocked");
  ok("27 §13 a blocked row leads with its blocker",
    controls[0]?.kind === "open_blocker", JSON.stringify(controls.map((c) => c.kind)));
  ok("28 §13 …and replanning is still available underneath it",
    controls.some((c) => c.kind === "not_today"), JSON.stringify(controls.map((c) => c.kind)));
  await page.click('[data-resolution="not_today"]');
  await page.waitForTimeout(300);
  await page.click('[data-resolution-choice="tomorrow"]');
  await page.waitForTimeout(700);
  let st = await store(page);
  a = st.nextActions.find((x) => x.id === "a-blocked");
  ok("29 §46.5 the dependency survives the replan",
    (st.actionDependencies ?? []).some((d) => d.blockedId === "a-blocked" && d.blockerId === "a-blocker"),
    JSON.stringify(st.actionDependencies));
  ok("30 §13 …and the blocker itself is untouched",
    st.nextActions.find((x) => x.id === "a-blocker")?.status === "open");
  ok("31 §5 …while the item did move", a.deferredUntil === dk(1), String(a.deferredUntil));

  // ---- 7. Recurring: the series is preserved (§14, §15) ------------------
  await seed(page);
  controls = await rowControls(page, "a-recur");
  ok("32 §14 a recurring row offers the occurrence-scoped completion",
    controls.some((c) => c.kind === "complete_occurrence"), JSON.stringify(controls.map((c) => c.kind)));
  ok("33 §14 …and never the one that would end the series",
    !controls.some((c) => c.kind === "complete_action"), JSON.stringify(controls.map((c) => c.kind)));
  const nt = controls.find((c) => c.kind === "not_today");
  ok("34 §15 'Not today' is shown but disabled", !!nt && nt.disabled === true, JSON.stringify(nt));
  ok("35 §15 …with the limitation stated rather than faked",
    /can't move one without moving the whole repeat/.test(nt?.title || ""), String(nt?.title));
  // A real press cannot reach a disabled control, so a plain click here would
  // pass by never arriving. Dispatch the event directly: if anything is wired
  // behind the disabled state, this finds it.
  await page.evaluate(() => {
    const b = document.querySelector('[data-resolution="not_today"]');
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  a = await actionOf(page, "a-recur");
  ok("36 §14 pressing it changes nothing about the series",
    a.status === "open" && !a.deferredUntil && !!a.recurrence,
    JSON.stringify({ status: a.status, deferredUntil: a.deferredUntil, rec: !!a.recurrence }));
  ok("37 §15 …and the reason is shown on the page",
    await page.evaluate(() => /whole repeat/.test(document.body.innerText || "")));

  // ---- 8. Batch: preview, exceptions, one confirm (§18, §19) -------------
  await seed(page);
  await page.goto(`${BASE}/actions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const picked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    let n = 0;
    for (const b of boxes) { if (n >= 3) break; b.click(); n += 1; }
    return n;
  });
  ok("38 §18 several items can be selected", picked === 3, String(picked));
  await page.waitForTimeout(400);
  const hasBatch = await page.evaluate(() => !!document.querySelector("[data-batch-not-today]"));
  ok("39 §18 the batch bar offers 'Not today'", hasBatch);
  if (hasBatch) {
    await page.click("[data-batch-not-today]");
    await page.waitForTimeout(400);
    ok("40 §18 …which opens a preview rather than mutating",
      await page.evaluate(() => !!document.querySelector("[data-replan-preview]")));
    const before = JSON.stringify((await store(page)).nextActions.map((x) => [x.id, x.status]));
    await page.click('[data-replan-choice="tomorrow"]');
    await page.waitForTimeout(400);
    const preview = await page.evaluate(() => ({
      summary: (document.querySelector("[data-replan-summary]") || {}).textContent?.trim() ?? "",
      proposals: [...document.querySelectorAll("[data-replan-proposal]")].map((e) => (e.textContent || "").trim()),
      exceptions: [...document.querySelectorAll("[data-replan-exception]")].map((e) => ({
        reason: e.getAttribute("data-replan-exception"), text: (e.textContent || "").trim(),
      })),
    }));
    ok("41 §18 the preview says what will change",
      /selected/.test(preview.summary), preview.summary);
    ok("42 §19 …and nothing has moved yet",
      JSON.stringify((await store(page)).nextActions.map((x) => [x.id, x.status])) === before);
    await page.click("[data-replan-confirm]");
    await page.waitForTimeout(700);
    st = await store(page);
    ok("43 §18 one confirmation applies the preview",
      st.nextActions.some((x) => x.status === "deferred"),
      JSON.stringify(st.nextActions.map((x) => [x.id, x.status])));
    ok("44 §19 …and no waiting item was swept in",
      st.nextActions.find((x) => x.id === "a-wait")?.status === "waiting",
      String(st.nextActions.find((x) => x.id === "a-wait")?.status));
    ok("45 §19 …and no recurring series was parked",
      st.nextActions.find((x) => x.id === "a-recur")?.status !== "deferred",
      String(st.nextActions.find((x) => x.id === "a-recur")?.status));
  }

  // ---- 9. A mixed batch surfaces its exceptions explicitly (§19) ---------
  await seed(page);
  await page.goto(`${BASE}/actions`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  // The default "Next" tab excludes the wait by design, which is correct — but
  // a mixed selection is exactly what §19 is about, so reach it from "All".
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button")].find((b) => /^All · /.test((b.textContent || "").trim()));
    t?.click();
  });
  await page.waitForTimeout(600);
  const mixed = await page.evaluate(() => {
    // Select the wait, the recurring one and one ordinary action by their rows.
    const wanted = ["Transcript from Maria", "Water the plants", "Pay the deposit"];
    let n = 0;
    for (const li of document.querySelectorAll("li")) {
      const t = (li.textContent || "");
      if (!wanted.some((w) => t.includes(w))) continue;
      const box = li.querySelector('input[type="checkbox"]');
      if (box && !box.checked) { box.click(); n += 1; }
    }
    return n;
  });
  if (mixed >= 3 && await page.evaluate(() => !!document.querySelector("[data-batch-not-today]"))) {
    await page.click("[data-batch-not-today]");
    await page.waitForTimeout(300);
    await page.click('[data-replan-choice="tomorrow"]');
    await page.waitForTimeout(400);
    const ex = await page.evaluate(() =>
      [...document.querySelectorAll("[data-replan-exception]")].map((e) => e.getAttribute("data-replan-exception")));
    ok("46 §19 a mixed batch surfaces its exceptions",
      ex.includes("waiting") && ex.includes("recurring_series"), JSON.stringify(ex));
    const summary = await page.evaluate(() =>
      (document.querySelector("[data-replan-summary]") || {}).textContent?.trim() ?? "");
    ok("47 §19 …and counts them separately",
      /is waiting/.test(summary) && /repeats/.test(summary), summary);
    ok("48 §19 …naming the person the wait is on",
      await page.evaluate(() => /Maria/.test(document.querySelector("[data-replan-exceptions]")?.textContent || "")));
    await page.click("[data-replan-confirm]");
    await page.waitForTimeout(700);
    st = await store(page);
    ok("49 §19 confirming moves only what could move",
      st.nextActions.find((x) => x.id === "a-plain")?.status === "deferred"
      && st.nextActions.find((x) => x.id === "a-wait")?.status === "waiting"
      && st.nextActions.find((x) => x.id === "a-recur")?.status === "open",
      JSON.stringify(st.nextActions.map((x) => [x.id, x.status])));
  } else {
    ok("46 §19 a mixed batch surfaces its exceptions", false, `selected ${mixed}`);
  }

  // ---- 10. Project and Goal context survive (§22, §23) -------------------
  await seed(page);
  await rowControls(page, "a-direct");
  await page.click('[data-resolution="not_today"]');
  await page.waitForTimeout(300);
  await page.click('[data-resolution-choice="tomorrow"]');
  await page.waitForTimeout(700);
  a = await actionOf(page, "a-direct");
  ok("50 §23 a deferred action keeps its Goal link", a.goalId === "g1", String(a.goalId));
  await page.goto(`${BASE}/goal/g1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-goal-command]", { timeout: 20000 });
  await page.waitForTimeout(600);
  ok("51 §23 …and still appears in the Goal view",
    await page.evaluate(() => /Draft the business plan/.test(document.querySelector("[data-goal-command]")?.textContent || "")));

  await seed(page);
  await rowControls(page, "a-plain");
  await page.click('[data-resolution="not_today"]');
  await page.waitForTimeout(300);
  await page.click('[data-resolution-choice="tomorrow"]');
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/project/p1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-project-working]", { timeout: 20000 });
  await page.waitForTimeout(600);
  ok("52 §22 a deferred action still appears in the Project view",
    await page.evaluate(() => /Pay the deposit/.test(document.querySelector("[data-project-working]")?.textContent || "")));

  // ---- 11. Reload keeps the result true (§28) ---------------------------
  await page.goto(`${BASE}/actions/a-plain`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  a = await actionOf(page, "a-plain");
  ok("53 §28 the result survives a reload",
    a.status === "deferred" && a.deferredUntil === dk(1),
    JSON.stringify({ status: a.status, until: a.deferredUntil }));

  // ---- 12. Nothing here reasons about the person (§32) ------------------
  await seed(page);
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const body = (await page.evaluate(() => document.body.innerText || "")).toLowerCase();
  const hit = FORBIDDEN.find((w) => body.includes(w));
  ok("54 §32 Today says nothing about how the person is coping", !hit, hit || "");

  // ---- 13. Accessibility (§43) ------------------------------------------
  const a11y = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("[data-resolution]")];
    return {
      named: btns.every((b) => (b.textContent || "").trim().length > 0),
      titled: btns.every((b) => !!b.getAttribute("title") || (b.textContent || "").trim().length > 0),
      focusable: btns.every((b) => b.tagName === "BUTTON" || b.tagName === "A"),
      h1: document.querySelectorAll("h1").length,
    };
  });
  ok("55 §43 every quick action is labelled in words", a11y.named);
  ok("56 §43 …and carries its explanation", a11y.titled);
  ok("57 §43 …and is keyboard-focusable", a11y.focusable);
  ok("58 exactly one h1", a11y.h1 === 1, String(a11y.h1));

  await ctx.close();

  // ---- 14. Mobile (§39.19) ------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp);
  const mControls = await rowControls(mp, "a-plain");
  ok("59 the quick actions render on mobile",
    mControls.some((c) => c.kind === "not_today"), JSON.stringify(mControls.map((c) => c.kind)));
  const tap = await mp.evaluate(() => {
    const b = document.querySelector('[data-resolution="not_today"]');
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok("60 §43 …with a tappable target", tap.w >= 44 || tap.h >= 20, JSON.stringify(tap));
  const overflow = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("61 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  await mctx.close();

  ok("62 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((r) => !r.pass).map((r) => `  ${r.name} — ${r.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
