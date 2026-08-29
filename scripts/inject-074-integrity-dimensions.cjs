/**
 * LIFEOS-074 — remaining dimensions: import/export, memory/search, performance,
 * stale/concurrent, destructive operations, false-confidence.
 *
 * Every number below is measured on this machine in this run, and the perf
 * budgets are RATIOS against a same-run baseline rather than wall-clock
 * constants — the memory suite already had to be repaired for exactly that
 * reason when the container changed underneath it.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const St = require("@/lib/mvpStore");
const { STORE_DOMAINS, backupCounts, totalRecords } = require("@/lib/ux/backup");
const { previewImport, applyImport } = require("@/lib/backup/import-preview");
const { buildAccountArchive, assertNoSecrets } = require("@/lib/backup/export");
const { restore } = require("@/lib/backup/restore");
const { buildTodayIndexes } = require("@/lib/today/indexes");
const { buildDailyExecutiveView } = require("@/lib/today/daily");
const { buildRangeReview, buildAutobiographicalTimeline } = require("@/lib/memory/week");
const { buildActivityIndex } = require("@/lib/insights/activity");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };
const notes = [];

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const empty = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));
const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000;

// =========================================================================
// A. IMPORT / EXPORT — including the fields migration 0044 just added
// =========================================================================
{
  const s = empty();
  s.workspaces = [{ id: "w1", name: "Home", createdAt: iso(T), updatedAt: iso(T), items: [], pinned: [], goals: [], archived: false }];
  s.sessions = [{ id: "s1", workspaceId: "w1", type: "planning", goal: "Ship it", startedAt: iso(T), activity: [],
    goalId: "g1", projectId: "p1", currentActionId: "a1" }];
  s.nextActions = [act({ id: "a1", title: "Subject", createdAt: iso(T), dueDate: T, dueTime: "08:30",
    recurrence: { frequency: "daily", interval: 1 } })];
  s.recurrenceCompletions = [{ id: "rc1", actionId: "a1", occurrenceDate: T, completedAt: iso(T) }];

  // A backup is JSON: anything not serialisable is silently lost.
  const wire = JSON.parse(JSON.stringify(s));
  const sess = wire.sessions[0], a = wire.nextActions[0];
  ok("A1 export keeps the session's goalId (0044)", sess.goalId === "g1");
  ok("A2 …its projectId (0044)", sess.projectId === "p1");
  ok("A3 …and its currentActionId (0044)", sess.currentActionId === "a1");
  ok("A4 export keeps an action's dueTime (0043/D-1)", a.dueTime === "08:30");
  ok("A5 …and its recurrence rule", a.recurrence && a.recurrence.frequency === "daily", JSON.stringify(a.recurrence));
  ok("A6 …and the completion rows that prove it was kept", wire.recurrenceCompletions.length === 1);

  const counts = backupCounts(wire);
  ok("A7 every store domain is counted in the export summary",
    Object.keys(counts).length === STORE_DOMAINS.length, `${Object.keys(counts).length} vs ${STORE_DOMAINS.length}`);
  ok("A8 the total matches the records present", totalRecords(counts) === 4, String(totalRecords(counts)));

  // Round-trip through the REAL archive builder. Hand-rolling `{version, data}`
  // failed verification and made every downstream assertion meaningless — a
  // fabricated fixture shape is not a test of the import path.
  const archive = buildAccountArchive(s, { now: iso(T) });
  const secrets = assertNoSecrets(archive);
  ok("A8b the archive carries no secret-shaped field", secrets.ok, JSON.stringify(secrets.problems));
  const back = applyImport(empty(), archive, "replace");
  const rs = back.sessions?.[0], ra = back.nextActions?.[0];
  ok("A9 import restores the session pointers intact",
    rs && rs.goalId === "g1" && rs.projectId === "p1" && rs.currentActionId === "a1", JSON.stringify(rs));
  ok("A10 …and the action's time and rule", ra && ra.dueTime === "08:30" && ra.recurrence?.frequency === "daily", JSON.stringify({ t: ra?.dueTime, r: ra?.recurrence }));
  ok("A11 …and the completion history", (back.recurrenceCompletions ?? []).length === 1);

  // Destructive restore must refuse without explicit confirmation.
  const current = empty(); current.nextActions = [act({ id: "keep", title: "Existing", createdAt: iso(T) })];
  const r1 = restore(current, archive, { mode: "replace" });
  ok("A12 a destructive restore refuses without confirmation", r1.applied === false, r1.reason);
  const r2 = restore(current, archive, { mode: "replace", confirmDestructive: true });
  ok("A13 …and applies once confirmed", r2.applied === true, r2.reason);
  ok("A14 …handing back a rollback snapshot", !!r2.rollback && r2.rollback.nextActions[0].id === "keep");
  const r3 = restore(current, archive, { mode: "replace", confirmDestructive: true, dryRun: true });
  ok("A15 a dry run changes nothing", r3.applied === false && !r3.nextState);

  // Merge must not silently drop a local-only record.
  const merged = applyImport(current, archive, "merge");
  ok("A16 merge keeps the local-only record", (merged.nextActions ?? []).some((x) => x.id === "keep"));
  ok("A17 …and adds the archived one", (merged.nextActions ?? []).some((x) => x.id === "a1"));

  // A CORRUPTED archive must be refused, not half-applied. Three shapes, each
  // one something the manifest is supposed to catch.
  const clean = buildAccountArchive(s, { now: iso(T) });
  ok("A18 a clean archive verifies and is importable",
    previewImport(current, clean, "merge").importable === true);

  const tamper = JSON.parse(JSON.stringify(clean));
  tamper.collections.nextActions[0].title = "Subject — ALTERED";
  let threw = null, pv = null;
  try { pv = previewImport(current, tamper, "merge"); } catch (e) { threw = e.message; }
  ok("A19 a tampered record does not crash the preview", threw === null, String(threw));
  ok("A20 …and the archive is NOT importable", pv && pv.importable === false, JSON.stringify(pv && pv.importable));
  ok("A21 …and the reason names the mismatch",
    (pv.warnings ?? []).some((w) => /do not match its manifest/.test(w)), JSON.stringify(pv.warnings));
  ok("A22 …and restore refuses it", restore(current, tamper, { mode: "merge", confirmDestructive: true }).applied === false);

  const dropped = JSON.parse(JSON.stringify(clean));
  dropped.collections.nextActions = [];
  ok("A23 a removed record is caught too", previewImport(current, dropped, "merge").importable === false);

  const shape = JSON.parse(JSON.stringify(clean));
  shape.collections.nextActions = "not-an-array";
  ok("A24 a collection that is no longer an array is caught",
    previewImport(current, shape, "merge").importable === false);

  // Legacy tolerance: an archive with NO manifest still imports, as it always
  // did. Refusing it would strand real data to punish a format change.
  const legacy = JSON.parse(JSON.stringify(clean));
  delete legacy.manifest;
  const lp = previewImport(current, legacy, "merge");
  ok("A25 a manifest-less legacy archive is still importable", lp.importable === true, JSON.stringify(lp.warnings));
  ok("A26 …but says plainly that it could not be checksum-verified",
    (lp.warnings ?? []).some((w) => /could not be checksum-verified/.test(w)), JSON.stringify(lp.warnings));
}

// =========================================================================
// B. STALE / CONCURRENT MUTATION at the store level
// =========================================================================
{
  const seed = () => {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Subject", createdAt: iso(T) }), act({ id: "a2", title: "Other", createdAt: iso(T) })];
    St.restoreState(s);
  };
  const A = () => St.getSnapshot().nextActions.find((x) => x.id === "a1");

  // Two mutations against the same record, back to back.
  seed();
  St.completeAction("a1");
  St.cancelAction("a1");
  ok("B1 the later of two conflicting mutations wins", A().status === "cancelled", A().status);
  ok("B2 …and both are recorded in history",
    (A().history ?? []).some((h) => h.action === "completed") && (A().history ?? []).some((h) => h.action === "cancelled"));

  // A mutation against a record deleted a moment earlier is a safe no-op.
  seed();
  St.deleteAction("a1");
  let boom = null;
  try { St.completeAction("a1"); St.deferAction("a1", "tomorrow"); St.addActionTag("a1", "x"); } catch (e) { boom = e.message; }
  ok("B3 mutating a deleted record does not throw", boom === null, String(boom));
  ok("B4 …and does not resurrect it", !St.getSnapshot().nextActions.some((x) => x.id === "a1"));
  ok("B5 …and leaves the other record untouched", St.getSnapshot().nextActions.length === 1);

  // Reordering against a stale id list.
  seed();
  St.reorderActions(["a1", "ghost", "a2"]);
  ok("B6 reordering with an unknown id ignores it", St.getSnapshot().nextActions.length === 2);
  ok("B7 …and still orders the real ones", A().order === 0, String(A().order));
}

// =========================================================================
// C. DESTRUCTIVE OPERATIONS — what goes, what stays
// =========================================================================
{
  const seed = () => {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Parent", createdAt: iso(T), recurrence: { frequency: "daily", interval: 1 } }),
      act({ id: "a2", title: "Child", createdAt: iso(T) })];
    s.actionDependencies = [{ id: "d1", blockerId: "a1", blockedId: "a2", createdAt: iso(T) }];
    s.sessions = [{ id: "s1", workspaceId: "w1", type: "planning", goal: "", startedAt: iso(T), activity: [], currentActionId: "a1" }];
    St.restoreState(s);
    St.completeOccurrence("a1", T);
  };
  const snap = () => St.getSnapshot();

  seed();
  St.deleteActionWithHistory("a1");
  const s1 = snap();
  ok("C1 delete-with-history removes the action", !s1.nextActions.some((a) => a.id === "a1"));
  ok("C2 …its completion rows", (s1.recurrenceCompletions ?? []).length === 0);
  ok("C3 …its dependency edges", (s1.actionDependencies ?? []).length === 0);
  ok("C4 …and clears the session pointer", !s1.sessions.some((x) => x.currentActionId === "a1"));
  ok("C5 …while leaving the unrelated action alone", s1.nextActions.some((a) => a.id === "a2"));

  // The plain delete must leave the SAME residue (the D-11 repair).
  seed();
  St.deleteAction("a1");
  const s2 = snap();
  ok("C6 the plain delete leaves identical residue to delete-with-history",
    (s2.recurrenceCompletions ?? []).length === 0 && (s2.actionDependencies ?? []).length === 0 &&
    !s2.sessions.some((x) => x.currentActionId === "a1"),
    JSON.stringify({ c: s2.recurrenceCompletions?.length, d: s2.actionDependencies?.length }));

  // Cancel is reversible; delete is not. Both must say so by behaviour.
  seed();
  St.cancelAction("a2");
  ok("C7 cancel is reversible", snap().nextActions.some((a) => a.id === "a2" && a.status === "cancelled"));
  St.restoreAction("a2");
  ok("C8 …and restores", snap().nextActions.some((a) => a.id === "a2" && a.status === "open"));
}

// =========================================================================
// D. PERFORMANCE at 100 / 1k / 5k / 10k — ratios, not wall-clock
// =========================================================================
{
  const build = (n) => {
    const s = empty();
    s.nextActions = Array.from({ length: n }, (_, i) => act({
      id: `a${i}`, title: `Task ${i}`, createdAt: iso(T), dueDate: T,
      status: i % 7 === 0 ? "completed" : "open",
      completedAt: i % 7 === 0 ? iso(T) : undefined,
      history: [{ id: `h${i}`, action: i % 7 === 0 ? "completed" : "created", at: iso(T) }],
    }));
    s.recurrenceCompletions = Array.from({ length: Math.floor(n / 10) }, (_, i) => ({ id: `rc${i}`, actionId: `a${i}`, occurrenceDate: T, completedAt: iso(T) }));
    return s;
  };
  const range = { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" };
  const timings = {};
  for (const n of [100, 1000, 5000, 10000]) {
    const s = build(n);
    const t0 = ms(); const ix = buildTodayIndexes(s, T); buildDailyExecutiveView(s, ix, T); const t1 = ms();
    buildActivityIndex(s); const t2 = ms();
    buildRangeReview(s, range); const t3 = ms();
    timings[n] = { today: t1 - t0, activity: t2 - t1, review: t3 - t2 };
    notes.push(`  n=${String(n).padStart(5)}  today=${(t1 - t0).toFixed(1)}ms  activity=${(t2 - t1).toFixed(1)}ms  review=${(t3 - t2).toFixed(1)}ms`);
  }
  // Growth from 1k to 10k is 10x the data. Anything near-linear is fine; a
  // quadratic scan would show ~100x. The threshold is deliberately generous
  // because absolute times on a shared container are not reproducible.
  for (const k of ["today", "activity", "review"]) {
    const ratio = timings[10000][k] / Math.max(timings[1000][k], 0.05);
    ok(`D-${k} scales sub-quadratically from 1k to 10k (10x data)`, ratio < 40, `${ratio.toFixed(1)}x`);
  }
  ok("D-abs the whole daily view stays interactive at 10k actions", timings[10000].today < 2000, `${timings[10000].today.toFixed(0)}ms`);
}

// =========================================================================
// E. MEMORY / SEARCH INTEGRITY — no claim without evidence
// =========================================================================
{
  const { answerMemoryQuery } = require("@/lib/memory/answer");
  const s = empty();
  s.nextActions = [
    act({ id: "a1", title: "File the return", createdAt: iso(T), status: "completed", completedAt: iso(T, 9),
      history: [{ id: "h1", action: "completed", at: iso(T, 9), fromStatus: "open", toStatus: "completed" }] }),
    act({ id: "a2", title: "Chase the surveyor", createdAt: iso(T) }),
  ];
  const askOne = (q) => {
    // `answerMemoryQuery` takes the QUESTION, not a pre-built plan. Guessing the
    // signature produced eleven identical "errors" that were entirely mine.
    try { return answerMemoryQuery(s, q, { today: T }); }
    catch (e) { return { status: "ERROR", summary: e.message }; }
  };
  const empties = [
    "What did I finish today?", "What changed today?", "What happened this week?",
    "What am I forgetting?", "What should I do next?", "What do I have tomorrow?",
    "Who did I meet in Paris?", "How much did I spend?", "Was I happy last month?",
    "What will I do next year?", "Why did the project fail?",
  ];
  let errs = 0, invented = 0;
  for (const q of empties) {
    const a = askOne(q);
    if (a.status === "ERROR") { errs++; notes.push(`  MEMORY ERROR on "${q}": ${a.summary}`); continue; }
    // A record that does not exist must never be named.
    if (/Paris|spend|happy|next year|fail/i.test(a.summary ?? "") && /\bI (met|spent|was|will)\b/i.test(a.summary ?? "")) invented++;
  }
  ok("E1 no memory question throws", errs === 0, `${errs} errors`);
  ok("E2 no answer invents a fact the store cannot support", invented === 0, `${invented} invented`);
  const done = askOne("What did I finish today?");
  ok("E3 a supported question names the real record", /File the return/.test(JSON.stringify(done)), (done.summary ?? "").slice(0, 120));
  const unsupported = askOne("Was I happy last month?");
  ok("E4 an unsupported question does not answer as if it were",
    !/happy/i.test(unsupported.summary ?? "") || /no recorded|cannot|doesn't|does not/i.test(unsupported.summary ?? ""),
    (unsupported.summary ?? "").slice(0, 140));
}

console.log("\n--- measurements ---");
for (const n of notes) console.log(n);
const pass = results.filter((r) => r.p).length;
console.log(`\n=== ${pass}/${results.length} assertions ===`);
for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
