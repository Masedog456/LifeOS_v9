#!/usr/bin/env node
/** LIFEOS-083 §2 — measure the current opening experience with realistic data. */
const { chromium } = require("playwright-core");
const fs = require("fs");

const BASE = "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const OUT = process.env.SHOT_DIR || "/tmp/shots083";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p) => ({ description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: at(-9), updatedAt: at(-9), ...p });
const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: at(-30), updatedAt: at(-30), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: at(-30), updatedAt: at(-30), ...p });

/** A realistic dense day. */
const DENSE = () => ({ ...EMPTY(),
  goals: [
    goal({ id: "g1", title: "Graduate school", horizon: "medium",
      history: [{ id: "h1", at: at(-30, 8), kind: "created" }, { id: "h2", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" }] }),
    goal({ id: "g2", title: "Run a marathon", horizon: "long" }),
  ],
  projects: [proj({ id: "pr1", title: "Fall applications", goalId: "g1" })],
  events: [{ id: "ev1", title: "Advisor meeting", date: dk(0), startTime: "09:00", allDay: false, createdAt: at(-5), updatedAt: at(-5) }],
  nextActions: [
    act({ id: "a1", title: "Submit UH application", dueDate: dk(-2), projectId: "pr1" }),
    act({ id: "a2", title: "Draft statement of purpose", dueDate: dk(0), projectId: "pr1" }),
    act({ id: "a3", title: "Request recommendation letter",
      history: [{ id: "e1", action: "created", at: at(-9) },
        { id: "e2", action: "deferred", at: at(-6, 10), detail: dk(-4) },
        { id: "e3", action: "deferred", at: at(-4, 10), detail: dk(-2) },
        { id: "e4", action: "deferred", at: at(-2, 10), detail: dk(3) }] }),
    act({ id: "a4", title: "Transcript from registrar", status: "waiting", waitingOn: "the registrar", waitingSince: dk(-9), followUpDate: dk(0) }),
    act({ id: "a5", title: "Reply from Maria", status: "waiting", waitingOn: "Maria", waitingSince: dk(-3), followUpDate: dk(5) }),
    act({ id: "a6", title: "Book flights", dueDate: dk(0) }),
    act({ id: "a7", title: "Confirm conference dates" }),
    act({ id: "a8", title: "Buy running shoes", status: "completed", completedAt: at(-1, 15),
      history: [{ id: "e5", action: "created", at: at(-3) }, { id: "e6", action: "completed", at: at(-1, 15) }] }),
  ],
  actionDependencies: [{ id: "d1", blockedId: "a6", blockerId: "a7", createdAt: at(-5) }],
  constitutionElements: [
    { id: "s1", kind: "standard", status: "active", statement: "Finish every application I start.", adoptedAt: at(-30), linkedRefs: [], createdAt: at(-30), updatedAt: at(-30) },
    { id: "s2", kind: "standard", status: "retired", statement: "Never work late at night.", adoptedAt: at(-30), retiredAt: at(-1, 11), linkedRefs: [], createdAt: at(-30), updatedAt: at(-1, 11) },
  ],
  constitutionRevisions: [{ id: "r1", elementId: "s2", changeKind: "retired", at: at(-1, 11) }],
});

/** A genuinely calm day: one thing, nothing urgent. */
const CALM = () => ({ ...EMPTY(),
  nextActions: [act({ id: "c1", title: "Water the plants", dueDate: dk(4) })],
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const [label, world] of [["dense", DENSE()], ["calm", CALM()]]) {
    for (const vp of [{ n: "desktop", w: 1280, h: 1000 }, { n: "mobile", w: 390, h: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.n === "mobile", hasTouch: vp.n === "mobile" });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
      await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
      await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      const m = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll("h2")).map((h) => (h.textContent || "").trim()).filter(Boolean);
        const docH = document.documentElement.scrollHeight;
        // What is visible WITHOUT scrolling?
        const vh = window.innerHeight;
        const visible = Array.from(document.querySelectorAll("h2")).filter((h) => {
          const r = h.getBoundingClientRect();
          return r.top >= 0 && r.top < vh;
        }).map((h) => (h.textContent || "").trim());
        return { heads, docH, vh, screens: +(docH / vh).toFixed(1), visible };
      });
      console.log(`\n### ${label} / ${vp.n}`);
      console.log(`  sections (${m.heads.length}): ${JSON.stringify(m.heads)}`);
      console.log(`  page height ${m.docH}px = ${m.screens} screens of ${m.vh}px`);
      console.log(`  above the fold: ${JSON.stringify(m.visible)}`);
      await page.screenshot({ path: `${OUT}/${label}-${vp.n}.png`, fullPage: false });
      await page.screenshot({ path: `${OUT}/${label}-${vp.n}-full.png`, fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\nscreenshots → ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
