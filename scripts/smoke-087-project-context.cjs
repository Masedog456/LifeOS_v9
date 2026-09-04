#!/usr/bin/env node
/**
 * LIFEOS-087 §38 — browser torture for the project working state.
 *
 * Deterministic tests prove `buildProjectContext`. This proves the PAGE: that
 * what the model refuses to claim the page also refuses to say, that a future
 * follow-up does not read as due on screen, that a completed blocker is never
 * named as holding something up, and that one action never occupies five rows.
 *
 * Every assertion is scoped to `[data-project-working]` — LIFEOS-083 lost an
 * afternoon to a page-wide sweep that matched the onboarding "Skip" button, and
 * this page carries a whole second dashboard underneath.
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

/** The audit's project, in the browser. */
const WORLD = () => ({ ...EMPTY(),
  goals: [goal({ id: "g1", title: "Open the clinic", horizon: "medium",
    history: [{ id: "h1", at: at(-60, 8), kind: "created" },
      { id: "h2", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }] })],
  projects: [
    proj({ id: "pr1", title: "Clinic launch", goalId: "g1", description: "Priya is leading the fit-out.", updatedAt: at(0, 11) }),
    proj({ id: "pr2", title: "Website refresh" }),
  ],
  nextActions: [
    act({ id: "a1", title: "Sign the lease", projectId: "pr1", status: "completed", completedAt: at(-2, 14),
      history: [{ id: "e1", action: "created", at: at(-20) }, { id: "e2", action: "completed", at: at(-2, 14) }] }),
    act({ id: "a2", title: "Pay the deposit", projectId: "pr1", dueDate: dk(-1) }),
    act({ id: "a3", title: "Send final draft", projectId: "pr1" }),
    act({ id: "a4", title: "Need legal review", projectId: "pr1" }),
    // Blocker is COMPLETED — must never read as blocked.
    act({ id: "a5", title: "Order signage", projectId: "pr1" }),
    act({ id: "a6", title: "Confirm branding", projectId: "pr1", status: "completed", completedAt: at(-5, 10) }),
    act({ id: "a7", title: "Transcript from Maria", projectId: "pr1", status: "waiting", waitingOn: "Maria", waitingSince: dk(-9), followUpDate: dk(0) }),
    act({ id: "a8", title: "Signed form", projectId: "pr1", status: "waiting", waitingOn: "Jordan", waitingSince: dk(-2), followUpDate: dk(6) }),
    act({ id: "a9", title: "Email professor", projectId: "pr1",
      history: [{ id: "e5", action: "created", at: at(-20) },
        { id: "e6", action: "deferred", at: at(-3, 10), detail: dk(-2) },
        { id: "e7", action: "deferred", at: at(-2, 10), detail: dk(-1) },
        { id: "e8", action: "deferred", at: at(-1, 10), detail: dk(2) }] }),
    act({ id: "a10", title: "Ask Marcus Webb for the survey", projectId: "pr1" }),
    act({ id: "a11", title: "Reply to Marcus", projectId: "pr1" }),
  ],
  actionDependencies: [
    { id: "d1", blockedId: "a3", blockerId: "a4", createdAt: at(-5) },
    { id: "d2", blockedId: "a5", blockerId: "a6", createdAt: at(-5) },
  ],
  constitutionElements: [{ id: "s1", kind: "standard", status: "active",
    statement: "Never reply to Marcus while angry.", adoptedAt: at(-60), linkedRefs: [], createdAt: at(-60), updatedAt: at(-60) }],
});

/** §28, §29. Words a project view must never say. */
const FORBIDDEN = ["project health", "momentum", "risk score", "on track", "off track",
  "stalled", "at risk", "velocity", "behind schedule", "no progress", "failing", "unhealthy"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}

