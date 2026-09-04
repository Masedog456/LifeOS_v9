#!/usr/bin/env node
/**
 * LIFEOS-086 §40 — browser torture for person context.
 *
 * Deterministic tests prove `buildPersonContext`. This proves the SURFACE: that
 * what the model refuses to claim, the page also refuses to say; that a future
 * follow-up does not read as due on screen; that "You wrote" never lands over a
 * model's sentence; and that the page is usable on a phone.
 *
 * Every assertion is scoped to `[data-person]` — LIFEOS-083 lost an afternoon
 * to a page-wide sweep that matched the onboarding "Skip" button.
 *
 * Run against a dev server: node scripts/smoke-086-people.cjs
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

/** The audit's fixture, in the browser. */
const WORLD = () => ({ ...EMPTY(),
  goals: [goal({ id: "g1", title: "Open the clinic with Priya", horizon: "medium" })],
  projects: [proj({ id: "pr1", title: "Clinic launch", goalId: "g1", description: "Priya is leading the fit-out." })],
  nextActions: [
    act({ id: "a1", title: "Email Marcus the draft lease", dueDate: dk(2) }),
    act({ id: "a2", title: "Call Sarah back about the invoice" }),
    // Waiting, follow-up TODAY. Title names her too, so precedence matters.
    act({ id: "a3", title: "Transcript from Maria", status: "waiting", waitingOn: "Maria", waitingSince: dk(-9), followUpDate: dk(0) }),
    // Waiting, follow-up SIX DAYS OUT — must never read as due.
    act({ id: "a4", title: "Signed form", status: "waiting", waitingOn: "Jordan", waitingSince: dk(-2), followUpDate: dk(6) }),
    act({ id: "a5", title: "Lease copy", status: "waiting", waitingOn: "the letting agency", waitingSince: dk(-4) }),
    act({ id: "a6", title: "Send Marcus the deposit", status: "completed", completedAt: at(-3, 14) }),
    // Names Priya in NOTES only — a mention, not a promise.
    act({ id: "a7", title: "Order the chairs", projectId: "pr1", notes: "Priya asked for the oak ones." }),
    // A SECOND Marcus.
    act({ id: "a8", title: "Ask Marcus Webb for the survey" }),
  ],
  notes: [
    { id: "n1", body: "Alex mentioned the Tuesday seminar is moving rooms.", archived: false, tags: [], linkedEntityRefs: [], createdAt: at(-6, 9), updatedAt: at(-1, 15) },
    // The provenance trap.
    { id: "n2", body: "AI summary: Marcus seems responsive lately.", fromAiText: true, archived: false, tags: [], linkedEntityRefs: [], createdAt: at(-1, 7), updatedAt: at(-1, 7) },
    // Soft-deleted.
    { id: "n3", body: "Old note about Sarah and the zebrafish tiling.", archived: true, tags: [], linkedEntityRefs: [], createdAt: at(-40, 7), updatedAt: at(-40, 7) },
  ],
  reflections: [{ id: "rf1", prompt: "On the clinic", response: "I keep putting off replying to Marcus and I am not sure why.", createdAt: at(-4, 20), annotations: [] }],
});

/** §4, §31, §32 — every word a person view must never say. */
const FORBIDDEN = ["relationship score", "relationship health", "closeness", "trust score",
  "sentiment", "rapport", "engagement score", "lead", "pipeline",
  "you seem", "frustrated with", "friend", "coworker", "colleague", "manager", "family"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}

