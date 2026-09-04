#!/usr/bin/env node
/**
 * LIFEOS-084 §37 — browser torture for the weekly executive review.
 *
 * Deterministic tests prove the model. This proves the SURFACE, in a real
 * browser, against the two failure modes that DOM assertions alone miss:
 *
 *   1. the review says something true in the model and something else on screen
 *   2. an assertion sweeps the whole page and passes on text the review does not
 *      own — LIFEOS-083 lost an afternoon to a sweep that matched the onboarding
 *      "Skip" button, so every assertion here is scoped to [data-week-review]
 *
 * Run against a dev server: node scripts/smoke-084-weekly-review.cjs
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
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-60), updatedAt: at(-60), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: at(-60), updatedAt: at(-60), ...p });

/** The audit's week, in the browser. */
const WEEK = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g1", title: "Graduate school", horizon: "medium",
      history: [{ id: "h1", at: at(-60, 8), kind: "created" },
        { id: "h2", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }] }),
    goal({ id: "g2", title: "Run a marathon", horizon: "long" }),
  ],
  projects: [proj({ id: "pr1", title: "Fall applications", goalId: "g1" })],
  events: [{ id: "ev1", title: "Dentist appointment", date: dk(5), startTime: "10:00", allDay: false, createdAt: at(-10), updatedAt: at(-10) }],
  nextActions: [
    act({ id: "a1", title: "Submit UH application", projectId: "pr1", status: "completed", completedAt: at(-1, 14),
      history: [{ id: "e1", action: "created", at: at(-20) }, { id: "e2", action: "completed", at: at(-1, 14) }] }),
    act({ id: "a2", title: "Buy running shoes", status: "completed", completedAt: at(-1, 15),
      history: [{ id: "e3", action: "created", at: at(-20) }, { id: "e4", action: "completed", at: at(-1, 15) }] }),
    act({ id: "a3", title: "Request recommendation letter", projectId: "pr1",
      history: [{ id: "e5", action: "created", at: at(-20) },
        { id: "e6", action: "deferred", at: at(-2, 10), detail: dk(-1) },
        { id: "e7", action: "deferred", at: at(-1, 10), detail: dk(0) },
        { id: "e8", action: "deferred", at: at(0, 8), detail: dk(2) }] }),
    // Weekly recurring, deferred exactly as often. Must never be called slippage.
    act({ id: "a4", title: "Weekly lab prep", recurrence: { frequency: "weekly", interval: 1, weekdays: [1] },
      history: [{ id: "e9", action: "created", at: at(-20) },
        { id: "e10", action: "deferred", at: at(-2, 12), detail: dk(-1) },
        { id: "e11", action: "deferred", at: at(-1, 12), detail: dk(0) },
        { id: "e12", action: "deferred", at: at(0, 7), detail: dk(2) }] }),
    act({ id: "a5", title: "Transcript from registrar", status: "waiting", waitingOn: "the registrar", waitingSince: dk(-9), followUpDate: dk(0) }),
    act({ id: "a6", title: "Lease from Marcus", status: "open", waitingOn: "Marcus",
      history: [{ id: "e13", action: "created", at: at(-20) },
        { id: "e14", action: "waiting", at: at(-9, 10), detail: "Marcus" },
        { id: "e15", action: "edited", at: at(-1, 16), fromStatus: "waiting", toStatus: "open" }] }),
    act({ id: "a7", title: "Pay the deposit", dueDate: dk(-1) }),
    // Four deferrals, no due date → the one shape §18 offers for a second look.
    act({ id: "a8", title: "Learn Portuguese",
      history: [{ id: "f0", action: "created", at: at(-20) },
        { id: "f1", action: "deferred", at: at(-2, 9), detail: dk(-1) },
        { id: "f2", action: "deferred", at: at(-2, 11), detail: dk(0) },
        { id: "f3", action: "deferred", at: at(-1, 9), detail: dk(1) },
        { id: "f4", action: "deferred", at: at(0, 6), detail: dk(3) }] }),
  ],
  constitutionElements: [{ id: "s1", kind: "standard", status: "retired", statement: "Never work at weekends.",
    adoptedAt: at(-60), retiredAt: at(-1, 11), linkedRefs: [], createdAt: at(-60), updatedAt: at(-1, 11) }],
  constitutionRevisions: [{ id: "r1", elementId: "s1", changeKind: "retired", at: at(-1, 11) }],
  reflections: [{ id: "rf1", prompt: "On teaching", response: "I care more about philosophy than teaching.", createdAt: at(-1, 20), annotations: [] }],
  // The provenance trap.
  notes: [{ id: "n1", body: "AI summary: you were productive.", fromAiText: true, archived: false,
    tags: [], linkedEntityRefs: [], createdAt: at(-1, 7), updatedAt: at(-1, 7) }],
});

