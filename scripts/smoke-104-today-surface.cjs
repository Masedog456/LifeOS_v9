#!/usr/bin/env node
/**
 * LIFEOS-104 §58 — browser torture for the Today executive surface.
 *
 * Twenty-eight scenarios over the audit's own fixture worlds, against the
 * production build. The deterministic suite already asserts the projection; this
 * asserts the PAGE — what a person sees, in what order, above which fold.
 *
 * Three of the audit's reds were layout facts and cannot be proved anywhere
 * else: the suggestion appearing three times in eleven rows, the orientation
 * line promising a section that is not on the page, and eleven sections where
 * §50 asks for five. Those are 3, 19 and 22 below and they read geometry.
 *
 * Selectors are the page's own data attributes rather than text, EXCEPT where
 * the claim is about wording. §59 asks the suite to be run against the reverted
 * product, so nothing here may throw when a selector is missing: a scenario that
 * cannot find its element records a FAILED assertion, because a crash is not a
 * caught defect.
 *
 * Run against a production build on :3111 with LIFEOS_ENABLE_DEV_ROUTES=1.
 */
const { chromium } = require("playwright-core");
const { WORLDS } = require("./fixtures/lifeos-104-worlds.cjs");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
let VP = "DESKTOP";
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail, vp: VP });
  console.log(`${cond ? "  ok  " : "  FAIL"} [${VP}] ${name}${cond ? "" : ` — ${detail}`}`);
};

/**
 * The audit's worlds are built from a FIXED anchor (2026-09-07) so the same
 * fixture means the same thing every day. The browser runs on the real clock, so
 * every date is rewritten to today's before seeding — the SHAPE of each world
 * (overdue by four days, due today, deferred nine days out) is what the
 * scenarios are about, and it is preserved exactly.
 */
const ANCHOR = "2026-09-07";
function shift(world) {
  const now = new Date();
  const base = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const days = Math.round((Date.parse(`${base}T12:00:00Z`) - Date.parse(`${ANCHOR}T12:00:00Z`)) / 86400000);
  const move = (s) => {
    const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10) + s.slice(10);
  };
  const walk = (v) => {
    if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? move(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(world);
}

async function seed(page, key) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(shift(WORLDS[key]()))]);
  await page.goto(BASE + "/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
}
/** Seed a world built here rather than one of the twenty. */
async function seedWorld(page, world) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(shift(world))]);
  await page.goto(BASE + "/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
}
const body = (page) => page.evaluate(() => document.body.innerText);
/**
 * Text INCLUDING the collapsed context block.
 *
 * `innerText` is what a person can read right now, which is the right measure
 * for "is this above the fold" and the wrong one for "is this still on the
 * page": a closed `<details>` is absent from `innerText` and present in
 * `textContent`. §49 moved five sections into one disclosure and claims nothing
 * was lost, so the claim needs the reading that can see it — and 22e below
 * opens the block and checks the same rows become visible.
 */
const domText = (page) => page.evaluate(() => {
  const m = document.querySelector("main");
  return m ? m.textContent || "" : "";
});
const all = (page, sel) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].map((e) => (e.textContent || "").trim()), sel);
const one = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return e ? (e.textContent || "").trim() : null;
}, sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

/** Headings visible without scrolling, in DOM order. */
const aboveFold = (page) => page.evaluate(() => {
  const h = window.innerHeight;
  return [...document.querySelectorAll("h1, h2")]
    .filter((n) => n.getBoundingClientRect().top < h)
    .map((n) => (n.textContent || "").trim());
});
/** How many screenfuls the page occupies. */
const screens = (page) => page.evaluate(() =>
  document.documentElement.scrollHeight / window.innerHeight);

