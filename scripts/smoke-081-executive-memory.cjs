#!/usr/bin/env node
/**
 * LIFEOS-081 §32 — EXECUTIVE MEMORY BROWSER TORTURE.
 *
 * Measured on the RENDERED product at two viewports.
 *
 * The sprint's claim is that Conqify can say what CHANGED, from evidence rather
 * than from `updatedAt`. So these assertions do the changing — they complete a
 * real action, defer one three times, end a wait, retire a rule — by writing the
 * same history the store writes, then ask Memory the question a person would ask
 * and read what the page says back.
 *
 * The assertions that matter are the refusals: a horizon change must not be
 * called progress, and a weekly recurring commitment must not be called
 * something the person keeps putting off.
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

/** Days relative to today, so the fixture always lands inside "this week". */
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-3), updatedAt: at(-3), ...p,
});
const goal = (p) => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [],
  createdAt: at(-3), updatedAt: at(-3), ...p,
});
const std = (p) => ({
  kind: "standard", status: "active", adoptedAt: at(-3), linkedRefs: [],
  createdAt: at(-3), updatedAt: at(-3), ...p,
});

/**
 * A week that exercises every claim.
 *
 * ZZ markers are attached as SEPARATE words — LIFEOS-079's harness learned the
 * hard way that fusing them into a title destroys the words the product reads.
 */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({
      id: "g1", title: "ZZgradschool degree",
      horizon: "medium",
      // Edited TODAY; the horizon moved two days ago. The two dates disagree so
      // an `updatedAt` reading would be visibly wrong.
      updatedAt: at(0, 20),
      history: [
        { id: "h1", at: at(-3, 8), kind: "created" },
        { id: "h2", at: at(-2, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
      ],
    }),
  ],
  nextActions: [
    // Completed, and linked to the goal.
    act({ id: "a1", title: "Submit ZZapplication form", goalId: "g1", status: "completed", completedAt: at(-2, 14),
      history: [{ id: "e1", action: "created", at: at(-3, 9) }, { id: "e2", action: "completed", at: at(-2, 14) }] }),
    // Deferred three times.
    act({ id: "a2", title: "Call ZZadmissions office",
      history: [
        { id: "e3", action: "created", at: at(-3, 9) },
        { id: "e4", action: "deferred", at: at(-3, 10), detail: dk(-2) },
        { id: "e5", action: "returned", at: at(-2, 8) },
        { id: "e6", action: "deferred", at: at(-2, 9), detail: dk(-1) },
        { id: "e7", action: "returned", at: at(-1, 8) },
        { id: "e8", action: "deferred", at: at(-1, 9), detail: dk(1) },
      ] }),
    // A wait that ENDED.
    act({ id: "a3", title: "ZZtranscript request", waitingOn: "the registrar",
      history: [
        { id: "e9", action: "created", at: at(-3, 9) },
        { id: "e10", action: "waiting", at: at(-3, 10), detail: "the registrar" },
        { id: "e11", action: "edited", at: at(-2, 16), fromStatus: "waiting", toStatus: "open" },
      ] }),
    // WEEKLY RECURRING, deferred three times. Must never be "keep putting off".
    act({ id: "a4", title: "ZZlabmeeting prep",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
      history: [
        { id: "e12", action: "created", at: at(-3, 9) },
        { id: "e13", action: "deferred", at: at(-3, 12), detail: dk(-2) },
        { id: "e14", action: "deferred", at: at(-2, 12), detail: dk(-1) },
        { id: "e15", action: "deferred", at: at(-1, 12), detail: dk(1) },
      ] }),
    // Created and completed in the same minute.
    act({ id: "a5", title: "Email the ZZdepartment", status: "completed",
      createdAt: at(-1, 15), completedAt: at(-1, 15),
      history: [{ id: "e16", action: "created", at: at(-1, 15) }, { id: "e17", action: "completed", at: at(-1, 15) }] }),
  ],
  constitutionElements: [
    std({ id: "s1", statement: "Protect ZZsleep before optional work.", adoptedAt: at(-2, 12) }),
    std({ id: "s2", statement: "Never work at ZZweekends.", status: "retired", retiredAt: at(-1, 10) }),
  ],
  constitutionRevisions: [
    { id: "r1", elementId: "s1", changeKind: "adopted", at: at(-2, 12) },
    { id: "r2", elementId: "s2", changeKind: "retired", at: at(-1, 10) },
    // An EDIT. Must never appear as a change.
    { id: "r3", elementId: "s1", changeKind: "edited", at: at(-1, 13) },
  ],
  protocols: [{ id: "p1", trigger: "I am angry", response: "wait before replying", status: "active", createdAt: at(-3), updatedAt: at(0) }],
  reflections: [{ id: "rf1", prompt: "On teaching", response: "I care more about ZZphilosophy than teaching.", createdAt: at(-2, 20), annotations: [] }],
  notes: [{ id: "n1", body: "ZZaigenerated summary of your week.", fromAiText: true, archived: false, tags: [], linkedEntityRefs: [], createdAt: at(-1, 7), updatedAt: at(-1, 7) }],
});

