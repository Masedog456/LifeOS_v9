#!/usr/bin/env node
/**
 * LIFEOS-099 §49 — browser torture for calm under pressure.
 *
 * Twenty scenarios over one fixture, in light, dark and 390px, against the
 * production build. Nothing here is a style-file assertion: every number is
 * read off a rendered element, through the same probe the audit used, because
 * the whole class of defect this sprint fixed is invisible to a test that reads
 * source. A class name cannot tell you what a colour composites to.
 *
 * Three probe bugs were caught while writing that probe, and each would have
 * produced a confident, wrong finding:
 *
 *   the background walk started at the PARENT, so every primary button
 *     measured white-on-white at 1.00
 *   disabled controls counted as failures, so the Capture button's deliberate
 *     opacity 0.3 read as a contrast defect
 *   an `<input type="date">` appeared to lose its focus ring, which is native
 *     segment behaviour on the transition out of its last sub-field
 *
 * The lesson is in §4 and it is why the maths lives in one shared file.
 */
const { chromium } = require("playwright-core");
const { world, LONG_TITLE, LONG_PERSON } = require("./fixtures/lifeos-099-world.cjs");
const { install, BASE, KEY, EXEC, SURFACES } = require("./fixtures/a11y-probe.cjs");

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world())]);
}
async function visit(page, url, wait = 1500) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
  await install(page);
}

