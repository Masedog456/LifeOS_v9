#!/usr/bin/env node
/**
 * LIFEOS-076 — DATABASE-ENFORCED CAS, CLIENT HALF.
 *
 * Migration 0045 puts the concurrency invariant in Postgres. Its real behaviour
 * — the trigger, the check constraints, the RPC, SECURITY INVOKER, the grants,
 * and the §3 property that an OLD client doing a plain upsert is REFUSED rather
 * than allowed to overwrite newer state — is proved against a live PostgreSQL 16
 * cluster in scripts/migration-rehearsal.mjs. None of that is re-asserted here.
 *
 * What this file proves is the other half, and it is the half LIFEOS-074 D-24
 * says is usually missing: that the CLIENT actually consults the mechanism.
 * §29 is explicit — "a version column sitting unused is an automatic failure" —
 * so the wiring, the version lifecycle, the rejection handling, the recovery of
 * refused intent, and the F-1/F-2 replays are all driven through the real
 * adapter here.
 *
 * ## What the backend below is, exactly
 *
 * An in-memory model of the 0045 contract: inserts pass untouched (the trigger
 * is BEFORE UPDATE), an existing id is accepted only at current + 1, and
 * anything else comes back STALE carrying the current row. It asserts nothing
 * about Postgres. It exists so the client can be driven deterministically, and
 * it is never described as a deployed run — there are no Supabase credentials
 * in this environment (§43).
 *
 * Requires the compiled tree at scripts/out.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const fs = require("fs");
const { execSync } = require("child_process");

// localStorage stand-in, installed before any module that reads it at import.
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.addEventListener = () => {};

const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { reconcileAdoption, snapshotHasData } = require("@/lib/persistence-reconcile");
const { emptyStoreState } = require("@/lib/ux/backup");
const C = require("@/lib/sync/conflicts-store");
const { describeConflict, conflictSummary, CONFLICT_ACTIONS } = require("@/lib/sync/conflict-view");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const LIB = "/home/user/LifeOS";
/** Pinned, for the same reason the other two harnesses are: a red proof has to
 *  name a fixed point in history, not one that moves when this branch merges. */
const BASE = "5f744491d6b2c739a87b92dc88abb7d65eef5013";
const baseFile = (p) => { try { return execSync(`git -C ${LIB} show ${BASE}:${p}`, { maxBuffer: 32 << 20 }).toString(); } catch { return ""; } };

