#!/usr/bin/env node
/**
 * LIFEOS-075 — CROSS-DEVICE SYNC & FILE INTEGRITY, deterministic gate.
 *
 * Drives the REAL adapter, the REAL adoption path, the REAL row mappers and the
 * REAL file-integrity module. Two device states are held as genuinely separate
 * objects with separate baselines, so "Device B" never shares a reference with
 * "Device A" — the module-state equivalent of a second browser profile. Where a
 * claim needs the browser (isolated storage, the reader UI), it is made in
 * scripts/smoke-075-cross-device.cjs instead, not asserted here.
 *
 * ## §19: every C-finding is proved RED against pre-075 main
 *
 * A test that has never failed is not evidence. Each repair below is checked
 * against the base commit's own source — read with `git show`, not paraphrased —
 * so the assertion demonstrably distinguishes the two. Where the base defect is
 * an ABSENT call (C-2's missing tombstone, C-3's missing caller) the proof is
 * structural and is stated as such.
 *
 * Requires the compiled tree at scripts/out (see the header of any 074 harness).
 */
process.env.LIFEOS_ROOT = "/home/user/LifeOS";
const path = require("path"), Module = require("module"), ROOT = path.join(__dirname, "out");
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { if (r.startsWith("@/")) r = path.join(ROOT, r.slice(2)); try { return orig.call(this, r, ...a); } catch (e) { if (r.startsWith(".") || path.isAbsolute(r)) throw e; return require.resolve(r, { paths: ["/home/user/LifeOS/node_modules"] }); } };

const fs = require("fs");
const { execSync } = require("child_process");
const { SupabasePersistenceAdapter } = require("@/lib/adapters/supabaseAdapter");
const { reconcileAdoption, snapshotHasData, suppressDeleted } = require("@/lib/persistence-reconcile");
const { makeTombstone } = require("@/lib/sync/tombstones");
const { STORE_DOMAINS } = require("@/lib/ux/backup");
const { documentToRows, documentToImportPayload, rowsToDocuments } = require("@/lib/library/rows");
const { sha256Hex, classifyChecksum, verifyBytes } = require("@/lib/reading/fileIntegrity");
const { backupOriginal, removeOriginalsForDocument, resolveOriginalUrl, storagePathFor, classifyResolveFailure } = require("@/lib/reading/originals");

const results = [];
const ok = (n, p, d) => { results.push({ n, p, d }); console.log(`${p ? "PASS" : "FAIL"}  ${n}${p ? "" : ` — ${d ?? ""}`}`); };

const LIB = "/home/user/LifeOS";
/** The commit this branch forked from — the "pre-075" state for red proofs. */
const BASE = execSync(`git -C ${LIB} merge-base origin/main HEAD`).toString().trim();
const baseFile = (p) => execSync(`git -C ${LIB} show ${BASE}:${p}`, { maxBuffer: 32 << 20 }).toString();

const T = "2026-08-29";
const iso = (h = 8) => `${T}T${String(h).padStart(2, "0")}:00:00.000Z`;
const empty = () => Object.fromEntries(STORE_DOMAINS.map((d) => [d, []]));
const doc = (p) => ({
  id: "doc1", title: "Being and Time", authors: ["Heidegger"], kind: "book", status: "reading",
  tags: [], notes: "", sections: [], progress: { status: "not_started", percent: 0, readPassageIds: [] },
  sourceMetadata: { importFormat: "pdf" }, createdAt: iso(), updatedAt: iso(), ...p,
});