/** A quiet week: one thing, nothing overdue. */
const CALM = () => ({ ...EMPTY(), nextActions: [
  act({ id: "c1", title: "Water the plants", dueDate: dk(9) }),
  // A real week, just an uneventful one — otherwise the review reports an EMPTY
  // store and "fewer sections than a dense week" is a comparison against zero.
  act({ id: "c2", title: "Renew the library card", status: "completed", completedAt: at(-1, 11),
    history: [{ id: "ce1", action: "created", at: at(-6) }, { id: "ce2", action: "completed", at: at(-1, 11) }] }),
] });

/** A store big enough to notice if the surface got expensive. */
const BIG = () => ({ ...EMPTY(),
  goals: Array.from({ length: 20 }, (_, i) => goal({ id: `bg${i}`, title: `Goal ${i}` })),
  projects: Array.from({ length: 50 }, (_, i) => proj({ id: `bp${i}`, title: `Project ${i}`, goalId: `bg${i % 20}` })),
  nextActions: Array.from({ length: 1000 }, (_, i) => act({
    id: `ba${i}`, title: `Action ${i}`, projectId: `bp${i % 50}`,
    // Disjoint from the completed set below: i%9===0 implies i%3===0, so the
    // first draft of this fixture made every 'overdue' action a completed one
    // and the cap assertions passed against an empty list.
    dueDate: i % 9 === 4 ? dk(-2) : undefined,
    status: i % 3 === 0 ? "completed" : "open",
    completedAt: i % 3 === 0 ? at(-1, 12) : undefined,
    history: i % 3 === 0 ? [{ id: `bh${i}`, action: "completed", at: at(-1, 12) }] : [],
  })),
});

