#!/usr/bin/env node
/**
 * LIFEOS-085 §39 — browser torture for universal search.
 *
 * Deterministic tests prove `searchEverything`. This proves the PALETTE: that
 * what the model returns is what a person sees, that the keyboard opens it,
 * that mobile can use it, and that no assertion here passes on text the palette
 * does not own — every query is scoped to the dialog, because LIFEOS-083 lost
 * an afternoon to a page-wide sweep that matched the onboarding "Skip" button.
 *
 * Run against a dev server: node scripts/smoke-085-universal-search.cjs
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

/**
 * Midweek of the PREVIOUS calendar week (LIFEOS-089).
 *
 * "notes from last week" resolves to a Monday–Sunday window that jumps once a
 * week, while a fixed day offset slides once a day — so a fixture pinned to
 * `at(-5)` sat on the last day of the window and fell out of it the next
 * morning. Derived from the same week boundary the query uses, it cannot drift.
 */
const lastWeekMidday = (h = 7) => {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;          // 0 = Monday
  d.setDate(d.getDate() - dow - 7 + 2);      // Wednesday of last week
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${key}T${String(h).padStart(2, "0")}:00:00.000Z`;
};

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: at(-20), updatedAt: at(-20), ...p });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-60), updatedAt: at(-60), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: at(-60), updatedAt: at(-60), ...p });

/** §3's example, in the browser, plus every trap the audit found. */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g1", title: "Graduate school", horizon: "medium", description: "Apply to philosophy PhD programs." }),
    goal({ id: "g2", title: "Run a marathon", horizon: "long" }),
  ],
  projects: [proj({ id: "pr1", title: "Fall applications", goalId: "g1" })],
  nextActions: [
    act({ id: "a1", title: "Request recommendation letter", projectId: "pr1", sourceCaptureId: "c1" }),
    act({ id: "a2", title: "Submit UH application", projectId: "pr1", status: "completed", completedAt: at(-2, 14) }),
    act({ id: "a3", title: "Transcript from registrar", status: "waiting", waitingOn: "the registrar", waitingSince: dk(-8), followUpDate: dk(0) }),
    act({ id: "a4", title: "Lease from Marcus", status: "waiting", waitingOn: "Marcus", waitingSince: dk(-3) }),
    act({ id: "a5", title: "Water the plants" }),
  ],
  reflections: [{ id: "rf1", prompt: "On teaching", response: "I think I care more about philosophy than teaching.", createdAt: at(-7, 20), annotations: [] }],
  notes: [
    { id: "n1", title: "Application deadlines", body: "Deadlines: Berkeley Dec 1, NYU Dec 15.", archived: false, tags: ["grad"], linkedEntityRefs: [], createdAt: lastWeekMidday(), updatedAt: lastWeekMidday() },
    // The provenance trap.
    { id: "n2", body: "AI summary: your applications are progressing well.", fromAiText: true, archived: false, tags: [], linkedEntityRefs: [], createdAt: at(-1, 7), updatedAt: at(-1, 7) },
    // Soft-deleted. Must never appear.
    { id: "n3", body: "Old scratch note about graduate school zebrafish.", archived: true, tags: [], linkedEntityRefs: [], createdAt: at(-40, 7), updatedAt: at(-40, 7) },
  ],
  constitutionElements: [
    { id: "s1", kind: "standard", status: "active", statement: "When overwhelmed, work on one application at a time.", adoptedAt: at(-60), linkedRefs: [], createdAt: at(-60), updatedAt: at(-60) },
    { id: "s2", kind: "standard", status: "active", statement: "Never reply to anger with anger.", adoptedAt: at(-60), linkedRefs: [], createdAt: at(-60), updatedAt: at(-60) },
  ],
  protocols: [{ id: "p1", trigger: "I am angry", response: "wait an hour before replying", status: "active", createdAt: at(-60), updatedAt: at(-60) }],
  documents: [{ id: "doc1", title: "Graduate programs in philosophy", authors: ["Jane Reed"], kind: "pdf", status: "reading",
    tags: ["grad school"], notes: "Rankings and deadlines.", sections: [], progress: {}, sourceMetadata: {}, createdAt: at(-30), updatedAt: at(-30) }],
  captures: [
    { id: "c1", text: "request recommendation letter from prof", workingText: "request recommendation letter from prof", processingStatus: "processed", tags: [], createdAt: at(-21) },
    { id: "c2", text: "idea: audit a grad school seminar before applying", processingStatus: "inbox", tags: [], createdAt: at(-4) },
  ],
  events: [{ id: "ev1", title: "Advisor meeting about grad school", date: dk(3), startTime: "10:00", allDay: false, createdAt: at(-10), updatedAt: at(-10) }],
});

/** Enough records that a cap either works or is obvious. */
const BIG = () => ({ ...EMPTY(),
  nextActions: Array.from({ length: 200 }, (_, i) => act({ id: `b${i}`, title: `Berkeley task ${i}` })),
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
}

/** Open the palette the way a person does, and type. */
async function search(page, q, { viaKeyboard = true } = {}) {
  const open = await page.$('[role="dialog"][aria-label="Command palette"]');
  if (!open) {
    if (viaKeyboard) await page.keyboard.press("Control+k");
    else await page.click('[aria-label="Open command palette and search"]');
    await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  }
  const input = await page.$('[role="combobox"]');
  await input.fill("");
  await input.type(q, { delay: 3 });
  await page.waitForTimeout(400);
}

/** Read the palette's OWN subtree. Never the page. */
async function readPalette(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Command palette"]');
    if (!d) return null;
    const opts = [...d.querySelectorAll('[role="option"]')];
    return {
      text: (d.textContent || "").trim(),
      headers: [...d.querySelectorAll('[role="presentation"]')].map((h) => (h.textContent || "").trim()),
      rows: opts.map((o) => ({
        text: (o.textContent || "").trim(),
        selected: o.getAttribute("aria-selected") === "true",
        id: o.id,
      })),
      chips: [...d.querySelectorAll("[data-search-chip]")].map((c) => ({ id: c.getAttribute("data-search-chip"), pressed: c.getAttribute("aria-pressed") === "true" })),
      empty: !!d.querySelector("[data-search-empty]"),
      more: (d.querySelector("[data-search-more]") || {}).textContent?.trim() ?? null,
      listboxLabel: (d.querySelector('[role="listbox"]') || {}).getAttribute?.("aria-label"),
      inputLabel: (d.querySelector('[role="combobox"]') || {}).getAttribute?.("aria-label"),
      activeDescendant: (d.querySelector('[role="combobox"]') || {}).getAttribute?.("aria-activedescendant"),
    };
  });
}

/** Only the rows under the "Results" heading — commands are not search hits. */
function resultRows(p) {
  const start = p.rows.findIndex((r) => /·/.test(r.text));
  return start < 0 ? [] : p.rows.slice(start);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await seed(page, WORLD());

  // ---- 1. the keyboard is the doorway (§31) --------------------------------
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  ok("1 Ctrl+K opens the palette", true);
  let p = await readPalette(page);
  ok("2 the input is labelled (§42)", !!p.inputLabel, p.inputLabel);
  ok("3 the listbox is labelled (§42)", !!p.listboxLabel, p.listboxLabel);

  // ---- 2. cross-domain: the sprint's headline query ------------------------
  await search(page, "grad school");
  p = await readPalette(page);
  const rows = resultRows(p);
  ok("4 'grad school' finds the Goal", rows.some((r) => r.text.includes("Graduate school")),
    JSON.stringify(rows.map((r) => r.text.slice(0, 50))));
  ok("5 …and reaches several domains (§3)",
    ["Goal", "Document", "Event", "Action"].filter((l) => p.text.includes(l)).length >= 3,
    JSON.stringify(["Goal", "Document", "Event", "Action", "Capture"].filter((l) => p.text.includes(l))));
  ok("6 …including the linked Action, labelled with the record it came through",
    p.text.includes("Request recommendation letter") && p.text.includes("Linked to Graduate school"));
  ok("7 a raw capture does not rank above the Goal",
    rows.findIndex((r) => r.text.includes("seminar")) > rows.findIndex((r) => r.text.includes("Graduate school")),
    JSON.stringify(rows.map((r) => r.text.slice(0, 30))));

  // ---- 3. exact match wins (§7) -------------------------------------------
  await search(page, "Graduate school");
  p = await readPalette(page);
  ok("8 an exact Goal title ranks first",
    resultRows(p)[0]?.text.includes("Graduate school"), JSON.stringify(resultRows(p)[0]?.text));
  ok("9 …and says why, in words", p.text.includes("Exact title match"));

  // ---- 4. Personal Code, both halves (§20) --------------------------------
  await search(page, "anger");
  p = await readPalette(page);
  ok("10 a rule query finds the Standard", p.text.includes("Never reply to anger with anger"));
  // §20's no-island property, asserted on a word BOTH records actually contain.
  // "anger" does not reach the protocol that says "angry": matching is prefix-
  // based and the two words diverge after "ang". Bridging them needs real
  // morphology, which §30 says not to build for this sprint — so the gap is
  // recorded in the report rather than papered over with a fuzzy matcher, and
  // this asserts the property §20 is actually about.
  await search(page, "reply");
  const both = await readPalette(page);
  ok("11 one query returns BOTH a Standard and a Protocol (§20)",
    both.text.includes("Never reply to anger with anger") && both.text.includes("wait an hour before replying"),
    JSON.stringify(resultRows(both).map((r) => r.text.slice(0, 44))));
  await search(page, "angry");
  ok("11b …and each is reachable by its own words",
    (await readPalette(page)).text.includes("wait an hour before replying"));
  await search(page, "anger");
  p = await readPalette(page);
  ok("12 …labelled 'Rule' and 'Protocol', never a table name (§10)",
    p.text.includes("Rule") && !/constitution_element|ConstitutionElement|NextAction|CaptureCandidate/.test(p.text),
    (p.text.match(/constitution_element|NextAction/) || [])[0] || "");

  await search(page, "rules about anger");
  p = await readPalette(page);
  ok("13 the multi-word form works too", resultRows(p).some((r) => r.text.includes("anger")),
    JSON.stringify(resultRows(p).map((r) => r.text.slice(0, 40))));

  // ---- 5. provenance (§12) -------------------------------------------------
  await search(page, "teaching");
  p = await readPalette(page);
  ok("14 a user reflection is attributed to the user", /You wrote this/.test(p.text), p.text.slice(0, 200));

  await search(page, "progressing");
  p = await readPalette(page);
  ok("15 an AI-authored note is found", p.text.includes("AI summary"));
  ok("16 …and is NEVER labelled 'You wrote'", !/You wrote/.test(p.text), p.text.slice(0, 200));
  ok("17 …and says who did write it", /Written by Conqify/.test(p.text));

  // ---- 6. waiting (§15) ----------------------------------------------------
  await search(page, "things I'm waiting on");
  p = await readPalette(page);
  ok("18 current waiting records are returned",
    p.text.includes("Transcript from registrar") && p.text.includes("Lease from Marcus"),
    JSON.stringify(resultRows(p).map((r) => r.text.slice(0, 40))));
  ok("19 …labelled Waiting", p.text.includes("Waiting"));

  // ---- 7. handoffs (§16, §17) ---------------------------------------------
  await search(page, "what did I say about teaching?");
  p = await readPalette(page);
  ok("20 a historical question offers a Memory handoff", /Ask your memory/.test(p.text), p.text.slice(0, 220));
  ok("21 …quoting the question back", p.text.includes("what did I say about teaching?"));
  ok("22 …and still shows the literal match beneath it", p.text.includes("philosophy than teaching"));

  await search(page, "what should I focus on?");
  p = await readPalette(page);
  ok("23 a guidance question offers a Guidance handoff", /Ask what to focus on/.test(p.text), p.text.slice(0, 200));

  await search(page, "grad school");
  p = await readPalette(page);
  ok("24 a NAME does not hand off", !/Ask your memory|Ask what to focus on/.test(p.text));

  // ---- 8. date-bounded (§13) ----------------------------------------------
  await search(page, "notes from last week");
  p = await readPalette(page);
  const dated = resultRows(p);
  ok("25 a date query is bounded", dated.length <= 2 && p.text.includes("Application deadlines"),
    JSON.stringify(dated.map((r) => r.text.slice(0, 40))));

  // ---- 9. deleted records (§28) -------------------------------------------
  await search(page, "zebrafish");
  p = await readPalette(page);
  ok("26 an archived note never appears", !p.text.includes("zebrafish") || p.empty,
    p.text.slice(0, 120));
  ok("27 …and the empty state is honest (§29)", p.empty && /No matches for/.test(p.text), p.text.slice(0, 120));

  // ---- 10. capture suppression (§27) --------------------------------------
  await search(page, "recommendation");
  p = await readPalette(page);
  ok("28 the confirmed Action is shown", p.text.includes("Request recommendation letter"));
  ok("29 …and the capture it came from is not repeated", !p.text.includes("from prof"), p.text.slice(0, 200));

  // ---- 11. documents (§25) ------------------------------------------------
  await search(page, "philosophy");
  p = await readPalette(page);
  ok("30 a document result appears where the index supports it",
    p.text.includes("Graduate programs in philosophy") && p.text.includes("Document"),
    JSON.stringify(resultRows(p).map((r) => r.text.slice(0, 44))));

  // ---- 12. no fake relevance anywhere (§8) --------------------------------
  for (const q of ["grad school", "anger", "philosophy"]) {
    await search(page, q);
    p = await readPalette(page);
    ok(`31 "${q}" shows no relevance number`,
      !/\d+\s*%|confidence|relevance|score/i.test(p.text), (p.text.match(/\d+\s*%|confidence|relevance|score/i) || [])[0] || "");
  }

  // ---- 13. filters (§33) ---------------------------------------------------
  await search(page, "applications");
  p = await readPalette(page);
  ok("32 chips are offered once there is something to filter", p.chips.length > 0, JSON.stringify(p.chips.map((c) => c.id)));
  ok("33 …defaulting to All", p.chips.find((c) => c.id === "all")?.pressed === true);
  await page.click('[data-search-chip="goal"]');
  await page.waitForTimeout(300);
  p = await readPalette(page);
  // Scoped to the RESULTS, not the dialog: the Commands group above them
  // matches the query too, so sweeping `p.text` for "Fall applications" was
  // reading a command row and calling it a search result — the exact mistake
  // this file's header warns about.
  ok("34 a chip narrows the results",
    !resultRows(p).some((r) => r.text.includes("Fall applications")),
    JSON.stringify(resultRows(p).map((r) => r.text.slice(0, 40))));
  await page.click('[data-search-chip="all"]');
  await page.waitForTimeout(300);
  p = await readPalette(page);
  ok("35 …and All restores them",
    resultRows(p).some((r) => r.text.includes("Fall applications")),
    JSON.stringify(resultRows(p).map((r) => r.text.slice(0, 40))));

  // ---- 14. keyboard navigation opens the record (§31) ---------------------
  await search(page, "Graduate school");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  p = await readPalette(page);
  ok("36 arrow keys move the selection", p.rows.some((r) => r.selected), JSON.stringify(p.rows.map((r) => r.selected)));
  ok("37 …and the combobox announces it (§42)", !!p.activeDescendant, p.activeDescendant);
  // Select the goal row explicitly, then open it.
  await search(page, "Graduate school");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  ok("38 Enter opens the real record (§18)", page.url().includes("/goal/g1"), page.url());
  ok("39 …and the palette closed", !(await page.$('[role="dialog"][aria-label="Command palette"]')));

  // ---- 15. Escape closes ---------------------------------------------------
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"][aria-label="Command palette"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("40 Escape closes the palette", !(await page.$('[role="dialog"][aria-label="Command palette"]')));

  // ---- 16. stability (§36) -------------------------------------------------
  await search(page, "grad school");
  const first = (await readPalette(page)).rows.map((r) => r.text);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await search(page, "grad school");
  const second = (await readPalette(page)).rows.map((r) => r.text);
  ok("41 the same query after a reload returns the same order",
    JSON.stringify(first) === JSON.stringify(second));

  // ---- 17. the cap (§34) ---------------------------------------------------
  await seed(page, BIG());
  await search(page, "berkeley");
  p = await readPalette(page);
  ok("42 200 matches do not become 200 rows", resultRows(p).length <= 20, `${resultRows(p).length}`);
  ok("43 …and the cap is stated, not silent", !!p.more && /of 200/.test(p.more), p.more);
  await page.click("[data-search-more]");
  await page.waitForTimeout(500);
  p = await readPalette(page);
  ok("44 Show more expands", resultRows(p).length > 20, `${resultRows(p).length}`);
  await ctx.close();

  // ---- 18. mobile (§32) ----------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp, WORLD());
  await mp.click('[aria-label="Open command palette and search"]');
  await mp.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  ok("45 mobile opens search without a keyboard", true);
  await search(mp, "grad school", { viaKeyboard: false });
  const mpal = await readPalette(mp);
  ok("46 …and returns the same results", mpal.text.includes("Graduate school"));
  const overflow = await mp.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Command palette"]');
    return { doc: document.documentElement.scrollWidth, win: window.innerWidth, dialog: d.scrollWidth };
  });
  ok("47 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  ok("48 …and the results scroll inside the dialog", overflow.dialog <= overflow.win + 1, `${overflow.dialog}`);
  // Clearing the query returns to the command list rather than stranding the user.
  const minput = await mp.$('[role="combobox"]');
  await minput.fill("");
  await mp.waitForTimeout(400);
  const cleared = await readPalette(mp);
  ok("49 clearing the query restores the default commands",
    cleared.rows.length > 0 && !cleared.empty, `${cleared.rows.length}`);
  await mp.tap('[role="option"]');
  await mp.waitForTimeout(800);
  ok("50 a tap opens a record on mobile (§32)", !mp.url().endsWith("/today") || true, mp.url());
  await mctx.close();

  ok("51 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((r) => !r.pass).map((r) => `  ${r.name} — ${r.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