async function open(page, id) {
  await page.goto(`${BASE}/project/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-project-working]", { timeout: 20000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const root = document.querySelector("[data-project-working]");
    const txt = (el) => (el ? (el.textContent || "").trim() : null);
    const rows = (sel) => [...root.querySelectorAll(sel)].map((e) => ({
      text: (e.textContent || "").trim(),
      href: (e.querySelector("a") || {}).getAttribute?.("href") || "",
      followup: (e.querySelector("[data-followup]") || {}).getAttribute?.("data-followup"),
      buttons: [...e.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
    }));
    return {
      text: (root.textContent || "").trim(),
      sections: [...root.querySelectorAll("[data-project-section]")].map((s) => ({
        id: s.getAttribute("data-project-section"),
        heading: (s.querySelector("h2") || {}).textContent?.trim() ?? "",
        labelled: !!s.getAttribute("aria-labelledby"),
      })),
      next: txt(root.querySelector("[data-project-next]")),
      noNext: txt(root.querySelector("[data-project-nonext]")),
      open: rows("[data-project-open]"),
      blocked: rows("[data-project-blocked]"),
      waiting: rows("[data-project-waiting]"),
      recent: [...root.querySelectorAll("[data-project-recent]")].map((e) => ({
        kind: e.getAttribute("data-project-recent"), text: (e.textContent || "").trim(),
      })),
      noRecent: txt(root.querySelector("[data-project-norecent]")),
      goal: txt(root.querySelector("[data-project-goal]")),
      noGoal: txt(root.querySelector("[data-project-nogoal]")),
      people: [...root.querySelectorAll("[data-project-person]")].map((e) => ({
        name: e.getAttribute("data-project-person"), text: (e.textContent || "").trim(),
        ambiguous: !!e.querySelector("[data-project-person-ambiguous]"),
      })),
      rules: [...root.querySelectorAll("[data-project-rule]")].map((e) => (e.textContent || "").trim()),
      historyLimit: txt(root.querySelector("[data-project-history-limit]")),
      // Every record-bearing row, for the duplication check.
      rowHrefs: [...root.querySelectorAll("li")].filter((li) => !li.querySelector("li"))
        .map((li) => (li.querySelector("a") || {}).getAttribute?.("href") || "")
        .filter((h) => h.startsWith("/actions/")),
      nextHref: (root.querySelector("[data-project-next] a") || {}).getAttribute?.("href") || "",
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page, WORLD());

  let p = await open(page, "pr1");

  // ---- 1. goal and next (§1, §2) ------------------------------------------
  ok("1 the working state renders", !!p);
  ok("2 the linked Goal is visible", p.goal === "Open the clinic", p.goal);
  ok("3 one suggested next action", !!p.next && /Pay the deposit/.test(p.next), (p.next || "").slice(0, 60));
  ok("4 …explaining itself", /Was due|Supports/.test(p.next || ""), (p.next || "").slice(0, 90));
  ok("5 …and offering resolutions rather than acting",
    p.next && /Complete|Defer|Reschedule/.test(p.next));

  // ---- 2. one action, one row (§26) ---------------------------------------
  const dupes = Object.entries(p.rowHrefs.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {}))
    .filter(([, n]) => n > 1);
  ok("6 no action appears twice in the working state", dupes.length === 0, JSON.stringify(dupes));
  ok("7 the recommendation is not repeated under open",
    !p.open.some((r) => r.href === p.nextHref), `${p.nextHref}`);
  ok("8 a waiting action is not also open",
    !p.open.some((r) => /Transcript from Maria|Signed form/.test(r.text)),
    JSON.stringify(p.open.map((r) => r.text.slice(0, 30))));

  // ---- 3. blocked (§10) ----------------------------------------------------
  ok("9 a blocked action is shown once", p.blocked.length === 1, JSON.stringify(p.blocked.map((r) => r.text.slice(0, 40))));
  ok("10 …naming the unfinished blocker", /Need legal review/.test(p.blocked[0]?.text || ""), p.blocked[0]?.text.slice(0, 80));
  ok("11 an action whose blocker is COMPLETED is not blocked",
    !p.blocked.some((r) => /Order signage/.test(r.text)), JSON.stringify(p.blocked.map((r) => r.text.slice(0, 30))));
  ok("12 …and the completed blocker is never named as holding it up",
    !/Blocked by “Confirm branding”/.test(p.text));

  // ---- 4. waiting (§11) ----------------------------------------------------
  ok("13 both waits are shown", p.waiting.length === 2, JSON.stringify(p.waiting.map((r) => r.text.slice(0, 30))));
  const maria = p.waiting.find((r) => /Maria/.test(r.text));
  const jordan = p.waiting.find((r) => /Signed form/.test(r.text));
  ok("14 a follow-up that has arrived reads as due",
    maria?.followup === "due" && /Follow up today/.test(maria?.text || ""), maria?.followup);
  ok("15 a follow-up six days out does NOT read as due",
    jordan?.followup === "future" && !/Follow up today/.test(jordan?.text || ""), jordan?.text.slice(0, 70));
  ok("16 …stating its actual date instead", /Follow up \w{3},/.test(jordan?.text || ""), jordan?.text.slice(0, 70));
  ok("17 a wait says who and since when", /Waiting on Maria since/.test(maria?.text || ""));

  // ---- 5. repeated deferral (§15) -----------------------------------------
  const defRow = p.open.find((r) => /Email professor/.test(r.text));
  ok("18 a repeated deferral attaches a count to its own row",
    /deferred this 3 times/i.test(defRow?.text || ""), defRow?.text.slice(0, 80));
  ok("19 …with no shame language", !/avoid|lazy|failing|discipline/i.test(p.text));
  ok("20 …and it is not a section of its own",
    !p.sections.some((s) => /defer/i.test(s.heading)), JSON.stringify(p.sections.map((s) => s.heading)));

  // ---- 6. recently (§13, §14, §24) ----------------------------------------
  ok("21 a completed linked action is recent movement",
    p.recent.some((r) => /Sign the lease/.test(r.text) && r.kind === "completed"),
    JSON.stringify(p.recent.map((r) => [r.kind, r.text.slice(0, 30)])));
  // Its row above already says "You deferred this 3 times"; a "Deferred" row
  // here would be the same action twice on one screen.
  ok("22 an action that owns a row is not repeated under Recently",
    p.recent.filter((r) => /Email professor/.test(r.text)).length === 0,
    JSON.stringify(p.recent.map((r) => r.text.slice(0, 30))));
  ok("23 a goal horizon change is not project movement",
    !p.recent.some((r) => /Open the clinic/.test(r.text)), JSON.stringify(p.recent.map((r) => r.text.slice(0, 30))));
  ok("24 recent is capped", p.recent.length <= 5, `${p.recent.length}`);
  ok("25 no generic 'project updated' row", !/project updated/i.test(p.text));
  ok("26 the project-history limitation is stated",
    /no history of project changes/i.test(p.historyLimit || ""), p.historyLimit);

  // ---- 7. people (§12, §34) ------------------------------------------------
  const names = p.people.map((x) => x.name);
  ok("27 someone named in waitingOn is involved", names.includes("Maria") && names.includes("Jordan"), JSON.stringify(names));
  ok("28 someone named in an action title is involved", names.includes("Marcus"));
  ok("29 someone named in the project description is involved", names.includes("Priya"));
  ok("30 'Webb' is not a separate person", !names.includes("Webb"), JSON.stringify(names));
  ok("31 Marcus and Marcus Webb are not merged into one group",
    names.filter((n) => n.startsWith("Marcus")).length === 1, JSON.stringify(names));
  ok("32 …and the ambiguity is shown on the row",
    p.people.find((x) => x.name === "Marcus")?.ambiguous === true);
  ok("33 a title's first word is not a person",
    !names.some((n) => ["Email", "Ask", "Reply", "Send", "Order", "Sign"].includes(n)), JSON.stringify(names));

  // ---- 8. Personal Code is context only (§16) -----------------------------
  ok("34 a rule appears only as context, in quotes",
    p.rules.every((r) => /^“|”$/.test(r)) || p.rules.length === 0, JSON.stringify(p.rules));
  ok("35 …and never as a priority or a score", !/priority|rank|score/i.test(p.rules.join(" ")));

  // ---- 9. no score anywhere in the working state (§28) --------------------
  const lower = p.text.toLowerCase();
  const hit = FORBIDDEN.find((w) => lower.includes(w));
  ok("36 the working state says nothing CRM-ish or score-ish", !hit, hit || "");
  ok("37 …and shows no percentage of its own",
    !/\d+\s*%/.test(p.text), (p.text.match(/\d+\s*%/) || [])[0] || "");

  // ---- 10. sections and accessibility (§20, §42) --------------------------
  ok("38 at most five primary sections", p.sections.length <= 5,
    `${p.sections.length}: ${JSON.stringify(p.sections.map((s) => s.heading))}`);
  ok("39 every section has a heading", p.sections.every((s) => s.heading.length > 0));
  ok("40 every section is labelled by its heading", p.sections.every((s) => s.labelled));
  const a11y = await page.evaluate(() => {
    const root = document.querySelector("[data-project-working]");
    return {
      h1: document.querySelectorAll("h1").length,
      buttonsNamed: [...root.querySelectorAll("button")].every((b) => (b.textContent || "").trim().length > 0 || !!b.getAttribute("aria-label")),
    };
  });
  ok("41 exactly one h1 on the page", a11y.h1 === 1, `${a11y.h1}`);
  ok("42 no control is icon-only", a11y.buttonsNamed);

  // ---- 11. a project with nothing (§30, §31) ------------------------------
  p = await open(page, "pr2");
  ok("43 an empty project says so calmly", /No open actions are recorded/.test(p.noNext || ""), p.noNext);
  ok("44 …and never calls it stalled", !/stalled|at risk|failing/i.test(p.text));
  ok("45 a project with no Goal says so factually", p.noGoal === "No Goal linked.", p.noGoal);
  ok("46 …and offers no automatic link", !/auto|suggest.*goal/i.test(p.text));
  // §20. An empty project omits the section entirely rather than printing an
  // empty-state line inside it.
  ok("47 …and omits Recently entirely rather than showing an empty one",
    !p.sections.some((s) => s.id === "recent"), JSON.stringify(p.sections.map((s) => s.id)));

  // ---- 12. stability (§38.16) ---------------------------------------------
  const first = (await open(page, "pr1")).rowHrefs;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const second = (await open(page, "pr1")).rowHrefs;
  ok("48 the same project renders the same order after a reload",
    JSON.stringify(first) === JSON.stringify(second));

  await ctx.close();

  // ---- 13. mobile (§42) ----------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp, WORLD());
  const m = await open(mp, "pr1");
  ok("49 the working state renders on mobile", m.sections.length === 4, `${m.sections.length}`);
  ok("50 …with the same blocked and waiting rows",
    m.blocked.length === 1 && m.waiting.length === 2, `${m.blocked.length}/${m.waiting.length}`);
  const overflow = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("51 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  await mctx.close();

  ok("52 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((r) => !r.pass).map((r) => `  ${r.name} — ${r.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