async function person(page, name) {
  await page.goto(`${BASE}/people/${encodeURIComponent(name)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-person]", { timeout: 20000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const root = document.querySelector("[data-person]");
    const secs = [...root.querySelectorAll("[data-person-section]")];
    return {
      name: root.getAttribute("data-person"),
      text: (root.textContent || "").trim(),
      sections: secs.map((s) => ({ id: s.getAttribute("data-person-section"), heading: (s.querySelector("h2") || {}).textContent?.trim() ?? "" })),
      commitments: [...root.querySelectorAll("[data-person-commitment]")].map((e) => ({
        text: (e.textContent || "").trim(),
        href: (e.querySelector("a") || {}).getAttribute?.("href") || "",
        buttons: [...e.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
      })),
      waiting: [...root.querySelectorAll("[data-person-waiting]")].map((e) => ({
        text: (e.textContent || "").trim(),
        href: (e.querySelector("a") || {}).getAttribute?.("href") || "",
        followup: (e.querySelector("[data-followup]") || {}).getAttribute?.("data-followup"),
      })),
      links: [...root.querySelectorAll("[data-person-link]")].map((e) => ({ kind: e.getAttribute("data-person-link"), text: (e.textContent || "").trim() })),
      mentions: [...root.querySelectorAll("[data-person-mention]")].map((e) => (e.textContent || "").trim()),
      ambiguous: (root.querySelector("[data-person-ambiguous]") || {}).textContent?.trim() ?? null,
      empty: !!root.querySelector("[data-person-empty]"),
      calm: (root.querySelector("[data-person-calm]") || {}).textContent?.trim() ?? null,
      limitation: (root.querySelector("[data-person-limitation]") || {}).textContent?.trim() ?? null,
      h1: (root.querySelector("h1") || {}).textContent?.trim() ?? "",
      // Every record-bearing row, for the duplication check.
      rowHrefs: [...root.querySelectorAll("li")].filter((li) => !li.querySelector("li"))
        .map((li) => (li.querySelector("a") || {}).getAttribute?.("href") || "")
        .filter((h) => h.startsWith("/actions/")),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page, WORLD());

  // ---- 1. open commitments (§12) ------------------------------------------
  let p = await person(page, "Marcus");
  ok("1 the person page renders", !!p && p.h1 === "Marcus", p.h1);
  ok("2 an open action naming them appears under open commitments",
    p.commitments.some((c) => c.text.includes("Email Marcus the draft lease")),
    JSON.stringify(p.commitments.map((c) => c.text.slice(0, 40))));
  ok("3 …and opens the real record", p.commitments[0]?.href.startsWith("/actions/"), p.commitments[0]?.href);
  ok("4 …and offers resolutions rather than acting",
    p.commitments.some((c) => c.buttons.length > 0), JSON.stringify(p.commitments.map((c) => c.buttons)));
  ok("5 a COMPLETED commitment is not shown as owed",
    !p.text.includes("Send Marcus the deposit"), p.text.slice(0, 200));

  // ---- 2. ambiguity (§7, §8, §25) -----------------------------------------
  ok("6 an ambiguous name is flagged", !!p.ambiguous, p.ambiguous);
  ok("7 …naming the other form", (p.ambiguous || "").includes("Marcus Webb"));
  ok("8 …and saying it cannot tell", /cannot tell whether/i.test(p.ambiguous || ""));
  ok("9 …with a way to open the other one", p.text.includes("Open “Marcus Webb”"));

  // ---- 3. provenance (§16, §33) -------------------------------------------
  ok("10 the user's own reflection is shown",
    p.mentions.some((m) => m.includes("putting off replying")), JSON.stringify(p.mentions));
  ok("11 an AI-authored note is NOT shown as a mention",
    !p.text.includes("AI summary"), p.text.slice(0, 200));
  ok("12 …so 'You wrote' never lands over a model's sentence",
    !/You wrote this[^]*seems responsive/i.test(p.text));
  ok("13 mentions say what was written, not what was said",
    /not whether you spoke/i.test(p.text) && !/you last spoke|you talked to/i.test(p.text));

  // ---- 4. waiting (§10, §11, §34, §36) ------------------------------------
  p = await person(page, "Maria");
  ok("14 a wait appears under waiting", p.waiting.length === 1, JSON.stringify(p.waiting.map((w) => w.text.slice(0, 40))));
  ok("15 a follow-up that has arrived reads as due",
    p.waiting[0]?.followup === "due" && /Follow up today/.test(p.waiting[0]?.text || ""), p.waiting[0]?.followup);
  ok("16 …and states when the wait began", /Waiting on Maria since/.test(p.waiting[0]?.text || ""));
  // §36: the record's TITLE names her too, so without precedence it would double.
  ok("17 the same record is not also an open commitment",
    p.commitments.length === 0, JSON.stringify(p.commitments.map((c) => c.text.slice(0, 40))));
  ok("18 …and appears exactly once on the page",
    new Set(p.rowHrefs).size === p.rowHrefs.length, JSON.stringify(p.rowHrefs));

  p = await person(page, "Jordan");
  ok("19 a follow-up six days out does NOT read as due",
    p.waiting[0]?.followup === "future" && !/Follow up today/.test(p.waiting[0]?.text || ""),
    p.waiting[0]?.text.slice(0, 80));
  ok("20 …and states its actual date instead", /Follow up \w{3},/.test(p.waiting[0]?.text || ""), p.waiting[0]?.text.slice(0, 80));

  // ---- 5. projects and goals (§14, §15) -----------------------------------
  p = await person(page, "Priya");
  ok("21 a project whose description names them is shown",
    p.links.some((l) => l.kind === "project" && l.text.includes("Clinic launch")), JSON.stringify(p.links));
  ok("22 a goal whose title names them is shown",
    p.links.some((l) => l.kind === "goal" && l.text.includes("Open the clinic")), JSON.stringify(p.links));
  ok("23 …with the grounding stated", /Named in the (?:project|goal)/.test(p.text));
  // §12 on screen: named in an action's NOTES is a mention, not an obligation.
  ok("24 an action naming them only in its notes is not owed",
    !p.commitments.some((c) => c.text.includes("Order the chairs")),
    JSON.stringify(p.commitments.map((c) => c.text.slice(0, 40))));

  // ---- 6. deleted records (§26) -------------------------------------------
  p = await person(page, "Sarah");
  ok("25 an archived note is never shown", !p.text.includes("zebrafish"), p.text.slice(0, 160));
  ok("26 …while her live action still is", p.commitments.some((c) => c.text.includes("Call Sarah back")));

  // ---- 7. the calm and empty states (§37) ---------------------------------
  p = await person(page, "Alex");
  ok("27 a mention-only person says nothing is open", !!p.calm, p.calm);
  ok("28 …and still shows the mention", p.mentions.length === 1, JSON.stringify(p.mentions));
  ok("29 …and manufactures no follow-up", !/should follow up|reach out|check in/i.test(p.text));

  p = await person(page, "Wilhelmina");
  ok("30 an unknown name is empty, not invented", p.empty === true);
  ok("31 …and says it is about the records", /statement about the records/i.test(p.text));
  ok("32 …and shows no sections at all", p.sections.length === 0, `${p.sections.length}`);

  // ---- 8. not a CRM (§4, §31, §32) ----------------------------------------
  for (const name of ["Marcus", "Maria", "Priya"]) {
    const q = await person(page, name);
    const lower = q.text.toLowerCase();
    const hit = FORBIDDEN.find((w) => lower.includes(w));
    ok(`33 the ${name} page says nothing CRM-ish`, !hit, hit || "");
    ok(`34 …and shows no score or percentage for ${name}`,
      !/\b\d+\s*%|score|rating\b/i.test(q.text), (q.text.match(/\b\d+\s*%|score|rating\b/i) || [])[0] || "");
  }

  // ---- 9. sections and headings (§29, §43) --------------------------------
  p = await person(page, "Marcus");
  ok("35 at most four primary sections", p.sections.length <= 4, `${p.sections.length}: ${JSON.stringify(p.sections.map((s) => s.heading))}`);
  ok("36 every section has a heading", p.sections.every((s) => s.heading.length > 0));
  ok("37 empty sections are omitted", !p.sections.some((s) => s.id === "waiting"), JSON.stringify(p.sections.map((s) => s.id)));
  ok("38 the identity limitation is stated", /no contact records/i.test(p.limitation || ""), p.limitation);
  const a11y = await page.evaluate(() => {
    const root = document.querySelector("[data-person]");
    return {
      h1: root.querySelectorAll("h1").length,
      labelled: [...root.querySelectorAll("[data-person-section]")].every((s) => !!s.getAttribute("aria-labelledby")),
      buttonsNamed: [...root.querySelectorAll("button")].every((b) => (b.textContent || "").trim().length > 0 || !!b.getAttribute("aria-label")),
    };
  });
  ok("39 exactly one h1 (§43)", a11y.h1 === 1, `${a11y.h1}`);
  ok("40 every section is labelled by its heading (§43)", a11y.labelled);
  ok("41 no control is icon-only (§43)", a11y.buttonsNamed);

  // ---- 10. search integration (§18) ---------------------------------------
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 10000 });
  const input = await page.$('[role="combobox"]');
  await input.type("Marcus", { delay: 3 });
  await page.waitForTimeout(500);
  const pal = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Command palette"]');
    return {
      text: (d.textContent || "").trim(),
      rows: [...d.querySelectorAll('[role="option"]')].map((o) => (o.textContent || "").trim()),
    };
  });
  ok("42 searching a name offers a Person row", pal.text.includes("Person"), pal.rows[0]?.slice(0, 60));
  ok("43 …flagging the ambiguity", /also has/.test(pal.text));
  ok("44 …and the related records are still listed", pal.rows.length > 1, `${pal.rows.length}`);
  await page.keyboard.press("Escape");

  // ---- 11. mobile (§32, §43) ----------------------------------------------
  await ctx.close();
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp, WORLD());
  const m = await person(mp, "Marcus");
  ok("45 the person page works on mobile", m.h1 === "Marcus");
  ok("46 …showing the same commitments", m.commitments.length === p.commitments.length,
    `${m.commitments.length} vs ${p.commitments.length}`);
  const overflow = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("47 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  ok("48 …and the ambiguity notice is still readable", !!m.ambiguous);
  await mctx.close();

  ok("49 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((r) => !r.pass).map((r) => `  ${r.name} — ${r.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