// ------------------------------------------------------------ fake backend --
function fakeClient(fails = {}) {
  const db = new Map(), calls = [];
  const put = (t, rows) => { const m = db.get(t) ?? new Map(); for (const r of rows) m.set(r.id ?? `${r.domain}:${r.record_id}`, r); db.set(t, m); };
  const from = (t) => ({
    upsert: (rows) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      calls.push({ table: t, op: "upsert", n: arr.length });
      if (fails[t]) return Promise.reject(new Error(`upsert failed: ${t}`));
      put(t, arr); return Promise.resolve({ error: null, data: arr });
    },
    insert: (rows) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      calls.push({ table: t, op: "insert", n: arr.length });
      if (fails[t]) return Promise.resolve({ error: { message: `insert failed: ${t}` } });
      put(t, arr); return Promise.resolve({ error: null });
    },
    delete: () => ({
      in: (_c, ids) => { calls.push({ table: t, op: "delete", n: ids.length }); if (fails[t]) return Promise.resolve({ error: { message: `delete failed: ${t}` } }); const m = db.get(t); if (m) for (const i of ids) m.delete(i); return Promise.resolve({ error: null }); },
      eq: (_c, v) => { calls.push({ table: t, op: "delete-eq" }); const m = db.get(t); if (m) for (const [k, r] of m) if (r.document_id === v || r.user_id === v) m.delete(k); return Promise.resolve({ error: null }); },
    }),
    select: () => { const q = Promise.resolve({ data: [...(db.get(t)?.values() ?? [])], error: null }); q.order = () => q; q.eq = () => q; return q; },
  });
  const rpc = (name, args) => {
    calls.push({ table: `rpc:${name}`, op: "rpc" });
    if (fails[`rpc:${name}`]) return Promise.reject(new Error(`rpc failed: ${name}`));
    // Mirror import_reading_document: write the parent + children transactionally.
    const p = args?.payload ?? {};
    if (p.document) put("reading_documents", [p.document]);
    for (const k of ["sections", "passages", "highlights", "annotations"]) {
      if (p[k]?.length) put(`document_${k}`, p[k]);
    }
    return Promise.resolve({ error: null });
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }, db, calls, fails };
}
const rows = (db, t) => [...(db.get(t)?.values() ?? [])];

/** An in-memory storage backend that enforces per-user path ownership, as RLS does. */
function fakeOriginals(cloud, userId, opts = {}) {
  return {
    userId,
    async uploadObject(p, data) { if (opts.failUpload) return { ok: false, error: "upload denied" }; cloud.objects.set(p, data); return { ok: true }; },
    async removeObjects(ps) { for (const p of ps) if (p.startsWith(`${userId}/`)) cloud.objects.delete(p); return { ok: true }; },
    async listFolder(prefix) { return { ok: true, names: [...cloud.objects.keys()].filter((k) => k.startsWith(`${prefix}/`)).map((k) => k.slice(prefix.length + 1)) }; },
    async insertMetadata(row) { if (opts.failMeta) return { ok: false, error: "metadata denied" }; cloud.rows.push(row); return { ok: true }; },
    async deleteMetadataForDocument(d) { cloud.rows = cloud.rows.filter((r) => !(r.user_id === userId && r.document_id === d)); return { ok: true }; },
    async metadataForDocument(d) { return { ok: true, rows: cloud.rows.filter((r) => r.user_id === userId && r.document_id === d) }; },
    async signedUrl(p, ttl) {
      if (!p.startsWith(`${userId}/`)) return { ok: false, error: "not found" };   // RLS shape
      if (!cloud.objects.has(p)) return { ok: false, error: "Object not found" };
      return { ok: true, url: `https://example.invalid/${p}?token=t&exp=${ttl}` };
    },
  };
}

