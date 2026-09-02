#!/usr/bin/env node
/**
 * LIFEOS-078 §12 — THE RED DEPLOYMENT PROOF.
 *
 * The claim under test is not "the gate returns the right verdict". It is:
 *
 *   a 078 client, against a database that is still at 0046, does not lose a
 *   goal edit, does not say "Synced", and does not stop the other 45 domains.
 *
 * The only way to trust that is to watch it FAIL first. So every section runs
 * twice against the same simulated 0046 backend:
 *
 *   RED    with `goals` removed from DOMAIN_CAPABILITY_REQUIREMENTS — the
 *          shape the client would have had if §22 had been ignored. The write
 *          reaches PostgREST, the new columns are rejected, `goals` breaks.
 *   GREEN  with the requirement present. The write is held BEFORE the upsert,
 *          the edit survives locally, `goals` stays dirty, health is not
 *          `synced`, and the unaffected domains still push.
 *
 * A test that has only ever been green proves nothing about a mechanism whose
 * whole job is to prevent something. That is the 077 lesson, applied to the
 * schema change 077 made survivable.
 *
 * Requires the compiled tree at scripts/out.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const fs = require("fs");
const mem = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};
globalThis.addEventListener = () => {};

const P = require("@/lib/persistence");
const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { emptyStoreState } = require("@/lib/ux/backup");
const K = require("@/lib/sync/contract");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const iso = (h = 8) => `2026-09-02T${String(h).padStart(2, "0")}:00:00.000Z`;
const e = () => emptyStoreState();
const nt = (p) => ({ title: "N", body: "b", createdAt: iso(8), updatedAt: iso(8), tags: [], linkedEntityRefs: [], ...p });
const goal = (p) => ({
  title: "G", description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [], createdAt: iso(8), updatedAt: iso(8), ...p,
});

/** The 0046 contract, verbatim: no `goal_horizons`. */
const CONTRACT_0046 = { contract: 2, min_client_contract: 1, capabilities: { guarded_notes: 2, guarded_next_actions: 2 } };
/** The 0047 contract, verbatim. */
const CONTRACT_0047 = { contract: 3, min_client_contract: 1, capabilities: { guarded_notes: 2, guarded_next_actions: 2, goal_horizons: 1 } };

/**
 * A backend that behaves like the database its contract advertises.
 *
 * This is the part that has to be honest. A fake that accepted the new goal
 * columns while claiming to be 0046 would make the RED run pass for the wrong
 * reason and prove nothing — so `columns` is the ACTUAL column set of the
 * `goals` table at that migration, and a row naming anything outside it is
 * rejected with PostgREST's real error shape (code PGRST204).
 */
const GOALS_0046 = new Set([
  "id", "user_id", "title", "description", "status", "priority", "target_date",
  "notes", "tags", "manual_progress", "linked_workspaces", "linked_knowledge",
  "created_at", "updated_at",
]);
const GOALS_0047 = new Set([...GOALS_0046, "horizon", "successor_goal_id", "history"]);

function backend({ contract, goalColumns }) {
  const db = new Map();
  const table = (t) => { let m = db.get(t); if (!m) { m = new Map(); db.set(t, m); } return m; };
  const log = [];
  const from = (t) => ({
    upsert: (rows) => {
      const a = Array.isArray(rows) ? rows : [rows];
      log.push(`upsert:${t}`);
      if (t === "goals") {
        for (const r of a) {
          const unknown = Object.keys(r).find((k) => !goalColumns.has(k));
          if (unknown) {
            return Promise.resolve({
              data: null,
              error: { code: "PGRST204", message: `Could not find the '${unknown}' column of 'goals' in the schema cache` },
            });
          }
        }
      }
      for (const r of a) table(t).set(r.id, { ...table(t).get(r.id), ...r });
      return Promise.resolve({ error: null, data: a });
    },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) }),
    select: () => { const q = Promise.resolve({ data: [...table(t).values()], error: null }); q.order = () => q; q.eq = () => q; q.in = () => Promise.resolve({ data: [...table(t).values()], error: null }); return q; },
  });
  const rpc = (name, args) => {
    if (name === "app_schema_contract") { log.push("rpc:contract"); return Promise.resolve({ error: null, data: contract }); }
    if (name === "push_guarded_rows") {
      log.push(`rpc:${args.target}`);
      const m = table(args.target);
      const accepted = [];
      for (const item of args.payload) { m.set(item.id, { ...m.get(item.id), ...item }); accepted.push(item.id); }
      return Promise.resolve({ error: null, data: { accepted, stale: [] } });
    }
    return Promise.resolve({ error: null, data: null });
  };
  return {
    db, log, rows: (t) => [...(db.get(t)?.values() ?? [])],
    client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } },
  };
}

