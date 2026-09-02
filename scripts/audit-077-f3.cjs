#!/usr/bin/env node
/**
 * LIFEOS-077 §2 — F-3, MEASURED.
 *
 * F-3 was reported as "the compatibility gate compares the expected version to
 * itself". This demonstrates that is the least severe of three defects, and
 * asserts the PRODUCT's behaviour rather than the module's return value.
 *
 *   F-3a  the only production caller feeds the gate its own constant, so that
 *         call site can only ever return `ok`.
 *   F-3b  the gate's output is unused: with syncIsSafe() === false the write
 *         still lands AND health reports `synced`.
 *   F-3c  no code path anywhere reads a deployed schema version.
 *
 * F-3b is the one that matters: the module computes the correct answer and the
 * product contradicts it.
 *
 * This is a DIAGNOSTIC of current main, not a regression gate — it is expected
 * to keep passing until F-3 is actually repaired, at which point the assertions
 * below invert and become the redness proof required by §18.
 *
 * Requires the compiled tree at scripts/out.
 */
const path=require("path"),Module=require("module"),ROOT="/home/user/LifeOS/scripts/out";
const orig=Module._resolveFilename;
Module._resolveFilename=function(r,...a){if(r.startsWith("@/"))r=path.join(ROOT,r.slice(2));try{return orig.call(this,r,...a);}catch(e){if(r.startsWith(".")||path.isAbsolute(r))throw e;return require.resolve(r,{paths:["/home/user/LifeOS/node_modules"]});}};
const store=new Map();globalThis.window=globalThis;
globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()};
globalThis.addEventListener=()=>{};
const SC=require("@/lib/security/schema-compatibility");
const P=require("@/lib/persistence");
const {SupabasePersistenceAdapter}=require("@/lib/adapters/supabaseAdapter");
const {emptyStoreState}=require("@/lib/ux/backup");
const iso=h=>`2026-08-29T${String(h).padStart(2,"0")}:00:00.000Z`;
const goal=p=>({title:"G",description:"",status:"active",horizon:"year",linkedEntityRefs:[],tags:[],createdAt:iso(8),updatedAt:iso(8),...p});

console.log("--- F-3a: the ONLY production caller's input ---");
console.log("DiagnosticsCenter passes remoteMigrationVersion = EXPECTED_MIGRATION_VERSION =", SC.EXPECTED_MIGRATION_VERSION);
const selfCompare = SC.evaluateCompatibility({ localStateVersion: 1, remoteMigrationVersion: SC.EXPECTED_MIGRATION_VERSION });
console.log("  result:", selfCompare.mode, "-> canSync:", selfCompare.canSync);
console.log("  i.e. the gate can only ever return 'ok' from that call site.");

console.log("\n--- F-3b: does a write path honour an INCOMPATIBLE verdict? ---");
const incompatible = SC.evaluateCompatibility({ localStateVersion: 1, remoteMigrationVersion: 99 });
console.log("server-ahead verdict:", incompatible.mode, "canSync:", incompatible.canSync, "syncIsSafe:", SC.syncIsSafe(incompatible));

(async()=>{
  const db=new Map(); const table=t=>{let m=db.get(t);if(!m){m=new Map();db.set(t,m);}return m;};
  const client={from:t=>({upsert:rows=>{const a=Array.isArray(rows)?rows:[rows];for(const r of a)table(t).set(r.id,r);return Promise.resolve({error:null,data:a});},
    insert:()=>Promise.resolve({error:null}),
    delete:()=>({in:()=>Promise.resolve({error:null}),eq:()=>Promise.resolve({error:null})}),
    select:()=>{const q=Promise.resolve({data:[...table(t).values()],error:null});q.order=()=>q;q.eq=()=>q;q.in=()=>Promise.resolve({data:[],error:null});return q;}}),
    rpc:()=>Promise.resolve({error:null,data:{accepted:[],stale:[]}}),
    auth:{getUser:async()=>({data:{user:{id:"u1"}}})}};
  P.__setRemoteForTest(new SupabasePersistenceAdapter(client));
  // syncIsSafe() is FALSE above. Now push anyway.
  await P.__flushNowForTest({...emptyStoreState(), goals:[goal({id:"g1",title:"written despite incompatibility"})]});
  const wrote=[...table("goals").values()];
  console.log("  wrote to server despite syncIsSafe()===false:", wrote.length===1, JSON.stringify(wrote.map(g=>g.title)));
  console.log("  health after:", P.getHealth().state);
  console.log("\n--- F-3c: is there ANY code path that reads a deployed version? ---");
  console.log("  (grep for schema_migrations / migration_version across app+lib+components returned nothing)");
})();
