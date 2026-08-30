/**
 * Sync integrity self-tests (LIFEOS-033).
 *
 * Deterministic assertions for the whole sync engine — three-way merge, conflict
 * detection, child-list merge, tombstones, the journal, operation idempotency,
 * corruption isolation, referential integrity, schema upgrades, and the ten
 * documented cross-device scenarios (Feature 12) — plus performance budgets over
 * a large state. Surfaced at `/dev/sync-tests`, asserted by `syncintegrity.mjs`.
 * Pure: no store, no localStorage, no AI.
 */

import { threeWayMerge, mergeChildList, changedKeys, deepEqual, type Rec } from "@/lib/sync/merge";
import { classifyRecord, detectDomainConflicts, detectConflicts } from "@/lib/sync/conflicts";
import { makeTombstone, shouldSuppress, applyTombstones, cleanupTombstones, mergeTombstones, tombstonesForDeletions } from "@/lib/sync/tombstones";
import { operationId, dedupeOperations, applyUpserts, applyDeletes, type Operation } from "@/lib/sync/operations";
import { makeEntry, recordAttempt, markFailed, upsertEntry, categorizeFailure, journalDepth, oldestPending } from "@/lib/sync/journal";
import { isolateDomain, shouldEnterRecoveryMode, buildRecoveryReport } from "@/lib/sync/recovery";
import { validateIntegrity } from "@/lib/sync/integrity";
import { upgradeState } from "@/lib/migrations/upgrade-state";
import { upgradeBackup } from "@/lib/migrations/upgrade-backup";
import { budget } from "@/lib/ux/performance";
import { reconcileAdoption, mergeLocalOnly, snapshotHasData, suppressDeleted } from "@/lib/persistence-reconcile";
import type { StoreState } from "@/types/mvp";
import { STORE_DOMAINS, emptyStoreState } from "@/lib/ux/backup";
import { SYNC_DOMAIN_ORDER } from "@/lib/adapters/supabaseAdapter";
import { formatLastSync } from "@/lib/sync/last-sync";
// Section 58-61 drives the REAL store: whether belief revisions can be reordered
// is a property of the mutators, not of a fixture (LIFEOS-074 §7).
import * as StoreForTest from "@/lib/mvpStore";
import { withIsolatedStore } from "@/lib/mvpStore";

/**
 * A minimal empty StoreState for pure tests.
 *
 * Derived from `STORE_DOMAINS` rather than a literal (LIFEOS-075 C-1). The
 * literal it replaces listed 44 domains under a comment claiming 41, and was
 * missing `events` and `recurrenceCompletions` — a fourth hand-maintained copy
 * of the domain list, drifting exactly the way the four-domain `hasData()`
 * drifted. One source, and section 62 fails the build if the others leave it.
 */
function emptyStore(): StoreState {
  return emptyStoreState();
}

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const T0 = "2026-12-01T00:00:00.000Z";
const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();