async function attach(b) {
  P.__setRemoteForTest(new SupabasePersistenceAdapter(b.client));
  P.invalidateCompatibility();
  await P.probeCompatibility();
}

/**
 * Remove or restore the `goals` requirement on the LIVE module object.
 *
 * The compiled module exports one object and every consumer reads it through
 * the same reference, so deleting the key really does put the client into the
 * shape it would have had without §22 — this is not a stubbed copy.
 */
const GOALS_REQUIREMENT = K.DOMAIN_CAPABILITY_REQUIREMENTS.goals;
const removeGoalGate = () => { delete K.DOMAIN_CAPABILITY_REQUIREMENTS.goals; };
const restoreGoalGate = () => { K.DOMAIN_CAPABILITY_REQUIREMENTS.goals = GOALS_REQUIREMENT; };

/** A world with one edited goal and one edited note. */
function world(tag) {
  return { ...e(),
    notes: [nt({ id: "n1", body: `note ${tag}` })],
    goals: [goal({ id: "g1", title: `goal ${tag}`, horizon: "life" })] };
}

const LOCAL_KEY = "lifeos.mvp.v1";
const localGoals = () => {
  try { return JSON.parse(globalThis.localStorage.getItem(LOCAL_KEY) ?? "{}").goals ?? []; }
  catch { return []; }
};

/**
 * Save, flush, and report what the PRODUCT did.
 *
 * `saved` is read back out of localStorage rather than taken from a return
 * value, because "the edit is durable on this device" is a claim about storage,
 * and a function that returns without throwing is not evidence of that.
 */
async function run(b, tag) {
  const s = world(tag);
  P.saveState(s);
  await P.__flushNowForTest(s);
  const local = localGoals();
  return {
    saved: local.some((g) => g.id === "g1" && g.title === `goal ${tag}`),
    health: P.getHealth(),
    remoteGoals: b.rows("goals"),
    remoteNotes: b.rows("notes"),
    localGoals: local,
    log: b.log.slice(),
  };
}

