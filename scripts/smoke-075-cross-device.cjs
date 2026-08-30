#!/usr/bin/env node
/**
 * LIFEOS-075 §37 — CROSS-DEVICE BROWSER TORTURE.
 *
 * ## What "two devices" means here, exactly (§8, §16)
 *
 * Device A and Device B are two separate Playwright BrowserContexts. A context
 * is its own storage partition and its own JavaScript realm, so they share
 * NO localStorage, NO sessionStorage, NO IndexedDB and NO module state — the
 * module-singleton store in `lib/mvpStore.ts` is instantiated once per context,
 * not once per process. Section 0 proves that isolation before anything is
 * built on it, because a harness that quietly shared storage would make every
 * assertion below vacuous. Two tabs in one context would NOT qualify and are
 * not used.
 *
 * ## What is real and what is simulated — stated plainly (§15)
 *
 * This environment has no Supabase credentials, so the app runs local-only and
 * the indicator reads "Saved locally" throughout. The TRANSPORT between A and B
 * is therefore simulated: the exact bytes Device A wrote to its own storage are
 * carried to Device B's storage, which is what a remote round trip would
 * deliver. Everything on both sides of that hop is real — the real store, the
 * real hydration, the real pages, the real components.
 *
 * That is deterministic evidence about the product's behaviour on two devices.
 * It is NOT a live deployed two-client run, it is never described as one, and
 * §9 of the brief remains unrun for want of credentials.
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
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });

/**
 * Device A's life. Deliberately contains NO capture, source, belief or proposal
 * — the exact C-1 shape: an account made entirely of the domains the old
 * four-domain `hasData()` could not see.
 */
