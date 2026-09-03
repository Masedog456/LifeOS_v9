#!/usr/bin/env node
/**
 * LIFEOS-079 §16 — PERSONAL CODE BROWSER TORTURE.
 *
 * Measured on the RENDERED product at two viewports.
 *
 * The claim this sprint makes is a product claim — *a person can write down how
 * they want to act, and Conqify will remember it without grading them* — so the
 * evidence has to be the page. These assertions type into the real input, click
 * the real buttons, and read what the DOM says afterwards. Where a mutation
 * matters, they read it back out of localStorage too.
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
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const iso = (h = 8) => `${dk(0)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const std = (p) => ({
  kind: "standard", status: "active", adoptedAt: iso(), linkedRefs: [],
  createdAt: iso(), updatedAt: iso(), ...p,
});
const proto = (p) => ({ status: "active", createdAt: iso(), updatedAt: iso(), ...p });
const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: iso(), updatedAt: iso(), ...p,
});

/**
 * §36's realistic wording. A code someone could plausibly have written.
 *
 * The ZZ markers are attached as SEPARATE words, never fused into one. An
 * earlier fixture wrote "ZZAnswerPeople promptly" and the conflict detector
 * correctly saw no subject: "zzanswerpeople" is not "answer". The marker exists
 * to make a string greppable, and it must not eat the words the product reads.
 */
const WORLD = () => ({ ...EMPTY(),
  constitutionElements: [
    std({ id: "s1", statement: "Tell the ZZtruth even when it is embarrassing." }),
    std({ id: "s3", statement: "Answer ZZpeople promptly." }),
    std({ id: "s4", statement: "Protect ZZsleep before optional work." }),
    std({ id: "s5", statement: "Never work ZZweekends.", status: "retired", retiredAt: iso() }),
    // A value — must never appear in Personal Code.
    std({ id: "v1", kind: "value", statement: "ZZvalueTruthMattersMoreThanImage." }),
  ],
  protocols: [
    proto({ id: "p1", trigger: "I am angry", response: "wait before replying" }),
    proto({ id: "p2", trigger: "I feel overwhelmed", response: "identify the next physical action" }),
  ],
  nextActions: [act({ id: "a1", title: "Reply to the angry ZZemail", dueDate: dk(0) })],
});

const text = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
}, sel);
const body = (page) => page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));
const store = (page, fn) => page.evaluate(([k, f]) => {
  const s = JSON.parse(localStorage.getItem(k) || "{}");
  // eslint-disable-next-line no-new-func
  return new Function("s", `return (${f})(s)`)(s);
}, [KEY, fn.toString()]);

const seed = async (page) => {
  await page.goto(`${BASE}/personal-code`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(WORLD())]);
  await page.goto(`${BASE}/personal-code`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
};

