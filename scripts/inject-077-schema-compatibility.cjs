#!/usr/bin/env node
/**
 * LIFEOS-077 — SCHEMA COMPATIBILITY, deterministic gate.
 *
 * The sprint exists because a mechanism was wired to itself instead of to
 * reality, so every assertion here is about the PRODUCT's behaviour — what the
 * write path did, what health reported, what reached the server — and never
 * about a pure function's return value in isolation. That distinction is the
 * whole of F-3b: the module was already right.
 *
 * The live 0046 behaviour (the function, its grants, its search_path, the
 * capability payload) is proved against real PostgreSQL in
 * scripts/migration-rehearsal.mjs and is not re-asserted here.
 *
 * Requires the compiled tree at scripts/out.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const fs = require("fs");
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.addEventListener = () => {};

const P = require("@/lib/persistence");
const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { emptyStoreState } = require("@/lib/ux/backup");
const K = require("@/lib/sync/contract");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const LIB = "/home/user/LifeOS";
const iso = (h = 8) => `2026-08-29T${String(h).padStart(2, "0")}:00:00.000Z`;
const e = () => emptyStoreState();
const act = (p) => ({ description: "", status: "open", updatedAt: iso(8), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: iso(8), ...p });
const nt = (p) => ({ title: "N", body: "b", createdAt: iso(8), updatedAt: iso(8), tags: [], linkedEntityRefs: [], ...p });
const goal = (p) => ({ title: "G", description: "", status: "active", horizon: "year", linkedEntityRefs: [], tags: [], createdAt: iso(8), updatedAt: iso(8), ...p });

/**
 * A backend whose advertised contract is settable per test.
 *
 * `contractPayload` is what `app_schema_contract()` returns — including the
 * malformed shapes §25 requires. `guardMissing` additionally makes the guarded
 * RPC absent, which is what a genuinely older database looks like.
 */
function backend({ contractPayload, contractError = false, guardMissing = false } = {}) {
  const db = new Map();
  const table = (t) => { let m = db.get(t); if (!m) { m = new Map(); db.set(t, m); } return m; };
  const log = [];
  const from = (t) => ({
    upsert: (rows) => { const a = Array.isArray(rows) ? rows : [rows]; log.push(`upsert:${t}`); for (const r of a) table(t).set(r.id, { ...table(t).get(r.id), ...r }); return Promise.resolve({ error: null, data: a }); },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) }),
    select: () => { const q = Promise.resolve({ data: [...table(t).values()], error: null }); q.order = () => q; q.eq = () => q; q.in = () => Promise.resolve({ data: [...table(t).values()], error: null }); return q; },
  });
  const rpc = (name, args) => {
    if (name === "app_schema_contract") {
      log.push("rpc:contract");
      if (contractError) return Promise.resolve({ error: { message: "Could not find the function public.app_schema_contract in the schema cache" }, data: null });
      return Promise.resolve({ error: null, data: contractPayload });
    }
    if (name === "push_guarded_rows") {
      log.push(`rpc:${args.target}`);
      if (guardMissing) return Promise.resolve({ error: { message: "Could not find the function public.push_guarded_rows in the schema cache" }, data: null });
      const m = table(args.target);
      const accepted = [];
      for (const item of args.payload) { m.set(item.id, { ...m.get(item.id), ...item }); accepted.push(item.id); }
      return Promise.resolve({ error: null, data: { accepted, stale: [] } });
    }
    return Promise.resolve({ error: null, data: null });
  };
  return { db, log, rows: (t) => [...(db.get(t)?.values() ?? [])],
    client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
}

const FULL = { contract: 2, min_client_contract: 1, capabilities: { guarded_notes: 2, guarded_next_actions: 2 } };

/** Attach a backend and probe, as session acquisition does. */
async function attach(b) {
  P.__setRemoteForTest(new SupabasePersistenceAdapter(b.client));
  P.invalidateCompatibility();
  await P.probeCompatibility();
}

/** A world with one guarded record and one unguarded one, both edited. */
function world(tag) {
  return { ...e(),
    notes: [nt({ id: "n1", body: `note ${tag}` })],
    nextActions: [act({ id: "a1", title: `action ${tag}` })],
    goals: [goal({ id: "g1", title: `goal ${tag}` })] };
}

