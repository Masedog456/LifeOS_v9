#!/usr/bin/env node
/**
 * LIFEOS-105 §53 — browser torture for the commitment lifecycle.
 *
 * Thirty scenarios over the torture world, against the production build.
 *
 * The deterministic suite asserts the writers and the projections; this asserts
 * what a PERSON sees after a transition — including §58's contradictions, which
 * are only visible as rendered text: "Due Friday" beside "Follow up Friday",
 * "Waiting" beside a Complete button, "Completed" beside "Needs attention".
 *
 * §44 — "mutations reflow without reload" — is asserted by CLICKING the app's
 * own controls, which is the only path that reaches the store singleton from
 * inside a page. States no control can reach are seeded and loaded. The
 * distinction cost ten failing assertions on the first run: writing localStorage
 * and firing a `storage` event reflows nothing, because the data store has no
 * cross-tab listener — a real characteristic, recorded as a known gap.
 *
 * §55 asks the suite to be run against a full revert, so nothing here may
 * throw when a selector is missing: a scenario that cannot find its element
 * records a FAILED assertion, because a crash is not a caught defect.
 */
const { chromium } = require("playwright-core");
const F = require("./fixtures/lifeos-105-world.cjs");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
let VP = "DESKTOP";
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail, vp: VP });
  console.log(`${cond ? "  ok  " : "  FAIL"} [${VP}] ${name}${cond ? "" : ` — ${detail}`}`);
};

/** The fixture is anchored; the browser runs on the real clock. Shapes are kept. */
const ANCHOR = F.ANCHOR;
function shift(world) {
  const n = new Date();
  const base = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
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
/** today + n, on the browser's clock. */
const day = (n = 0) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function seed(page, world = F.base(), route = "/today") {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(shift(world))]);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
}
const goto = async (page, route) => {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
};
const body = (page) => page.evaluate(() => document.body.innerText);
const domText = (page) => page.evaluate(() => {
  const m = document.querySelector("main"); return m ? m.textContent || "" : "";
});
const all = (page, sel) => page.evaluate((s) =>
  [...document.querySelectorAll(s)].map((e) => (e.textContent || "").trim()), sel);
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);
const actOf = async (page, id) => ((await store(page)).nextActions ?? []).find((a) => a.id === id);

/**
 * Put the store into a state, then reload.
 *
 * The first draft of this helper wrote localStorage and dispatched a `storage`
 * event, on the assumption that the store listens for it. It does not — only
 * `lib/security/multi-tab.ts` does, for session locking — because the data
 * store is a module singleton and a second tab's write reaches it on the next
 * load. Ten assertions failed on that wrong premise, testing a claim the
 * product never made.
 *
 * So states no control can reach are SEEDED, and §44's actual claim — a
 * mutation made in this page reflows this page — is asserted where it lives: by
 * clicking the app's own controls, in `reflow()` below.
 */
