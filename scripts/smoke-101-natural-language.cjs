#!/usr/bin/env node
/**
 * LIFEOS-101 §41, §42 — natural capture language, in the browser.
 *
 * Twenty scenarios against the production build. The deterministic suite
 * (`lib/capture/language-selftest.ts`) already pins the interpreter; this pins
 * the two things a pure-function test cannot reach:
 *
 *   what the person actually SEES when they type the sentence — the outcome
 *     panel's words, the asking state, the record that lands in the store
 *   §42 cross-doorway parity — Home and the LIFEOS-100 quick-capture sheet
 *     producing the same reading of the same sentence
 *
 * §42 exists because LIFEOS-100 unified the doorway and this sprint could
 * fork it again by accident: any interpretation that depended on which surface
 * was mounted would show up here and nowhere else.
 */
const { chromium } = require("playwright-core");
const { world } = require("./fixtures/lifeos-101-store.cjs");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** The quick-capture sheet, by accessible name — the LIFEOS-100 locator. */
const FIND = `(() => {
  const named = (d) => {
    const by = d.getAttribute("aria-labelledby");
    const n = by && document.getElementById(by);
    return (n ? n.textContent : d.getAttribute("aria-label") || "").trim();
  };
  return [...document.querySelectorAll('[role="dialog"]')].find((d) => named(d) === "Quick capture") || null;
})()`;

async function seed(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world())]);
}
const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

function delta(before, after) {
  const fresh = (d) => (after[d] || []).filter((r) => !(before[d] || []).some((x) => x.id === r.id));
  return {
    actions: fresh("nextActions"), notes: fresh("notes"), events: fresh("events"),
    goals: fresh("goals"), captures: fresh("captures"),
    constitutionElements: fresh("constitutionElements"), protocols: fresh("protocols"),
  };
}

/** Type a sentence on HOME and report what the store and the panel did. */
async function onHome(page, sentence) {
  await seed(page);
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#capture", { timeout: 20000 });
  await page.waitForTimeout(900);
  const before = await store(page);
  await page.fill("#capture", sentence);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(1700);
  const panel = await page.evaluate(() => {
    const m = document.querySelector("main");
    return {
      finished: !!m.querySelector("[data-capture-finished]"),
      asking: !!m.querySelector("[data-capture-results]"),
      saved: [...m.querySelectorAll("[data-capture-saved]")].map((n) => n.getAttribute("data-capture-saved")),
      candidates: [...m.querySelectorAll("[data-candidate]")].map((n) => n.getAttribute("data-candidate")),
      text: (m.querySelector("[data-capture-finished], [data-capture-results]") || m).innerText.trim(),
    };
  });
  return { d: delta(before, await store(page)), panel };
}

/** The same sentence through the LIFEOS-100 quick-capture sheet, from a Project. */
async function inSheet(page, sentence, route = "/project/p1") {
  await seed(page);
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const before = await store(page);
  await page.keyboard.press("Shift+Meta+k");
  await page.waitForSelector('[role="dialog"] #capture', { timeout: 8000 });
  await page.waitForTimeout(250);
  await page.fill('[role="dialog"] #capture', sentence);
  await page.click('[role="dialog"] [data-capture-submit]');
  await page.waitForTimeout(1700);
  const panel = await page.evaluate(`(() => {
    const d = ${FIND};
    if (!d) return { gone: true, saved: [], candidates: [], text: "" };
    return {
      finished: !!d.querySelector("[data-capture-finished]"),
      asking: !!d.querySelector("[data-capture-results]"),
      saved: [...d.querySelectorAll("[data-capture-saved]")].map((n) => n.getAttribute("data-capture-saved")),
      candidates: [...d.querySelectorAll("[data-candidate]")].map((n) => n.getAttribute("data-candidate")),
      text: (d.querySelector("[data-capture-finished], [data-capture-results]") || d).innerText.trim(),
    };
  })()`);
  return { d: delta(before, await store(page)), panel, url: page.url() };
}

