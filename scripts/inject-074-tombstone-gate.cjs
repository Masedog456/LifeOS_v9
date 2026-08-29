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
const { reconcileAdoption, mergeLocalOnly, suppressDeleted } = require("@/lib/persistence-reconcile");
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
  ok("T0b the adapter now SELECTs sync_tombstones (the D-24 repair)",
    /from\("sync_tombstones"\)[\s\S]{0,40}\.select/.test(adapterSrc),
    "the read is gone — D-24 has regressed");
  // An IMPORT or a CALL, not a mention: the finding is now documented in
  // `persistence-reconcile.ts`, and a filename grep counted that prose as a
  // caller on the first run.
  // A CALL, not a mention. The first version embedded a literal newline in the
  // shell pattern and matched nothing, which read as "still unwired" while the
  // wiring was in place two files away.
  const callers = require("child_process").execSync(
    `grep -rlE "applyTombstones\\(" /home/user/LifeOS/lib /home/user/LifeOS/app /home/user/LifeOS/components 2>/dev/null || true`)
    .toString().trim().split("\n").filter(Boolean)
    .filter((f) => !/tombstones\.ts$|selftest/.test(f));
  ok("T1 `applyTombstones` IS called from production code now",
    callers.length > 0, JSON.stringify(callers));
  ok("T1b …specifically from the adoption path", callers.some((f) => /persistence-reconcile/.test(f)), JSON.stringify(callers));

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
  ok("T5 …and the domain is now reported FAILED, so the marker is retried (D-24 §5)",
    rep.failed.some((f) => f.domain === "nextActions"), JSON.stringify(rep.failed));

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
  // With the ledger UNREADABLE (or empty), nothing is suppressed — the D-24
  // behaviour, kept as the control so the repair is measured against it.
  const resurrected = decision.state.nextActions.some((a) => a.id === "a2");
  ok("T6 CONTROL: with no deletion marker the record still comes back", resurrected === true,
    `resurrected=${resurrected} action=${decision.action}`);
  ok("T7 …and is flagged to be PUSHED BACK to the server", decision.pushLocalOnly === true, JSON.stringify(decision.action));
  ok("T8 …with its dependency edge", decision.state.actionDependencies.some((d) => d.id === "d1"));
  ok("T9 …and its completion row", decision.state.recurrenceCompletions.some((c) => c.id === "rc1"));

  // ===================== §7 A-G: THE REPAIRED LIFECYCLE =====================
  {
    const fcR = fakeClient();
    const adR = new SupabasePersistenceAdapter(fcR.client);
    // A. Both devices hold X.
    const start = deviceA();
    await adR.saveStateByDomain(start, undefined, null);
    ok("G-A both devices' record starts out remote", rows(fcR.db, "next_actions").length === 2);

    // B-C-D. Device A deletes X; remote delete succeeds; tombstone succeeds.
    const del = { ...start, nextActions: start.nextActions.filter((a) => a.id !== "a2"), actionDependencies: [], recurrenceCompletions: [] };
    const repR = await adR.saveStateByDomain(del, new Set(["nextActions", "actionDependencies", "recurrenceCompletions"]), start);
    ok("G-B the delete reports success", repR.failed.length === 0, JSON.stringify(repR.failed));
    ok("G-C the remote row is gone", !rows(fcR.db, "next_actions").some((r) => r.id === "a2"));
    const tombs = await adR.loadTombstones();
    ok("G-D the tombstone is READABLE now — the ledger is no longer write-only",
      Array.isArray(tombs) && tombs.some((t) => t.domain === "nextActions" && t.recordId === "a2"),
      JSON.stringify(tombs));

    // E. Device B (stale) adopts.
    const remoteR = empty();
    remoteR.nextActions = rows(fcR.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
    remoteR.sources = [{ id: "s1", title: "x", keyQuotes: [] }];
    const staleB = suppressDeleted(deviceA(), tombs);
    const dB = reconcileAdoption({ remote: remoteR, local: staleB, remoteHasData: true, localHasData: true, migratedFor: "u1", userId: "u1", empty: empty() });
    ok("G-E X does NOT return on adoption", !dB.state.nextActions.some((a) => a.id === "a2"),
      JSON.stringify(dB.state.nextActions.map((a) => a.id)));
    ok("G-E2 …nor does its dependency edge", !dB.state.actionDependencies.some((d) => d.id === "d1"),
      JSON.stringify(dB.state.actionDependencies));
    ok("G-E3 …nor its completion row (the DB already cascades this)",
      !dB.state.recurrenceCompletions.some((c) => c.id === "rc1"), JSON.stringify(dB.state.recurrenceCompletions));
    ok("G-E4 the surviving record is untouched", dB.state.nextActions.some((a) => a.id === "a1"));

    // F. Device B pushes its state.
    await adR.saveStateByDomain(dB.state, undefined, dB.baseline);
    ok("G-F X does NOT reappear remotely", !rows(fcR.db, "next_actions").some((r) => r.id === "a2"),
      JSON.stringify(rows(fcR.db, "next_actions").map((r) => r.id)));

    // G. Device A reloads.
    const remoteAfter = empty();
    remoteAfter.nextActions = rows(fcR.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
    remoteAfter.sources = [{ id: "s1", title: "x", keyQuotes: [] }];
    const tombs2 = await adR.loadTombstones();
    const dA = reconcileAdoption({ remote: remoteAfter, local: suppressDeleted(del, tombs2), remoteHasData: true, localHasData: true, migratedFor: "u1", userId: "u1", empty: empty() });
    ok("G-G X remains deleted on the device that deleted it", !dA.state.nextActions.some((a) => a.id === "a2"));
  }

  // ============ §9 a genuine edit AFTER the delete is NOT suppressed ========
  {
    const tomb = makeTombstone("nextActions", "a2", iso(T, 12));
    const edited = empty();
    edited.nextActions = [act({ id: "a2", title: "Re-created deliberately", createdAt: iso(T), updatedAt: iso(T, 20) })];
    const kept = suppressDeleted(edited, [tomb]);
    ok("N1 an edit made AFTER the delete survives — resurrection intent is honoured",
      kept.nextActions.some((a) => a.id === "a2"), JSON.stringify(kept.nextActions.map((a) => a.id)));
    const stale = empty();
    stale.nextActions = [act({ id: "a2", title: "Stale copy", createdAt: iso(T), updatedAt: iso(T, 8) })];
    ok("N2 …while a copy older than the delete is suppressed",
      suppressDeleted(stale, [tomb]).nextActions.length === 0);
  }

  // ============ §8 FAILED TOMBSTONE: no false durability ==================
  {
    const fcF = fakeClient();
    const adF = new SupabasePersistenceAdapter(fcF.client);
    const start = deviceA();
    await adF.saveStateByDomain(start, undefined, null);
    const del = { ...start, nextActions: start.nextActions.filter((a) => a.id !== "a2"), actionDependencies: [], recurrenceCompletions: [] };
    fcF.fails.sync_tombstones = true;
    const repF = await adF.saveStateByDomain(del, new Set(["nextActions", "actionDependencies", "recurrenceCompletions"]), start);
    ok("F1 a failed tombstone now FAILS the domain — no false success",
      repF.failed.some((f) => f.domain === "nextActions"), JSON.stringify(repF));
    ok("F2 …so the domain stays dirty and retryable", !repF.succeeded.includes("nextActions"));
    ok("F3 the remote delete is NOT undone", !rows(fcF.db, "next_actions").some((r) => r.id === "a2"));
    ok("F4 …and no tombstone exists yet", rows(fcF.db, "sync_tombstones").length === 0);
    // The residual window: a stale client adopting BEFORE the retry resurrects.
    const remoteF = empty();
    remoteF.nextActions = rows(fcF.db, "next_actions").map((r) => act({ id: r.id, title: r.title, createdAt: iso(T) }));
    remoteF.sources = [{ id: "s1", title: "x", keyQuotes: [] }];
    const tombsF = await adF.loadTombstones();
    const dWindow = reconcileAdoption({ remote: remoteF, local: suppressDeleted(deviceA(), tombsF ?? []), remoteHasData: true, localHasData: true, migratedFor: "u1", userId: "u1", empty: empty() });
    ok("F5 RESIDUAL WINDOW (documented, not hidden): before the retry a stale client still resurrects",
      dWindow.state.nextActions.some((a) => a.id === "a2"),
      "the window has closed — re-read the residual-window note");
    // Retry: the tombstone is written and the window closes.
    delete fcF.fails.sync_tombstones;
    const repF2 = await adF.saveStateByDomain(del, new Set(["nextActions", "actionDependencies", "recurrenceCompletions"]), start);
    ok("F6 the retry succeeds", repF2.failed.length === 0, JSON.stringify(repF2.failed));
    ok("F7 …and writes the missing tombstone", rows(fcF.db, "sync_tombstones").some((r) => r.record_id === "a2"));
    const tombsF2 = await adF.loadTombstones();
    const dAfter = reconcileAdoption({ remote: remoteF, local: suppressDeleted(deviceA(), tombsF2), remoteHasData: true, localHasData: true, migratedFor: "u1", userId: "u1", empty: empty() });
    ok("F8 after recovery a later adoption suppresses the stale record",
      !dAfter.state.nextActions.some((a) => a.id === "a2"));
    ok("F9 the delete was never undone by any of it", !rows(fcF.db, "next_actions").some((r) => r.id === "a2"));
  }

  // ============ §10 retention: tombstones are permanent today =============
  {
    const src = require("fs").readFileSync("/home/user/LifeOS/lib/sync/tombstones.ts", "utf8");
    ok("R1 a retention helper exists but is still unwired, so tombstones are permanent",
      /cleanupTombstones/.test(src) &&
      require("child_process").execSync(`grep -rlE "cleanupTombstones\\(" /home/user/LifeOS/lib /home/user/LifeOS/app /home/user/LifeOS/components 2>/dev/null || true`)
        .toString().trim().split("\n").filter(Boolean).filter((f) => !/tombstones\.ts$|selftest/.test(f)).length === 0,
      "cleanup is now wired — expiry could let an old client resurrect; re-audit");
  }

  // The pure layer works; it is simply never consulted.
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
  // The migrate-local branch is the OTHER route to resurrection, and suppression
  // has to cover it too — `migrateOrAdopt` suppresses before reconciling, so
  // every branch sees an already-cleaned local snapshot.
  const rawLocal = reconcileAdoption({
    remote: empty(), local: deviceA(), remoteHasData: false, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  ok("T20 unsuppressed, an 'empty' remote lets the stale local copy win wholesale",
    rawLocal.action === "migrate-local" && rawLocal.state.nextActions.some((a) => a.id === "a2"),
    rawLocal.action);
  const tombMigrate = [makeTombstone("nextActions", "a2", iso(T, 12))];
  const suppressedLocal = reconcileAdoption({
    remote: empty(), local: suppressDeleted(deviceA(), tombMigrate), remoteHasData: false, localHasData: true,
    migratedFor: "u1", userId: "u1", empty: empty(),
  });
  ok("T20b …and with the marker the migrate-local branch drops it too",
    !suppressedLocal.state.nextActions.some((a) => a.id === "a2"),
    JSON.stringify(suppressedLocal.state.nextActions.map((a) => a.id)));

  // (The delete-side device is covered by G-G above, against the repaired path.)

  const pass = results.filter((r) => r.p).length;
  console.log(`\n=== ${pass}/${results.length} tombstone-gate assertions ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
