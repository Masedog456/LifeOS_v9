#!/usr/bin/env node
/**
 * LIFEOS-088 §42 — browser torture for the goal command view.
 *
 * Deterministic tests prove `buildGoalContext`. This proves the PAGE: that a
 * goal carried by directly-linked actions is not told it has no path, that no
 * project is drawn at 0% because it has nothing countable, that a future
 * follow-up does not read as due on screen, that a completed blocker is never
 * named as holding something up, and that one action never occupies five rows.
 *
 * Every assertion is scoped to `[data-goal-command]` — LIFEOS-083 lost an
 * afternoon to a page-wide sweep that matched the onboarding "Skip" button, and
 * this page carries a whole knowledge dashboard underneath.
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

/** The audit's goals, in the browser. */
const WORLD = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g1", title: "Open the clinic", description: "A practice of my own by next spring.",
      horizon: "medium", targetDate: dk(120), updatedAt: at(-1, 10),
      history: [{ id: "h1", at: at(-60, 8), kind: "created" },
        { id: "h2", at: at(-30, 9), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
        { id: "h3", at: at(-3, 9), kind: "status", fromStatus: "paused", toStatus: "active" }] }),
    // §14 — no project, two directly-linked actions.
    goal({ id: "g2", title: "Get properly fit", horizon: "long", updatedAt: at(-8, 9),
      history: [{ id: "h4", at: at(-60, 8), kind: "created" }] }),
    // §9 — replaced, successor still exists. updatedAt deliberately differs
    // from the replacement entry.
    goal({ id: "g3", title: "Find a clinic to join", status: "replaced", successorGoalId: "g1",
      horizon: "near", updatedAt: at(-1, 9),
      history: [{ id: "h5", at: at(-90, 8), kind: "created" },
        { id: "h6", at: at(-40, 9), kind: "replaced", fromStatus: "active", toStatus: "replaced", successorGoalId: "g1" }] }),
    // Nothing at all carries this one.
    goal({ id: "g4", title: "Learn the cello", horizon: "life" }),
    // Work, but nothing completed in the window — the empty-state line's case.
    goal({ id: "g5", title: "Rebuild the shed", horizon: "near" }),
  ],
  projects: [
    proj({ id: "pr1", title: "Clinic launch", goalId: "g1", description: "Priya is leading the fit-out.", updatedAt: at(0, 11) }),
    proj({ id: "pr2", title: "Premises search", goalId: "g1", status: "completed", updatedAt: at(-12, 9) }),
    proj({ id: "pr3", title: "Franchise route", goalId: "g1", status: "abandoned", updatedAt: at(-35, 9) }),
    proj({ id: "pr4", title: "Website refresh" }),
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
    act({ id: "a11", title: "Book the accountant", goalId: "g1" }),
    act({ id: "a12", title: "Book a gym induction", goalId: "g2" }),
    act({ id: "a13", title: "Buy running shoes", goalId: "g2", status: "completed", completedAt: at(-4, 9),
      history: [{ id: "e9", action: "created", at: at(-30) }, { id: "e10", action: "completed", at: at(-4, 9) }] }),
    act({ id: "a14", title: "Confirm the fit-out date", projectId: "pr1", goalId: "g1" }),
    // Two blockers, the COMPLETED one recorded first.
    act({ id: "a15", title: "Hand over the keys", projectId: "pr1" }),
    act({ id: "a16", title: "Price the timber", goalId: "g5" }),
  ],
  actionDependencies: [
    { id: "d1", blockedId: "a3", blockerId: "a4", createdAt: at(-5) },
    { id: "d2", blockedId: "a5", blockerId: "a6", createdAt: at(-5) },
    { id: "d3", blockedId: "a15", blockerId: "a6", createdAt: at(-6) },
    { id: "d4", blockedId: "a15", blockerId: "a4", createdAt: at(-5) },
  ],
  constitutionElements: [{ id: "s1", kind: "standard", status: "active",
    statement: "Never pay a deposit without reading the contract twice.", adoptedAt: at(-60), linkedRefs: [], createdAt: at(-60), updatedAt: at(-60) }],
});