/** §19's list, plus every word a weekly report reaches for when it starts judging. */
const FORBIDDEN = ["failed", "failure", "lazy", "discipline problem", "bad week", "good week",
  "neglect", "lack of commitment", "unproductive", "productive week", "you should have",
  "slacking", "momentum", "drop this", "give up on", "you seem", "you tend to", "you are avoiding"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

/** Read the review's own subtree. Never the page. */
async function readReview(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-week-review]");
    if (!root) return null;
    const secs = [...root.querySelectorAll("[data-week-section]")];
    const blockText = (name) => {
      const b = root.querySelector(`[data-week-block="${name}"]`);
      return b ? (b.textContent || "").trim() : null;
    };
    const idsIn = (sel) => [...root.querySelectorAll(sel)]
      .map((el) => (el.querySelector("a") || {}).getAttribute?.("href") || "")
      .filter(Boolean);
    return {
      text: (root.textContent || "").trim(),
      sections: secs.map((s) => ({
        id: s.getAttribute("data-week-section"),
        heading: (s.querySelector("h3") || {}).textContent?.trim() ?? "",
      })),
      blocks: [...root.querySelectorAll("[data-week-block]")].map((b) => b.getAttribute("data-week-block")),
      partial: !!root.querySelector("[data-week-partial]"),
      deferredRows: [...root.querySelectorAll("[data-week-deferred]")].map((el) => (el.textContent || "").trim()),
      deferralCounts: [...root.querySelectorAll("[data-week-deferral-count]")].map((el) => (el.textContent || "").trim()),
      // Every row in the review that stands for a record, by the record it
      // links to. The one-commitment-one-row rule is a property of THIS list.
      rowHrefs: [...root.querySelectorAll("li")]
        // LEAF rows only. Day groups wrap their rows in an outer <li>, so
        // counting every <li> reported each grouped row twice — a duplicate
        // finding that was the harness's, not the review's.
        .filter((li) => !li.querySelector("li"))
        .map((li) => (li.querySelector("a") || {}).getAttribute?.("href") || "")
        .filter((h) => h.startsWith("/actions/") || h.startsWith("/goal/")),
      carryRows: [...root.querySelectorAll("[data-carry-forward]")].map((el) => ({
        reason: el.getAttribute("data-carry-forward"),
        text: (el.textContent || "").trim(),
        href: (el.querySelector("a") || {}).getAttribute?.("href") || "",
        buttons: [...el.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
      })),
      scheduledRows: [...root.querySelectorAll("[data-scheduled-next]")].map((el) => (el.textContent || "").trim()),
      reconsiderRows: [...root.querySelectorAll("[data-reconsider]")].map((el) => (el.textContent || "").trim()),
      reflectionRows: [...root.querySelectorAll('[data-week-item="reflection"]')].map((el) => (el.textContent || "").trim()),
      movedForward: [...root.querySelectorAll("[data-moved-forward]")].length,
      stillOpenHrefs: (() => {
        const sec = root.querySelector('[data-week-section="still-open"]');
        return sec ? [...sec.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      })(),
      nextHrefs: (() => {
        const sec = root.querySelector('[data-week-section="next-week"]');
        return sec ? [...sec.querySelectorAll("a")].map((a) => a.getAttribute("href")) : [];
      })(),
      empty: !!root.querySelector("[data-week-empty]"),
      leftBehind: blockText("worth-carrying-forward") === null ? null : undefined,
      limitations: [...root.querySelectorAll("[data-week-limitation]")].map((el) => (el.textContent || "").trim()),
      _idsIn: idsIn,
    };
  });
}

