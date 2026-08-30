/**
 * LIFEOS-074 D-22 §9 — user-facing sync truth, desktop AND mobile.
 *
 * D-21 proved a state the model reports correctly can still be invisible to the
 * person, so every state below is asserted on the RENDERED indicator, measured.
 * The health module is driven directly through its test seams, because there is
 * no production Supabase in this environment to fail on demand.
 *
 * LIFEOS-075 §14 renamed two of these labels: `synced` reads "Synced" (was
 * "Saved") and `syncing` reads "Syncing…" (was "Saving…"), because the old set
 * gave the WEAKER state — local-only — the longer, more reassuring phrase. The
 * assertions below moved with the product; the property each one tests is
 * unchanged, and 9 additionally still forbids a bare "Saved".
 */
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3111";
const results = [];
let MOBILE = false;
const ok = (n, p, d) => { results.push({ n, p, d, mobile: MOBILE }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const K = "lifeos.mvp.v1";
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = dk(0), OLD = dk(-120);
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const D = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = Object.fromEntries(D.map((d) => [d, []]));
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const WORLD = { nextActions: [act({ id: "a1", title: "ZZFileReturn", createdAt: iso(OLD), dueDate: T })] };

const BREAK_LOCAL = `(() => { const p = Object.getPrototypeOf(window.localStorage); const r = p.setItem;
  p.setItem = function (k, v) { if (k === "lifeos.mvp.v1") throw new Error("Quota injected"); return r.call(this, k, v); }; })()`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  for (const vp of [{ width: 1280, height: 2000, label: "DESKTOP" }, { width: 390, height: 844, label: "MOBILE" }]) {
    MOBILE = vp.label === "MOBILE";
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: MOBILE, hasTouch: MOBILE });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));

    const indicator = () => page.evaluate(() => {
      const el = document.querySelector("[data-sync-status]");
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      // The LABEL's own box: textContent still holds words that a collapsed
      // label hides, which is exactly how "hidden" can look "present".
      const lbl = [...el.querySelectorAll("span")].find((x) => (x.textContent || "").trim().length > 2);
      const lblBox = lbl ? lbl.getBoundingClientRect() : { width: 0, height: 0 };
      const labelText = lblBox.width > 0 && lblBox.height > 0 ? (lbl.textContent || "").trim() : "";
      return { found: true, labelText, state: el.getAttribute("data-sync-status"), text: el.textContent.trim(),
        w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
    });
    const visible = (i) => i.found && i.w > 0 && i.h > 0 && i.display !== "none";

    await page.goto(BASE + "/actions/a1", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(([k, e, w]) => localStorage.setItem(k, JSON.stringify({ ...e, ...w })), [K, EMPTY, WORLD]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // 1. Local ok, remote not configured in this environment → the calm state.
    const calm = await indicator();
    ok(`${vp.label} 1 a calm state renders`, calm.found, JSON.stringify(calm));
    ok(`${vp.label} 2 …and never claims remote durability it does not have`,
      !/^Saved$/.test(calm.text), calm.text);
// LIFEOS-076 §4 changed what "out of the way" means on a phone. LIFEOS-074
// D-21 hid CALM states entirely (display:none), which 075 found left a mobile
// user with no way to answer "is this only on this device?" (C-6). The approved
// repair keeps calm states quiet — the LABEL collapses — while keeping the
// control itself present as a 44x44 tap target that opens the status popover.
// The property each assertion tests is unchanged: a healthy state must not
// shout. Only the mechanism moved from "absent" to "collapsed".
    if (MOBILE) ok(`${vp.label} 3 a calm state stays out of the way on a phone`,
      calm.display !== "none" && !/Saved locally|Synced/.test(calm.labelText ?? ""), JSON.stringify(calm));
    else ok(`${vp.label} 3 a calm state is shown on a wide screen`, visible(calm), JSON.stringify(calm));

    // 2. Local persistence fails → visible on BOTH (this is D-21).
    await page.evaluate(BREAK_LOCAL);
    for (const b of await page.$$("button")) { if ((await b.innerText()).trim() === "Complete") { await b.click(); break; } }
    await page.waitForTimeout(300);
    for (const b of await page.$$("button")) { if ((await b.innerText()).trim() === "Mark complete") { await b.click(); break; } }
    await page.waitForTimeout(900);
    const localFail = await indicator();
    ok(`${vp.label} 4 a failed LOCAL save is visible`, visible(localFail) && /Local save failed/.test(localFail.text), JSON.stringify(localFail));
    ok(`${vp.label} 5 …and is inside the viewport`, localFail.w <= vp.width, JSON.stringify(localFail));

    // 3. Remote states, driven through the real health store on /dev/sync-tests.
    await page.goto(BASE + "/dev/sync-tests", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    const press = async (state) => {
      const b = await page.$(`[data-health-state="${state}"]`);
      if (!b) return false;
      await b.click(); await page.waitForTimeout(400); return true;
    };

    ok(`${vp.label} 6 the dev health harness is reachable`, await press("synced"));
    const synced = await indicator();
    ok(`${vp.label} 7 a full sync reads "Synced"`, /^Synced$/.test(synced.text), JSON.stringify(synced));

    await press("incomplete");
    const inc = await indicator();
    ok(`${vp.label} 8 a PARTIAL sync reads "Sync incomplete"`, /Sync incomplete/.test(inc.text), JSON.stringify(inc));
    ok(`${vp.label} 9 …and never reads "Synced" or a bare "Saved"`, !/^Synced$/.test(inc.text) && !/^Saved$/.test(inc.text), inc.text);
    ok(`${vp.label} 10 …and is VISIBLE without opening /health`, visible(inc), JSON.stringify(inc));
    // LIFEOS-076 §1 moved recovery into the status popover: the trigger is now
    // itself the button, and Retry lives one tap inside it at a finger-sized
    // target rather than as a 30x16 link (E-1). The property — a retry is
    // reachable from the failure state — is unchanged.
    await page.click("[data-sync-status]");
    await page.waitForTimeout(220);
    ok(`${vp.label} 11 …offering a retry`, !!(await page.$("[data-sync-retry]")), "no retry control in the status popover");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    await press("failed");
    const failed = await indicator();
    ok(`${vp.label} 12 a total remote failure is visible`, visible(failed), JSON.stringify(failed));

    await press("local-error");
    const le = await indicator();
    ok(`${vp.label} 13 a local save failure is visible`, visible(le) && /Local save failed/.test(le.text), JSON.stringify(le));

    await press("synced");
    const back = await indicator();
    ok(`${vp.label} 14 recovery returns to "Synced"`, /^Synced$/.test(back.text), JSON.stringify(back));
    if (MOBILE) ok(`${vp.label} 15 …and stops shouting on a phone once healthy`,
      !/Retry/.test(back.text ?? "") && (back.labelText ?? "") === "", JSON.stringify(back));
    else ok(`${vp.label} 15 …and stays visible on a wide screen`, visible(back), JSON.stringify(back));

    await ctx.close();
  }

  ok("Z1 no uncaught page errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  await browser.close();
  const pass = results.filter((r) => r.p).length;
  const mob = results.filter((r) => r.mobile).length;
  console.log(`\n=== ${pass}/${results.length} sync-truth assertions (${results.length - mob} desktop, ${mob} mobile) ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
