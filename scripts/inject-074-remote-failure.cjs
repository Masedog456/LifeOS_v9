/**
 * LIFEOS-074 §3 — FAILURE INJECTION against the real Supabase adapter.
 *
 * The question is never "did it throw" but "what does the persisted system
 * believe afterwards". Every case records what actually reached the fake
 * database, so a silently-skipped write is visible.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const { SupabasePersistenceAdapter, rowToAction, actionToRow, rowToSession, sessionToRow } = require("@/lib/adapters/supabaseAdapter");
const { STORE_DOMAINS } = require("@/lib/ux/backup");
const St = require("@/lib/mvpStore");
const { readRule } = require("@/lib/time/recurrence");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };
const log = [];

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const emptyState = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));

/**
 * A fake Supabase client that records every write and can be told to fail in a
 * SPECIFIC SHAPE — not just "throw a clean exception" (§12).
 *
 *   shape: "error"          → PostgREST-style { error } on the named table
 *   shape: "reject"         → the promise itself rejects (network)
 *   shape: "malformed"      → resolves with NO `error` key at all
 *   shape: "stale-success"  → resolves { error: null } but records nothing
 *   shape: "commit-timeout" → records the write, THEN rejects
 */
function fakeClient(opts = {}) {
  const db = new Map();        // table -> Map(id -> row)
  const calls = [];            // {table, op, n}
  const put = (table, rows) => {
    const t = db.get(table) ?? new Map();
    for (const r of rows) t.set(r.id ?? JSON.stringify(r), r);
    db.set(table, t);
  };
  const fail = (table, op) => {
    const f = opts.fail;
    if (!f) return null;
    if (f.table !== table) return null;
    if (f.op && f.op !== op) return null;
    if (typeof f.times === "number") { if (f.done >= f.times) return null; f.done = (f.done ?? 0) + 1; }
    return f.shape ?? "error";
  };
  const result = (table, op, rows) => {
    calls.push({ table, op, n: rows?.length ?? 0 });
    const shape = fail(table, op);
    if (!shape) { if (op === "upsert") put(table, rows); return Promise.resolve({ error: null, data: rows }); }
    if (shape === "reject") return Promise.reject(new Error(`network down writing ${table}`));
    if (shape === "malformed") return Promise.resolve({ data: rows });            // no `error` key
    if (shape === "stale-success") return Promise.resolve({ error: null });        // claims ok, stores nothing
    if (shape === "commit-timeout") { put(table, rows); return Promise.reject(new Error(`timeout after committing ${table}`)); }
    return Promise.resolve({ error: { message: `constraint violation on ${table}` } });
  };
  const from = (table) => ({
    upsert: (rows) => result(table, "upsert", Array.isArray(rows) ? rows : [rows]),
    delete: () => ({ in: (_c, ids) => {
      calls.push({ table, op: "delete", n: ids.length });
      const shape = fail(table, "delete");
      if (shape === "reject") return Promise.reject(new Error(`network down deleting ${table}`));
      if (shape) return Promise.resolve({ error: { message: `cannot delete from ${table}` } });
      const t = db.get(table); if (t) for (const id of ids) t.delete(id);
      return Promise.resolve({ error: null });
    } }),
    select: () => { const q = Promise.resolve({ data: [...(db.get(table)?.values() ?? [])], error: null }); q.order = () => q; q.eq = () => q; return q; },
  });
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }, db, calls };
}

const rowsIn = (db, table) => [...(db.get(table)?.values() ?? [])];

