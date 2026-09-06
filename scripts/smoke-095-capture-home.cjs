#!/usr/bin/env node
/**
 * LIFEOS-095 §40 — browser torture for the front door.
 *
 * The deterministic suite proves the decision. This proves the PAGE: that the
 * input is the first thing a fresh user and a returning user meet, that an
 * auto-safe capture finishes on submit and says what it saved, that a
 * consequential one still asks, that undo works, that a captured moment is one
 * row and not four, and that the submit button is reachable above a phone
 * keyboard — the red the brief did not predict and the one the audit found.
 */
const { chromium } = require("playwright-core");

const BASE = process.env.BASE || "http://localhost:3111";
const KEY = "lifeos.mvp.v1";
const EXEC = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const goal = (p) => ({ description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
  createdAt: at(-90), updatedAt: at(-90), ...p });
const proj = (p) => ({ description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: at(-90), updatedAt: at(-90), ...p });

/** A returning user: two projects that both partly match, and a belief to resurface. */
const RETURNING = () => ({ ...EMPTY(),
  goals: [goal({ id: "g1", title: "Graduate school", priority: "high" })],
  projects: [proj({ id: "p1", title: "Graduate applications", goalId: "g1" }),
    proj({ id: "p2", title: "Teaching portfolio" })],
  beliefs: [{ id: "b1", captureId: "cb", proposalId: "pr1", text: "Teaching is the safe path.",
    status: "accepted", revisions: [], judgments: [], createdAt: at(-120), updatedAt: at(-120) }],
});

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const store = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), KEY);

