#!/usr/bin/env node
/**
 * LIFEOS-080 §35 — CAPTURE INTELLIGENCE BROWSER TORTURE.
 *
 * Measured on the RENDERED product at two viewports.
 *
 * The sprint's claim is a product claim — *say it in normal language and
 * Conqify knows what kind of thing it might become* — so the evidence has to be
 * the page. These assertions type into the real textarea, click the real
 * buttons, follow the real navigation, and read what was actually written by
 * inspecting localStorage afterwards.
 *
 * The assertion that mattered most in the audit is a NEGATIVE one, and it is
 * here twice: after a capture that Conqify reads as a rule, `constitutionElements`
 * must still be empty. Recognition is not creation.
 *
 * Run against a production build on :3111 with LIFEOS_ENABLE_DEV_ROUTES=1.
 */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const results = [];
let VP = "DESKTOP";
const ok = (n, p, d) => { results.push({ n, p, d, vp: VP }); console.log(`${p ? "PASS" : "FAIL"}  [${VP}] ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const body = (page) => page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
const store = (page, fn) => page.evaluate(([k, f]) => {
  const s = JSON.parse(localStorage.getItem(k) || "{}");
  // eslint-disable-next-line no-new-func
  return new Function("s", `return (${f})(s)`)(s);
}, [KEY, fn.toString()]);

/** Start from a clean life, so every count below is caused by this capture. */
const seed = async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(EMPTY())]);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
};

/** Type a capture and press the real Capture button. */
const capture = async (page, text) => {
  await seed(page);
  await page.fill("#capture", text);
  await page.waitForTimeout(120);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(700);
};

/** The kinds the panel is showing, read off the rendered cards. */
const shownKinds = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-candidate]")).map((el) => el.getAttribute("data-candidate")));

/**
 * The TITLES the panel is showing, read out of the editable inputs.
 *
 * Not out of `body.textContent`, which is the trap this harness fell into
 * first: React renders the textarea's value as a child node, so the raw capture
 * appears in the page text. An assertion that a title is "get healthier" then
 * passes against the user's own sentence rather than against the candidate,
 * which is the assertion passing for the wrong reason.
 */
const shownTitles = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-candidate]")).map((li) => {
    const input = li.querySelector('input[aria-label="Title"]');
    return [li.getAttribute("data-candidate"), input ? input.value : null];
  }));

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2000 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));

    /* ============================================================
     * 1. A goal is recognised on the page, and created by nobody.
     * ============================================================ */
    await capture(page, "My goal is to save six months of expenses");
    const k1 = await shownKinds(page);
    ok("1.1 §7 an ambition is recognised as a Goal", k1.includes("goal"), JSON.stringify(k1));
    const t1 = await body(page);
    ok("1.2 …labelled in product words", /Possible goal|Goal/.test(t1));
    ok("1.3 §6 …and says it will not be created for you",
      /won't create a goal unless you say so/i.test(t1), (t1.match(/.{0,60}unless you say so.{0,10}/) ?? [""])[0]);
    ok("1.4 …titled from the user's own words",
      JSON.stringify(await shownTitles(page)) === JSON.stringify([["goal", "save six months of expenses"]]),
      JSON.stringify(await shownTitles(page)));
    const pre1 = await store(page, (s) => (s.goals || []).length);
    ok("1.5 §6 nothing exists before confirmation", pre1 === 0, `goals=${pre1}`);
    const box1 = await page.evaluate(() => {
      const li = document.querySelector('[data-candidate="goal"]');
      const cb = li?.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : null;
    });
    ok("1.6 §6 …and the goal arrives UNTICKED", box1 === false, String(box1));

    await page.click('[data-candidate="goal"] input[type="checkbox"]');
    await page.click("[data-confirm-all]");
    await page.waitForTimeout(700);
    const g1 = await store(page, (s) => (s.goals || []).map((g) => g.title));
    ok("1.7 confirming creates exactly one goal", g1.length === 1, JSON.stringify(g1));
    ok("1.8 …with the user's wording", g1[0] === "save six months of expenses", JSON.stringify(g1));
    ok("1.9 §078 …and NO invented horizon", await store(page, (s) => (s.goals || [])[0]?.horizon === undefined));

    /* ============================================================
     * 2. A rule is recognised — and cannot be created here at all.
     * ============================================================ */
    await capture(page, "I refuse to take on work I can't finish");
    const k2 = await shownKinds(page);
    ok("2.1 §11 a rule shape is recognised", k2.includes("standard"), JSON.stringify(k2));
    const t2 = await body(page);
    // The heading hedges to "Likely rule" at this confidence, so the match is
    // case-insensitive — and carries no TRAILING \b. `textContent` concatenates
    // adjacent elements with no separator, so the string really is
    // "…Likely ruleConqify will not create this…" and a word boundary after
    // "rule" never matches. LIFEOS-079's harness was bitten by this exact trap
    // and it was recorded; this run reproduced it anyway.
    ok("2.2 …called a Rule, not a Constitution standard",
      /likely rule/i.test(t2) && !/constitution|ConstitutionElement/i.test(t2),
      `rule=${/likely rule/i.test(t2)} constitution=${(t2.match(/.{0,50}constitution.{0,30}/i) ?? ["-"])[0]}`);
    ok("2.3 §6 …stating outright that Conqify will not create it",
      /will not create this for you/i.test(t2));

    // The audit's worst finding, asserted on the page: the row that cannot be
    // written must not offer a control that pretends it can.
    const box2 = await page.evaluate(() => {
      const li = document.querySelector('[data-candidate="standard"]');
      return li ? li.querySelectorAll('input[type="checkbox"]').length : -1;
    });
    ok("2.4 §6 a suggest-only row has NO checkbox", box2 === 0, `checkboxes=${box2}`);
    ok("2.5 §6 …it has a destination instead",
      await page.evaluate(() => !!document.querySelector("[data-send-personal-code]")));
    ok("2.6 …that names Personal Code", /Add to my Personal Code/i.test(t2));
    ok("2.7 …and says nothing is saved yet", /nothing is saved yet/i.test(t2));

    const before2 = await store(page, (s) => (s.constitutionElements || []).length + (s.protocols || []).length);
    ok("2.8 §6 no normative record exists from recognition alone", before2 === 0, `${before2}`);

    /* ============================================================
     * 3. The handoff. Following it must not create anything either.
     * ============================================================ */
    await page.click("[data-send-personal-code]");
    await page.waitForTimeout(1200);
    ok("3.1 §6 the rule reaches Personal Code",
      page.url().includes("/personal-code"), page.url());
    const filled = await page.evaluate(() => document.querySelector("[data-rule-input]")?.value ?? null);
    ok("3.2 …with the sentence prefilled, unchanged",
      filled === "I refuse to take on work I can't finish", JSON.stringify(filled));
    const t3 = await body(page);
    ok("3.3 …saying where the words came from", /From your capture/i.test(t3));
    ok("3.4 §6 …and that nothing has happened yet", /Nothing is saved until you add it/i.test(t3));

    const mid3 = await store(page, (s) => (s.constitutionElements || []).length);
    ok("3.5 §6 ARRIVING here still creates nothing", mid3 === 0, `${mid3}`);
    const cap3 = await store(page, (s) => (s.captures || []).length);
    ok("3.6 §16 …but the capture itself was saved, so nothing was lost", cap3 >= 1, `${cap3}`);

    await page.click("[data-rule-save]");
    await page.waitForTimeout(800);
    const rules3 = await store(page, (s) => (s.constitutionElements || []).map((e) => [e.kind, e.status, e.statement]));
    ok("3.7 the person's own click is what creates it", rules3.length === 1, JSON.stringify(rules3));
    ok("3.8 …as an adopted standard", rules3[0]?.[0] === "standard" && rules3[0]?.[1] === "active", JSON.stringify(rules3[0]));
    ok("3.9 …in their exact words", rules3[0]?.[2] === "I refuse to take on work I can't finish");
    ok("3.10 …linked back to the capture it came from",
      await store(page, (s) => !!(s.constitutionElements || [])[0]?.sourceCaptureId));
    ok("3.11 §050A …and not laundered into machine prose",
      await store(page, (s) => (s.constitutionElements || [])[0]?.fromAiText !== true));

    /* ============================================================
     * 4. Several things at once, from one messy sentence.
     * ============================================================ */
    await capture(page, "I want to get healthier so I should stop eating late, and I need to book a physical");
    const k4 = await shownKinds(page);
    ok("4.1 §22 one sentence yields three readings", k4.length === 3, JSON.stringify(k4));
    ok("4.2 …an ambition, a rule and an errand",
      k4.join("+") === "goal+standard+action", k4.join("+"));
    const t4 = await body(page);
    // Read off the inputs, not the page text — the raw sentence is echoed by
    // the textarea and would satisfy a text match on its own.
    ok("4.3 …and each is titled with only its own half",
      JSON.stringify(await shownTitles(page)) === JSON.stringify([
        ["goal", "get healthier"],
        ["standard", "I should stop eating late"],
        ["action", "book a physical"],
      ]), JSON.stringify(await shownTitles(page)));
    const ticked4 = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-candidate]")).map((li) => {
        const cb = li.querySelector('input[type="checkbox"]');
        return [li.getAttribute("data-candidate"), cb ? cb.checked : "none"];
      }));
    ok("4.4 §6 only the cheap kind arrives ticked",
      JSON.stringify(ticked4) === JSON.stringify([["goal", false], ["standard", "none"], ["action", true]]),
      JSON.stringify(ticked4));

    await page.click("[data-confirm-all]");
    await page.waitForTimeout(800);
    const after4 = await store(page, (s) => ({
      actions: (s.nextActions || []).length, goals: (s.goals || []).length,
      rules: (s.constitutionElements || []).length,
    }));
    ok("4.5 confirming writes only what was ticked",
      after4.actions === 1 && after4.goals === 0 && after4.rules === 0, JSON.stringify(after4));

    /* ============================================================
     * 5. The guards, on the page.
     * ============================================================ */
    await capture(page, "I used to always answer emails immediately");
    const k5 = await shownKinds(page);
    ok("5.1 §17 a past-tense rule is NOT offered as a rule", !k5.includes("standard"), JSON.stringify(k5));
    ok("5.2 …it is kept as a note", k5.includes("note"));
    const t5 = await body(page);
    ok("5.3 …and says why, rather than going silent",
      /something you used to do/i.test(t5), (t5.match(/.{0,40}used to do.{0,50}/) ?? [""])[0]);

    await capture(page, "Is it a rule that I never say no?");
    ok("5.4 §15 a question about a rule is not a rule", !(await shownKinds(page)).includes("standard"));

    await capture(page, "I don't want to run a marathon");
    ok("5.5 §16 a declined ambition is not a goal", !(await shownKinds(page)).includes("goal"));

    // The guard must not have eaten the rules. Negative CONTENT is still a rule.
    await capture(page, "I don't lie to avoid embarrassment");
    ok("5.6 §16 a prohibition IS still a rule", (await shownKinds(page)).includes("standard"),
      JSON.stringify(await shownKinds(page)));

    /* ============================================================
     * 6. Reflection: both readings, neither asserted.
     * ============================================================ */
    await capture(page, "I've been thinking I want to change careers");
    const k6 = await shownKinds(page);
    ok("6.1 §15 a reflection yields two readings", k6.length === 2, JSON.stringify(k6));
    ok("6.2 …the reflection first", k6[0] === "note", JSON.stringify(k6));
    ok("6.3 …the ambition beside it", k6[1] === "goal", JSON.stringify(k6));
    const ticked6 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-candidate] input[type="checkbox"]')).map((c) => c.checked));
    ok("6.4 §6 neither is pre-selected", ticked6.every((c) => c === false), JSON.stringify(ticked6));
    const t6 = await body(page);
    ok("6.5 …and the second is offered, not asserted",
      /if it's a goal|if it’s a goal/i.test(t6));

    /* ============================================================
     * 7. Nothing anywhere grades the user (§12 of 079, still in force).
     * ============================================================ */
    const all7 = [t1, t2, t3, t4, t5, t6].join(" ");
    ok("7.1 no score, streak, compliance or violation language",
      !/(complian|streak|violat|discipline score|you failed|\b\d+% confident)/i.test(all7));

    /* ============================================================
     * 8. An un-delimited conditional, end to end.
     * ============================================================ */
    await capture(page, "If I feel overwhelmed I go for a walk");
    const k8 = await shownKinds(page);
    ok("8.1 §11 an un-delimited conditional is a Protocol", k8.includes("protocol"), JSON.stringify(k8));
    const t8 = await body(page);
    ok("8.2 …hedged, because the split was inferred", /Likely protocol/i.test(t8), (t8.match(/.{0,30}protocol.{0,20}/i) ?? [""])[0]);
    const trig8 = await page.evaluate(() => document.querySelector('[aria-label="Protocol trigger"]')?.value ?? null);
    const resp8 = await page.evaluate(() => document.querySelector('[aria-label="Protocol response"]')?.value ?? null);
    ok("8.3 …split at the subject", trig8 === "I feel overwhelmed", JSON.stringify(trig8));
    ok("8.4 …into the response", resp8 === "I go for a walk", JSON.stringify(resp8));
    ok("8.5 §6 …and it is not pre-selected",
      await page.evaluate(() => document.querySelector('[data-candidate="protocol"] input[type="checkbox"]')?.checked === false));

    /* ============================================================
     * 9. The escape hatch is untouched (§16 of 060).
     * ============================================================ */
    await capture(page, "I refuse to take on work I can't finish");
    await page.click("[data-keep-note]");
    await page.waitForTimeout(700);
    const n9 = await store(page, (s) => (s.notes || []).map((n) => n.body));
    ok("9.1 a recognised rule can still just be a note", n9.length === 1, JSON.stringify(n9));
    ok("9.2 …kept exactly as typed", n9[0] === "I refuse to take on work I can't finish");
    ok("9.3 …and creating no normative record",
      await store(page, (s) => (s.constitutionElements || []).length === 0));

    if (isMobile) {
      await capture(page, "I want to get healthier so I should stop eating late, and I need to book a physical");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("10.1 MOBILE the results panel does not scroll sideways", overflow <= 1, `${overflow}px`);
      const tap = await page.evaluate(() => {
        const b = document.querySelector("[data-send-personal-code]");
        const r = b?.getBoundingClientRect();
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      });
      ok("10.2 MOBILE the Personal Code handoff is a real tap target",
        !!tap && tap.h >= 24 && tap.w >= 100, JSON.stringify(tap));
    }

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} capture-intelligence browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
