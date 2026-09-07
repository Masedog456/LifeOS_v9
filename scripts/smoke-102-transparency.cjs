#!/usr/bin/env node
/**
 * LIFEOS-102 §43 — interpretation transparency, in the browser.
 *
 * Twenty scenarios against the production build over the §42 fixture.
 *
 * ## What this suite is, given what the audit found
 *
 * Six of §41's eight candidate reds did not hold: the asking reasons are already
 * plain English, multi-intent already says "I found 2 things:", completion
 * ambiguity already names both records, possible context is already marked
 * POSSIBLE, and the correction sheet already separates the raw quote from the
 * record. That work belongs to LIFEOS-065/066, 089, 095/096 and 097.
 *
 * So most of these assertions are REGRESSION GUARDS on transparency the product
 * already has, and they are labelled as such. Two are the sprint's own:
 *
 *   4     recurrence reaches the panel — a fact that was stored and never shown
 *   17-19 the panel stops asserting a record the person has since corrected
 *
 * The revert proof (§45) says which is which rather than this file claiming
 * credit for all twenty.
 */
const { chromium } = require("playwright-core");
const { world } = require("./fixtures/lifeos-102-world.cjs");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** The LIFEOS-100 sheet, by accessible name. */
const FIND = `(() => {
  const named = (d) => {
    const by = d.getAttribute("aria-labelledby");
    const n = by && document.getElementById(by);
    return (n ? n.textContent : d.getAttribute("aria-label") || "").trim();
  };
  return [...document.querySelectorAll('[role="dialog"]')].find((d) => named(d) === "Quick capture") || null;
})()`;

const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world())]);
}

/** Capture on Home and report the panel plus the whole scoped surface. */
async function home(page, text) {
  await seed(page);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#capture", { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.fill("#capture", text);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(1600);
  return page.evaluate(() => {
    const m = document.querySelector("main");
    const panel = m.querySelector("[data-capture-finished], [data-change-confirm], [data-capture-results], [data-capture-kept]");
    const txt = (n) => (n ? n.innerText.replace(/\s+/g, " ").trim() : "");
    return {
      state: m.querySelector("[data-capture-finished]") ? "FINISHED"
        : m.querySelector("[data-change-confirm]") ? "CHANGE"
        : m.querySelector("[data-capture-results]") ? "ASKING"
        : m.querySelector("[data-capture-kept]") ? "KEPT" : "NONE",
      panel: txt(panel),
      lines: panel ? panel.innerText.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      candidates: [...m.querySelectorAll("[data-candidate]")].map((n) => n.getAttribute("data-candidate")),
      titles: [...m.querySelectorAll('input[aria-label="Title"]')].map((i) => i.value),
      context: txt(m.querySelector("[data-capture-context]")),
      options: [...m.querySelectorAll("[data-change-option]")].map((n) => n.innerText.replace(/\s+/g, " ").trim()),
      ambiguous: txt(m.querySelector("[data-change-ambiguous]")),
      asking: txt(m.querySelector("[data-capture-asking]")),
    };
  });
}

/**
 * Every quoted string on the page — §36's provenance check.
 *
 * Walks TEXT NODES, not elements. The first version skipped any element with
 * children, and the correction sheet's source line is a `<p>` containing two
 * `<span>`s — so it found nothing at all, `every()` was vacuously true, and the
 * assertion that depends on it could not fail. A helper that returns an empty
 * array is not evidence of anything.
 */
const quotes = (page) => page.evaluate(() => {
  const roots = [document.querySelector("main"), document.querySelector('[role="dialog"]')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    // Quotes can span sibling text nodes, so read each block's own text.
    for (const el of root.querySelectorAll("p, li, h1, h2, h3, span, div, button, label")) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 400) continue;
      for (const m of t.matchAll(/[“"]([^”"]{3,})[”"]/g)) {
        if (!out.includes(m[1])) out.push(m[1]);
      }
    }
  }
  return out;
});

/**
 * Words no user should ever be shown (§6, §7, §11, §35).
 *
 * Compared case-INSENSITIVELY, and that is not tidiness. A mutant that printed
 * the authority enum in the outcome lead walked straight through the first
 * version of this sweep: the lead is CSS-uppercased and `innerText` returns
 * rendered text, so the panel said "AUTO_WITH_UNDO" and a lowercase
 * `includes()` found nothing. The one place internals would most likely leak is
 * the one place the product shouts.
 */