/** A compact, comparable shape — what was written, not how it was rendered. */
const shape = (d) => JSON.stringify({
  actions: d.actions.map((a) => ({ t: a.title, due: a.dueDate ?? null, rec: !!a.recurrence, who: a.waitingOn ?? null, s: a.status })),
  notes: d.notes.length, events: d.events.map((e) => e.title), goals: d.goals.map((g) => g.title),
  rules: d.constitutionElements.length, protocols: d.protocols.length,
});

/** Did anything consequential get written? */
const wrote = (d) => d.actions.length + d.events.length + d.goals.length;

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  // ================================================== 1-2. §5 the headline
  {
    const r = await onHome(page, "Remind me to call the dentist Friday");
    /**
     * The COMMITTED title, "Call the dentist" — not the candidate field's
     * "call the dentist", which is what the deterministic suite asserts.
     *
     * The difference is LIFEOS-096 doing its job (§27): the interpreter's
     * extracted phrase goes through the existing title cleanup on the way to
     * the record, and this sprint added no second normalizer. Asserting the
     * lower-case field here would have tested the interpreter twice and the
     * product once.
     */
    ok("1 §5, §27 'Remind me to call the dentist Friday' becomes an Action, named by 096 without the framing",
      r.d.actions.length === 1 && r.d.actions[0].title === "Call the dentist"
      && !!r.d.actions[0].dueDate && r.panel.finished,
      shape(r.d));
    ok("2 §21 and the person is told, in the outcome panel",
      /SAVED AS ACTION/i.test(r.panel.text) && /call the dentist/i.test(r.panel.text),
      r.panel.text.split("\n").filter(Boolean).slice(0, 4).join(" | "));
  }

  // ================================================== 3. §5 the counter-example
  {
    const r = await onHome(page, "Remind me that my passport expires Friday");
    ok("3 §5 'Remind me THAT …' stays a fact — no Action",
      r.d.actions.length === 0, shape(r.d));
  }

  // ================================================== 4-7. §19, §20, §18, §21
  for (const [n, sentence, why] of [
    [4, "Don't remind me to call the dentist", "§19 negation of the new opener"],
    [5, "I don't need to call Marcus", "§19 negation of the obligation opener"],
    [6, "I needed to call the dentist last year", "§20 the same words in the past"],
    [7, "Maria said I need to call the dentist", "§21 someone else's account"],
  ]) {
    const r = await onHome(page, sentence);
    ok(`${n} ${why} — no commitment written`, wrote(r.d) === 0, `${JSON.stringify(sentence)} → ${shape(r.d)}`);
  }

  // ================================================== 8. §18 uncertainty
  {
    const r = await onHome(page, "Maybe I should call Marcus");
    ok("8 §18 a hedged intention writes nothing by itself", wrote(r.d) === 0, shape(r.d));
  }

  // ================================================== 9. §22 conditions
  {
    const r = await onHome(page, "When Marcus replies, send the lease");
    ok("9 §22 a condition is preserved as a protocol, not flattened to an errand",
      r.d.actions.length === 0 && (r.panel.asking || r.panel.candidates.includes("protocol")),
      `${shape(r.d)} candidates=${r.panel.candidates.join(",")}`);
  }

  // ================================================== 10. §23, §24 mixed intent
  {
    const r = await onHome(page, "Remind me to call Marcus tomorrow and remember that the lease expires Friday");
    ok("10 §24 a new opener does not swallow the rest of the sentence",
      r.panel.saved.length === 2 || r.panel.candidates.length === 2,
      `saved=${r.panel.saved.join(",")} candidates=${r.panel.candidates.join(",")} ${shape(r.d)}`);
  }

  // ================================================== 11-12. §10 completion
  {
    const r = await onHome(page, "I called the dentist");
    ok("11 §10, §26 completion wording matches the existing record rather than creating one",
      r.d.actions.length === 0 && /call the dentist/i.test(r.panel.text),
      `${shape(r.d)} | ${r.panel.text.split("\n").filter(Boolean).slice(0, 3).join(" | ")}`);
    const amb = await onHome(page, "Sent Marcus the lease");
    ok("12 §10 an ambiguous completion asks rather than assuming",
      amb.d.actions.length === 0, shape(amb.d));
  }

  // ================================================== 13. §8 waiting, no duplicate
  {
    const r = await onHome(page, "Still waiting on Maria for the transcript");
    const dupes = r.d.actions.filter((a) => a.status === "waiting");
    ok("13 §8, §26 waiting wording does not duplicate the open wait",
      dupes.length === 0 || r.panel.asking,
      `newWaits=${dupes.length} asking=${r.panel.asking}`);
  }

  // ================================================== 14. §14 events unchanged
  {
    const r = await onHome(page, "Dentist Friday at 2");
    ok("14 §14 event wording keeps its existing good behaviour",
      r.d.events.length === 1 && r.d.actions.length === 0, shape(r.d));
  }

  // ================================================== 15. §17 aspiration
  {
    const r = await onHome(page, "I'd like to run a marathon");
    ok("15 §17, §29 an aspiration creates no Goal by itself",
      r.d.goals.length === 0 && r.d.actions.length === 0, shape(r.d));
  }

  // ================================================== 16. §12 rule authority
  {
    const r = await onHome(page, "I never say no to my kids");
    ok("16 §12, §29 a rule is still never written automatically",
      r.d.constitutionElements.length === 0 && wrote(r.d) === 0, shape(r.d));
  }

  // ================================================== 17. Fix A in the browser
  {
    const r = await onHome(page, "When I was applying to college I called Maria every week");
    ok("17 §20 a past narrative does not become a recurring commitment",
      r.d.actions.length === 0, shape(r.d));
  }

  // ================================================== 18. §28 raw source
  {
    const sentence = "I gotta email Marcus tomorrow";
    const r = await onHome(page, sentence);
    ok("18 §28 the raw capture is stored exactly as typed",
      r.d.captures.length === 1 && r.d.captures[0].text === sentence,
      JSON.stringify(r.d.captures.map((c) => c.text)));
  }

  // ================================================== 19. §42 cross-doorway parity
  //
  // The sprint's own risk: LIFEOS-100 unified the doorway and a new
  // interpretation rule could fork it again if anything depended on the
  // surface. Every chosen fix goes through both, and the STORE DELTA is
  // compared — not the rendering, which legitimately differs.
  {
    const SENTENCES = [
      "Remind me to call the dentist Friday",
      "Remind me that my passport expires Friday",
      "Don't let me forget to submit the application",
      "Make sure I send Maria the form",
      "I gotta email Marcus tomorrow",
      "I've got to call the dentist",
      "When I was applying to college I called Maria every week",
      "Never got around to emailing Marcus",
      "Don't remind me to call the dentist",
      "Remind me to call Marcus tomorrow and remember that the lease expires Friday",
    ];
    const diffs = [];
    for (const s of SENTENCES) {
      const h = await onHome(page, s);
      const q = await inSheet(page, s);
      if (shape(h.d) !== shape(q.d)) diffs.push(`${JSON.stringify(s)}\n      home  ${shape(h.d)}\n      sheet ${shape(q.d)}`);
      if (!q.url.endsWith("/project/p1")) diffs.push(`${JSON.stringify(s)} left the route: ${q.url}`);
    }
    ok(`19 §42 Home and Quick Capture interpret all ${SENTENCES.length} sentences identically`,
      diffs.length === 0, diffs.slice(0, 2).join("\n    "));
  }

  // ================================================== 20. §47 and page errors
  {
    const r = await inSheet(page, "Remind me to call the dentist Friday");
    const a11y = await page.evaluate(`(() => {
      const d = ${FIND};
      if (!d) return { missing: true };
      return {
        h1: document.querySelectorAll("h1").length,
        modal: d.getAttribute("aria-modal") === "true",
        live: !!d.querySelector("[role=status][aria-live]"),
      };
    })()`);
    ok("20 §47 the sheet's accessibility is unchanged, and nothing threw anywhere",
      a11y.h1 === 1 && a11y.modal && a11y.live && r.panel.finished && errors.length === 0,
      `${JSON.stringify(a11y)} errors=${errors.slice(0, 1).join("")}`);
  }

  await ctx.close();
  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} natural-language browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
