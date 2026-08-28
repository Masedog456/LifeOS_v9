/**
 * LIFEOS-074 — TOMBSTONE FAILURE INTEGRITY GATE.
 *
 * The required question is not "is the code shaped safely" but "drive the real
 * lifecycle and see whether a deleted record can come back". So this runs the
 * real adapter delete, the real `reconcileAdoption`, and the real push, with the
 * tombstone write made to fail on command.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { reconcileAdoption, mergeLocalOnly } = require("@/lib/persistence-reconcile");
const { applyTombstones, makeTombstone, shouldSuppress } = require("@/lib/sync/tombstones");
const { STORE_DOMAINS } = require("@/lib/ux/backup");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const empty = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));

function fakeClient(fails = {}) {
  const db = new Map(), calls = [];
  const put = (t, rows) => { const m = db.get(t) ?? new Map(); for (const r of rows) m.set(r.id ?? `${r.domain}:${r.record_id}`, r); db.set(t, m); };
  const from = (t) => ({
    upsert: (rows) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      calls.push(`upsert:${t}`);
      if (fails[t]) return Promise.reject(new Error(`upsert failed: ${t}`));
      put(t, arr); return Promise.resolve({ error: null, data: arr });
    },
    delete: () => ({
      in: (_c, ids) => { calls.push(`delete:${t}`); if (fails[t]) return Promise.resolve({ error: { message: `delete failed: ${t}` } }); const m = db.get(t); if (m) for (const i of ids) m.delete(i); return Promise.resolve({ error: null }); },
      eq: () => { calls.push(`delete-eq:${t}`); return Promise.resolve({ error: null }); },
    }),
    select: () => { const q = Promise.resolve({ data: [...(db.get(t)?.values() ?? [])], error: null }); q.order = () => q; q.eq = () => q; return q; },
  });
  return { client: { from, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }, db, calls, fails };
}
const rows = (db, t) => [...(db.get(t)?.values() ?? [])];

(async () => {
  // =====================================================================
  // 0. Is the tombstone even ON the resurrection-prevention path?
  // =====================================================================
  const adapterSrc = require("fs").readFileSync("/home/user/LifeOS/lib/adapters/supabaseAdapter.ts", "utf8");
  // Slice the REAL body: from the signature to the first column-2 close brace.
  // The first attempt sliced as far as `saveStateByDomain` and swept up the
  // idempotency doc comment, which mentions sync_tombstones — a false positive
  // of my own making.
  const lsStart = adapterSrc.indexOf("async loadState()");
  const loadStateBody = adapterSrc.slice(lsStart, adapterSrc.indexOf("\n  }", lsStart));
  ok("T0 `loadState` never reads sync_tombstones", !/sync_tombstones/.test(loadStateBody),
    "loadState reads tombstones after all — re-examine");
  ok("T0b …and no SELECT on sync_tombstones exists anywhere in the adapter",
    !/from\("sync_tombstones"\)[\s\S]{0,40}\.select/.test(adapterSrc),
    "a select exists — re-examine");
  // An IMPORT or a CALL, not a mention: the finding is now documented in
  // `persistence-reconcile.ts`, and a filename grep counted that prose as a
  // caller on the first run.
  const importers = require("child_process").execSync(
    `grep -rlE "applyTombstones\\(|import[^\n]*applyTombstones" /home/user/LifeOS/lib /home/user/LifeOS/app /home/user/LifeOS/components 2>/dev/null || true`)
    .toString().trim().split("\n").filter(Boolean);
  const nonTest = importers.filter((f) => !/tombstones\.ts$|selftest/.test(f));
  ok("T1 `applyTombstones` is never imported or called outside its own module + tests",
    nonTest.length === 0, JSON.stringify(nonTest));

  // =====================================================================
  // 1-4. The lifecycle: delete succeeds, tombstone write fails.
  // =====================================================================
  const deviceA = () => { const s = empty(); s.nextActions = [act({ id: "a1", title: "Keep", createdAt: iso(T) }), act({ id: "a2", title: "Delete me", createdAt: iso(T) })]; s.actionDependencies = [{ id: "d1", blockerId: "a1", blockedId: "a2", createdAt: iso(T) }]; s.recurrenceCompletions = [{ id: "rc1", actionId: "a2", occurrenceDate: T, completedAt: iso(T) }]; return s; };

  const fc = fakeClient();
  const ad = new SupabasePersistenceAdapter(fc.client);
  const before = deviceA();
  await ad.saveStateByDomain(before, undefined, null);
  ok("T2 both records start out remote", rows(fc.db, "next_actions").length === 2);

  // Device A deletes a2 (and, as the store does, its edges + completions).
  const afterDelete = { ...before, nextActions: before.nextActions.filter((a) => a.id !== "a2"), actionDependencies: [], recurrenceCompletions: [] };
  fc.fails.sync_tombstones = true;                       // step 4: tombstone write fails
  const rep = await ad.saveStateByDomain(afterDelete, new Set(["nextActions", "actionDependencies", "recurrenceCompletions"]), before);
  delete fc.fails.sync_tombstones;
  ok("T3 the remote DELETE succeeded", rows(fc.db, "next_actions").length === 1 && !rows(fc.db, "next_actions").some((r) => r.id === "a2"));
  ok("T4 …and the tombstone write did NOT land", rows(fc.db, "sync_tombstones").length === 0, JSON.stringify(rows(fc.db, "sync_tombstones")));
  ok("T5 …yet the domain still counts as SUCCEEDED, so it is never retried",
    rep.failed.length === 0 && rep.succeeded.includes("nextActions"), JSON.stringify(rep.failed));

  // =====================================================================
  // 5. Later: another device that still holds a2 signs in and adopts.
  // =====================================================================
  const remoteNow = empty();
  remoteNow.nextActions = rows(fc.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
  remoteNow.sources = [{ id: "s1", title: "x", keyQuotes: [] }];       // make remote "have data"
  const deviceB = deviceA();                                            // stale: still holds a2

  const decision = reconcileAdoption({
    remote: remoteNow, local: deviceB, remoteHasData: true, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  const resurrected = decision.state.nextActions.some((a) => a.id === "a2");
  ok("T6 RESURRECTION: the deleted record comes back on adoption", resurrected === true,
    `resurrected=${resurrected} action=${decision.action}`);
  ok("T7 …and is flagged to be PUSHED BACK to the server", decision.pushLocalOnly === true, JSON.stringify(decision.action));
  ok("T8 RELATED DATA returns too — the dependency edge",
    decision.state.actionDependencies.some((d) => d.id === "d1"));
  ok("T9 …and the completion row", decision.state.recurrenceCompletions.some((c) => c.id === "rc1"));

  // Drive the push, so this is not an inference about what "would" happen.
  const ad2 = new SupabasePersistenceAdapter(fc.client);
  await ad2.saveStateByDomain(decision.state, undefined, decision.baseline);
  ok("T10 …and the resurrected record is BACK IN THE DATABASE",
    rows(fc.db, "next_actions").some((r) => r.id === "a2"), JSON.stringify(rows(fc.db, "next_actions").map((r) => r.id)));

  // =====================================================================
  // 6. THE CONTROL: would a SUCCESSFUL tombstone have prevented any of it?
  // =====================================================================
  const fc2 = fakeClient();
  const ad3 = new SupabasePersistenceAdapter(fc2.client);
  await ad3.saveStateByDomain(deviceA(), undefined, null);
  await ad3.saveStateByDomain(afterDelete, new Set(["nextActions", "actionDependencies", "recurrenceCompletions"]), deviceA());
  ok("T11 CONTROL: this time the tombstone DID land", rows(fc2.db, "sync_tombstones").length > 0,
    JSON.stringify(rows(fc2.db, "sync_tombstones")));
  const remote2 = empty();
  remote2.nextActions = rows(fc2.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
  remote2.sources = [{ id: "s1", title: "x", keyQuotes: [] }];
  const decision2 = reconcileAdoption({
    remote: remote2, local: deviceA(), remoteHasData: true, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  ok("T12 …and the record is resurrected ANYWAY — the tombstone changes nothing",
    decision2.state.nextActions.some((a) => a.id === "a2"),
    "a written tombstone DID prevent resurrection — the mechanism is wired after all");

  // The pure layer works; it is simply never consulted.
  const tomb = makeTombstone("nextActions", "a2", iso(T, 12));
  const applied = applyTombstones("nextActions", [{ id: "a2", updatedAt: iso(T, 8) }], [tomb]);
  ok("T13 the pure tombstone layer WOULD suppress it, if anything called it",
    applied.suppressed.includes("a2"), JSON.stringify(applied));
  ok("T14 …and correctly declines to suppress an edit made AFTER the delete",
    !shouldSuppress(tomb, { updatedAt: iso(T, 20) }));

  // =====================================================================
  // 7. The OPPOSITE partial shape: tombstone succeeds, primary delete fails.
  // =====================================================================
  const fc3 = fakeClient();
  const ad4 = new SupabasePersistenceAdapter(fc3.client);
  await ad4.saveStateByDomain(deviceA(), undefined, null);
  fc3.fails.next_actions = true;
  const rep3 = await ad4.saveStateByDomain(afterDelete, new Set(["nextActions"]), deviceA());
  delete fc3.fails.next_actions;
  ok("T15 a failing delete fails the domain", rep3.failed.some((f) => f.domain === "nextActions"), JSON.stringify(rep3.failed));
  ok("T16 …and the tombstone is NEVER written when the delete failed",
    rows(fc3.db, "sync_tombstones").length === 0, JSON.stringify(rows(fc3.db, "sync_tombstones")));
  ok("T17 …so 'tombstone without delete' is unreachable: the delete is always awaited first",
    !fc3.calls.includes("upsert:sync_tombstones"), JSON.stringify(fc3.calls));
  ok("T18 …and the record correctly survives remotely, matching the reported failure",
    rows(fc3.db, "next_actions").some((r) => r.id === "a2"));

  // =====================================================================
  // 8. How reachable? Adoption runs on EVERY load, not only at sign-in.
  // =====================================================================
  const persistSrc = require("fs").readFileSync("/home/user/LifeOS/lib/persistence.ts", "utf8");
  ok("T19 adoption is driven by INITIAL_SESSION, i.e. every app load for a signed-in user",
    /INITIAL_SESSION/.test(persistSrc) && /queueSession\(session, replaceState\)/.test(persistSrc));

  // The empty-remote branch resurrects too, by a different route.
  const decision3 = reconcileAdoption({
    remote: empty(), local: deviceA(), remoteHasData: false, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  ok("T20 with an 'empty' remote the stale local copy wins wholesale",
    decision3.action === "migrate-local" && decision3.state.nextActions.some((a) => a.id === "a2"),
    decision3.action);

  // And the round trip: once B pushes it back, A adopts the resurrection.
  const remoteAfterB = empty();
  remoteAfterB.nextActions = rows(fc.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
  remoteAfterB.sources = [{ id: "s1", title: "x", keyQuotes: [] }];
  const onA = reconcileAdoption({
    remote: remoteAfterB, local: afterDelete, remoteHasData: true, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  ok("T21 the device that DID the delete then adopts the record back",
    onA.state.nextActions.some((a) => a.id === "a2"),
    JSON.stringify(onA.state.nextActions.map((a) => a.id)));

  const pass = results.filter((r) => r.p).length;
  console.log(`\n=== ${pass}/${results.length} tombstone-gate assertions ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
