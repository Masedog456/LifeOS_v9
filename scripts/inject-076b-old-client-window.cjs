#!/usr/bin/env node
/**
 * LIFEOS-076B §5 — THE OLD-CLIENT DEPLOYMENT WINDOW, MEASURED.
 *
 * The approved deploy order applies migration 0045 to production BEFORE PR #81
 * merges. For a short window the deployed client is therefore the one at merge
 * commit 96cf62a: it writes guarded rows with a bare upsert and contains no
 * reference to `sync_version` at all.
 *
 * The claim under test is NOT that the write is refused — the real-PostgreSQL
 * rehearsal already proves that (checks I and J). It is the CLIENT-side claim
 * that the handoff makes a BLOCK condition:
 *
 *   "The existing client should preserve local durable intent rather than
 *    silently corrupt remote state. If external testing proves otherwise:
 *    BLOCK."
 *
 * So it is measured against the real old code, not assumed from reading it.
 *
 * ## Reproducing
 *
 *   git worktree add /tmp/wt-old 96cf62a725825965dadff6154e89ce908905716d
 *   ln -s "$PWD/node_modules" /tmp/wt-old/node_modules
 *   npx tsc -p <a tsconfig emitting /tmp/wt-old/lib + types to OUT_OLD>
 *   OUT_OLD=<that outDir> node scripts/inject-076b-old-client-window.cjs
 *
 * `OUT_OLD` must point at the COMPILED OLD TREE. This harness deliberately does
 * not fall back to the current tree: silently measuring the new client would
 * answer a question nobody asked and report it as the old client's behaviour.
 *
 * ## What the backend below is
 *
 * An in-memory model of the 0045 invariant as an old client meets it: an upsert
 * onto an EXISTING guarded row is refused unless it advances `sync_version`,
 * which an old client's payload never does. It asserts nothing about Postgres.
 */
const path = require("path"), Module = require("module");
const ROOT = process.env.OUT_OLD;
if (!ROOT) {
  console.error("OUT_OLD is not set. It must point at the COMPILED OLD TREE (see the header).");
  console.error("Refusing to run: measuring the current client here would answer the wrong question.");
  process.exit(2);
}
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
  if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2));
  try { return orig.call(this, r, ...a); }
  catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); }
};
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k,v)=>store.set(k,String(v)), removeItem: k=>store.delete(k), clear: ()=>store.clear() };
globalThis.addEventListener = () => {};

const P = require("@/lib/persistence");
const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { emptyStoreState } = require("@/lib/ux/backup");

const out = [];
const ok = (n,p,d) => { out.push({n,p,d}); console.log(`${p?"PASS":"FAIL"}  ${n}${p?"":` — ${d??""}`}`); };

const iso = h => `2026-08-29T${String(h).padStart(2,"0")}:00:00.000Z`;
const act = p => ({description:"",status:"open",updatedAt:iso(8),notes:"",linkedEntityRefs:[],tags:[],estimatedSize:"unspecified",energy:"unspecified",order:1,history:[],createdAt:iso(8),...p});

/** A backend with 0045 applied. An UPDATE that does not advance sync_version is refused. */
function guardedServer() {
  const db = new Map();
  const table = t => { let m = db.get(t); if(!m){m=new Map();db.set(t,m);} return m; };
  const from = t => ({
    upsert: rows => {
      const arr = Array.isArray(rows)?rows:[rows];
      const guarded = (t === "next_actions" || t === "notes");
      for (const r of arr) {
        const cur = table(t).get(r.id);
        if (guarded && cur) {
          const proposed = r.sync_version;          // an old client sends none
          if (proposed !== (cur.sync_version ?? 1) + 1) {
            return Promise.resolve({ error: { message:
              `LIFEOS_STALE_WRITE: ${t} expected sync_version ${(cur.sync_version??1)+1}, received ${proposed ?? "null"}` } });
          }
        }
      }
      for (const r of arr) table(t).set(r.id, { ...table(t).get(r.id), ...r, sync_version: (table(t).get(r.id)?.sync_version ?? 0) + 1 });
      return Promise.resolve({ error: null, data: arr });
    },
    insert: rows => { const a=Array.isArray(rows)?rows:[rows]; for(const r of a) table(t).set(r.id ?? `${r.domain}:${r.record_id}`, r); return Promise.resolve({error:null}); },
    delete: () => ({ in: (_c,ids)=>{for(const i of ids) table(t).delete(i); return Promise.resolve({error:null});}, eq: ()=>Promise.resolve({error:null}) }),
    select: () => { const q=Promise.resolve({data:[...table(t).values()],error:null}); q.order=()=>q; q.eq=()=>q; q.in=()=>Promise.resolve({data:[...table(t).values()],error:null}); return q; },
  });
  return { db, table, client: { from, rpc: ()=>Promise.resolve({error:null}), auth:{getUser:async()=>({data:{user:{id:"u1"}}})} } };
}

