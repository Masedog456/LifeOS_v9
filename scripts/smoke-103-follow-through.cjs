#!/usr/bin/env node
/**
 * LIFEOS-103 §50 — capture follow-through, in the browser.
 *
 * Twenty scenarios over the §49 fixture, against the production build.
 *
 * ## What this suite is, given what the audit found
 *
 * Seven of §48's eight candidate reds did not hold, and two of them failed
 * structurally: a Goal commits through the review panel and leaves NO success
 * panel to hang follow-through on, and capture cannot create a Project at all.
 * So thirteen of these assertions are marked GUARD — they pin quiet endings the
 * product already had, and they are the ones that would catch this sprint
 * turning capture into a workflow.
 *
 * The sprint's own are 3, 17, 18 and 20 (the correction-path repair).
 * §52's revert proof says which, rather than this file claiming all twenty.
 */
const { chromium } = require("playwright-core");
const { world } = require("./fixtures/lifeos-103-world.cjs");

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

const store = (p) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world())]);
}

/** Capture on Home; report the panel and whether a suggestion appeared. */
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
    const fin = m.querySelector("[data-capture-finished]");
    const ft = m.querySelector("[data-follow-through]");
    const doBtn = m.querySelector("[data-follow-through-do]");
    return {
      state: fin ? "FINISHED"
        : m.querySelector("[data-change-confirm]") ? "CHANGE"
        : m.querySelector("[data-capture-results]") ? "ASKING" : "OTHER",
      panel: fin ? fin.innerText.replace(/\s+/g, " ").trim() : "",
      lines: fin ? fin.innerText.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      followThrough: !!ft,
      ftText: ft ? ft.innerText.replace(/\s+/g, " ").trim() : "",
      ftKind: doBtn ? doBtn.getAttribute("data-follow-through-do") : null,
      ftLabel: doBtn ? doBtn.getAttribute("aria-label") : null,
      ftCount: m.querySelectorAll("[data-follow-through-do]").length,
    };
  });
}

/**
 * Copy no capture should ever produce (§24, §43, §44, §45).
 * Swept case-insensitively — LIFEOS-102 learned that lesson on a CSS-uppercased
 * lead, and the outcome panel is the same panel.
 */
