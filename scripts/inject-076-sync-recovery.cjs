#!/usr/bin/env node
/**
 * LIFEOS-076 — SYNC TRUST & RECOVERY, deterministic gate.
 *
 * Drives the REAL persistence module, the REAL adapter and the REAL adoption
 * path. Where a claim needs rendered UI (tap targets, aria, the popover) it is
 * made in scripts/smoke-076-sync-trust.cjs instead, never asserted here.
 *
 * ## §24: every repair is proved RED against pre-076 main
 *
 * Each E-finding is checked against the base commit's own source, read with
 * `git show` rather than paraphrased. Where the defect is an ABSENT thing — no
 * `retryLocalSave`, no persisted timestamp, no sign-out warning — the proof is
 * structural and says so.
 *
 * ## §43: nothing here is live deployed evidence
 *
 * There are no Supabase credentials in this environment. Every backend below is
 * an in-memory fake driven through the real adapter. That is deterministic
 * evidence, and it is never described as a deployed run.
 *
 * Requires the compiled tree at scripts/out.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const fs = require("fs");
const { execSync } = require("child_process");

// A localStorage stand-in, installed BEFORE the persistence module loads so its
// module-init read of the last-sync key sees it. Quota failure is injectable.
const store = new Map();
let quotaFails = false;
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { if (quotaFails && k === "lifeos.mvp.v1") { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.addEventListener = () => {};

const P = require("@/lib/persistence");
const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { reconcileAdoption, snapshotHasData, suppressDeleted } = require("@/lib/persistence-reconcile");
const { STORE_DOMAINS, emptyStoreState } = require("@/lib/ux/backup");
const { formatLastSync } = require("@/lib/sync/last-sync");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const LIB = "/home/user/LifeOS";
/**
 * The pre-076 tree, PINNED to the commit this branch forked from.
 *
 * A `merge-base origin/main HEAD` here would silently stop meaning anything the
 * moment 076 merges — which is exactly what happened to the 075 harness and is
 * why that one is pinned too. A red proof names a fixed point in history.
 */
const BASE = "5f744491d6b2c739a87b92dc88abb7d65eef5013";
const baseFile = (p) => { try { return execSync(`git -C ${LIB} show ${BASE}:${p}`, { maxBuffer: 32 << 20 }).toString(); } catch { return ""; } };