async function seed(page, world) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(world)]);
}
async function home(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#capture", { timeout: 20000 });
  await page.waitForTimeout(900);
}
async function say(page, text) {
  // The submit only exists when the box is accepting a new capture. Waiting for
  // it here turns "the previous capture went to review" into a legible failure
  // rather than a 30-second timeout filling with a disabled textarea.
  await page.waitForSelector("[data-capture-submit]", { timeout: 5000 });
  await page.fill("#capture", text);
  await page.click("[data-capture-submit]");
  await page.waitForTimeout(1200);
}
const shape = (page) => page.evaluate(() => ({
  finished: [...document.querySelectorAll("[data-capture-saved]")].map((li) => ({
    kind: li.getAttribute("data-capture-saved"),
    text: li.innerText.replace(/\s+/g, " ").trim(),
  })),
  asking: document.querySelector("[data-capture-asking]")?.textContent?.trim() ?? null,
  reviewing: document.querySelectorAll("[data-candidate]").length,
  kept: document.querySelector("[data-capture-kept]")?.textContent?.trim() ?? null,
  recent: [...document.querySelectorAll("[data-recent-capture]")].map((li) =>
    li.innerText.replace(/\s+/g, " ").trim()),
  inputValue: document.querySelector("#capture")?.value ?? null,
  inputDisabled: document.querySelector("#capture")?.disabled ?? null,
}));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];

  // ================= DESKTOP =================
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  // ---- 1, 2. The input is what you meet ---------------------------------
  for (const [who, world] of [["fresh", EMPTY()], ["returning", RETURNING()]]) {
    await seed(page, world);
    await home(page);
    const g = await page.evaluate(() => {
      const i = document.querySelector("#capture");
      const b = document.querySelector("[data-capture-submit]");
      const r = (el) => el ? el.getBoundingClientRect() : null;
      return { vh: innerHeight, input: r(i)?.top, inputBottom: r(i)?.bottom, submit: r(b)?.bottom,
        focused: document.activeElement?.id ?? "",
        onboardingAbove: [...document.querySelectorAll("[data-onboarding], [data-getting-started]")]
          .filter((el) => el.getBoundingClientRect().top < r(i).top).length };
    });
    ok(`1 §5 ${who} — the whole input is above the fold`,
      g.inputBottom <= g.vh, `bottom ${Math.round(g.inputBottom)} of ${g.vh}`);
    ok(`2 §4 ${who} — and the cursor is already in it`, g.focused === "capture", g.focused);
    ok(`3 §5 ${who} — and the submit is above the fold too`,
      g.submit <= g.vh, `${Math.round(g.submit)} of ${g.vh}`);
    ok(`4 §19 ${who} — nothing onboarding-shaped sits above it`, g.onboardingAbove === 0, String(g.onboardingAbove));
  }

  // ---- 5, 6, 7. Auto-safe captures finish -------------------------------
  await seed(page, RETURNING());
  await home(page);
  for (const [text, kind, expect] of [
    // Case-insensitive: the label is upper-cased in CSS, and asserting the
    // rendered casing would be asserting a stylesheet.
    ["Email Marcus about the lease tomorrow", "action", /saved as action[\s\S]*Email Marcus about the lease/i],
    ["I'm waiting on Maria for the transcript", "action", /saved as waiting[\s\S]*Waiting on Maria/i],
  ]) {
    await say(page, text);
    const st = await shape(page);
    ok(`5 §10 "${text.slice(0, 28)}…" finishes without a second press`,
      st.finished.length === 1 && st.reviewing === 0,
      `${st.finished.length} saved, ${st.reviewing} to review`);
    ok(`6 §10 …and says what it saved, by name`,
      expect.test(st.finished[0]?.text ?? ""), st.finished[0]?.text ?? "");
    ok(`7 §10 …leaving the field empty and ready`,
      st.inputValue === "" && st.inputDisabled === false,
      `"${st.inputValue}" disabled=${st.inputDisabled}`);
  }

  // ---- 8. Undo actually undoes -------------------------------------------
  {
    const before = await store(page);
    ok("8 §31 the wait was really written",
      before.nextActions.some((a) => a.status === "waiting" && a.waitingOn === "Maria"),
      before.nextActions.map((a) => `${a.title}/${a.status}`).join(" | "));
    await page.click("[data-capture-undo]");
    await page.waitForTimeout(900);
    const after = await store(page);
    ok("9 §31 …and Undo removes it",
      !after.nextActions.some((a) => a.waitingOn === "Maria"),
      after.nextActions.map((a) => a.title).join(","));
    ok("10 §17 …while the words stay, back in the inbox",
      after.captures.some((c) => /waiting on Maria/i.test(c.text)
        && (c.processingStatus ?? "inbox") === "inbox"),
      after.captures.map((c) => `${c.text.slice(0, 24)}/${c.processingStatus}`).join(" | "));
  }

  // ---- 11, 12. Consequential captures still ask -------------------------
  await seed(page, RETURNING());
  await home(page);
  for (const [text, why, expect] of [
    ["When I feel overwhelmed I go for a walk", "a rule about how you behave", /protocol/i],
    ["I realized teaching isn't what I want", "a low-confidence reading", /note/i],
  ]) {
    await say(page, text);
    const st = await shape(page);
    ok(`11 §32 still asks — ${why}`, st.reviewing > 0 && st.finished.length === 0,
      `${st.reviewing} to review, ${st.finished.length} saved`);
    ok(`12 §9 …and says why it is asking`, expect.test(st.asking ?? ""), String(st.asking));
    await page.click("[data-capture-results] button:last-of-type").catch(() => {});
    await home(page);
  }

  // ---- 13. A goal aspiration creates no Goal ----------------------------
  {
    await seed(page, RETURNING());
    await home(page);
    await say(page, "Apply to philosophy programs");
    const s2 = await store(page);
    ok("13 §33 an aspiration creates no Goal on its own",
      s2.goals.length === 1 && s2.goals[0].id === "g1",
      s2.goals.map((g) => g.title).join(","));
    ok("14 §31 …it becomes the ordinary action it reads as",
      s2.nextActions.some((a) => /philosophy programs/i.test(a.title)),
      s2.nextActions.map((a) => a.title).join(" | "));
  }

  // ---- 15, 16. Ambiguity is local and asked ------------------------------
  {
    await seed(page, RETURNING());
    await home(page);
    await say(page, "Follow up on the applications and the portfolio review");
    const st = await shape(page);
    ok("15 §11 a genuinely contested context asks rather than guessing",
      st.reviewing > 0 && st.finished.length === 0, `${st.reviewing}/${st.finished.length}`);
    ok("16 §13 …and says that is the reason",
      /more than one/i.test(st.asking ?? ""), String(st.asking));
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll("[data-context-ambiguous] button")].map((b) => b.textContent.trim()));
    ok("17 §13 …offering the choice right there, on the row",
      chips.includes("Graduate applications") && chips.includes("Teaching portfolio"), chips.join(" | "));
    const s3 = await store(page);
    ok("18 §22 …and nothing was written while it asked",
      (s3.nextActions ?? []).length === 0, String((s3.nextActions ?? []).length));
  }

  // ---- 19, 20, 21. The recent list ---------------------------------------
  {
    await seed(page, RETURNING());
    await home(page);
    await say(page, "Call the dentist tomorrow, finish the report, and Marcus still owes me the file");
    let st = await shape(page);
    ok("19 §10 one sentence, three records, all three named",
      st.finished.length === 3, String(st.finished.length));
    ok("19b §18 …and the recent list does not repeat what is on screen above it",
      st.recent.length === 0, st.recent.join(" | "));
    // The row exists — it is simply not shown twice. Reload and it is there,
    // once, with everything the sentence became hanging off it.
    await home(page);
    const back = await shape(page);
    ok("20 §18 one captured moment is ONE row, not four cards",
      back.recent.length === 1, `${back.recent.length} rows`);
    ok("21 §17 …and the row keeps what was actually typed",
      /Call the dentist tomorrow, finish the report/.test(back.recent[0] ?? ""), back.recent[0] ?? "");
    ok("22 §16 …beside what it became, in product words, and never a pipeline word",
      /Action/.test(back.recent[0] ?? "") && /Waiting/.test(back.recent[0] ?? "")
      && !/candidate|auto_with_undo|processingStatus|confidence/i.test(back.recent[0] ?? ""),
      back.recent[0] ?? "");

    // Six genuinely different errands. Six variations on one sentence would
    // instead exercise the duplicate guard below, which is a different test.
    await home(page);
    for (const t of ["Book the venue", "Renew the passport", "Return the library books",
      "Pay the electricity bill", "Order more coffee", "Collect the dry cleaning"]) {
      await say(page, t);
    }
    st = await shape(page);
    ok("23 §15 the recent list stays bounded however much you say",
      st.recent.length <= 4, String(st.recent.length));

    // §19 of the brief's torture list: it survives a reload, because it is
    // derived from records rather than remembered by the page.
    await home(page);
    const reloaded = await shape(page);
    ok("24 §19 a reload still shows what you captured",
      reloaded.recent.length === 4 && /Collect the dry cleaning/.test(reloaded.recent[0] ?? ""),
      reloaded.recent[0] ?? "");
    ok("25 §18 …and shows no duplicate result cards",
      reloaded.finished.length === 0, String(reloaded.finished.length));
  }

  // ---- 25b. Saying something you may already have --------------------------
  //
  // Found by a fixture that repeated one sentence six times. Against two
  // near-identical open Actions, 089 answers "Several open Actions could be
  // this one — choose which", and §31 correctly declines to finish: silently
  // writing a third copy is exactly the mistake a front door must not make.
  {
    const w = RETURNING();
    w.nextActions = [0, 1].map((i) => ({ id: `a${i}`, title: `Buy milk number ${i}`, description: "",
      status: "open", notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
      energy: "unspecified", order: 1, history: [], createdAt: at(-3), updatedAt: at(-3) }));
    await seed(page, w);
    await home(page);
    await say(page, "Buy milk number 2");
    const st = await shape(page);
    ok("25b §31 a capture that may already exist asks instead of duplicating",
      st.finished.length === 0 && st.reviewing > 0, `${st.finished.length}/${st.reviewing}`);
    const s4 = await store(page);
    ok("25c §33 …and writes nothing while it asks",
      s4.nextActions.length === 2, String(s4.nextActions.length));
  }

  // ---- 25d. The offer that would otherwise be lost -----------------------
  //
  // Found by running 089's suite against this sprint. A capture that finishes
  // by itself never renders the context panel, so a `possible`-tier suggestion
  // — which arrives switched OFF by design — was declined on the person's
  // behalf and silently. It rides on the finished state instead.
  {
    await seed(page, RETURNING());
    await home(page);
    // A `possible`-tier match: a shared distinctive word, not the whole title.
    // 089 arrives with these switched OFF, so the offer is the whole point.
    await say(page, "Book a school open day");
    const offer = await page.evaluate(() =>
      [...document.querySelectorAll("[data-capture-offer]")].map((b) => b.getAttribute("data-capture-offer")));
    ok("25d §9 an unaccepted context suggestion survives an auto-finish",
      offer.length > 0, JSON.stringify(offer));
    const pre = await store(page);
    ok("25e §32 …and nothing was linked before it was accepted",
      pre.nextActions.every((a) => !a.goalId && !a.projectId),
      pre.nextActions.map((a) => `${a.goalId ?? "-"}/${a.projectId ?? "-"}`).join(","));
    await page.click(`[data-capture-offer="${offer[0]}"]`);
    await page.waitForTimeout(800);
    const post = await store(page);
    ok("25f §9 …and accepting it writes the link",
      post.nextActions.some((a) => a.goalId || a.projectId),
      post.nextActions.map((a) => `${a.title}/${a.goalId ?? "-"}/${a.projectId ?? "-"}`).join(" | "));
    const saidSo = await page.evaluate(() =>
      document.querySelector("[data-capture-saved]")?.innerText.replace(/\s+/g, " ") ?? "");
    ok("25g §9 …and the finished state then says where it went",
      new RegExp(offer[0]).test(saidSo), saidSo);
  }
  {
    // The other half. An `exact` match — the record's whole title is in what
    // you wrote — arrives accepted, so an auto-finish WRITES it. That is only
    // acceptable because the finished state names where it went; a link nobody
    // was shown is a link nobody can correct.
    await seed(page, RETURNING());
    await home(page);
    await say(page, "Draft the essay for the graduate school application");
    const st2 = await store(page);
    const linked = st2.nextActions.find((a) => a.goalId || a.projectId);
    const saidSo = await page.evaluate(() =>
      document.querySelector("[data-capture-saved]")?.innerText.replace(/\s+/g, " ") ?? "");
    ok("25h §9 an exact context match is written on an auto-finish",
      !!linked, st2.nextActions.map((a) => `${a.title}/${a.goalId ?? "-"}/${a.projectId ?? "-"}`).join(" | "));
    ok("25i §9 …and the finished state says so, so it can be corrected",
      /Graduate school|Graduate applications/.test(saidSo), saidSo);
  }

  // ---- 26. Context suggestions stay compact ------------------------------
  {
    const w = RETURNING();
    w.nextActions = [{ id: "a1", title: "Email Marcus about the lease", description: "", status: "open",
      notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 1, history: [], createdAt: at(-2), updatedAt: at(-2) }];
    await seed(page, w);
    await home(page);
    await say(page, "Follow up on the applications and the portfolio review");
    const ctxText = await page.evaluate(() =>
      (document.querySelector("[data-capture-context]")?.innerText ?? "").replace(/\s+/g, " ").trim());
    ok("26 §12 the context block is compact",
      ctxText.length > 0 && ctxText.length < 160, `${ctxText.length} chars: ${ctxText}`);
    ok("27 §12 …and does not restate the chip beside it",
      !/appears in what you wrote.*appears in what you wrote/.test(ctxText), ctxText);
  }

  // ---- 28. Home is not a dashboard ---------------------------------------
  {
    await seed(page, RETURNING());
    await home(page);
    const layout = await page.evaluate(() => {
      const main = document.querySelector("main");
      const i = document.querySelector("#capture").getBoundingClientRect();
      return {
        sections: main.querySelectorAll("section").length,
        // Anything with a border that is NOT the input, above the input.
        panelsAbove: [...main.querySelectorAll("section, [class*=rounded-2xl]")]
          .filter((el) => el.getBoundingClientRect().bottom <= i.top).length,
        inputShare: i.width / main.getBoundingClientRect().width,
        decisions: !!document.querySelector("[data-home-decisions]"),
        decisionQuestions: document.querySelectorAll("[data-decision-question]").length,
      };
    });
    ok("28 §36 nothing is stacked above the input", layout.panelsAbove === 0, String(layout.panelsAbove));
    ok("29 §27 the input spans the column it is in", layout.inputShare > 0.85, layout.inputShare.toFixed(2));
    ok("30 §14 no decision count when the queue is empty", layout.decisions === false, String(layout.decisions));
    ok("31 §13 and never the decision queue itself", layout.decisionQuestions === 0, String(layout.decisionQuestions));
  }

  // ---- 32. The global decision count, when there is one ------------------
  {
    const w = RETURNING();
    w.goals.push(goal({ id: "g-none", title: "Learn to sail" }));
    await seed(page, w);
    await home(page);
    const d = await page.evaluate(() => ({
      text: document.querySelector("[data-home-decisions]")?.textContent?.trim() ?? "",
      questions: document.querySelectorAll("[data-decision-question]").length,
    }));
    ok("32 §14 a small secondary indicator, with a count",
      /Needs your decision · 1/.test(d.text), d.text);
    ok("33 §13 …and still not the queue", d.questions === 0, String(d.questions));
  }

  // ---- 34. Accessibility --------------------------------------------------
  {
    await seed(page, RETURNING());
    await home(page);
    const a11y = await page.evaluate(() => {
      const i = document.querySelector("#capture");
      const lab = document.querySelector('label[for="capture"]');
      return { labelled: !!lab && lab.textContent.trim().length > 0,
        labelText: lab?.textContent.trim() ?? "",
        submitIsButton: document.querySelector("[data-capture-submit]")?.tagName === "BUTTON",
        rows: i.rows };
    });
    ok("34 §44 the input is labelled", a11y.labelled, a11y.labelText);
    ok("35 §44 the submit is a real button", a11y.submitIsButton);
    await page.focus("#capture");
    await page.keyboard.type("Water the plants");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(1200);
    const st = await shape(page);
    ok("36 §44 …and the keyboard alone can capture",
      st.finished.length === 1 || st.reviewing > 0, `${st.finished.length}/${st.reviewing}`);
  }
  await ctx.close();

  // ================= MOBILE =================
  {
    // The red the brief did not predict. 508 is what a 390x844 phone leaves
    // above a standard keyboard, and it is the height that decides whether
    // this product is usable one-handed.
    for (const [label, h] of [["phone", 844], ["phone, keyboard up", 508]]) {
      const c = await browser.newContext({ viewport: { width: 390, height: h }, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(String(e)));
      await seed(p, RETURNING());
      await home(p);
      const g = await p.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        const b = r("[data-capture-submit]");
        return { vh: innerHeight, inputBottom: r("#capture")?.bottom, submitBottom: b?.bottom,
          submitH: b?.height, submitW: b?.width,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      ok(`37 §26 ${label} — the input is reachable`, g.inputBottom <= g.vh,
        `${Math.round(g.inputBottom)} of ${g.vh}`);
      ok(`38 §26 ${label} — the submit is reachable`, g.submitBottom <= g.vh,
        `${Math.round(g.submitBottom)} of ${g.vh}`);
      ok(`39 §44 ${label} — the submit is a real tap target`,
        g.submitH >= 36 && g.submitW >= 60, `${Math.round(g.submitW)}×${Math.round(g.submitH)}`);
      ok(`40 §26 ${label} — nothing scrolls sideways`, g.overflow <= 1, String(g.overflow));
      {
        // The mobile command bar is `fixed bottom-0`, so it floats over whatever
        // the page ends with. Measured on the review panel before this sprint:
        // "Confirm all", "Keep the whole thing as a note" and "Start over" were
        // all underneath it — including the escape hatch LIFEOS-060 §16
        // promises is always one click away.
        await say(p, "Follow up on the applications and the portfolio review");
        // Scrolled to the end, because "currently under the bar" is true of any
        // long page mid-scroll and is not a defect. The defect is a control
        // that CANNOT be brought clear — which is what the page's bottom
        // clearance decides.
        await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await p.waitForTimeout(400);
        const clearance = await p.evaluate(() => {
          const bar = [...document.querySelectorAll("div")].find((d) => {
            const st = getComputedStyle(d);
            const r = d.getBoundingClientRect();
            return st.position === "fixed" && st.bottom === "0px" && r.height > 20 && r.width > 200;
          });
          if (!bar) return { gap: Infinity, lowest: "" };
          const top = bar.getBoundingClientRect().top;
          const ctrls = [...document.querySelectorAll("main button, main a")]
            .filter((el) => el.getBoundingClientRect().height > 0);
          if (ctrls.length === 0) return { gap: Infinity, lowest: "" };
          const last = ctrls.reduce((a, b) =>
            a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b);
          return { gap: Math.round(top - last.getBoundingClientRect().bottom),
            lowest: last.textContent.trim().slice(0, 30) };
        });
        // Clearance, not "is it covered". Measured without the layout's bottom
        // padding, the lowest control ends TWO pixels above the bar at full
        // scroll — technically clear, and flush against a translucent floating
        // bar under a thumb. With it, 66. Sixteen tells those two apart.
        ok(`40b §26 ${label} — the last control clears the command bar`,
          clearance.gap >= 16, `${clearance.gap}px under "${clearance.lowest}"`);
        await home(p);
      }
      if (h === 844) {
        await say(p, "Email Marcus about the lease tomorrow");
        const st = await shape(p);
        ok("41 §26 phone — a capture finishes and says so", st.finished.length === 1, String(st.finished.length));
        const wrap = await p.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        ok("42 §26 phone — the finished state does not overflow", wrap <= 1, String(wrap));
      }
      await c.close();
    }
  }

  ok("43 §40 no page errors anywhere in this run", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} browser assertions`);
  process.exit(passed === results.length ? 0 : 1);
})();
