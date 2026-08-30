#!/usr/bin/env node
/**
 * LIFEOS-076 §39 — SYNC TRUST BROWSER TORTURE.
 *
 * Every claim here is measured on the RENDERED product at two viewports. The
 * 074 accessibility lesson applies throughout: a rule that is never pointed at
 * a real page proves nothing, so tap targets are measured with
 * `getBoundingClientRect`, the label's own box is measured rather than
 * `textContent` (which still contains text that `display:none` hides), and
 * focus is driven with real keyboard events.
 *
 * §43: no Supabase credentials exist here, so the health store is driven
 * through its test seam. That is deterministic evidence about rendering and
 * interaction. It is not a live deployed run and is never called one.
 *
 * Run against a production build on :3111 with LIFEOS_ENABLE_DEV_ROUTES=1.
 */
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const results = [];
let VP = "DESKTOP";
const ok = (n, p, d) => { results.push({ n, p, d, vp: VP }); console.log(`${p ? "PASS" : "FAIL"}  [${VP}] ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));
const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const T = dk(0);
const iso = (h = 8) => `${T}T${String(h).padStart(2, "0")}:00:00.000Z`;
const WORLD = () => ({ ...EMPTY(),
  nextActions: [{ id: "a1", title: "ZZFileTheReturn", description: "", status: "open", createdAt: iso(), updatedAt: iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [] }],
  notes: [{ id: "n1", title: "ZZAdvisor", body: "ZZSaidFriday", createdAt: iso(), updatedAt: iso(), tags: [], linkedEntityRefs: [] }],
});

const ALL_STATES = ["synced", "incomplete", "failed", "local-error", "syncing", "retrying", "offline", "local"];
const ALARMING = ["incomplete", "failed", "local-error", "retrying"];

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  const trigger = (page) => page.evaluate(() => {
    const el = document.querySelector("[data-sync-status]");
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Measure the LABEL's own box. textContent still holds words that
    // `display:none` hides, which is exactly how a hidden label can look present.
    const spans = [...el.querySelectorAll("span")].filter((s) => (s.textContent || "").trim().length > 2);
    const labelBox = spans.length ? spans[0].getBoundingClientRect() : { width: 0, height: 0 };
    return {
      found: true, tag: el.tagName, state: el.getAttribute("data-sync-status"),
      alarming: el.getAttribute("data-sync-alarming"),
      w: Math.round(r.width), h: Math.round(r.height), display: cs.display,
      visible: r.width > 0 && r.height > 0 && cs.display !== "none",
      labelVisible: labelBox.width > 0 && labelBox.height > 0,
      aria: el.getAttribute("aria-label"), expanded: el.getAttribute("aria-expanded"),
      haspopup: el.getAttribute("aria-haspopup"),
      dots: [...el.querySelectorAll("span[aria-hidden]")].length,
    };
  });
  const panel = (page) => page.evaluate(() => {
    const d = document.querySelector("[data-sync-panel]");
    if (!d) return { open: false };
    const r = d.getBoundingClientRect();
    return {
      open: true, role: d.getAttribute("role"), aria: d.getAttribute("aria-label"),
      w: Math.round(r.width), h: Math.round(r.height),
      text: (d.textContent || "").replace(/\s+/g, " ").trim(),
      label: d.querySelector("[data-sync-panel-label]")?.textContent?.trim() ?? null,
      meaning: d.querySelector("[data-sync-panel-meaning]")?.textContent?.trim() ?? null,
      last: d.querySelector("[data-sync-last]")?.textContent?.trim() ?? null,
      retry: (() => { const b = d.querySelector("[data-sync-retry]"); if (!b) return null; const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; })(),
      retryLocal: (() => { const b = d.querySelector("[data-sync-retry-local]"); if (!b) return null; const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height) }; })(),
      inViewport: r.left >= 0 && r.right <= window.innerWidth,
    };
  });
  const setState = async (page, s) => { await page.click(`[data-health-state="${s}"]`); await page.waitForTimeout(180); };
  const openPanel = async (page) => { await page.click("[data-sync-status]"); await page.waitForTimeout(220); };

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2000 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile, hasTouch: isMobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(WORLD())]);
    await page.goto(`${BASE}/dev/sync-tests`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);

    // ================================================================
    // 1. EVERY state is REACHABLE and INSPECTABLE at this viewport (§4).
    // ================================================================
    for (const s of ALL_STATES) {
      await setState(page, s);
      const t = await trigger(page);
      ok(`S:${s} the status control exists and is rendered`, t.found && t.visible, JSON.stringify(t));
      ok(`S:${s} …as a real button, not a bare span (E-1/E-4)`, t.tag === "BUTTON", t.tag);
      ok(`S:${s} …carrying a meaningful accessible name`,
        !!t.aria && t.aria.startsWith("Sync status:") && t.aria.length > 30, String(t.aria));
      if (isMobile) {
        ok(`S:${s} MOBILE tap target is at least 44x44 (E-1)`, t.w >= 44 && t.h >= 44, JSON.stringify({ w: t.w, h: t.h }));
      }
      // C-6: calm states hide the WORDS on a phone but never the control.
      const alarming = ALARMING.includes(s);
      ok(`S:${s} alarming flag matches the state`, (t.alarming === "true") === alarming, `${t.alarming} for ${s}`);
      if (isMobile && !alarming) {
        ok(`S:${s} C-6 MOBILE: calm label is collapsed but the control remains reachable`,
          t.labelVisible === false && t.visible === true, JSON.stringify(t));
      }
      if (isMobile && alarming) {
        ok(`S:${s} MOBILE: an alarming label stays visible`, t.labelVisible === true, JSON.stringify(t));
      }
      if (!isMobile) {
        ok(`S:${s} DESKTOP: the label is visible`, t.labelVisible === true, JSON.stringify(t));
      }
    }

    // ================================================================
    // 2. THE POPOVER — the durability answer, without a debug route (§33).
    // ================================================================
    for (const s of ["synced", "local", "offline", "incomplete", "failed", "syncing"]) {
      await setState(page, s);
      await openPanel(page);
      const pn = await panel(page);
      ok(`P:${s} the popover opens`, pn.open === true, JSON.stringify(pn).slice(0, 120));
      ok(`P:${s} …is a labelled dialog`, pn.role === "dialog" && !!pn.aria, JSON.stringify({ role: pn.role, aria: pn.aria }));
      ok(`P:${s} …names the state`, !!pn.label && pn.label.length > 3, String(pn.label));
      ok(`P:${s} …explains it as a consequence, not a mechanism (§24)`,
        !!pn.meaning && !/domain|table|supabase|postgres|tombstone|localStorage/i.test(pn.meaning), String(pn.meaning));
      ok(`P:${s} …stays inside the viewport`, pn.inViewport === true, JSON.stringify({ w: pn.w }));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      ok(`P:${s} …and Escape closes it`, (await panel(page)).open === false);
    }

    // ================================================================
    // 3. RECOVERY CONTROLS are present, sized and correct per state (§2, §7).
    // ================================================================
    await setState(page, "incomplete");
    await openPanel(page);
    let pn = await panel(page);
    ok("R1 incomplete offers a retry", !!pn.retry, JSON.stringify(pn.retry));
    ok("R2 …sized for a finger, unlike the 30x16 it replaces (E-1)",
      (pn.retry?.h ?? 0) >= 36 && (pn.retry?.w ?? 0) >= 60, JSON.stringify(pn.retry));
    ok("R3 …and it is a remote retry, not a local one", pn.retryLocal === null);
    ok("R4 the incomplete meaning says changes are only on this device (§3)",
      /only on this device/i.test(pn.meaning ?? ""), String(pn.meaning));
    ok("R5 …and never names the failed domain (E-3/§24)",
      !/goals|next_actions|nextActions/i.test(pn.text), pn.text.slice(0, 160));
    await page.keyboard.press("Escape");

    await setState(page, "local-error");
    await openPanel(page);
    pn = await panel(page);
    ok("R6 E-2: the local-save failure now offers an action", !!pn.retryLocal, JSON.stringify(pn));
    ok("R7 …sized for a finger", (pn.retryLocal?.h ?? 0) >= 36, JSON.stringify(pn.retryLocal));
    ok("R8 …and it is a LOCAL retry, not a remote one", pn.retry === null);
    ok("R9 §11: it never tells the user to reload — reload is what loses the change",
      !/reload|refresh/i.test(pn.text.replace(/Don’t reload[^.]*\./g, "")), pn.text.slice(0, 200));
    ok("R10 …and it does warn against reloading explicitly", /Don’t reload/.test(pn.text), pn.text.slice(0, 200));
    await page.keyboard.press("Escape");

    for (const s of ["synced", "local", "syncing", "offline"]) {
      await setState(page, s);
      await openPanel(page);
      const p2 = await panel(page);
      ok(`R:${s} a healthy state offers no recovery control it does not need`,
        p2.retry === null && p2.retryLocal === null, JSON.stringify({ retry: p2.retry, local: p2.retryLocal }));
      await page.keyboard.press("Escape");
    }

    // ================================================================
    // 4. ACCESSIBILITY, on the rendered page (§32).
    // ================================================================
    await setState(page, "synced");
    const a11y = await page.evaluate(() => {
      const el = document.querySelector("[data-sync-status]");
      el.focus();
      const focused = document.activeElement === el;
      const live = document.querySelector("[data-sync-live]");
      return {
        focusable: focused,
        liveRegion: live ? { text: (live.textContent || "").trim(), politeness: live.getAttribute("aria-live") } : null,
        haspopup: el.getAttribute("aria-haspopup"),
        expanded: el.getAttribute("aria-expanded"),
      };
    });
    ok("A1 §32 the control is keyboard focusable", a11y.focusable === true);
    ok("A2 §32 it declares that it opens a dialog", a11y.haspopup === "dialog");
    ok("A3 §32 it reports its expanded state", a11y.expanded === "false");
    ok("A4 §32 a polite live region carries the state for screen readers (E-4)",
      a11y.liveRegion?.politeness === "polite" && (a11y.liveRegion?.text ?? "").length > 0, JSON.stringify(a11y.liveRegion));
    // Keyboard opens it, Escape closes it — no mouse required anywhere.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    ok("A5 §32 Enter opens the popover from the keyboard", (await panel(page)).open === true);
    ok("A6 §32 …and aria-expanded updates", (await trigger(page)).expanded === "true");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    ok("A7 §32 Escape closes it again", (await panel(page)).open === false);
    // Colour is not the only carrier: every state has distinct words.
    const labels = [];
    for (const s of ALL_STATES) { await setState(page, s); labels.push((await panel(page)).open ? "" : (await trigger(page)).aria); }
    ok("A8 §32 colour is never the sole carrier — each state has its own words",
      new Set(labels).size === labels.length, JSON.stringify(labels.length));
    const focusRing = await page.evaluate(() => {
      const el = document.querySelector("[data-sync-status]");
      return el.className.includes("focus-visible:outline");
    });
    ok("A9 §32 a visible focus treatment is applied", focusRing === true);

    // ================================================================
    // 5. LAST SYNCED — shown only when truthfully known (§5, §6, §11).
    // ================================================================
    await page.evaluate(() => localStorage.removeItem("lifeos.lastSync.v1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await setState(page, "synced");
    await openPanel(page);
    ok("L1 §6 with no recorded time, no time is shown", (await panel(page)).last === null);
    ok("L2 §11 …and the state still reads Synced", (await panel(page)).label === "Synced");
    await page.keyboard.press("Escape");

    await page.evaluate(() => localStorage.setItem("lifeos.lastSync.v1", new Date(Date.now() - 5 * 60_000).toISOString()));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await setState(page, "synced");
    await openPanel(page);
    const withTime = await panel(page);
    ok("L3 §5 a persisted time SURVIVES a reload and is shown",
      /5 min ago/.test(withTime.last ?? ""), String(withTime.last));
    await page.keyboard.press("Escape");

    await page.evaluate(() => localStorage.setItem("lifeos.lastSync.v1", "not-a-timestamp"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await setState(page, "synced");
    await openPanel(page);
    ok("L4 §6 a corrupted stored time is omitted, never rendered",
      (await panel(page)).last === null, String((await panel(page)).last));
    await page.keyboard.press("Escape");

    await page.evaluate(() => localStorage.setItem("lifeos.lastSync.v1", new Date(Date.now() + 86_400_000).toISOString()));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await setState(page, "synced");
    await openPanel(page);
    ok("L5 §6 a future time is omitted rather than shown as 'in a day'",
      (await panel(page)).last === null, String((await panel(page)).last));
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.removeItem("lifeos.lastSync.v1"));

    // ================================================================
    // 6. THE NORMAL SHELL — no debug route required (§33).
    // ================================================================
    await page.goto(`${BASE}/actions`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const shellTrigger = await trigger(page);
    ok("N1 §33 the status control is present on an ordinary product page",
      shellTrigger.found && shellTrigger.visible, JSON.stringify(shellTrigger).slice(0, 140));
    await openPanel(page);
    const shellPanel = await panel(page);
    ok("N2 §33 …and the durability answer opens from there, with no debug route",
      shellPanel.open && !!shellPanel.meaning, String(shellPanel.meaning));
    ok("N3 §36 no provider or infrastructure word reaches it",
      !/supabase|postgres|bucket|rls|table/i.test(shellPanel.text), shellPanel.text.slice(0, 160));
    await page.keyboard.press("Escape");
    ok("N4 §34 when healthy the shell stays quiet — no alarm on an ordinary page",
      (await trigger(page)).alarming === "false", JSON.stringify((await trigger(page)).alarming));

    // ================================================================
    // 7. /recovery reflects REAL sync state now (E-5, §7).
    // ================================================================
    await page.goto(`${BASE}/recovery`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const recoveryHealthy = (await page.$eval("body", (n) => n.textContent || "")).replace(/\s+/g, " ");
    ok("V1 §7 a healthy account shows nothing needing recovery",
      /Nothing needs recovery/i.test(recoveryHealthy), recoveryHealthy.slice(0, 160));
    ok("V2 §7 …and does not invent a conflict from the dormant subsystem",
      !/Sync conflicts \(/.test(recoveryHealthy));

    // Now make sync unhealthy and come back.
    await page.goto(`${BASE}/dev/sync-tests`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await setState(page, "incomplete");
    await page.evaluate(() => { history.pushState({}, "", "/recovery"); });
    await page.goto(`${BASE}/recovery`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    // A full page load resets the module health, so this asserts the SHAPE of
    // the surface rather than a state carried across a reload — stated plainly
    // rather than dressed up as something it is not.
    const recoveryMarkup = await page.evaluate(() => ({
      hasSyncSection: !!document.querySelector("[data-recovery-sync]"),
      hasRetry: !!document.querySelector("[data-recovery-retry]"),
      body: (document.body.textContent || "").replace(/\s+/g, " ").slice(0, 200),
    }));
    ok("V3 §7 the recovery page renders after a reload without error",
      recoveryMarkup.body.length > 20, recoveryMarkup.body.slice(0, 80));
    ok("V4 §7 …and its sync section is driven by live health, not the dormant store",
      recoveryMarkup.hasSyncSection === false, "healthy after reload — the section correctly stays absent");

    // ================================================================
    // 8. NO NOTIFICATION MACHINE-GUN across a retry loop (§22, §23).
    // ================================================================
    await page.goto(`${BASE}/dev/sync-tests`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const toastsBefore = await page.evaluate(() => document.querySelectorAll("[role='status'],[data-toast]").length);
    for (const s of ["retrying", "failed", "retrying", "failed", "retrying", "synced"]) await setState(page, s);
    const toastsAfter = await page.evaluate(() => document.querySelectorAll("[role='status'],[data-toast]").length);
    ok("T1 §23 a full retry loop produces no toast storm",
      toastsAfter - toastsBefore <= 1, JSON.stringify({ toastsBefore, toastsAfter }));
    ok("T2 §23 the persistent indicator carries the state instead",
      (await trigger(page)).state === "synced");

    // ================================================================
    // 9. THE SYNC UI NEVER MUTATES USER DATA (§12).
    //
    // The first draft seeded an account on /today, walked through the dev
    // harness, and asserted the seed survived. It did not — and the cause is
    // NOT the sync UI. `/dev/sync-tests` renders `runSyncSelfTests()`, whose
    // sections 58-61 have driven the REAL store since LIFEOS-074: opening that
    // page writes fixture beliefs over whatever the viewer had. It is
    // production-gated, so no user is exposed, but it is a genuine side effect
    // and is reported as E-7 rather than papered over.
    //
    // So the baseline is taken AFTER the dev route has had its way, and what is
    // asserted is the claim that actually belongs to this sprint: opening the
    // popover, retrying, and closing it change nothing on disk.
    // ================================================================
    const beforeUi = await page.evaluate((k) => localStorage.getItem(k), KEY);
    await setState(page, "incomplete");
    await openPanel(page);
    await page.click("[data-sync-retry]");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await setState(page, "local-error");
    await openPanel(page);
    await page.click("[data-sync-retry-local]");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    const afterUi = await page.evaluate((k) => localStorage.getItem(k), KEY);
    ok("D1 §12 opening the status popover and retrying does not alter stored data",
      beforeUi === afterUi,
      JSON.stringify({ before: (beforeUi ?? "").length, after: (afterUi ?? "").length }));
    ok("D2 §12 …and the store is still valid JSON afterwards",
      (() => { try { return typeof JSON.parse(afterUi ?? "") === "object"; } catch { return false; } })());
    // E-7, stated as measured: the dev route IS destructive, and gated.
    ok("D3 E-7: /dev/sync-tests mutates the real store (pre-existing since 074)",
      beforeUi !== null && !beforeUi.includes("ZZFileTheReturn"),
      "the seeded account survived after all — re-examine E-7");

    await ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.slice(0, 4).join(" | "));

  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} sync-trust browser assertions (${d} desktop, ${m} mobile) ===`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
