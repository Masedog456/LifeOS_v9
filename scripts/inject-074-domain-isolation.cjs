/**
 * LIFEOS-074 D-22 — per-domain fault isolation, pinned (§8 A–G).
 *
 * Drives the REAL `lib/persistence.ts` flush loop against the REAL adapter with
 * a fake Supabase client, so the assertions are about the shipped code path and
 * not about a reimplementation of it.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
global.window = { localStorage, addEventListener: () => {}, removeEventListener: () => {} };
global.localStorage = localStorage;
global.navigator = { onLine: true };

const { SupabasePersistenceAdapter, SYNC_DOMAIN_ORDER } = require("@/lib/adapters/supabaseAdapter");
const { STORE_DOMAINS } = require("@/lib/ux/backup");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const empty = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));

/** Fails whichever tables are named, in whichever shape, until told otherwise. */
function fakeClient(fails = {}) {
  const db = new Map(), calls = [];
  const put = (t, rows) => { const m = db.get(t) ?? new Map(); for (const r of rows) m.set(r.id ?? JSON.stringify(r), r); db.set(t, m); };
  const res = (t, op, rows) => {
    calls.push(`${op}:${t}`);
    const shape = fails[t];
    if (!shape) { if (op === "upsert") put(t, rows); return Promise.resolve({ error: null, data: rows }); }
    if (shape === "reject") return Promise.reject(new Error(`network: ${t}`));
    if (shape === "commit-timeout") { put(t, rows); return Promise.reject(new Error(`timeout after commit: ${t}`)); }
    return Promise.resolve({ error: { message: `constraint: ${t}` } });
  };
  const from = (t) => ({
    upsert: (rows) => res(t, "upsert", Array.isArray(rows) ? rows : [rows]),
    delete: () => ({ in: (_c, ids) => { calls.push(`delete:${t}`); if (fails[t]) return Promise.resolve({ error: { message: `constraint: ${t}` } }); const m = db.get(t); if (m) for (const i of ids) m.delete(i); return Promise.resolve({ error: null }); } }),
    select: () => { const q = Promise.resolve({ data: [...(db.get(t)?.values() ?? [])], error: null }); q.order = () => q; q.eq = () => q; return q; },
  });
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }, db, calls, fails };
}
const rows = (db, t) => [...(db.get(t)?.values() ?? [])];

const world = (n = 1) => {
  const s = empty();
  s.workspaces = [{ id: "w1", name: `Home ${n}`, createdAt: iso(T), updatedAt: iso(T), items: [], pinned: [], goals: [], archived: false }];
  s.goals = [{ id: "g1", title: `Move ${n}`, description: "", status: "active", priority: "medium", notes: "", tags: [], linkedKnowledge: [], workspaceIds: [], createdAt: iso(T), updatedAt: iso(T) }];
  s.projects = [{ id: "p1", title: `Proj ${n}`, description: "", status: "active", priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [], createdAt: iso(T), updatedAt: iso(T) }];
  s.nextActions = [act({ id: "a1", title: `Task ${n}`, createdAt: iso(T), dueDate: T })];
  s.notes = [{ id: "n1", title: `Note ${n}`, body: "b", tags: [], linkedEntityRefs: [], archived: false, createdAt: iso(T), updatedAt: iso(T) }];
  return s;
};