(async () => {
  const e = () => emptyStoreState();
  const S = guardedServer();
  // Post-0045 production: the existing row migrated to version 1.
  S.table("next_actions").set("a1", { id:"a1", title:"File the tax return", status:"open",
    created_at: iso(8), updated_at: iso(8), history: [], sync_version: 1 });

  P.__setRemoteForTest(new SupabasePersistenceAdapter(S.client));

  const base = { ...e(), nextActions: [act({ id:"a1", title:"File the tax return", status:"open" })] };
  // The user completes it on the OLD client.
  const done = { ...e(), nextActions: [act({ id:"a1", title:"File the tax return", status:"completed",
    completedAt: iso(14), updatedAt: iso(14), history:[{at:iso(14),action:"completed",detail:"posted it"}] })] };

  P.saveLocalOnly(base);
  /*
   * The REAL sequence a user edit takes: `saveState` writes locally FIRST and
   * only then schedules the remote push. The first draft called
   * `__flushNowForTest` alone, which drives the push without the local write
   * that always precedes it — and duly "showed" the completion missing from the
   * device. That would have been reported as data loss in the deployment
   * window; it was a defect in the harness, not in the client.
   */
  P.saveState(done);
  await P.__flushNowForTest(done);

  const h = P.getHealth();
  const diag = P.getSyncDiagnostics();
  const local = JSON.parse(store.get("lifeos.mvp.v1") || "{}");
  const server = S.table("next_actions").get("a1");

  console.log("\n--- OBSERVED ---");
  console.log("health:", JSON.stringify({ state: h.state, localError: h.localError ?? null, lastSyncAt: h.lastSyncAt }));
  console.log("failedDomains:", JSON.stringify(diag.failedDomains));
  console.log("dirtyDomains:", JSON.stringify(diag.dirtyDomains));
  console.log("server row:", JSON.stringify(server));
  console.log("local action:", JSON.stringify(local.nextActions?.[0] && { status: local.nextActions[0].status, completedAt: local.nextActions[0].completedAt, history: local.nextActions[0].history?.length }));
  console.log("");

  ok("W1 §5 the old client's guarded write is REFUSED by 0045",
    server.status === "open" && server.sync_version === 1, JSON.stringify(server));
  ok("W2 §5 the server's durable value is NOT corrupted by the stale client",
    server.status === "open" && !server.completed_at, JSON.stringify(server));
  ok("W3 §5 the user's completion SURVIVES on the device — local durable intent preserved",
    local.nextActions?.[0]?.status === "completed" && !!local.nextActions?.[0]?.completedAt,
    JSON.stringify(local.nextActions?.[0]));
  ok("W4 §5 …including the history entry",
    (local.nextActions?.[0]?.history ?? []).some(x => x.action === "completed"),
    JSON.stringify(local.nextActions?.[0]?.history));
  ok("W5 §5 the failure is VISIBLE, not silent",
    h.state === "failed" || h.state === "incomplete" || h.state === "retrying", h.state);
  ok("W6 §5 the domain stays dirty, so the work is retried once the new client ships",
    diag.dirtyDomains.includes("nextActions") || diag.failedDomains.some(f => (f.domain ?? f) === "nextActions"),
    JSON.stringify({ dirty: diag.dirtyDomains, failed: diag.failedDomains }));
  ok("W7 §5 sync is NOT falsely reported as complete",
    h.state !== "synced", h.state);
  ok("W8 §5 an UNGUARDED domain in the same flush is unaffected (074 D-22 isolation holds)",
    !diag.failedDomains.some(f => (f.domain ?? f) === "goals"), JSON.stringify(diag.failedDomains));

  const bad = out.filter(r => !r.p);
  console.log(`\n=== ${out.length - bad.length}/${out.length} old-client window assertions ===`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
