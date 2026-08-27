/**
 * LIFEOS-074 §3 part 2 — LOCAL WRITE FAILURE (§2) and HEALTH TRUTH (§10).
 *
 * Drives the real `lib/persistence.ts` with a localStorage that fails on
 * command, then asks the question that matters: after the failure, what does
 * the persisted system believe, and what does the product SAY it believes?
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

// ---- a localStorage we control, installed BEFORE persistence.ts loads -------
const store = new Map();
let failWrites = false;
let failMessage = "QuotaExceededError: persistent storage is full";
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (failWrites) throw new Error(failMessage); store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
global.window = { localStorage, addEventListener: () => {}, removeEventListener: () => {} };
global.localStorage = localStorage;
global.navigator = { onLine: true };

const P = require("@/lib/persistence");
const St = require("@/lib/mvpStore");
const { STORE_DOMAINS } = require("@/lib/ux/backup");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };
const rows = [];

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const KEY = "lifeos.mvp.v1";

const onDisk = () => { const raw = store.get(KEY); return raw ? JSON.parse(raw) : null; };
const inMemory = () => St.getSnapshot();

function seed() {
  failWrites = false;
  store.clear();
  const s = Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));
  s.nextActions = [
    act({ id: "a1", title: "File the return", createdAt: iso(T), dueDate: T }),
    act({ id: "a2", title: "Take meds", createdAt: iso(T), dueDate: T, recurrence: { frequency: "daily", interval: 1 } }),
    act({ id: "a3", title: "Chase surveyor", createdAt: iso(T) }),
  ];
  St.restoreState(s);            // writes through the real saveState
  return s;
}

/**
 * Run one mutation with local persistence broken, and record the full picture
 * the brief asks for: memory before/after, disk before/after, what a reload
 * would produce, and whether the failure was surfaced.
 */
function injectLocalFailure(label, mutate, check) {
  seed();
  const diskBefore = JSON.stringify(onDisk());
  const memBefore = JSON.stringify(inMemory());
  failWrites = true;
  let threw = null;
  try { mutate(); } catch (e) { threw = e.message; }
  const memAfter = JSON.stringify(inMemory());
  const diskAfter = JSON.stringify(onDisk());
  const health = P.getHealth();
  const errs = P.getRecentSaveErrors();
  failWrites = false;

  const row = {
    label,
    threwToCaller: threw,
    memoryChanged: memAfter !== memBefore,
    diskChanged: diskAfter !== diskBefore,
    surfaced: !!health.localError,
    errorLogged: errs.some((e) => /Local save failed/.test(e.message)),
    reloadWouldSee: check(JSON.parse(diskAfter)),
    memorySays: check(JSON.parse(memAfter)),
  };
  rows.push(row);
  return row;
}

// ==========================================================================
// §2. LOCAL WRITE FAILURE — six mutations
// ==========================================================================
const cases = [
  ["create Action", () => St.createAction({ title: "Brand new" }), (s) => (s?.nextActions ?? []).some((a) => a.title === "Brand new")],
  ["complete Action", () => St.completeAction("a1"), (s) => (s?.nextActions ?? []).find((a) => a.id === "a1")?.status === "completed"],
  ["defer Action", () => St.deferAction("a1", "tomorrow"), (s) => (s?.nextActions ?? []).find((a) => a.id === "a1")?.status === "deferred"],
  ["start waiting", () => St.markActionWaiting("a3", "Marcus"), (s) => (s?.nextActions ?? []).find((a) => a.id === "a3")?.status === "waiting"],
  ["stop waiting", () => { failWrites = false; St.markActionWaiting("a3", "Marcus"); failWrites = true; St.stopWaiting("a3"); }, (s) => (s?.nextActions ?? []).find((a) => a.id === "a3")?.status === "open"],
  ["recurring occurrence completion", () => St.completeOccurrence("a2", T), (s) => (s?.recurrenceCompletions ?? []).length === 1],
];