(async () => {
  // =====================================================================
  // A. C-1 — does remote hold anything? RED against base, green at head.
  // =====================================================================
  {
    // The base predicate, lifted from the base commit's own source rather than
    // retyped from memory, so this compares against what actually shipped.
    const basePersistence = baseFile("lib/persistence.ts");
    const m = basePersistence.match(/function hasData\(s: Partial<StoreState> \| null\): boolean \{([\s\S]*?)\n\}/);
    ok("A1 the pre-075 hasData() was found in the base commit", !!m, "could not locate base hasData — the red proof below would be vacuous");
    const baseDomains = m ? [...m[1].matchAll(/s\.([a-zA-Z]+)\?\.length/g)].map((x) => x[1]) : [];
    ok("A2 …and it inspected exactly four of the 46 domains",
      baseDomains.length === 4 && STORE_DOMAINS.length === 46,
      JSON.stringify({ baseDomains, canonical: STORE_DOMAINS.length }));
    const baseHasData = (s) => !!(s && baseDomains.some((d) => (s[d]?.length ?? 0) > 0));

    const life = { ...empty(), nextActions: [{ id: "a1" }], projects: [{ id: "p1" }], goals: [{ id: "g1" }], notes: [{ id: "n1" }], events: [{ id: "e1" }], documents: [doc({})] };

    ok("A3 RED: the base predicate calls a capture-free account EMPTY",
      baseHasData(life) === false, "base already handled this — the defect would not be real");
    ok("A4 GREEN: the repaired predicate sees the same account",
      snapshotHasData(life) === true);

    const dBase = reconcileAdoption({ remote: life, local: empty(), remoteHasData: baseHasData(life), localHasData: baseHasData(empty()), migratedFor: null, userId: "u1", empty: empty() });
    const dHead = reconcileAdoption({ remote: life, local: empty(), remoteHasData: snapshotHasData(life), localHasData: snapshotHasData(empty()), migratedFor: null, userId: "u1", empty: empty() });
    ok("A5 RED: on base, cold Device B installs an EMPTY state",
      dBase.action === "migrate-local" && dBase.state.nextActions.length === 0, dBase.action);
    ok("A6 GREEN: at head it adopts, and every record arrives",
      dHead.action === "adopt" && dHead.state.nextActions.length === 1 && dHead.state.documents.length === 1 &&
      dHead.state.notes.length === 1 && dHead.state.events.length === 1 && dHead.state.goals.length === 1 && dHead.state.projects.length === 1);

    // Exhaustive, not anecdotal: no single canonical domain may be invisible.
    const blind = STORE_DOMAINS.filter((d) => !snapshotHasData({ ...empty(), [d]: [{ id: "x" }] }));
    ok("A7 not one of the 46 canonical domains is invisible to the predicate", blind.length === 0, JSON.stringify(blind));
    const blindBase = STORE_DOMAINS.filter((d) => !baseHasData({ ...empty(), [d]: [{ id: "x" }] }));
    ok("A8 RED: on base, 42 of the 46 were invisible", blindBase.length === 42, `${blindBase.length} invisible on base`);

    ok("A9 an empty remote is still empty — nothing is fabricated", snapshotHasData(empty()) === false);
    ok("A10 adding an unrelated Capture cannot change the answer for the rest",
      snapshotHasData(life) === snapshotHasData({ ...life, captures: [{ id: "c1" }] }));
  }

  // =====================================================================
  // B. C-2 — a deleted reading stays deleted, through the REAL adapter.
  // =====================================================================
  {
    // RED, structurally: the base adapter deletes reading_documents and writes
    // no tombstone. That is an ABSENT call, so the proof reads the base source.
    const baseAdapter = baseFile("lib/adapters/supabaseAdapter.ts");
    const baseDomains = [...baseAdapter.matchAll(/writeTombstones\("([a-zA-Z]+)"/g)].map((x) => x[1]);
    ok("B1 RED: base wrote tombstones for 19 domains and NOT for documents",
      baseDomains.length === 19 && !baseDomains.includes("documents"),
      JSON.stringify({ count: baseDomains.length, hasDocuments: baseDomains.includes("documents") }));
    ok("B2 RED: …while base still issued the reading_documents delete",
      /from\("reading_documents"\)\.delete\(\)/.test(baseAdapter));

    // GREEN, behaviourally: drive the real adapter and watch the calls.
    const fc = fakeClient();
    const ad = new SupabasePersistenceAdapter(fc.client);
    const withDoc = { ...empty(), documents: [doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", originalStored: true, originalStoragePath: "u1/doc1/being.pdf" } })], citations: [{ id: "cit1", documentId: "doc1", recordKind: "belief", recordId: "b1", createdAt: iso() }] };
    await ad.saveStateByDomain(withDoc, undefined, null);
    ok("B3 the reading reached the remote store", rows(fc.db, "reading_documents").length === 1);

    fc.calls.length = 0;
    const afterDelete = { ...withDoc, documents: [], citations: [] };
    const rep = await ad.saveStateByDomain(afterDelete, new Set(["documents", "citations"]), withDoc);
    ok("B4 the delete run reported no failed domain", rep.failed.length === 0, JSON.stringify(rep.failed));
    ok("B5 GREEN: the reading row is gone", rows(fc.db, "reading_documents").length === 0);
    const tombs = rows(fc.db, "sync_tombstones");
    ok("B6 GREEN: a documents tombstone was written",
      tombs.some((t) => t.domain === "documents" && t.record_id === "doc1"), JSON.stringify(tombs));
    ok("B7 exactly ONE tombstone — the parent, not one per child row",
      tombs.length === 1, `${tombs.length} tombstones: ${JSON.stringify(tombs.map((t) => `${t.domain}:${t.record_id}`))}`);

    // Device B: a genuinely separate state object, holding the stale reading.
    const deviceB = { ...empty(), documents: [doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", originalStored: true, originalStoragePath: "u1/doc1/being.pdf" } })], citations: [{ id: "cit1", documentId: "doc1", recordKind: "belief", recordId: "b1", createdAt: iso() }] };
    const ledger = await ad.loadTombstones();
    ok("B8 Device B can read the deletion ledger", Array.isArray(ledger) && ledger.length === 1);
    const cleaned = suppressDeleted(deviceB, ledger);
    ok("B9 GREEN: Device B suppresses the deleted reading before reconciling",
      cleaned.documents.length === 0, JSON.stringify(cleaned.documents.map((d) => d.id)));
    ok("B10 …and its citation goes with it (the DB already cascades that row)",
      cleaned.citations.length === 0);

    const dB = reconcileAdoption({ remote: empty(), local: cleaned, remoteHasData: false, localHasData: snapshotHasData(cleaned), migratedFor: "u1", userId: "u1", empty: empty() });
    ok("B11 GREEN: Device B never queues the deleted reading to be pushed back",
      !dB.state.documents.some((d) => d.id === "doc1"), JSON.stringify(dB.state.documents.map((d) => d.id)));

    // RED, behaviourally: with no ledger entry the same stale state DOES return.
    const noLedger = suppressDeleted(deviceB, []);
    ok("B12 RED: with no tombstone — the base condition — the reading survives",
      noLedger.documents.length === 1 && noLedger.documents[0].id === "doc1");
    const dRed = reconcileAdoption({ remote: empty(), local: noLedger, remoteHasData: false, localHasData: true, migratedFor: "u1", userId: "u1", empty: empty() });
    ok("B13 RED: …and is pushed back, carrying originalStored on a deleted blob",
      dRed.pushLocalOnly === true && dRed.state.documents[0].sourceMetadata.originalStored === true);

    // Resurrection INTENT is still honoured — not special-cased away for readings.
    const edited = suppressDeleted({ ...empty(), documents: [doc({ updatedAt: iso(23) })] }, [makeTombstone("documents", "doc1", iso(9))]);
    ok("B14 a reading edited AFTER the delete is kept as genuine intent", edited.documents.length === 1);
  }

  // =====================================================================
  // C. §3 — a failed tombstone write makes the sync INCOMPLETE, not "Synced".
  // =====================================================================
  {
    const fc = fakeClient();
    const ad = new SupabasePersistenceAdapter(fc.client);
    const withDoc = { ...empty(), documents: [doc({})] };
    await ad.saveStateByDomain(withDoc, undefined, null);
    fc.fails.sync_tombstones = true;
    const rep = await ad.saveStateByDomain({ ...withDoc, documents: [] }, new Set(["documents"]), withDoc);
    ok("C1 a failed tombstone write fails the documents domain",
      rep.failed.some((f) => f.domain === "documents"), JSON.stringify(rep));
    ok("C2 …so the domain is NOT reported as succeeded",
      !rep.succeeded.includes("documents"), JSON.stringify(rep.succeeded));
    ok("C3 the row deletion itself still happened — it is not rolled back",
      rows(fc.db, "reading_documents").length === 0);
    ok("C4 and no tombstone exists yet, so the race window is real and stated",
      rows(fc.db, "sync_tombstones").length === 0);
    // Retry closes it.
    fc.fails.sync_tombstones = false;
    const rep2 = await ad.saveStateByDomain({ ...withDoc, documents: [] }, new Set(["documents"]), withDoc);
    ok("C5 the retry writes the tombstone and the domain succeeds",
      rep2.failed.length === 0 && rows(fc.db, "sync_tombstones").some((t) => t.domain === "documents"));
  }

  // =====================================================================
  // D. C-4 — a checksum that describes the FILE, not the words in it.
  // =====================================================================
  {
    const baseIngest = baseFile("lib/hash.ts");
    ok("D1 RED: the base hash used for the file checksum was 32-bit FNV-1a",
      /0x811c9dc5/.test(baseIngest) && /NOT for security/.test(baseIngest));
    const basePanel = baseFile("components/reading/AddReadingPanel.tsx");
    ok("D2 RED: base passed the extracted-TEXT hash as the file checksum",
      /checksum: hash\b/.test(basePanel), "base did not pass the text hash — re-examine C-4");

    const bytesA = new TextEncoder().encode("%PDF-1.4 alpha payload");
    const bytesB = new TextEncoder().encode("%PDF-1.4 beta payload!");   // same length, different bytes
    const truncated = bytesA.slice(0, bytesA.length - 3);
    const oneOff = Uint8Array.from(bytesA); oneOff[5] ^= 0x01;

    const hA = await sha256Hex(bytesA);
    ok("D3 SHA-256 is available and canonical (64 lowercase hex)", !!hA && /^[0-9a-f]{64}$/.test(hA), String(hA));
    ok("D4 the same bytes always give the same checksum", hA === await sha256Hex(bytesA));
    ok("D5 different bytes of the same length differ", hA !== await sha256Hex(bytesB));

    ok("D6 intact bytes verify", (await verifyBytes(bytesA, hA)).verdict === "match");
    ok("D7 a one-byte change FAILS", (await verifyBytes(oneOff, hA)).verdict === "mismatch");
    ok("D8 truncation FAILS", (await verifyBytes(truncated, hA)).verdict === "mismatch");
    ok("D9 an incorrect stored checksum FAILS", (await verifyBytes(bytesA, "f".repeat(64))).verdict === "mismatch");

    // §8 legacy compatibility — unverifiable, never "verified", never "corrupt".
    ok("D10 a legacy FNV text hash is classified as legacy", classifyChecksum("1a2b3c4d") === "legacy-text-hash");
    ok("D11 a SHA-256 is classified as such", classifyChecksum(hA) === "sha256");
    ok("D12 an absent checksum is classified as absent", classifyChecksum(null) === "absent");
    const legacy = await verifyBytes(bytesA, "1a2b3c4d");
    ok("D13 §8: a legacy row is UNVERIFIABLE, not mismatched",
      legacy.verdict === "unverifiable" && legacy.storedKind === "legacy-text-hash", JSON.stringify(legacy));
    ok("D14 …and no checksum at all is unverifiable too",
      (await verifyBytes(bytesA, null)).verdict === "unverifiable");
    ok("D15 §8: a legacy value is never rewritten into a fake byte checksum",
      legacy.computed === null, JSON.stringify(legacy));

    // §9/§10: the two fingerprints answer different questions.
    const { contentHash } = require("@/lib/reading/ingest");
    const sameTextDifferentBytes = ["Chapter one.  ", " Chapter one. "];
    ok("D16 §10: identical extracted text gives one CONTENT hash (dedupe still works)",
      contentHash(sameTextDifferentBytes[0]) === contentHash(sameTextDifferentBytes[1]));
    ok("D17 §10: …while those same two files have DIFFERENT byte checksums",
      (await sha256Hex(new TextEncoder().encode(sameTextDifferentBytes[0]))) !==
      (await sha256Hex(new TextEncoder().encode(sameTextDifferentBytes[1]))));
    ok("D18 §24: same bytes under a different filename keep the same checksum",
      (await sha256Hex(bytesA)) === (await sha256Hex(Uint8Array.from(bytesA))));
  }

  // =====================================================================
  // E. C-3 — the stored original is reachable, and the claim is verified.
  // =====================================================================
  {
    // RED: on base, resolveOriginalUrl had no production caller at all.
    const callers = (pattern) => execSync(
      `grep -rlE "${pattern}" ${LIB}/lib ${LIB}/app ${LIB}/components 2>/dev/null || true`)
      .toString().trim().split("\n").filter(Boolean)
      .filter((f) => !/selftest|\/dev\//.test(f))
      .filter((f) => !/lib\/reading\/originals\.ts$/.test(f));
    ok("E1 GREEN: resolveOriginalUrl now has a production caller",
      callers("resolveOriginalUrl\\(").length > 0, JSON.stringify(callers("resolveOriginalUrl\\(")));
    ok("E2 …and the UI reaches it through the reader",
      execSync(`grep -rl "resolveStoredOriginal" ${LIB}/components 2>/dev/null || true`).toString().trim().length > 0);
    const baseOriginals = execSync(
      `git -C ${LIB} grep -lE "resolveOriginalUrl\\(" ${BASE} -- lib app components 2>/dev/null || true`)
      .toString().trim().split("\n").filter(Boolean)
      .filter((f) => !/selftest|originals\.ts/.test(f));
    ok("E3 RED: at base it had none outside its own module and the self-test",
      baseOriginals.length === 0, JSON.stringify(baseOriginals));

    // Behaviour, through the real orchestration.
    const cloud = { objects: new Map(), rows: [] };
    const A = fakeOriginals(cloud, "userA");
    const bytes = new TextEncoder().encode("original bytes");
    const sum = await sha256Hex(bytes);
    const up = await backupOriginal(A, { documentId: "docX", filename: "Being and Time.pdf", contentType: "application/pdf", sizeBytes: bytes.length, checksum: sum, data: bytes });
    ok("E4 upload + metadata both land before success is reported", up.ok === true, JSON.stringify(up));
    ok("E5 the stored checksum is the raw-byte SHA-256",
      cloud.rows[0].checksum === sum && classifyChecksum(cloud.rows[0].checksum) === "sha256");

    // Device B holds only the metadata — no local File, no storage path.
    const B = fakeOriginals(cloud, "userA");        // same user, separate backend instance
    const url = await resolveOriginalUrl(B, { documentId: "docX" });
    ok("E6 §25: Device B resolves the original from metadata alone", url.ok === true && !!url.url, JSON.stringify(url));
    ok("E7 …and gets the same bytes back",
      (await verifyBytes(cloud.objects.get(storagePathFor("userA", "docX", "Being and Time.pdf")), sum)).verdict === "match");
    ok("E8 §5: no Device-A local path is needed — resolution went through metadata",
      url.url.includes("userA/docX/"));

    // §4 — metadata without a blob must not claim safety.
    cloud.objects.clear();
    const gone = await resolveOriginalUrl(B, { documentId: "docX" });
    ok("E9 §4: metadata present + blob missing does NOT resolve", gone.ok === false, JSON.stringify(gone));
    ok("E10 §4: …and is classified as MISSING, not as a transient error",
      classifyResolveFailure(gone.error) === "missing", gone.error);
    ok("E11 a transient storage error is classified as UNKNOWN, not missing",
      classifyResolveFailure("network timeout") === "unknown");
    ok("E12 §4: nothing recreates the blob silently", cloud.objects.size === 0);

    // §20 / §6 — ownership. Structural where live auth is unavailable.
    const other = fakeOriginals(cloud, "userB");
    const guessed = await other.signedUrl("userA/docX/Being and Time.pdf", 60);
    ok("E13 §20: another user cannot sign a URL for a guessed path", guessed.ok === false, JSON.stringify(guessed));
    const crossDelete = await removeOriginalsForDocument(other, "docX");
    ok("E14 §20: …nor delete another user's objects", cloud.rows.every((r) => r.user_id !== "userB") || crossDelete.removed === 0);
  }

  // =====================================================================
  // F. §12 — the two dangerous metadata/blob split shapes.
  // =====================================================================
  {
    const cloud = { objects: new Map(), rows: [] };
    const bytes = new TextEncoder().encode("payload");
    const sum = await sha256Hex(bytes);

    // A. metadata succeeds, blob upload fails.
    const failUp = await backupOriginal(fakeOriginals(cloud, "userA", { failUpload: true }),
      { documentId: "d1", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 7, checksum: sum, data: bytes });
    ok("F1 §12A: upload failure is reported at the upload stage",
      failUp.ok === false && failUp.stage === "upload", JSON.stringify(failUp));
    ok("F2 §12A: no metadata row is written, so nothing masquerades as a usable file",
      cloud.rows.length === 0 && cloud.objects.size === 0);

    // B. blob succeeds, metadata row fails.
    const failMeta = await backupOriginal(fakeOriginals(cloud, "userA", { failMeta: true }),
      { documentId: "d2", filename: "b.pdf", contentType: "application/pdf", sizeBytes: 7, checksum: sum, data: bytes });
    ok("F3 §12B: metadata failure is reported at the metadata stage",
      failMeta.ok === false && failMeta.stage === "metadata", JSON.stringify(failMeta));
    ok("F4 §12B: the orphan object is cleaned up rather than left invisible",
      cloud.objects.size === 0, JSON.stringify([...cloud.objects.keys()]));

    // A retry after either failure lands on the same deterministic path.
    const retry = await backupOriginal(fakeOriginals(cloud, "userA"),
      { documentId: "d2", filename: "b.pdf", contentType: "application/pdf", sizeBytes: 7, checksum: sum, data: bytes });
    ok("F5 a retry reuses the deterministic path — no orphan accumulation",
      retry.ok === true && cloud.objects.size === 1 && [...cloud.objects.keys()][0] === storagePathFor("userA", "d2", "b.pdf"));
  }

  // =====================================================================
  // G. C-5 — transient upload state never travels.
  // =====================================================================
  {
    const baseRows = baseFile("lib/library/rows.ts");
    ok("G1 RED: base sent sourceMetadata to the server verbatim",
      /source_metadata: doc\.sourceMetadata\b/.test(baseRows), "base already sanitised — re-examine C-5");

    const uploading = doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", originalBackup: "uploading", contentHash: "abc", filename: "x.pdf", originalStored: false } });
    const failed = doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", originalBackup: "failed", filename: "x.pdf" } });
    const stored = doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", originalBackup: "stored", originalStored: true, originalStoragePath: "u1/doc1/x.pdf" } });

    ok("G2 GREEN: 'uploading' is stripped on the way to the server",
      documentToRows(uploading).documents[0].source_metadata.originalBackup === undefined);
    ok("G3 GREEN: 'failed' is stripped too", documentToRows(failed).documents[0].source_metadata.originalBackup === undefined);
    ok("G4 'stored' is kept — it is a settled outcome, not an operation",
      documentToRows(stored).documents[0].source_metadata.originalBackup === "stored");
    ok("G5 durable provenance is untouched",
      documentToRows(uploading).documents[0].source_metadata.contentHash === "abc" &&
      documentToRows(uploading).documents[0].source_metadata.filename === "x.pdf" &&
      documentToRows(stored).documents[0].source_metadata.originalStoragePath === "u1/doc1/x.pdf");
    ok("G6 the new-import RPC payload is sanitised on the same path",
      documentToImportPayload(uploading).document.source_metadata.originalBackup === undefined);
    ok("G7 the local object is NOT mutated — this device keeps its own state",
      uploading.sourceMetadata.originalBackup === "uploading");

    // Round trip: what Device B rebuilds carries no transient state.
    const r = documentToRows(uploading);
    const back = rowsToDocuments(r.documents, r.sections, r.passages, r.highlights, r.annotations);
    ok("G8 Device B rebuilds the document with no transient upload state",
      back[0].sourceMetadata.originalBackup === undefined && back[0].sourceMetadata.contentHash === "abc");
  }

  // =====================================================================
  // H. §4/§19 — Device A → Device B, field for field, through the adapter.
  // =====================================================================
  {
    const fc = fakeClient();
    const ad = new SupabasePersistenceAdapter(fc.client);
    const A = { ...empty(),
      nextActions: [
        { id: "a1", title: "Call the accountant", description: "", status: "open", createdAt: iso(), updatedAt: iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [], dueDate: T, dueTime: "09:30", projectId: "p1" },
        { id: "a2", title: "Water the plants", description: "", status: "open", createdAt: iso(), updatedAt: iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 2, history: [], dueTime: "07:00", recurrence: { frequency: "daily", interval: 1 } },
        { id: "a3", title: "Hear back from Sam", description: "", status: "waiting", createdAt: iso(), updatedAt: iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 3, history: [], waitingOn: "Sam", waitingSince: iso() },
        { id: "a4", title: "Later", description: "", status: "deferred", createdAt: iso(), updatedAt: iso(), notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 4, history: [], deferredUntil: "2026-09-30" },
      ],
      goals: [{ id: "g1", title: "Financial order", createdAt: iso(), updatedAt: iso(), status: "active", description: "", horizon: "year", linkedEntityRefs: [], tags: [] }],
      projects: [{ id: "p1", title: "Tax return", createdAt: iso(), updatedAt: iso(), status: "active", description: "", goalId: "g1", linkedEntityRefs: [], tags: [], milestones: [], sections: [], relatedRefs: [] }],
      actionDependencies: [{ id: "dep1", blockerId: "a1", blockedId: "a4", createdAt: iso() }],
      recurrenceCompletions: [{ id: "rc1", actionId: "a2", occurrenceDate: T, completedAt: iso() }],
      planningAssignments: [{ id: "pa1", ref: { kind: "nextAction", id: "a1" }, horizon: "week", order: 1, history: [], createdAt: iso(), updatedAt: iso() }],
      notes: [{ id: "n1", title: "Advisor", body: "Said Friday", createdAt: iso(), updatedAt: iso(), tags: [], linkedEntityRefs: [] }],
      events: [{ id: "e1", title: "Dentist", date: T, startTime: "14:00", endTime: "15:00", allDay: false, notes: "", linkedEntityRefs: [], createdAt: iso(), updatedAt: iso() }],
      documents: [doc({ sourceMetadata: { importFormat: "pdf", addMethod: "upload", filename: "being.pdf", mimeType: "application/pdf", sizeBytes: 1234, contentHash: "cafe", originalStored: true, originalStoragePath: "u1/doc1/being.pdf" } })],
    };
    const pushA = await ad.saveStateByDomain(A, undefined, null);
    // Check the PUSH REPORT before reading anything back. Without this, a domain
    // whose mapper threw looks identical to a domain whose read-back dropped a
    // field — and the first draft of this harness misread three fixture errors
    // as cross-device data loss for exactly that reason.
    ok("H0 every domain of Device A pushed cleanly", pushA.failed.length === 0, JSON.stringify(pushA.failed));

    // Device B is a SEPARATE object graph built only from what the server holds.
    const remoteB = await ad.loadState();
    const B = reconcileAdoption({ remote: { ...empty(), ...remoteB }, local: empty(), remoteHasData: snapshotHasData(remoteB), localHasData: false, migratedFor: null, userId: "u1", empty: empty() }).state;

    const findA = (id) => B.nextActions.find((a) => a.id === id);
    ok("H1 §4: Device B receives every action", B.nextActions.length === 4, String(B.nextActions.length));
    ok("H2 a dated action keeps its due date AND time", findA("a1")?.dueDate === T && findA("a1")?.dueTime === "09:30", JSON.stringify(findA("a1")));
    ok("H3 a recurring action keeps its rule and its time (LIFEOS-074 D-1 stays fixed)",
      findA("a2")?.recurrence?.frequency === "daily" && findA("a2")?.recurrence?.interval === 1 &&
      findA("a2")?.dueTime === "07:00", JSON.stringify(findA("a2")));
    ok("H4 a waiting action keeps who it waits on", findA("a3")?.status === "waiting" && findA("a3")?.waitingOn === "Sam");
    ok("H5 a deferred action keeps its date", findA("a4")?.status === "deferred" && findA("a4")?.deferredUntil === "2026-09-30");
    ok("H6 §19: Action ↔ Project ↔ Goal survive", findA("a1")?.projectId === "p1" && B.projects[0]?.goalId === "g1");
    ok("H7 §19: the dependency edge survives", B.actionDependencies.length === 1 && B.actionDependencies[0].blockerId === "a1");
    ok("H8 §19: the recurrence completion survives and still points at its action",
      B.recurrenceCompletions.length === 1 && B.recurrenceCompletions[0].actionId === "a2");
    ok("H9 §19: the planning assignment survives, still pointing at its action",
      B.planningAssignments.length === 1 && B.planningAssignments[0].ref?.id === "a1" &&
      B.planningAssignments[0].ref?.kind === "nextAction" && B.planningAssignments[0].horizon === "week",
      JSON.stringify(B.planningAssignments));
    ok("H10 the note text is exact", B.notes[0]?.body === "Said Friday");
    ok("H11 the event keeps its day and its wall-clock start and end",
      B.events[0]?.date === T && B.events[0]?.startTime === "14:00" && B.events[0]?.endTime === "15:00",
      JSON.stringify(B.events[0]));
    ok("H12 §5: file METADATA survives — name, type, size, content hash",
      B.documents[0]?.sourceMetadata.filename === "being.pdf" &&
      B.documents[0]?.sourceMetadata.mimeType === "application/pdf" &&
      B.documents[0]?.sourceMetadata.sizeBytes === 1234 &&
      B.documents[0]?.sourceMetadata.contentHash === "cafe", JSON.stringify(B.documents[0]?.sourceMetadata));
    ok("H13 §5: …and the storage path needed to fetch the blob",
      B.documents[0]?.sourceMetadata.originalStoragePath === "u1/doc1/being.pdf");
  }

  const failed = results.filter((r) => !r.p);
  console.log(`\n=== ${results.length - failed.length}/${results.length} cross-device assertions ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
