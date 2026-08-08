/* eslint-disable */
/**
 * Reproduction: authenticated Capture persistence durability (LIFEOS capture-persistence fix).
 *
 * Drives the REAL lib/mvpStore + lib/persistence through the sign-in adoption
 * race with a mock Supabase adapter (controllable remote-load delay + failable
 * writes). Proves a Capture created during sign-in survives locally, is pushed
 * remotely, and that a remote failure keeps it local + retryable (never rolled
 * back). Run from the repo root:  node scripts/repro-capture-persistence.cjs
 *
 * Against the pre-fix persistence.ts this FAILS at "survives adoption"
 * (the capture is wiped from memory + disk); with the fix it is 13/13.
 */
const path=require("path"); const Module=require("module");
const ts=require(path.join(process.cwd(),"node_modules/typescript"));
const CWD=process.cwd();
const alias=(r)=>r.startsWith("@/")?path.join(CWD,r.slice(2)):r;
const orig=Module._resolveFilename; Module._resolveFilename=function(r,...a){ try{return orig.call(this,alias(r),...a);}catch(e){ return alias(r)+".ts"; } };
require.extensions[".ts"]=function(m,f){const s=require("fs").readFileSync(f,"utf8");m._compile(ts.transpileModule(s,{compilerOptions:{module:"commonjs",target:"es2020",esModuleInterop:true,jsx:"react"}}).outputText,f);};

// ---- fake browser env ----
const store={};
global.window = {
  localStorage:{ getItem:(k)=>k in store?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:(k)=>{delete store[k];} },
  addEventListener(){}, removeEventListener(){},
};
global.localStorage = global.window.localStorage;
global.navigator = { onLine:true };

// ---- controllable fake remote adapter ----
let remoteRows = { captures: [] };           // what "Supabase" holds
let loadDelayMs = 60;
let failNextSaves = 0;                        // number of saveState calls to fail
const pushed = [];                           // states pushed to remote
function nowIso(){ return new Date().toISOString(); }
class FakeAdapter {
  constructor(client){ this.client=client; }
  async loadState(){ await new Promise(r=>setTimeout(r, loadDelayMs)); return { captures: remoteRows.captures.map(c=>({...c})) }; }
  async saveState(state){
    if (failNextSaves>0){ failNextSaves--; throw new Error("simulated remote sync failure"); }
    // apply captures upsert into remoteRows (by id)
    const byId=new Map(remoteRows.captures.map(c=>[c.id,c]));
    for(const c of (state.captures||[])) byId.set(c.id,{...c});
    remoteRows.captures=[...byId.values()];
    pushed.push((state.captures||[]).map(c=>c.id));
  }
  async deleteAll(){ remoteRows={captures:[]}; }
  health(){ return {mode:"supabase",state:"synced"}; }
}

// ---- inject fake modules into require cache ----
function seed(rel, exports){ const p=path.join(CWD,rel); require.cache[p]={id:p,filename:p,loaded:true,exports}; }
let authCb=null;
const fakeClient={ auth:{ onAuthStateChange:(cb)=>{authCb=cb; return {data:{subscription:{unsubscribe(){}}}};}, getUser:async()=>({data:{user:{id:"user-1"}}}) } };
seed("lib/supabase.ts", { isSupabaseConfigured:()=>true, getSupabaseClient:()=>fakeClient });
seed("lib/adapters/supabaseAdapter.ts", { SupabasePersistenceAdapter: FakeAdapter });

// ---- load REAL store + persistence ----
const mvp=require(path.join(CWD,"lib/mvpStore.ts"));
const persistence=require(path.join(CWD,"lib/persistence.ts"));
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));

const disk=()=>JSON.parse(store["lifeos.mvp.v1"]||"{}");
const results=[]; const ok=(n,c,d="")=>{results.push({n,pass:!!c,d}); };

async function scenarioA_returningUser(){
  // Returning user: remote already has an older capture R1. Local starts empty.
  remoteRows={captures:[{id:"R1",text:"older",createdAt:nowIso(),processingStatus:"inbox"}]};
  store["lifeos.mvp.v1"]=JSON.stringify(mvp.getStateForTest? mvp.getStateForTest(): {}); // seed nothing special
  // hydrate empty local
  mvp.hydrate();
  await persistence.initPersistence(mvp.replaceState);
  // sign in
  authCb("SIGNED_IN", { user:{id:"user-1"} });
  // DURING the ~60ms remote load window, user creates Capture A:
  await wait(15);
  const aId = mvp.addCapture("typed right after sign-in");
  // capture must exist locally IMMEDIATELY
  ok("A: capture exists locally immediately", disk().captures.some(c=>c.id===aId));
  ok("A: capture on disk immediately", JSON.parse(store["lifeos.mvp.v1"]).captures.some(c=>c.id===aId));
  // let adoption + flush settle
  await wait(900);
  const st=disk();
  ok("A: capture SURVIVES adoption in memory", st.captures.some(c=>c.id===aId));
  ok("A: remote capture R1 also present (union)", st.captures.some(c=>c.id==="R1"));
  ok("A: capture SURVIVES adoption on disk", JSON.parse(store["lifeos.mvp.v1"]).captures.some(c=>c.id===aId));
  ok("A: capture A was pushed to remote", remoteRows.captures.some(c=>c.id===aId));
  ok("A: health is synced after push", persistence.getHealth().state==="synced");
  return aId;
}

async function scenarioB_failThenRetry(){
  // Simulate remote failure for Capture B, then recover.
  failNextSaves=99; // fail all pushes
  const bId=mvp.addCapture("capture B while remote is down");
  ok("B: capture B exists locally", disk().captures.some(c=>c.id===bId));
  await wait(1200); // through debounce + a retry or two
  ok("B: B still local after remote failure", JSON.parse(store["lifeos.mvp.v1"]).captures.some(c=>c.id===bId));
  ok("B: B NOT yet on remote (write failed)", !remoteRows.captures.some(c=>c.id===bId));
  ok("B: health reflects error/retry, NOT synced", ["failed","retrying","offline"].includes(persistence.getHealth().state));
  // restore connectivity + manual retry
  failNextSaves=0;
  await persistence.retrySync();
  await wait(300);
  ok("B: after retry, B persists remotely", remoteRows.captures.some(c=>c.id===bId));
  ok("B: health synced after recovery", persistence.getHealth().state==="synced");
}

(async()=>{
  await scenarioA_returningUser();
  await scenarioB_failThenRetry();
  for(const r of results) console.log(`${r.pass?"✓":"✗"} ${r.n}${r.pass?"":" — "+r.d}`);
  const p=results.filter(r=>r.pass).length;
  console.log(`\n${p}/${results.length} ${p===results.length?"PASS":"FAIL"}`);
  process.exit(p===results.length?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