const body = (page) => page.evaluate(() => (document.body.textContent || "").replace(/\s+/g, " "));

const seed = async (page) => {
  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(WORLD())]);
  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
};

/** Ask Memory a question through the real input, and read the real answer. */
const ask = async (page, question) => {
  await page.fill("#memory-query", question);
  await page.waitForTimeout(120);
  await page.click("[data-memory-submit]");
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const el = document.querySelector("[data-memory-answer]");
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : null;
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2200 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    await seed(page);

    /* ============================================================
     * 1. What changed this week — the whole arc, in one answer.
     * ============================================================ */
    const a1 = await ask(page, "What changed this week?");
    ok("1.1 the week question is answered", !!a1 && a1.length > 0, String(a1).slice(0, 80));
    ok("1.2 §9 a goal creation is reported", /ZZgradschool/.test(a1 || ""), (a1 || "").slice(0, 200));
    ok("1.3 §11 a completion is reported", /ZZapplication form/.test(a1 || ""));
    ok("1.4 §12 a wait that ended is reported", /ZZtranscript/.test(a1 || ""));
    ok("1.5 §16 a rule change is reported", /ZZsleep/.test(a1 || ""));
    ok("1.6 §17 the user's own words are reported", /ZZphilosophy/.test(a1 || ""));
    // §4: an `edited` revision is not a change. `s1` was edited yesterday and
    // must appear ONCE (its adoption), not twice.
    ok("1.7 §4 an edit is not a second change",
      ((a1 || "").match(/ZZsleep/g) || []).length === 1, String(((a1 || "").match(/ZZsleep/g) || []).length));
    // §23: created and completed in one minute is one line.
    ok("1.8 §23 one action created and completed is ONE line",
      ((a1 || "").match(/ZZdepartment/g) || []).length === 1, String(((a1 || "").match(/ZZdepartment/g) || []).length));

    /* ============================================================
     * 2. A horizon change is direction, never progress.
     * ============================================================ */
    ok("2.1 §9 the horizon transition names both ends",
      /Near/.test(a1 || "") && /Medium/.test(a1 || ""), (a1 || "").match(/.{0,40}Near.{0,40}/)?.[0] ?? "");
    ok("2.2 §9 …under a direction heading, not a progress one",
      /Changed direction/i.test(a1 || ""));
    ok("2.3 §21 …and no progress verdict anywhere",
      !/(made progress|on track|productive|great week|behind)/i.test(a1 || ""));

    const a2 = await ask(page, "What did I move forward this week?");
    ok("2.4 §9 moved-forward reports the completion", /ZZapplication form/.test(a2 || ""), (a2 || "").slice(0, 160));
    ok("2.5 §9 …and NOT the horizon change", !/Near → Medium|Near . Medium/.test(a2 || ""), (a2 || "").slice(0, 160));

    /* ============================================================
     * 3. Repeated postponement — factual, and never about recurring work.
     * ============================================================ */
    const a3 = await ask(page, "What do I keep putting off?");
    ok("3.1 §14 the postponement question is answered", !!a3 && a3.length > 0);
    ok("3.2 §14 …naming the deferred item", /ZZadmissions/.test(a3 || ""), (a3 || "").slice(0, 200));
    ok("3.3 §21 …with a factual count", /deferred this 3 times/i.test(a3 || ""), (a3 || "").slice(0, 200));
    // THE §15 guard, on the rendered page.
    ok("3.4 §15 a weekly recurring task is NOT repeated postponement",
      !/ZZlabmeeting/.test(a3 || ""), (a3 || "").slice(0, 200));
    ok("3.5 §15 …and the exclusion is stated", /repeating schedule/i.test(a3 || ""));
    ok("3.6 §21 …with no psychologizing",
      !/(procrastinat|avoiding|afraid|resistance|lazy|failing)/i.test(a3 || ""));

    /* ============================================================
     * 4. Historical waiting is not current waiting (§12).
     * ============================================================ */
    const a4 = await ask(page, "What did I stop waiting on this week?");
    ok("4.1 §12 the historical question is answered", /ZZtranscript/.test(a4 || ""), (a4 || "").slice(0, 200));
    const a4b = await ask(page, "What am I waiting on?");
    ok("4.2 §12 …and the current question is a different answer",
      !/ZZtranscript/.test(a4b || ""), (a4b || "").slice(0, 200));

    /* ============================================================
     * 5. Personal Code changes, grounded — and the Protocol limitation.
     * ============================================================ */
    const a5 = await ask(page, "What rules changed this week?");
    ok("5.1 §16 an adopted standard is reported", /ZZsleep/.test(a5 || ""), (a5 || "").slice(0, 220));
    ok("5.2 §16 a retired standard is reported", /ZZweekends/.test(a5 || ""));
    ok("5.3 §16 …and the when/then limitation is stated",
      /when\/then rule keeps no history|cannot be dated/i.test(a5 || ""), (a5 || "").slice(0, 260));
    ok("5.4 §16 …and no Protocol date is invented",
      !/wait before replying/.test(a5 || ""), (a5 || "").slice(0, 220));
    const a5b = await ask(page, "What rules do I live by?");
    ok("5.5 §18 'what rules do I live by' still answers the current code",
      /ZZsleep/.test(a5b || "") && !/cannot be dated/i.test(a5b || ""), (a5b || "").slice(0, 200));

    /* ============================================================
     * 6. The user's own words, and the provenance boundary (§17).
     * ============================================================ */
    const a6 = await ask(page, "What did I say mattered this week?");
    ok("6.1 §17 a topicless question finds the reflection", /ZZphilosophy/.test(a6 || ""), (a6 || "").slice(0, 220));
    ok("6.2 §17 …attributed to the user", /You said/.test(a6 || ""));
    // The AI note is in range and MUST NOT carry a "You said" attribution.
    //
    // Read structurally, per row. A first draft sliced the answer's text on the
    // words "You said" — which cannot work, because each card renders the
    // record's text BEFORE its attribution label, so the AI note's body always
    // lands inside the previous row's slice. The product was correct and the
    // harness was wrong; this reads each row's own attribution element.
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-memory-items] li")).map((li) => [
        (li.querySelector("[data-memory-attribution]")?.textContent || "").trim(),
        (li.textContent || "").replace(/\s+/g, " ").trim(),
      ]));
    const saidRows = rows.filter(([attr]) => attr === "You said");
    ok("6.3 §17 …and AI text is never 'you said'",
      saidRows.length > 0 && !saidRows.some(([, text]) => /ZZaigenerated/.test(text)),
      JSON.stringify(rows));
    ok("6.4 §17 …the AI note is marked as machine-written",
      rows.some(([attr, text]) => /ZZaigenerated/.test(text) && /AI-generated/i.test(attr)),
      JSON.stringify(rows.map(([a]) => a)));

    /* ============================================================
     * 7. Entity-scoped change (§19).
     * ============================================================ */
    const a7 = await ask(page, "What changed with my ZZgradschool goal?");
    ok("7.1 §19 an entity-scoped question is scoped", /ZZgradschool/.test(a7 || ""), (a7 || "").slice(0, 220));
    ok("7.2 §19 …and excludes unrelated records",
      !/ZZadmissions|ZZtranscript|ZZsleep/.test(a7 || ""), (a7 || "").slice(0, 250));
    ok("7.3 §19 …naming the record in the heading", /ZZgradschool/.test((a7 || "").slice(0, 120)));

    /* ============================================================
     * 8. No verdicts anywhere (§21, §22).
     * ============================================================ */
    const all = [a1, a2, a3, a4, a5, a6, a7].join(" ");
    ok("8.1 §22 nothing narrates the week as a story",
      !/(transformative|remarkable|great week|tough week|you had a)/i.test(all));
    ok("8.2 §21 nothing grades the person",
      !/(productive|unproductive|neglected|lazy|slacking|score|streak|compliance)/i.test(all));

    if (isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok("9.1 MOBILE the answer does not scroll sideways", overflow <= 1, `${overflow}px`);
    }

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} executive-memory browser assertions (${d} desktop, ${m} mobile) ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