(async () => {
  /* ================================================================
   * 0. The requirement itself, and the premise of every test below.
   * ================================================================ */
  {
    ok("0.1 the goals domain declares a capability requirement",
      !!GOALS_REQUIREMENT && GOALS_REQUIREMENT.goal_horizons === 1, JSON.stringify(GOALS_REQUIREMENT));
    ok("0.2 §4 it lives in the CENTRAL map, with notes and nextActions",
      Object.keys(K.DOMAIN_CAPABILITY_REQUIREMENTS).sort().join(",") === "goals,nextActions,notes",
      Object.keys(K.DOMAIN_CAPABILITY_REQUIREMENTS).join(","));
    ok("0.3 §4 …and the capability name appears in no adapter",
      !/goal_horizons/.test(fs.readFileSync("/home/user/LifeOS/lib/adapters/supabaseAdapter.ts", "utf8")));

    // §5's matrix, as pure verdicts, before any I/O.
    const on0046 = K.evaluateContract(K.parseContract(CONTRACT_0046));
    ok("0.4 §5 a 078 client against 0046 gates goals and NOTHING else",
      on0046.state === "partially_compatible" && on0046.gatedDomains.join(",") === "goals",
      JSON.stringify(on0046.gatedDomains));
    const on0047 = K.evaluateContract(K.parseContract(CONTRACT_0047));
    ok("0.5 §5 …and against 0047 it is fully compatible",
      on0047.state === "compatible" && on0047.gatedDomains.length === 0, JSON.stringify(on0047));
    ok("0.6 §6 0047 never declares this client generation unfit",
      K.parseContract(CONTRACT_0047).minClientContract === 1);
    ok("0.7 §6 …and the client's own generation moved to 3", K.CLIENT_CONTRACT === 3, String(K.CLIENT_CONTRACT));
  }

  /* ================================================================
   * 1. RED — the client WITHOUT the gate, against a real 0046 table.
   *
   * This is the incident §22 exists to prevent, reproduced. If any
   * assertion here goes green, the simulated database is not modelling
   * 0046 and every GREEN assertion below proves nothing.
   * ================================================================ */
  let red;
  {
    removeGoalGate();
    const b = backend({ contract: CONTRACT_0046, goalColumns: GOALS_0046 });
    await attach(b);
    red = await run(b, "red");

    ok("1.1 RED the write path ATTEMPTED the goals upsert",
      red.log.includes("upsert:goals"), red.log.join(" "));
    ok("1.2 RED …and the 0046 table rejected it — no goal reached the server",
      red.remoteGoals.length === 0, `${red.remoteGoals.length} rows`);
    ok("1.3 RED the goals domain is reported as failed",
      (red.health.failedDomains ?? []).includes("goals"), JSON.stringify(red.health.failedDomains));
    // `health.error` is the field the product actually sets; an earlier draft of
    // this line read `health.detail`, which does not exist — so it was testing
    // an empty string against a regex and could only ever have failed, or (had
    // the regex been negative) passed for no reason at all.
    ok("1.4 RED the failure surfaces as a SCHEMA error, not a mystery",
      /column .* in the schema cache/i.test(String(red.health.error ?? "")),
      JSON.stringify(red.health.error));
    ok("1.5 RED …i.e. the client discovered the mismatch as an ERROR, which is the incident",
      red.health.state === "retrying", red.health.state);
    restoreGoalGate();
  }

  /* ================================================================
   * 2. GREEN — the same backend, the same edit, with the gate.
   * ================================================================ */
  let green;
  {
    const b = backend({ contract: CONTRACT_0046, goalColumns: GOALS_0046 });
    await attach(b);
    green = await run(b, "green");

    ok("2.1 GREEN the goals upsert is never ATTEMPTED",
      !green.log.includes("upsert:goals"), green.log.join(" "));
    ok("2.2 GREEN the local save succeeded — the edit is durable on this device",
      green.saved === true && green.localGoals.length === 1 && green.localGoals[0].title === "goal green",
      JSON.stringify(green.localGoals.map((g) => g.title)));
    ok("2.3 GREEN …including the horizon the user chose",
      green.localGoals[0].horizon === "life", String(green.localGoals[0]?.horizon));
    ok("2.4 GREEN goals is held DIRTY, not silently dropped",
      (green.health.failedDomains ?? []).includes("goals"), JSON.stringify(green.health.failedDomains));
    ok("2.5 GREEN health does NOT say synced",
      green.health.state !== "synced", green.health.state);
    ok("2.6 §5 GREEN the other domains still reached the server",
      green.remoteNotes.length === 1, `${green.remoteNotes.length} notes`);
    ok("2.7 §5 …and notes went through the 0045 guarded path, untouched by this sprint",
      green.log.includes("rpc:notes"), green.log.join(" "));
    ok("2.8 GREEN the user-facing message names no database noun",
      !/rpc|column|migration|postgres|schema/i.test(P.compatibilityNotice() ?? ""),
      String(P.compatibilityNotice()));
    ok("2.9 GREEN …and it says the change is safe on this device",
      /safe on this device/.test(P.compatibilityNotice() ?? ""), String(P.compatibilityNotice()));
  }

  /* ================================================================
   * 3. The pause SELF-HEALS when 0047 lands. A gate that never
   *    reopens is an outage with better manners.
   * ================================================================ */
  {
    const b = backend({ contract: CONTRACT_0047, goalColumns: GOALS_0047 });
    await attach(b);
    const after = await run(b, "healed");

    ok("3.1 once 0047 is deployed the goal is pushed",
      after.remoteGoals.length === 1, `${after.remoteGoals.length} rows`);
    ok("3.2 …carrying all three new columns",
      after.remoteGoals[0].horizon === "life"
      && "successor_goal_id" in after.remoteGoals[0]
      && Array.isArray(after.remoteGoals[0].history),
      JSON.stringify(after.remoteGoals[0]));
    ok("3.3 …and no domain is left failing", (after.health.failedDomains ?? []).length === 0,
      JSON.stringify(after.health.failedDomains));
    ok("3.4 …with health reporting synced", after.health.state === "synced", after.health.state);
    ok("3.5 §5 the notice is gone once the database can take the write",
      P.compatibilityNotice() === null, String(P.compatibilityNotice()));
  }

  /* ================================================================
   * 4. §5 the OTHER direction — a pre-078 client against 0047.
   *
   * Simulated the only honest way available here: the old client's row
   * shape (no new columns) against the 0047 table, plus the old
   * client's contract requirements.
   * ================================================================ */
  {
    const b = backend({ contract: CONTRACT_0047, goalColumns: GOALS_0047 });
    removeGoalGate();                       // a 077 client has no goals requirement
    await attach(b);
    const v = K.evaluateContract(K.parseContract(CONTRACT_0047));
    ok("4.1 §5 a 077-shaped client is fully compatible with 0047",
      v.state === "compatible" && v.gatedDomains.length === 0, JSON.stringify(v));

    const oldRow = { id: "g-old", user_id: "u1", title: "Old client goal", description: "", status: "active",
      priority: "medium", target_date: null, notes: "", tags: [], manual_progress: null,
      linked_workspaces: [], linked_knowledge: [], created_at: iso(8), updated_at: iso(8) };
    const res = await b.client.from("goals").upsert([oldRow]);
    ok("4.2 §7 …and its OLD row shape is accepted by the 0047 table",
      res.error === null, JSON.stringify(res.error));
    restoreGoalGate();
  }

  /* ================================================================
   * 5. §22's other half — an UNREADABLE contract must not be read as
   *    permission. Absence of an answer is not an answer.
   * ================================================================ */
  {
    const b = backend({ contract: null, goalColumns: GOALS_0046 });
    await attach(b);
    const r = await run(b, "unknown");
    ok("5.1 an unreadable contract gates goals rather than assuming",
      !r.log.includes("upsert:goals"), r.log.join(" "));
    ok("5.2 …and the local edit is still durable",
      r.saved === true && r.localGoals.length === 1);
    ok("5.3 …and health still does not say synced", r.health.state !== "synced", r.health.state);
  }

  /* ================================================================
   * 6. The wiring, read from the shipped source — §4's "one place".
   * ================================================================ */
  {
    const contract = fs.readFileSync("/home/user/LifeOS/lib/sync/contract.ts", "utf8");
    const mig = fs.readFileSync("/home/user/LifeOS/supabase/migrations/0047_goal_horizons_lifecycle_history.sql", "utf8");

    ok("6.1 §4 the requirement is declared once, in the central map",
      (contract.match(/goal_horizons/g) ?? []).length === 1, String((contract.match(/goal_horizons/g) ?? []).length));
    ok("6.2 §1 the columns and the capability ship in ONE migration",
      /add column if not exists\s+horizon/.test(mig)
      && /add column if not exists\s+successor_goal_id/.test(mig)
      && /add column if not exists\s+history/.test(mig)
      && /create or replace function public\.app_schema_contract/.test(mig));
    ok("6.3 §3 the migration keeps SECURITY INVOKER", /security invoker/.test(mig));
    ok("6.4 §3 …and the pinned search_path", /set search_path = pg_catalog, public/.test(mig));
    ok("6.5 §3 …and does not re-grant anon", /revoke execute on function public\.app_schema_contract\(\) from anon/.test(mig));
    ok("6.6 §2 exactly three columns are added to goals",
      (mig.match(/add column if not exists/g) ?? []).length === 3,
      String((mig.match(/add column if not exists/g) ?? []).length));
    ok("6.7 §9 the successor cascades to NULL, never deleting the predecessor",
      /on delete set null/.test(mig) && !/on delete cascade/.test(mig));
    // Targets a COLUMN, not the word: the migration's prose explains why there
    // is no predecessor field, and a bare /predecessor/ flagged that comment.
    ok("6.8 §9 …and no predecessor COLUMN is added",
      !/add column if not exists\s+predecessor/i.test(mig));
    ok("6.9 §8 the horizon CHECK names exactly the five values",
      /horizon in \('now', 'near', 'medium', 'long', 'life'\)/.test(mig));
    ok("6.10 §8 …and permits NULL", /horizon is null/.test(mig));
    ok("6.11 §10 history uses the shipped default", /history\s+jsonb not null default '\[\]'::jsonb/.test(mig));
    ok("6.12 §9 no back-fill statement exists anywhere in the migration",
      !/update public\.goals set horizon/i.test(mig));
  }

  const failed = results.filter((r) => !r.p);
  console.log(`\n=== ${results.length - failed.length}/${results.length} goal-capability assertions ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e2) => { console.error(e2); process.exit(1); });