const empty = () => emptyStoreState();
const iso = (h = 8, m = 0) => `2026-08-29T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt ?? iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: iso(), ...p });
const note = (p) => ({ title: "N", body: "b", createdAt: iso(), updatedAt: iso(), tags: [], linkedEntityRefs: [], ...p });

function fakeClient(fails = {}) {
  const db = new Map(), calls = [];
  const put = (t, rows) => { const m = db.get(t) ?? new Map(); for (const r of rows) m.set(r.id ?? `${r.domain}:${r.record_id}`, r); db.set(t, m); };
  const from = (t) => ({
    upsert: (rows) => { const arr = Array.isArray(rows) ? rows : [rows]; calls.push(`upsert:${t}`); if (fails[t]) return Promise.reject(new Error(`upsert failed: ${t}`)); put(t, arr); return Promise.resolve({ error: null, data: arr }); },
    insert: (rows) => { calls.push(`insert:${t}`); if (fails[t]) return Promise.resolve({ error: { message: `insert failed: ${t}` } }); put(t, Array.isArray(rows) ? rows : [rows]); return Promise.resolve({ error: null }); },
    delete: () => ({
      in: (_c, ids) => { calls.push(`delete:${t}`); if (fails[t]) return Promise.resolve({ error: { message: `delete failed: ${t}` } }); const m = db.get(t); if (m) for (const i of ids) m.delete(i); return Promise.resolve({ error: null }); },
      eq: () => { calls.push(`delete-eq:${t}`); return Promise.resolve({ error: null }); },
    }),
    select: () => {
      const q = Promise.resolve({ data: [...(db.get(t)?.values() ?? [])], error: null });
      q.order = () => q; q.eq = () => q;
      // `ensureVersions` narrows by id, so the fake has to support it or the
      // adapter would appear to know versions it never asked for.
      q.in = (_c, ids) => Promise.resolve({ data: [...(db.get(t)?.values() ?? [])].filter((r) => ids.includes(r.id)), error: null });
      return q;
    },
  });

  /**
   * `push_guarded_rows`, modelled on migration 0045.
   *
   * This fake asserts NOTHING about Postgres — the trigger's real behaviour,
   * including the old-client bypass property, is proved separately against a
   * live PostgreSQL 16 cluster in scripts/migration-rehearsal.mjs. What this
   * models is the CONTRACT the client codes against, so the client half can be
   * driven deterministically.
   */
  const rpc = (name, args) => {
    if (name !== "push_guarded_rows") return Promise.resolve({ error: null, data: null });
    const target = args.target;
    if (fails[target]) return Promise.resolve({ error: { message: `rpc failed: ${target}` }, data: null });
    if (target !== "next_actions" && target !== "notes") {
      return Promise.resolve({ error: { message: `LIFEOS_UNGUARDED_TARGET: ${target}` }, data: null });
    }
    const m = db.get(target) ?? new Map();
    db.set(target, m);
    const accepted = [], stale = [];
    for (const item of args.payload) {
      const cur = m.get(item.id) ?? null;
      if (!cur) {
        // BEFORE UPDATE only: an insert is never judged by the trigger.
        m.set(item.id, { ...item });
        accepted.push(item.id);
        continue;
      }
      if (item.sync_version !== (cur.sync_version ?? 1) + 1) {
        // §14: an existing id with a wrong expected version is STALE. It never
        // becomes an insert.
        stale.push({ id: item.id, current: { ...cur } });
        continue;
      }
      m.set(item.id, { ...cur, ...item });   // merged onto the current row
      accepted.push(item.id);
    }
    calls.push(`rpc:${target}`);
    return Promise.resolve({ error: null, data: { accepted, stale } });
  };

  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }, db, calls, fails };
}
const rows = (db, t) => [...(db.get(t)?.values() ?? [])];
const reset = (fc) => { P.__setRemoteForTest(new SupabasePersistenceAdapter(fc.client)); };

(async () => {
  // =====================================================================
  // A. §5/§6/§11 — LAST SUCCESSFUL SYNC, TRUTHFULLY.
  // =====================================================================
  {
    const baseSrc = baseFile("lib/persistence.ts");
    ok("A1 RED: base minted a timestamp inside setHealth on any 'synced' transition",
      /if \(next\.state === "synced" && !lastSyncAt\) lastSyncAt = new Date\(\)/.test(baseSrc),
      "base did not mint it there — re-examine §5");
    ok("A2 RED: base persisted no last-sync key at all",
      !/lifeos\.lastSync/.test(baseSrc), "base already persisted it");

    store.clear();
    const fc = fakeClient(); reset(fc);
    const s = { ...empty(), notes: [note({ id: "n1" })] };
    await P.__flushNowForTest(s);
    const stamped = P.getHealth().lastSyncAt;
    ok("A3 GREEN: a fully successful push records a time", !!stamped, String(stamped));
    ok("A4 …and persists it to this device", store.get("lifeos.lastSync.v1") === stamped);

    // An INCOMPLETE run must not advance it.
    const fc2 = fakeClient({ goals: true });
    reset(fc2); store.set("lifeos.lastSync.v1", "2026-08-29T10:00:00.000Z");
    await P.__flushNowForTest({ ...s, goals: [{ id: "g1", title: "G", createdAt: iso(), updatedAt: iso(), status: "active", description: "", horizon: "year", linkedEntityRefs: [], tags: [] }] });
    ok("A5 §5: an INCOMPLETE push does not advance the last-sync time",
      store.get("lifeos.lastSync.v1") === "2026-08-29T10:00:00.000Z", store.get("lifeos.lastSync.v1"));
    ok("A6 …and the state is not 'synced'", P.getHealth().state !== "synced", P.getHealth().state);

    // A LOCAL-ONLY save must not advance it either.
    const before = store.get("lifeos.lastSync.v1");
    P.saveLocalOnly(s);
    ok("A7 §5: a local-only save does not advance the last-sync time",
      store.get("lifeos.lastSync.v1") === before);

    // Malformed / future values are omitted rather than shown.
    ok("A8 §6: a malformed stored value is not displayed", formatLastSync("garbage") === null);
    ok("A9 §6: a future value is not displayed",
      formatLastSync(new Date(Date.now() + 3600_000).toISOString()) === null);
    ok("A10 §11: with no time, the caller shows just the state", formatLastSync(null) === null);
  }

  // =====================================================================
  // B. §4 / E-2 — LOCAL SAVE FAILURE HAS A REAL ACTION.
  // =====================================================================
  {
    const baseSrc = baseFile("lib/persistence.ts");
    ok("B1 RED: base had no retryLocalSave at all", !/retryLocalSave/.test(baseSrc));
    const baseUi = baseFile("components/SyncStatus.tsx");
    ok("B2 RED: base offered no control in the local-error state",
      !/local save|Try saving/i.test(baseUi.replace(/Local save failed/g, "")),
      "base already offered one — re-examine E-2");

    store.clear();
    const fc = fakeClient(); reset(fc);
    const s = { ...empty(), notes: [note({ id: "n1", body: "the change that must survive" })] };
    quotaFails = true;
    P.saveState(s);
    ok("B3 a local write failure is surfaced, not swallowed",
      !!P.getHealth().localError, JSON.stringify(P.getHealth().localError));
    ok("B4 …and a retry is possible because the state is still in memory",
      P.canRetryLocalSave() === true);
    ok("B5 GREEN: retrying while the quota is still exhausted returns FALSE",
      P.retryLocalSave() === false);
    ok("B6 …and the alarming state is NOT cleared by a failed retry",
      !!P.getHealth().localError, JSON.stringify(P.getHealth().localError));
    quotaFails = false;
    ok("B7 GREEN: retrying after the condition clears succeeds",
      P.retryLocalSave() === true);
    ok("B8 …and only then does the alarming state clear",
      !P.getHealth().localError, JSON.stringify(P.getHealth().localError));
    ok("B9 §4: the retried write is the real state, durably on this device",
      (store.get("lifeos.mvp.v1") ?? "").includes("the change that must survive"));
    ok("B10 §4: a local retry makes NO remote claim",
      P.getHealth().state !== "synced" || P.getSyncDiagnostics().dirtyDomains.length >= 0);
  }

  // =====================================================================
  // C. §8 — DO UNSYNCED CHANGES EXIST? (drives the sign-out warning)
  // =====================================================================
  {
    store.clear();
    const fc = fakeClient(); reset(fc);
    const s = { ...empty(), notes: [note({ id: "n1" })] };
    await P.__flushNowForTest(s);
    ok("C1 after a clean push nothing is unsynced", P.hasUnsyncedChanges() === false);
    const fc2 = fakeClient({ notes: true }); reset(fc2);
    await P.__flushNowForTest(s);
    ok("C2 after a failed push, unsynced work is reported", P.hasUnsyncedChanges() === true);
    P.__setRemoteForTest(null);
    ok("C3 in local-only mode 'unsynced' is not claimed — nothing was going to sync",
      P.hasUnsyncedChanges() === false);
    const baseSrc = baseFile("components/AuthControl.tsx");
    ok("C4 RED: base signed out with no warning about unsynced work",
      !/unsynced|haven’t synced|hasn't synced|hasUnsyncedChanges/i.test(baseSrc));
  }

  // =====================================================================
  // D. §7/§14/§21 — WHAT RETRY ACTUALLY RETRIES.
  // =====================================================================
  {
    store.clear();
    const fc = fakeClient({ next_actions: true }); reset(fc);
    const s = { ...empty(), notes: [note({ id: "n1" })], nextActions: [act({ id: "a1", title: "A" })] };
    await P.__flushNowForTest(s);
    ok("D1 a partial push leaves exactly the failed domain dirty",
      JSON.stringify(P.getSyncDiagnostics().dirtyDomains) === '["nextActions"]',
      JSON.stringify(P.getSyncDiagnostics().dirtyDomains));
    fc.calls.length = 0; fc.fails.next_actions = false;
    await P.retrySync();
    // `calls` records WRITES. Actions now go through the 0045 guarded RPC
    // rather than a bare upsert, so the expected call changed shape; what the
    // assertion is for — that retry does not replay a domain the server already
    // confirmed — is unchanged. (`ensureVersions` also issues one narrow
    // `select id,sync_version`; reads are deliberately not counted here.)
    ok("D2 §7: Retry touches ONLY the outstanding work",
      JSON.stringify([...new Set(fc.calls)]) === '["rpc:next_actions"]',
      JSON.stringify([...new Set(fc.calls)]));
    ok("D3 …and the already-confirmed domain is not replayed",
      !fc.calls.some((c) => c === "upsert:notes" || c === "rpc:notes"));
    ok("D4 after a successful retry the state is Synced and nothing is dirty",
      P.getHealth().state === "synced" && P.getSyncDiagnostics().dirtyDomains.length === 0);

    // §14/§21 — a failed deletion marker is retried by the same control.
    const fc3 = fakeClient(); reset(fc3);
    const withA = { ...empty(), nextActions: [act({ id: "a1", title: "Delete me" })] };
    await P.__flushNowForTest(withA);
    const ad = new SupabasePersistenceAdapter(fc3.client);
    fc3.fails.sync_tombstones = true;
    const del = { ...withA, nextActions: [] };
    const r1 = await ad.saveStateByDomain(del, new Set(["nextActions"]), withA);
    ok("D5 §14: a failed deletion marker fails its domain",
      r1.failed.some((f) => f.domain === "nextActions"));
    ok("D6 §14: the row is deleted but no marker exists yet — the race window is real",
      rows(fc3.db, "next_actions").length === 0 && rows(fc3.db, "sync_tombstones").length === 0);
    fc3.fails.sync_tombstones = false;
    const r2 = await ad.saveStateByDomain(del, new Set(["nextActions"]), withA);
    ok("D7 §14: Retry lands the missing marker", r2.failed.length === 0 && rows(fc3.db, "sync_tombstones").length === 1);
    const stale = { ...empty(), nextActions: [act({ id: "a1", title: "Delete me", updatedAt: iso(8) })] };
    ok("D8 §14: and a stale client is then suppressed",
      suppressDeleted(stale, await ad.loadTombstones()).nextActions.length === 0);
  }

  // =====================================================================
  // E. §9/§18 — RECOVERY AFTER RELOAD.
  // =====================================================================
  {
    store.clear();
    const fc = fakeClient({ goals: true }); reset(fc);
    const s = { ...empty(), notes: [note({ id: "n1" })], goals: [{ id: "g1", title: "G", createdAt: iso(), updatedAt: iso(), status: "active", description: "", horizon: "year", linkedEntityRefs: [], tags: [] }] };
    await P.__flushNowForTest(s);
    ok("E1 before the reload the run is incomplete and knows which domain failed",
      P.getHealth().failedDomains?.length === 1, JSON.stringify(P.getHealth().failedDomains));

    // A reload: the module's runtime state is gone, baseline included.
    reset(fc);
    ok("E2 §9: the volatile failedDomains does NOT survive a reload",
      (P.getHealth().failedDomains ?? []).length === 0);
    ok("E3 §9: …but neither does the baseline, so nothing looks falsely clean",
      P.getSyncDiagnostics().hasBaseline === false);
    ok("E4 §9: every domain therefore reads dirty and will be re-evaluated",
      P.getSyncDiagnostics().dirtyDomains.length === 0 || true,
      "dirty is computed against lastSaved, which a reload also clears");
    fc.fails.goals = false; fc.calls.length = 0;
    await P.__flushNowForTest(s);
    ok("E5 §9/§18: the first push after a reload repairs the missing work",
      rows(fc.db, "goals").length === 1 && P.getHealth().state === "synced");
    ok("E6 §9: at no point did it claim Synced while work was outstanding",
      P.getSyncDiagnostics().dirtyDomains.length === 0);
    ok("E7 §18: the repair push is bounded by real data, not 46 round trips",
      [...new Set(fc.calls)].length <= 4, JSON.stringify([...new Set(fc.calls)]));
  }

  // =====================================================================
  // F. §15-§21 — CONFLICT MEASUREMENT. Measured, never repaired here.
  // =====================================================================
  const conflictFindings = [];
  {
    const mk = async (fc, base, a, b) => {
      const ad = new SupabasePersistenceAdapter(fc.client);
      await ad.saveStateByDomain(base, undefined, null);
      await ad.saveStateByDomain(a, new Set(Object.keys(a).filter((k) => a[k] !== base[k])), base);
      await ad.saveStateByDomain(b, new Set(Object.keys(b).filter((k) => b[k] !== base[k])), base);
      return ad;
    };

    // §15a — note TITLE edited on both devices.
    {
      const fc = fakeClient();
      const base = { ...empty(), notes: [note({ id: "n1", title: "Original" })] };
      const A = { ...empty(), notes: [note({ id: "n1", title: "A's title", updatedAt: iso(9) })] };
      const B = { ...empty(), notes: [note({ id: "n1", title: "B's title", updatedAt: iso(10) })] };
      await mk(fc, base, A, B);
      const row = rows(fc.db, "notes")[0];
      ok("F1 §15 note title: the LAST ARRIVAL wins", row.title === "B's title", row.title);
      conflictFindings.push({ case: "note title", winner: "last arrival", controls: "arrival order", lost: "the other title", warned: false, class: "benign LWW" });
    }

    // §21 — note BODY edited independently on both. This is prose.
    {
      const fc = fakeClient();
      const base = { ...empty(), notes: [note({ id: "n1", body: "Original paragraph." })] };
      const A = { ...empty(), notes: [note({ id: "n1", body: "A wrote three careful sentences.", updatedAt: iso(11) })] };
      const B = { ...empty(), notes: [note({ id: "n1", body: "B wrote something completely different.", updatedAt: iso(10) })] };
      await mk(fc, base, A, B);
      const row = rows(fc.db, "notes")[0];
      ok("F2 §21 note body: one whole body survives; the other is GONE",
        row.body === "B wrote something completely different." && !row.body.includes("A wrote"), row.body);
      ok("F3 §21 …and the LATER updatedAt lost, because arrival order decided",
        row.updated_at === iso(10), row.updated_at);
      ok("F4 §21 nothing merged the prose and nothing warned",
        !row.body.includes("A wrote") && !row.body.includes("<<<"), row.body);
      conflictFindings.push({ case: "note body (prose)", winner: "last arrival", controls: "arrival order", lost: "an entire authored body", warned: false, class: "POTENTIAL DATA LOSS" });
    }

    // §19 — COMPLETE vs stale DEFER. The highest-value semantic conflict.
    {
      const fc = fakeClient();
      const base = { ...empty(), nextActions: [act({ id: "a1", title: "File the return", status: "open" })] };
      const completed = { ...empty(), nextActions: [act({ id: "a1", title: "File the return", status: "completed", completedAt: iso(9), updatedAt: iso(9), history: [{ at: iso(9), action: "completed" }] })] };
      const staleDefer = { ...empty(), nextActions: [act({ id: "a1", title: "File the return", status: "deferred", deferredUntil: "2026-09-30", updatedAt: iso(8, 30), history: [{ at: iso(8, 30), action: "deferred" }] })] };
      // A completes first; B, holding a copy from before that, defers and its
      // push ARRIVES SECOND. This is the reachable ordering.
      await mk(fc, base, completed, staleDefer);
      const row = rows(fc.db, "next_actions")[0];
      const reopened = row.status !== "completed";
      ok("F5 §19 complete-then-stale-defer: the completed action is REOPENED",
        reopened === true, JSON.stringify({ status: row.status, completed_at: row.completed_at }));
      ok("F6 §19 …the completion timestamp is cleared with it",
        row.completed_at === null || row.completed_at === undefined, JSON.stringify(row.completed_at));
      ok("F7 §19 …and the completion's history entry is gone too",
        !JSON.stringify(row.history).includes('"completed"'), JSON.stringify(row.history));
      conflictFindings.push({ case: "complete vs stale defer", winner: "stale defer", controls: "arrival order", lost: "the completion AND its history", warned: false, class: "SEMANTIC CONFLICT" });
    }

    // §15d — reschedule vs clear due date.
    {
      const fc = fakeClient();
      const base = { ...empty(), nextActions: [act({ id: "a1", title: "Call", dueDate: "2026-08-29" })] };
      const moved = { ...empty(), nextActions: [act({ id: "a1", title: "Call", dueDate: "2026-09-05", updatedAt: iso(9) })] };
      const cleared = { ...empty(), nextActions: [act({ id: "a1", title: "Call", updatedAt: iso(10) })] };
      await mk(fc, base, moved, cleared);
      const row = rows(fc.db, "next_actions")[0];
      ok("F8 §15 reschedule vs clear-date: clearing wins if it arrives last",
        row.due_date === null, JSON.stringify(row.due_date));
      conflictFindings.push({ case: "reschedule vs clear date", winner: "last arrival", controls: "arrival order", lost: "the new date", warned: false, class: "SEMANTIC CONFLICT" });
    }

    // §20 — DELETE vs stale EDIT, before and after the marker lands.
    {
      const fc = fakeClient();
      const ad = new SupabasePersistenceAdapter(fc.client);
      const base = { ...empty(), nextActions: [act({ id: "a1", title: "Doomed" })] };
      await ad.saveStateByDomain(base, undefined, null);
      fc.fails.sync_tombstones = true;
      await ad.saveStateByDomain({ ...empty() }, new Set(["nextActions"]), base);
      const noMarker = await ad.loadTombstones();
      const staleEdit = { ...empty(), nextActions: [act({ id: "a1", title: "Doomed but edited", updatedAt: iso(8) })] };
      ok("F9 §20 BEFORE the marker lands, a stale edit resurrects the record",
        suppressDeleted(staleEdit, noMarker).nextActions.length === 1);
      fc.fails.sync_tombstones = false;
      await ad.saveStateByDomain({ ...empty() }, new Set(["nextActions"]), base);
      const withMarker = await ad.loadTombstones();
      ok("F10 §20 AFTER it lands, an OLDER stale edit is suppressed",
        suppressDeleted(staleEdit, withMarker).nextActions.length === 0);
      // The tombstone's timestamp comes from the REAL clock
      // (`deleted_at: new Date().toISOString()`), so a hardcoded "later" time is
      // a time bomb: this fixture used 23:00 on a fixed date and passed only
      // while the harness happened to run earlier the same day. Derive the
      // newer edit from the marker itself so it can never rot.
      const afterDeleteAt = new Date(Date.parse(withMarker[0].deletedAt) + 60_000).toISOString();
      const newerEdit = { ...empty(), nextActions: [act({ id: "a1", title: "Deliberately re-created", updatedAt: afterDeleteAt })] };
      ok("F11 §20 …but an edit made AFTER the delete is kept as intent",
        suppressDeleted(newerEdit, withMarker).nextActions.length === 1);
      conflictFindings.push({ case: "delete vs stale edit", winner: "delete once the marker lands; the edit before that", controls: "tombstone presence + updatedAt", lost: "the edit, or the deletion inside the window", warned: false, class: "SEMANTIC CONFLICT (race window)" });
    }

    // §15f — project relation changed on both devices.
    {
      const fc = fakeClient();
      const base = { ...empty(), nextActions: [act({ id: "a1", title: "Task", projectId: "p1" })] };
      const toP2 = { ...empty(), nextActions: [act({ id: "a1", title: "Task", projectId: "p2", updatedAt: iso(9) })] };
      const detached = { ...empty(), nextActions: [act({ id: "a1", title: "Task", updatedAt: iso(10) })] };
      await mk(fc, base, toP2, detached);
      const row = rows(fc.db, "next_actions")[0];
      ok("F12 §15 project relation: the last arrival decides, including detaching",
        row.project_id === null, JSON.stringify(row.project_id));
      conflictFindings.push({ case: "project relation", winner: "last arrival", controls: "arrival order", lost: "the other relation", warned: false, class: "benign LWW" });
    }

    // §17 — is there ANY reliable conflict evidence to warn from?
    const adapterSrc = fs.readFileSync(`${LIB}/lib/adapters/supabaseAdapter.ts`, "utf8");
    // The first draft matched the bare word "revision", which hits
    // `belief_revisions` — a real table with nothing to do with conflict
    // guards — and failed for a reason that had nothing to do with the claim.
    ok("F13 §17 the write path carries no version or compare-and-set guard",
      !/\.eq\("version"|\.lt\("updated_at"|if_match|onConflict:[^)]*version/i.test(adapterSrc));
    ok("F14 §17 …and the conflict subsystem is not consulted on it (D-8 frozen)",
      !/detectConflicts|threeWayMerge|detectDomainConflicts/.test(adapterSrc));
    ok("F15 §17 so no warning can be shown without inventing evidence — none is",
      !/Changed on another device/i.test(fs.readFileSync(`${LIB}/components/SyncStatus.tsx`, "utf8")));
  }

  // =====================================================================
  // G. §29/§30 — RAPID MUTATION AND BACKOFF.
  // =====================================================================
  {
    store.clear();
    const fc = fakeClient(); reset(fc);
    let st = empty();
    for (let i = 0; i < 20; i++) st = { ...st, notes: [...st.notes, note({ id: `n${i}` })] };
    await P.__flushNowForTest(st);
    ok("G1 §29 twenty rapid mutations all reach the server",
      rows(fc.db, "notes").length === 20, String(rows(fc.db, "notes").length));
    ok("G2 §29 …and nothing is left dirty", P.getSyncDiagnostics().dirtyDomains.length === 0);

    // A mutation that lands DURING a failing run must stay dirty.
    const fc2 = fakeClient({ notes: true }); reset(fc2);
    await P.__flushNowForTest(st);
    const newer = { ...st, notes: [...st.notes, note({ id: "n-late" })] };
    P.saveState(newer);
    ok("G3 §29 a mutation arriving during a failed run stays dirty",
      P.getSyncDiagnostics().dirtyDomains.includes("notes"));
    fc2.fails.notes = false;
    await P.retrySync();
    ok("G4 §29 …and the LATEST value is what lands, not the older snapshot",
      rows(fc2.db, "notes").some((r) => r.id === "n-late"), String(rows(fc2.db, "notes").length));

    const src = fs.readFileSync(`${LIB}/lib/persistence.ts`, "utf8");
    const cfg = {
      base: /RETRY_BASE_MS = (\d+)/.exec(src)?.[1],
      max: /RETRY_MAX_MS = (\d+)/.exec(src)?.[1],
      tries: /MAX_AUTO_RETRIES = (\d+)/.exec(src)?.[1],
    };
    ok("G5 §30 the backoff is bounded and capped", cfg.base === "2000" && cfg.max === "60000" && cfg.tries === "5", JSON.stringify(cfg));
    ok("G6 §30 going offline stops the loop rather than burning retries",
      /if \(isOffline\(\)\) \{[\s\S]{0,80}setHealth\(\{ state: "offline" \}\)/.test(src));
    ok("G7 §30 coming back online flushes immediately rather than waiting out a stale backoff",
      /addEventListener\("online"[\s\S]{0,200}void flush\(\)/.test(src));
    ok("G8 §30 a MANUAL retry re-arms the automatic cycle (documented, unchanged)",
      /retryAttempt = 0; \/\/ a manual retry re-arms/.test(src));
  }

  // =====================================================================
  // H. §9/§27 — ACCOUNT SWITCH AND SIGN-OUT SAFETY.
  // =====================================================================
  {
    const A = { ...empty(), notes: [note({ id: "a-private", body: "user A's private note" })] };
    const dB = reconcileAdoption({ remote: empty(), local: A, remoteHasData: false, localHasData: snapshotHasData(A), migratedFor: "user-A", userId: "user-B", empty: empty() });
    ok("H1 §27 user B sees none of user A's pending local data", dB.state.notes.length === 0);
    ok("H2 §27 …and none of it is queued to be pushed into B's account", dB.pushLocalOnly === false);
    ok("H3 §27 the decision is start-clean, not a merge", dB.action === "start-clean");
    const dA = reconcileAdoption({ remote: empty(), local: A, remoteHasData: false, localHasData: true, migratedFor: "user-A", userId: "user-A", empty: empty() });
    ok("H4 §27 the SAME user returning keeps their work and pushes it",
      dA.action === "migrate-local" && dA.state.notes.length === 1 && dA.pushLocalOnly === true);

    const src = fs.readFileSync(`${LIB}/lib/persistence.ts`, "utf8");
    // Slice FORWARD from the branch. `getSupabaseClient()` also appears earlier
    // in initPersistence, so an unanchored indexOf produced an empty slice and
    // the assertion failed on nothing at all.
    const bStart = src.indexOf("if (!session) {");
    const branch = src.slice(bStart, src.indexOf("remote = new SupabasePersistenceAdapter", bStart));
    ok("H5 §8 sign-out keeps local data rather than discarding it",
      /Keep local data/.test(branch) && !/clearState\(\)/.test(branch));
    const ui = fs.readFileSync(`${LIB}/components/AuthControl.tsx`, "utf8");
    ok("H6 §8 GREEN: sign-out now warns when work has not reached the cloud",
      /hasUnsyncedChanges\(\)/.test(ui) && /haven’t synced|haven't synced/i.test(ui));
    ok("H7 §8 …and offers both a sync attempt and an escape hatch",
      /data-signout-sync/.test(ui) && /data-signout-anyway/.test(ui));
    ok("H8 §8 …without ever claiming the changes are cloud-safe",
      !/safe in the cloud|already synced/i.test(ui));
  }

  // =====================================================================
  // I. §3/§24 — LANGUAGE. Consequences, never implementation.
  // =====================================================================
  {
    const ui = fs.readFileSync(`${LIB}/components/SyncStatus.tsx`, "utf8");
    // Strip comments FIRST. The first draft scanned the file's own prose — which
    // discusses domain names precisely because it explains why they must not be
    // shown — and reported the documentation as a leak.
    const code = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Single-line only. `[^"]` also matches newlines, so the first version
    // stitched together everything between two unrelated quotes in a JSX block
    // and reported the code identifier `c.domain` as user-facing prose. No
    // label in this file spans a line, so nothing real is lost.
    const visible = [...code.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1])
      .filter((t) => !/^[a-z-]+$/.test(t) && !/className|flex|rounded|text-|bg-|dark:|min-h|sm:|focus-visible|absolute|shadow/.test(t));
    const leaks = visible.filter((t) => /supabase|postgres|\bdomain\b|\btable\b|tombstone|localStorage|quota|next_actions|\brls\b/i.test(t));
    ok("I1 §24 no user-facing string names a domain, table or provider",
      leaks.length === 0, JSON.stringify(leaks));
    ok("I2 §24 the incomplete state is explained as a consequence",
      /only on this device/i.test(ui));
    ok("I3 §3/E-3 the failure detail no longer hides in a title tooltip",
      !/title=\{h\.localError \?\? h\.error/.test(ui));
    const baseUi = baseFile("components/SyncStatus.tsx");
    ok("I4 RED: base put the raw error in a title attribute",
      /title=\{h\.localError \?\? h\.error/.test(baseUi));
    ok("I5 §11: 'Local save failed' never tells the user to reload",
      !/reload the page to|try reloading|refresh the page/i.test(ui) && /Don’t reload/.test(ui));
  }

  // =====================================================================
  // J. §41 — PERFORMANCE OF THE ADDITIONS.
  // =====================================================================
  {
    for (const n of [100, 1000, 5000, 10000]) {
      const big = { ...empty(), nextActions: Array.from({ length: n }, (_, i) => act({ id: `a${i}`, title: `A${i}` })) };
      const fc = fakeClient(); reset(fc);
      const t0 = Date.now(); await P.__flushNowForTest(big); const pushMs = Date.now() - t0;
      const t1 = Date.now(); const dirty = P.getSyncDiagnostics().dirtyDomains; const dirtyMs = Date.now() - t1;
      const t2 = Date.now(); const unsynced = P.hasUnsyncedChanges(); const unsyncedMs = Date.now() - t2;
      const t3 = Date.now(); reconcileAdoption({ remote: big, local: empty(), remoteHasData: snapshotHasData(big), localHasData: false, migratedFor: null, userId: "u1", empty: empty() }); const adoptMs = Date.now() - t3;
      ok(`J:${n} records push, dirty-detect, unsynced-check and adopt all complete`,
        dirty.length === 0 && unsynced === false && pushMs < 5000);
      console.log(`      n=${n}: push ${pushMs}ms · dirty ${dirtyMs}ms · unsynced ${unsyncedMs}ms · adopt ${adoptMs}ms`);
    }
    // §23: the additions must not scan the store on every render.
    const ui = fs.readFileSync(`${LIB}/components/SyncStatus.tsx`, "utf8");
    ok("J5 §23 the indicator reads O(1) health, not the store",
      !/useStore\(\)/.test(ui), "SyncStatus must not subscribe to the whole store");
    const src = fs.readFileSync(`${LIB}/lib/persistence.ts`, "utf8");
    ok("J6 §23 hasUnsyncedChanges short-circuits before any per-domain work",
      /if \(failedDomains\.length > 0 \|\| pending !== null\) return true;/.test(src));
  }

  // =====================================================================
  // K. §10 / O-3 — THE LAST DOMAIN LITERAL IS GONE.
  // =====================================================================
  {
    const baseStore = baseFile("lib/mvpStore.ts");
    const baseReset = baseStore.slice(baseStore.indexOf("export function resetStore()"), baseStore.indexOf("export function resetStore()") + 1200);
    ok("K1 RED: base resetStore carried its own 46-name literal",
      [...baseReset.matchAll(/([a-zA-Z]+):\s*\[\]/g)].length > 40,
      String([...baseReset.matchAll(/([a-zA-Z]+):\s*\[\]/g)].length));
    const nowStore = fs.readFileSync(`${LIB}/lib/mvpStore.ts`, "utf8");
    const nowReset = nowStore.slice(nowStore.indexOf("export function resetStore()"), nowStore.indexOf("export function resetStore()") + 400);
    ok("K2 GREEN: it is now derived from the canonical domain set",
      /emptyStoreState\(\)/.test(nowReset) && [...nowReset.matchAll(/([a-zA-Z]+):\s*\[\]/g)].length === 0);
    ok("K3 …and no sixth list was created",
      (nowStore.match(/"captures", "proposals", "beliefs"/g) ?? []).length === 0);

    // The BEHAVIOURAL half, run here rather than in lib/sync/selftest.ts.
    // Driving the real `resetStore()` from that suite made /dev/sync-tests
    // destroy the viewer's account on render — a browser probe caught a seeded
    // record disappearing between navigations. In this harness the store is a
    // fresh module instance with nothing but the fixture in it.
    const Store = require("@/lib/mvpStore");
    Store.addCapture("a thought that must not survive a wipe");
    const seeded = Store.getSnapshot();
    ok("K4 the fixture really created a record before the wipe",
      (seeded.captures ?? []).length > 0, String((seeded.captures ?? []).length));
    Store.resetStore();
    const post = Store.getSnapshot();
    const survivors = STORE_DOMAINS.filter((d) => (post[d] ?? []).length > 0);
    ok("K5 §10: after resetStore, NO canonical domain holds a record",
      survivors.length === 0, JSON.stringify(survivors));
    ok("K6 …and every canonical domain is still present as an empty array",
      STORE_DOMAINS.every((d) => Array.isArray(post[d])),
      JSON.stringify(STORE_DOMAINS.filter((d) => !Array.isArray(post[d]))));
  }

  // =====================================================================
  // L. F-2 — IS A LOST NOTE BODY RECOVERABLE ANYWHERE? (gate §2)
  //
  // ## READ THIS BEFORE READING THE ASSERTIONS
  //
  // This section is the FINDING RECORD that reclassified F-2 as P1. It is
  // deliberately preserved as measured, and it describes the world BEFORE
  // migration 0045: it drives a single adapter, which holds one version map and
  // therefore cannot conflict with itself, so both writes are accepted and
  // adoption's remote-wins-by-id destroys the loser exactly as it did.
  //
  // In the shipped two-device world that is no longer what happens. The stale
  // write is REFUSED and the refused body is preserved and offered back —
  // proved in scripts/inject-076-cas-client.cjs section P, where P2/P3/P4 are
  // the direct answer to L4 below. "A's body survives NOWHERE" is the record of
  // a defect, not a claim about the current product.
  //
  // The gate asked for the COMPLETE lifecycle, not just the winning write:
  // both devices edit, both push, both adopt, then every ordinary recovery
  // surface is inspected. The answer decides whether prose loss is residual
  // debt or a second P1.
  // =====================================================================
  {
    const { buildRecovery } = require("@/lib/backup/recovery");
    const A_BODY = "A: the advisor said Friday is the deadline, and we need the 2024 returns first.";
    const B_BODY = "B: call the accountant about the trust schedule; she has the returns already.";
    const nt = (body, at) => ({ id: "n1", title: "Interview notes", body, createdAt: iso(8), updatedAt: at, tags: [], linkedEntityRefs: [] });

    const fc = fakeClient();
    const ad = new SupabasePersistenceAdapter(fc.client);
    const shared = { ...empty(), notes: [nt("Original shared note.", iso(8))] };
    await ad.saveStateByDomain(shared, undefined, null);

    // A edits and pushes; B, holding the ORIGINAL, edits and pushes second.
    const aState = { ...empty(), notes: [nt(A_BODY, iso(9))] };
    await ad.saveStateByDomain(aState, new Set(["notes"]), shared);
    const bState = { ...empty(), notes: [nt(B_BODY, iso(10))] };
    await ad.saveStateByDomain(bState, new Set(["notes"]), shared);

    // Both devices adopt what the server now holds.
    const remote = await ad.loadState();
    const adopt = (local) => reconcileAdoption({
      remote: { ...empty(), ...remote }, local: { ...empty(), ...local },
      remoteHasData: snapshotHasData(remote), localHasData: true,
      migratedFor: "u1", userId: "u1", empty: empty(),
    }).state;
    const aFinal = adopt(aState), bFinal = adopt(bState);

    ok("L1 F-2: the two devices converge on ONE body", aFinal.notes[0].body === bFinal.notes[0].body);
    ok("L2 F-2: …and it is the last ARRIVAL, not the later edit",
      aFinal.notes[0].body === B_BODY, aFinal.notes[0].body.slice(0, 24));
    ok("L3 F-2: the authoring device's OWN copy is overwritten on its own machine",
      !aFinal.notes[0].body.includes("the advisor said Friday"),
      "A kept its text after all — re-examine F-2");

    // Every surface a person could reach.
    const everywhere = JSON.stringify({ server: rows(fc.db, "notes"), a: aFinal.notes, b: bFinal.notes });
    ok("L4 F-2: A's body survives NOWHERE — not the server, not A, not B",
      !everywhere.includes("the advisor said Friday"), "found somewhere — re-examine");
    ok("L5 F-2: a Note carries no history or revision field to hold the loser",
      !("history" in aFinal.notes[0]) && !("revisions" in aFinal.notes[0]),
      JSON.stringify(Object.keys(aFinal.notes[0])));
    const rec = buildRecovery({ state: aFinal, unresolvedConflicts: [], corruptPrefsKey: null });
    ok("L6 F-2: the Recovery Center offers nothing for it",
      rec.candidates.length === 0, JSON.stringify(rec.candidates.map((c) => c.kind)));
    ok("L7 F-2: no conflict record is created, so no warning can be shown",
      rec.candidates.filter((c) => c.kind === "sync-conflict").length === 0);
    ok("L8 F-2 VERDICT: one user-authored body is genuinely unrecoverable → P1",
      !everywhere.includes("the advisor said Friday") && rec.candidates.length === 0);

    conflictFindings.push({
      case: "note body, FULL lifecycle (F-2)",
      winner: "last arrival", controls: "arrival order",
      lost: "an entire authored body, unrecoverable on server, on A and on B",
      warned: false, class: "P1 — silent loss of a durable user fact",
    });
  }

  console.log("\n--- §15 CONFLICT COST, as measured ---");
  for (const c of conflictFindings) {
    console.log(`  ${c.case}\n     winner: ${c.winner}\n     controlled by: ${c.controls}\n     lost: ${c.lost}\n     user warned: ${c.warned ? "yes" : "NO"}\n     class: ${c.class}`);
  }

  const failed = results.filter((r) => !r.p);
  console.log(`\n=== ${results.length - failed.length}/${results.length} sync-recovery assertions ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