const typeRule = async (page, statement) => {
  await page.fill("[data-rule-input]", statement);
  await page.waitForTimeout(150);
  await page.click("[data-rule-save]");
  await page.waitForTimeout(500);
};

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
    await seed(page);

    /* ============================================================
     * 0. The surface exists and shows one code, not two lists.
     * ============================================================ */
    const t0 = await body(page);
    ok("0.1 Personal Code shows unconditional rules", /ZZtruth/.test(t0));
    ok("0.2 …and conditional ones, on the SAME page",
      /When I am angry, wait before replying/.test(t0),
      (t0.match(/.{0,50}angry.{0,40}/) ?? [""])[0]);
    ok("0.3 §6 a VALUE is not shown — this page is about how to act",
      !/ZZvalueTruthMattersMoreThanImage/.test(t0));
    ok("0.4 §6 no score, compliance, streak, violation or percentage anywhere",
      !/(score|complian|streak|violat|discipline|\b\d+%)/i.test(t0),
      (t0.match(/.{0,40}(score|complian|streak|violat|discipline|\d+%).{0,20}/i) ?? [""])[0]);
    ok("0.5 §46 the page uses one user-facing term",
      /Personal Code/.test(t0) && !/commandment|policy|code of conduct/i.test(t0));

    /* ============================================================
     * 1/2. §16.1 and §16.2 — create both shapes, from one field.
     * ============================================================ */
    await typeRule(page, "Don't lie to look ZZgood");
    const uncond = await store(page, (s) => (s.constitutionElements || []).find((e) => e.statement === "Don't lie to look ZZgood"));
    ok("1.1 §16.1 an unconditional rule is saved as a Constitution standard",
      !!uncond && uncond.kind === "standard", JSON.stringify(uncond && { kind: uncond.kind }));
    ok("1.2 …adopted, so it is actually part of the code",
      !!uncond?.adoptedAt && uncond.status === "active", JSON.stringify(uncond && { s: uncond.status, a: !!uncond.adoptedAt }));
    ok("1.3 §34 …with the user's wording untouched", uncond?.statement === "Don't lie to look ZZgood");
    ok("1.4 …and it appears in Personal Code", /ZZgood/.test(await body(page)));

    await typeRule(page, "When I want something ZZexpensive, wait a day");
    const cond = await store(page, (s) => (s.protocols || []).find((p) => /ZZexpensive/.test(p.trigger + p.response)));
    ok("2.1 §16.2 a when/then rule is saved as a Protocol", !!cond, JSON.stringify(cond));
    ok("2.2 …with the trigger and response split, and neither rewritten",
      cond?.trigger?.includes("ZZexpensive") && /wait a day/.test(cond?.response ?? ""),
      JSON.stringify(cond && { t: cond.trigger, r: cond.response }));
    ok("2.3 §7 …and the user never had to choose a domain",
      await page.evaluate(() => !document.querySelector("[data-rule-kind-picker]")));
    ok("2.4 …and it appears on the same surface",
      /ZZexpensive/.test(await body(page)));

    /* ============================================================
     * 3. §16.3 — retire a standard. Leaves force, stays in the record.
     * ============================================================ */
    await page.click('[data-rule-retire="s4"]');
    await page.waitForTimeout(250);
    // The confirm button must be found INSIDE the dialog. The rule card carries
    // a "Retire" button too, and a document-wide text search picks that one —
    // which simply reopens the dialog and leaves the record untouched.
    const confirmed = await page.evaluate(() => {
      // `alertdialog`, not `dialog` — the confirm host uses the stronger role
      // because these actions change a record.
      const dialog = document.querySelector('[role="alertdialog"]');
      if (!dialog) return "no dialog";
      const buttons = [...dialog.querySelectorAll("button")];
      const b = buttons.find((x) => /^Retire$/i.test((x.textContent || "").trim()));
      if (!b) return `no confirm button: ${buttons.map((x) => x.textContent).join("|")}`;
      b.click();
      return "clicked";
    });
    await page.waitForTimeout(600);
    ok("3.0 the confirmation dialog was reached and confirmed", confirmed === "clicked", String(confirmed));
    const retiredEl = await store(page, (s) => (s.constitutionElements || []).find((e) => e.id === "s4"));
    ok("3.1 §16.3 retiring leaves the record in place — it is not a delete",
      !!retiredEl, JSON.stringify(retiredEl && { id: retiredEl.id }));
    ok("3.2 …with the status changed and a retiredAt stamped",
      retiredEl?.status === "retired" && !!retiredEl?.retiredAt,
      JSON.stringify(retiredEl && { s: retiredEl.status, r: !!retiredEl.retiredAt }));
    const afterRetire = await page.evaluate(() => ({
      active: [...document.querySelectorAll('[data-rule-group="active"] [data-rule-card]')].map((e) => e.getAttribute("data-rule-card")),
      retired: [...document.querySelectorAll('[data-rule-group="retired"] [data-rule-card]')].map((e) => e.getAttribute("data-rule-card")),
    }));
    ok("3.3 …it leaves the active set", !afterRetire.active.includes("s4"), JSON.stringify(afterRetire.active));
    ok("3.4 …and is still retrievable, under Retired", afterRetire.retired.includes("s4"), JSON.stringify(afterRetire.retired));
    ok("3.5 §27 the pre-existing retired rule is still there too", afterRetire.retired.includes("s5"));

    /* ============================================================
     * 4. §16.4 — pause a conditional rule. The asymmetry, honestly.
     * ============================================================ */
    ok("4.1 §3 a conditional rule offers Pause",
      await page.evaluate(() => !!document.querySelector('[data-rule-pause="p2"]')));
    ok("4.2 §3 …and an unconditional one does NOT — standards have no paused state",
      await page.evaluate(() => !document.querySelector('[data-rule-pause="s1"]')));
    await page.click('[data-rule-pause="p2"]');
    await page.waitForTimeout(500);
    const paused = await store(page, (s) => (s.protocols || []).find((p) => p.id === "p2"));
    ok("4.3 §16.4 pausing is reflected in the record", paused?.status === "paused", String(paused?.status));
    ok("4.4 …and in the view, under its own heading",
      await page.evaluate(() => [...document.querySelectorAll('[data-rule-group="paused"] [data-rule-card]')]
        .some((e) => e.getAttribute("data-rule-card") === "p2")));

    /* ============================================================
     * 5. §16.6 — near duplicate. A question, never a merge.
     * ============================================================ */
    await page.fill("[data-rule-input]", "Answer ZZpeople promptly.");
    await page.waitForTimeout(150);
    await page.click("[data-rule-save]");
    await page.waitForTimeout(400);
    const notice = await text(page, "[data-duplicate-notice]");
    ok("5.1 §16.6 a duplicate is caught BEFORE it is written",
      !!notice && /already have/.test(notice), String(notice));
    ok("5.2 …and the existing rule is shown, so the user can compare",
      !!notice && /ZZpeople/.test(notice));
    const dupCountBefore = await store(page, (s) => (s.constitutionElements || []).filter((e) => /ZZpeople/.test(e.statement)).length);
    ok("5.3 §16.6 …and nothing was saved while the question stands",
      dupCountBefore === 1, String(dupCountBefore));
    ok("5.4 §9 no merge is offered",
      !/merge|combine/i.test(await body(page)));
    await page.click("[data-dupe-keep]");
    await page.waitForTimeout(400);
    ok("5.5 choosing the existing one writes nothing",
      (await store(page, (s) => (s.constitutionElements || []).filter((e) => /ZZpeople/.test(e.statement)).length)) === 1);
    ok("5.6 …and clears the field", (await page.inputValue("[data-rule-input]")) === "");

    /* ============================================================
     * 6. §16.7 — conflicting rules, both shown, no winner.
     * ============================================================ */
    const tensions = await text(page, "[data-rule-tensions]");
    ok("6.1 §16.7 a tension between a standard and a protocol is surfaced",
      !!tensions && /ZZpeople/.test(tensions) && /angry/.test(tensions), String(tensions));
    ok("6.2 …with BOTH shown", !!tensions && /wait before replying/.test(tensions));
    ok("6.3 §10 …and the wording picks no winner",
      !!tensions && /may point in different directions/.test(tensions), String(tensions));
    ok("6.4 §10 …and never says violated, broke or failed",
      !!tensions && !/(violat|broke|fail|inconsistent|should have)/i.test(tensions), String(tensions));

    /* ============================================================
     * 7. §16.5 — capture suggests, and does not mutate.
     * ============================================================ */
    const beforeCapture = await store(page, (s) => ({
      std: (s.constitutionElements || []).length, proto: (s.protocols || []).length,
    }));
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    // The composer classifies on CAPTURE, not on keystroke. Typing alone renders
    // no candidate, so an assertion that only typed would have been testing an
    // empty page.
    await page.fill("textarea", "Always tell the ZZworktruth even when it makes me look bad");
    await page.waitForTimeout(200);
    // `[data-capture-submit]`, not a text match: the NAV also has a "Capture"
    // control, and a document-wide text search opened that menu instead.
    await page.click("[data-capture-submit]");
    await page.waitForTimeout(1200);
    const captureText = await text(page, "[data-capture-results]");
    // No trailing \b: adjacent elements concatenate without whitespace, so the
    // rendered text is "…ruleConqify will not create…" and a closing word
    // boundary never matches. The label itself is what is being asserted.
    ok("7.1 §16.5 capture recognises a normative sentence and names it a rule",
      !!captureText && /\brule/i.test(captureText), String(captureText).slice(0, 220));
    ok("7.1b §8 …and says on the card that it will not create it",
      !!captureText && /will not create this for you/i.test(captureText), String(captureText).slice(0, 220));
    ok("7.1c …explaining WHY it read as one",
      !!captureText && /standard you hold yourself to/i.test(captureText));
    ok("7.1d §19 …and offers the bounded alternatives, because the sentence is genuinely ambiguous",
      !!captureText && /Goal/.test(captureText) && /Note/.test(captureText) && /Protocol/.test(captureText));
    const afterCapture = await store(page, (s) => ({
      std: (s.constitutionElements || []).length, proto: (s.protocols || []).length,
    }));
    ok("7.2 §16.5 …and creates NOTHING before confirmation",
      afterCapture.std === beforeCapture.std && afterCapture.proto === beforeCapture.proto,
      JSON.stringify([beforeCapture, afterCapture]));
    ok("7.3 §8 …and no rule with that wording exists anywhere",
      (await store(page, (s) => (s.constitutionElements || []).some((e) => /ZZworktruth/.test(e.statement)))) === false);

    /* ============================================================
     * 8. §16.8 — Today gets context, and its ordering is untouched.
     * ============================================================ */
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const why = await text(page, "[data-suggested-why]");
    ok("8.1 §11 a relevant rule contextualizes the recommended action",
      !!why && /Your rule: When I am angry/.test(why), String(why));
    ok("8.2 §15 …and no Personal Code section was added to Today",
      !/Personal Code/.test(await body(page)));
    const todayText = await body(page);
    ok("8.3 §12 …and Today never grades the user against a rule",
      !/(violat|broke your|failed to follow|complian)/i.test(todayText),
      (todayText.match(/.{0,40}(violat|broke your|complian).{0,20}/i) ?? [""])[0]);

    /* ============================================================
     * 9. §16.9/§16.10 — Memory answers, and admits what it cannot say.
     * ============================================================ */
    await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    // The memory question box, by its own placeholder. A generic
    // `input:not([type])` selector picked a different control and the page kept
    // answering an unrelated question — which looked like a routing bug and was
    // a harness bug.
    const ASK = 'input[placeholder="What did I finish last week?"]';
    const ask = async (q) => {
      await page.fill(ASK, q);
      await page.waitForTimeout(250);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1100);
      return body(page);
    };

    const liveBy = await ask("What rules do I live by?");
    ok("9.1 §16.9 Memory answers a normative question",
      /ZZtruth/.test(liveBy), (liveBy.match(/.{0,80}ZZtruth.{0,40}/) ?? [""])[0]);
    ok("9.2 …naming both halves of the code",
      /When I am angry/.test(liveBy), (liveBy.match(/.{0,60}angry.{0,40}/) ?? [""])[0]);
    ok("9.3 §12 …and grades nothing",
      !/(complian|streak|violat|\b\d+%)/i.test(liveBy));

    const hist = await ask("When did I change my rule about sleep?");
    ok("9.4 §16.10 a history question about a conditional rule states the limitation",
      /not yet for a when\/then rule/.test(hist),
      (hist.match(/.{0,80}when\/then.{0,40}/) ?? [""])[0]);
    ok("9.5 §4 …and does not invent a date",
      !/ZZsleep.{0,40}\b(20\d\d|Sep|Aug)\b/.test(hist));

    if (isMobile) {
      await page.goto(`${BASE}/personal-code`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("10.1 MOBILE Personal Code does not scroll sideways", overflow <= 1, `${overflow}px`);
      const tap = await page.evaluate(() => {
        const b = document.querySelector("[data-rule-save]");
        const r = b?.getBoundingClientRect();
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      });
      ok("10.2 MOBILE the save control is a real tap target", !!tap && tap.h >= 28 && tap.w >= 60, JSON.stringify(tap));
    }

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} personal-code browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