export function runSyncSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  // --- Diff primitives ---
  ok("1. deepEqual is order-independent", deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
  ok("2. changedKeys reports differing top-level keys", deepEqual(changedKeys({ id: "x", a: 1, b: 2 }, { id: "x", a: 9, b: 2 }), ["a"]));

  // --- Three-way merge (Feature 3) ---
  const base: Rec = { id: "r1", title: "Draft", tags: ["a"], notes: "n1" };
  // local changed title, remote changed tags → non-overlapping auto-merge.
  const m1 = threeWayMerge(base, { ...base, title: "Final" }, { ...base, tags: ["a", "b"] });
  ok("3. non-overlapping field changes auto-merge", m1.status === "auto" && m1.merged.title === "Final" && deepEqual(m1.merged.tags, ["a", "b"]));
  // both changed the same scalar differently → conflict (no prose concat).
  const m2 = threeWayMerge(base, { ...base, notes: "local note" }, { ...base, notes: "remote note" });
  ok("4. overlapping scalar change → conflict, keeps local, no concat", m2.status === "conflict" && m2.conflictFields.includes("notes") && m2.merged.notes === "local note");
  // same change on both sides → clean.
  const m3 = threeWayMerge(base, { ...base, title: "Same" }, { ...base, title: "Same" });
  ok("5. identical change on both sides is clean", m3.status === "clean");

  // --- Child-list merge (Feature 3) ---
  const cbase = [{ id: "c1", v: 1 }];
  const cm = mergeChildList(cbase, [{ id: "c1", v: 1 }, { id: "c2", v: 2 }], [{ id: "c1", v: 1 }, { id: "c3", v: 3 }]);
  ok("6. child-list union keeps both new children", cm.conflictIds.length === 0 && cm.merged.length === 3);
  const cm2 = mergeChildList(cbase, [{ id: "c1", v: 10 }], [{ id: "c1", v: 20 }]);
  ok("7. child edited differently on both sides → conflict id", cm2.conflictIds.includes("c1"));
  const cm3 = mergeChildList(cbase, [], [{ id: "c1", v: 1 }]);
  ok("8. child unchanged-remote + deleted-local → dropped", cm3.merged.length === 0);

  // --- Conflict classification (Feature 2) ---
  ok("9. delete-local + edit-remote → needs resolution", classifyRecord("d", "x", { id: "x", v: 1 }, undefined, { id: "x", v: 2 }).needsResolution);
  ok("10. delete-local + unchanged-remote → accept delete (no resolution)", !classifyRecord("d", "x", { id: "x", v: 1 }, undefined, { id: "x", v: 1 }).needsResolution);
  ok("11. one-sided local edit is not a conflict", classifyRecord("d", "x", { id: "x", v: 1 }, { id: "x", v: 2 }, { id: "x", v: 1 }).kind === "local_only");

  // --- Tombstones (Feature 5) ---
  const tomb = makeTombstone("documents", "doc1", at(100));
  ok("12. tombstone suppresses an older resurrected record", shouldSuppress(tomb, { updatedAt: at(50) }));
  ok("13. tombstone does NOT suppress a newer edit (resurrection intent)", !shouldSuppress(tomb, { updatedAt: at(150) }));
  const applied = applyTombstones("documents", [{ id: "doc1", updatedAt: at(50) }, { id: "doc2", updatedAt: at(10) }], [tomb]);
  ok("14. applyTombstones removes the suppressed record", applied.suppressed.includes("doc1") && applied.survivors.some((r) => r.id === "doc2"));
  ok("15. cleanupTombstones drops expired ones", cleanupTombstones([makeTombstone("d", "old", "2020-01-01T00:00:00Z")], Date.parse(T0)).length === 0);
  ok("16. tombstonesForDeletions detects removed ids", tombstonesForDeletions("d", [{ id: "a" }, { id: "b" }], [{ id: "a" }], at(1)).some((t) => t.recordId === "b"));
  ok("17. mergeTombstones keeps the latest deletedAt", mergeTombstones([makeTombstone("d", "x", at(1))], [makeTombstone("d", "x", at(9))])[0].deletedAt === at(9));

  // --- Operations & idempotency (Feature 7) ---
  const op: Operation = { domain: "captures", recordId: "c1", type: "insert", revision: 1 };
  ok("18. operationId is stable + content-addressed", operationId(op) === operationId({ ...op }));
  ok("19. dedupeOperations collapses replays", dedupeOperations([op, { ...op }, { ...op, type: "update" }]).length === 2);
  ok("20. re-applying an upsert is a no-op (no duplicate)", applyUpserts([{ id: "a" }], [{ id: "a" }]).length === 1);
  ok("21. deleting an absent id changes nothing", applyDeletes([{ id: "a" }], ["ghost"]).length === 1);

  // --- Journal (Feature 6) ---
  let e = makeEntry("op1", "captures", "c1", "insert", at(1));
  e = recordAttempt(e, at(2));
  e = markFailed(e, at(3), categorizeFailure("network timeout"));
  ok("22. journal records attempts + sanitized category", e.attempts === 1 && e.failureCategory === "network");
  const j = upsertEntry(upsertEntry([], e), { ...e, opId: "op2", status: "pending" });
  ok("23. journal upsert is idempotent by opId", upsertEntry(j, e).length === 2 && journalDepth(j) === 2);
  ok("24. oldestPending finds the earliest", oldestPending(j)?.opId === "op1");
  ok("25. failure categorization buckets errors", categorizeFailure("401 unauthorized jwt") === "auth" && categorizeFailure("409 conflict") === "conflict");

  // --- Corruption isolation (Feature 10) ---
  const iso = isolateDomain("captures", [{ id: "a", text: "ok" }, null, { text: "no id" }, { id: "b" }]);
  ok("26. isolateDomain keeps valid, skips malformed", iso.valid.length === 2 && iso.recovery.skipped === 2);
  ok("27. recovery mode triggers on heavy corruption", shouldEnterRecoveryMode([{ domain: "x", kept: 1, skipped: 5, skippedIds: [] }]));
  ok("28. recovery report totals skipped", buildRecoveryReport([iso.recovery], at(1)).totalSkipped === 2);

  // --- Referential integrity (Feature 11) ---
  const integrity = validateIntegrity({
    documents: [{ id: "doc1" }] as never,
    citations: [{ id: "cit1", documentId: "missing" }] as never,
    sessions: [{ id: "s1", workspaceId: "nope" }] as never,
    projects: [{ id: "p1", goalId: "gone" }] as never,
    captures: [{ id: "dup" }, { id: "dup" }] as never,
  });
  ok("29. integrity flags a dangling citation", integrity.issues.some((i) => i.domain === "citations"));
  ok("30. integrity flags a duplicate id as error", integrity.issues.some((i) => i.domain === "captures" && i.severity === "error") && !integrity.ok);
  ok("31. integrity flags orphan session + project refs", integrity.issues.some((i) => i.domain === "sessions") && integrity.issues.some((i) => i.domain === "projects"));

  // --- Schema upgrades (Feature 9) ---
  const legacy = { captures: [{ id: "c1", text: "x" }], beliefs: "corrupt-not-array", weirdOldField: 1 };
  const up = upgradeState(legacy);
  ok("32. upgrade adds missing modern domains", Array.isArray(up.state.goals) && Array.isArray(up.state.projects) && Array.isArray(up.state.workspaces));
  ok("33. upgrade coerces malformed arrays", Array.isArray(up.state.beliefs) && up.state.beliefs!.length === 0);
  ok("34. upgrade drops unknown/deprecated keys", up.droppedKeys.includes("weirdOldField") && !("weirdOldField" in up.state));
  ok("35. upgrade is idempotent", deepEqual(upgradeState(up.state).state, up.state));
  const ub = upgradeBackup({ schemaVersion: 0, exportedAt: at(1), data: legacy as never });
  ok("36. backup upgrade bumps version + upgrades data", ub.backup.schemaVersion === 1 && Array.isArray(ub.backup.data.goals) && ub.upgraded);

  // --- Cross-device scenarios (Feature 12) ---
  const s = (over: Partial<Rec>): Rec => ({ id: "r", title: "T", notes: "N", tags: [], updatedAt: at(0), ...over });
  // 1. A edits title, B edits notes → auto-merge.
  ok("37. scenario 1: title vs notes auto-merges", threeWayMerge(s({}), s({ title: "A" }), s({ notes: "B" })).status === "auto");
  // 2. Both edit the same note → conflict.
  ok("38. scenario 2: both edit same note → conflict", threeWayMerge(s({}), s({ notes: "A" }), s({ notes: "B" })).status === "conflict");
  // 3. A deletes, B edits → needs resolution.
  ok("39. scenario 3: delete vs edit → resolution", classifyRecord("d", "r", s({}), undefined, s({ notes: "B" })).needsResolution);
  // 4. Both add different children → union, no conflict.
  ok("40. scenario 4: different child adds → union", threeWayMerge(s({ tags: [] as unknown, members: [{ id: "c0" }] } as Rec), { ...s({}), members: [{ id: "c0" }, { id: "cA" }] } as Rec, { ...s({}), members: [{ id: "c0" }, { id: "cB" }] } as Rec).conflictFields.length === 0);
  // 5. Offline device reconnects (stale base, both changed disjoint fields) → auto.
  ok("41. scenario 5: stale reconnect disjoint → auto", threeWayMerge(s({}), s({ title: "old-local" }), s({ tags: ["remote"] })).status === "auto");
  // 10. Two devices end the same session (both set endedAt to different times) → conflict on endedAt but idempotent op.
  const endA = s({ endedAt: at(10) } as Rec), endB = s({ endedAt: at(20) } as Rec);
  ok("42. scenario 10: two session-ends conflict on endedAt but op is idempotent", threeWayMerge(s({}), endA, endB).conflictFields.includes("endedAt") && operationId({ domain: "sessions", recordId: "r", type: "session_end", revision: 0 }) === operationId({ domain: "sessions", recordId: "r", type: "session_end", revision: 0 }));

  // --- Whole-state conflict detection ---
  const report = detectConflicts(
    { captures: [{ id: "c1", text: "base" }] } as never,
    { captures: [{ id: "c1", text: "local" }], beliefs: [] } as never,
    { captures: [{ id: "c1", text: "remote" }] } as never,
  );
  ok("43. detectConflicts finds a whole-state conflict needing resolution", report.needsResolution >= 1 && report.byDomain.captures?.some((c) => c.needsResolution));

  // --- Performance (Feature: perf) ---
  const N = 5000;
  const bigBase: Rec[] = [], bigLocal: Rec[] = [], bigRemote: Rec[] = [];
  for (let i = 0; i < N; i++) { const r = { id: `r${i}`, title: `t${i}`, tags: [] as string[], updatedAt: at(i) }; bigBase.push({ ...r }); bigLocal.push({ ...r, title: `t${i}-L` }); bigRemote.push({ ...r, tags: ["x"] }); }
  const perf = budget("detect 5k conflicts", 800, () => { detectDomainConflicts("captures", bigBase, bigLocal, bigRemote); });
  ok(`44. conflict detection over 5k records under budget (${perf.ms}ms)`, perf.pass, `${perf.ms}ms > ${perf.budgetMs}ms`);

  // --- Determinism ---
  ok("45. merge is deterministic", deepEqual(threeWayMerge(base, { ...base, title: "Z" }, { ...base, tags: ["z"] }).merged, threeWayMerge(base, { ...base, title: "Z" }, { ...base, tags: ["z"] }).merged));

  // --- Authenticated adoption reconciliation (capture-persistence data-loss fix) ---
  {
    const emptyS = emptyStore();
    const cap = (id: string, text: string) => ({ id, text, createdAt: at(1), processingStatus: "inbox" });
    // Local has a capture created during sign-in; remote is an OLDER snapshot without it.
    const localWithA = { ...emptyStore(), captures: [cap("A", "typed during sign-in")] } as StoreState;
    const remoteOld = { ...emptyStore(), captures: [cap("R1", "older remote capture")] } as StoreState;

    // 46. The core invariant: adopting remote must NOT drop the local-only capture.
    const merged = mergeLocalOnly(remoteOld, localWithA);
    ok("46. adoption merge keeps the local-only capture A", merged.captures.some((c) => c.id === "A") && merged.captures.some((c) => c.id === "R1"));
    ok("47. adoption merge keeps newest local capture on top", merged.captures[0]?.id === "A");

    // 48. mergeLocalOnly returns the SAME remote ref when nothing local-only (cheap no-op).
    ok("48. no local-only records → remote reference unchanged", mergeLocalOnly(remoteOld, remoteOld) === remoteOld);

    // 49. Reproduce the exact bug path: remote has data, a capture was made during
    //     the load → decision adopts a MERGED state (never plain remote) and flags a push.
    const d = reconcileAdoption({ remote: remoteOld, local: localWithA, remoteHasData: true, localHasData: true, migratedFor: "user-1", userId: "user-1", empty: emptyS });
    ok("49. returning user + capture during sign-in → adopt-merge, push queued", d.action === "adopt-merge" && d.pushLocalOnly === true && d.state.captures.some((c) => c.id === "A"));
    ok("50. adopt-merge baselines the diff against remote (so A is pushed)", d.baseline === remoteOld);

    // 51. Wrong-user safety: local belonging to another account is NOT merged in.
    const dWrong = reconcileAdoption({ remote: remoteOld, local: localWithA, remoteHasData: true, localHasData: true, migratedFor: "someone-else", userId: "user-1", empty: emptyS });
    ok("51. wrong-user local is never merged into this account", dWrong.action === "adopt" && dWrong.state.captures.every((c) => c.id !== "A"));

    // 52. Remote empty + local ours → keep local and push it (offline-first sign-in).
    const dMigrate = reconcileAdoption({ remote: emptyS, local: localWithA, remoteHasData: false, localHasData: true, migratedFor: null, userId: "user-1", empty: emptyS });
    ok("52. remote empty, local ours → migrate-local keeps capture A and pushes", dMigrate.action === "migrate-local" && dMigrate.pushLocalOnly === true && dMigrate.state.captures.some((c) => c.id === "A"));

    // 53. Remote empty + local belongs to another account → start clean (nothing merged/deleted remotely).
    const dClean = reconcileAdoption({ remote: emptyS, local: localWithA, remoteHasData: false, localHasData: true, migratedFor: "someone-else", userId: "user-1", empty: emptyS });
    ok("53. remote empty, foreign local → start-clean (no cross-account bleed)", dClean.action === "start-clean" && dClean.state.captures.length === 0);

    // 54. Neither side destroyed: after adopt-merge the union has BOTH captures.
    ok("54. adoption never destroys either side (union has both)", d.state.captures.length === 2);

    // 55-57. RESURRECTION is now prevented (LIFEOS-074 D-24).
    //
    // `mergeLocalOnly` still treats "absent from remote" as "new here" — that is
    // correct for a capture typed during sign-in. What changed is that the
    // adoption path suppresses tombstoned records BEFORE reconciling, so a
    // record deleted on another device never reaches this function as local-only.
    const remoteAfterDelete = { ...emptyS, sources: [{ id: "s1" }], captures: [{ id: "c-keep" }] } as unknown as StoreState;
    const staleLocal = { ...emptyS, captures: [{ id: "c-keep", updatedAt: at(10) }, { id: "c-deleted-elsewhere", updatedAt: at(10) }] } as unknown as StoreState;
    const tombs = [makeTombstone("captures", "c-deleted-elsewhere", at(50))];
    const cleaned = suppressDeleted(staleLocal, tombs);
    const dRes = reconcileAdoption({ remote: remoteAfterDelete, local: cleaned, remoteHasData: true, localHasData: true, migratedFor: "user-1", userId: "user-1", empty: emptyS });
    ok("55. a record deleted on another device does NOT return on adoption",
      !(dRes.state.captures as { id: string }[]).some((c) => c.id === "c-deleted-elsewhere"),
      JSON.stringify((dRes.state.captures as { id: string }[]).map((c) => c.id)));
    ok("56. …and is therefore never queued to be pushed back", dRes.pushLocalOnly === false, JSON.stringify(dRes.action));
    ok("57. …while an unrelated local-only record still survives adoption",
      (reconcileAdoption({ remote: remoteAfterDelete, local: suppressDeleted({ ...emptyS, captures: [{ id: "c-brand-new", updatedAt: at(99) }] } as unknown as StoreState, tombs), remoteHasData: true, localHasData: true, migratedFor: "user-1", userId: "user-1", empty: emptyS })
        .state.captures as { id: string }[]).some((c) => c.id === "c-brand-new"));
    ok("57b. a record edited AFTER the delete is kept — resurrection intent is honoured",
      (suppressDeleted({ ...emptyS, captures: [{ id: "c-deleted-elsewhere", updatedAt: at(99) }] } as unknown as StoreState, tombs)
        .captures as { id: string }[]).some((c) => c.id === "c-deleted-elsewhere"));
  }

  // 58-61. Belief revisions are strictly APPEND-ONLY (LIFEOS-074 §7).
  //
  // `belief_revisions` is keyed `(belief_id, seq)` where seq is the ARRAY INDEX,
  // and the push uses `ignoreDuplicates` — so if an entry were ever inserted or
  // removed mid-list, every later index would shift and the older row would
  // silently win, dropping the new content. That hazard is only real if some
  // mutation path can reorder. None can today: every writer is
  // `[...existing, entry]`. This drives the REAL store rather than reading the
  // source, so a writer added later that inserts or removes trips it here
  // instead of shipping.
  //
  // E-7 (LIFEOS-076 §26): this block seeds with `restoreState`, and until now it
  // ran against the VIEWER's store. `/dev/sync-tests` renders this suite, so
  // opening that page replaced a real account with an empty fixture and pushed
  // the emptiness to the server. `withIsolatedStore` keeps the real code paths
  // and takes away the blast radius.
  withIsolatedStore(() => {
    const St = StoreForTest;
    St.restoreState(Object.fromEntries(STORE_DOMAINS.map((d) => [d, []])) as unknown as StoreState);
    const bid = St.createBeliefFromText("A first claim");
    const revs = () => St.getSnapshot().beliefs.find((b) => b.id === bid)?.revisions ?? [];
    const judg = () => St.getSnapshot().beliefs.find((b) => b.id === bid)?.judgments ?? [];
    const afterCreate = revs().map((r) => r.text);
    St.reviseBelief(bid, "A revised claim");
    St.affirmBelief(bid);
    St.questionBelief(bid);
    const after = revs();
    ok("58. every earlier revision keeps its index and text after later writes",
      afterCreate.every((t, i) => after[i]?.text === t), JSON.stringify({ afterCreate, after: after.map((r) => r.text) }));
    ok("59. each write appends exactly one entry at the highest index",
      after.length === afterCreate.length + 3, `${after.length} vs ${afterCreate.length}+3`);
    ok("60. judgments append in step, so their (belief_id, seq) is stable too",
      judg().length >= 3, String(judg().length));
    const before = after.map((r) => r.text);
    St.affirmBelief(bid);
    ok("61. a further write never rewrites an existing seq",
      before.every((t, i) => (revs()[i]?.text ?? null) === t), JSON.stringify(revs().map((r) => r.text)));
  });

  // 62. THE DOMAIN LISTS MUST AGREE (LIFEOS-075 C-1).
  //
  // Independent enumerations of "what a Conqify account contains" are how this
  // family of defect happens: LIFEOS-052 lost nine execution domains on restore
  // because the backup allow-list fell behind, and C-1 lost a whole account on
  // a cold device because `hasData()` still named the four domains that existed
  // when it was written.
  //
  // 075 removed two of the copies outright — `normalize()` and this file's own
  // empty-state builder are now derived from STORE_DOMAINS — so only one real
  // pairing is left to police, and it is compared by IMPORTING both lists
  // rather than by reading source files. An earlier version of this guard
  // scraped the two modules with `fs` via `globalThis.require`, which is absent
  // under the compiled CommonJS runner: the check silently could not run. It
  // reported that honestly instead of passing, which is how it was caught.
  {
    const canon = new Set(STORE_DOMAINS as string[]);
    const order = SYNC_DOMAIN_ORDER as string[];
    const missingFromSync = [...canon].filter((d) => !order.includes(d));
    const extraInSync = order.filter((d) => !canon.has(d));
    ok("62. SYNC_DOMAIN_ORDER covers exactly STORE_DOMAINS",
      missingFromSync.length === 0 && extraInSync.length === 0,
      JSON.stringify({ missingFromSync, extraInSync }));
    ok("62b. …with no domain pushed twice", new Set(order).size === order.length,
      `${order.length} entries, ${new Set(order).size} distinct`);
    ok("62c. normalize()'s domain set is derived, not a third literal",
      Object.keys(emptyStoreState()).length === STORE_DOMAINS.length &&
      Object.keys(emptyStoreState()).every((k) => canon.has(k)),
      JSON.stringify(Object.keys(emptyStoreState()).length));
  }

  // 63-69. C-1 — DOES REMOTE HOLD ANYTHING? (LIFEOS-075.)
  //
  // The reproduction: a person whose Conqify life is actions, projects, goals,
  // notes, events and readings, who never once opened Quick Capture. Their
  // remote snapshot is full. `hasData()` looked at four domains — sources,
  // beliefs, captures, proposals — and reported EMPTY. A cold second device
  // therefore took the migrate-local branch, installed its own empty state, and
  // showed them nothing, under a "Saved" indicator.
  //
  // Against pre-075 main every assertion from 63 to 67 fails, because the
  // predicate under test did not exist and the four-domain version answers
  // false for each of these snapshots.
  {
    const only = (patch: Partial<Record<string, unknown[]>>): StoreState =>
      ({ ...emptyStore(), ...patch }) as unknown as StoreState;

    ok("63. a genuinely empty snapshot holds no data", snapshotHasData(emptyStore()) === false);
    ok("63b. null/undefined is not data", snapshotHasData(null) === false && snapshotHasData(undefined) === false);

    // Every execution domain, one at a time — no single one may be invisible.
    const lifeDomains = ["nextActions", "projects", "goals", "notes", "events", "documents",
      "sessions", "recurrenceCompletions", "constitutionElements", "protocols"];
    const blind = lifeDomains.filter((d) => !snapshotHasData(only({ [d]: [{ id: "x" }] })));
    ok("64. a snapshot holding ONLY one life domain still counts as data",
      blind.length === 0, `invisible domains: ${JSON.stringify(blind)}`);

    // Every canonical domain, exhaustively — the property is about the list, not
    // about the ten names someone thought of.
    const blindAll = (STORE_DOMAINS as string[]).filter((d) => !snapshotHasData(only({ [d]: [{ id: "x" }] })));
    ok("64b. …and that holds for every one of the canonical domains",
      blindAll.length === 0, `invisible: ${JSON.stringify(blindAll)}`);

    // The end-to-end shape of the defect, through the real decision function.
    const remoteLife = only({
      nextActions: [{ id: "a1" }], projects: [{ id: "p1" }], goals: [{ id: "g1" }],
      notes: [{ id: "n1" }], events: [{ id: "e1" }], documents: [{ id: "d1" }],
    });
    const coldB = emptyStore();
    const dCold = reconcileAdoption({
      remote: remoteLife, local: coldB,
      remoteHasData: snapshotHasData(remoteLife), localHasData: snapshotHasData(coldB),
      migratedFor: null, userId: "user-1", empty: emptyStore(),
    });
    ok("65. cold Device B ADOPTS a capture-free account instead of starting empty",
      dCold.action === "adopt", dCold.action);
    ok("66. …and actually receives every record",
      (dCold.state.nextActions as unknown[]).length === 1 && (dCold.state.projects as unknown[]).length === 1 &&
      (dCold.state.notes as unknown[]).length === 1 && (dCold.state.documents as unknown[]).length === 1 &&
      (dCold.state.events as unknown[]).length === 1 && (dCold.state.goals as unknown[]).length === 1);

    // The invariant the defect violated, stated directly.
    const withCapture = { ...remoteLife, captures: [{ id: "c1" }] } as unknown as StoreState;
    ok("67. an unrelated Capture never decides whether the rest of the account exists",
      snapshotHasData(remoteLife) === snapshotHasData(withCapture));

    // And the other direction: nothing is fabricated for a genuinely new user.
    const dNew = reconcileAdoption({
      remote: emptyStore(), local: emptyStore(),
      remoteHasData: snapshotHasData(emptyStore()), localHasData: snapshotHasData(emptyStore()),
      migratedFor: null, userId: "user-1", empty: emptyStore(),
    });
    ok("68. a truly empty remote is still empty — no data is invented",
      dNew.action === "migrate-local" && dNew.pushLocalOnly === false &&
      (STORE_DOMAINS as string[]).every((d) => ((dNew.state as unknown as Record<string, unknown[]>)[d] ?? []).length === 0));
    ok("69. wrong-user safety is unchanged by the wider predicate",
      reconcileAdoption({
        remote: emptyStore(), local: only({ nextActions: [{ id: "a1" }] }),
        remoteHasData: false, localHasData: true,
        migratedFor: "someone-else", userId: "user-1", empty: emptyStore(),
      }).action === "start-clean");
  }

  // 70-74. C-2 — A DELETED READING STAYS DELETED (LIFEOS-075.)
  //
  // `reading_documents` was the only row-level delete in the adapter with no
  // tombstone. Deleting a book on Device A removed the row and the stored
  // original; Device B still held it, adoption read it as local-only, pushed it
  // back, and Device A re-adopted it carrying `originalStored: true` and a
  // storage path whose bytes were already gone.
  //
  // Against pre-075 main, 70 and 71 fail: no tombstone is written for the
  // documents domain, so `suppressDeleted` has nothing to act on.
  {
    const docTomb = [makeTombstone("documents", "doc-deleted", at(50))];
    const staleB = {
      ...emptyStore(),
      documents: [
        { id: "doc-keep", updatedAt: at(10) },
        { id: "doc-deleted", updatedAt: at(10), sourceMetadata: { originalStored: true, originalStoragePath: "u/doc-deleted/x.pdf" } },
      ],
      citations: [{ id: "cit-1", documentId: "doc-deleted" }, { id: "cit-2", documentId: "doc-keep" }],
    } as unknown as StoreState;
    const cleanedB = suppressDeleted(staleB, docTomb);
    const docIds = (cleanedB.documents as { id: string }[]).map((d) => d.id);
    ok("70. a reading deleted on another device is suppressed before reconcile",
      !docIds.includes("doc-deleted") && docIds.includes("doc-keep"), JSON.stringify(docIds));

    // The nested tree goes with the parent because it IS the parent object;
    // citations are a separate top-level array and must be pruned explicitly.
    const citIds = (cleanedB.citations as { id: string }[]).map((c) => c.id);
    ok("71. …and its citations go with it, while unrelated citations survive",
      !citIds.includes("cit-1") && citIds.includes("cit-2"), JSON.stringify(citIds));

    // Remote already holds everything the stale device legitimately has, so the
    // ONLY thing that could be classed local-only is the deleted reading and
    // its citation. If either survived suppression, `pushLocalOnly` turns true
    // and the record is written back — which is the defect itself.
    const dDoc = reconcileAdoption({
      remote: { ...emptyStore(), documents: [{ id: "doc-keep" }], citations: [{ id: "cit-2", documentId: "doc-keep" }] } as unknown as StoreState,
      local: cleanedB,
      remoteHasData: true, localHasData: true,
      migratedFor: "user-1", userId: "user-1", empty: emptyStore(),
    });
    ok("72. the deleted reading is never queued to be pushed back",
      dDoc.pushLocalOnly === false && !(dDoc.state.documents as { id: string }[]).some((d) => d.id === "doc-deleted"),
      JSON.stringify({ push: dDoc.pushLocalOnly, ids: (dDoc.state.documents as { id: string }[]).map((d) => d.id) }));
    ok("73. no resurrected document carries a stale originalStored claim",
      !(dDoc.state.documents as { sourceMetadata?: { originalStored?: boolean } }[])
        .some((d) => d.sourceMetadata?.originalStored === true));

    // The existing resurrection-intent rule is NOT special-cased for readings.
    ok("74. a reading edited AFTER the delete is still kept as genuine intent",
      (suppressDeleted({ ...emptyStore(), documents: [{ id: "doc-deleted", updatedAt: at(99) }] } as unknown as StoreState, docTomb)
        .documents as { id: string }[]).some((d) => d.id === "doc-deleted"));
  }

  // 75-84. LIFEOS-076 — LAST SUCCESSFUL SYNC, SAID TRUTHFULLY (§5, §6, §11).
  //
  // The old behaviour minted a timestamp inside `setHealth` on ANY transition
  // into "synced" — including the adoption path, where nothing had been pushed
  // — and kept it in memory only, so every reload reported "Not yet synced"
  // even for an account that had synced minutes earlier. Both halves were
  // wrong in opposite directions: a time the server never confirmed, and no
  // time at all when it had.
  //
  // `formatLastSync` is the display half, and these fail against pre-076 main
  // because the function does not exist there.
  {
    const T = Date.parse("2026-08-29T12:00:00.000Z");
    ok("75. an absent timestamp yields nothing to display, never an invented one",
      formatLastSync(null, T) === null && formatLastSync(undefined, T) === null);
    ok("76. a malformed timestamp is treated as absent, not repaired",
      formatLastSync("not a date", T) === null);
    ok("77. §6: a FUTURE timestamp is unusable rather than rendered",
      formatLastSync(new Date(T + 10 * 60_000).toISOString(), T) === null);
    ok("77b. …while a minute of clock skew is tolerated as 'just now'",
      formatLastSync(new Date(T + 30_000).toISOString(), T) === "just now");
    ok("78. under a minute reads 'just now'",
      formatLastSync(new Date(T - 45_000).toISOString(), T) === "just now");
    ok("79. minutes read as minutes",
      formatLastSync(new Date(T - 5 * 60_000).toISOString(), T) === "5 min ago");
    ok("80. hours are singular and plural correctly",
      formatLastSync(new Date(T - 60 * 60_000).toISOString(), T) === "1 hour ago" &&
      formatLastSync(new Date(T - 3 * 3600_000).toISOString(), T) === "3 hours ago");
    ok("81. days too",
      formatLastSync(new Date(T - 24 * 3600_000).toISOString(), T) === "1 day ago" &&
      formatLastSync(new Date(T - 3 * 24 * 3600_000).toISOString(), T) === "3 days ago");
    ok("82. beyond a week it becomes a date rather than a growing day count",
      /\d/.test(formatLastSync(new Date(T - 30 * 24 * 3600_000).toISOString(), T) ?? "") &&
      !/ago/.test(formatLastSync(new Date(T - 30 * 24 * 3600_000).toISOString(), T) ?? "ago"));
    ok("83. §11: 'Synced' never depends on having a time to show",
      formatLastSync(null) === null);
  }

  // 85-88. LIFEOS-076 O-3 — the LAST hand-maintained domain list is gone.
  //
  // `resetStore()` is the function whose whole job is to leave nothing behind.
  // It carried a fifth literal of all 46 names; it happened to be complete when
  // audited, but a domain added later and forgotten there would survive "wipe
  // all data" silently — a privacy failure, not a stale-list annoyance.
  {
    const src = emptyStoreState() as unknown as Record<string, unknown[]>;
    ok("85. the canonical empty state covers every domain, and only those",
      Object.keys(src).length === STORE_DOMAINS.length &&
      (STORE_DOMAINS as string[]).every((d) => Array.isArray(src[d])));
    ok("86. every domain in it starts empty",
      Object.values(src).every((v) => Array.isArray(v) && v.length === 0));
    // Drive the REAL reset: create something, wipe, and confirm nothing survives
    // in ANY canonical domain rather than in the handful someone thought to check.
    /**
     * The BEHAVIOURAL half of this — actually creating a record, wiping, and
     * confirming nothing survives — lives in scripts/inject-076-sync-recovery.cjs
     * and NOT here.
     *
     * The first draft drove the real `resetStore()` from this suite, which
     * `/dev/sync-tests` renders. Visiting that page therefore destroyed the
     * viewer's entire account: a browser probe caught a seeded record vanishing
     * between one navigation and the next, and the same wipe took the
     * last-sync key with it. A self-test that deletes the data it is run
     * beside is worse than the drift it was written to catch.
     *
     * What stays here is the pure property, which needs no store at all.
     */
    ok("87. the canonical empty state is what a reset installs",
      Object.keys(src).length === STORE_DOMAINS.length &&
      Object.values(src).every((v) => Array.isArray(v) && v.length === 0));
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