const WORLD = () => ({ ...EMPTY(),
  nextActions: [
    act({ id: "a1", title: "ZZAccountantCall", createdAt: iso(T), dueDate: T, projectId: "p1" }),
    act({ id: "a2", title: "ZZWaterPlants", createdAt: iso(T), dueTime: "07:00", recurrence: { frequency: "daily", interval: 1 } }),
    act({ id: "a3", title: "ZZHearFromSam", createdAt: iso(T), status: "waiting", waitingOn: "Sam", waitingSince: iso(T) }),
  ],
  goals: [{ id: "g1", title: "ZZFinancialOrder", createdAt: iso(T), updatedAt: iso(T), status: "active", description: "", horizon: "year", linkedEntityRefs: [], tags: [] }],
  projects: [{ id: "p1", title: "ZZTaxReturn", createdAt: iso(T), updatedAt: iso(T), status: "active", description: "", goalId: "g1", linkedEntityRefs: [], tags: [], milestones: [], sections: [], relatedRefs: [] }],
  notes: [{ id: "n1", title: "ZZAdvisorNote", body: "ZZSaidFriday", createdAt: iso(T), updatedAt: iso(T), tags: [], linkedEntityRefs: [] }],
  events: [{ id: "e1", title: "ZZDentist", date: T, startTime: "14:00", endTime: "15:00", allDay: false, notes: "", linkedEntityRefs: [], createdAt: iso(T), updatedAt: iso(T) }],
  documents: [{ id: "doc1", title: "ZZBeingAndTime", authors: ["Heidegger"], kind: "book", status: "reading", tags: [], notes: "", sections: [], progress: { status: "not_started", percent: 0, readPassageIds: [] }, sourceMetadata: { importFormat: "pdf", addMethod: "upload", filename: "being.pdf", mimeType: "application/pdf", sizeBytes: 1234, contentHash: "cafe", originalStored: true, originalStoragePath: "u1/doc1/being.pdf" }, createdAt: iso(T), updatedAt: iso(T) }],
});

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  /** A fresh, genuinely cold device. */
  const newDevice = async (viewport, mobile) => {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${VP}: ${e.message}`));
    return { ctx, page };
  };
  const seed = async (page, state) => {
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(state)]);
  };
  const visit = async (page, route) => {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    return (await page.$eval("body", (n) => n.textContent || "")).replace(/\s+/g, " ");
  };
  const readStore = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
  const syncChip = (page) => page.evaluate(() => {
    const el = document.querySelector("[data-sync-status]");
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { found: true, text: (el.textContent || "").trim(), state: el.getAttribute("data-sync-status"), w: r.width, h: r.height, display: cs.display, visible: r.width > 0 && r.height > 0 && cs.display !== "none" };
  });
  const originalChip = (page) => page.evaluate(() => {
    const el = document.querySelector("[data-original-status]");
    const btn = document.querySelector("[data-original-open]");
    return { state: el?.getAttribute("data-original-status") ?? null, text: (el?.textContent || "").trim(), hasOpen: !!btn };
  });

  for (const vp of [{ label: "DESKTOP", viewport: { width: 1280, height: 2400 }, mobile: false },
                    { label: "MOBILE", viewport: { width: 390, height: 844 }, mobile: true }]) {
    VP = vp.label;
    const isMobile = vp.mobile;

    // ================================================================
    // 0. THE HARNESS ITSELF: are these really two devices? (§8, §16)
    // ================================================================
    const A = await newDevice(vp.viewport, isMobile);
    const B = await newDevice(vp.viewport, isMobile);

    await seed(A.page, WORLD());
    await B.page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });

    ok("I1 Device A holds its own state", (await readStore(A.page))?.includes("ZZAccountantCall") === true);
    ok("I2 Device B's storage is EMPTY — nothing leaked across contexts",
      !(await readStore(B.page))?.includes("ZZAccountantCall"), String(await readStore(B.page)).slice(0, 80));
    await B.page.evaluate(() => sessionStorage.setItem("probe", "B-only"));
    ok("I3 sessionStorage is partitioned too",
      (await A.page.evaluate(() => sessionStorage.getItem("probe"))) === null);
    ok("I4 …and B has its own", (await B.page.evaluate(() => sessionStorage.getItem("probe"))) === "B-only");
    const dbA = await A.page.evaluate(async () => { try { const l = await indexedDB.databases(); return l.length; } catch { return -1; } });
    const dbB = await B.page.evaluate(async () => { try { await new Promise((r) => { const q = indexedDB.open("probe75"); q.onsuccess = r; q.onerror = r; }); const l = await indexedDB.databases(); return l.map((d) => d.name).includes("probe75"); } catch { return null; } });
    const dbA2 = await A.page.evaluate(async () => { try { const l = await indexedDB.databases(); return l.map((d) => d.name).includes("probe75"); } catch { return null; } });
    ok("I5 IndexedDB is partitioned — B's database is invisible to A",
      dbB === true && dbA2 === false, JSON.stringify({ dbA, dbB, dbA2 }));
    ok("I6 the two devices are separate JS realms (separate store singletons)",
      (await A.page.evaluate(() => { window.__probe75 = 1; return 1; })) === 1 &&
      (await B.page.evaluate(() => typeof window.__probe75)) === "undefined");

    // ================================================================
    // 1. DEVICE A: the account renders on the device that made it.
    // ================================================================
    const aActions = await visit(A.page, "/actions");
    ok("A1 Device A shows its dated action", aActions.includes("ZZAccountantCall"));
    ok("A2 Device A shows its recurring action", aActions.includes("ZZWaterPlants"));
    ok("A3 Device A counts the waiting action", /Waiting · 1/.test(aActions), aActions.slice(0, 200));
    ok("A4 Device A shows its reading", (await visit(A.page, "/reading")).includes("ZZBeingAndTime"));
    ok("A5 Device A shows its note", (await visit(A.page, "/notes")).includes("ZZSaidFriday"));
    ok("A6 Device A shows its goal", (await visit(A.page, "/goals")).includes("ZZFinancialOrder"));

    // ================================================================
    // 2. §13 COLD START: Device B, empty, must not invent anything.
    // ================================================================
    const bEmpty = await visit(B.page, "/actions");
    ok("B1 a genuinely cold device shows no records", !bEmpty.includes("ZZAccountantCall"));
    ok("B2 …and does not crash or blank — the page renders", bEmpty.includes("Next actions"), bEmpty.slice(0, 120));
    ok("B3 …and reports local-only honestly", (await syncChip(B.page)).text === "Saved locally", JSON.stringify(await syncChip(B.page)));
    ok("B4 …and invents no reading", !(await visit(B.page, "/reading")).includes("ZZBeingAndTime"));

    // ================================================================
    // 3. §13/§4 THE HOP: exactly what A stored arrives at B.
    // ================================================================
    const carried = await readStore(A.page);
    await B.page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, carried]);

    const bActions = await visit(B.page, "/actions");
    ok("C1 §4 Device B receives the dated action", bActions.includes("ZZAccountantCall"));
    ok("C2 §4 …the recurring action", bActions.includes("ZZWaterPlants"));
    ok("C3 §4 …and the waiting action, still classified as waiting", /Waiting · 1/.test(bActions));
    ok("C4 §4 Device B receives the reading", (await visit(B.page, "/reading")).includes("ZZBeingAndTime"));
    ok("C5 §4 Device B receives the note text exactly", (await visit(B.page, "/notes")).includes("ZZSaidFriday"));
    ok("C6 §4 Device B receives the goal", (await visit(B.page, "/goals")).includes("ZZFinancialOrder"));
    const bDoc = await visit(B.page, "/document/doc1");
    ok("C7 §25 Device B can open the reading itself", bDoc.includes("ZZBeingAndTime"), bDoc.slice(0, 150));
    ok("C8 §5 …with the author preserved", bDoc.includes("Heidegger"));

    // §19 relationships, read through the UI rather than the model.
    const bProject = await visit(B.page, "/plan");
    ok("C9 §19 the planning board renders on Device B", bProject.includes("Planning board"));
    const aState = JSON.parse(carried);
    ok("C10 §19 the carried state kept Action -> Project",
      aState.nextActions.find((x) => x.id === "a1")?.projectId === "p1");
    ok("C11 §19 …and Project -> Goal", aState.projects[0]?.goalId === "g1");
    ok("C12 §18 extracted text travels; the semantic index does NOT and is not claimed to",
      Array.isArray(aState.documents[0].sections) && aState.embeddings.length === 0);

    // ================================================================
    // 4. §5/§12/§23 FILE STATE ON DEVICE B.
    // ================================================================
    // Back to the document first. The first draft read this chip straight after
    // section 3 left the browser on /plan, and reported "no original state" for
    // a page that has none — a harness bug dressed as a product finding.
    const bDoc2 = await visit(B.page, "/document/doc1");
    const chip = await originalChip(B.page);
    ok("D1 §5 file metadata reached Device B",
      aState.documents[0].sourceMetadata.filename === "being.pdf" &&
      aState.documents[0].sourceMetadata.sizeBytes === 1234 &&
      aState.documents[0].sourceMetadata.mimeType === "application/pdf");
    ok("D2 §5 …including the path needed to fetch the blob",
      aState.documents[0].sourceMetadata.originalStoragePath === "u1/doc1/being.pdf");
    // With no Supabase in this environment the honest answer is that we cannot
    // reach storage — and the UI must say that rather than claim safety.
    ok("D3 §4 the reader does NOT claim 'safely stored' without resolving the object",
      chip.state !== "stored" && !/safely stored/i.test(bDoc2), JSON.stringify(chip));
    ok("D4 §4 …it reports the honest local-only outcome instead",
      chip.state === "signed-out" && /Sign in to open the original/i.test(chip.text), JSON.stringify(chip));
    ok("D5 §12 no Open control is offered for an unresolvable original", chip.hasOpen === false);
    ok("D6 §23 the reading itself is fully usable regardless of the original",
      bDoc.includes("ZZBeingAndTime") && bDoc.includes("Ask & study"));

    // A document whose original was never stored shows nothing about originals.
    const noOriginal = JSON.parse(carried);
    noOriginal.documents[0].sourceMetadata = { importFormat: "paste", addMethod: "paste" };
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(noOriginal)]);
    const pasteDoc = await visit(B.page, "/document/doc1");
    ok("D7 a pasted reading claims nothing about an original file",
      (await originalChip(B.page)).state === null && !/original/i.test(pasteDoc.slice(0, 400)), pasteDoc.slice(0, 160));

    // §11 transient upload state from another device must not be shown here.
    const transient = JSON.parse(carried);
    transient.documents[0].sourceMetadata.originalBackup = "uploading";
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(transient)]);
    await visit(B.page, "/document/doc1");
    const tChip = await originalChip(B.page);
    ok("D8 §11 C-5: Device B never shows an upload IT is not running",
      tChip.state !== "uploading", JSON.stringify(tChip));
    const failed = JSON.parse(carried);
    failed.documents[0].sourceMetadata = { ...failed.documents[0].sourceMetadata, originalStored: false, originalBackup: "failed" };
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(failed)]);
    const fDoc = await visit(B.page, "/document/doc1");
    ok("D9 §11 …and offers no Retry it cannot perform",
      !/Retry backup/.test(fDoc), fDoc.slice(0, 200));
    ok("D10 §11 …while still telling the truth about the file not being stored",
      /isn’t stored|isn't stored|wasn’t backed up|wasn't backed up/.test(fDoc), fDoc.slice(0, 300));

    // ================================================================
    // 5. §15 DELETION PROPAGATION, as the user sees it.
    // ================================================================
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, carried]);
    const deleted = JSON.parse(carried);
    deleted.documents = [];
    deleted.citations = [];
    await A.page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await A.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(deleted)]);
    ok("E1 §15 the reading is gone on the device that deleted it",
      !(await visit(A.page, "/reading")).includes("ZZBeingAndTime"));
    // The suppressed state is what a repaired adoption produces on Device B.
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(deleted)]);
    ok("E2 §15 …and gone on Device B once the deletion is adopted",
      !(await visit(B.page, "/reading")).includes("ZZBeingAndTime"));
    ok("E3 §15 the rest of the account is untouched by the deletion",
      (await visit(B.page, "/actions")).includes("ZZAccountantCall"));
    const goneDoc = await visit(B.page, "/document/doc1");
    ok("E4 §15 the deleted reading's own page no longer serves it",
      !goneDoc.includes("Heidegger"), goneDoc.slice(0, 150));

    // ================================================================
    // 6. §14 LOCAL CLEAR AND RECOVERY.
    // ================================================================
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, carried]);
    ok("F1 Device B has the account before the clear",
      (await visit(B.page, "/actions")).includes("ZZAccountantCall"));
    await B.page.evaluate(() => localStorage.clear());
    const cleared = await visit(B.page, "/actions");
    ok("F2 §14 after clearing local data the device is genuinely empty", !cleared.includes("ZZAccountantCall"));
    ok("F3 §14 …and still renders rather than breaking", cleared.includes("Next actions"));
    ok("F4 §14 …and does not claim to be synced", (await syncChip(B.page)).text === "Saved locally");
    // Recovery is the whole point: remotely-held data comes back.
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, carried]);
    const recovered = await visit(B.page, "/actions");
    ok("F5 §14/§30 clearing local data did not destroy the account — it comes back",
      recovered.includes("ZZAccountantCall") && recovered.includes("ZZWaterPlants"));
    ok("F6 §30 …including the reading and its file metadata",
      (await visit(B.page, "/reading")).includes("ZZBeingAndTime"));

    // ================================================================
    // 7. §3/§14/§27 SYNC VOCABULARY, on the rendered indicator.
    // ================================================================
    await B.page.goto(`${BASE}/dev/sync-tests`, { waitUntil: "domcontentloaded" });
    await B.page.waitForTimeout(700);
    const setHealth = async (label) => {
      await B.page.click(`[data-health-state="${label}"]`);
      await B.page.waitForTimeout(250);
      return syncChip(B.page);
    };
    const synced = await setHealth("synced");
    ok("G1 §14 confirmed remote durability reads 'Synced', not the vaguer 'Saved'",
      synced.text.startsWith("Synced") && !/^Saved$/.test(synced.text), JSON.stringify(synced));
    /**
     * C-6, REPAIRED by LIFEOS-076 §4.
     *
     * This block used to assert the defect: on a phone a healthy state was
     * `display:none`, so a person could not answer "is this only on this
     * device?" at all. 076 collapsed the LABEL instead of the control, leaving
     * a 44x44 tap target that opens a status popover. Both halves of the
     * original tension now hold — calm states stay quiet, and the answer is
     * still reachable.
     */
    ok("G2 §14 a calm state is quiet but never absent",
      synced.visible === true, JSON.stringify(synced));
    ok("G2b §27 C-6 FIXED: the durability answer is reachable at every viewport",
      synced.w >= (isMobile ? 44 : 20) && synced.h >= (isMobile ? 44 : 12), JSON.stringify(synced));
    const incomplete = await setHealth("incomplete");
    ok("G3 §3 a partial run reads 'Sync incomplete' and never 'Synced'",
      incomplete.text.includes("Sync incomplete") && !incomplete.text.includes("Synced"), JSON.stringify(incomplete));
    // LIFEOS-076 §1 moved recovery one tap inside the status popover, at a
    // finger-sized target instead of the 30x16 link this used to find.
    await B.page.click("[data-sync-status]");
    await B.page.waitForTimeout(220);
    ok("G4 §11 …and offers a reachable Retry", !!(await B.page.$("[data-sync-retry]")));
    await B.page.keyboard.press("Escape");
    await B.page.waitForTimeout(150);
    ok("G5 §26 …and is visible even on a phone", incomplete.visible, JSON.stringify(incomplete));
    /**
     * LIFEOS-076 §5 made this MORE truthful, which is why the expectation moved.
     *
     * `setHealth` used to mint a `lastSyncAt` on any transition into "synced",
     * including one where nothing had been pushed — so a later failure looked
     * like a regression from a real sync and read "Sync failed". Now the
     * timestamp is written only by a confirmed push, so in this harness (where
     * none occurs) a failure correctly reads "Not yet synced": nothing was lost,
     * because nothing had ever reached the cloud.
     *
     * Both readings are asserted — the soft one with no prior sync, and the
     * hard one once a confirmed sync exists on this device.
     */
    const failedH = await setHealth("failed");
    ok("G6 §3 a failure with NO prior successful sync reads 'Not yet synced'",
      failedH.text.includes("Not yet synced"), JSON.stringify(failedH));
    await B.page.evaluate(() => localStorage.setItem("lifeos.lastSync.v1", new Date(Date.now() - 120_000).toISOString()));
    await B.page.reload({ waitUntil: "domcontentloaded" });
    await B.page.waitForTimeout(700);
    const hardFail = await setHealth("failed");
    ok("G6b §3 …but a failure AFTER a confirmed sync reads 'Sync failed'",
      hardFail.text.includes("Sync failed"), JSON.stringify(hardFail));
    await B.page.evaluate(() => localStorage.removeItem("lifeos.lastSync.v1"));
    ok("G7 §3 …and neither reading is any kind of 'Saved'",
      !/Saved/.test(failedH.text) && !/Saved/.test(hardFail.text), JSON.stringify({ failedH: failedH.text, hardFail: hardFail.text }));
    const localErr = await setHealth("local-error");
    ok("G8 §3 a failed LOCAL write says so explicitly",
      localErr.text.includes("Local save failed"), JSON.stringify(localErr));
    ok("G9 §3 …and outranks any remote success being reported at the same time",
      !localErr.text.includes("Synced"), JSON.stringify(localErr));
    ok("G10 §26 …and is visible at this viewport", localErr.visible, JSON.stringify(localErr));
    ok("G11 §27 the vocabulary is answerable without a debug route — it is in the app shell",
      (await syncChip(B.page)).found === true);
    // On a PRODUCT surface. The first draft sampled /dev/sync-tests, which names
    // Supabase legitimately because it is a developer page — the check would
    // have failed for a reason that has nothing to do with what a user sees.
    const productText = (await visit(B.page, "/reading")) + (await visit(B.page, "/actions"));
    ok("G12 §28 no provider or infrastructure word reaches a product surface",
      !/supabase|postgres|bucket|object key|signed url/i.test(productText),
      (productText.match(/supabase|postgres|bucket|object key|signed url/i) || [])[0] ?? "");

    // ================================================================
    // 8. §10 OFFLINE, as the person experiences it.
    // ================================================================
    await B.page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, carried]);
    const onlineActions = await visit(B.page, "/actions");
    ok("H0 the account is loaded before the network is cut", onlineActions.includes("ZZAccountantCall"));

    // Going offline BEFORE a full page load fails at the network layer — the app
    // ships no service worker, so that is a browser fact, not a durability
    // finding, and asserting it would be blaming the product for the harness.
    // What 075 actually claims is that local-first data stays yours while the
    // network is gone: the loaded app keeps rendering it, the store keeps
    // reading it, and nothing claims to be synced.
    await B.ctx.setOffline(true);
    const stillRendered = (await B.page.$eval("body", (n) => n.textContent || "")).replace(/\s+/g, " ");
    ok("H1 §10 the loaded account keeps rendering with the network gone",
      stillRendered.includes("ZZAccountantCall"));
    ok("H2 §10 …and local storage is still readable offline",
      (await readStore(B.page))?.includes("ZZBeingAndTime") === true);
    ok("H3 §10 …and nothing claims remote durability while offline",
      !/^Synced/.test((await syncChip(B.page)).text), JSON.stringify(await syncChip(B.page)));
    ok("H4 §10 a mutation made offline is still written locally",
      await B.page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.notes.push({ id: "n-offline", title: "ZZOfflineNote", body: "written with no network", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [], linkedEntityRefs: [] }); localStorage.setItem(k, JSON.stringify(s)); return JSON.parse(localStorage.getItem(k)).notes.some((n) => n.id === "n-offline"); }, KEY));

    await B.ctx.setOffline(false);
    const back = await visit(B.page, "/notes");
    ok("H5 §10 reconnecting loses nothing, including the offline mutation",
      back.includes("ZZSaidFriday") && back.includes("ZZOfflineNote"), back.slice(0, 200));

    await A.ctx.close();
    await B.ctx.close();
  }

  VP = "BOTH";
  ok("Z1 no uncaught page errors across the whole run", errors.length === 0, errors.slice(0, 4).join(" | "));

  const failed = results.filter((r) => !r.p);
  const d = results.filter((r) => r.vp === "DESKTOP").length, m = results.filter((r) => r.vp === "MOBILE").length;
  console.log(`\n=== ${results.length - failed.length}/${results.length} cross-device browser assertions (${d} desktop, ${m} mobile) ===`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