/** Every occurrence of a title anywhere in the command center's text. */
const mentions = async (page, title) => {
  const t = await page.evaluate(() => {
    const el = document.querySelector("main");
    return el ? el.innerText : document.body.innerText;
  });
  return t.split(title).length - 1;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // 1. One clear Action → one obvious Suggested next.
  {
    await seed(page, "B");
    const next = await one(page, "[data-suggested-next]");
    ok("1 §4 one clear Action produces one Suggested next",
      !!next && /Call the dentist/.test(next), String(next));
    ok("1b §4 …and exactly one", (await count(page, "[data-suggested-next]")) === 1);
  }

  // 2. Suggested next → grounded reason visible.
  {
    const why = await all(page, "[data-suggested-why] li");
    ok("2 §5 the reason is on the page", why.length > 0 && /Due today/.test(why.join(" ")), JSON.stringify(why));
    ok("2b §5, §44 …and it is a fact, not a score",
      !/%|score|priority|best use/i.test(why.join(" ")), JSON.stringify(why));
  }

  // 3. Same Action → not duplicated in Today. THE AUDIT'S RED D.
  {
    ok("3 §24 the suggested action is named ONCE on the page",
      (await mentions(page, "Call the dentist")) === 1,
      `${await mentions(page, "Call the dentist")} mentions`);
    ok("3b §24 …and the Today list does not repeat it",
      !(await all(page, "[data-today-action]")).some((t) => /Call the dentist/.test(t)),
      JSON.stringify(await all(page, "[data-today-action]")));
  }

  // 4. Timed Event → visible AS an Event.
  {
    await seed(page, "I");
    const events = await all(page, '[data-today-fixed="event"]');
    ok("4 §21 every event is a BE THERE row", events.length === 4, JSON.stringify(events));
    ok("4b §21 …and carries no action control",
      (await count(page, '[data-today-fixed="event"] button')) === 0);
    ok("4c §22 …with a formatted time, never the stored one",
      /11:00 AM|11 AM/.test(events.join(" ")) && !/\b11:00\b(?!\s?(AM|PM))/.test(events.join(" ")),
      JSON.stringify(events));
  }

  // 5. Timed Action → visible as an Action.
  {
    await seed(page, "TORTURE");
    const timed = await all(page, '[data-today-fixed="action"]');
    ok("5 §21 a timed action is fixed, and labelled as an action",
      timed.some((t) => /Take the medication/.test(t)), JSON.stringify(timed));
    ok("5b §23 …carrying its recurrence rule", /Every day/.test(timed.join(" ")), JSON.stringify(timed));
  }

  // 6. Overdue → truthful past-tense due label.
  {
    await seed(page, "D");
    const t = await body(page);
    ok("6 §11 overdue reads as evidence", /Was due /.test(t), (t.match(/.{0,10}Was due.{0,20}/) ?? [""])[0]);
    ok("6b §11 …and never as an alarm", !/CRITICAL|URGENT|!!|OVERDUE!/i.test(t));
  }

  // 7. Waiting follow-up due → follow-up surfaced.
  {
    await seed(page, "E");
    const attn = await all(page, "[data-attention]");
    ok("7 §12 a due follow-up reaches Needs attention",
      attn.some((x) => /Transcript/.test(x) && /Follow-up/.test(x)), JSON.stringify(attn));
  }

  // 8. Waiting with NO follow-up → not falsely treated as due.
  {
    await seed(page, "F");
    const rows = await all(page, "[data-waiting]");
    ok("8 §13 a dateless wait is on the roster, stated factually",
      rows.some((x) => /Priya/.test(x) && /Since /.test(x)), JSON.stringify(rows));
    ok("8b §13 …and never labelled due", !rows.some((x) => /Follow-up due/.test(x)), JSON.stringify(rows));
    ok("8c §13 …and raises no attention row", (await count(page, "[data-attention]")) === 0);
    ok("8d §42 …and is not offered as work",
      !(await all(page, "[data-today-action], [data-open-work-item]")).some((x) => /Priya|Quote/.test(x)),
      JSON.stringify(await all(page, "[data-today-action], [data-open-work-item]")));
  }

  // 9/10. Blocked Action → not recommended; the blocker may be.
  {
    await seed(page, "G");
    // The TITLE, not the card: the card legitimately names what the blocker
    // unlocks, so sweeping the whole card for the blocked title asserts the
    // opposite of §43 and would fail on correct behaviour.
    const picked = await one(page, "[data-suggested-next] > a");
    ok("9 §14 blocked work is not the recommendation",
      picked !== "Install the reception desk", String(picked));
    ok("10 §43 …the executable blocker is, on existing dependency semantics",
      picked === "Get lease approval", String(picked));
    ok("10b §14 …and the blocked row says what holds it",
      /Blocked by/.test(await body(page)), (await body(page)).match(/.{0,30}Blocked by.{0,30}/)?.[0] ?? "");
  }

  // 11. Goal no path → judgment, not fake executable work. THE AUDIT'S RED B.
  {
    await seed(page, "J");
    const attn = await all(page, "[data-attention]");
    ok("11 §17 no goal is presented as attention",
      !attn.some((x) => /Learn to sail|graduate school/.test(x)), JSON.stringify(attn));
    const dec = await one(page, "[data-today-section='decisions']");
    ok("11b §17 …it is a decision boundary instead",
      !!dec && /Learn to sail/.test(dec), String(dec));
    ok("11c §17 …and the goal WITH a live action is not flagged at all",
      !/graduate school/.test(await body(page)));
  }

  // 12. Project no next → truthful treatment.
  {
    await seed(page, "K");
    const t = await body(page);
    ok("12 §18 an action-less project is not offered as work",
      !(await all(page, "[data-today-action]")).some((x) => /Clinic lease/.test(x))
      && !/Add a task/i.test(t));
    ok("12b §18 …and reaches the page as recorded context",
      /Clinic lease/.test(await domText(page)),
      ((await domText(page)).match(/.{0,20}Clinic lease.{0,40}/) ?? [""])[0]);
  }

  // 13. Decision Inbox → visible without full duplication.
  {
    await seed(page, "M");
    const sec = await one(page, "[data-today-section='decisions']");
    ok("13 §19 the boundary is a section with a count", !!sec && /4 items/.test(sec), String(sec));
    ok("13b §19 …previewing ONE question, not the queue",
      (await count(page, "[data-decision-preview]")) <= 1
      && (await count(page, "[data-decision-option]")) === 0,
      `${await count(page, "[data-decision-preview]")} previews`);
    ok("13c §19 …and links to the full inbox",
      !!(await page.$("[data-decision-count-link]")));
  }

  // 14. Repeated deferral → factual, non-shaming.
  //
  // World L2, not L, and the reason is worth recording. `mvpStore` runs
  // `returnDueActions` on HYDRATE, so a deferral whose date has arrived is
  // already an open, returned action by the time Today renders it — which is
  // why the pure probe and the browser disagreed about world L, and the browser
  // is the one telling the truth. §20's pattern is only visible while the
  // deferral is still ahead, so L2 parks it five days out. 14c below asserts
  // the other half: once it comes back, the return is what is described.
  {
    await seed(page, "L2");
    const t = await body(page);
    ok("14 §20 the deferral count is stated", /deferred this 3 times/i.test(t),
      (t.match(/.{0,30}deferred this.{0,20}/) ?? [""])[0]);
    ok("14b §20 …with no verdict about the person",
      !/procrastinat|keep putting|you always|lazy|avoid/i.test(t));
    ok("14d §40 …and the parked work is still not suggested",
      !/Do the tax return/.test(String(await one(page, "[data-suggested-next] > a"))),
      String(await one(page, "[data-suggested-next] > a")));
    // …and the neighbour: a deferral that came back is described by what
    // happened, not by how many times it did.
    await seed(page, "L");
    const l = await body(page);
    ok("14c §41 a returned deferral is described by the return, not the count",
      /[Cc]ame back from deferral today/.test(l) && !/deferred this 3 times/i.test(l),
      (l.match(/.{0,20}deferral.{0,20}/) ?? [""])[0]);
  }

  // 15. Deferred beyond today → absent from suggested work.
  {
    await seed(page, "TORTURE");
    const t = await body(page);
    ok("15 §40 Not Today holds", !/Sort the loft/.test(t));
  }

  // 16. Recurring today → appears once.
  {
    await seed(page, "H");
    ok("16 §23 a recurring occurrence is named once",
      (await mentions(page, "Take the medication")) === 1,
      `${await mentions(page, "Take the medication")} mentions`);
    ok("16b §23 …and can still be closed for today",
      !!(await page.$("[data-complete-occurrence], [data-resolution='complete_occurrence']")));
  }

  // 17. Quiet day → no invented urgency. THE AUDIT'S RED A.
  {
    await seed(page, "A");
    const t = await body(page);
    ok("17 §8 a quiet day with live work is NOT the empty state",
      !(await page.$("[data-today-empty]")), t.slice(0, 90));
    ok("17b §8 …it names the open work", /Sort the bookshelf/.test(t));
    ok("17c §8 …and manufactures no urgency",
      /Nothing is pressing/.test(t) && !/urgent|behind|catch up|overdue/i.test(t),
      (t.match(/.{0,10}Nothing is pressing.{0,20}/) ?? [""])[0]);
  }

  // 18. Empty day → clean empty state.
  {
    await seed(page, "S");
    ok("18 §9 a genuinely empty store gets the empty panel",
      !!(await page.$("[data-today-empty]")));
    ok("18b §9 …with no section furniture around it",
      (await count(page, "[data-today-section]")) === 0);
    ok("18c §9 …and one way to start", !!(await page.$("[data-capture-link]")));
  }

  // 19. Since yesterday → secondary. AND the orientation line tells the truth.
  {
    await seed(page, "TORTURE");
    const fold = await aboveFold(page);
    ok("19 §26 Since yesterday is not a top-level section",
      !fold.includes("Since yesterday"), JSON.stringify(fold));
    ok("19b §26 …it lives inside the collapsed context block",
      await page.evaluate(() => {
        const d = document.querySelector("[data-today-later]");
        return !!d && !!d.querySelector("[data-since-yesterday]");
      }));
    // THE AUDIT'S RED C, read off the rendered page.
    const line = await one(page, "[data-orientation-line]");
    const claimed = Number((String(line).match(/(\d+) items? needing attention/) ?? [0, "0"])[1]);
    const rendered = await count(page, "[data-attention]");
    ok("19c §51 the orientation count IS the number of rows below it",
      claimed === rendered, `line claims ${claimed}, page renders ${rendered} — ${line}`);
  }

  // 20. Morning Brief → no duplicate command center.
  {
    ok("20 §27 there is ONE orientation card",
      (await count(page, "[data-daily-orientation]")) === 1);
    ok("20b §27 …one suggested-next card",
      (await count(page, "[data-suggested-next]")) === 1);
    const h2 = await all(page, "h2");
    ok("20c §27 …and no heading appears twice",
      new Set(h2).size === h2.length, JSON.stringify(h2));
  }

  // 21. Mobile → Suggested next above the fold. §7.
  {
    VP = "MOBILE";
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page, "TORTURE");
    const fold = await aboveFold(page);
    ok("21 §7 Suggested next is in the first viewport on a phone",
      fold.includes("Suggested next"), JSON.stringify(fold));
    ok("21b §7 …ahead of every context heading",
      !fold.some((h) => /Waiting|Project pulse|Upcoming|Since yesterday|Worth returning/.test(h)),
      JSON.stringify(fold));
    const y = await page.evaluate(() => {
      const e = document.querySelector("[data-suggested-next]");
      return e ? Math.round(e.getBoundingClientRect().top) : -1;
    });
    ok("21c §7 …and its first row is on-screen", y > 0 && y < 844, `top ${y}px`);
  }

  // 22. Dense desktop → the scan hierarchy stays clear. §50.
  {
    VP = "DESKTOP";
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page, "T");
    const sections = await count(page, "[data-today-section]");
    ok("22 §50 the densest world renders at most five sections",
      sections <= 5, `${sections} sections`);
    ok("22b §50 …and one collapsed context block, not five open ones",
      (await count(page, "[data-today-later]")) === 1);
    const sc = await screens(page);
    ok("22c §50 a 120-record store is shorter than it was",
      sc < 6, `${sc.toFixed(1)} screens`);
    const fold = await aboveFold(page);
    ok("22d §7 the first viewport is decision content only",
      fold.every((h) => !/Waiting|Project pulse|Upcoming|Since yesterday|Worth returning/.test(h)),
      JSON.stringify(fold));
    // §49 claims nothing was removed, only collapsed. One click proves it.
    const hiddenRows = await count(page, "[data-waiting], [data-pulse], [data-upcoming], [data-since-yesterday]");
    await page.evaluate(() => { const d = document.querySelector("[data-today-later]"); if (d) d.open = true; });
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll("[data-waiting], [data-pulse], [data-upcoming], [data-since-yesterday]")]
        .filter((e) => e.getBoundingClientRect().height > 0).length);
    ok("22e §49 the context block collapses the rows; it does not delete them",
      hiddenRows > 0 && shown === hiddenRows, `${shown} visible of ${hiddenRows}`);
  }

  // 23-27. Store truth: five mutations, five reflows. §53.
  //
  // Each writes the store directly and reloads, because the CLAIM is that Today
  // reflects current state — not that a particular button works, which the
  // resolution suites already own.
  const mutate = async (fn) => {
    await page.evaluate(([k, src]) => {
      const s = JSON.parse(localStorage.getItem(k));
      // eslint-disable-next-line no-new-func
      new Function("s", src)(s);
      localStorage.setItem(k, JSON.stringify(s));
    }, [KEY, fn]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1100);
  };

  /**
   * 23-pre. §53 says Today reflows IMMEDIATELY. 23-27 below reload the page,
   * which proves the projection is derived rather than persisted but says
   * nothing about a live render — a §60 mutant that froze the projection on
   * first build and never rebuilt it passed all 66 assertions, because every
   * reload remounted the component and rebuilt the freeze. This one changes the
   * store from INSIDE the page, with no navigation, which is the claim.
   */
  {
    await seed(page, "TORTURE");
    const before = await all(page, '[data-today-fixed="action"]');
    ok("23pre §53 the control: the recurring occurrence is on today's schedule",
      before.some((t) => /Take the medication/.test(t)), JSON.stringify(before));
    const btn = await page.$('[data-today-fixed="action"] [data-complete-occurrence]');
    if (btn) { await btn.click(); await page.waitForTimeout(900); }
    const after = await all(page, '[data-today-fixed="action"]');
    ok("23pre-b §53 completing it reflows Today with no reload",
      !!btn && !after.some((t) => /Take the medication/.test(t)), JSON.stringify(after));
    ok("23pre-c §53 …and the orientation line above it changes with the page",
      !/2 timed commitments/.test(String(await one(page, "[data-orientation-line]"))),
      String(await one(page, "[data-orientation-line]")));
  }

  {
    await seed(page, "B");
    ok("23 §53 the control: the dated action is suggested",
      /Call the dentist/.test(await body(page)));
    await mutate(`const a = s.nextActions.find(x => x.id === "b1"); a.title = "Call the orthodontist";`);
    ok("23b §53 a CORRECTION reflows Today",
      /Call the orthodontist/.test(await body(page)) && !/Call the dentist/.test(await body(page)));
  }
  {
    await mutate(`const a = s.nextActions.find(x => x.id === "b1"); a.status = "completed"; a.completedAt = new Date().toISOString();`);
    ok("24 §39, §53 a COMPLETION removes it from every actionable list",
      !(await all(page, "[data-suggested-next], [data-today-action]")).some((t) => /orthodontist/.test(t)),
      JSON.stringify(await all(page, "[data-suggested-next], [data-today-action]")));
  }
  {
    await seed(page, "B");
    await mutate(`const d = new Date(); d.setDate(d.getDate() + 9);
      const a = s.nextActions.find(x => x.id === "b1");
      a.dueDate = d.toISOString().slice(0,10);`);
    const t = await body(page);
    ok("25 §41, §53 a RESCHEDULE moves it off today",
      !(await all(page, "[data-today-action]")).some((x) => /dentist/.test(x))
      && !/Due today/.test(t), JSON.stringify(await all(page, "[data-today-action]")));
  }
  {
    await seed(page, "B");
    await mutate(`const d = new Date(); d.setDate(d.getDate() + 4);
      const a = s.nextActions.find(x => x.id === "b1");
      a.status = "deferred"; a.deferredUntil = d.toISOString().slice(0,10); a.dueDate = undefined;`);
    ok("26 §40, §53 a DEFER past today removes it from suggested work",
      !(await all(page, "[data-suggested-next]")).some((x) => /dentist/.test(x)),
      JSON.stringify(await all(page, "[data-suggested-next]")));
  }
  {
    await seed(page, "F");
    ok("27 §53 the control: the dateless wait shows no follow-up",
      !/Follow-up due/.test(await body(page)));
    await mutate(`const d = new Date();
      const a = s.nextActions.find(x => x.id === "f1");
      a.followUpDate = d.toISOString().slice(0,10);`);
    const attn = await all(page, "[data-attention]");
    ok("27b §12, §53 a FOLLOW-UP EDIT surfaces it the moment its date arrives",
      attn.length === 1 && /Quote/.test(attn[0]) && /Follow-up date is today/.test(attn[0]),
      JSON.stringify(attn));
    ok("27c §12 …and the roster row changes with it",
      (await all(page, "[data-waiting]")).some((x) => /Follow-up due/.test(x)),
      JSON.stringify(await all(page, "[data-waiting]")));
  }

  /**
   * ---- 29-31. The three P2 findings from PR #110's review.
   *
   * All three are about the FIXED group and all three needed a world the twenty
   * do not contain, which is why the audit did not surface them: no fixture had
   * a blocked TIMED action, a recurring EVENT, or a record that is both a fixed
   * row and a decision the attention cap has hidden.
   */
  {
    const F = require("./fixtures/lifeos-104-worlds.cjs");
    const S = (p) => ({ ...F.EMPTY(), ...p });

    // 29 §A — a blocked timed action says what is holding it.
    await seedWorld(page, S({
      nextActions: [
        F.act({ id: "b", title: "Install the desk", dueDate: F.dk(0), dueTime: "14:00" }),
        F.act({ id: "k", title: "Get lease approval" }),
        F.act({ id: "w", title: "File the claim", dueDate: F.dk(-5) }),
      ],
      actionDependencies: [{ id: "d", blockedId: "b", blockerId: "k", createdAt: F.at(-10) }],
    }));
    const fixedRows = await all(page, '[data-today-fixed="action"]');
    ok("29pre §A the control: it is a BE THERE row at its time",
      fixedRows.some((t) => /Install the desk/.test(t) && /2 PM/.test(t)), JSON.stringify(fixedRows));
    ok("29 §A …and the row says what is holding it",
      fixedRows.some((t) => /Install the desk/.test(t) && /Blocked by Get lease approval/.test(t)),
      JSON.stringify(fixedRows));
    ok("29b §A …and it is not the recommendation",
      !/Install the desk/.test(String(await one(page, "[data-suggested-next] > a"))));
    ok("29c §A the blocked note is reachable to a screen reader as text, not colour alone",
      (await count(page, "[data-today-blocked]")) >= 1);

    // 30 §B — a recurring event keeps its rule.
    await seedWorld(page, S({
      events: [{ id: "e", title: "Standup", date: F.dk(0), startTime: "09:00", endTime: "09:15",
        allDay: false, notes: "", linkedEntityRefs: [],
        recurrence: { frequency: "weekly", interval: 1, weekdays: [new Date().getDay()] },
        createdAt: F.at(-30), updatedAt: F.at(-30) }],
      nextActions: [F.act({ id: "a", title: "Send the quote", dueDate: F.dk(0) })],
    }));
    const evRows = await all(page, '[data-today-fixed="event"]');
    ok("30 §B a recurring Event says how often it repeats",
      evRows.some((t) => /Standup/.test(t) && /Every /.test(t)), JSON.stringify(evRows));
    // The neighbour: a one-off event claims no schedule.
    await seed(page, "I");
    const once = await all(page, '[data-today-fixed="event"]');
    ok("30b §B …while a one-off Event claims none",
      once.some((t) => /Dentist/.test(t)) && !once.some((t) => /Dentist/.test(t) && /Every /.test(t)),
      JSON.stringify(once));

    // 31 §C — a fixed row is not also the decision preview.
    const dec = F.deferred("dec", "Do the tax return", 3, F.dk(0));
    /**
     * A due time that has ALREADY passed, whichever hour this suite runs in.
     *
     * §24 suppresses the suggestion from the fixed rows, so this scenario only
     * measures the dedup it is named for while `dec` is not the suggestion.
     * A hard-coded "08:00" made that depend on the wall clock: the recommender
     * prefers a timed action whose time is still ahead ("it's due at 8 AM
     * today, and that time hasn't passed yet"), so the control passed when run
     * after 08:00 and failed at 04:39 the next morning. Flooring to the current
     * hour is in the past at every minute of the day, including 00:xx.
     */
    const hh = String(new Date().getHours()).padStart(2, "0");
    dec.dueDate = F.dk(0); dec.dueTime = `${hh}:00`;
    await seedWorld(page, S({ nextActions: [
      F.act({ id: "o1", title: "Overdue one", dueDate: F.dk(-6) }),
      F.act({ id: "o2", title: "Overdue two", dueDate: F.dk(-5) }),
      F.act({ id: "o3", title: "Overdue three", dueDate: F.dk(-4) }),
      F.act({ id: "o4", title: "Overdue four", dueDate: F.dk(-3) }),
      dec,
    ] }));
    const fx = await all(page, '[data-today-fixed="action"]');
    const dsec = await one(page, "[data-today-section='decisions']");
    ok("31pre §C the control: it IS on the schedule", fx.some((t) => /tax return/.test(t)), JSON.stringify(fx));
    ok("31pre-b §C …and a decision is waiting", !!dsec && /item/.test(dsec), String(dsec));
    ok("31 §C …and it is not previewed a second time",
      !!dsec && !/tax return/.test(dsec), String(dsec));
    ok("31b §C …while the count still says one is waiting",
      !!dsec && /1 item/.test(dsec), String(dsec));
  }

  // 28. §66. The language is coherent with Home, and nothing threw.
  {
    await seed(page, "TORTURE");
    const t = await body(page);
    const banned = /crush|streak|productivity score|alignment score|you're behind|falling behind|neglected|slacking|procrastinat|\b\d{1,3}\s?%/i;
    ok("28 §44, §45, §20 no score, percentage or verdict anywhere on Today",
      !banned.test(t), (t.match(banned) ?? [""])[0]);
    ok("28b §58 no page errors in any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} Today surface browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