(async () => {
  /* ================================================================
   * A. §5/§18/§19 — the semantics, as pure comparisons.
   * ================================================================ */
  {
    const v = K.evaluateContract(K.parseContract(FULL));
    ok("A1 an exactly-matching contract is compatible", v.state === "compatible" && v.gatedDomains.length === 0, JSON.stringify(v.state));

    // §18 — a NEWER server is not an error.
    const newer = K.evaluateContract(K.parseContract({ contract: 3, min_client_contract: 1, capabilities: { guarded_notes: 2, guarded_next_actions: 2, something_new: 4 } }));
    ok("A2 §18 a server AHEAD of the client is compatible when its capabilities still cover us",
      newer.state === "compatible" && newer.gatedDomains.length === 0, JSON.stringify(newer));

    // §19 — the server declares this client too old.
    const tooOld = K.evaluateContract(K.parseContract({ contract: 4, min_client_contract: 3, capabilities: { guarded_notes: 3, guarded_next_actions: 3 } }));
    ok("A3 §19 a client below min_client_contract is globally incompatible",
      tooOld.state === "incompatible" && tooOld.clientTooOld, JSON.stringify(tooOld.state));

    // §17 — the 0045 incident, as a contract.
    const old = K.evaluateContract(K.parseContract({ contract: 1, min_client_contract: 1, capabilities: {} }));
    ok("A4 §17 a database without the guarded capability gates exactly the guarded domains",
      old.state === "partially_compatible" &&
      old.gatedDomains.slice().sort().join(",") === "nextActions,notes", JSON.stringify(old.gatedDomains));
    ok("A5 §11 …and nothing else — the other 44 domains are never gated",
      old.gatedDomains.length === 2);

    // A partial capability set gates only the domain that is short.
    const half = K.evaluateContract(K.parseContract({ contract: 2, min_client_contract: 1, capabilities: { guarded_next_actions: 2 } }));
    ok("A6 §11 one missing capability gates one domain",
      half.gatedDomains.join(",") === "notes", JSON.stringify(half.gatedDomains));
  }

  /* ================================================================
   * B. §25 — malformed answers are never "compatible".
   * ================================================================ */
  {
    const bad = [
      ["null", null],
      ["a string", "fine"],
      ["an array", [1, 2]],
      ["missing capabilities", { contract: 2, min_client_contract: 1 }],
      ["capabilities not an object", { contract: 2, min_client_contract: 1, capabilities: 7 }],
      ["a negative version", { contract: -2, min_client_contract: 1, capabilities: {} }],
      ["a zero version", { contract: 0, min_client_contract: 1, capabilities: {} }],
      ["a fractional version", { contract: 2.5, min_client_contract: 1, capabilities: {} }],
      ["a string version", { contract: "2", min_client_contract: 1, capabilities: {} }],
      ["a capability level that is not a number", { contract: 2, min_client_contract: 1, capabilities: { guarded_notes: "2" } }],
      ["a missing minimum", { contract: 2, capabilities: {} }],
    ];
    let allRejected = true, worstCase = "";
    for (const [label, payload] of bad) {
      const parsed = K.parseContract(payload);
      if (parsed !== null) { allRejected = false; worstCase = label; }
    }
    ok("B1 §25 every malformed shape fails to parse", allRejected, `accepted: ${worstCase}`);

    const v = K.evaluateContract(null);
    ok("B2 §25 …and an unparseable answer is 'unavailable', never 'compatible'", v.state === "unavailable", v.state);
    ok("B3 §25 …which gates the guarded domains rather than assuming them safe",
      v.gatedDomains.length === 2, JSON.stringify(v.gatedDomains));
    ok("B4 §25 …and is NOT reported as the client being too old — we simply do not know",
      v.clientTooOld === false);

    // Forward compatibility: unknown EXTRA fields must not poison a good answer.
    const extra = K.parseContract({ ...FULL, future_field: { anything: true }, capabilities: { ...FULL.capabilities, unknown_cap: 9 } });
    ok("B5 an unknown extra field does not make a valid contract unreadable", extra !== null && extra.capabilities.guarded_notes === 2);
  }

  /* ================================================================
   * C. §17 + §8 — THE 0045 INCIDENT, through the real write path.
   *
   * This is F-3b's closure: the verdict must be consumed by the code that
   * writes, not merely displayed.
   * ================================================================ */
  {
    store.clear();
    const b = backend({ contractPayload: { contract: 1, min_client_contract: 1, capabilities: {} }, guardMissing: true });
    await attach(b);

    ok("C1 §17 the mismatch is detected from the CONTRACT, before any write",
      P.getCompatibility().state === "partially_compatible", P.getCompatibility().state);

    b.log.length = 0;
    const w = world("v1");
    P.saveLocalOnly({ ...e() });
    P.saveState(w);
    await P.__flushNowForTest(w);

    ok("C2 §17 no guarded push was even ATTEMPTED — the mismatch needed no failed RPC to discover",
      !b.log.some((l) => l === "rpc:notes" || l === "rpc:next_actions"), JSON.stringify(b.log));
    ok("C3 §8 the guarded rows did not reach the server",
      b.rows("notes").length === 0 && b.rows("next_actions").length === 0);
    ok("C4 §11 …while a COMPATIBLE domain synced normally in the same flush",
      b.rows("goals").length === 1, JSON.stringify(b.rows("goals").map((g) => g.title)));

    const diag = P.getSyncDiagnostics();
    ok("C5 §12 the gated domains stay dirty",
      diag.dirtyDomains.includes("notes") && diag.dirtyDomains.includes("nextActions"), JSON.stringify(diag.dirtyDomains));
    ok("C6 §12 health does NOT report Synced", P.getHealth().state !== "synced", P.getHealth().state);
    ok("C7 §12 …it reports an existing truthful state, not a new reassuring label",
      P.getHealth().state === "incomplete", P.getHealth().state);

    const local = JSON.parse(store.get("lifeos.mvp.v1") || "{}");
    ok("C8 §9 local durable work survives untouched",
      local.notes?.[0]?.body === "note v1" && local.nextActions?.[0]?.title === "action v1",
      JSON.stringify({ n: local.notes?.[0]?.body, a: local.nextActions?.[0]?.title }));

    const { getConflicts } = require("@/lib/sync/conflicts-store");
    ok("C9 §17 no phantom conflict is fabricated from an incompatibility",
      getConflicts().length === 0, JSON.stringify(getConflicts().map((c) => c.id)));

    ok("C10 §7/§13 the user-facing message is consequence language with no database nouns",
      (() => {
        const m = P.compatibilityNotice() ?? "";
        return /updating/i.test(m) && !/rpc|migration|schema|postgres|0045|0046|contract/i.test(m);
      })(), JSON.stringify(P.compatibilityNotice()));
  }

  /* ================================================================
   * D. §26 — recovery when the database catches up.
   * ================================================================ */
  {
    const b2 = backend({ contractPayload: FULL });
    // Same session, same queued work: only the backend has been upgraded.
    P.__setRemoteForTest(new SupabasePersistenceAdapter(b2.client));
    await P.retrySync();

    ok("D1 §26 the contract is re-read on retry", P.getCompatibility().state === "compatible", P.getCompatibility().state);
    ok("D2 §26 the queued guarded work flushes with no logout, refresh or re-entry",
      b2.rows("notes").length === 1 && b2.rows("next_actions").length === 1,
      JSON.stringify({ notes: b2.rows("notes").length, actions: b2.rows("next_actions").length }));
    ok("D3 §26 …and the content is what the person actually wrote",
      b2.rows("notes")[0].body === "note v1", JSON.stringify(b2.rows("notes")[0]?.body));
    ok("D4 §12 only now does health report Synced", P.getHealth().state === "synced", P.getHealth().state);
  }

  /* ================================================================
   * E. §19 — client globally too old.
   * ================================================================ */
  {
    store.clear();
    const b = backend({ contractPayload: { contract: 5, min_client_contract: 9, capabilities: { guarded_notes: 5, guarded_next_actions: 5 } } });
    await attach(b);
    ok("E1 §19 the client is told it is globally too old", P.getCompatibility().clientTooOld === true);
    const w = world("old");
    P.saveLocalOnly({ ...e() }); P.saveState(w);
    await P.__flushNowForTest(w);
    ok("E2 §19 guarded remote writes do not happen",
      b.rows("notes").length === 0 && b.rows("next_actions").length === 0);
    ok("E3 §9 local durable writes continue regardless",
      JSON.parse(store.get("lifeos.mvp.v1") || "{}").notes?.[0]?.body === "note old");
    ok("E4 §19 sync is not pretended to succeed", P.getHealth().state !== "synced", P.getHealth().state);
  }

  /* ================================================================
   * F. §14/§25 — offline and unreachable are not "incompatible".
   * ================================================================ */
  {
    store.clear();
    const b = backend({ contractError: true });
    await attach(b);
    ok("F1 §25 an errored probe is 'unavailable', not 'incompatible'",
      P.getCompatibility().state === "unavailable", P.getCompatibility().state);
    ok("F2 §25 …and is not confused with the client being too old",
      P.getCompatibility().clientTooOld === false);
    const w = world("off");
    P.saveLocalOnly({ ...e() }); P.saveState(w);
    await P.__flushNowForTest(w);
    ok("F3 §14 local use is unaffected by an unreadable contract",
      JSON.parse(store.get("lifeos.mvp.v1") || "{}").notes?.[0]?.body === "note off");
    ok("F4 §14 unguarded domains still sync — a failed probe is not a global outage",
      b.rows("goals").length === 1, JSON.stringify(b.rows("goals").length));
    ok("F5 §25 guarded domains are held, because we do not know", b.rows("notes").length === 0);
  }

  /* ================================================================
   * G. §30 — the probe is per lifecycle event, not per mutation.
   * ================================================================ */
  {
    store.clear();
    const b = backend({ contractPayload: FULL });
    await attach(b);
    const before = P.__compatProbeCount();
    let w = world("p0");
    P.saveLocalOnly({ ...e() });
    for (let i = 0; i < 50; i++) {
      w = { ...e(), notes: [nt({ id: "n1", body: `b${i}` })], goals: [goal({ id: "g1", title: `g${i}` })] };
      P.saveState(w);
      await P.__flushNowForTest(w);
    }
    const added = P.__compatProbeCount() - before;
    ok("G1 §30 50 mutations added ZERO contract probes — O(1) per lifecycle event, not O(writes)",
      added === 0, `${added} probes across 50 flushes`);
    ok("G2 §30 …and the cached verdict was still applied", P.getCompatibility().state === "compatible");
  }

  /* ================================================================
   * H. §16 — the contract changes mid-session.
   * ================================================================ */
  {
    store.clear();
    const b = backend({ contractPayload: FULL });
    await attach(b);
    ok("H1 §16 the session starts compatible", P.getCompatibility().state === "compatible");

    // The deployment happens under the open tab: the guarded RPC disappears.
    const stale = backend({ contractPayload: { contract: 1, min_client_contract: 1, capabilities: {} }, guardMissing: true });
    P.__setRemoteForTest(new SupabasePersistenceAdapter(stale.client));
    const w = world("mid");
    P.saveLocalOnly({ ...e() }); P.saveState(w);
    await P.__flushNowForTest(w);
    await new Promise((r) => setTimeout(r, 40));   // the re-probe is scheduled, not awaited

    ok("H2 §16 the failure did not produce a false Synced", P.getHealth().state !== "synced", P.getHealth().state);
    ok("H3 §16 the stale cache was invalidated and re-read rather than trusted",
      P.getCompatibility().state === "partially_compatible" || P.getCompatibility().state === "unavailable",
      P.getCompatibility().state);
    ok("H4 §16 local intent stayed durable through the change",
      JSON.parse(store.get("lifeos.mvp.v1") || "{}").notes?.[0]?.body === "note mid");
    ok("H5 §16 …and the work is still queued, not dropped",
      P.getSyncDiagnostics().dirtyDomains.includes("notes"), JSON.stringify(P.getSyncDiagnostics().dirtyDomains));
  }

  /* ================================================================
   * I. §20/§33 — the wiring audit, structural.
   * ================================================================ */
  {
    const pers = fs.readFileSync(`${LIB}/lib/persistence.ts`, "utf8");
    const adapter = fs.readFileSync(`${LIB}/lib/adapters/supabaseAdapter.ts`, "utf8");
    const diag = fs.readFileSync(`${LIB}/components/security/DiagnosticsCenter.tsx`, "utf8");

    ok("I1 §33 deployed truth: the adapter calls the contract RPC",
      /rpc\("app_schema_contract"\)/.test(adapter));
    ok("I2 §33 → parser: persistence parses that answer rather than trusting it",
      /evaluateContract\(parseContract\(raw\)\)/.test(pers));
    ok("I3 §33 → cache: the verdict is held for the session",
      /let compat: CompatibilityVerdict/.test(pers));
    ok("I4 §33 → per-domain decision consumed by the DISPATCHER, not just the UI",
      /for \(const d of compat\.gatedDomains\)/.test(pers) && /saveStateByDomain\(snapshot, attemptable/.test(pers));
    ok("I5 §33 → domains held dirty rather than pushed",
      /\.\.\.report\.failed\.map\(\(f\) => f\.domain\), \.\.\.gated/.test(pers));
    ok("I6 §33 → health cannot say synced while a domain is gated",
      /if \(gated\.size > 0\)/.test(pers));
    ok("I7 §33 → reprobe on retry", /await probeCompatibility\(\);\s*\n\s*await flush\(\);/.test(pers));
    ok("I8 §6 the fabricated production input is GONE",
      !/remoteMigrationVersion: health\?\.mode === "supabase" \? EXPECTED_MIGRATION_VERSION/.test(diag),
      "DiagnosticsCenter still feeds the gate its own constant");
    ok("I9 §4 capability levels live in ONE place — no numeric literals in the adapter",
      !/guarded_notes|guarded_next_actions/.test(adapter));
    ok("I10 §13 no database noun reaches the user-facing message",
      !/rpc|migration|postgres|schema_migrations/i.test(K.compatibilityMessage("partially_compatible", true) ?? ""));
  }

  const failed = results.filter((r) => !r.p);
  console.log(`\n=== ${results.length - failed.length}/${results.length} schema-compatibility assertions ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e2) => { console.error(e2); process.exit(1); });
