/**
 * LIFEOS-074 — recurrence torture, false-confidence cases, and an ADVERSARIAL
 * SECOND PASS aimed at this sprint's own repairs.
 *
 * The second pass rule: attack what I already concluded was fine, and prefer
 * targets where I would look worst if I were wrong.
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const St = require("@/lib/mvpStore");
const { STORE_DOMAINS } = require("@/lib/ux/backup");
const { SupabasePersistenceAdapter, SYNC_DOMAIN_ORDER } = require("@/lib/adapters/supabaseAdapter");
const { suppressDeleted, reconcileAdoption } = require("@/lib/persistence-reconcile");
const { makeTombstone } = require("@/lib/sync/tombstones");
const { readRule, currentOccurrence, describeRule } = require("@/lib/time/recurrence");
const { buildAutobiographicalTimeline } = require("@/lib/memory/week");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const T = "2026-08-25";
const iso = (d, h = 8) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const act = (p) => ({ description: "", status: "open", updatedAt: p.createdAt, notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], ...p });
const empty = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));

// =========================================================================
// R. RECURRENCE TORTURE
// =========================================================================
{
  const seed = (rule, extra = {}) => {
    const s = empty();
    s.nextActions = [act({ id: "r1", title: "Standing", createdAt: iso("2026-01-01"), dueDate: "2026-01-01", recurrence: rule, ...extra })];
    St.restoreState(s);
  };
  const A = () => St.getSnapshot().nextActions.find((x) => x.id === "r1");
  const comps = () => St.getSnapshot().recurrenceCompletions ?? [];

  // Rules the reader must refuse rather than reinterpret.
  for (const [label, rule] of [
    ["a zero interval", { frequency: "daily", interval: 0 }],
    ["a negative interval", { frequency: "daily", interval: -3 }],
    ["a monthly rule with day 32", { frequency: "monthly", interval: 1, dayOfMonth: 32 }],
    ["a weekly rule with weekday 9", { frequency: "weekly", interval: 1, daysOfWeek: [9] }],
    ["a weekly rule with no days", { frequency: "weekly", interval: 1, daysOfWeek: [] }],
    ["a frequency that does not exist", { frequency: "hourly", interval: 1 }],
  ]) {
    ok(`R-${label} is refused, not reinterpreted`, readRule(rule) === null || readRule(rule) === undefined, JSON.stringify(readRule(rule)));
  }
  // …and a valid one is accepted.
  ok("R-a valid daily rule is accepted", !!readRule({ frequency: "daily", interval: 1 }));

  // Feb 29 on a non-leap year: monthly on the 31st must skip, never invent.
  const monthly31 = readRule({ frequency: "monthly", interval: 1, dayOfMonth: 31 });
  const feb = currentOccurrence(monthly31, "2026-01-31", "2026-02-01", []);
  ok("R-monthly-31 never lands on a day February does not have",
    !feb || !/^2026-02-(29|30|31)/.test(feb), String(feb));

  // Completing an occurrence never completes the series, and is idempotent.
  seed({ frequency: "daily", interval: 1 });
  ok("R-complete one occurrence", St.completeOccurrence("r1", "2026-01-01") === true);
  ok("R-…the series stays open", A().status !== "completed", A().status);
  ok("R-…a duplicate is refused", St.completeOccurrence("r1", "2026-01-01") === false);
  ok("R-…leaving exactly one row", comps().length === 1);
  ok("R-a malformed occurrence date is refused", St.completeOccurrence("r1", "01-01-2026") === false);
  ok("R-…and an empty one", St.completeOccurrence("r1", "") === false);

  // Stopping keeps history and leaves the outstanding instance dated.
  seed({ frequency: "daily", interval: 1 });
  St.completeOccurrence("r1", "2026-01-01");
  ok("R-stop recurrence succeeds", St.stopActionRecurrence("r1", "2026-01-05") === true);
  ok("R-…the rule is gone", !A().recurrence);
  ok("R-…every completion is kept", comps().length === 1);
  ok("R-…and it is not marked completed", A().status === "open", A().status);
  ok("R-stopping twice is refused", St.stopActionRecurrence("r1", "2026-01-05") === false);

  // Recurrence + defer, + waiting: the rule must survive a status change.
  seed({ frequency: "daily", interval: 1 });
  St.deferAction("r1", "tomorrow");
  ok("R-a deferred recurring action keeps its rule", !!A().recurrence);
  St.markActionWaiting("r1", "Someone");
  ok("R-…and a waiting one does too", !!A().recurrence);
  St.startAction("r1");
  ok("R-…and starting it keeps the rule while ending the wait",
    !!A().recurrence && !A().waitingOn, JSON.stringify({ r: !!A().recurrence, w: A().waitingOn }));
}

// =========================================================================
// F. FALSE-CONFIDENCE CASES — the right answer is "I don't know"
// =========================================================================
{
  const { answerMemoryQuery } = require("@/lib/memory/answer");
  const s = empty();
  s.nextActions = [act({ id: "a1", title: "Call the plumber", createdAt: iso(T) })];
  const ask = (q) => { try { return answerMemoryQuery(s, q, { today: T }); } catch (e) { return { summary: `THREW: ${e.message}` }; } };
  const unanswerable = [
    ["a cause the store never recorded", "Why did I procrastinate on the plumber?"],
    ["an emotion never captured", "How did I feel about the plumber?"],
    ["a person never mentioned", "What did Priya say about the plumber?"],
    ["a place never recorded", "What did I do in Lisbon?"],
    ["money never tracked", "How much did the plumber cost?"],
    ["the future", "Will I finish this next month?"],
    ["a counterfactual", "What would have happened if I had called sooner?"],
    ["a comparison to other people", "Am I more productive than average?"],
    ["a self-evaluation", "Was I disciplined this week?"],
    ["a period with no records", "What did I do in 2019?"],
    ["an entity that does not exist", "How is the Antarctica project going?"],
  ];
  let threw = 0, confident = 0;
  for (const [label, q] of unanswerable) {
    const a = ask(q);
    const text = String(a.summary ?? "");
    if (/^THREW/.test(text)) { threw++; ok(`F-${label}`, false, text); continue; }
    // A confident wrong answer asserts a fact; an honest one declines or reports
    // only what IS recorded.
    const asserts = /\byou (felt|spent|were|said|visited|will)\b/i.test(text);
    if (asserts) confident++;
    ok(`F-${label} is not answered with a fabricated fact`, !asserts, text.slice(0, 120));
  }
  ok("F-no unanswerable question throws", threw === 0, `${threw} threw`);
  ok("F-no unanswerable question is answered confidently", confident === 0, `${confident} confident`);
}

// =========================================================================
// X. ADVERSARIAL SECOND PASS — attack this sprint's own repairs
// =========================================================================
(async () => {
  // X1. D-22: every domain in the order must actually have a branch in the
  // chain. A domain with no branch would be attempted, write nothing, and be
  // reported as SUCCEEDED — a false success created by my own repair.
  {
    const adapterSrc = require("fs").readFileSync("/home/user/LifeOS/lib/adapters/supabaseAdapter.ts", "utf8");
    const missing = SYNC_DOMAIN_ORDER.filter((d) => !new RegExp(`w\\("${d}"\\)`).test(adapterSrc));
    ok("X1 every domain in SYNC_DOMAIN_ORDER has a real branch in the chain",
      missing.length === 0, JSON.stringify(missing));
    const notInOrder = STORE_DOMAINS.filter((d) => !SYNC_DOMAIN_ORDER.includes(d));
    ok("X2 …and no store domain is missing from the order", notInOrder.length === 0, JSON.stringify(notInOrder));
  }

  // X3. D-24: a tombstone whose domain is not a store key must not throw or
  // silently wipe an unrelated domain.
  {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Keep", createdAt: iso(T) })];
    let boom = null, out = null;
    try { out = suppressDeleted(s, [makeTombstone("not_a_domain", "a1", iso(T, 12))]); } catch (e) { boom = e.message; }
    ok("X3 a tombstone for an unknown domain is ignored, not fatal", boom === null, String(boom));
    ok("X4 …and touches nothing", out && out.nextActions.length === 1);
  }

  // X5. D-24: a tombstone with a malformed date must not suppress everything.
  {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Keep", createdAt: iso(T), updatedAt: iso(T) })];
    const bad = suppressDeleted(s, [makeTombstone("nextActions", "a1", "not-a-date")]);
    ok("X5 a tombstone with an unparseable date does not suppress the record",
      bad.nextActions.length === 1, JSON.stringify(bad.nextActions.map((a) => a.id)));
  }

  // X6. D-24: a record with NO timestamps at all against a valid tombstone.
  {
    const s = empty();
    s.nextActions = [{ id: "a1", title: "No stamps" }];
    const out = suppressDeleted(s, [makeTombstone("nextActions", "a1", iso(T, 12))]);
    ok("X6 a record with no timestamps is treated as stale and suppressed",
      out.nextActions.length === 0, JSON.stringify(out.nextActions));
  }

  // X7. D-24: suppression must not touch a domain with no tombstones, by
  // REFERENCE — the dirty-domain diff depends on reference equality, so
  // rebuilding an untouched array would mark every domain dirty on every load.
  {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Keep", createdAt: iso(T), updatedAt: iso(T) })];
    s.notes = [{ id: "n1", title: "x", body: "y", tags: [], linkedEntityRefs: [], archived: false, createdAt: iso(T), updatedAt: iso(T) }];
    const out = suppressDeleted(s, [makeTombstone("nextActions", "zzz", iso(T, 12))]);
    ok("X7 a domain with no suppressed record keeps its EXACT array reference",
      out.notes === s.notes && out.nextActions === s.nextActions,
      JSON.stringify({ notes: out.notes === s.notes, actions: out.nextActions === s.nextActions }));
  }

  // X8. D-24: no tombstones at all must return the SAME state object.
  {
    const s = empty();
    ok("X8 an empty ledger returns the identical state object", suppressDeleted(s, []) === s);
  }

  // X9. D-22 + D-24 together: a delete whose tombstone fails must not also
  // roll back the domains that succeeded before it in the same run.
  {
    const db = new Map(), calls = [];
    const put = (t, rows) => { const m = db.get(t) ?? new Map(); for (const r of rows) m.set(r.id ?? `${r.domain}:${r.record_id}`, r); db.set(t, m); };
    const fails = { sync_tombstones: true };
    const client = { from: (t) => ({
      upsert: (rows) => { const arr = Array.isArray(rows) ? rows : [rows]; calls.push(`u:${t}`); if (fails[t]) return Promise.reject(new Error(`fail ${t}`)); put(t, arr); return Promise.resolve({ error: null, data: arr }); },
      delete: () => ({ in: (_c, ids) => { calls.push(`d:${t}`); const m = db.get(t); if (m) for (const i of ids) m.delete(i); return Promise.resolve({ error: null }); }, eq: () => Promise.resolve({ error: null }) }),
      select: () => { const q = Promise.resolve({ data: [...(db.get(t)?.values() ?? [])], error: null }); q.order = () => q; q.eq = () => q; return q; },
    }), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
    const ad = new SupabasePersistenceAdapter(client);
    const base = empty();
    base.workspaces = [{ id: "w1", name: "Home", createdAt: iso(T), updatedAt: iso(T), items: [], pinned: [], goals: [], archived: false }];
    base.nextActions = [act({ id: "a1", title: "Gone", createdAt: iso(T) })];
    await ad.saveStateByDomain(base, undefined, null);
    const after = { ...base, nextActions: [] };
    const rep = await ad.saveStateByDomain(after, new Set(["workspaces", "nextActions"]), base);
    ok("X9 the failing delete-domain is reported failed", rep.failed.some((f) => f.domain === "nextActions"), JSON.stringify(rep.failed));
    ok("X10 …while the earlier domain still counts as succeeded", rep.succeeded.includes("workspaces"), JSON.stringify(rep.succeeded));
    ok("X11 …and the remote delete itself is NOT rolled back",
      !(db.get("next_actions")?.has("a1")), JSON.stringify([...(db.get("next_actions")?.keys() ?? [])]));
  }

  // X12. D-13: a completion whose `completedAt` is present but whose status was
  // later cancelled must not count as a completion.
  {
    const s = empty();
    s.nextActions = [act({ id: "a1", title: "Cancelled after completing", createdAt: iso(T),
      status: "cancelled", completedAt: iso(T, 9), cancelledAt: iso(T, 10),
      history: [{ id: "h1", action: "completed", at: iso(T, 9), fromStatus: "open", toStatus: "completed" },
                { id: "h2", action: "cancelled", at: iso(T, 10), fromStatus: "completed", toStatus: "cancelled" }] })];
    const tl = buildAutobiographicalTimeline(s, { start: iso(T, 0), end: iso(T, 23), startDay: T, endDay: T, label: "day" });
    ok("X12 a completion later cancelled is not reported as completed",
      !tl.some((e) => e.kind === "completed_action"), JSON.stringify(tl.map((e) => e.kind)));
  }

  const pass = results.filter((r) => r.p).length;
  console.log(`\n=== ${pass}/${results.length} assertions ===`);
  for (const r of results.filter((x) => !x.p)) console.log(`FAILED: ${r.n} — ${r.d ?? ""}`);
})();