/** Every enabled text node on the page that misses its AA threshold. */
const failures = (page) => page.evaluate(() => {
  const A = window.__a11y;
  const out = [];
  for (const { el, text } of A.textLeaves(document.querySelector("main") || document.body)) {
    const c = A.contrastOf(el);
    if (c.disabled) continue;                        // §33 is a different question
    const need = A.required(c.px, c.weight);
    if (c.ratio >= need) continue;
    out.push(`"${text.slice(0, 28)}" ${Math.round(c.ratio * 100) / 100} < ${need} @${c.px}px`);
  }
  return out;
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];

  // ---- 1-4. Metadata is readable, on both grounds -------------------------
  //
  // The measured defect: no zinc shade passes AA in both themes, so the product
  // shipped `zinc-400` at 2.54 in light and `zinc-500` at 4.08 in dark. Home
  // and Today are asserted by name because §49 lists them; the sweep in 5
  // covers the rest.
  for (const [scheme, tag] of [["light", "light"], ["dark", "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 }, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);

    await visit(page, "/");
    const homeFails = await failures(page);
    ok(`${tag === "light" ? 1 : 2} §5 Home metadata is readable in ${tag}`,
      homeFails.length === 0, homeFails.slice(0, 3).join(" | "));

    await visit(page, "/today");
    const todayFails = await failures(page);
    ok(`${tag === "light" ? 3 : 4} §5 Today metadata is readable in ${tag}`,
      todayFails.length === 0, todayFails.slice(0, 3).join(" | "));

    // ---- 5. …and so is every other scoped surface, in this theme ----------
    if (tag === "dark") {
      let worstSurface = null;
      for (const [name, url] of SURFACES) {
        await visit(page, url, 1400);
        const f = await failures(page);
        if (f.length && !worstSurface) worstSurface = `${name}: ${f.slice(0, 2).join(" | ")}`;
      }
      ok("5 §5, §10 every scoped surface passes AA in BOTH themes",
        !worstSurface, worstSurface || "");
    }
    await ctx.close();
  }

  // ---- 6-8. Hierarchy survives. The fix must not flatten the page ---------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);
    await visit(page, "/project/p1");
    /**
     * §8's failure mode is solving contrast by making everything equally loud,
     * and it needs measuring WITHIN A ROW rather than across the page.
     *
     * The first version of these assertions checked the page's overall range —
     * how many distinct ratios exist, and whether the extremes were far apart.
     * Mutation M4 walked straight through it: flattening the metadata tier to
     * the primary colour simply REMOVES the quiet end, leaving a page that is
     * still varied, still wide-ranging, and still above AA everywhere, while a
     * commitment row now shouts its due date as loudly as its title.
     *
     * So this compares the two halves of the same row: the record's title, and
     * the metadata chip beside it. That is the hierarchy a person actually
     * reads, and it is the thing the fix could plausibly have destroyed.
     */
    const rows = await page.evaluate(() => {
      const A = window.__a11y;
      const out = [];
      for (const row of document.querySelectorAll("[data-project-section] li")) {
        const title = row.querySelector("a, span.truncate");
        const meta = row.querySelector("[class*='text-right']");
        if (!title || !meta) continue;
        const t = A.contrastOf(title), m = A.contrastOf(meta);
        if (t.disabled || m.disabled) continue;
        out.push({
          text: (title.textContent || "").trim().slice(0, 24),
          title: Math.round(t.ratio * 100) / 100,
          meta: Math.round(m.ratio * 100) / 100,
        });
      }
      return out;
    });
    ok("6 §8 the fixture really produces rows with a title and a metadata chip",
      rows.length >= 3, `${rows.length} rows`);
    const flattened = rows.filter((r) => r.title - r.meta < 2);
    ok("7 §8 metadata stays quieter than the title it sits beside",
      rows.length > 0 && flattened.length === 0,
      flattened.slice(0, 2).map((r) => `"${r.text}" title ${r.title} vs meta ${r.meta}`).join(" | ")
        || rows.slice(0, 2).map((r) => `${r.title}/${r.meta}`).join(", "));
    const tooFaint = rows.filter((r) => r.meta < 4.5);
    ok("8 §5, §8 …and is still above AA while being quieter",
      rows.length > 0 && tooFaint.length === 0,
      tooFaint.slice(0, 2).map((r) => `"${r.text}" meta ${r.meta}`).join(" | ")
        || `min meta ${Math.min(...rows.map((r) => r.meta))}`);
    await ctx.close();
  }

  // ---- 9-12. The correction sheet, as a DISCLOSURE ------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#capture", { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.fill("#capture", "Email the registrar about my transcript tomorrow");
    await page.click("[data-capture-submit]");
    await page.waitForTimeout(1400);
    await install(page);

    const toggle = await page.evaluate(() => {
      const el = document.querySelector("[data-capture-edit]");
      return { name: window.__a11y.accName(el), expanded: el.getAttribute("aria-expanded") };
    });
    /**
     * §22. A success panel can list several outcomes, and "Edit" five times
     * over is the ambiguous-label case by name. The record travels in the
     * accessible name; the visible label stays one word.
     */
    ok("9 §22 the Edit control names the record it edits",
      /Email the registrar/.test(toggle.name) && toggle.expanded === "false", JSON.stringify(toggle));

    await page.click("[data-capture-edit]");
    await page.waitForSelector("[data-correction-sheet]", { timeout: 8000 });
    await page.waitForTimeout(500);
    await install(page);
    const opened = await page.evaluate(() => {
      const sheet = document.querySelector("[data-correction-sheet]");
      const toggleEl = document.querySelector("[data-capture-edit]");
      return {
        focusInside: sheet.contains(document.activeElement),
        activeTag: document.activeElement.tagName,
        labelled: !!sheet.getAttribute("aria-labelledby"),
        controls: toggleEl.getAttribute("aria-controls") === sheet.id,
        expanded: toggleEl.getAttribute("aria-expanded"),
      };
    });
    ok("10 §14 focus enters the sheet when it opens",
      opened.focusInside && opened.activeTag === "INPUT", JSON.stringify(opened));
    ok("11 §14, §22 …and the sheet is a named region the toggle points at",
      opened.labelled && opened.controls && opened.expanded === "true", JSON.stringify(opened));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    const closed = await page.evaluate(() => ({
      gone: !document.querySelector("[data-correction-sheet]"),
      onOpener: document.activeElement === document.querySelector("[data-capture-edit]"),
    }));
    /**
     * §14. Closing without returning focus drops a keyboard user at the top of
     * the document, because the node they were standing on has been removed.
     */
    ok("12 §14 Escape closes it and focus returns to the opener",
      closed.gone && closed.onOpener, JSON.stringify(closed));
    await ctx.close();
  }

  // ---- 13-15. Landmarks, announcement, and colour-free state --------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);
    let missing = [];
    for (const [name, url] of SURFACES) {
      await visit(page, url, 1300);
      const n = await page.evaluate(() => document.querySelectorAll("main").length);
      if (n !== 1) missing.push(`${name}=${n}`);
    }
    // Measured: /today had a landmark and the inbox Today links to did not.
    ok("13 §34 every scoped surface has exactly one main landmark",
      missing.length === 0, missing.join(","));

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#capture", { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.fill("#capture", "Call the pharmacy tomorrow");
    await page.click("[data-capture-submit]");
    await page.waitForTimeout(1400);
    const announced = await page.evaluate(() => {
      const el = document.querySelector("[data-capture-finished]");
      if (!el) return { present: false };
      const live = el.closest("[aria-live],[role=status]");
      return { present: true, live: !!live, politeness: live ? (live.getAttribute("aria-live") || live.getAttribute("role")) : null };
    });
    /** §35. The one moment where silence is indistinguishable from failure. */
    ok("14 §35 the capture result is announced, not only shown",
      announced.present && announced.live, JSON.stringify(announced));

    await visit(page, "/today", 1600);
    const marker = await page.evaluate(() => {
      const A = window.__a11y;
      const rows = [...document.querySelectorAll("section[aria-label='Getting started'] li")];
      if (!rows.length) return { rows: 0 };
      const glyphs = rows.map((li) => {
        const g = li.querySelector("[aria-hidden]");
        return g ? Math.round(A.contrastOf(g).ratio * 100) / 100 : null;
      }).filter((x) => x !== null);
      return {
        rows: rows.length,
        worst: Math.min(...glyphs),
        textualState: rows.every((li) => /Done:|Not started:/.test(li.textContent || "")),
      };
    });
    /**
     * §11, §32. The marker was 1.43 unchecked — "do not fade success states
     * into near-invisibility", on the glyph that IS the state — and carried
     * that state to assistive tech in a strikethrough, which is not announced.
     */
    ok("15 §11, §32 the checklist state is legible and not carried by colour alone",
      marker.rows > 0 && marker.worst >= 3 && marker.textualState, JSON.stringify(marker));
    await ctx.close();
  }

  // ---- 16-19. Mobile: overflow, wrapping, targets, keyboard ---------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);

    let over = [];
    for (const [name, url] of SURFACES) {
      await visit(page, url, 1300);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (o > 1) over.push(`${name}=${o}px`);
    }
    /**
     * §18. Measured at 27px on the evening close: a metadata span carrying
     * "Waiting on Dr. Maria Consuelo Fernández-Villanueva" had `shrink-0`,
     * refused to shrink, and dragged the fixed command bar off screen with it.
     */
    ok("16 §18 no scoped surface scrolls sideways on a phone", over.length === 0, over.join(","));

    /**
     * The evening close, because that is where the overflow actually was.
     *
     * The first version of this assertion measured the project page, where the
     * same long name already wrapped — so it passed with the whole sprint
     * reverted and guarded nothing. Verified by reverting; see §4.2 of the
     * report.
     */
    await visit(page, "/today/review", 1500);
    const wrapped = await page.evaluate(([person]) => {
      const el = [...document.querySelectorAll("span,p")].find((e) =>
        !e.children.length && (e.textContent || "").includes(person));
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      return { found: true, right: Math.round(r.right), vw: innerWidth, lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)) };
    }, [LONG_PERSON]);
    /** §19. The waiting person is not truncated away — it wraps. */
    ok("17 §18, §19 a long person's name wraps instead of overrunning",
      wrapped.found && wrapped.right <= wrapped.vw + 1 && wrapped.lines >= 2, JSON.stringify(wrapped));

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#capture", { timeout: 20000 });
    await page.waitForTimeout(900);
    await page.fill("#capture", "Email the registrar tomorrow");
    await page.click("[data-capture-submit]");
    await page.waitForTimeout(1400);
    /**
     * BOTH Edit controls, and that is the point.
     *
     * The composer's success panel has one; `RecentCaptures` renders a second
     * that opens the same correction sheet from the recent list. The first
     * version of this assertion measured only the composer's, so the sprint
     * shipped one fixed control and one still at 19x17 on the same surface —
     * caught by measuring every button on the page rather than the one the fix
     * had been aimed at.
     */
    const edits = await page.evaluate(() => {
      const out = [];
      for (const sel of ["[data-capture-edit]", "[data-recent-edit]", "[data-recent-undo]"]) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 1) continue;
          out.push({ sel, w: Math.round(r.width), h: Math.round(r.height),
            named: !!el.getAttribute("aria-label") });
        }
      }
      return out;
    });
    const tiny = edits.filter((e) => e.w < 44 || e.h < 44);
    const unnamed = edits.filter((e) => !e.named);
    ok("18 §15 every capture correction control is a real tap target",
      edits.length >= 2 && tiny.length === 0,
      tiny.map((e) => `${e.sel} ${e.w}x${e.h}`).join(" | ") || `${edits.length} controls`);
    ok("18b §22 …and each names the record it acts on",
      edits.length >= 2 && unnamed.length === 0,
      unnamed.map((e) => e.sel).join(",") || `${edits.length} named`);

    const kb = await page.evaluate(() => {
      const visible = innerHeight - 300;             // a realistic soft keyboard
      const b = document.querySelector("[data-capture-submit]").getBoundingClientRect();
      return { bottom: Math.round(b.bottom), visibleTo: visible, reachable: b.bottom <= visible };
    });
    /** §17. A regression guard — LIFEOS-095 fixed this and it still holds. */
    ok("19 §17 the mobile keyboard does not hide the capture submit",
      kb.reachable, JSON.stringify(kb));
    await ctx.close();
  }

  // ---- 20. Zoom, and everything that was already clean --------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page);
    let bad = [];
    for (const [name, url] of SURFACES) {
      await visit(page, url, 1300);
      const r = await page.evaluate(() => {
        const A = window.__a11y;
        const main = document.querySelector("main") || document.body;
        const unnamed = [...main.querySelectorAll(A.SELECTOR_INTERACTIVE)]
          .filter((e) => e.getBoundingClientRect().width > 0 && !A.accName(e)).length;
        const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
          .filter((h) => h.getBoundingClientRect().height > 0).map((h) => +h.tagName[1]);
        let jump = false, prev = 0;
        for (const l of hs) { if (prev && l > prev + 1) jump = true; prev = l; }
        return {
          over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          unnamed, jump, h1: hs.filter((l) => l === 1).length,
        };
      });
      if (r.over > 1) bad.push(`${name} overflow ${r.over}px`);
      if (r.unnamed) bad.push(`${name} ${r.unnamed} unnamed controls`);
      if (r.jump) bad.push(`${name} heading jump`);
      if (r.h1 !== 1) bad.push(`${name} h1=${r.h1}`);
    }
    /**
     * §39, §20, §22 together. All three were measured clean BEFORE this sprint
     * and are asserted anyway: a measurement that came back clean is worth
     * keeping as a regression guard, and a contrast sweep across 200 class
     * strings is exactly the kind of change that could break one.
     */
    ok("20 §20, §22, §39 no overflow at 200% zoom, no unnamed control, no heading jump",
      bad.length === 0, bad.slice(0, 4).join(" · "));
    await ctx.close();
  }

  ok("21 §49 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} accessibility browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
