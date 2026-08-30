#!/usr/bin/env node
/**
 * LIFEOS-076B §2b — THE LIVE WINDOW: A NEW CLIENT AGAINST A 0044 DATABASE.
 *
 * PR #81 merged before migration 0045 was applied to production, so the live
 * mismatch is the inverse of the one the deploy plan prepared for. This measures
 * it rather than reasoning about it.
 *
 * A 0044 database has no `sync_version` column and no `push_guarded_rows`, so
 * the new client's guarded push fails and its version pre-read fails too. The
 * question is what that does to the user's data.
 *
 * Runs against the CURRENT tree (unlike the old-client harness, which needs a
 * compiled worktree) because the current tree IS the merged client.
 *
 * Requires the compiled tree at scripts/out.
 */
const path=require("path"),Module=require("module"),ROOT="/home/user/LifeOS/scripts/out";
const orig=Module._resolveFilename;
Module._resolveFilename=function(r,...a){if(r.startsWith("@/"))r=path.join(ROOT,r.slice(2));try{return orig.call(this,r,...a);}catch(e){if(r.startsWith(".")||path.isAbsolute(r))throw e;return require.resolve(r,{paths:["/home/user/LifeOS/node_modules"]});}};
const store=new Map();globalThis.window=globalThis;
globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()};
globalThis.addEventListener=()=>{};
const P=require("@/lib/persistence");
const {SupabasePersistenceAdapter}=require("@/lib/adapters/supabaseAdapter");
const {emptyStoreState}=require("@/lib/ux/backup");
const C=require("@/lib/sync/conflicts-store");
const iso=h=>`2026-08-29T${String(h).padStart(2,"0")}:00:00.000Z`;
const act=p=>({description:"",status:"open",updatedAt:iso(8),notes:"",linkedEntityRefs:[],tags:[],estimatedSize:"unspecified",energy:"unspecified",order:1,history:[],createdAt:iso(8),...p});
const goal=p=>({title:"G",description:"",status:"active",horizon:"year",linkedEntityRefs:[],tags:[],createdAt:iso(8),updatedAt:iso(8),...p});

/** A production database at 0044: no sync_version column, no push_guarded_rows. */
function db0044(){
  const db=new Map(); const table=t=>{let m=db.get(t);if(!m){m=new Map();db.set(t,m);}return m;};
  const from=t=>({
    upsert:rows=>{const a=Array.isArray(rows)?rows:[rows];
      // A 0044 table has no sync_version column; PostgREST rejects an unknown column.
      for(const r of a) if("sync_version" in r) return Promise.resolve({error:{message:`column "sync_version" of relation "${t}" does not exist`}});
      for(const r of a) table(t).set(r.id,{...table(t).get(r.id),...r}); return Promise.resolve({error:null,data:a});},
    insert:rows=>{const a=Array.isArray(rows)?rows:[rows];for(const r of a)table(t).set(r.id??`${r.domain}:${r.record_id}`,r);return Promise.resolve({error:null});},
    delete:()=>({in:(_c,ids)=>{for(const i of ids)table(t).delete(i);return Promise.resolve({error:null});},eq:()=>Promise.resolve({error:null})}),
    select:()=>{const all=[...table(t).values()];const q=Promise.resolve({data:all,error:null});q.order=()=>q;q.eq=()=>q;
      // `select("id,sync_version")` on a 0044 table is itself an error.
      q.in=()=>Promise.resolve({data:null,error:{message:`column "sync_version" does not exist`}});return q;},
  });
  // 0044 has no such function.
  const rpc=(name)=>Promise.resolve({error:{message:`Could not find the function public.${name}(payload, target) in the schema cache`},data:null});
  return {db,table,client:{from,rpc,auth:{getUser:async()=>({data:{user:{id:"u1"}}})}}};
}
(async()=>{
  const e=()=>emptyStoreState();
  const S=db0044();
  S.table("next_actions").set("a1",{id:"a1",title:"File the tax return",status:"open",created_at:iso(8),updated_at:iso(8),history:[]});
  P.__setRemoteForTest(new SupabasePersistenceAdapter(S.client));
  const base={...e(),nextActions:[act({id:"a1",title:"File the tax return"})],goals:[goal({id:"g1"})]};
  const done={...e(),nextActions:[act({id:"a1",title:"File the tax return",status:"completed",completedAt:iso(14),updatedAt:iso(14),history:[{at:iso(14),action:"completed",detail:"posted it"}]})],goals:[goal({id:"g1",title:"G edited",updatedAt:iso(14)})]};
  P.saveLocalOnly(base);
  P.saveState(done);
  await P.__flushNowForTest(done);
  const h=P.getHealth(), diag=P.getSyncDiagnostics();
  const local=JSON.parse(store.get("lifeos.mvp.v1")||"{}");
  const out=[]; const ok=(n,p2,d)=>{out.push({n,p:p2}); console.log(`${p2?"PASS":"FAIL"}  ${n}${p2?"":` — ${d??""}`}`);};
  const srv=S.table("next_actions").get("a1");
  const la=local.nextActions?.[0];

  ok("L1 §2b the guarded push FAILS against a 0044 database",
    diag.failedDomains.some(f=>(f.domain??f)==="nextActions"), JSON.stringify(diag.failedDomains));
  ok("L2 §2b …and the server row is untouched", srv.status==="open" && !srv.completed_at, JSON.stringify(srv));
  ok("L3 §2b the user's completion SURVIVES on the device",
    la?.status==="completed" && !!la?.completedAt, JSON.stringify(la&&{s:la.status,c:la.completedAt}));
  ok("L4 §2b …including its history entry",
    (la?.history??[]).some(x=>x.action==="completed"), JSON.stringify(la?.history));
  ok("L5 §2b the failure is VISIBLE, not silent",
    ["failed","incomplete","retrying"].includes(h.state), h.state);
  ok("L6 §2b sync is not falsely reported complete", h.state!=="synced", h.state);
  ok("L7 §2b the domain stays dirty, so the work lands once 0045 is applied",
    diag.dirtyDomains.includes("nextActions"), JSON.stringify(diag.dirtyDomains));
  ok("L8 §2b UNGUARDED domains keep syncing — the rest of the app is unaffected",
    [...S.table("goals").values()].some(g=>g.title==="G edited"), JSON.stringify([...S.table("goals").values()].map(g=>g.title)));
  ok("L9 §2b no phantom conflict is invented from a missing function (the R9 fix)",
    C.getConflicts().length===0, JSON.stringify(C.getConflicts().map(c=>c.id)));

  console.log("");
  console.log("health:", JSON.stringify({state:h.state, localError:h.localError??null}));
  console.log("failedDomains:", JSON.stringify(diag.failedDomains));
  console.log("dirtyDomains:", JSON.stringify(diag.dirtyDomains));
  console.log("server next_actions:", JSON.stringify(S.table("next_actions").get("a1")));
  console.log("server goals:", JSON.stringify([...S.table("goals").values()]));
  console.log("local action preserved:", JSON.stringify({status:local.nextActions?.[0]?.status, completedAt:local.nextActions?.[0]?.completedAt, history:local.nextActions?.[0]?.history?.length}));
  console.log("conflicts invented:", C.getConflicts().length);
  const bad=out.filter(r=>!r.p);
  console.log(`\n=== ${out.length-bad.length}/${out.length} live-window assertions ===`);
  process.exit(bad.length?1:0);
})().catch(e=>{console.error("THREW:",e.message);process.exit(1);});