const FORBIDDEN = [
  "auto_with_undo", "auto_safe", "never_auto", "suggest_confirm", "unambiguous",
  "candidateMatches", "targetQuery", "authorityFor", "suggestContext", "classifyOne",
  "confidence:", "parser", "regex", "chain of thought",
];

/**
 * §7. A confidence-SHAPED number, rather than a bare "%".
 *
 * The first version listed "%" and would have fired on any legitimate percentage
 * the product might ever show. This matches what §7 actually forbids: a bare
 * score attached to an interpretation.
 */
const FAKE_CONFIDENCE = /\b\d{1,3}\s?%|\b0\.\d{2}\b|\bhigh confidence\b/i;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  // ============================================ 1-2. §9 concise by default
  {
    const r = await home(page, "Email the landlord");
    ok("1 §9 a simple result is concise — the label, the record's name, nothing else",
      r.state === "FINISHED" && /SAVED AS ACTION/.test(r.panel)
      && /Email the landlord/.test(r.panel) && r.lines.length <= 4,
      `${r.lines.length} lines: ${JSON.stringify(r.lines)}`);
    ok("2 §34 …and there is no second panel echoing it",
      !/what i understood/i.test(r.panel) && (r.panel.match(/Email the landlord/g) || []).length === 1,
      r.panel);
  }

  // ============================================ 3-4. §4, §23, §24 the facts
  {
    const d = await home(page, "Call Marcus tomorrow at 2pm");
    ok("3 GUARD §23 date and time use the product's canonical wording, not raw values",
      /Due tomorrow/.test(d.panel) && /2 PM/.test(d.panel) && !/14:00/.test(d.panel), d.panel);

    // THE SPRINT'S OWN. Stored and never shown before LIFEOS-102.
    const cases = [
      ["Run every Monday", "Every Monday"],
      ["Pay the rent on the first of every month", "Every month on the 1st"],
      ["Take the dog out every day", "Every day"],
    ];
    const bad = [];
    for (const [text, phrase] of cases) {
      const r = await home(page, text);
      const s = await store(page);
      const rec = (s.nextActions || []).find((a) => a.sourceCaptureId && a.recurrence);
      if (!rec) { bad.push(`${text}: no recurring record stored`); continue; }
      if (!r.panel.includes(phrase)) bad.push(`${text}: stored ${JSON.stringify(rec.recurrence)} but panel says ${JSON.stringify(r.panel)}`);
    }
    ok("4 §4, §24 a recurring commitment says so, in canonical language",
      bad.length === 0, bad.join(" | "));
  }

  // ============================================ 5. §16 waiting, no wall
  {
    const r = await home(page, "I'm waiting on Ana for the signed lease");
    const anas = (r.panel.match(/Ana/g) || []).length;
    ok("5 GUARD §16 waiting names the person and the thing once, not three times",
      /SAVED AS WAITING/.test(r.panel) && /Signed lease from Ana/.test(r.panel) && anas === 1,
      `"Ana" appears ${anas}× — ${r.panel}`);
  }

  // ============================================ 6. §17 event
  {
    const r = await home(page, "Interview Tuesday at 2");
    ok("6 GUARD §17 an event states its moment and needs no explanation paragraph",
      /SAVED AS EVENT/.test(r.panel) && /2 PM/.test(r.panel) && r.lines.length <= 5,
      r.panel);
  }

  // ============================================ 7. §18 reflection
  {
    const r = await home(page, "I've been thinking teaching isn't what I want");
    ok("7 GUARD §18 a reflection is not given an invented mood, theme or insight",
      !/mood|theme|insight|sentiment|tone/i.test(r.panel), r.panel);
  }

  // ============================================ 8-9. §19, §20 authority
  {
    const g = await home(page, "I'd like to run a marathon");
    ok("8 GUARD §19 a goal is offered as possible and is not claimed as created",
      /POSSIBLE GOAL/i.test(g.panel) && !/saved as goal|goal created/i.test(g.panel)
      && /won't create a goal unless you say so/i.test(g.panel), g.panel.slice(0, 150));

    const s = await home(page, "I should never reply when I'm angry");
    ok("9 GUARD §20, §11 a rule explains its own boundary in human words",
      /Conqify will not create this for you/i.test(s.panel)
      && /Personal Code/i.test(s.panel) && !/never_auto/i.test(s.panel),
      s.panel.slice(0, 160));
  }

  // ============================================ 10. §14 multi-intent
  {
    const r = await home(page, "Email Marcus tomorrow and remember the lease expires Friday");
    ok("10 GUARD §14 two understood things are counted and both are shown",
      /I found 2 things/i.test(r.panel) && r.candidates.length === 2
      && r.titles.some((t) => /Email Marcus/i.test(t)) && r.titles.some((t) => /lease expires/i.test(t)),
      `candidates=${r.candidates.join(",")} titles=${JSON.stringify(r.titles)}`);
  }

  // ============================================ 11-12. §15 completion
  {
    const r = await home(page, "I submitted the application");
    ok("11 GUARD §15 an exact completion names the existing record and does not claim a new one",
      /MARK COMPLETE/i.test(r.panel) && /Submit the application/.test(r.panel)
      && !/saved as action|created/i.test(r.panel), r.panel.slice(0, 140));

    await page.click("[data-change-confirm-btn]");
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => document.querySelector("[data-change-confirm]").innerText.replace(/\s+/g, " ").trim());
    const s = await store(page);
    const target = (s.nextActions || []).find((a) => a.id === "a-apply");
    ok("12 GUARD §15, §38 …and confirming reports the completion, having created nothing",
      /Marked/.test(after) && /Submit the application/.test(after)
      && target.status === "completed" && (s.nextActions || []).length === 8,
      `${JSON.stringify(after)} · status=${target.status} · ${(s.nextActions || []).length} actions`);
  }

  // ============================================ 13. §10, §33 ambiguity
  {
    const r = await home(page, "Finished the recommendation request");
    ok("13 GUARD §10, §33 an ambiguous completion names the actual choices",
      /records match/i.test(r.ambiguous) && /recommendation request/.test(r.ambiguous)
      && r.options.length === 2
      && r.options.some((o) => /Smith/.test(o)) && r.options.some((o) => /Jones/.test(o)),
      `${JSON.stringify(r.ambiguous)} → ${JSON.stringify(r.options)}`);
  }

  // ============================================ 14-15. §21 context certainty
  {
    const exact = await home(page, "Draft the brochure for Clinic launch");
    const s = await store(page);
    const rec = (s.nextActions || []).find((a) => a.sourceCaptureId);
    ok("14 GUARD §21, §38 a committed project is shown, and it is actually stored",
      exact.state === "FINISHED" && /Clinic launch/.test(exact.panel) && rec.projectId === "p1",
      `panel=${exact.panel} projectId=${rec && rec.projectId}`);

    const maybe = await home(page, "Book the venue for the clinic");
    const s2 = await store(page);
    const wrote = (s2.nextActions || []).some((a) => a.sourceCaptureId);
    ok("15 GUARD §21 a possible project is marked possible, names both choices, and links nothing yet",
      /POSSIBLE CONTEXT/i.test(maybe.context) && /Clinic launch/.test(maybe.context)
      && /Clinic lease/.test(maybe.context) && /Nothing is selected/i.test(maybe.context) && !wrote,
      `${JSON.stringify(maybe.context)} wrote=${wrote}`);
  }

  // ============================================ 16. §36 provenance
  {
    const r = await home(page, "Remind me to call the dentist Friday");
    await page.click("[data-capture-edit]");
    await page.waitForTimeout(500);
    const q = await quotes(page);
    const src = await page.evaluate(() => (document.querySelector("[data-correction-source]") || {}).innerText);
    const title = await page.evaluate(() => (document.querySelector('[data-correction-sheet] input[aria-label="Title"]') || {}).value);
    ok("16 GUARD §32, §36 the correction sheet quotes the RAW sentence and shows the cleaned title as a field",
      /You said/.test(src) && src.includes("Remind me to call the dentist Friday")
      && title === "Call the dentist"
      && q.every((x) => x === "Remind me to call the dentist Friday"),
      `quotes=${JSON.stringify(q)} title=${JSON.stringify(title)}`);
    ok("17 GUARD §36 …so a cleaned title is never presented as something the user said",
      !q.includes("Call the dentist"), JSON.stringify(q));
  }

  // ============================================ 18-19. §28 staleness
  //
  // THE SPRINT'S OWN. Before LIFEOS-102 the panel went on naming the
  // pre-correction record, on both fields and both doorways.
  {
    await page.fill('[data-correction-sheet] input[aria-label="Title"]', "Call the orthodontist");
    await page.waitForTimeout(150);
    await page.click("[data-correction-save]");
    await page.waitForTimeout(1400);
    const panel = await page.evaluate(() => document.querySelector("[data-capture-finished]").innerText.replace(/\s+/g, " ").trim());
    const s = await store(page);
    const rec = (s.nextActions || []).find((a) => a.sourceCaptureId);
    ok("18 §28, §38 after a correction the panel names the record that now exists",
      /Call the orthodontist/.test(panel) && !/Call the dentist/.test(panel)
      && rec.title === "Call the orthodontist",
      `panel=${JSON.stringify(panel)} store=${JSON.stringify(rec.title)}`);

    // and the same for a corrected DATE, which is a different field and a
    // different formatter.
    await home(page, "Call the dentist Friday");
    await page.click("[data-capture-edit]");
    await page.waitForTimeout(500);
    await page.fill('[data-correction-sheet] input[aria-label="Date"]', "2026-09-20");
    await page.waitForTimeout(150);
    await page.click("[data-correction-save]");
    await page.waitForTimeout(1400);
    const p2 = await page.evaluate(() => document.querySelector("[data-capture-finished]").innerText.replace(/\s+/g, " ").trim());
    const s2 = await store(page);
    const r2 = (s2.nextActions || []).find((a) => a.sourceCaptureId);
    ok("19 §28 …and a corrected date too, through the same canonical formatter",
      /Sep 20/.test(p2) && !/Sep 11/.test(p2) && r2.dueDate === "2026-09-20",
      `panel=${JSON.stringify(p2)} store=${r2 && r2.dueDate}`);
  }

  // ============================================ 20. §30 parity + hygiene
  {
    const SENTENCES = [
      "Run every Monday",
      "Call Marcus tomorrow at 2pm",
      "I'm waiting on Ana for the signed lease",
      "I'd like to run a marathon",
      "Finished the recommendation request",
      "Book the venue for the clinic",
    ];
    const diffs = [];
    for (const text of SENTENCES) {
      const h = await home(page, text);
      // the same sentence through the LIFEOS-100 sheet, from a Project
      await seed(page);
      await page.goto(BASE + "/project/p1", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1400);
      await page.keyboard.press("Shift+Meta+k");
      await page.waitForSelector('[role="dialog"] #capture', { timeout: 8000 });
      await page.waitForTimeout(250);
      await page.fill('[role="dialog"] #capture', text);
      await page.click('[role="dialog"] [data-capture-submit]');
      await page.waitForTimeout(1600);
      const q = await page.evaluate(`(() => {
        const d = ${FIND};
        if (!d) return { state: "NO SHEET", panel: "" };
        const p = d.querySelector("[data-capture-finished], [data-change-confirm], [data-capture-results], [data-capture-kept]");
        return {
          state: d.querySelector("[data-capture-finished]") ? "FINISHED"
            : d.querySelector("[data-change-confirm]") ? "CHANGE"
            : d.querySelector("[data-capture-results]") ? "ASKING" : "OTHER",
          panel: p ? p.innerText.replace(/\\s+/g, " ").trim() : "",
        };
      })()`);
      if (h.state !== q.state || h.panel !== q.panel) {
        diffs.push(`${JSON.stringify(text)}\n      home  ${h.state} ${JSON.stringify(h.panel)}\n      sheet ${q.state} ${JSON.stringify(q.panel)}`);
      }
    }
    ok(`20 §30 Home and Quick Capture explain all ${SENTENCES.length} sentences identically, and nothing leaked internals`,
      diffs.length === 0 && errors.length === 0,
      diffs.slice(0, 1).join("\n    ") || `errors=${errors.slice(0, 1).join("")}`);
  }

  // ---- §6, §7, §11, §35: a sweep for internal vocabulary anywhere --------
  {
    const leaked = [];
    for (const text of ["Run every Monday", "I'd like to run a marathon",
      "I should never reply when I'm angry", "Finished the recommendation request",
      "Book the venue for the clinic", "Email Marcus tomorrow and remember the lease expires Friday"]) {
      const r = await home(page, text);
      const hay = r.panel.toLowerCase();
      for (const w of FORBIDDEN) if (hay.includes(w.toLowerCase())) leaked.push(`${JSON.stringify(text)} → ${w}`);
      const num = r.panel.match(FAKE_CONFIDENCE);
      if (num) leaked.push(`${JSON.stringify(text)} → confidence-shaped number ${JSON.stringify(num[0])}`);
    }
    // Folded into 20's detail rather than added as a 21st, so §43's count holds.
    if (leaked.length) {
      results[results.length - 1].pass = false;
      console.log(`  FAIL 20 (internal vocabulary leaked) — ${leaked.join(" | ")}`);
    } else {
      console.log(`       …no internal vocabulary in any of the six panels swept`);
    }
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} transparency browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
