#!/usr/bin/env node
/**
 * LIFEOS-100 §52 — browser torture for capture from anywhere.
 *
 * Twenty-eight scenarios over one fixture, against the production build.
 *
 * The audit (§2) found that reachability was never the defect: LIFEOS-027 had
 * already put a shortcut, a mobile button, two palette commands, a single
 * overlay guard, focus restore and route preservation in the shell, and eight of
 * §50's ten reds do not hold. What it found instead was that the global doorway
 * opened a SECOND capture implementation — one that called `addCapture` and
 * stopped. So the assertions below divide in three:
 *
 *   1-7    the doorway still opens from everywhere        (regression guard)
 *   8-20   it now opens the ONE system, provably the same (the fix)
 *   21-28  and it did not acquire a page's context on the way in
 *
 * The third group is the one that matters most and it is easy to get wrong. A
 * test that asserts "capturing from a Project does not set projectId" passes
 * trivially against a product where context never works at all. So 21 is a
 * CONTROL and comes first: the same sheet, from the same Project, with the
 * project NAMED in the sentence, must link. Without it 22-26 prove nothing.
 */
const { chromium } = require("playwright-core");
const { world, ROUTES } = require("./fixtures/lifeos-100-world.cjs");
const { install } = require("./fixtures/a11y-probe.cjs");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * The quick-capture overlay, located by what a PERSON would use to find it —
 * the dialog whose accessible name is "Quick capture" — and driven through its
 * first textarea and whichever control commits it.
 *
 * Deliberately not `[aria-labelledby="quick-capture-heading"] #capture`, which
 * is this implementation's own markup. §54 asks the suite to be run against the
 * reverted product, and against a selector like that it cannot type into the old
 * overlay at all: every assertion dies on a timeout, and a crash is not a caught
 * defect. Located this way the suite drives whichever overlay the shortcut
 * actually produced, so the reverted run fails on BEHAVIOUR — different records,
 * different words — which is the thing being claimed.
 *
 * Assertions 18 and 19 still pin the specific structure. That is their job.
 */
const FIND = `(() => {
  const named = (d) => {
    const by = d.getAttribute("aria-labelledby");
    const n = by && document.getElementById(by);
    return (n ? n.textContent : d.getAttribute("aria-label") || "").trim();
  };
  return [...document.querySelectorAll('[role="dialog"]')].find((d) => named(d) === "Quick capture") || null;
})()`;

/** A Playwright-side handle to the sheet's textarea, or null. */
const sheetInput = (page) => page.evaluateHandle(`(() => {
  const d = ${FIND};
  return d ? d.querySelector("textarea") : null;
})()`).then((h) => h.asElement());

const sheetOpen = (page) => page.evaluate(`!!${FIND}`);

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world())]);
}
async function visit(page, url, wait = 1500) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

/**
 * Open the sheet with the global shortcut. Returns whether it appeared.
 *
 * Never throws: a scenario that cannot open the sheet must record a FAILED
 * assertion, not take the process down before the other twenty-seven have run.
 */
async function openSheet(page, timeout = 5000) {
  await page.keyboard.press("Shift+Meta+k");
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await sheetOpen(page)) { await page.waitForTimeout(250); return true; }
    await page.waitForTimeout(150);
  }
  return false;
}