/** §5, §38. Words a goal command view must never say. */
const FORBIDDEN = ["goal health", "momentum", "risk score", "on track", "off track",
  "stalled", "at risk", "velocity", "behind schedule", "no progress", "failing", "unhealthy",
  "no path forward", "mission statement", "goal score"];

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function seed(page, world) {
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}

async function open(page, id) {
  await page.goto(`${BASE}/goal/${id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-goal-command]", { timeout: 20000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const root = document.querySelector("[data-goal-command]");
    const txt = (el) => (el ? (el.textContent || "").trim() : null);
    const rows = (sel) => [...root.querySelectorAll(sel)].map((e) => ({
      text: (e.textContent || "").trim(),
      href: (e.querySelector("a") || {}).getAttribute?.("href") || "",
      via: (e.querySelector("[data-goal-via]") || {}).getAttribute?.("data-goal-via"),
      followup: (e.querySelector("[data-followup]") || {}).getAttribute?.("data-followup"),
    }));
    const pathEl = root.querySelector("[data-goal-path]");
    return {
      text: (root.textContent || "").trim(),
      sections: [...root.querySelectorAll("[data-goal-section]")].map((s) => ({
        id: s.getAttribute("data-goal-section"),
        heading: (s.querySelector("h2") || {}).textContent?.trim() ?? "",
        labelled: !!s.getAttribute("aria-labelledby"),
      })),
      horizon: (root.querySelector("[data-goal-horizon-fact]") || {}).getAttribute?.("data-goal-horizon-fact"),
      horizonText: txt(root.querySelector("[data-goal-horizon-fact]")),
      target: (root.querySelector("[data-goal-target]") || {}).getAttribute?.("data-goal-target"),
      targetText: txt(root.querySelector("[data-goal-target]")),
      path: pathEl ? pathEl.getAttribute("data-goal-path") : null,
      pathText: txt(pathEl),
      projects: [...root.querySelectorAll("[data-goal-project]")].map((e) => ({
        status: e.getAttribute("data-goal-project"),
        text: (e.textContent || "").trim(),
        percent: (e.querySelector("[data-goal-project-percent]") || {}).getAttribute?.("data-goal-project-percent"),
        unmeasured: !!e.querySelector("[data-goal-project-unmeasured]"),
      })),
      next: txt(root.querySelector("[data-goal-next]")),
      nextHref: (root.querySelector("[data-goal-next] a") || {}).getAttribute?.("href") || "",
      noNext: txt(root.querySelector("[data-goal-nonext]")),
      support: rows("[data-goal-support]"),
      blocked: rows("[data-goal-blocked]"),
      waiting: rows("[data-goal-waiting]"),
      movement: [...root.querySelectorAll("[data-goal-movement]")].map((e) => ({
        kind: e.getAttribute("data-goal-movement"), text: (e.textContent || "").trim(),
      })),
      noMovement: txt(root.querySelector("[data-goal-nomovement]")),
      direction: [...root.querySelectorAll("[data-goal-direction]")].map((e) => ({
        kind: e.getAttribute("data-goal-direction"), text: (e.textContent || "").trim(),
      })),
      history: [...root.querySelectorAll("[data-goal-history-row]")].map((e) => (e.textContent || "").trim()),
      historyCount: (root.querySelector("[data-goal-history]") || {}).getAttribute?.("data-goal-history"),
      lineage: (root.querySelector("[data-goal-lineage]") || {}).getAttribute?.("data-goal-lineage"),
      replacedOn: (root.querySelector("[data-goal-replaced-on]") || {}).getAttribute?.("data-goal-replaced-on"),
      successorMissing: !!root.querySelector("[data-goal-successor-missing]"),
      people: [...root.querySelectorAll("[data-goal-person]")].map((e) => ({
        name: e.getAttribute("data-goal-person"), text: (e.textContent || "").trim(),
        ambiguous: !!e.querySelector("[data-goal-person-ambiguous]"),
      })),
      rules: [...root.querySelectorAll("[data-goal-rule]")].map((e) => (e.textContent || "").trim()),
      rowHrefs: [...root.querySelectorAll("li")].filter((li) => !li.querySelector("li"))
        .map((li) => (li.querySelector("a") || {}).getAttribute?.("href") || "")
        .filter((h) => h.startsWith("/actions/")),
    };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await seed(page, WORLD());

  let p = await open(page, "g1");

  // ---- 1. where this is headed (§6, §7) -----------------------------------
  ok("1 the command view renders", !!p);
  ok("2 the horizon is shown directly", p.horizon === "medium" && /Medium/.test(p.horizonText || ""), p.horizonText);
  ok("3 …with its guidance, not a deadline", /days to weeks|months|season|heading|become/.test(p.text));
  ok("4 the target date is shown as its own fact", !!p.target && /Target/.test(p.targetText || ""), p.targetText);
  // A goal's target is routinely months or years out, so the year is part of
  // the fact — unlike a due date, where the weekday is what matters.
  ok("4a …with the year, because a goal's target is not a due date",
    /\b20\d\d\b/.test(p.targetText || ""), p.targetText);
  ok("5 …and is never described in terms of the horizon",
    !/(medium|long|life).{0,20}(deadline|due)/i.test(p.text));

  // ---- 2. the path (§13, §14) ---------------------------------------------
  ok("6 a goal with an active project makes no path claim", p.path === null, String(p.pathText));
  ok("7 …and never says 'no path forward' anywhere", !/no path forward/i.test(p.text));

  // ---- 3. no fabricated percentage (§38) ----------------------------------
  const launch = p.projects.find((x) => /Clinic launch/.test(x.text));
  ok("8 a project with nothing countable shows no percentage",
    !!launch && !launch.percent && launch.unmeasured, JSON.stringify(launch));
  ok("9 …but its real counts are stated", /open/.test(launch?.text || "") && /blocked/.test(launch?.text || ""),
    (launch?.text || "").slice(0, 90));
  const premises = p.projects.find((x) => /Premises search/.test(x.text));
  ok("10 a completed project keeps the percentage it earned", premises?.percent === "100", String(premises?.percent));
  ok("11 no 0% appears anywhere in the command view", !/\b0\s*%/.test(p.text), (p.text.match(/\b0\s*%/) || [])[0] || "");

  // ---- 4. next and support (§15, §34) -------------------------------------
  ok("12 one suggested next action", !!p.next && /Pay the deposit/.test(p.next), (p.next || "").slice(0, 60));
  ok("13 …explaining itself in the recommender's words", /Was due|Supports/.test(p.next || ""), (p.next || "").slice(0, 90));
  ok("14 …and offering resolutions rather than acting", /Complete|Defer|Reschedule/.test(p.next || ""));
  const dupes = Object.entries(p.rowHrefs.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {}))
    .filter(([, n]) => n > 1);
  ok("15 no action appears twice in the command view", dupes.length === 0, JSON.stringify(dupes));
  ok("16 the recommendation is not repeated under support",
    !p.support.some((r) => r.href === p.nextHref), p.nextHref);
  ok("17 a waiting action is not also a support row",
    !p.support.some((r) => /Transcript from Maria|Signed form/.test(r.text)),
    JSON.stringify(p.support.map((r) => r.text.slice(0, 30))));

  // ---- 5. how an action reaches the goal (§11) ----------------------------
  const direct = p.support.find((r) => /Book the accountant/.test(r.text));
  const viaProject = p.support.find((r) => /Ask Marcus Webb/.test(r.text));
  ok("18 an action linked straight to the goal says so", direct?.via === "direct", String(direct?.via));
  ok("19 …and an action reached through a project names the project",
    viaProject?.via === "project" && /Clinic launch/.test(viaProject?.text || ""), String(viaProject?.via));
  ok("20 an action linked BOTH ways appears once, as direct",
    p.support.filter((r) => /Confirm the fit-out date/.test(r.text)).length === 1
    && p.support.find((r) => /Confirm the fit-out date/.test(r.text))?.via === "direct");

  // ---- 6. blocked (§20, §22) ----------------------------------------------
  ok("21 the genuinely blocked actions are shown", p.blocked.length === 2,
    JSON.stringify(p.blocked.map((r) => r.text.slice(0, 30))));
  ok("22 …naming the unfinished blocker", p.blocked.every((r) => /Need legal review/.test(r.text)),
    JSON.stringify(p.blocked.map((r) => r.text.slice(0, 60))));
  ok("23 an action whose blocker is COMPLETED is not blocked",
    !p.blocked.some((r) => /Order signage/.test(r.text)));
  ok("24 …and the completed blocker is never named as holding anything up",
    !/Blocked by “Confirm branding”/.test(p.text));
  ok("25 §20 the GOAL is never called blocked, because other work is executable",
    !/this goal is blocked|goal is stuck/i.test(p.text) && !!p.next);

  // ---- 7. waiting (§21) ----------------------------------------------------
  ok("26 both waits are shown", p.waiting.length === 2, JSON.stringify(p.waiting.map((r) => r.text.slice(0, 30))));
  const maria = p.waiting.find((r) => /Maria/.test(r.text));
  const jordan = p.waiting.find((r) => /Signed form/.test(r.text));
  ok("27 a follow-up that has arrived reads as due",
    maria?.followup === "due" && /Follow up today/.test(maria?.text || ""), maria?.followup);
  ok("28 a follow-up six days out does NOT read as due",
    jordan?.followup === "future" && !/Follow up today/.test(jordan?.text || ""), (jordan?.text || "").slice(0, 70));
  ok("29 a wait says who and since when", /Waiting on Maria since/.test(maria?.text || ""));
  // Word boundaries, because "Order signage" contains "nag" and a substring
  // sweep failed on the fixture's own action title rather than on the product.
  const nagHit = (p.text.match(/\btoo long\b|\bchas(?:e|ing)\b|\bnag\w*\b|\boverdue reply\b/i) || [])[0];
  ok("30 …and never says it has gone on too long", !nagHit, nagHit || "");

  // ---- 8. repeated deferral (§19) -----------------------------------------
  const defRow = p.support.find((r) => /Email professor/.test(r.text));
  ok("31 a repeated deferral attaches a count to its own row",
    /deferred this 3 times/i.test(defRow?.text || ""), (defRow?.text || "").slice(0, 80));
  ok("32 …with no shame language", !/avoid|lazy|failing|discipline|procrastin/i.test(p.text));
  ok("33 …and it is not a section of its own",
    !p.sections.some((s) => /defer/i.test(s.heading)), JSON.stringify(p.sections.map((s) => s.heading)));

  // ---- 9. recently (§16, §17, §18, §34) -----------------------------------
  ok("34 a completed linked action is movement",
    p.movement.some((r) => /Sign the lease/.test(r.text) && r.kind === "completed"),
    JSON.stringify(p.movement.map((r) => [r.kind, r.text.slice(0, 30)])));
  ok("35 work under a DIFFERENT goal is not this goal's movement",
    !p.movement.some((r) => /Buy running shoes/.test(r.text)),
    JSON.stringify(p.movement.map((r) => r.text.slice(0, 30))));
  ok("36 §17 the goal's own status change is direction, not movement",
    p.direction.some((r) => r.kind === "goal_status_changed")
    && !p.movement.some((r) => r.kind === "goal_status_changed"),
    JSON.stringify([p.direction.map((r) => r.kind), p.movement.map((r) => r.kind)]));
  ok("37 §34 an action that owns a row is not repeated under Recently",
    !p.movement.some((r) => /Email professor/.test(r.text)),
    JSON.stringify(p.movement.map((r) => r.text.slice(0, 30))));
  ok("38 Recently is capped", p.movement.length <= 5, String(p.movement.length));
  ok("39 no generic 'goal updated' row", !/goal updated/i.test(p.text));

  // ---- 10. lifecycle from history (§8) ------------------------------------
  ok("40 the goal's recorded transitions are shown", p.history.length === 3, String(p.history.length));
  // LIFEOS-078's append-only proof reads the COUNT off the container, so the
  // container has to keep carrying one.
  ok("40a …and the container carries the count that guards append-only",
    p.historyCount === "3", String(p.historyCount));
  ok("41 …stating both ends of a status change",
    p.history.some((h) => /Paused → Active/.test(h)), JSON.stringify(p.history));
  ok("42 …and the horizon change too",
    p.history.some((h) => /Horizon Near → Medium/.test(h)), JSON.stringify(p.history));

  // ---- 11. people and rules (§23, §24) ------------------------------------
  const names = p.people.map((x) => x.name);
  ok("43 someone named in waitingOn is context", names.includes("Maria") && names.includes("Jordan"), JSON.stringify(names));
  ok("44 someone named in an action title is context", names.includes("Marcus"));
  ok("45 'Webb' is not a separate person", !names.includes("Webb"), JSON.stringify(names));
  ok("46 Marcus and Marcus Webb are not merged",
    names.filter((n) => n.startsWith("Marcus")).length === 1, JSON.stringify(names));
  ok("47 …and the ambiguity is shown on the row",
    p.people.find((x) => x.name === "Marcus")?.ambiguous === true);
  ok("48 a title's first word is not a person",
    !names.some((n) => ["Email", "Ask", "Send", "Order", "Sign", "Book", "Hand", "Pay"].includes(n)), JSON.stringify(names));
  ok("49 a rule appears only as context, in quotes",
    p.rules.length > 0 && p.rules.every((r) => /^“|”$/.test(r)), JSON.stringify(p.rules));
  ok("50 …and never as a priority or a score", !/priority|rank|score/i.test(p.rules.join(" ")));

  // ---- 12. sections and no score (§5, §28) --------------------------------
  ok("51 at most five primary sections", p.sections.length <= 5,
    `${p.sections.length}: ${JSON.stringify(p.sections.map((s) => s.heading))}`);
  ok("52 every section has a heading", p.sections.every((s) => s.heading.length > 0));
  ok("53 every section is labelled by its heading", p.sections.every((s) => s.labelled));
  const lower = p.text.toLowerCase();
  const hit = FORBIDDEN.find((w) => lower.includes(w));
  ok("54 the command view says nothing score-ish", !hit, hit || "");
  ok("55 …and writes no mission statement",
    !/you are the kind of person|your purpose|what this goal means/i.test(p.text));

  // ---- 13. §14 — the sprint's headline red, on screen ---------------------
  p = await open(page, "g2");
  ok("56 a goal carried by directly-linked actions has a path", p.path === "actions", String(p.path));
  ok("57 …and is described as carried, not as missing",
    /carried by actions linked directly/.test(p.pathText || ""), p.pathText);
  ok("58 …and is NOT told to add a project", !/Add a project/.test(p.text));
  ok("59 …while the recommender really does name its next step",
    /Book a gym induction/.test(p.next || ""), (p.next || "").slice(0, 60));
  ok("60 …and it says nothing about active projects it does not have",
    !/No active project is linked to this goal/.test(p.text));

  // ---- 14. a goal with nothing carrying it (§13) --------------------------
  p = await open(page, "g4");
  ok("61 a goal with no project and no direct action says both",
    p.path === "none" && /No active project, and no action linked directly/.test(p.pathText || ""), p.pathText);
  ok("62 …and offers a project rather than pronouncing on the goal", /Add a project/.test(p.text));
  // §34. Overview owns the path claim; a second card restating it in different
  // words was the same fact twice on one screen.
  ok("62a …and does not restate it as a second section",
    !p.sections.some((s) => s.id === "next"), JSON.stringify(p.sections.map((s) => s.id)));
  ok("62b …so the fact appears exactly once",
    (p.text.match(/no action linked directly|no action is linked/gi) || []).length === 1,
    JSON.stringify(p.text.match(/no action linked directly|no action is linked/gi)));
  ok("63 …and never calls it stalled or failing", !/stalled|failing|at risk/i.test(p.text));
  ok("64 …and omits Recently entirely rather than showing an empty one",
    !p.sections.some((s) => s.id === "recent"), JSON.stringify(p.sections.map((s) => s.id)));

  // A goal that HAS work but completed none of it in the window is the case
  // where the empty-state line must appear, and say what it checked.
  p = await open(page, "g5");
  ok("64a a goal with work but no completions shows Recently",
    p.sections.some((s) => s.id === "recent"), JSON.stringify(p.sections.map((s) => s.id)));
  ok("64b …saying what it actually checked, not 'no progress'",
    /No linked action or project completed in/.test(p.noMovement || "")
    && !/no progress/i.test(p.text), p.noMovement);

  // ---- 15. replacement (§9) ------------------------------------------------
  p = await open(page, "g3");
  ok("65 the lineage runs oldest first", p.lineage === "2", String(p.lineage));
  ok("66 …naming the successor", /Open the clinic/.test(p.text));
  ok("67 …dated from the history entry, not from updatedAt",
    p.replacedOn === dk(-40), `${p.replacedOn} vs ${dk(-1)}`);
  ok("68 …and printing no id anywhere", !/\bg1\b|\bg3\b/.test(p.text), (p.text.match(/\bg[0-9]\b/) || [])[0] || "");
  ok("69 a replaced goal is not flagged for a missing path", p.path === null, String(p.pathText));

  // ---- 16. accessibility (§46) --------------------------------------------
  const a11y = await page.evaluate(() => {
    const root = document.querySelector("[data-goal-command]");
    return {
      h1: document.querySelectorAll("h1").length,
      buttonsNamed: [...root.querySelectorAll("button")].every((b) => (b.textContent || "").trim().length > 0 || !!b.getAttribute("aria-label")),
      linksNamed: [...root.querySelectorAll("a")].every((a) => (a.textContent || "").trim().length > 0 || !!a.getAttribute("aria-label")),
    };
  });
  ok("70 exactly one h1 on the page", a11y.h1 === 1, String(a11y.h1));
  ok("71 no control is icon-only", a11y.buttonsNamed);
  ok("72 every link has an accessible name", a11y.linksNamed);

  // ---- 17. stability (§42) -------------------------------------------------
  const first = (await open(page, "g1")).rowHrefs;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const second = (await open(page, "g1")).rowHrefs;
  ok("73 the same goal renders the same order after a reload",
    JSON.stringify(first) === JSON.stringify(second));

  await ctx.close();

  // ---- 18. mobile (§42) ----------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on("pageerror", (e) => errors.push(String(e)));
  await seed(mp, WORLD());
  const m = await open(mp, "g1");
  ok("74 the command view renders on mobile", m.sections.length === 5, String(m.sections.length));
  ok("75 …with the same blocked and waiting rows",
    m.blocked.length === 2 && m.waiting.length === 2, `${m.blocked.length}/${m.waiting.length}`);
  const overflow = await mp.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("76 no horizontal overflow at 390px", overflow.doc <= overflow.win + 1, `${overflow.doc} vs ${overflow.win}`);
  await mctx.close();

  ok("77 no page errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTOTAL ${passed}/${results.length}`);
  if (passed !== results.length) {
    console.log("FAILING:\n" + results.filter((r) => !r.pass).map((r) => `  ${r.name} — ${r.detail}`).join("\n"));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