const BANNED = [
  "research options", "make a plan", "think about next steps", "break this down",
  "you should", "the best thing", "you seem", "stuck", "overwhelmed", "behind",
  "prepare for", "turn this into", "high confidence",
];
const FAKE_NUMBER = /\b\d{1,3}\s?%|\b0\.\d{2}\b/;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  // ============================================ 1-2. §5, §6 quiet endings
  {
    const a = await home(page, "Email the landlord");
    ok("1 GUARD §5 an ordinary Action gets no follow-through — it IS the next move",
      a.state === "FINISHED" && !a.followThrough && a.lines.length <= 4,
      `${a.lines.length} lines: ${JSON.stringify(a.lines)}`);
    const d = await home(page, "Call the dentist Friday");
    ok("2 GUARD §6 a well-formed dated Action gets none either",
      d.state === "FINISHED" && !d.followThrough && /Due Fri/.test(d.panel), d.panel);
  }

  // ============================================ 3. §7 THE SPRINT'S OWN
  {
    const r = await home(page, "I'm waiting on Priya for the quote");
    const s = await store(page);
    const rec = (s.nextActions || []).find((a) => a.sourceCaptureId && a.status === "waiting");
    ok("3 §7 a wait with no follow-up date offers one, naming the record and no more",
      r.state === "FINISHED" && r.followThrough
      && r.ftKind === "ADD_WAIT_FOLLOW_UP"
      && /No follow-up date is set/.test(r.ftText)
      && /Add a follow-up date/.test(r.ftText)
      && r.ftLabel === "Add a follow-up date for Quote from Priya"
      && rec && !rec.followUpDate,
      `${JSON.stringify(r.ftText)} · record followUp=${rec && (rec.followUpDate ?? null)}`);
  }

  // ============================================ 4. §8 the near neighbour
  {
    const r = await home(page, "Waiting on Sam for the keys Friday");
    const s = await store(page);
    const rec = (s.nextActions || []).find((a) => a.sourceCaptureId && a.status === "waiting");
    ok("4 §8 a wait that already has a follow-up date is left alone",
      r.state === "FINISHED" && !r.followThrough && rec && !!rec.followUpDate,
      `followThrough=${r.followThrough} record followUp=${rec && rec.followUpDate} · ${r.panel}`);
  }

  // ============================================ 5-7. §9, §10, §11
  //
  // 6 and 7 say what they MEASURE, which is narrower than "a Note is never
  // taskified". A Note and a Reflection do not auto-finish — they go to their
  // own confirmation — so a suggestion could not render for them whatever this
  // file rendered, and the first draft of these two passed vacuously for that
  // reason. The kind-level rule is asserted where it can actually fail, in
  // `lib/capture/follow-through-selftest.ts` 103.6, which calls the projection
  // with each kind directly and has a control at 103.7.
  {
    const e = await home(page, "Interview Tuesday at 2");
    ok("5 GUARD §9 an Event reaches the panel and is given nothing to prepare",
      e.state === "FINISHED" && !e.followThrough
      && !/prepare/i.test(e.panel), e.panel);

    const n = await home(page, "Maria's number is 555-0142");
    ok("6 GUARD §10 a Note never reaches the success panel at all, so nothing can be added to it",
      n.state === "ASKING" && !n.followThrough, `${n.state} ft=${n.followThrough}`);

    const f = await home(page, "I've been thinking teaching isn't what I want");
    ok("7 GUARD §11 …and neither does a Reflection",
      f.state === "ASKING" && !f.followThrough, `${f.state} ft=${f.followThrough}`);
  }

  // ============================================ 8-10. §12, §13, §37 goals
  //
  // The audit's structural finding: a Goal commits through the review panel and
  // there is NO success panel afterwards. So these assert the honest thing —
  // no capture follow-through anywhere — plus that the existing global
  // resolution is the one that speaks for it (§35).
  {
    const g = await home(page, "I'd like to learn to sail");
    ok("8 §12 a Goal suggestion offers no capture follow-through",
      !g.followThrough && g.state === "ASKING", `${g.state} ft=${g.followThrough}`);

    const confirmed = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"][aria-label^="Include"]');
      if (cb && !cb.checked) cb.click();
      return true;
    });
    await page.waitForTimeout(300);
    await page.click("[data-confirm-all]");
    await page.waitForTimeout(1800);
    const post = await page.evaluate(() => {
      const m = document.querySelector("main");
      return {
        finished: !!m.querySelector("[data-capture-finished]"),
        ft: !!m.querySelector("[data-follow-through]"),
        decisionLink: /Needs your decision/i.test(m.innerText),
      };
    });
    const s = await store(page);
    const made = (s.goals || []).find((x) => x.title === "Learn to sail" && x.id !== "g-nopath");
    ok("9 §12, §29 confirming a Goal creates it and shows no success panel — so there is nowhere to hang one",
      confirmed && !!made && !post.finished && !post.ft,
      `created=${!!made} finished=${post.finished} ft=${post.ft}`);
    ok("10 §35 …and the existing global resolution is what speaks for it",
      post.decisionLink, "Home shows the Decision Inbox link");
  }

  // ============================================ 11-12. §14, §15 projects
  {
    const r = await home(page, "Sort out the Clinic lease");
    const s = await store(page);
    const made = (s.nextActions || []).find((a) => a.sourceCaptureId);
    ok("11 §14 capture cannot create a Project — it links an Action to the existing one",
      r.state === "FINISHED" && !r.followThrough
      && made && made.projectId === "p-empty",
      `projectId=${made && made.projectId} · ${r.panel}`);
    ok("12 §15 …which resolves the empty-project state rather than suggesting about it",
      (s.nextActions || []).filter((a) => a.projectId === "p-empty" && a.status === "open").length >= 1,
      "p-empty now has executable work");
  }

  // ============================================ 13-14. §16, §17
  {
    const b = await home(page, "Install the reception desk");
    ok("13 GUARD §16 blocked work asks rather than finishing, and no workaround is fabricated",
      b.state === "ASKING" && !b.followThrough
      && !BANNED.some((w) => b.panel.toLowerCase().includes(w)),
      `${b.state} ${b.panel}`);
    const r = await home(page, "Pay rent on the first of every month");
    ok("14 GUARD §17 a recurring Action is not told to create more work",
      !r.followThrough && /Every month on the 1st/.test(r.panel), r.panel);
  }

  // ============================================ 15. §19 rules
  {
    const r = await home(page, "I should never reply when I'm angry");
    ok("15 GUARD §19 a Rule is never auto-written, so it never reaches a panel a task could hang on",
      r.state === "ASKING" && !r.followThrough, `${r.state} ft=${r.followThrough}`);
  }

  // ============================================ 16. §20, §27 multi-outcome
  //
  // A capture that AUTO-FINISHES with two outcomes, one of which qualifies. The
  // first draft used "Email Marcus tomorrow and remember the lease expires
  // Friday", which asks rather than finishing — so it proved nothing about
  // per-outcome behaviour, only that the asking panel has no suggestions.
  {
    const mixed = await home(page, "Email Marcus tomorrow and waiting on Priya for the quote");
    ok("16 §20 in a two-outcome capture only the qualifying outcome suggests",
      mixed.state === "FINISHED" && mixed.ftCount === 1
      && /Quote from Priya/.test(mixed.ftLabel ?? ""),
      `state=${mixed.state} count=${mixed.ftCount} label=${JSON.stringify(mixed.ftLabel)}`);

    const both = await home(page, "Waiting on Priya for the quote and waiting on Dana for the form");
    ok("16b §27 two qualifying outcomes give two suggestions — the cap, not a wall",
      both.state === "FINISHED" && both.ftCount === 2,
      `state=${both.state} count=${both.ftCount}`);
  }

  // ============================================ 17-18. §39, §40 THE SPRINT'S
  {
    // correction adds the date → the suggestion goes
    await home(page, "I'm waiting on Priya for the quote");
    await page.click("[data-capture-edit]");
    await page.waitForTimeout(600);
    await page.fill('[data-correction-sheet] input[aria-label="Date"]', "2026-09-19");
    await page.waitForTimeout(150);
    await page.click("[data-correction-save]");
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const m = document.querySelector("main");
      return {
        ft: !!m.querySelector("[data-follow-through]"),
        panel: (m.querySelector("[data-capture-finished]") || {}).innerText?.replace(/\s+/g, " ").trim(),
      };
    });
    const s = await store(page);
    const rec = (s.nextActions || []).find((a) => a.sourceCaptureId);
    ok("17 §39, §23 the correction writes the FOLLOW-UP date, and the suggestion disappears",
      !after.ft && rec.followUpDate === "2026-09-19" && !rec.dueDate
      && /Follow up/.test(after.panel),
      `ft=${after.ft} followUp=${rec.followUpDate} due=${rec.dueDate ?? null} · ${after.panel}`);

    // undo removes the record → the suggestion goes
    await home(page, "I'm waiting on Priya for the quote");
    const had = await page.evaluate(() => !!document.querySelector("[data-follow-through]"));
    await page.click("[data-capture-undo]");
    await page.waitForTimeout(1400);
    const gone = await page.evaluate(() => ({
      ft: !!document.querySelector("[data-follow-through]"),
      finished: !!document.querySelector("[data-capture-finished]"),
    }));
    const s2 = await store(page);
    ok("18 §40 an undo removes the record and the suggestion with it",
      had && !gone.ft && !(s2.nextActions || []).some((a) => a.title === "Quote from Priya"),
      `had=${had} ft=${gone.ft} finished=${gone.finished}`);
  }

  // ============================================ 18b. §32, §46 dismissal
  //
  // Mutation testing put this here. M5 moved the dismissal into localStorage and
  // nothing reddened — the suite never dismissed anything, so it could not
  // notice that a declined suggestion was being written down. §32 says
  // dismissal is ephemeral and §46 says nothing about follow-through is
  // persisted; neither was asserted.
  {
    await home(page, "I'm waiting on Priya for the quote");
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort().join(","));
    await page.click("[data-follow-through-dismiss]");
    await page.waitForTimeout(500);
    const dismissed = await page.evaluate(() => !!document.querySelector("[data-follow-through]"));
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).sort().join(","));

    // A NEW capture of the same shape must offer it again — a dismissal is
    // about this panel, not about this kind of record forever.
    const again = await home(page, "I'm waiting on Dana for the form");
    ok("18b §32, §46 dismissal hides it here, writes nothing down, and the next capture offers it again",
      !dismissed && keysBefore === keysAfter && again.followThrough
      && /Form from Dana/.test(again.ftLabel ?? ""),
      `hidden=${!dismissed} keys unchanged=${keysBefore === keysAfter} next=${again.followThrough} ${JSON.stringify(again.ftLabel)}`);
  }

  // ============================================ 19. §41 parity
  {
    const SENTENCES = [
      "I'm waiting on Priya for the quote",
      "Waiting on Sam for the keys Friday",
      "Email the landlord",
      "Pay rent on the first of every month",
    ];
    const diffs = [];
    for (const text of SENTENCES) {
      const h = await home(page, text);
      await seed(page);
      await page.goto(BASE + "/project/p-live", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1400);
      await page.keyboard.press("Shift+Meta+k");
      await page.waitForSelector('[role="dialog"] #capture', { timeout: 8000 });
      await page.waitForTimeout(250);
      await page.fill('[role="dialog"] #capture', text);
      await page.click('[role="dialog"] [data-capture-submit]');
      await page.waitForTimeout(1600);
      const q = await page.evaluate(`(() => {
        const d = ${FIND};
        if (!d) return { ft: false, ftText: "(no sheet)", panel: "" };
        const fin = d.querySelector("[data-capture-finished]");
        const ft = d.querySelector("[data-follow-through]");
        return {
          ft: !!ft,
          ftText: ft ? ft.innerText.replace(/\\s+/g, " ").trim() : "",
          panel: fin ? fin.innerText.replace(/\\s+/g, " ").trim() : "",
        };
      })()`);
      if (h.followThrough !== q.ft || h.ftText !== q.ftText || h.panel !== q.panel) {
        diffs.push(`${JSON.stringify(text)}\n      home  ft=${h.followThrough} ${JSON.stringify(h.ftText)}\n      sheet ft=${q.ft} ${JSON.stringify(q.ftText)}`);
      }
    }
    ok(`19 §41 Home and Quick Capture behave identically on all ${SENTENCES.length} sentences`,
      diffs.length === 0, diffs.slice(0, 1).join("\n    "));
  }

  // ============================================ 20. §43-§45, §54 mobile
  {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    mp.on("pageerror", (e) => errors.push(String(e)));
    await seed(mp);
    await mp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await mp.waitForSelector("#capture", { timeout: 20000 });
    await mp.waitForTimeout(800);
    await mp.fill("#capture", "I'm waiting on Priya for the quote");
    await mp.click("[data-capture-submit]");
    await mp.waitForTimeout(1600);
    const r = await mp.evaluate(() => {
      const ft = document.querySelector("[data-follow-through]");
      if (!ft) return { missing: true };
      const sizes = [...ft.querySelectorAll("button")].map((b) => {
        const x = b.getBoundingClientRect();
        return { label: b.getAttribute("aria-label"), w: Math.round(x.width), h: Math.round(x.height) };
      });
      return {
        text: ft.innerText.replace(/\s+/g, " ").trim(),
        sizes,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        named: sizes.every((s) => !!s.label),
      };
    });
    const banned = BANNED.filter((w) => (r.text || "").toLowerCase().includes(w));
    ok("20 §43-§45, §54 the suggestion is compact, named, thumb-sized, and free of advice or scores",
      !r.missing && r.named && r.sizes.every((s) => s.h >= 44) && r.overflow <= 1
      && banned.length === 0 && !FAKE_NUMBER.test(r.text) && errors.length === 0,
      `${JSON.stringify(r)} banned=${JSON.stringify(banned)} errors=${errors.slice(0, 1).join("")}`);
    await m.close();
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} follow-through browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