/** Type a sentence into the OPEN sheet and press whatever commits it. */
async function captureInSheet(page, sentence) {
  const input = await sheetInput(page);
  if (!input) return false;
  await input.fill(sentence);
  await page.waitForTimeout(200);
  const clicked = await page.evaluate(`(() => {
    const d = ${FIND};
    if (!d) return false;
    const b = d.querySelector("[data-capture-submit]") ||
      [...d.querySelectorAll("button")].find((x) => /^(capture|save)\\b/i.test(x.textContent.trim()));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await page.waitForTimeout(1700);
  return clicked;
}

/** What the sheet is showing right now. */
const sheetState = (page) => page.evaluate(`(() => {
  const d = ${FIND};
  if (!d) return { open: false, text: "", saved: [] };
  return {
    open: true,
    asking: !!d.querySelector("[data-capture-results]"),
    finished: !!d.querySelector("[data-capture-finished]"),
    kept: !!d.querySelector("[data-capture-kept]"),
    saved: [...d.querySelectorAll("[data-capture-saved]")].map((n) => n.getAttribute("data-capture-saved")),
    edits: d.querySelectorAll("[data-capture-edit]").length,
    undo: !!d.querySelector("[data-capture-undo]"),
    text: d.innerText,
  };
})()`);

/** Drive either doorway's composer with the same sentence. */
async function captureInSheet_or_home(page, sentence, inSheet) {
  if (inSheet) return captureInSheet(page, sentence);
  await page.fill("#capture", sentence);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(1700);
  return true;
}

/** New records of every kind this capture could have produced. */
function delta(before, after) {
  const fresh = (dom) => (after[dom] || []).filter((r) => !(before[dom] || []).some((x) => x.id === r.id));
  return {
    actions: fresh("nextActions"), notes: fresh("notes"), captures: fresh("captures"),
    events: fresh("events"), reflections: fresh("reflections"), decisions: fresh("decisions"),
    goals: fresh("goals"), projects: fresh("projects"),
  };
}

/** Seed, go to a route, open the sheet, capture, and report both sides. */
async function run(page, route, sentence) {
  await seed(page);
  await visit(page, route);
  const before = await store(page);
  await openSheet(page);
  await captureInSheet(page, sentence);
  const after = await store(page);
  return { d: delta(before, after), sheet: await sheetState(page), url: page.url(), after };
}

const SENTENCE = "Email Marcus about the lease tomorrow";

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  // ======================================================================
  // 1-7. The doorway, from everywhere (§4, §7, §11, §34, §36)
  // ======================================================================
  //
  // All seven were already true before this sprint and are asserted anyway.
  // The change replaces the overlay's entire body, which is exactly the kind of
  // edit that can take the shell down with it.
  {
    await seed(page);
    const bad = [], moved = [];
    for (const [name, url] of ROUTES) {
      await visit(page, url);
      const wasAt = page.url();
      if (!(await openSheet(page))) { bad.push(`${name} did not open`); moved.push(`${name} n/a`); continue; }
      const r = await page.evaluate(`(() => {
        const d = ${FIND};
        const ta = d && d.querySelector("textarea");
        return {
          focused: !!(d && document.activeElement && d.contains(document.activeElement)),
          onInput: !!(ta && document.activeElement === ta),
          empty: !!ta && ta.value === "",
        };
      })()`);
      if (!r.focused) bad.push(`${name} focus outside sheet`);
      if (!r.onInput) bad.push(`${name} focus not on the input`);
      if (!r.empty) bad.push(`${name} opened non-empty`);
      // §34 is measured on its own list, not read out of `bad`. Sharing one
      // list would let 2 pass by accident on a run where the sheet never
      // opened at all — nothing can change the URL if nothing happened.
      if (page.url() !== wasAt) moved.push(`${name} → ${page.url()}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
    ok("1 §7, §29 the shortcut opens a focused, empty capture input from all 8 scoped routes",
      bad.length === 0, bad.slice(0, 3).join(" · "));
    ok("2 §34 opening the sheet changes no URL on any of the 8 routes",
      moved.length === 0, moved.slice(0, 3).join(" · "));
  }

  // 3. §36. It is shell-level, not a page feature: it opens on routes that have
  //    no capture surface of their own.
  {
    await visit(page, "/project/p1");
    const inline = await page.evaluate(() => !!document.querySelector("#capture"));
    await openSheet(page);
    const nowHas = await page.evaluate(`(() => { const d = ${FIND}; return !!(d && d.querySelector("textarea")); })()`);
    ok("3 §36 the sheet is shell-level — /project/p1 has no capture input until it opens",
      inline === false && nowHas === true, `inline=${inline} in-sheet=${nowHas}`);
    await page.keyboard.press("Escape");
  }

  // 4. §5, §8. The palette's Capture command lands in the same one sheet.
  {
    await visit(page, "/goal/g1");
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(600);
    await page.keyboard.type("quick capture");
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    const r = await page.evaluate(`(() => {
      const d = ${FIND};
      return {
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        isSheet: !!d,
        onInput: !!(d && document.activeElement === d.querySelector("textarea")),
      };
    })()`);
    ok("4 §5, §8 the palette hands off to exactly one sheet, focused",
      r.dialogs === 1 && r.isSheet && r.onInput, JSON.stringify(r));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // 5. §28, §29. Escape closes it and focus goes back where it came from.
  {
    await visit(page, "/today");
    await page.evaluate(() => {
      const el = document.querySelector("main a, main button");
      el.id = "lifeos-100-opener"; el.focus();
    });
    await openSheet(page);
    const ta5 = await sheetInput(page);
    if (ta5) await ta5.fill("half a thought");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const r = await page.evaluate(`(() => ({
      closed: !${FIND},
      focus: document.activeElement && document.activeElement.id,
    }))()`);

    // The other way out, which nothing else covers: click the backdrop.
    await openSheet(page);
    await page.mouse.click(20, 20);
    await page.waitForTimeout(400);
    const clickOut = await page.evaluate(`!${FIND}`);

    ok("5 §28, §29 Escape and a backdrop click both close the sheet, and focus returns to the opener",
      r.closed && r.focus === "lifeos-100-opener" && clickOut,
      JSON.stringify({ ...r, clickOut }));
  }

  // 6. §26. Nothing survives the close — no draft, no new storage key.
  {
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort().join(","));
    await openSheet(page);
    const reopened = await page.evaluate(`(() => { const d = ${FIND}; const t = d && d.querySelector("textarea"); return t ? t.value : "(no sheet)"; })()`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).sort().join(","));
    ok("6 §26 the sheet persists nothing — abandoned text is gone and no key is written",
      reopened === "" && keysBefore === keysAfter, `reopened=${JSON.stringify(reopened)} keys=${keysAfter}`);
  }

  // 7. §6, §32. The mobile command bar's control, at a real touch size.
  {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    mp.on("pageerror", (e) => errors.push(String(e)));
    await seed(mp);
    await visit(mp, "/today");
    const btn = await mp.evaluate(() => {
      const el = [...document.querySelectorAll("button")]
        .find((b) => /quick capture/i.test(b.getAttribute("aria-label") || ""));
      if (!el) return { present: false };
      const r = el.getBoundingClientRect();
      return { present: true, w: Math.round(r.width), h: Math.round(r.height) };
    });
    await mp.click('button[aria-label="Quick capture"]');
    await mp.waitForTimeout(700);
    const opened = await mp.evaluate(`(() => {
      const d = ${FIND};
      if (!d) return { open: false, closeW: 0, closeH: 0 };
      const c = [...d.querySelectorAll("button")].find((b) => /close/i.test(b.getAttribute("aria-label") || ""));
      if (!c) return { open: true, closeW: 0, closeH: 0, noClose: true };
      const r = c.getBoundingClientRect();
      return { open: true, closeW: Math.round(r.width), closeH: Math.round(r.height) };
    })()`);
    ok("7 §6, §32 the mobile bar opens the same sheet, and both controls are ≥44px",
      btn.present && btn.w >= 44 && btn.h >= 44 && opened.open && opened.closeW >= 44 && opened.closeH >= 44,
      `${JSON.stringify(btn)} ${JSON.stringify(opened)}`);
    await m.close();
  }

  // ======================================================================
  // 8-14. It opens the ONE capture system (§3, §10, §18, §19, §21, §24)
  // ======================================================================

  // 8, 9, 10. The measurement that named this sprint: the same sentence through
  //    both doorways. Before the change the sheet produced captures 1→2,
  //    actions 5→5, unprocessed 0→1 and said "It can become a belief in the
  //    Inbox." Home produced the action and named it back.
  {
    // Home's composer
    await seed(page);
    await visit(page, "/");
    const hb = await store(page);
    await page.fill("#capture", SENTENCE);
    await page.click("[data-capture-submit]");
    await page.waitForTimeout(1700);
    const home = delta(hb, await store(page));
    const homeText = await page.evaluate(() =>
      document.querySelector("[data-capture-finished]").innerText.trim());

    // the sheet, from a route that is not Home
    const g = await run(page, "/project/p1", SENTENCE);
    const sheetText = await page.evaluate(`(() => {
      const d = ${FIND};
      const f = d && d.querySelector("[data-capture-finished]");
      return f ? f.innerText.trim() : (d ? "(no success panel) " + d.innerText.trim() : "(no sheet)");
    })()`);

    const shape = (d) => JSON.stringify({
      actions: d.actions.map((a) => ({ t: a.title, due: a.dueDate ?? null, s: a.status })),
      captures: d.captures.map((c) => ({ t: c.text, s: c.processingStatus })),
      notes: d.notes.length,
    });
    ok("8 §3, §10 the same sentence writes the same records through both doorways",
      shape(home) === shape(g.d), `home=${shape(home)} sheet=${shape(g.d)}`);
    /**
     * The success panels are compared whole, character for character, rather
     * than probed for keywords. Before the change the sheet said "✓ Captured.
     * It will appear on the Capture page and can become a belief in the Inbox."
     * where Home said "SAVED AS ACTION / Email Marcus about the lease / Due
     * tomorrow" — a keyword test would have needed to know in advance which
     * words to look for, and the point is that neither panel gets to have any
     * of its own.
     */
    ok("9 §21, §60 and the success panel is the same panel, word for word",
      sheetText === homeText && sheetText.startsWith("SAVED AS ACTION"),
      sheetText === homeText ? sheetText.split("\n").join(" | ")
        : `home=${JSON.stringify(homeText)} sheet=${JSON.stringify(sheetText)}`);
    ok("10 §18 the raw source is preserved identically, and marked processed",
      g.d.captures.length === 1 && g.d.captures[0].text === SENTENCE &&
      g.d.captures[0].processingStatus === "processed",
      JSON.stringify(g.d.captures.map((c) => [c.text, c.processingStatus])));
    ok("11 §11 the person is still on /project/p1 afterwards",
      g.url.endsWith("/project/p1"), g.url);
  }

  // 12. §19. 095's auto-finish applies inside the sheet — a clear capture does
  //     not stop to ask.
  {
    const g = await run(page, "/today", SENTENCE);
    ok("12 §19 a capture Conqify is sure about finishes without asking, in the sheet",
      g.sheet.finished && !g.sheet.asking && g.sheet.saved.join() === "action",
      JSON.stringify({ finished: g.sheet.finished, asking: g.sheet.asking, saved: g.sheet.saved }));
  }

  // 13. §20. And one it is NOT sure about still asks — the open wait on Maria.
  //     The asking state stays inside the sheet; it does not spill onto a page
  //     or send the person to Home to finish.
  {
    const g = await run(page, "/project/p1", "Waiting on Maria for the transcript");
    ok("13 §20 an uncertain capture asks inside the sheet and writes nothing yet",
      g.sheet.open && g.sheet.asking && !g.sheet.finished &&
      g.d.actions.length === 0 && g.d.captures.length === 0 && g.d.notes.length === 0,
      JSON.stringify({ asking: g.sheet.asking, wrote: g.d.actions.length + g.d.captures.length }));
    ok("14 §20 and it says why, naming the record it may already have",
      /already have this/i.test(g.sheet.text) && /Transcript from Maria/.test(g.sheet.text),
      g.sheet.text.split("\n").filter(Boolean).slice(3, 8).join(" | "));
  }

  // 15. §24. Two commitments in one sentence are named as two, truthfully.
  {
    const g = await run(page, "/goal/g1", "Call the plumber and email the landlord about the boiler");
    const titles = g.d.actions.map((a) => a.title).sort();
    ok("15 §24 a two-part capture reports both outcomes and creates exactly two",
      g.sheet.saved.length === 2 && g.d.actions.length === 2 &&
      titles.join(" / ") === "Call the plumber / Email the landlord about the boiler",
      `${g.sheet.saved.join()} → ${titles.join(" / ")}`);
  }

  // 16, 17. §22, §23. The 097 correction sheet and the undo, both inside the
  //     overlay and both owned by the composer — not reimplemented here.
  {
    await seed(page);
    await visit(page, "/actions");
    await openSheet(page);
    await captureInSheet(page, SENTENCE);
    await page.evaluate(`(() => { const d = ${FIND}; const b = d && d.querySelector("[data-capture-edit]"); if (b) b.click(); })()`);
    await page.waitForTimeout(500);
    const corr = await page.evaluate(`(() => {
      const d = ${FIND};
      const btn = d && d.querySelector("[data-capture-edit]");
      if (!btn) return { expanded: "(no Edit control)", inSheet: false };
      const id = btn.getAttribute("aria-controls");
      return {
        expanded: btn.getAttribute("aria-expanded"),
        inSheet: !!(id && d.querySelector("#" + CSS.escape(id))),
      };
    })()`);
    /**
     * §28. And Escape unwinds it one layer at a time.
     *
     * Mutation testing put this here. Removing QuickCapture's own Escape
     * handler changed nothing — `CommandCenter` listens on `window` and
     * `CorrectionSheet` calls `stopPropagation`, so the nesting is produced by
     * two files this sprint did not touch and nothing was pinning it.
     */
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    const layer1 = await page.evaluate(`(() => {
      const d = ${FIND};
      return {
        dialog: !!d,
        sheet: !!(d && d.querySelector("[data-correction-sheet]")),
        focus: document.activeElement && document.activeElement.getAttribute("aria-label"),
      };
    })()`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
    const layer2 = await page.evaluate(`!${FIND}`);

    ok("16 §22, §28 the 097 correction sheet opens inside the overlay, and Escape unwinds one layer at a time",
      corr.expanded === "true" && corr.inSheet &&
      layer1.dialog && !layer1.sheet && /^Edit /.test(layer1.focus || "") && layer2,
      JSON.stringify({ ...corr, layer1, closedOn2nd: layer2 }));

  }

  // 17. §23. Undo, on a capture of its own — 16 left one committed and a shared
  //     `before` snapshot would credit this assertion with reversing it too.
  {
    await seed(page);
    await visit(page, "/actions");
    const before = await store(page);
    await openSheet(page);

    await captureInSheet(page, "Order the banner on Thursday");
    const committed = delta(before, await store(page));
    const undoable = await page.evaluate(`(() => { const d = ${FIND}; const b = d && d.querySelector("[data-capture-undo]"); if (!b) return false; b.click(); return true; })()`);
    await page.waitForTimeout(900);
    const undone = delta(before, await store(page));
    ok("17 §23 Undo belongs to the composer and reverses the whole capture",
      committed.actions.length === 1 && undoable && undone.actions.length === 0 &&
      undone.captures.every((c) => c.processingStatus !== "processed"),
      JSON.stringify({ committed: committed.actions.length, after: undone.actions.length,
        captures: undone.captures.map((c) => c.processingStatus) }));
  }

  // 18. §25, §9. A doorway, not a mini Home page.
  {
    await seed(page);
    await visit(page, "/project/p1");
    await openSheet(page);
    const shape = await page.evaluate(`(() => {
      const d = ${FIND};
      if (!d) return { h: 0, chromeAboveInput: 999, recent: 0, nav: 0, headings: ["(no sheet)"] };
      const r = d.getBoundingClientRect();
      const input = d.querySelector("textarea").getBoundingClientRect();
      return {
        h: Math.round(r.height),
        chromeAboveInput: Math.round(input.top - r.top),
        // §25 — Home's recent list, by its own testids, must not be here.
        recent: d.querySelectorAll("[data-recent-capture], [data-recent-captures]").length,
        // The nav and the page's own content stay outside it.
        nav: d.querySelectorAll("nav").length,
        headings: [...d.querySelectorAll("h1,h2,h3")].map((h) => h.tagName + ":" + h.textContent.trim()),
      };
    })()`);
    ok("18 §9, §25 the sheet is one heading, one input and its button — no list, no nav",
      shape.recent === 0 && shape.nav === 0 && shape.headings.length === 1 &&
      shape.headings[0] === "H2:Quick capture" && shape.chromeAboveInput < 70,
      JSON.stringify(shape));
    await page.keyboard.press("Escape");
  }

  // 19. §32. The heading regression this sprint nearly shipped.
  //
  //     Rendering the composer unchanged put its own `<h1>` inside the dialog,
  //     so the document had TWO level-1 headings while the sheet was open and
  //     the dialog's own order ran h2 → h1. 099's assertion 20 pins both and
  //     never opens this overlay, which is why it is pinned here instead.
  {
    /**
     * Home's own heading is asserted here too, because the `headline` prop is
     * this sprint's new surface and its DEFAULT is the half nothing else pins.
     * Flipping the default to false was a mutant the suite let through: the
     * sheet stayed correct while Home silently lost its `<h1>`.
     */
    await visit(page, "/");
    const homeH1 = await page.evaluate(() => document.querySelectorAll("h1").length);

    await visit(page, "/project/p1");
    const closed = await page.evaluate(() => document.querySelectorAll("h1").length);
    /**
     * §32, §56. And the sheet is no LESS readable than Home.
     *
     * Not "the sheet passes AA" — it does not, and neither does Home: the
     * asking panel has three nodes at 2.54 in light and 4.08 in dark that
     * LIFEOS-099 never measured, because its sweep visited routes and never
     * drove Home into that state. That is a real pre-existing gap, recorded in
     * the report, and it is not this sprint's to fix.
     *
     * What IS this sprint's is not making it worse. The composer's colours are
     * tuned against the app's ground, so the sheet's own surface reprices every
     * ratio inside it: on `dark:bg-zinc-900` those same nodes measured 3.67
     * against Home's 4.08. This compares the two sets and fails on anything the
     * sheet adds.
     */
    const askFailures = async (openSheetFirst, scheme) => {
      await page.emulateMedia({ colorScheme: scheme });
      await seed(page);
      if (openSheetFirst) {
        await visit(page, "/today");
        await openSheet(page);
      } else {
        await visit(page, "/");
      }
      await captureInSheet_or_home(page, "Waiting on Maria for the transcript", openSheetFirst);
      await install(page);
      const ROOT = openSheetFirst
        ? FIND
        : `document.querySelector("[data-capture-results]").closest("section")`;
      /**
       * Every text node's RATIO, not just the ones that fail.
       *
       * Comparing failure lists was the first version of this and M13 walked
       * straight through it: reinstating `dark:bg-zinc-900` dropped those three
       * nodes from 4.08 to 3.67, and since both numbers are under 4.5 they were
       * on both lists and the difference cancelled. What the sheet must not do
       * is measure LOWER than Home, whether or not either passes.
       */
      return page.evaluate(`(() => {
        const A = window.__a11y;
        const root = ${ROOT};
        if (!root) return null;
        const out = {};
        for (const { el, text } of A.textLeaves(root)) {
          const c = A.contrastOf(el);
          if (c.disabled) continue;
          const k = text.trim().slice(0, 30);
          if (!(k in out) || c.ratio < out[k]) out[k] = Math.round(c.ratio * 100) / 100;
        }
        return out;
      })()`);
    };
    // Both themes: the regression was dark-only. On `dark:bg-zinc-900` the
    // sheet composited those nodes at 3.67 where Home had 4.08, and a
    // light-only comparison would have called that clean.
    const extra = [];
    for (const scheme of ["light", "dark"]) {
      const home = await askFailures(false, scheme);
      const sheet = await askFailures(true, scheme);
      if (!home || !sheet) { extra.push(`${scheme}: asking state not reached`); continue; }
      for (const k of Object.keys(sheet)) {
        if (!(k in home)) continue;                 // nodes only the sheet has
        // 0.05 of slack for sub-pixel compositing, well under the 0.41 M13 cost.
        if (sheet[k] < home[k] - 0.05) extra.push(`${scheme}: "${k}" ${sheet[k]} < Home's ${home[k]}`);
      }
    }
    await page.emulateMedia({ colorScheme: "light" });

    await visit(page, "/project/p1");
    await openSheet(page);
    const open = await page.evaluate(`(() => {
      const lv = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => +h.tagName[1]);
      let jump = false, prev = 0;
      for (const l of lv) { if (prev && l > prev + 1) jump = true; prev = l; }
      const d = ${FIND};
      if (!d) return { h1: -1, jump, named: false, fieldLabel: "(no sheet)" };
      const ta = d.querySelector("textarea");
      const lab = ta && ta.id ? d.querySelector('label[for="' + ta.id + '"]') : null;
      return {
        h1: document.querySelectorAll("h1").length,
        jump,
        named: d.getAttribute("aria-modal") === "true",
        fieldLabel: lab ? lab.textContent.trim() : "(field has no label)",
      };
    })()`);
    ok("19 §32, §56 one h1, no heading jump, dialog named, field labelled, and no node measuring lower than Home",
      closed === 1 && open.h1 === 1 && !open.jump && open.named &&
      open.fieldLabel === "What's happening?" && homeH1 === 1 &&
      extra.length === 0,
      JSON.stringify({ closed, ...open, homeH1, contrastOnlyInSheet: extra }));
    await page.keyboard.press("Escape");
  }

  // 20. §30, §31. The whole flow on the keyboard alone, ⌘↵ included.
  {
    await seed(page);
    await visit(page, "/today");
    const before = await store(page);
    await openSheet(page);
    await page.keyboard.type("Book the venue on Friday");
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(1700);
    const d = delta(before, await store(page));
    const s = await sheetState(page);
    ok("20 §30 open, type and submit without a mouse — ⌘↵ commits inside the sheet",
      d.actions.length === 1 && s.finished, `${d.actions.map((a) => a.title)} finished=${s.finished}`);
  }

  // ======================================================================
  // 21-28. And it acquired no page context on the way in (§12-§17, §41-§44)
  // ======================================================================
  //
  // 21 comes first deliberately. It is the control: if context linkage were
  // simply broken, 22-26 would all pass while proving nothing at all.

  // 21. §12. Named in the words → linked. From the same route as 22.
  {
    const g = await run(page, "/project/p1", "Book the venue for the Clinic launch project");
    ok("21 CONTROL §12 a project NAMED in the capture is linked, from the sheet",
      g.d.actions.length === 1 && g.d.actions[0].projectId === "p1" &&
      /Clinic launch/.test(g.sheet.text),
      JSON.stringify(g.d.actions.map((a) => ({ t: a.title, p: a.projectId }))));
  }

  // 22. §13. Viewing a Project is not consent to file into it.
  {
    const g = await run(page, "/project/p1", SENTENCE);
    ok("22 §13, §41 capturing from a Project does not assign the record to it",
      g.d.actions.length === 1 && !g.d.actions[0].projectId && !g.d.actions[0].goalId,
      JSON.stringify(g.d.actions.map((a) => ({ p: a.projectId ?? null, g: a.goalId ?? null }))));
  }

  // 23. §14. Nor a Goal.
  {
    const g = await run(page, "/goal/g1", SENTENCE);
    ok("23 §14, §41 capturing from a Goal does not assign the record to it",
      g.d.actions.length === 1 && !g.d.actions[0].goalId && !g.d.actions[0].projectId,
      JSON.stringify(g.d.actions.map((a) => ({ p: a.projectId ?? null, g: a.goalId ?? null }))));
  }

  // 24. §15. Today is a view, not a due date. The sentence says "tomorrow" and
  //     the record must say tomorrow — being on /today changes nothing.
  {
    const g = await run(page, "/today", SENTENCE);
    const tomorrow = await page.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    ok("24 §15 capturing from Today does not mean due today — the words decide the date",
      g.d.actions.length === 1 && g.d.actions[0].dueDate === tomorrow,
      `dueDate=${g.d.actions[0] && g.d.actions[0].dueDate} expected=${tomorrow}`);
  }

  // 25. §16. A historical review is a date the person is LOOKING at, never one
  //     the new record inherits.
  {
    const g = await run(page, "/today/review", SENTENCE);
    const created = g.d.captures[0] && g.d.captures[0].createdAt;
    const isNow = created && Math.abs(Date.parse(created) - Date.now()) < 5 * 60 * 1000;
    ok("25 §16 capturing during an evening review dates the record now, not to the review",
      g.d.actions.length === 1 && isNow, `createdAt=${created}`);
  }

  // 26. §17. The decision inbox asks questions about existing records. A capture
  //     made while standing in it is not an answer to any of them.
  {
    const g = await run(page, "/today/decisions", SENTENCE);
    const deferred = g.after.nextActions.find((a) => a.id === "a-defer");
    ok("26 §17 capturing from the decision inbox resolves no decision and touches no deferral",
      g.d.decisions.length === 0 && g.d.actions.length === 1 &&
      deferred.history.filter((h) => h.action === "deferred").length === 3 &&
      deferred.status === "open",
      JSON.stringify({ decisions: g.d.decisions.length, defers: deferred.history.filter((h) => h.action === "deferred").length }));
  }

  // 27. §43, §44. A query the person typed into a search field is their reading,
  //     not their capture. It must not reach the record.
  {
    await seed(page);
    await visit(page, "/memory");
    await page.fill("#memory-query", "lease negotiation with the landlord");
    await page.waitForTimeout(600);
    const before = await store(page);
    await openSheet(page);
    const carried = await page.evaluate(`(() => { const d = ${FIND}; const t = d && d.querySelector("textarea"); return t ? t.value : "(no sheet)"; })()`);
    await captureInSheet(page, SENTENCE);
    const d = delta(before, await store(page));
    ok("27 §43, §44 a live search query does not leak into the sheet or the record",
      carried === "" && d.actions.length === 1 &&
      d.actions[0].title === "Email Marcus about the lease" &&
      d.captures[0].text === SENTENCE &&
      !JSON.stringify(d).includes("negotiation"),
      `carried=${JSON.stringify(carried)} title=${d.actions[0] && d.actions[0].title}`);
  }

  // 28. Nothing threw, anywhere in any of the above.
  ok("28 §52 no page errors in any scenario", errors.length === 0, errors.slice(0, 2).join(" | "));

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} global capture browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