const empty = () => emptyStoreState();
const iso = (h = 8, m = 0) => `2026-08-29T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt ?? iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], createdAt: iso(), ...p });
const nt = (p) => ({ title: "N", body: "b", createdAt: iso(), updatedAt: iso(), tags: [], linkedEntityRefs: [], ...p });

/* ------------------------------------------------------------------ backend */

/**
 * One shared server, many client connections — so each simulated device gets
 * its OWN adapter (and therefore its own version knowledge) over the same rows,
 * which is the situation 0045 exists for. A single adapter can never conflict
 * with itself and would prove nothing.
 */
function server() {
  const db = new Map();
  const table = (t) => { let m = db.get(t); if (!m) { m = new Map(); db.set(t, m); } return m; };
  const log = [];
  let rpcHook = null;   // lets a test make one call fail AFTER it commits

  const connection = (opts = {}) => {
    const from = (t) => ({
      upsert: (r) => { const a = Array.isArray(r) ? r : [r]; log.push(`upsert:${t}`); if (opts.fail?.[t]) return Promise.reject(new Error(`upsert failed: ${t}`)); for (const x of a) table(t).set(x.id, { ...table(t).get(x.id), ...x }); return Promise.resolve({ error: null, data: a }); },
      insert: (r) => { const a = Array.isArray(r) ? r : [r]; log.push(`insert:${t}`); for (const x of a) table(t).set(x.id ?? `${x.domain}:${x.record_id}`, x); return Promise.resolve({ error: null }); },
      delete: () => ({
        in: (_c, ids) => { log.push(`delete:${t}`); for (const i of ids) table(t).delete(i); return Promise.resolve({ error: null }); },
        eq: () => Promise.resolve({ error: null }),
      }),
      select: () => {
        const all = [...table(t).values()];
        const q = Promise.resolve({ data: all, error: null });
        q.order = () => q; q.eq = () => q;
        q.in = (_c, ids) => { log.push(`select-in:${t}`); return Promise.resolve({ data: all.filter((r) => ids.includes(r.id)), error: null }); };
        return q;
      },
    });

    const rpc = (name, args) => {
      if (name !== "push_guarded_rows") return Promise.resolve({ error: null, data: null });
      const { target, payload } = args;
      log.push(`rpc:${target}`);
      // "connection refused" — the request never reached the database, so no row
      // may change. Modelled BEFORE the loop; the `rpcHook` below is the other,
      // more dangerous case, where the rows commit and the answer is lost.
      if (opts.failRpc) return Promise.resolve({ error: { message: "connection refused" }, data: null });
      if (target !== "next_actions" && target !== "notes") {
        return Promise.resolve({ error: { message: `LIFEOS_UNGUARDED_TARGET: ${target}` }, data: null });
      }
      const m = table(target);
      const accepted = [], stale = [];
      for (const item of payload) {
        const cur = m.get(item.id) ?? null;
        if (!cur) { m.set(item.id, { ...item }); accepted.push(item.id); continue; }          // insert: trigger is BEFORE UPDATE
        if (item.sync_version !== (cur.sync_version ?? 1) + 1) {                              // §14: never an insert fallback
          stale.push({ id: item.id, current: { ...cur } }); continue;
        }
        m.set(item.id, { ...cur, ...item }); accepted.push(item.id);                          // merged onto the current row
      }
      // A 200 whose body cannot be read. Modelled AFTER the rows commit,
      // because that is the dangerous ordering (see R9).
      if (opts.blankBody) return Promise.resolve({ error: null, data: null });
      const out = { error: null, data: { accepted, stale } };
      // §20/§21: the hook runs AFTER the rows are committed, so it can model the
      // one case that matters — the write landed and the answer was lost.
      return rpcHook ? rpcHook(target, out) : Promise.resolve(out);
    };

    return { from, rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
  };

  return {
    db, log, connection,
    device: (opts) => new SupabasePersistenceAdapter(connection(opts)),
    rows: (t) => [...(db.get(t)?.values() ?? [])],
    setRpcHook: (f) => { rpcHook = f; },
  };
}

const adopt = (remote, local) => reconcileAdoption({
  remote: { ...empty(), ...remote }, local: { ...empty(), ...local },
  remoteHasData: snapshotHasData(remote), localHasData: true,
  migratedFor: "u1", userId: "u1", empty: empty(),
}).state;

(async () => {
  /* ==================================================================
   * M. §29 — IS THE MECHANISM ACTUALLY CONSULTED?
   *
   * 074 D-24 and 075 both ended at the same finding: a mechanism was built,
   * was correct, and nothing read it. §29 makes that an automatic failure, so
   * it is checked first and structurally, before any behaviour.
   * ================================================================== */
  {
    const src = fs.readFileSync(`${LIB}/lib/adapters/supabaseAdapter.ts`, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const mig = fs.readFileSync(`${LIB}/supabase/migrations/0045_sync_version_guard.sql`, "utf8");

    ok("M1 RED: the pre-076 adapter knew nothing about a version at all",
      !/sync_version/.test(baseFile("lib/adapters/supabaseAdapter.ts")),
      "base already referenced it — re-examine");

    ok("M2 §29 the client calls the function 0045 actually defines",
      /rpc\("push_guarded_rows"/.test(code) && /function public\.push_guarded_rows/.test(mig));

    // The whole point: neither guarded table may still have a bare upsert path.
    ok("M3 §29 next_actions is no longer written by an unguarded upsert",
      !/from\("next_actions"\)\s*\.upsert/.test(code),
      (code.match(/from\("next_actions"\)[^\n]*/g) || []).join(" | "));
    ok("M4 §29 notes is no longer written by an unguarded upsert",
      !/from\("notes"\)\s*\.upsert/.test(code),
      (code.match(/from\("notes"\)[^\n]*/g) || []).join(" | "));

    ok("M5 §29 the pushed payload carries a version, not just the row",
      /sync_version:\s*\(m\.get\(r\.id\)\s*\?\?\s*0\)\s*\+\s*1/.test(code));
    ok("M6 §29 both authoritative reads feed the version map",
      (code.match(/captureVersions\("next_actions"/g) || []).length >= 1 &&
      (code.match(/captureVersions\("notes"/g) || []).length >= 1);
    ok("M7 §29 a rejection is preserved rather than discarded",
      /recordConflicts\(/.test(code));
    ok("M8 §12 the guard is scoped to exactly the two proven classes",
      /"next_actions" \| "notes"/.test(src) && /GuardedDomain = "nextActions" \| "notes"/.test(fs.readFileSync(`${LIB}/lib/sync/conflicts-store.ts`, "utf8")));
  }

  /* ==================================================================
   * N. §5/§6 — THE VERSION LIFECYCLE.
   * ================================================================== */
  {
    C.purgeConflicts();
    const S = server();
    const A = S.device();

    // Cold: nothing exists yet. An insert must work and start at 1.
    const s0 = { ...empty(), nextActions: [act({ id: "a1", title: "Call the dentist" })] };
    await A.saveStateByDomain(s0, undefined, null);
    ok("N1 §5 a brand-new record inserts and starts at version 1",
      S.rows("next_actions")[0]?.sync_version === 1, JSON.stringify(S.rows("next_actions")[0]?.sync_version));

    // An ordinary edit on the same device advances by exactly one.
    const s1 = { ...empty(), nextActions: [act({ id: "a1", title: "Call the dentist on Friday", updatedAt: iso(9) })] };
    await A.saveStateByDomain(s1, new Set(["nextActions"]), s0);
    ok("N2 §5 an ordinary edit advances the version by exactly one",
      S.rows("next_actions")[0]?.sync_version === 2, String(S.rows("next_actions")[0]?.sync_version));
    ok("N3 §5 …and the edit itself landed", S.rows("next_actions")[0]?.title === "Call the dentist on Friday");
    ok("N4 no rejection was produced by a device writing to itself", C.getConflicts().length === 0);

    // §6: a device that reloaded offline holds durable edits and NO version
    // knowledge. It must read rather than guess.
    const B = S.device();
    S.log.length = 0;
    const s2 = { ...empty(), nextActions: [act({ id: "a1", title: "Call the dentist on Monday", updatedAt: iso(10) })] };
    await B.saveStateByDomain(s2, new Set(["nextActions"]), s1);
    ok("N5 §6 a device with no version knowledge READS it rather than guessing",
      S.log.includes("select-in:next_actions"), JSON.stringify(S.log));
    ok("N6 §6 …and its write is then accepted, at 3",
      S.rows("next_actions")[0]?.sync_version === 3 && S.rows("next_actions")[0]?.title.endsWith("Monday"),
      JSON.stringify(S.rows("next_actions")[0]));
    ok("N7 §6 a device that had to look the version up did not report a conflict",
      C.getConflicts().length === 0);

    // §5 adoption: a cold client loads, then pushes, and is accepted first time.
    const D = S.device();
    const remote = await D.loadState();
    const local = adopt(remote, empty());
    const edited = { ...local, nextActions: [{ ...local.nextActions[0], title: "Call the dentist on Tuesday", updatedAt: iso(11) }] };
    await D.saveStateByDomain(edited, new Set(["nextActions"]), local);
    ok("N8 §5 adoption teaches a cold device the version, so its FIRST push is accepted",
      S.rows("next_actions")[0]?.sync_version === 4 && C.getConflicts().length === 0,
      JSON.stringify({ v: S.rows("next_actions")[0]?.sync_version, c: C.getConflicts().length }));
  }

  /* ==================================================================
   * O. §16 — F-1 REPLAYED UNDER THE GUARD.
   *
   * The original: A completes an action; B, holding a copy from before that,
   * defers it, and B's push lands second. The completion, its timestamp and its
   * history entry were all erased. A finished life fact became unfinished.
   * ================================================================== */
  {
    C.purgeConflicts();
    const S = server();
    const A = S.device(), B = S.device();

    const shared = { ...empty(), nextActions: [act({ id: "a1", title: "File the tax return", status: "open" })] };
    await A.saveStateByDomain(shared, undefined, null);
    // B is warm too — it has seen the row at version 1, exactly like a real
    // second device that synced this morning and then went out of range.
    await B.loadState();

    const completed = act({
      id: "a1", title: "File the tax return", status: "completed",
      completedAt: iso(14), updatedAt: iso(14),
      history: [{ at: iso(14), action: "completed", detail: "posted it" }],
    });
    await A.saveStateByDomain({ ...empty(), nextActions: [completed] }, new Set(["nextActions"]), shared);

    const deferred = act({ id: "a1", title: "File the tax return", status: "deferred", deferredUntil: "2026-09-05", updatedAt: iso(15) });
    await B.saveStateByDomain({ ...empty(), nextActions: [deferred] }, new Set(["nextActions"]), shared);

    const srv = S.rows("next_actions")[0];
    ok("O1 §16 F-1: the LATER-ARRIVING stale write no longer wins",
      srv.status === "completed", `status is ${srv.status}`);
    ok("O2 §16 F-1: the completion timestamp survives", srv.completed_at === iso(14), String(srv.completed_at));
    ok("O3 §16 F-1: the history entry survives",
      JSON.stringify(srv.history ?? []).includes("posted it"), JSON.stringify(srv.history));

    const conflicts = C.getConflicts();
    ok("O4 §7 the refused write is NOT silently dropped", conflicts.length === 1, JSON.stringify(conflicts.length));
    ok("O5 §7 …and it is B's own intent that is preserved",
      conflicts[0]?.local?.status === "deferred" && conflicts[0]?.domain === "nextActions",
      JSON.stringify(conflicts[0]?.local?.status));
    ok("O6 §9 …alongside the version the server actually holds",
      conflicts[0]?.remote?.status === "completed", JSON.stringify(conflicts[0]?.remote?.status));
    ok("O7 the preserved remote is the DOMAIN shape, so no server-only column reaches the device",
      conflicts[0]?.remote && !("user_id" in conflicts[0].remote) && !("sync_version" in conflicts[0].remote),
      JSON.stringify(Object.keys(conflicts[0]?.remote ?? {})));

    const v = describeConflict(conflicts[0]);
    // The ban list is MECHANISM words. "version" itself is ordinary English and
    // is the §9 vocabulary ("Keep the saved version"), so banning it outright —
    // as the first draft did — would have been a wrong assertion, not a finding.
    ok("O8 §9 the person is shown what happened in consequence language",
      /not saved/i.test(v.headline) &&
      !/sync_version|\bCAS\b|409|compare-and-set|\bconflict\b|\bupsert\b|\brpc\b/i.test(v.headline), v.headline);
    ok("O9 §9 …and the two versions of the fact that actually differ",
      v.fields.some((f) => /Done/.test(f.saved) && /Deferred/.test(f.yours)),
      JSON.stringify(v.fields));

    /* §17 — arrival order is no longer the authority. Run it the other way
       round: whoever is stale is refused, regardless of who arrives last. */
    C.purgeConflicts();
    const S2 = server();
    const X = S2.device(), Y = S2.device();
    await X.saveStateByDomain(shared, undefined, null);
    await Y.loadState();
    await Y.saveStateByDomain({ ...empty(), nextActions: [deferred] }, new Set(["nextActions"]), shared);
    await X.saveStateByDomain({ ...empty(), nextActions: [completed] }, new Set(["nextActions"]), shared);
    ok("O10 §17 reversing the arrival order gives the SYMMETRIC outcome — the stale device is refused, whoever it is",
      S2.rows("next_actions")[0].status === "deferred" && C.getConflicts()[0]?.local?.status === "completed",
      JSON.stringify({ server: S2.rows("next_actions")[0].status, refused: C.getConflicts()[0]?.local?.status }));
    ok("O11 §17 …so the winner is decided by WHAT THE WRITER HAD SEEN, not by the network",
      S2.rows("next_actions")[0].status !== S.rows("next_actions")[0].status);
  }

  /* ==================================================================
   * P. §16 — F-2 REPLAYED. The P1 that made prose unrecoverable.
   * ================================================================== */
  {
    C.purgeConflicts();
    const A_BODY = "A: the advisor said Friday is the deadline, and we need the 2024 returns first.";
    const B_BODY = "B: call the accountant about the trust schedule; she has the returns already.";
    const S = server();
    const A = S.device(), B = S.device();

    const shared = { ...empty(), notes: [nt({ id: "n1", title: "Interview notes", body: "Original shared note." })] };
    await A.saveStateByDomain(shared, undefined, null);
    await B.loadState();

    await A.saveStateByDomain({ ...empty(), notes: [nt({ id: "n1", title: "Interview notes", body: A_BODY, updatedAt: iso(9) })] }, new Set(["notes"]), shared);
    await B.saveStateByDomain({ ...empty(), notes: [nt({ id: "n1", title: "Interview notes", body: B_BODY, updatedAt: iso(10) })] }, new Set(["notes"]), shared);

    ok("P1 §16 F-2: the server keeps the body written by the device that had seen the current row",
      S.rows("notes")[0].body === A_BODY, S.rows("notes")[0].body.slice(0, 20));

    // The original P1 was NOT "the wrong body won" — it was that the loser's
    // body existed nowhere afterwards. That is the claim to retest.
    const held = C.conflictFor("notes", "n1");
    ok("P2 §16 F-2 CLOSED: the refused body still exists on the device that wrote it",
      held?.local?.body === B_BODY, JSON.stringify(held?.local?.body?.slice(0, 20)));
    ok("P3 §8 …and it survives a reload, because it is persisted, not held in memory",
      JSON.parse(store.get("lifeos.conflicts.v1") || "[]").some((c) => c.local?.body === B_BODY),
      store.get("lifeos.conflicts.v1")?.slice(0, 80));

    // §8: prove the persistence claim the honest way — throw the in-memory copy
    // away and read device storage cold. (The first draft called an optional
    // helper that did not exist, so the "cold read" silently re-read the same
    // cache the writer had just filled. A green result there would have meant
    // nothing.)
    ok("P4a the cold-read helper exists, so the next assertion is not a no-op",
      typeof C.__dropCacheForTest === "function");
    C.__dropCacheForTest();
    const afterReload = C.getConflicts();
    ok("P4 §8 a cold read of device storage returns the refused body",
      afterReload.some((c) => c.local?.body === B_BODY), String(afterReload.length));

    const view = describeConflict(held);
    ok("P5 §9 the person is shown both bodies, not a merge",
      view.fields.some((f) => f.saved === A_BODY && f.yours === B_BODY), JSON.stringify(view.fields.map((f) => f.label)));
    ok("P6 §9 nothing merged, scored or resolved the two bodies automatically",
      !JSON.stringify(view).includes(A_BODY.slice(0, 10) + B_BODY.slice(0, 10)));
    ok("P7 §9 the three choices are exactly keep / use mine / copy mine",
      Object.keys(CONFLICT_ACTIONS).join(",") === "keepSaved,useMine,copyMine");

    // §9: "Use my version" must be a NEW write against the CURRENT version.
    const B2 = S.device();
    const cur = await B2.loadState();
    const reapplied = { ...empty(), notes: [{ ...cur.notes[0], body: B_BODY, updatedAt: iso(11) }] };
    await B2.saveStateByDomain(reapplied, new Set(["notes"]), { ...empty(), notes: cur.notes });
    ok("P8 §9 'Use my version' lands as an ordinary accepted write, not a bypass",
      S.rows("notes")[0].body === B_BODY && S.rows("notes")[0].sync_version === 3,
      JSON.stringify({ v: S.rows("notes")[0].sync_version }));
    ok("P9 §9 …and it did NOT skip a version, so the guard was respected throughout",
      S.rows("notes")[0].sync_version === 3);
    C.resolveConflict("notes", "n1");
    ok("P10 once reapplied, the conflict stops being offered", !C.conflictFor("notes", "n1"));
  }

  /* ==================================================================
   * Q. §19 — RAPID SAME-DEVICE MUTATION MUST NOT SELF-CONFLICT.
   * ================================================================== */
  {
    C.purgeConflicts();
    const S = server();
    const A = S.device();
    let prev = { ...empty(), notes: [nt({ id: "n2", body: "v0" })] };
    await A.saveStateByDomain(prev, undefined, null);
    for (let i = 1; i <= 8; i++) {
      const next = { ...empty(), notes: [nt({ id: "n2", body: `v${i}`, updatedAt: iso(8, i) })] };
      await A.saveStateByDomain(next, new Set(["notes"]), prev);
      prev = next;
    }
    ok("Q1 §19 eight rapid edits on ONE device produce no conflicts at all", C.getConflicts().length === 0, String(C.getConflicts().length));
    ok("Q2 §19 …and the version advanced exactly once per edit", S.rows("notes")[0].sync_version === 9, String(S.rows("notes")[0].sync_version));
    ok("Q3 §19 …with the last edit intact", S.rows("notes")[0].body === "v8", S.rows("notes")[0].body);
  }

  /* ==================================================================
   * R. §20/§21 — COMMIT-THEN-TIMEOUT, AND HONEST FAILURE.
   *
   * The dangerous case is not a rejected write. It is a write that COMMITTED
   * and whose answer was lost: the client must not assume it succeeded (and
   * blindly increment) nor assume it failed (and replay at a version the
   * server has already passed, manufacturing a conflict from nothing).
   * ================================================================== */
  {
    C.purgeConflicts();
    const S = server();
    const A = S.device();
    const s0 = { ...empty(), notes: [nt({ id: "n3", body: "before" })] };
    await A.saveStateByDomain(s0, undefined, null);

    // The next call commits, then the response is destroyed.
    S.setRpcHook(() => { S.setRpcHook(null); return Promise.reject(new Error("socket hang up")); });
    const s1 = { ...empty(), notes: [nt({ id: "n3", body: "after", updatedAt: iso(9) })] };
    const rep1 = await A.saveStateByDomain(s1, new Set(["notes"]), s0);

    // Assert the committed state BEFORE the retry runs. The first draft checked
    // it afterwards and read version 3 — the retry's own work — which would
    // have been recorded as a defect in the adapter rather than a mistake in
    // the assertion's ordering.
    ok("R1 §21 the write DID commit, even though the answer was lost",
      S.rows("notes")[0].body === "after" && S.rows("notes")[0].sync_version === 2,
      JSON.stringify({ b: S.rows("notes")[0].body, v: S.rows("notes")[0].sync_version }));
    ok("R2 §21 the ambiguous outcome was reported as a FAILED domain, not swallowed",
      rep1.failed.some((f) => f.domain === "notes"), JSON.stringify(rep1.failed));
    ok("R3 §21 …and no conflict was invented out of a lost answer",
      C.getConflicts().length === 0, JSON.stringify(C.getConflicts().map((c) => c.id)));

    // Now the retry, which is what §21 is really about.
    const rep2 = await A.saveStateByDomain(s1, new Set(["notes"]), s0);
    ok("R4 §21 the retry re-reads the authoritative version instead of assuming one",
      S.log.filter((l) => l === "select-in:notes").length >= 1, JSON.stringify(S.log));
    ok("R5 §21 …so it succeeds rather than colliding with its own committed write",
      rep2.failed.length === 0 && C.getConflicts().length === 0,
      JSON.stringify({ failed: rep2.failed, conflicts: C.getConflicts().length }));
    ok("R6 §21 …and the row holds the intended content, at exactly one further version",
      S.rows("notes")[0].body === "after" && S.rows("notes")[0].sync_version === 3,
      JSON.stringify({ b: S.rows("notes")[0].body, v: S.rows("notes")[0].sync_version }));

    // A genuine transport failure must still FAIL the domain — never be
    // disguised as a conflict, which would tell the user to choose a version
    // when the truth is that nothing was sent.
    const S2 = server();
    const B = S2.device({ failRpc: true });
    const r2 = await B.saveStateByDomain({ ...empty(), notes: [nt({ id: "n4", body: "x" })] }, new Set(["notes"]), null);
    ok("R7 §21 a real failure fails the domain rather than becoming a fake conflict",
      r2.failed.some((f) => f.domain === "notes") && C.getConflicts().every((c) => c.id !== "n4"),
      JSON.stringify({ failed: r2.failed, conflicts: C.getConflicts().map((c) => c.id) }));
    ok("R8 §21 …and nothing was written, so the user is not asked to choose a version that does not exist",
      S2.rows("notes").length === 0, JSON.stringify(S2.rows("notes")));

    /*
     * §21, the case that was MISSING and turned out to be a live defect.
     *
     * The RPC succeeds — no `error` — but the body cannot be read. The rows
     * committed. Before the fix the client read an empty `accepted`, left its
     * version map behind, and reported the domain SYNCED; the next genuine
     * edit then proposed a version the server had already passed, so it was
     * refused, that edit was lost, and the person was shown a conflict about a
     * change that was never in dispute.
     *
     * An unreadable response is now an ambiguous outcome, handled exactly like
     * a lost one.
     */
    const S3 = server();
    const D = S3.device({ blankBody: true });
    const b0 = { ...empty(), notes: [nt({ id: "n9", body: "v0" })] };
    const conn0 = S3.device();
    await conn0.saveStateByDomain(b0, undefined, null);           // seed at v1 via a normal client
    const b1 = { ...empty(), notes: [nt({ id: "n9", body: "v1", updatedAt: iso(9) })] };
    const rb = await D.saveStateByDomain(b1, new Set(["notes"]), b0);
    ok("R9 §21 an unreadable response is NOT reported as a successful sync",
      rb.failed.some((f) => f.domain === "notes"), JSON.stringify(rb));
    ok("R10 §21 …even though the rows really did commit",
      S3.rows("notes")[0].sync_version === 2 && S3.rows("notes")[0].body === "v1",
      JSON.stringify(S3.rows("notes")[0]));
    ok("R11 §21 …and no conflict is invented from it", C.getConflicts().every((c) => c.id !== "n9"));

    // The next ordinary edit must land, not be refused by the client's own
    // mis-tracking — this is the assertion that fails without the repair.
    const E = S3.device();
    const cur9 = await E.loadState();
    const b2 = { ...empty(), notes: [{ ...cur9.notes[0], body: "v2", updatedAt: iso(10) }] };
    await E.saveStateByDomain(b2, new Set(["notes"]), { ...empty(), notes: cur9.notes });
    ok("R12 §21 …so the NEXT edit is accepted rather than spuriously refused",
      S3.rows("notes")[0].body === "v2" && S3.rows("notes")[0].sync_version === 3 &&
      C.getConflicts().every((c) => c.id !== "n9"),
      JSON.stringify({ row: S3.rows("notes")[0], conflicts: C.getConflicts().map((c) => c.id) }));
  }

  /* ==================================================================
   * S. §15 — TOMBSTONES STILL BEHAVE.
   * ================================================================== */
  {
    C.purgeConflicts();
    const S = server();
    const A = S.device();
    const s0 = { ...empty(), notes: [nt({ id: "n5", body: "keep" })] };
    await A.saveStateByDomain(s0, undefined, null);
    await A.saveStateByDomain({ ...empty(), notes: [] }, new Set(["notes"]), s0);
    ok("S1 §15 a guarded row still deletes", S.rows("notes").length === 0, String(S.rows("notes").length));
    ok("S2 §15 …and still writes its tombstone", S.rows("sync_tombstones").length === 1, JSON.stringify(S.rows("sync_tombstones")));
    // A stale device that never saw the delete pushes the row back. The guard
    // has nothing to say about that — the row is gone, so this is an INSERT —
    // which is exactly why the tombstone, not the version, is what suppresses it.
    const B = S.device();
    await B.saveStateByDomain(s0, new Set(["notes"]), { ...empty(), notes: [] });
    const { suppressDeleted } = require("@/lib/persistence-reconcile");
    const tomb = await B.loadTombstones();
    const cleaned = suppressDeleted({ ...empty(), notes: S.rows("notes").map((r) => nt({ id: r.id, body: r.body })) }, tomb);
    ok("S3 §15 a resurrected row is suppressed by the tombstone, not by the version",
      (cleaned.notes ?? []).length === 0, JSON.stringify(cleaned.notes));
  }

  /* ==================================================================
   * T. §24 — DOES sync_version BELONG IN AN ARCHIVE? (decision: NO)
   * ================================================================== */
  {
    const S = server();
    const A = S.device();
    await A.saveStateByDomain({ ...empty(), notes: [nt({ id: "n6", body: "archive me" })], nextActions: [act({ id: "a6", title: "T" })] }, undefined, null);
    const loaded = await A.loadState();
    const json = JSON.stringify(loaded);
    ok("T1 §24 a loaded snapshot carries no version — it is a server concern, not a life fact",
      !json.includes("sync_version") && !json.includes("syncVersion"), json.slice(0, 120));

    const { buildBackup } = (() => { try { return require("@/lib/ux/backup"); } catch { return {}; } })();
    if (typeof buildBackup === "function") {
      const b = JSON.stringify(buildBackup({ ...empty(), ...loaded }));
      ok("T2 §24 …and neither does an exported backup", !b.includes("sync_version") && !b.includes("syncVersion"));
    } else {
      ok("T2 §24 …and neither does an exported backup (no buildBackup export; snapshot check stands)",
        !json.includes("sync_version"));
    }
    ok("T3 §24 the decision is STRUCTURAL: the version lives in the adapter, never on the record type",
      !/syncVersion/.test(fs.readFileSync(`${LIB}/types/mvp.ts`, "utf8")),
      "a version reached the domain type — re-examine §24");
    ok("T4 §24 restoring an archive therefore cannot carry a stale version into a live account",
      !json.includes("sync_version"));
  }

  /* ==================================================================
   * U. §26 / E-7 — A SELF-TEST PAGE MUST NOT DESTROY THE VIEWER'S ACCOUNT.
   * ================================================================== */
  {
    const baseSync = baseFile("lib/sync/selftest.ts");
    const baseActions = baseFile("lib/actions/selftest.ts");
    const baseStore = baseFile("lib/mvpStore.ts");

    ok("U1 RED: at BASE, /dev/sync-tests drove the real store with no isolation",
      /restoreState\(/.test(baseSync) && !/withIsolatedStore/.test(baseSync),
      "base already isolated it — re-examine E-7");
    ok("U2 RED: at BASE, /dev/action-tests did the same",
      /restoreState\(/.test(baseActions) && !/withIsolatedStore/.test(baseActions));
    ok("U3 RED: at BASE, no isolation seam existed to use",
      !/withIsolatedStore/.test(baseStore));
    ok("U4 RED: and setState persisted unconditionally, so the wipe reached storage AND the server",
      /function persist\(\) \{\s*saveState\(state\);/.test(baseStore),
      "base persist() was already guarded — re-examine");

    // GREEN — run the two real suites and prove the viewer's world is untouched.
    const St = require("@/lib/mvpStore");
    ok("U5 §26 the seam exists and is exported", typeof St.withIsolatedStore === "function");

    /*
     * All four things a visit must never touch, seeded together. The store was
     * the obvious one; the other three are the ones that would be missed —
     * `resetStore` used to take the last-sync key with it, and an orphaned or
     * erased conflict record is the loss this whole sprint exists to prevent.
     */
    store.set("lifeos.mvp.v1", JSON.stringify({ marker: "the viewer's real data" }));
    store.set("lifeos.lastSync.v1", "2026-08-30T07:15:00.000Z");
    store.set("lifeos.conflicts.v1", JSON.stringify([{
      domain: "notes", id: "zzkeep", reason: "stale_write", detectedAt: iso(9),
      local: { id: "zzkeep", body: "ZZUnresolvedIntent" }, remote: { id: "zzkeep", body: "theirs" },
    }]));
    /*
     * Two direct measurements rather than a comparison of before/after values:
     * a write that happened and was undone would pass a value comparison, and
     * the whole point is that no write may happen at all.
     */
    const writes = [];
    const realSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (k, v) => { writes.push(k); return realSet(k, v); };

    // A live remote, recording every call. If `persist()` ran even once, its
    // `scheduleRemotePush` would reach this adapter within the 400ms debounce.
    const P = require("@/lib/persistence");
    const pushSpy = server();
    P.__setRemoteForTest(pushSpy.device());
    const before = St.getSnapshot();
    // The property is not "no notification" — the seam deliberately wakes
    // subscribers once on the way out, so anything that somehow read during the
    // window is corrected. The property is that a subscriber can never OBSERVE
    // fixture data, so what is recorded is the snapshot each notification
    // exposes. The first draft counted notifications and reported the
    // corrective one as a failure.
    const observed = [];
    const unsub = St.subscribe(() => { observed.push(St.getSnapshot()); });

    const { runSyncSelfTests } = require("@/lib/sync/selftest");
    const { runActionSelfTests } = require("@/lib/actions/selftest");
    const r1 = await runSyncSelfTests();
    const r2 = await runActionSelfTests();
    unsub();

    ok("U6 §26 both suites still pass — isolation did not weaken them", r1.pass && r2.pass,
      JSON.stringify({ sync: `${r1.passed}/${r1.total}`, actions: `${r2.passed}/${r2.total}` }));
    ok("U7 §26 the store still holds the viewer's own state afterwards",
      St.getSnapshot() === before, "the singleton was left holding fixture data");
    ok("U8 §26 device storage was never written during the run",
      store.get("lifeos.mvp.v1") === JSON.stringify({ marker: "the viewer's real data" }),
      store.get("lifeos.mvp.v1"));
    ok("U8b §26 …the device's sync clock was not cleared",
      store.get("lifeos.lastSync.v1") === "2026-08-30T07:15:00.000Z",
      String(store.get("lifeos.lastSync.v1")));
    ok("U8c §26 …and an UNRESOLVED conflict was not wiped",
      (store.get("lifeos.conflicts.v1") ?? "").includes("ZZUnresolvedIntent"),
      String(store.get("lifeos.conflicts.v1")));
    ok("U8d §26 …no local write was ATTEMPTED, not merely none left behind",
      writes.length === 0, JSON.stringify(writes));
    ok("U9 §26 no subscriber could ever observe fixture data",
      observed.every((snap) => snap === before),
      `${observed.filter((s2) => s2 !== before).length} of ${observed.length} notifications exposed a different snapshot`);

    // The seam has to survive a failing suite too, or one bad assertion would
    // leave the viewer's store holding fixtures.
    let rethrown = false;
    const snap = St.getSnapshot();
    try {
      St.withIsolatedStore(() => {
        St.restoreState({ ...empty(), notes: [nt({ id: "boom", body: "fixture" })] });
        throw new Error("a suite blew up mid-run");
      });
    } catch { rethrown = true; }
    ok("U10 §26 a throw inside the seam still restores the real state", St.getSnapshot() === snap && rethrown);
    ok("U11 §26 …and still leaves storage untouched",
      store.get("lifeos.mvp.v1") === JSON.stringify({ marker: "the viewer's real data" }));

    // Past the 400ms debounce, so a scheduled push would have landed by now.
    await new Promise((r) => setTimeout(r, 700));
    ok("U12 §26 nothing reached the server either — no fixture was ever pushed",
      pushSpy.log.length === 0, JSON.stringify(pushSpy.log));
    globalThis.localStorage.setItem = realSet;
    P.__setRemoteForTest(null);
  }

  /* ==================================================================
   * V. §6/§10 — THE WORDS.
   * ================================================================== */
  {
    const files = ["components/sync/ConflictNotice.tsx", "lib/sync/conflict-view.ts", "components/SyncStatus.tsx"];
    for (const f of files) {
      const raw = fs.readFileSync(`${LIB}/${f}`, "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const strings = [...code.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1])
        .concat([...code.matchAll(/>([^<>{}\n]{12,})</g)].map((m) => m[1].trim()))
        .filter((t) => !/className|flex|rounded|text-|bg-|dark:|min-h|sm:|focus-visible|whitespace|tracking|border|uppercase|shrink|gap-|mt-|px-|py-|inset|absolute|shadow/.test(t));
      const leaks = strings.filter((t) => /sync_version|CAS|compare-and-set|409|conflict resolution|postgres|supabase|rpc|trigger|next_actions|\bupsert\b/i.test(t));
      ok(`V-${f.split("/").pop()} §6 no user-facing string exposes the mechanism`,
        leaks.length === 0, JSON.stringify(leaks));
    }
    ok("V1 §10 the summary counts consequences, not events",
      /not saved/.test(conflictSummary(1)) && /2 changes/.test(conflictSummary(2)) && conflictSummary(0) === "",
      `${conflictSummary(1)} / ${conflictSummary(2)}`);
    ok("V2 §11 nothing anywhere advises a refresh as the recovery",
      !/refresh the page|try refreshing/i.test(fs.readFileSync(`${LIB}/components/sync/ConflictNotice.tsx`, "utf8")));
    ok("V3 §9 the notice never claims to have merged anything",
      !/merged|combined automatically/i.test(fs.readFileSync(`${LIB}/components/sync/ConflictNotice.tsx`, "utf8")));

    /*
     * D-8 must still be dormant. The first draft tested for FILE REFERENCES to
     * `lib/sync/merge`, which is the wrong property: `ConflictCenter` has been
     * rendered on /health since long before this sprint and merely importing
     * the module wakes nothing. Dormancy means the engine is never FED — the
     * only producer of a `RecordConflict` is a dev-page button, so the list is
     * empty in production and no merge ever runs. That is the property that can
     * actually regress, and this is where it would be caught.
     */
    const producers = execSync(`grep -rln "setConflicts(" ${LIB}/app ${LIB}/components ${LIB}/lib || true`)
      .toString().trim().split("\n").filter(Boolean)
      .filter((f) => !f.endsWith("lib/sync/status-store.ts"));   // the setter's own definition
    ok("V4 §30 D-8 stays dormant — nothing in the product feeds the merge engine",
      producers.every((f) => f.includes("/dev/")), JSON.stringify(producers));
    ok("V5 §30 …and the 0045 rejection path uses its own store, not D-8's",
      /conflicts-store/.test(fs.readFileSync(`${LIB}/lib/adapters/supabaseAdapter.ts`, "utf8")) &&
      !/status-store|setConflicts/.test(fs.readFileSync(`${LIB}/lib/adapters/supabaseAdapter.ts`, "utf8")));
    ok("V6 §30 …and no merge rule module was touched by this sprint",
      execSync(`git -C ${LIB} diff --name-only ${BASE}..HEAD -- lib/sync/merge.ts lib/sync/conflicts.ts "lib/**/merge-rules.ts" || true`).toString().trim() === "",
      execSync(`git -C ${LIB} diff --name-only ${BASE}..HEAD -- lib/sync/merge.ts lib/sync/conflicts.ts "lib/**/merge-rules.ts" || true`).toString());
  }

  const failed = results.filter((r) => !r.p);
  console.log(`\n=== ${results.length - failed.length}/${results.length} CAS-client assertions ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
