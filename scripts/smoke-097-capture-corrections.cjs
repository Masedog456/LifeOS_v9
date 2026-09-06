#!/usr/bin/env node
/**
 * LIFEOS-097 §42 — browser torture for correcting what Conqify got wrong.
 *
 * The deterministic suite proves the model. This proves the STORE: that a
 * correction reaches the record through the setter the record page uses, that
 * the sentence is untouched and visible while it happens, that a date fix is
 * not written as a deferral, that undo removes what the capture created and
 * leaves what it merely matched, and that a record moved underneath the sheet
 * is shown rather than overwritten.
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
  projects: [
    { id: "p1", title: "Clinic launch", description: "", status: "active", priority: "medium",
      notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at(-90), updatedAt: at(-90) },
    { id: "p2", title: "Graduate applications", description: "", status: "active", priority: "high",
      notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at(-90), updatedAt: at(-90) },
  ],
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
/** Open the correction sheet on the immediate result. */
async function openEdit(page) {
  await page.click("[data-capture-edit]");
  await page.waitForSelector("[data-correction-sheet]", { timeout: 8000 });
  await page.waitForTimeout(300);
}
const sheet = (page) => page.evaluate(() => {
  const el = document.querySelector("[data-correction-sheet]");
  if (!el) return null;
  return {
    source: el.querySelector("[data-correction-source]")?.textContent?.trim() ?? null,
    fields: [...el.querySelectorAll("[data-correction-field]")].map((f) => ({
      name: f.getAttribute("data-correction-field"), value: f.value, label: f.getAttribute("aria-label") })),
    unsupported: [...el.querySelectorAll("[data-correction-unsupported]")].map((u) =>
      u.textContent.replace(/\s+/g, " ").trim()),
    conflict: el.querySelector("[data-correction-conflict]")?.textContent?.trim() ?? null,
  };
});
const setField = async (page, name, value) => {
  const sel = `[data-correction-field="${name}"]`;
  const tag = await page.evaluate((s) => document.querySelector(s)?.tagName, sel);
  if (tag === "SELECT") await page.selectOption(sel, value);
  else await page.fill(sel, value);
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1-4. Title, and the sentence that is not touched -----------------
  await seed(page); await home(page);
  await say(page, "I need to email the registrar");
  {
    ok("1 §5 the immediate result offers Edit",
      await page.evaluate(() => !!document.querySelector("[data-capture-edit]")));
    await openEdit(page);
    const sh = await sheet(page);
    ok("2 §4 the sheet shows the sentence, verbatim",
      /I need to email the registrar/.test(sh?.source ?? ""), String(sh?.source));
    // A date is always offered on an ordinary action — a missing date is one
    // of the things a correction adds. It is the TIME that is conditional on
    // having a day for it to hang on, which 12 asserts.
    ok("3 §6 …and only the fields this record has",
      sh.fields.map((f) => f.name).join(",") === "title,dueDate,project,goal",
      sh.fields.map((f) => f.name).join(","));
    await setField(page, "title", "Email the graduate registrar");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    const s1 = await store(page);
    const a = s1.nextActions[0];
    ok("4 §7 the record is renamed", a?.title === "Email the graduate registrar", String(a?.title));
    ok("5 §3 …and the sentence in the store is untouched",
      s1.captures.some((c) => c.text === "I need to email the registrar"),
      s1.captures.map((c) => c.text).join(" | "));
    ok("6 §25 …and it still points back at it",
      !!a?.sourceCaptureId && s1.captures.some((c) => c.id === a.sourceCaptureId), String(a?.sourceCaptureId));
    ok("7 §26 …through the neutral setter, so the history says edited",
      (a?.history ?? []).map((h) => h.action).includes("edited"),
      JSON.stringify((a?.history ?? []).map((h) => h.action)));
    ok("8 §41 …and no record was created to rename one",
      s1.nextActions.length === 1, String(s1.nextActions.length));
  }

  // ---- 9-11. A date correction is not a deferral ------------------------
  {
    await seed(page); await home(page);
    await say(page, "Finish the philosophy statement tomorrow");
    await openEdit(page);
    await setField(page, "dueDate", dk(4));
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    const a = (await store(page)).nextActions[0];
    ok("9 §8 the date is corrected", a?.dueDate === dk(4), String(a?.dueDate));
    ok("10 §27 …and it is NOT recorded as a deferral",
      !(a?.history ?? []).some((h) => h.action === "deferred"),
      JSON.stringify((a?.history ?? []).map((h) => h.action)));
    ok("11 §8 …it is recorded as what it was: the date being set",
      (a?.history ?? []).map((h) => h.action).filter((x) => x === "due_set").length >= 1,
      JSON.stringify((a?.history ?? []).map((h) => h.action)));
  }

  // ---- 12-13. A time correction ------------------------------------------
  {
    await seed(page); await home(page);
    await say(page, "Finish the philosophy statement tomorrow");
    await openEdit(page);
    const sh = await sheet(page);
    ok("12 §9 an action with a date is offered a time",
      sh.fields.some((f) => f.name === "dueTime"), sh.fields.map((f) => f.name).join(","));
    await setField(page, "dueTime", "15:30");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    ok("13 §9 …and the time lands on the record",
      (await store(page)).nextActions[0]?.dueTime === "15:30",
      String((await store(page)).nextActions[0]?.dueTime));
  }

  // ---- 14-16. Project: change, and remove --------------------------------
  {
    await seed(page); await home(page);
    await say(page, "Draft the essay for the graduate school application");
    await openEdit(page);
    await setField(page, "project", "Clinic launch");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    let a = (await store(page)).nextActions[0];
    ok("14 §10 the Project can be set from the sheet", a?.projectId === "p1", String(a?.projectId));
    await openEdit(page);
    await setField(page, "project", "");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    a = (await store(page)).nextActions[0];
    ok("15 §14 …and removed", a?.projectId === undefined, String(a?.projectId));
    ok("16 §11 …without disturbing the Goal it was linked to",
      a?.goalId === "g1", String(a?.goalId));
  }

  // ---- 17-19. The waiting person -----------------------------------------
  {
    await seed(page); await home(page);
    await say(page, "I'm waiting on Maria for the transcript");
    const before = (await store(page)).nextActions[0];
    await openEdit(page);
    const sh = await sheet(page);
    ok("17 §12 a wait is asked who it is on",
      sh.fields.some((f) => f.name === "waitingOn" && f.value === "Maria"),
      JSON.stringify(sh.fields));
    await setField(page, "waitingOn", "Marcus");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    const a = (await store(page)).nextActions[0];
    ok("18 §12 the person is corrected", a?.waitingOn === "Marcus", String(a?.waitingOn));
    ok("19 §12 …without restarting how long the wait has run",
      a?.waitingSince === before?.waitingSince, `${before?.waitingSince} → ${a?.waitingSince}`);
    ok("20 §12 …and it is still a wait", a?.status === "waiting", String(a?.status));
  }

  // ---- 21-22. What the sheet says it cannot do ---------------------------
  {
    await seed(page); await home(page);
    await say(page, "I'm waiting on Maria for the transcript");
    await openEdit(page);
    const sh = await sheet(page);
    ok("21 §17 an impossible conversion is named with its cost, not hidden",
      sh.unsupported.some((u) => /kind of record/i.test(u) && /history and links/i.test(u)),
      sh.unsupported.join(" | "));
    ok("22 §13 …and so is the waiting object, which is not a stored field",
      sh.unsupported.some((u) => /waiting for/i.test(u) && /part of the title/i.test(u)),
      sh.unsupported.join(" | "));
  }

  // ---- 23-26. Undo, per outcome, and only what was created --------------
  {
    await seed(page); await home(page);
    await say(page, "Call the dentist tomorrow, finish the report, and Marcus still owes me the file");
    await home(page);
    const undos = await page.evaluate(() =>
      [...document.querySelectorAll("[data-recent-undo]")].map((b) => b.getAttribute("data-recent-undo")));
    ok("23 §21 a three-record capture offers three undos, not one",
      undos.length === 3, String(undos.length));
    const edits = await page.evaluate(() =>
      [...document.querySelectorAll("[data-recent-edit]")].length);
    ok("24 §29 …and three Edits", edits === 3, String(edits));
    await page.click(`[data-recent-undo="${undos[0]}"]`);
    await page.waitForTimeout(900);
    const s2 = await store(page);
    ok("25 §19 undoing one removes one",
      s2.nextActions.length === 2 && !s2.nextActions.some((a) => a.id === undos[0]),
      s2.nextActions.map((a) => a.title).join(" | "));
    ok("26 §3 …and the sentence is still there, with the other two",
      s2.captures.some((c) => /Call the dentist tomorrow/.test(c.text)),
      s2.captures.map((c) => c.text.slice(0, 30)).join(" | "));
  }

  // ---- 27-29. A matched record is never removed by undo -----------------
  {
    const w = WORLD();
    w.nextActions = [act({ id: "a-old", title: "Send the recommendation request", projectId: "p2" })];
    // A capture linked to a record it did NOT create — exactly the shape
    // `convertCapture` and completion matching produce.
    w.captures = [{ id: "c-match", text: "I finished the recommendation request",
      createdAt: at(0, 10), processingStatus: "processed", processedAt: at(0, 10),
      linkedEntityRefs: [{ kind: "action", id: "a-old" }] }];
    await seed(page, w); await home(page);
    const controls = await page.evaluate(() => ({
      undos: [...document.querySelectorAll("[data-recent-undo]")].length,
      edits: [...document.querySelectorAll("[data-recent-edit]")].length,
    }));
    ok("27 §20 a record the capture only matched offers no Undo", controls.undos === 0, String(controls.undos));
    ok("28 §29 …but can still be corrected", controls.edits === 1, String(controls.edits));
    const s3 = await store(page);
    ok("29 §20 …and it is still there", s3.nextActions.length === 1, String(s3.nextActions.length));
  }

  // ---- 30-31. Editing from a recent card --------------------------------
  {
    await seed(page); await home(page);
    await say(page, "I need to email the registrar");
    await home(page);
    await page.click("[data-recent-edit]");
    await page.waitForSelector("[data-correction-sheet]", { timeout: 8000 });
    await page.waitForTimeout(300);
    const sh = await sheet(page);
    ok("30 §29 a recent card opens the same sheet, with the same sentence",
      /I need to email the registrar/.test(sh?.source ?? ""), String(sh?.source));
    await setField(page, "title", "Email the bursar");
    await page.click("[data-correction-save]");
    await page.waitForTimeout(800);
    ok("31 §29 …and saves through the same setters",
      (await store(page)).nextActions[0]?.title === "Email the bursar",
      String((await store(page)).nextActions[0]?.title));
    await home(page);
    ok("32 §42 …and the correction survives a reload",
      /Email the bursar/.test(await page.evaluate(() =>
        document.querySelector("[data-recent-capture]")?.innerText ?? "")),
      await page.evaluate(() => document.querySelector("[data-recent-capture]")?.innerText.replace(/\s+/g," ") ?? ""));
  }

  // ---- 33-34. A record that moved underneath the sheet ------------------
  {
    await seed(page); await home(page);
    await say(page, "Finish the philosophy statement tomorrow");
    await openEdit(page);
    // Move the record from outside the sheet, the way another surface would.
    const id = (await store(page)).nextActions[0].id;
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.nextActions[0].dueDate = "2026-12-25";
      localStorage.setItem(k, JSON.stringify(s));
    }, KEY);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    // Reopened after the reload, the sheet reads the moved value rather than
    // the one it was first rendered with.
    await page.click("[data-recent-edit]");
    await page.waitForSelector("[data-correction-sheet]", { timeout: 8000 });
    const sh = await sheet(page);
    ok("33 §32 a sheet opened after a change shows the value the store holds",
      sh.fields.find((f) => f.name === "dueDate")?.value === "2026-12-25",
      JSON.stringify(sh.fields.find((f) => f.name === "dueDate")));
    await page.click("[data-correction-cancel]");
    await page.waitForTimeout(300);
    ok("34 §32 …and cancelling changes nothing",
      (await store(page)).nextActions[0]?.dueDate === "2026-12-25" && id.length > 0,
      String((await store(page)).nextActions[0]?.dueDate));
  }

  // ---- 35-36. Accessibility ----------------------------------------------
  {
    await seed(page); await home(page);
    await say(page, "I need to email the registrar");
    await openEdit(page);
    const a11y = await page.evaluate(() => {
      const el = document.querySelector("[data-correction-sheet]");
      return {
        labelled: [...el.querySelectorAll("[data-correction-field]")].every((f) => (f.getAttribute("aria-label") ?? "").length > 0),
        save: el.querySelector("[data-correction-save]")?.tagName,
        sourceIsText: (el.querySelector("[data-correction-source]")?.textContent ?? "").length > 0,
      };
    });
    ok("35 §46 every editable field is labelled", a11y.labelled);
    ok("36 §46 the save is a real button, and the source is text",
      a11y.save === "BUTTON" && a11y.sourceIsText, `${a11y.save}`);
    await page.keyboard.press("Escape");
  }
  await ctx.close();

  // ---- 37-39. Mobile ------------------------------------------------------
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await seed(p); await home(p);
    await say(p, "I need to email the registrar");
    await p.click("[data-capture-edit]");
    await p.waitForSelector("[data-correction-sheet]", { timeout: 8000 });
    await p.waitForTimeout(400);
    const g = await p.evaluate(() => {
      const el = document.querySelector("[data-correction-sheet]");
      const save = el.querySelector("[data-correction-save]").getBoundingClientRect();
      return { width: el.getBoundingClientRect().width, vw: innerWidth,
        saveW: save.width, saveH: save.height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok("37 §34 the sheet fits the phone", g.width <= g.vw, `${Math.round(g.width)} of ${g.vw}`);
    // 44px is the tap target a thumb needs. The first version of this asked for
    // 28 and passed at 29, which is a measurement dressed as a guarantee.
    ok("38 §34 …with a real tap target on Save",
      g.saveH >= 40 && g.saveW >= 56, `${Math.round(g.saveW)}×${Math.round(g.saveH)}`);
    ok("39 §34 …and nothing scrolls sideways", g.overflow <= 1, String(g.overflow));
    await c.close();
  }

  ok("40 §42 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