// ==========================================================================
// §3. REMOTE PUSH FAILURE
// ==========================================================================
(async () => {
  const world = () => {
    const s = emptyState();
    s.workspaces = [{ id: "w1", name: "Home", createdAt: iso(T), updatedAt: iso(T), items: [], pinned: [], goals: [], archived: false }];
    s.goals = [{ id: "g1", title: "Move house", description: "", status: "active", priority: "medium", notes: "", tags: [], linkedKnowledge: [], workspaceIds: [], createdAt: iso(T), updatedAt: iso(T) }];
    s.nextActions = [
      act({ id: "a1", title: "File the return", createdAt: iso(T), dueDate: T }),
      act({ id: "a2", title: "Chase surveyor", createdAt: iso(T) }),
    ];
    s.recurrenceCompletions = [{ id: "rc1", actionId: "a1", occurrenceDate: T, completedAt: iso(T) }];
    return s;
  };

  // ---- 3.1 one dirty domain, clean failure ------------------------------
  {
    const { client, db, calls } = fakeClient({ fail: { table: "next_actions", shape: "error" } });
    const ad = new SupabasePersistenceAdapter(client);
    let threw = null;
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch (e) { threw = e.message; }
    ok("3.1 a failing domain propagates the failure to the caller", !!threw, String(threw));
    ok("3.2 …and nothing from that domain reached the database", rowsIn(db, "next_actions").length === 0, JSON.stringify(calls));
  }

  // ---- 3.3 multiple dirty domains, ONE bad ------------------------------
  {
    const { client, db, calls } = fakeClient({ fail: { table: "goals", shape: "error" } });
    const ad = new SupabasePersistenceAdapter(client);
    let threw = null;
    try { await ad.saveState(world(), new Set(["workspaces", "goals", "nextActions", "recurrenceCompletions"]), null); } catch (e) { threw = e.message; }
    const wsWritten = rowsIn(db, "workspaces").length;
    const naWritten = rowsIn(db, "next_actions").length;
    log.push(`3.3 calls after goals failure: ${JSON.stringify(calls)}`);
    ok("3.3 the failure surfaces", !!threw, String(threw));
    ok("3.4 domains BEFORE the bad one are already committed", wsWritten === 1, `workspaces=${wsWritten}`);
    // PINNED, NOT ENDORSED (D-22, a BROAD P2 reported rather than rewritten).
    //
    // `saveState` is one sequential await chain across ~46 domains with no
    // per-domain isolation, so a persistent failure in an early domain starves
    // every later one for as long as it persists. This asserts the CURRENT
    // behaviour so it is visible and measured; it is written to FAIL the day
    // isolation is implemented, which is the signal to delete it.
    ok("3.5 PINNED: one failing domain aborts every domain after it (D-22, broad P2)",
      naWritten === 0, `next_actions=${naWritten} — isolation appears to be implemented; retire this pin`);
    ok("3.5b …while domains before it stay committed, so a push is a PREFIX, not all-or-nothing",
      wsWritten === 1 && naWritten === 0, JSON.stringify({ wsWritten, naWritten }));
  }

  // ---- 3.6 one malformed ROW among valid rows ---------------------------
  {
    const { client, db } = fakeClient({ fail: { table: "next_actions", shape: "error" } });
    const ad = new SupabasePersistenceAdapter(client);
    const s = world();
    s.nextActions = [act({ id: "a1", title: "Good", createdAt: iso(T) }), act({ id: "a2", title: "Bad", createdAt: iso(T) })];
    let threw = null;
    try { await ad.saveState(s, new Set(["nextActions"]), null); } catch (e) { threw = e.message; }
    ok("3.6 a rejected batch does not partially commit", !!threw && rowsIn(db, "next_actions").length === 0);
  }

  // ---- 3.7 transient failure then retry ---------------------------------
  {
    const f = { table: "next_actions", shape: "error", times: 1, done: 0 };
    const { client, db, calls } = fakeClient({ fail: f });
    const ad = new SupabasePersistenceAdapter(client);
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch { /* first attempt fails */ }
    await ad.saveState(world(), new Set(["nextActions"]), null); // retry
    ok("3.7 a retry after a transient failure succeeds", rowsIn(db, "next_actions").length === 2, JSON.stringify(calls));
    ok("3.8 …and does not duplicate rows", rowsIn(db, "next_actions").filter((r) => r.id === "a1").length === 1);
  }

  // ---- 3.9 persistent failure, three retries ----------------------------
  {
    const { client, db, calls } = fakeClient({ fail: { table: "next_actions", shape: "error" } });
    const ad = new SupabasePersistenceAdapter(client);
    for (let i = 0; i < 3; i++) { try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch { /* expected */ } }
    ok("3.9 a persistent failure never half-commits the domain", rowsIn(db, "next_actions").length === 0);
    ok("3.10 …and every attempt is a fresh full push, not an accumulating one",
      calls.filter((c) => c.table === "next_actions").every((c) => c.n === 2), JSON.stringify(calls));
  }

  // ==========================================================================
  // §12. ADVERSARIAL FAILURE SHAPES — not just clean exceptions
  // ==========================================================================

  // 12.1 the promise REJECTS (network), rather than resolving with an error
  {
    const { client, db } = fakeClient({ fail: { table: "next_actions", shape: "reject" } });
    const ad = new SupabasePersistenceAdapter(client);
    let threw = null;
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch (e) { threw = e.message; }
    ok("12.1 a rejected promise (network) is surfaced, not swallowed", !!threw && /network down/.test(threw), String(threw));
    ok("12.2 …and nothing was written", rowsIn(db, "next_actions").length === 0);
  }

  // 12.3 MALFORMED SUCCESS: resolves with no `error` key at all
  {
    const { client, db } = fakeClient({ fail: { table: "next_actions", shape: "malformed" } });
    const ad = new SupabasePersistenceAdapter(client);
    let threw = null;
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch (e) { threw = e.message; }
    const wrote = rowsIn(db, "next_actions").length;
    ok("12.3 a response with no `error` key does not crash the adapter", threw === null, String(threw));
    // D-23 (P3). What is PROVEN here is a property of the code: success is
    // judged solely by `error` being falsy — `data` and any affected-row count
    // are never read — so a success-SHAPED response that wrote nothing is
    // accepted. Whether that shape occurs in production is NOT proven: inserts
    // cannot be silently filtered (`user_id` defaults to `auth.uid()` and the
    // insert policy checks exactly that), and the update-policy path needs an
    // id collision across accounts. No production Supabase here to settle it,
    // so the code property is asserted and the reachability is reported.
    ok("12.4 D-23: a success-shaped response that stored nothing is accepted as success",
      threw === null && wrote === 0, `threw=${threw} stored=${wrote}`);
  }

  // 12.5 STALE SUCCESS: claims { error: null } but stores nothing
  {
    const { client, db } = fakeClient({ fail: { table: "next_actions", shape: "stale-success" } });
    const ad = new SupabasePersistenceAdapter(client);
    let threw = null;
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch (e) { threw = e.message; }
    ok("12.5 a stale success response is indistinguishable from success (documented, not asserted away)",
      threw === null && rowsIn(db, "next_actions").length === 0,
      "adapter trusts the driver's error contract — noted in the report");
  }

  // 12.6 TIMEOUT AFTER COMMIT: the row landed, then the call rejected
  {
    const { client, db } = fakeClient({ fail: { table: "next_actions", shape: "commit-timeout" } });
    const ad = new SupabasePersistenceAdapter(client);
    try { await ad.saveState(world(), new Set(["nextActions"]), null); } catch { /* expected */ }
    const after = rowsIn(db, "next_actions").length;
    ok("12.6 a timeout after commit leaves the row committed", after === 2, `stored=${after}`);
    // Now the retry: the push is an UPSERT keyed by id, so replay is idempotent.
    const { client: c2, db: db2 } = fakeClient();
    const ad2 = new SupabasePersistenceAdapter(c2);
    await ad2.saveState(world(), new Set(["nextActions"]), null);
    await ad2.saveState(world(), new Set(["nextActions"]), null);
    ok("12.7 replaying the same push is idempotent (upsert by id)",
      rowsIn(db2, "next_actions").length === 2 && rowsIn(db2, "next_actions").filter((r) => r.id === "a1").length === 1);
  }

  // ==========================================================================
  // §4. MALFORMED REMOTE ROWS — the parser must degrade, never invent
  // ==========================================================================
  {
    const base = actionToRow(act({ id: "x", title: "Subject", createdAt: iso(T) }));

    const badRule = rowToAction({ ...base, recurrence: { frequency: "fortnightly", interval: 1 } });
    ok("4.1 an unreadable recurrence rule is DROPPED, not coerced", badRule.recurrence === undefined, JSON.stringify(badRule.recurrence));

    const halfRule = rowToAction({ ...base, recurrence: { frequency: "monthly", interval: 1 } }); // no dayOfMonth
    ok("4.2 an incomplete monthly rule does not become a different valid rule",
      halfRule.recurrence === undefined || !!readRule(halfRule.recurrence), JSON.stringify(halfRule.recurrence));

    const strRule = rowToAction({ ...base, recurrence: "every day" });
    ok("4.3 a recurrence that is a bare string is refused", strRule.recurrence === undefined, JSON.stringify(strRule.recurrence));

    const nullRule = rowToAction({ ...base, recurrence: null });
    ok("4.4 a null recurrence stays absent", nullRule.recurrence === undefined);

    const badTime = rowToAction({ ...base, due_time: "25:99" });
    ok("4.5 a malformed due time is not silently kept as a valid time",
      badTime.dueTime === undefined || !/^([01]\d|2[0-3]):[0-5]\d$/.test(badTime.dueTime),
      JSON.stringify(badTime.dueTime));

    const badStatus = rowToAction({ ...base, status: "exploded" });
    ok("4.6 an impossible status does not crash the parser", typeof badStatus.status === "string", JSON.stringify(badStatus.status));

    const noHistory = rowToAction({ ...base, history: null });
    ok("4.7 missing history degrades to an empty log, never null", Array.isArray(noHistory.history), JSON.stringify(noHistory.history));

    const dangling = rowToAction({ ...base, project_id: "does-not-exist" });
    ok("4.8 a dangling projectId is preserved verbatim, not invented or dropped", dangling.projectId === "does-not-exist");

    const sess = rowToSession({ ...sessionToRow({ id: "s1", workspaceId: "w1", type: "planning", goal: "", startedAt: iso(T), activity: [] }), current_action_id: "gone" });
    ok("4.9 a dangling currentActionId survives the mapper without inventing a target", sess.currentActionId === "gone");
  }

  // ==========================================================================
  // §5. MISSING REFERENCES — no ghost UI, no false blocker, no wedge
  // ==========================================================================
  {
    const { buildTodayIndexes } = require("@/lib/today/indexes");
    const { buildDailyExecutiveView, dailyStrings } = require("@/lib/today/daily");
    const { buildRangeReview } = require("@/lib/memory/week");
    const { dependencyNeighbours } = require("@/lib/actions/relationships");

    const s = emptyState();
    s.nextActions = [
      act({ id: "a1", title: "Orphan child", createdAt: iso(T), dueDate: T, projectId: "ghost-project", milestoneId: "ghost-ms", workspaceId: "ghost-ws", goalId: "ghost-goal" }),
      act({ id: "a2", title: "Blocked by a ghost", createdAt: iso(T), dueDate: T }),
    ];
    s.actionDependencies = [
      { id: "d1", blockerId: "ghost-blocker", blockedId: "a2", createdAt: iso(T) },
      { id: "d2", blockerId: "a1", blockedId: "ghost-blocked", createdAt: iso(T) },
    ];
    s.recurrenceCompletions = [{ id: "rc1", actionId: "ghost-action", occurrenceDate: T, completedAt: iso(T) }];
    s.sessions = [{ id: "s1", workspaceId: "ghost-ws", type: "planning", goal: "", startedAt: iso(T), activity: [], currentActionId: "ghost-action" }];

    let crashed = null, strings = [];
    try {
      const ix = buildTodayIndexes(s, T);
      const v = buildDailyExecutiveView(s, ix, T);
      strings = dailyStrings(v);
      buildRangeReview(s, { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    } catch (e) { crashed = e.message; }
    ok("5.1 every dangling reference renders without crashing", crashed === null, String(crashed));
    ok("5.2 no ghost id leaks into user-visible text", !strings.some((x) => /ghost-/.test(x)), JSON.stringify(strings.filter((x) => /ghost-/.test(x))));

    const n = dependencyNeighbours(s, "a2");
    ok("5.3 a blocker that does not exist is not rendered as a blocker",
      n.blockers.every((b) => !!b && b.id !== "ghost-blocker"), JSON.stringify(n.blockers.map((b) => b && b.id)));
    const n2 = dependencyNeighbours(s, "a1");
    ok("5.4 an edge pointing at a missing dependent does not fabricate one",
      n2.blocked.every((b) => !!b && b.id !== "ghost-blocked"), JSON.stringify(n2.blocked.map((b) => b && b.id)));

    // A completion row for an action that no longer exists must not become a line.
    const { buildAutobiographicalTimeline } = require("@/lib/memory/week");
    const tl = buildAutobiographicalTimeline(s, { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    ok("5.5 an orphaned completion row produces no autobiographical claim",
      !tl.some((e) => e.recordRef?.id === "ghost-action"), JSON.stringify(tl.map((e) => e.kind)));

    // The orphan must still SYNC — a dangling soft reference cannot wedge a push.
    const { client, db } = fakeClient();
    const ad = new SupabasePersistenceAdapter(client);
    let syncErr = null;
    try { await ad.saveState(s, new Set(["nextActions", "actionDependencies", "recurrenceCompletions", "sessions"]), null); } catch (e) { syncErr = e.message; }
    ok("5.6 dangling soft references do not wedge the push", syncErr === null, String(syncErr));
    ok("5.7 …and the orphaned rows are pushed as-is", rowsIn(db, "next_actions").length === 2);
  }

  // ==========================================================================
  // §6. DUPLICATE RECURRENCE COMPLETION
  // ==========================================================================
  {
    const seed = () => {
      const s = emptyState();
      s.nextActions = [act({ id: "r1", title: "Take meds", createdAt: iso(T), dueDate: T, recurrence: { frequency: "daily", interval: 1 } })];
      St.restoreState(s);
    };
    const comps = () => St.getSnapshot().recurrenceCompletions ?? [];

    seed();
    const first = St.completeOccurrence("r1", T);
    const second = St.completeOccurrence("r1", T);
    ok("6.1 completing the same occurrence twice is refused the second time", first === true && second === false);
    ok("6.2 …leaving exactly one completion row", comps().length === 1, JSON.stringify(comps()));
    const hist = () => (St.getSnapshot().nextActions[0].history ?? []).filter((h) => h.action === "completed");
    ok("6.3 …and one history entry", hist().length === 1, JSON.stringify(hist()));

    // A duplicate row arriving from REMOTE (two devices, same day).
    const s2 = St.getSnapshot();
    St.restoreState({ ...s2, recurrenceCompletions: [
      { id: "rcA", actionId: "r1", occurrenceDate: T, completedAt: iso(T, 8) },
      { id: "rcB", actionId: "r1", occurrenceDate: T, completedAt: iso(T, 9) },
    ] });
    const { buildAutobiographicalTimeline } = require("@/lib/memory/week");
    const tl2 = buildAutobiographicalTimeline(St.getSnapshot(), { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    const kept = tl2.filter((e) => e.kind === "recurring_completion");
    ok("6.4 two remote rows for one occurrence are ONE user-visible completion", kept.length === 1, JSON.stringify(kept.map((k) => k.detail)));

    // Undo, then a retry of the original push.
    seed();
    St.completeOccurrence("r1", T);
    St.uncompleteOccurrence("r1", T);
    ok("6.5 undo removes the completion row", comps().length === 0);
    const retry = St.completeOccurrence("r1", T);
    ok("6.6 a retry after undo is accepted (the fact was genuinely removed)", retry === true && comps().length === 1);
    const tl3 = buildAutobiographicalTimeline(St.getSnapshot(), { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    ok("6.7 …and produces exactly one completion line, not a phantom pair",
      tl3.filter((e) => e.kind === "recurring_completion").length === 1, JSON.stringify(tl3.map((e) => e.kind)));

    seed();
    St.completeOccurrence("r1", T);
    St.uncompleteOccurrence("r1", T);
    const tl4 = buildAutobiographicalTimeline(St.getSnapshot(), { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    ok("6.8 an undone completion leaves no phantom completion line",
      !tl4.some((e) => e.kind === "recurring_completion"), JSON.stringify(tl4.map((e) => e.kind)));
  }

  console.log("\n--- observations ---");
  for (const l of log) console.log(l);
  const pass = results.filter((r) => r.p).length;
  console.log(`\n=== ${pass}/${results.length} injection assertions ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
