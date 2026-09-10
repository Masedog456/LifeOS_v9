#!/usr/bin/env node
/**
 * LIFEOS-098 §48 — browser torture for one record, one truth.
 *
 * The deterministic suite proves the builders agree. This proves the PAGES do:
 * it seeds one world, walks the surfaces a person actually walks between, and
 * compares the rendered text about the SAME record across them.
 *
 * That distinction matters here more than in most sprints. Every drift this
 * sprint removed lived in a component — a table declared beside a JSX block, a
 * template literal inside a `<span>` — which is exactly the code a model-level
 * test cannot reach. Two of the four confirmed drifts, and the one the audit
 * missed entirely, were only visible with the page rendered.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;
let hn = 0;
const H = (action, when, x = {}) => ({ id: `h${++hn}`, action, at: when, ...x });

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p });

/**
 * §47. One world, walked by every scenario below.
 *
 * Shaped so each surface has something to disagree about: an action due TODAY
 * with a time (the date phrase and the time format), an OVERDUE one (past
 * tense), a follow-up that arrived today and one that passed (the two halves of
 * §13), a CANCELLED record (the kind two component tables had no word for), a
 * goal horizon change (the prefix rule) and an event (the search entry).
 */
const WORLD = () => ({ ...EMPTY(),
  goals: [{ id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
    history: [
      { id: "gh0", at: at(-60, 8), kind: "created" },
      { id: "gh1", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
    ],
    createdAt: at(-90), updatedAt: at(-1) }],
  projects: [{ id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
    priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: at(-90), updatedAt: at(-90) }],
  nextActions: [
    act({ id: "a-today", title: "Call the dentist", projectId: "p1", dueDate: dk(0), dueTime: "14:00" }),
    act({ id: "a-over", title: "Pay the application fee", projectId: "p1", dueDate: dk(-5) }),
    /**
     * A SECOND overdue action, and the reason there are two.
     *
     * The first version of this suite asserted the past tense on one overdue
     * record — which is the record the recommender picks, so its phrase came
     * from `dueLabel` through the recommendation's own reasons and was never
     * the drifting one. Reverting the sprint left the assertion green. §34's
     * ownership rule means the row chip this sprint fixed is only rendered for
     * an overdue action that does NOT own the recommendation.
     */
    act({ id: "a-over2", title: "Renew the parking permit", projectId: "p1", dueDate: dk(-3) }),
    act({ id: "a-wait-fu", title: "Transcript from Maria", projectId: "p1", status: "waiting",
      waitingOn: "Maria", waitingSince: at(-7), followUpDate: dk(0),
      history: [H("waiting", at(-7), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-wait-late", title: "Signed form from Ana", projectId: "p1", status: "waiting",
      waitingOn: "Ana", waitingSince: at(-9), followUpDate: dk(-4),
      history: [H("waiting", at(-9), { detail: "Ana", fromStatus: "open", toStatus: "waiting" })] }),
    act({ id: "a-stop", title: "Order the banner", projectId: "p1", status: "cancelled",
      history: [H("created", at(-8)), H("cancelled", at(-1, 9), { fromStatus: "open", toStatus: "cancelled" })] }),
    act({ id: "a-done", title: "Book the venue", projectId: "p1", status: "completed", completedAt: at(-1, 11),
      history: [H("created", at(-8)), H("completed", at(-1, 11), { fromStatus: "open", toStatus: "completed" })] }),
  ],
  events: [{ id: "e1", title: "Interview", date: dk(2), startTime: "14:00", allDay: false,
    createdAt: at(-8), updatedAt: at(-8) }],
  /**
   * A rule adopted today. This is the only place the MIXED form of the prefix
   * rule is reachable in the browser, and it is worth reaching.
   *
   * On the Goal page and the weekly review the scoped words never changed, so an
   * assertion there proves a constant. The evening close mixes actions, goals
   * and rules in one list, and its old table called this "Standard adopted"
   * while the composer that CREATES the record calls the kind a Rule.
   */
  constitutionElements: [{ id: "ce1", kind: "standard", status: "adopted",
    statement: "I answer messages once a day, not all day.", adoptedAt: at(0, 8),
    createdAt: at(-30), updatedAt: at(0, 8) }],
  constitutionRevisions: [{ id: "cr1", elementId: "ce1", changeKind: "adopted",
    at: at(0, 8), newStatement: "I answer messages once a day, not all day." }],
});

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function seed(page, world = WORLD()) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
async function visit(page, url, wait = 1500) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  return page.evaluate(() => (document.querySelector("main") || document.body).innerText);
}
/** The text of one row, found by the record's title. */
const rowFor = (text, title) => {
  const lines = text.split("\n").map((l) => l.trim());
  const i = lines.findIndex((l) => l === title);
  return i < 0 ? "" : lines.slice(i, i + 4).join(" · ");
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  await seed(page);
  const home = await visit(page, "/");
  const today = await visit(page, "/today");
  /**
   * Today, INCLUDING its collapsed context block (LIFEOS-107).
   *
   * §6 below asks whether a stored title is printed unrewritten — a vocabulary
   * claim, not a fold claim — and the waiting roster lives inside
   * `<details data-today-later>`, which `innerText` cannot see. Until 107 the
   * Plan card happened to restate waiting follow-ups in expanded text, so
   * `innerText` was accidentally enough; that card no longer repeats what Today
   * already owns. `textContent` is the reading LIFEOS-104's own suite uses for
   * exactly this reason.
   */
  const todayDom = await page.evaluate(() => (document.querySelector("main") || document.body).textContent || "");
  const evening = await visit(page, "/today/review");
  const project = await visit(page, "/project/p1");
  const goal = await visit(page, "/goal/g1");

  // ---- 1-4. The same date, on every surface -------------------------------
  //
  // The measured drift: Home printed `formatDayKey(a.dueDate)` — the absolute
  // day — while every signal surface said "Due today" about the same record.
  ok("1 §3 Today says the due date relatively", /Due 2 PM|Due today/.test(today), rowFor(today, "Call the dentist"));
  ok("2 §3 …and the project page agrees",
    /Due today/.test(rowFor(project, "Call the dentist")), rowFor(project, "Call the dentist"));
  ok("3 §3 …and the goal page agrees",
    /Due today/.test(rowFor(goal, "Call the dentist")), rowFor(goal, "Call the dentist"));
  ok("4 §3 …and no surface prints the absolute day for work due today",
    ![project, goal].some((t) => new RegExp(`Due \\w{3}, \\w{3} ${new Date().getDate()}\\b`).test(rowFor(t, "Call the dentist"))),
    `${rowFor(project, "Call the dentist")} | ${rowFor(goal, "Call the dentist")}`);

  // ---- 5-7. Past tense, which is a CLAIM and not a phrasing ---------------
  //
  // The drift the audit missed and the cross-surface proof found. The Project
  // and Goal rows built `Due ${formatDayKey(r.dueDate)}` with no past tense, so
  // an action Today described as "Was due Tue, Sep 1" read there as "Due Tue,
  // Sep 1" — the page saying a passed deadline was still ahead.
  ok("5 §3 the recommendation says a passed deadline in the past tense",
    /Was due/.test(rowFor(today, "Pay the application fee")), rowFor(today, "Pay the application fee"));
  for (const [n, label, text] of [[6, "the project page", project], [7, "the goal page", goal]]) {
    // `a-over2` owns no recommendation, so this is the ROW CHIP — the code that
    // built `Due ${formatDayKey(r.dueDate)}` with no past tense at all.
    const row = rowFor(text, "Renew the parking permit");
    ok(`${n} §3 ${label} says a passed deadline in the past tense`, /Was due/.test(row), row);
    ok(`${n}b §3 …and never as though the date were still ahead`,
      !/(^|·\s)Due \w{3},/.test(row), row);
  }

  // ---- 8-10. One time formatter -------------------------------------------
  //
  // The three raw sites were all in `recommend.ts`, and a reason only renders
  // for the action the recommender picked. In the world above that is an
  // overdue record with no time, so those three sentences never appeared and an
  // assertion over `/today` proved nothing — measured by reverting the sprint
  // and watching it stay green. This scenario seeds a world whose ONLY dated
  // work is the timed one, so it wins the recommendation at any hour and both
  // branches ("Due today at …" before the time, "Was due at … today" after it)
  // contain a formatted time.
  {
    const only = WORLD();
    only.nextActions = only.nextActions.filter((a) => a.id === "a-today");
    await seed(page, only);
    const t = await visit(page, "/today");
    // Scoped to the recommendation BLOCK. The first version split on the
    // heading and kept the rest of the page, which includes Today's own timed
    // chip — so "2 PM" was found whether or not `recommend.ts` produced it, and
    // the assertion stayed green through a full revert.
    const suggested = (t.split("SUGGESTED NEXT")[1] ?? "").split(/\n[A-Z][A-Z '&]{3,}\n/)[0];
    ok("8 §16 the recommendation's own sentence is reached at all",
      /Call the dentist/.test(suggested), suggested.slice(0, 140));
    ok("9 §16 …and says the time the way a person says it",
      /2 PM/.test(suggested), suggested.slice(0, 140));
    ok("10 §16 …never the stored 24-hour value",
      !/\b\d{1,2}:\d{2}\b/.test(suggested), suggested.slice(0, 200));
    await seed(page);
  }

  // ---- 11-13. A follow-up is not a due date (§13) --------------------------
  // A regression guard, not a fix: this already read correctly, and the sprint
  // must not have broken it while routing the phrase through one function.
  ok("11 §13 a follow-up that arrived still says so on the project page",
    /Follow up today/.test(rowFor(project, "Transcript from Maria")), rowFor(project, "Transcript from Maria"));
  // The correction that travelled with the shared phrase: the component copies
  // said "Follow up today" about a follow-up four days past, while the signals
  // said "Follow-up date was …". Two claims about one date.
  ok("12 §3 …and one that passed states its own date, as Today does",
    /Follow up was/.test(rowFor(project, "Signed form from Ana")), rowFor(project, "Signed form from Ana"));
  /**
   * The cross-surface fact, which is the whole point of the sprint.
   *
   * Ana's follow-up passed four days ago. `buildCommitmentSignals` always said
   * "Follow-up date was Wed, Sep 2."; the Project and Goal pages each carried
   * their own copy that said "Follow up today" for any follow-up whose date had
   * merely ARRIVED. Two claims about one date, on two pages one click apart.
   * This asserts they now name the SAME day.
   */
  {
    const said = (today.match(/Follow-up date was ([^.]+)\./) || [])[1];
    ok("13 §3 Today names the day a passed follow-up was due",
      !!said, (today.match(/Follow-up[^\n]*/g) || ["(none)"]).join(" | "));
    ok("13b §3 …and the project page names the same day, not 'today'",
      !!said && rowFor(project, "Signed form from Ana").includes(said),
      `${said} vs ${rowFor(project, "Signed form from Ana")}`);
  }

  // ---- 14-16. One change vocabulary ---------------------------------------
  //
  // `cancelled` had no entry in either component table, so both fell through to
  // "Changed" while Today and the evening close said "Cancelled".
  ok("14 §7 a cancelled record is called cancelled on the project page",
    /Cancelled/.test(rowFor(project, "Order the banner")), rowFor(project, "Order the banner"));
  ok("15 §32 …and no surface falls back to the bare word 'Changed'",
    ![project, goal, today, evening].some((t) => /(^|\n)\s*Changed\s*(·|\n|$)/.test(t)), "");
  // Also a guard. No table ever leaked an enum; what they leaked was the
  // fallback word, which 15 covers.
  ok("16 §22 …and no raw database enum reaches a person",
    ![home, today, evening, project, goal].some((t) => /\b[a-z]+_[a-z_]+\b/.test(t)),
    ([home, today, evening, project, goal].join("\n").match(/\b[a-z]+_[a-z_]+\b/) || [""])[0]);

  // ---- 17-18. The prefix rule, which is the ONE allowed difference (§4) ----
  ok("17 §4 a goal page, already scoped to the goal, says 'Horizon changed'",
    /Horizon changed/.test(goal) && !/Goal horizon changed/.test(goal),
    (goal.match(/.{0,20}[Hh]orizon changed.{0,20}/) || [""])[0]);
  ok("18 §4 …and it is the SHORT form only because the page names the subject",
    goal.includes("Graduate school"), "");
  /**
   * The other half of the prefix rule, and the half that proves it is a RULE.
   *
   * The weekly review lists goal transitions under a per-goal row (scoped, so
   * "Horizon changed") and rule transitions under a block of their own. Before
   * this sprint each of those words was a separate literal in a separate file;
   * now both come from `changeWord` and differ only by the scope the surface
   * passes. Asserting only the goal page would have proved a constant.
   */
  {
    const week = await visit(page, "/memory", 2200);
    /**
   * The mixed form. The evening close names the subject because its list does
   * not: "Rule adopted", the word LIFEOS-095 §32 settled on for this kind, where
   * the evening's own table used to say "Standard adopted" about the same
   * record the composer had just called a Rule.
   */
  ok("19 §37 the evening close uses the product's word for the kind",
    /Rule adopted/.test(evening) && !/Standard adopted/.test(evening),
    (evening.match(/.{0,30}(Rule|Standard) adopted.{0,10}/) || ["(no rule change on the evening close)"])[0]);
  ok("20 §4 the weekly review reaches the same vocabulary",
      /Horizon changed|Near → Medium/.test(week),
      (week.match(/.{0,40}(Horizon changed|Near → Medium).{0,20}/) || [""])[0]);
  }

  // ---- 19-21. One title, everywhere ---------------------------------------
  // Guards for a red that did NOT hold. LIFEOS-096 rewrites a capture's title
  // once, at capture time; nothing re-cleans per surface, and this is what would
  // catch a future surface deciding to.
  for (const [n, label, text] of [[21, "Today", todayDom], [22, "the project page", project], [23, "the goal page", goal]]) {
    ok(`${n} §6 ${label} prints the stored title, unrewritten`,
      text.includes("Transcript from Maria"), "");
  }

  // ---- 22-24. A change reaches every surface at once (§42, §44) ------------
  //
  // Nothing is cached, so completing an action on one page changes what the
  // others say about it with no reload and no second write.
  {
    await page.goto(`${BASE}/project/p1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const before = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
    ok("24 the fixture really has the row this scenario mutates",
      /Call the dentist/.test(before), "");
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("lifeos.mvp.v1"));
      const a = raw.nextActions.find((x) => x.id === "a-today");
      a.status = "completed";
      a.completedAt = new Date().toISOString();
      a.history = [...(a.history ?? []), { id: "hz", action: "completed", at: a.completedAt,
        fromStatus: "open", toStatus: "completed" }];
      localStorage.setItem("lifeos.mvp.v1", JSON.stringify(raw));
    });
    const after = await visit(page, "/project/p1");
    ok("25 §42 the project page reflects the completion with no cached label",
      /Completed/.test(rowFor(after, "Call the dentist")), rowFor(after, "Call the dentist"));
    const goalAfter = await visit(page, "/goal/g1");
    ok("26 §3 …and the goal page uses the same word for it",
      /Completed/.test(rowFor(goalAfter, "Call the dentist")), rowFor(goalAfter, "Call the dentist"));
  }

  // ---- 26-27. Search (§28) ------------------------------------------------
  //
  // Reported by the audit as LATENT and asserted as latent. An Event's date used
  // to be written into `status`, which no palette renders and which no `status:`
  // filter could ever match — so there is nothing visible to prove here, and
  // pretending otherwise would be the decoration this suite just removed four of.
  //
  // What IS newly true and IS observable: the date moved to `aliases`, so the
  // Event is now findable by typing its date. That is the assertion.
  {
    await seed(page);
    const day = dk(2);
    for (const [n, query, why] of [[27, "Interview", "by name"], [28, day, "by its date, which is what `aliases` bought"]]) {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await page.keyboard.press("Meta+k");
      await page.waitForTimeout(600);
      const open = await page.evaluate(() => !!document.querySelector("input[type='search'], [role='dialog'] input"));
      if (!open) { ok(`${n} §28 an Event is findable ${why}`, false, "command palette did not open"); continue; }
      await page.keyboard.type(query);
      await page.waitForTimeout(1000);
      const pal = await page.evaluate(() => document.body.innerText);
      const res = pal.split("RESULTS")[1] ?? "";
      ok(`${n} §28 an Event is findable ${why}`, /Interview/.test(res), `"${query}" → ${res.slice(0, 100)}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }
  await ctx.close();

  // ---- 27-28. Mobile ------------------------------------------------------
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(String(e)));
    await seed(p);
    let worst = 0;
    for (const url of ["/", "/today", "/today/review", "/project/p1", "/goal/g1"]) {
      await p.goto(BASE + url, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(1100);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      worst = Math.max(worst, over);
    }
    ok("29 §34 no surface this sprint touched scrolls sideways on a phone", worst <= 1, String(worst));
    const t = await p.evaluate(() => (document.querySelector("main") || document.body).innerText);
    ok("30 §34 …and the phrases still fit rather than being truncated to nothing",
      /Due today|Was due|Follow up/.test(t), t.slice(0, 160));
    await c.close();
  }

  ok("31 §48 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