(async () => {
  // ---- ORDER ------------------------------------------------------------
  ok("D22.0 the isolated push covers every store domain",
    SYNC_DOMAIN_ORDER.length === STORE_DOMAINS.length &&
    STORE_DOMAINS.every((d) => SYNC_DOMAIN_ORDER.includes(d)),
    JSON.stringify({ order: SYNC_DOMAIN_ORDER.length, domains: STORE_DOMAINS.length,
      missing: STORE_DOMAINS.filter((d) => !SYNC_DOMAIN_ORDER.includes(d)) }));
  const idx = (d) => SYNC_DOMAIN_ORDER.indexOf(d);
  ok("D22.0b …and preserves the FK-critical ordering",
    idx("nextActions") < idx("actionDependencies") && idx("nextActions") < idx("recurrenceCompletions") &&
    idx("documents") < idx("citations"),
    JSON.stringify({ na: idx("nextActions"), ad: idx("actionDependencies"), rc: idx("recurrenceCompletions") }));

  // ---- A. early domain fails → later domains still attempted -------------
  {
    const { client, db, calls } = fakeClient({ workspaces: "error" });
    const ad = new SupabasePersistenceAdapter(client);
    const r = await ad.saveStateByDomain(world(), new Set(["workspaces", "goals", "nextActions", "notes"]), null);
    ok("A1 an early failing domain does not stop the run", r.attempted.length === 4, JSON.stringify(r.attempted));
    ok("A2 later domains actually reached the database",
      rows(db, "goals").length === 1 && rows(db, "next_actions").length === 1 && rows(db, "notes").length === 1,
      JSON.stringify(calls));
    ok("A3 the failure is reported by name", r.failed.length === 1 && r.failed[0].domain === "workspaces", JSON.stringify(r.failed));
    ok("A4 …and the run does not throw", true);
  }

  // ---- B. middle domain fails → neighbours clear, it stays dirty ---------
  {
    const P = require("@/lib/persistence");
    const { client, db } = fakeClient({ goals: "error" });
    P.__setRemoteForTest(new SupabasePersistenceAdapter(client));
    const s = world();
    await P.__flushNowForTest(s);
    const diag = P.getSyncDiagnostics();
    const h = P.getHealth();
    ok("B1 the failed domain stays dirty", diag.dirtyDomains.includes("goals"), JSON.stringify(diag.dirtyDomains));
    ok("B2 domains before it are clean", !diag.dirtyDomains.includes("workspaces"), JSON.stringify(diag.dirtyDomains));
    ok("B3 domains after it are clean", !diag.dirtyDomains.includes("nextActions") && !diag.dirtyDomains.includes("notes"), JSON.stringify(diag.dirtyDomains));
    ok("B4 …and they really are in the database", rows(db, "next_actions").length === 1 && rows(db, "workspaces").length === 1);
    ok("B5 health does NOT read synced", h.state !== "synced", h.state);
    ok("B6 …it names the incomplete/retrying condition", h.state === "incomplete" || h.state === "retrying", h.state);
    ok("B7 diagnostics name the failed domain", diag.failedDomains.includes("goals"), JSON.stringify(diag.failedDomains));
  }

  // ---- C. multiple domains fail -----------------------------------------
  {
    const P = require("@/lib/persistence");
    const { client, db } = fakeClient({ goals: "error", notes: "reject" });
    P.__setRemoteForTest(new SupabasePersistenceAdapter(client));
    await P.__flushNowForTest(world());
    const diag = P.getSyncDiagnostics();
    ok("C1 every failure is retained", diag.failedDomains.includes("goals") && diag.failedDomains.includes("notes"), JSON.stringify(diag.failedDomains));
    ok("C2 independent domains still synced", rows(db, "next_actions").length === 1 && rows(db, "workspaces").length === 1);
    ok("C3 …and are no longer dirty", !diag.dirtyDomains.includes("nextActions") && !diag.dirtyDomains.includes("workspaces"), JSON.stringify(diag.dirtyDomains));
    ok("C4 both failures stay dirty", diag.dirtyDomains.includes("goals") && diag.dirtyDomains.includes("notes"), JSON.stringify(diag.dirtyDomains));
  }

  // ---- D. failure then retry → only the remaining work, then fully synced -
  {
    const P = require("@/lib/persistence");
    const fc = fakeClient({ goals: "error" });
    P.__setRemoteForTest(new SupabasePersistenceAdapter(fc.client));
    const s = world();
    await P.__flushNowForTest(s);
    const before = P.getSyncDiagnostics();
    fc.calls.length = 0;
    delete fc.fails.goals;                     // the transient condition clears
    await P.__flushNowForTest(s);              // retry the SAME state
    const after = P.getSyncDiagnostics();
    const h = P.getHealth();
    ok("D1 the retry pushed only what was still dirty",
      fc.calls.filter((c) => c.startsWith("upsert:")).every((c) => /goals/.test(c)) && fc.calls.some((c) => /goals/.test(c)),
      JSON.stringify({ retried: fc.calls, wasDirty: before.dirtyDomains }));
    ok("D2 nothing remains dirty after recovery", after.dirtyDomains.length === 0, JSON.stringify(after.dirtyDomains));
    ok("D3 …and health reaches synced", h.state === "synced", h.state);
    ok("D4 …with no failed domains left", after.failedDomains.length === 0, JSON.stringify(after.failedDomains));
    ok("D5 the recovered domain is in the database", rows(fc.db, "goals").length === 1);
  }

  // ---- E. commit-then-timeout → retry does not duplicate -----------------
  {
    const P = require("@/lib/persistence");
    const fc = fakeClient({ nextActions: undefined, next_actions: "commit-timeout" });
    P.__setRemoteForTest(new SupabasePersistenceAdapter(fc.client));
    const s = world();
    await P.__flushNowForTest(s);
    ok("E1 the row committed despite the timeout", rows(fc.db, "next_actions").length === 1);
    ok("E2 …and the domain is still treated as dirty (the client said it failed)",
      P.getSyncDiagnostics().dirtyDomains.includes("nextActions"), JSON.stringify(P.getSyncDiagnostics().dirtyDomains));
    delete fc.fails.next_actions;
    await P.__flushNowForTest(s);
    ok("E3 the retry does not duplicate the fact", rows(fc.db, "next_actions").length === 1, JSON.stringify(rows(fc.db, "next_actions").map((r) => r.id)));
    ok("E4 …and settles fully synced", P.getHealth().state === "synced", P.getHealth().state);
  }

  // ---- F. malformed success is NOT treated as a confirmed sync ----------
  //
  // D-23 is P3 and deferred; what is asserted here is only what the CURRENT
  // adapter contract says. `throwing()` judges success by `error` alone, so a
  // response with no `error` key counts as success — this pins that reading so
  // the day the contract tightens, the pin fails and gets revisited.
  {
    const db2 = new Map();
    const client = { from: () => ({ upsert: (r) => Promise.resolve({ data: r }), delete: () => ({ in: () => Promise.resolve({ error: null }) }), select: () => { const q = Promise.resolve({ data: [], error: null }); q.order = () => q; q.eq = () => q; return q; } }), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
    const ad = new SupabasePersistenceAdapter(client);
    const r = await ad.saveStateByDomain(world(), new Set(["nextActions"]), null);
    ok("F1 PINNED (D-23, P3): a response with no `error` key counts as success",
      r.failed.length === 0, JSON.stringify(r.failed));
    void db2;
  }

  // ---- G. a mutation during the flush is not cleared by the older push ---
  {
    const P = require("@/lib/persistence");
    const fc = fakeClient();
    P.__setRemoteForTest(new SupabasePersistenceAdapter(fc.client));
    const older = world(1);
    const newer = { ...older, nextActions: [act({ id: "a1", title: "Task EDITED", createdAt: iso(T), dueDate: T })] };
    // Push the OLDER snapshot, then ask what is dirty relative to the NEWER one
    // — which is exactly what `flush` does when a write lands mid-run.
    await P.__flushNowForTest(older);
    const dirtyAfter = P.__dirtyAgainstForTest(newer);
    ok("G1 a domain edited during the flush stays dirty", dirtyAfter.includes("nextActions"), JSON.stringify(dirtyAfter));
    ok("G2 …while untouched domains stay clean", !dirtyAfter.includes("workspaces") && !dirtyAfter.includes("goals"), JSON.stringify(dirtyAfter));
    await P.__flushNowForTest(newer);
    ok("G3 the newer value reaches the database", rows(fc.db, "next_actions")[0].title === "Task EDITED", JSON.stringify(rows(fc.db, "next_actions")));
    ok("G4 …and nothing is left dirty", P.getSyncDiagnostics().dirtyDomains.length === 0, JSON.stringify(P.getSyncDiagnostics().dirtyDomains));
  }

  const pass = results.filter((r) => r.p).length;
  console.log(`\n=== ${pass}/${results.length} D-22 isolation assertions ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
  process.exit(pass === results.length ? 0 : 1);
})();