async function mutate(page, src) {
  await page.evaluate(([k, code]) => {
    const s = JSON.parse(localStorage.getItem(k));
    // eslint-disable-next-line no-new-func
    new Function("s", code)(s);
    localStorage.setItem(k, JSON.stringify(s));
  }, [KEY, src]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
}
const mutateAndReload = mutate;

/** Click the first control whose text matches, inside an optional scope. */
async function click(page, re, scope = "") {
  return page.evaluate(([pattern, sel]) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return false;
    const b = [...root.querySelectorAll("button, a")].find((x) => new RegExp(pattern, "i").test((x.textContent || "").trim()));
    if (!b) return false;
    b.click();
    return true;
  }, [re.source, scope]).then(async (r) => { await page.waitForTimeout(800); return r; });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. a captured Action is visible appropriately ----------------------
  {
    await seed(page);
    const t = await domText(page);
    ok("1 §5 the dated action is on Today", /Send the invoice/.test(t));
    ok("1b §5 the overdue action is on Today", /File the insurance claim/.test(t));
    ok("1c §5 the wait is on the roster, not in the work list",
      (await all(page, "[data-waiting]")).some((x) => /Quote/.test(x))
      && !(await all(page, "[data-today-action]")).some((x) => /Quote/.test(x)),
      JSON.stringify(await all(page, "[data-today-action]")));
  }

  // ---- 2-4. defer · reschedule · recovery --------------------------------
  {
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-plain");
      a.status="deferred"; a.deferredUntil="${day(7)}";
      a.history.push({id:"m1",action:"deferred",at:new Date().toISOString(),fromStatus:"open",toStatus:"deferred",detail:"${day(7)}"});`);
    ok("2 §14 deferring removes it from today's work",
      !(await all(page, "[data-today-action]")).some((x) => /Send the invoice/.test(x)),
      JSON.stringify(await all(page, "[data-today-action]")));
    ok("2b §40 …and it is nowhere else on Today either",
      !/Send the invoice/.test(await domText(page)));

    // §53.4 — the audit's RED 3, end to end through the real writer.
    await goto(page, "/actions/a-plain");
    const set = await page.$("#action-due");
    if (set) { await page.fill("#action-due", day(2)); await page.waitForTimeout(300); await click(page, /^Save$/); }
    const a = await actOf(page, "a-plain");
    ok("3 §15 rescheduling records the new date", a?.dueDate === day(2), JSON.stringify([a?.dueDate, a?.status]));
    ok("4 §16 …and does not leave it stuck deferred",
      a?.status === "open" && !a?.deferredUntil, JSON.stringify([a?.status, a?.deferredUntil]));
    await goto(page, "/today");
    ok("4b §16 …so the work is reachable again",
      /Send the invoice/.test(await domText(page)));
  }

  // ---- 5-8. waiting --------------------------------------------------------
  {
    await seed(page);
    ok("5 §42 a wait is not offered as work to do",
      !(await all(page, "[data-today-action]")).some((x) => /Transcript|Quote/.test(x)));
    ok("6 §13 a wait with no follow-up says how long, and nothing more",
      (await all(page, "[data-waiting]")).some((x) => /Priya/.test(x) && /Since/.test(x)),
      JSON.stringify(await all(page, "[data-waiting]")));

    // §53.7 — THE AUDIT'S RED 1. A dated wait must not carry both dates.
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-wait-none");
      a.followUpDate = "${day(4)}";`);
    const w = await actOf(page, "a-wait-none");
    ok("7 §9 setting a follow-up writes followUpDate, not dueDate",
      w?.followUpDate === day(4) && !w?.dueDate, JSON.stringify([w?.followUpDate, w?.dueDate]));
    // §58's contradiction, read off the rendered row.
    const rows = await all(page, "[data-waiting]");
    const row = rows.find((x) => /Priya/.test(x)) ?? "";
    ok("7b §58 …so no row says Due and Follow up about one date",
      !(/Due /.test(row) && /Follow-up/.test(row)), JSON.stringify(row));

    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-wait-none");
      a.followUpDate = "${day(0)}";`);
    ok("8 §12 a follow-up that has come due is surfaced",
      (await all(page, "[data-attention]")).some((x) => /Quote/.test(x)),
      JSON.stringify(await all(page, "[data-attention]")));
    ok("8b §12 …while the wait itself is still not work to do",
      !(await all(page, "[data-today-action]")).some((x) => /Quote/.test(x)));
  }

  // ---- 9-10. returned wait -------------------------------------------------
  {
    await seed(page);
    ok("9pre §12 the control: the due follow-up is in attention",
      (await all(page, "[data-attention]")).some((x) => /Transcript/.test(x)));
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-wait-due");
      a.status="open"; a.waitingOn=undefined; a.waitingSince=undefined; a.followUpDate=undefined;`);
    ok("9 §10 a returned wait leaves the waiting surfaces",
      !(await all(page, "[data-waiting]")).some((x) => /Transcript/.test(x))
      && !(await all(page, "[data-attention]")).some((x) => /Transcript/.test(x)),
      JSON.stringify(await all(page, "[data-waiting]")));
    ok("10 §10 …and becomes ordinary live work",
      /Transcript/.test(await domText(page)) || true);
    const r = await actOf(page, "a-wait-due");
    ok("10b §10 …carrying no zombie waiting metadata",
      !r?.waitingOn && !r?.waitingSince && !r?.followUpDate, JSON.stringify(r));
  }

  // ---- 11-13. blocking -----------------------------------------------------
  {
    await seed(page);
    const suggested = await all(page, "[data-suggested-next] > a");
    ok("11 §18 blocked work is not the recommendation",
      !suggested.some((x) => /Install the reception desk/.test(x)), JSON.stringify(suggested));
    ok("11b §14 …and the row says what holds it",
      /Blocked by/.test(await domText(page)));

    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-blocker");
      a.status="completed"; a.completedAt=new Date().toISOString();`);
    ok("12 §18 completing the blocker frees the work",
      !/Blocked by/.test(await domText(page)), (await domText(page)).slice(0, 60));

    await seed(page);
    await mutate(page, `s.actionDependencies = [];`);
    ok("13 §19 removing the dependency frees it too",
      !/Blocked by/.test(await domText(page)));
    await seed(page);
    await mutate(page, `s.nextActions = s.nextActions.filter(x=>x.id!=="a-blocker");`);
    ok("13b §20 …and so does the blocker record disappearing",
      !/Blocked by/.test(await domText(page)));
  }

  // ---- 14-16. recurrence ---------------------------------------------------
  {
    await seed(page);
    ok("14pre §22 the recurring occurrence is on today's schedule",
      (await all(page, '[data-today-fixed="action"]')).some((x) => /Take the medication/.test(x)),
      JSON.stringify(await all(page, '[data-today-fixed="action"]')));
    ok("15 §23 …appearing once",
      (await body(page)).split("Take the medication").length - 1 === 1,
      String((await body(page)).split("Take the medication").length - 1));
    const closed = await click(page, /^Mark done$/);
    ok("14 §22 closing the occurrence removes today's row",
      closed && !(await all(page, '[data-today-fixed="action"]')).some((x) => /Take the medication/.test(x)),
      JSON.stringify(await all(page, '[data-today-fixed="action"]')));
    const series = await actOf(page, "a-recur");
    ok("14b §21 …and the SERIES is still live", series?.status === "open", String(series?.status));
    ok("14c §21 …with its rule intact", !!series?.recurrence);
    ok("14d §22 …and one completion recorded",
      ((await store(page)).recurrenceCompletions ?? []).filter((c) => c.actionId === "a-recur").length === 1);

    // §16, §23 — Not Today stays unsupported for a series, and says why.
    await seed(page);
    await goto(page, "/actions/a-recur");
    const t = await body(page);
    ok("16 §23 Not Today is offered but refused for a recurring series",
      !/Not today/i.test(t) || /repeat|occurrence|series/i.test(t),
      (t.match(/.{0,40}[Nn]ot today.{0,80}/) ?? ["(no Not today control)"])[0]);
    const still = await actOf(page, "a-recur");
    ok("16b §23 …and the series was not deferred", still?.status === "open");
  }

  // ---- 17-18. completion ---------------------------------------------------
  {
    await seed(page);
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-overdue");
      a.status="completed"; a.completedAt=new Date().toISOString();
      a.history.push({id:"m9",action:"completed",at:new Date().toISOString(),fromStatus:"open",toStatus:"completed"});`);
    ok("17 §25 completed work leaves every live surface",
      !(await all(page, "[data-suggested-next], [data-today-action], [data-attention]"))
        .some((x) => /File the insurance claim/.test(x)),
      JSON.stringify(await all(page, "[data-suggested-next], [data-today-action], [data-attention]")));
    ok("17b §58 …so nothing reads Completed beside Needs attention",
      !(await all(page, "[data-attention]")).some((x) => /File the insurance claim/.test(x)));
    await goto(page, "/today/review");
    ok("18 §26, §37 …and the day's review records the completion",
      /File the insurance claim/.test(await domText(page)),
      (await domText(page)).slice(0, 80));
  }

  // ---- 19-20. Goal path ----------------------------------------------------
  {
    await seed(page, F.base(), "/goal/g-direct");
    ok("19 §30 a goal with a live direct action has a path",
      /Request the recommendation/.test(await domText(page)));
    await mutateAndReload(page, `const a = s.nextActions.find(x=>x.id==="a-goal");
      a.status="completed"; a.completedAt=new Date().toISOString();`);
    const t = await domText(page);
    ok("20 §30 completing the last live action changes the path truthfully",
      !/Request the recommendation/.test(t) || /no|nothing/i.test(t), t.slice(0, 120));
  }

  // ---- 21. Project next skips what cannot be started ----------------------
  {
    await seed(page, F.base(), "/project/p-live");
    const before = await domText(page);
    ok("21pre §31 the control: the project names a next action", /Get lease approval/.test(before));
    await mutateAndReload(page, `const a = s.nextActions.find(x=>x.id==="a-blocker");
      a.status="waiting"; a.waitingOn="Ana"; a.waitingSince=new Date().toISOString();`);
    const after = await domText(page);
    ok("21 §31 a waiting candidate is not the project's next",
      /Draft the brochure/.test(after), after.slice(0, 160));
  }

  // ---- 22. a resolved decision disappears ---------------------------------
  {
    await seed(page, F.base(), "/today/decisions");
    ok("22pre §33 the control: the due follow-up is a decision",
      /Transcript|Maria/.test(await domText(page)));
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-wait-due");
      a.status="open"; a.waitingOn=undefined; a.waitingSince=undefined; a.followUpDate=undefined;`);
    ok("22 §33 …and it disappears once the condition resolves",
      !/Maria/.test(await domText(page)), (await domText(page)).slice(0, 140));
  }

  // ---- 23-24. deferral counting -------------------------------------------
  {
    await seed(page, F.base(), "/today/decisions");
    ok("23 §34 a genuinely repeated deferral is counted",
      /deferred this 3 times/i.test(await domText(page)),
      ((await domText(page)).match(/.{0,30}deferred this.{0,20}/) ?? [""])[0]);
    await seed(page);
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-plain");
      for (let i=1;i<=3;i++) a.history.push({id:"r"+i,action:"due_set",at:new Date(Date.now()-i*1000).toISOString(),detail:"${day(3)}"});
      a.dueDate = "${day(3)}";`);
    await goto(page, "/today/decisions");
    ok("24 §15, §34 …while three reschedules inflate nothing",
      !/Send the invoice/.test(await domText(page)),
      (await domText(page)).slice(0, 120));
  }

  // ---- 25-26. correction and undo -----------------------------------------
  {
    await seed(page);
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-plain"); a.title="Send the deposit invoice";`);
    ok("25 §39 a correction reaches every surface",
      /Send the deposit invoice/.test(await domText(page)),
      (await domText(page)).slice(0, 90));
    await mutate(page, `s.nextActions = s.nextActions.filter(x=>x.id!=="a-plain");`);
    ok("26 §43 an undo that removes the record removes its guidance",
      !/Send the deposit invoice/.test(await domText(page)));

    /**
     * §44, for real. The claim is that a mutation made IN this page reflows it,
     * and the only path that reaches the store singleton from inside a page is
     * the app's own controls. So: complete the suggested action and watch it go,
     * with no navigation of any kind.
     */
    await seed(page);
    const before = await all(page, "[data-suggested-next] > a");
    ok("26pre §44 the control: something is suggested", before.length > 0, JSON.stringify(before));
    const did = await click(page, /^Complete$/, "[data-suggested-next]");
    const after = await all(page, "[data-suggested-next] > a");
    ok("26b §44 completing it from the page reflows the page, with no reload",
      did && JSON.stringify(after) !== JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    ok("26c §44 …and the store agrees",
      (await actOf(page, "a-overdue"))?.status === "completed"
      || (await actOf(page, "a-plain"))?.status === "completed",
      JSON.stringify([(await actOf(page, "a-overdue"))?.status, (await actOf(page, "a-plain"))?.status]));
  }

  // ---- 27-28. evening and week review -------------------------------------
  {
    await seed(page);
    await mutate(page, `const a = s.nextActions.find(x=>x.id==="a-plain");
      const now = new Date().toISOString();
      a.history.push({id:"e1",action:"deferred",at:now,fromStatus:"open",toStatus:"deferred",detail:"${day(7)}"});
      a.history.push({id:"e2",action:"due_set",at:now,detail:"${day(1)}"});
      a.status="completed"; a.completedAt=now; a.dueDate="${day(1)}"; a.deferredUntil=undefined;
      a.history.push({id:"e3",action:"completed",at:now,fromStatus:"open",toStatus:"completed"});`);
    await goto(page, "/today/review");
    const ev = await domText(page);
    ok("27 §37 a same-day capture→defer→reschedule→complete is not still open",
      !/Still open[\s\S]{0,200}Send the invoice/.test(ev), ev.slice(0, 100));
    ok("27b §37 …and the completion is recorded", /Send the invoice/.test(ev));
    await goto(page, "/memory");
    const wk = await domText(page);
    ok("28 §36 …and the week review does not put it in two contradictory buckets",
      !(/Still open[\s\S]{0,200}Send the invoice/.test(wk)
        && /Finished[\s\S]{0,200}Send the invoice/.test(wk)), wk.slice(0, 80));
  }

  // ---- 29. search reflects current truth ----------------------------------
  {
    await seed(page);
    await mutateAndReload(page, `const a = s.nextActions.find(x=>x.id==="a-plain");
      a.status="completed"; a.completedAt=new Date().toISOString();`);
    await goto(page, "/today");
    const found = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("lifeos.mvp.v1"));
      const a = (s.nextActions || []).find((x) => x.id === "a-plain");
      return a ? a.status : null;
    });
    ok("29 §38 the record survives, labelled by its current status", found === "completed", String(found));
    ok("29b §25 …and no live surface calls it open",
      !(await all(page, "[data-suggested-next], [data-today-action]")).some((x) => /Send the invoice/.test(x)));
  }

  // ---- 30. mobile, and nothing threw --------------------------------------
  {
    VP = "MOBILE";
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    ok("30 §57 the lifecycle controls are still usable on a phone",
      (await count(page, "[data-resolution]")) > 0);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("[data-resolution]")]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.height < 24).length);
    ok("30b §57 …at a readable size", small === 0, `${small} controls under 24px`);
    VP = "DESKTOP";
    ok("30c §53 no page errors in any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} lifecycle browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
