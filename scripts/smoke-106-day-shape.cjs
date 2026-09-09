#!/usr/bin/env node
/**
 * LIFEOS-106 — the day's shape, in a real browser.
 *
 * The deterministic suite proves the arithmetic. This proves the user can see
 * it: the line renders above the schedule it describes, a double-booking is
 * named on the rows that collide, the numbers on the page are the numbers the
 * page's own rows imply, and none of it appears on a day with nothing timed.
 *
 * Nothing here may throw when a selector is missing — a scenario that cannot
 * find its element records a FAILED assertion, because a crash is not a caught
 * defect.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
let VP = "DESKTOP";
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail, vp: VP });
  console.log(`${cond ? "  ok  " : "  FAIL"} [${VP}] ${name}${cond ? "" : ` — ${detail}`}`);
};

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

/** Today on the browser's own clock — every fixture below is built on it. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const stamp = "2026-08-01T09:00:00.000Z";
const EV = (id, title, startTime, endTime, allDay = false) => ({
  id, title, date: today(), startTime, endTime, allDay,
  description: "", location: "", notes: "", linkedEntityRefs: [], history: [],
  createdAt: stamp, updatedAt: stamp,
});
const ACT = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: stamp, updatedAt: stamp, ...p,
});

async function seed(page, world, route = "/today") {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
}
const all = (page, sel) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].map((e) => (e.textContent || "").trim()), sel);
const one = async (page, sel) => (await all(page, sel))[0];
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const domText = (page) => page.evaluate(() => {
  const m = document.querySelector("main"); return m ? m.textContent || "" : "";
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. the line, above the schedule it describes -----------------------
  {
    const w = EMPTY();
    w.events = [
      EV("e1", "Team standup", "09:00", "09:30"),
      EV("e2", "Client review", "11:00", "12:30"),
      EV("e3", "Board call", "16:00", "17:30"),
    ];
    w.nextActions = [
      ACT({ id: "d1", title: "Send the contract", dueDate: today() }),
      ACT({ id: "d2", title: "Pay the invoice", dueDate: today() }),
    ];
    await seed(page, w);
    const line = await one(page, "[data-day-shape]");
    ok("1 the day's shape is on the page", !!line, String(line));
    ok("1b …and states the measurable scheduled time", /3h 30m in scheduled blocks/.test(line || ""), String(line));
    ok("1c …between the first start and the last end",
      /between 9 AM and 5:30 PM/.test(line || ""), String(line));
    ok("1d …and the gap time, named for what it is",
      /5h between blocks/.test(line || ""), String(line));
    ok("1d2 …never calling that time free or unscheduled",
      !/\bfree\b|unscheduled/.test(line || ""), String(line));
    ok("1e …and how much work has to fit around it",
      /2 to place/.test(line || "") && !/around it/.test(line || ""), String(line));
    // The numbers must be the numbers of the rows beneath the line.
    ok("1f the schedule it describes is the schedule rendered",
      (await count(page, "[data-today-fixed]")) === 3,
      String(await count(page, "[data-today-fixed]")));
  }

  // ---- 2. a double-booking, which the product could not previously see ----
  {
    const w = EMPTY();
    w.events = [
      EV("e1", "Team standup", "09:00", "09:30"),
      EV("e2", "Client review", "09:15", "10:15"),
    ];
    await seed(page, w);
    const notes = await all(page, "[data-day-conflict]");
    ok("2 a double-booking is named on the page", notes.length === 2, JSON.stringify(notes));
    ok("2b …on the row, naming the other commitment",
      notes.some((t) => /Overlaps Client review/.test(t)), JSON.stringify(notes));
    ok("2c …from the other side too",
      notes.some((t) => /Overlaps Team standup/.test(t)), JSON.stringify(notes));
    ok("2d …with the real overlap, not the shorter meeting's length",
      notes.every((t) => /15m/.test(t)), JSON.stringify(notes));
    ok("2e …and the booked time is not double-counted",
      /1h 15m in scheduled blocks/.test((await one(page, "[data-day-shape]")) || ""),
      String(await one(page, "[data-day-shape]")));
  }

  // ---- 3. the neighbour: an ordinary schedule claims no collision ---------
  {
    const w = EMPTY();
    w.events = [EV("e1", "Team standup", "09:00", "09:30"), EV("e2", "Client review", "11:00", "12:30")];
    await seed(page, w);
    ok("3 a schedule that does not collide says nothing about collisions",
      (await count(page, "[data-day-conflict]")) === 0);
    ok("3b …while still stating the day's shape",
      /2h in scheduled blocks/.test((await one(page, "[data-day-shape]")) || ""),
      String(await one(page, "[data-day-shape]")));
  }

  // ---- 4. nothing timed: no line, no empty scaffolding -------------------
  {
    const w = EMPTY();
    w.nextActions = [ACT({ id: "u", title: "Read the licensing guidance" })];
    await seed(page, w);
    ok("4 a day with nothing timed prints no shape line",
      (await count(page, "[data-day-shape]")) === 0);
    ok("4b …and no zero-valued fragment anywhere", !/\b0[hm]\b|between and/.test(await domText(page)));
  }

  // ---- 5. a WAIT with a time is not part of the day's arithmetic ---------
  {
    const w = EMPTY();
    w.events = [EV("e1", "Client review", "11:00", "12:30")];
    w.nextActions = [
      ACT({ id: "wt", title: "Keys from Sam", status: "waiting", waitingOn: "Sam",
        waitingSince: stamp, dueDate: today(), dueTime: "14:00" }),
    ];
    await seed(page, w);
    const line = await one(page, "[data-day-shape]");
    ok("5 §12 a wait carrying a time does not change the day's scheduled hours",
      /1h 30m in scheduled blocks/.test(line || ""), String(line));
    ok("5b …and the span ends at the meeting, not at the wait's time",
      /and 12:30 PM/.test(line || ""), String(line));
  }

  // ---- 5b. commitments whose LENGTH is unknown are disclosed -------------
  //
  // The review's central finding. Two meetings plus "call the dentist at 2 PM"
  // and "submit the form at 5 PM": the first draft printed the meetings' total
  // and said nothing about the other two, so the gap read as empty.
  {
    const w = EMPTY();
    w.events = [EV("e1", "Standup", "09:00", "09:30"), EV("e2", "Board call", "16:00", "17:30")];
    w.nextActions = [
      ACT({ id: "a1", title: "Call the dentist", dueDate: today(), dueTime: "14:00" }),
      ACT({ id: "a2", title: "Submit the form", dueDate: today(), dueTime: "17:00" }),
      ACT({ id: "d1", title: "Draft the brief", dueDate: today() }),
    ];
    await seed(page, w);
    const line = await one(page, "[data-day-shape]");
    ok("5f measurable time is reported as scheduled blocks",
      /2h in scheduled blocks/.test(line || ""), String(line));
    ok("5g …and the commitments it cannot measure are disclosed",
      /at a set time/.test(line || ""), String(line));
    ok("5h …so no clause claims to describe the whole day",
      !/committed|unscheduled|\bfree\b/.test(line || ""), String(line));
    // The neighbour: with nothing durationless, that clause is absent.
    const w2 = EMPTY();
    w2.events = [EV("e1", "Standup", "09:00", "09:30"), EV("e2", "Board call", "16:00", "17:30")];
    await seed(page, w2);
    ok("5i …while a day of pure blocks does not mention it at all",
      !/at a set time/.test((await one(page, "[data-day-shape]")) || ""),
      String(await one(page, "[data-day-shape]")));
  }

  // ---- 6. an all-day event occupies no part of the day -------------------
  {
    const w = EMPTY();
    w.events = [EV("e1", "Parents' evening", undefined, undefined, true), EV("e2", "Client review", "11:00", "12:30")];
    await seed(page, w);
    ok("6 an all-day commitment adds no scheduled time",
      /1h 30m in scheduled blocks/.test((await one(page, "[data-day-shape]")) || ""),
      String(await one(page, "[data-day-shape]")));
    ok("6b …while still appearing on the schedule",
      /Parents/.test(await domText(page)));
  }

  // ---- 7. it never grades the day ----------------------------------------
  {
    const w = EMPTY();
    w.events = [
      EV("e1", "A", "08:00", "12:00"), EV("e2", "B", "12:00", "16:00"), EV("e3", "C", "16:00", "20:00"),
    ];
    w.nextActions = Array.from({ length: 8 }, (_, i) =>
      ACT({ id: `x${i}`, title: `Task ${i}`, dueDate: today() }));
    await seed(page, w);
    const t = await domText(page);
    ok("7 a genuinely full day is still described, not judged",
      !/too much|too full|overloaded|unrealistic|impossible|behind schedule/i.test(t));
    ok("7b …and the arithmetic still states it plainly",
      /12h in scheduled blocks/.test((await one(page, "[data-day-shape]")) || ""),
      String(await one(page, "[data-day-shape]")));
  }

  // ---- 8. mobile, and nothing threw --------------------------------------
  {
    VP = "MOBILE";
    await page.setViewportSize({ width: 390, height: 844 });
    const w = EMPTY();
    w.events = [EV("e1", "Team standup", "09:00", "09:30"), EV("e2", "Client review", "09:15", "10:15")];
    await seed(page, w);
    ok("8 the day's shape is readable on a phone",
      (await count(page, "[data-day-shape]")) === 1);
    ok("8b …and the collision note is too",
      (await count(page, "[data-day-conflict]")) === 2);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("[data-day-shape], [data-day-conflict]")]
        .filter((e) => e.scrollWidth > e.clientWidth + 2).length);
    ok("8c …without overflowing its column", clipped === 0, `${clipped} clipped`);
    ok("8d …and the page does not scroll sideways",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    VP = "DESKTOP";
    ok("8e no page errors in any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} day-shape browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