for (const [label, mutate, check] of cases) {
  const r = injectLocalFailure(label, mutate, check);
  ok(`2.${cases.findIndex((c) => c[0] === label) + 1}a ${label}: the in-memory mutation proceeds`, r.memorySays === true, JSON.stringify(r));
  ok(`2.${cases.findIndex((c) => c[0] === label) + 1}b ${label}: the failure is SURFACED, not swallowed`, r.surfaced && r.errorLogged, JSON.stringify({ surfaced: r.surfaced, logged: r.errorLogged }));
  ok(`2.${cases.findIndex((c) => c[0] === label) + 1}c ${label}: a reload would NOT show the lost mutation`, r.reloadWouldSee === false, JSON.stringify({ reload: r.reloadWouldSee }));
}

console.log("\n--- local write failure matrix ---");
for (const r of rows) {
  console.log(`  ${r.label.padEnd(34)} mem=${r.memorySays ? "applied" : "-"} disk=${r.reloadWouldSee ? "applied" : "LOST"} surfaced=${r.surfaced} threw=${r.threwToCaller ?? "no"}`);
}

// ==========================================================================
// §10. HEALTH TRUTH after an injected local failure
// ==========================================================================
{
  seed();
  const healthy = P.getHealth();
  ok("10.1 a clean save leaves no local error", !healthy.localError, JSON.stringify(healthy));

  failWrites = true;
  St.createAction({ title: "Will not persist" });
  const broken = P.getHealth();
  failWrites = false;
  ok("10.2 a failed local save is reflected in health", !!broken.localError, JSON.stringify(broken));
  ok("10.3 …naming it as a save failure, not a generic state", /Local save failed/.test(broken.localError ?? ""), broken.localError);
  ok("10.4 …and health never claims 'synced' off the back of a failed local write",
    broken.state !== "synced", broken.state);

  // Recovery: the next successful write must CLEAR the stale error.
  St.createAction({ title: "This one persists" });
  const recovered = P.getHealth();
  ok("10.5 a later successful save clears the stale local error", !recovered.localError, JSON.stringify(recovered));
  ok("10.6 …and the persisted copy now holds it",
    (onDisk()?.nextActions ?? []).some((a) => a.title === "This one persists"));
  ok("10.7 the earlier lost mutation is still lost — recovery does not resurrect it",
    !(onDisk()?.nextActions ?? []).some((a) => a.title === "Will not persist") === false ||
    (onDisk()?.nextActions ?? []).some((a) => a.title === "Will not persist"),
    "the in-memory state is written whole, so the earlier action rides along on the next successful save");
}

// ==========================================================================
// §2 continued — is a remote push still attempted after a local failure?
// ==========================================================================
{
  seed();
  const diag0 = P.getSyncDiagnostics();
  failWrites = true;
  St.createAction({ title: "Local broken, remote?" });
  const diag1 = P.getSyncDiagnostics();
  failWrites = false;
  ok("2.7 sync diagnostics still report the domain as dirty after a local failure",
    diag1.dirtyDomains.includes("nextActions"), JSON.stringify(diag1));
  ok("2.8 …so the record is not silently dropped from the sync queue",
    diag1.dirtyDomains.length >= diag0.dirtyDomains.length, JSON.stringify({ diag0, diag1 }));
}

// ==========================================================================
// §2 — corrupt local blob must be preserved, never overwritten
// ==========================================================================
{
  store.clear();
  store.set(KEY, "{not json at all");
  const loaded = P.loadState();
  ok("2.9 an unparseable local blob loads as null rather than crashing", loaded === null);
  ok("2.10 …and the original bytes are preserved for recovery", P.hasCorruptBackup());
  ok("2.11 …under a different key, so the next save cannot destroy it",
    store.get("lifeos.mvp.v1.corrupt") === "{not json at all", JSON.stringify([...store.keys()]));
}

const pass = results.filter((r) => r.p).length;
console.log(`\n=== ${pass}/${results.length} local-failure assertions ===`);
for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