async function load(page, world, path = "/memory") {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-week-review]", { timeout: 20000 });
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();

  // Any React error in the review is a failure, not a warning.
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1. the dense week --------------------------------------------------
  await load(page, WEEK());
  const r = await readReview(page);
  ok("1 the review renders", !!r);
  ok("2 at most five primary sections (§20)", r.sections.length <= 5,
    `${r.sections.length}: ${JSON.stringify(r.sections.map((s) => s.heading))}`);
  ok("3 no empty-section graveyard (§21)",
    r.sections.every((s) => s.heading.length > 0) && !/\bNothing\b.*\bNothing\b/.test(r.text));

  // ---- 2. the measured deferral defect ------------------------------------
  // Ten deferral EVENTS across three actions (a3:3, a4:3, a8:4), one of them
  // recurring. The measured defect was rows-per-EVENT, and the honest count is
  // rows-per-COMMITMENT — so this asserts the property rather than a number
  // that happens to be right for this fixture.
  const dupes = Object.entries(r.rowHrefs.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {}))
    .filter(([, n]) => n > 1);
  ok("4 no commitment appears twice anywhere in the review (§9, §20)",
    dupes.length === 0, JSON.stringify(dupes));
  // Every repeatedly-deferred action states its count exactly once, wherever
  // its single row happens to live.
  const counted = (r.deferredRows.join(" ") + " " + r.deferralCounts.join(" ")
    + " " + r.carryRows.map((c) => c.text).join(" "));
  ok("5 each repeatedly-deferred action states its count once",
    (counted.match(/3 times/g) || []).length === 1 && (counted.match(/4 times/g) || []).length === 1,
    counted);
  ok("6 a weekly recurring commitment is never described as deferred",
    !/Weekly lab prep[\s\S]{0,120}?(?:times|Deferred)/i.test(r.text)
    && !r.carryRows.some((c) => c.text.includes("Weekly lab prep")),
    JSON.stringify(r.deferredRows));
  // The block is absent here BY DESIGN — its one item is listed under Still
  // open with its count inline — so this asserts the invariant instead: when
  // the block renders, it says what it excludes. Checked against every world
  // this script loads, at the end.
  ok("7 the deferral block, when shown, says recurring work is excluded",
    !r.blocks.includes("deferred-more-than-once") || /Recurring commitments are not counted/i.test(r.text),
    JSON.stringify(r.blocks));

  // ---- 3. the measured provenance defect ----------------------------------
  ok("8 an AI-written note is not in the user's own words (§12)",
    !r.reflectionRows.join(" ").includes("AI summary"), JSON.stringify(r.reflectionRows));
  ok("9 …anywhere in the review at all", !r.text.includes("AI summary: you were productive"));
  ok("10 …and the user's own reflection IS shown",
    r.reflectionRows.join(" ").includes("philosophy"), JSON.stringify(r.reflectionRows));

  // ---- 4. one commitment, one row -----------------------------------------
  const both = r.stillOpenHrefs.filter((h) => r.nextHrefs.includes(h));
  ok("11 nothing appears in both Still open and Next week", both.length === 0, JSON.stringify(both));

  // ---- 5. carry forward ----------------------------------------------------
  ok("12 carry-forward rows render with a reason (§15)", r.carryRows.length > 0,
    JSON.stringify(r.carryRows.map((c) => c.reason)));
  ok("13 …the overdue item is carried first (§17)", r.carryRows[0]?.reason === "dated",
    JSON.stringify(r.carryRows.map((c) => [c.reason, c.text.slice(0, 40)])));
  ok("14 …each row explains itself in the record's own terms",
    r.carryRows.every((c) => c.text.length > c.reason.length + 8));
  ok("15 …and offers controls rather than acting (§25, §26)",
    r.carryRows.some((c) => c.buttons.length > 0), JSON.stringify(r.carryRows.map((c) => c.buttons)));
  ok("16 the review says nothing has been scheduled",
    /Nothing has been scheduled/i.test(r.text));

  // ---- 6. next week's calendar, kept separate (§22) ------------------------
  ok("17 next week's commitments are shown", r.scheduledRows.some((t) => t.includes("Dentist")),
    JSON.stringify(r.scheduledRows));
  ok("18 …under their own label, not as unresolved work",
    r.blocks.includes("already-on-the-calendar"), JSON.stringify(r.blocks));

  // ---- 7. reconsider, offered and never prescribed (§18) -------------------
  // The 4×-deferred, undated action IS being carried, so its second-look fact
  // rides on the row it already has rather than starting a second one. Both
  // facts must still reach the screen.
  const portuguese = r.carryRows.find((c) => c.text.includes("Learn Portuguese"));
  ok("19 a 4×-deferred action with no due date is surfaced", !!portuguese,
    JSON.stringify(r.carryRows.map((c) => c.text.slice(0, 40))));
  ok("20 …stating BOTH facts on the one row it owns",
    /deferred this 4 times/i.test(portuguese?.text || "") && /no due date/i.test(portuguese?.text || ""),
    portuguese?.text);
  ok("21 the second-look block, when shown, disclaims the suggestion",
    !r.blocks.includes("worth-a-second-look") || /not suggesting you drop anything/i.test(r.text),
    JSON.stringify(r.blocks));

  // ---- 8. language (§19) ---------------------------------------------------
  const lower = r.text.toLowerCase();
  for (const w of FORBIDDEN) ok(`22 the review never says "${w}"`, !lower.includes(w));
  ok("23 …and never grades the week", !/\b(?:score|grade|\d+\s*%|out of 10)\b/i.test(r.text));

  // ---- 9. moved forward ----------------------------------------------------
  ok("24 the goal-linked completion is marked (§7)", r.movedForward === 1, `${r.movedForward}`);
  ok("25 …and the unlinked completion is still Finished",
    r.text.includes("Buy running shoes"));

  // ---- 10. partial week (§28) ---------------------------------------------
  ok("26 a running week says so", r.partial === true);
  await page.click('[data-week-range="last_week"]');
  await page.waitForTimeout(400);
  const last = await readReview(page);
  ok("27 a finished week does not", last.partial === false);
  ok("28 the range toggle actually changes the window",
    last.text !== r.text);
  await page.click('[data-week-range="this_week"]');
  await page.waitForTimeout(400);

  // ---- 11. the review does not plan (§25, §26) ----------------------------
  const before = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-week-review]");
  await page.waitForTimeout(600);
  const after = await page.evaluate((k) => localStorage.getItem(k), KEY);
  ok("29 rendering the review writes nothing to the store", before === after);

  // ---- 12. limitations survive (§33) --------------------------------------
  const r2 = await readReview(page);
  ok("30 the project-history limitation is still stated",
    r2.limitations.join(" ").toLowerCase().includes("project"), JSON.stringify(r2.limitations));

  // ---- 13. the calm week --------------------------------------------------
  await load(page, CALM());
  const calm = await readReview(page);
  ok("31 a quiet week renders no guilt wall", calm.carryRows.length === 0, JSON.stringify(calm.carryRows));
  ok("32 …and shows fewer sections than a dense one",
    calm.sections.length < r.sections.length, `${calm.sections.length} vs ${r.sections.length}`);
  ok("33 …and still never judges", !FORBIDDEN.some((w) => calm.text.toLowerCase().includes(w)));

  // ---- 14. the empty store ------------------------------------------------
  await load(page, EMPTY());
  const empty = await readReview(page);
  ok("34 an empty store says so without inventing sections",
    empty.empty === true && empty.sections.length === 0, `${empty.sections.length}`);
  ok("35 …and states it is about the records, not the week",
    /statement about the records/i.test(empty.text));

  // ---- 15. mobile ---------------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  mpage.on("pageerror", (e) => errors.push(String(e)));
  await load(mpage, WEEK());
  const overflow = await mpage.evaluate(() => {
    const root = document.querySelector("[data-week-review]");
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth, root: root.scrollWidth };
  });
  ok("36 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1,
    `doc ${overflow.doc} vs win ${overflow.win}`);
  const mr = await readReview(mpage);
  ok("37 the same five sections on mobile", mr.sections.length === r.sections.length,
    `${mr.sections.length} vs ${r.sections.length}`);
  await mctx.close();

  // ---- 16. scale ----------------------------------------------------------
  const t0 = Date.now();
  await load(page, BIG());
  const big = await readReview(page);
  const ms = Date.now() - t0;
  ok("38 1,000 actions render the review in under 15s", ms < 15000, `${ms}ms`);
  ok("39 …still capped, not a 1,000-row page", big.carryRows.length <= 5 && big.scheduledRows.length <= 5,
    `carry ${big.carryRows.length}, scheduled ${big.scheduledRows.length}`);
  ok("40 …and still at most five sections", big.sections.length <= 5, `${big.sections.length}`);

  // The two conditional assertions above are only worth anything if some world
  // actually renders the block they guard. This is that world: enough overdue
  // work to push the repeatedly-deferred action out of both the carry cap and
  // Still open, so the deferral block finally has something to show.
  await load(page, { ...WEEK(), nextActions: [...WEEK().nextActions,
    ...Array.from({ length: 8 }, (_, i) => act({ id: `p${i}`, title: `Pressing ${i}`, dueDate: dk(-3) }))] });
  const crowded = await readReview(page);
  ok("41 a crowded week does render the deferral block",
    crowded.blocks.includes("deferred-more-than-once"), JSON.stringify(crowded.blocks));
  ok("42 …carrying the recurring-exclusion note (§9)",
    /Recurring commitments are not counted/i.test(crowded.text));
  ok("43 …and still shows no commitment twice",
    Object.entries(crowded.rowHrefs.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {}))
      .filter(([, n]) => n > 1).length === 0,
    JSON.stringify(crowded.rowHrefs));
  ok("44 …and is still capped at five sections", crowded.sections.length <= 5, `${crowded.sections.length}`);

  ok("45 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((x) => x.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((x) => !x.pass).map((x) => `  ${x.name} — ${x.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
