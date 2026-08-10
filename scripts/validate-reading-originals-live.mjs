#!/usr/bin/env node
/**
 * LIFEOS-047A — LIVE Supabase Storage + RLS validation harness.
 *
 * DEVELOPER / RELEASE VALIDATION ONLY. This is NOT part of the app and is never
 * imported by production code. It performs the outstanding real two-user Storage
 * + database + RLS validation for private Reading originals, against an actual
 * Supabase project, using the SAME production code path
 * (`lib/reading/originals.ts` → `makeSupabaseOriginalsBackend` / `backupOriginal`
 * / `resolveOriginalUrl` / `removeOriginalsForDocument`).
 *
 * Run locally (NOT from the agent environment):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=...        \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=...   \
 *   SUPABASE_SERVICE_ROLE_KEY=...       \
 *   npm run validate:reading-originals-live
 *
 * Requires the project to have migrations 0001→0033 applied (the
 * `reading-originals` bucket, `reading_document_files` table, and their RLS).
 *
 * SECURITY: the service-role key is used ONLY to (a) create two disposable
 * confirmed users, (b) verify ground-truth state, and (c) clean up at the end.
 * EVERY attack/permission test runs through User A / User B NORMAL authenticated
 * clients (anon key + their own session) — never the service role — because a
 * service-role "success" would prove nothing about RLS. Secrets are never
 * printed, logged, or written to any report.
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { randomUUID, createHash, randomBytes } from "crypto";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- Load the REAL production TS modules (transpile-on-require, @/ alias) ----
const ts = require(join(root, "node_modules/typescript"));
const Module = require("module");
const alias = (r) => (r.startsWith("@/") ? join(root, r.slice(2)) : r);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return origResolve.call(this, alias(r), ...a); };
require.extensions[".ts"] = function (m, f) {
  const src = require("fs").readFileSync(f, "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true }, fileName: f }).outputText;
  m._compile(out, f);
};

const { createClient } = require("@supabase/supabase-js");
const originals = require(join(root, "lib/reading/originals.ts"));
const {
  makeSupabaseOriginalsBackend, backupOriginal, removeOriginalsForDocument, resolveOriginalUrl,
  storagePathFor, ORIGINALS_BUCKET, ORIGINALS_TABLE,
} = originals;

// ---- Require env (fail fast; never print values) ----
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", URL_], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error("LIFEOS-047A live validation — missing required environment variables:\n  " + missing.join("\n  "));
  console.error("\nSet all three (do NOT commit them) and re-run. See README / .env.example.");
  process.exit(2);
}

let projectHost = "(unknown)";
try { projectHost = new URL(URL_).host; } catch { /* keep placeholder */ }

// ---- Result recording ----
const results = [];
const rec = (name, pass, note = "") => { results.push({ name, pass: !!pass, note }); return !!pass; };
const denied = (name, cond, note = "") => rec(name, cond, note); // cond true == correctly denied/absent

// ---- Fixtures ----
const RUN = randomBytes(4).toString("hex");
const PDF = Buffer.from(`%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\nrun-${RUN}\n`, "utf8");
const CHECKSUM = createHash("sha256").update(PDF).digest("hex");
const FILENAME = "live-sample.pdf";
const CONTENT_TYPE = "application/pdf";

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// Track what we create so cleanup is exhaustive (storage is NOT cascaded on user delete).
const created = { userIds: [], objectPaths: [] };

async function makeUser(tag) {
  const email = `lifeos047a_${tag}_${RUN}_${randomBytes(3).toString("hex")}@example.com`;
  const password = `Pw_${randomBytes(12).toString("hex")}!aA1`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${tag} failed: ${error.message}`);
  created.userIds.push(data.user.id);
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: sErr } = await client.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`sign in ${tag} failed: ${sErr.message}`);
  return { email, password, id: data.user.id, client, backend: makeSupabaseOriginalsBackend(client, data.user.id) };
}

async function freshSession(user) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`re-auth failed: ${error.message}`);
  return { client, backend: makeSupabaseOriginalsBackend(client, user.id) };
}

// Ground-truth via service role (verification only — never used as an attack).
async function adminObjectExists(path) {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await admin.storage.from(ORIGINALS_BUCKET).list(folder);
  return (data ?? []).some((o) => o.name === name);
}
async function adminRowCount(documentId) {
  const { count } = await admin.from(ORIGINALS_TABLE).select("id", { count: "exact", head: true }).eq("document_id", documentId);
  return count ?? 0;
}

async function insertReadingDoc(user, documentId, extraMeta = {}) {
  // Real reading_documents row (user_id defaults to auth.uid()); exercises the
  // actual table + RLS so the original↔document association is genuine.
  const { error } = await user.client.from("reading_documents").insert({
    id: documentId,
    title: `Live validation ${RUN}`,
    source_metadata: { addMethod: "upload", uploadFormat: "pdf", filename: FILENAME, contentHash: CHECKSUM, originalStored: false, ...extraMeta },
  });
  return error;
}

async function main() {
  const A = await makeUser("A");
  const B = await makeUser("B");
  const docA1 = randomUUID();

  // ============ 1. USER A UPLOAD ============
  const docErr = await insertReadingDoc(A, docA1);
  rec("User A ReadingDocument created", !docErr, docErr?.message ?? "");

  const preRows = await A.backend.metadataForDocument(docA1);
  const preOk = preRows.ok && preRows.rows.length === 0;

  const up = await backupOriginal(A.backend, { documentId: docA1, filename: FILENAME, contentType: CONTENT_TYPE, sizeBytes: PDF.length, checksum: CHECKSUM, data: PDF });
  const pathA1 = storagePathFor(A.id, docA1, FILENAME);
  if (up.ok) created.objectPaths.push(pathA1);
  rec("User A upload (backupOriginal)", up.ok, up.ok ? "" : `${up.stage}:${up.reason}`);

  rec("Object exists in reading-originals", await adminObjectExists(pathA1));
  const aRows = await A.backend.metadataForDocument(docA1);
  rec("Metadata row exists", aRows.ok && aRows.rows.length === 1);
  rec("Path scoped under User A uid", up.ok && pathA1.startsWith(`${A.id}/`) && aRows.rows[0]?.storage_path === pathA1);
  // originalStored is true only after BOTH object+metadata succeeded (pre was empty; now both present).
  rec("originalStored semantics (both-or-nothing)", preOk && up.ok && (await adminObjectExists(pathA1)) && aRows.rows.length === 1);
  if (up.ok) await A.client.from("reading_documents").update({ source_metadata: { addMethod: "upload", uploadFormat: "pdf", filename: FILENAME, contentHash: CHECKSUM, originalStored: true, originalStoragePath: pathA1, originalFileId: up.fileId } }).eq("id", docA1);

  // ============ 2. USER A DURABILITY (fresh session / reload+re-auth) ============
  const A2 = await freshSession(A);
  const a2doc = await A2.client.from("reading_documents").select("source_metadata").eq("id", docA1).single();
  rec("Fresh-session ReadingDocument association survives", !a2doc.error && a2doc.data?.source_metadata?.originalStored === true);
  const a2rows = await A2.backend.metadataForDocument(docA1);
  rec("Fresh-session metadata readable", a2rows.ok && a2rows.rows.length === 1);
  const a2url = await resolveOriginalUrl(A2.backend, { documentId: docA1 });
  let retrievedOk = false;
  if (a2url.ok && a2url.url) { try { const r = await fetch(a2url.url); retrievedOk = r.ok; } catch { retrievedOk = false; } }
  rec("Private signed retrieval works (owner)", a2url.ok && retrievedOk);
  // Bucket is not public → the public object URL must NOT serve the file.
  let publicBlocked = true;
  try { const pr = await fetch(`${URL_}/storage/v1/object/public/${ORIGINALS_BUCKET}/${pathA1}`); publicBlocked = !pr.ok; } catch { publicBlocked = true; }
  const bkt = await admin.storage.getBucket(ORIGINALS_BUCKET);
  rec("Bucket is private / no public URL", publicBlocked && bkt.data?.public === false);

  // ============ 3. USER B ATTACK MATRIX (User B's own session only) ============
  const bBucket = B.client.storage.from(ORIGINALS_BUCKET);
  // list A's folder
  const bList = await bBucket.list(`${A.id}/${docA1}`);
  denied("B: list A's storage folder", (bList.data ?? []).length === 0);
  // download A's object
  const bDl = await bBucket.download(pathA1);
  denied("B: download A's object", !!bDl.error || !bDl.data);
  // signed URL for A's object (then verify any returned URL cannot fetch)
  const bSign = await bBucket.createSignedUrl(pathA1, 60);
  let bSignBlocked = !!bSign.error || !bSign.data?.signedUrl;
  if (!bSignBlocked) { try { const r = await fetch(bSign.data.signedUrl); bSignBlocked = !r.ok; } catch { bSignBlocked = true; } }
  denied("B: signed URL for A's object", bSignBlocked);
  // select A's metadata row
  const bSel = await B.client.from(ORIGINALS_TABLE).select("id,user_id,storage_path").eq("document_id", docA1);
  denied("B: read A's metadata row", (bSel.data ?? []).length === 0);
  // insert metadata claiming A's user_id
  const bIns = await B.client.from(ORIGINALS_TABLE).insert({ id: randomUUID(), user_id: A.id, document_id: docA1, storage_path: pathA1, filename: FILENAME, content_type: CONTENT_TYPE, size_bytes: PDF.length, checksum: CHECKSUM, processing_state: "ready" });
  denied("B: insert metadata as A", !!bIns.error && (await adminRowCount(docA1)) === 1);
  // update A's metadata
  await B.client.from(ORIGINALS_TABLE).update({ processing_state: "hacked" }).eq("document_id", docA1);
  const aRowState = await admin.from(ORIGINALS_TABLE).select("processing_state").eq("document_id", docA1).single();
  denied("B: update A's metadata", (aRowState.data?.processing_state ?? "ready") !== "hacked");
  // delete A's metadata (verify still present via admin)
  await B.client.from(ORIGINALS_TABLE).delete().eq("document_id", docA1);
  denied("B: delete A's metadata", (await adminRowCount(docA1)) === 1);
  // update A's storage object (upsert overwrite) then delete A's object; verify object still there + unchanged
  await bBucket.upload(pathA1, Buffer.from("tampered"), { contentType: CONTENT_TYPE, upsert: true }).catch(() => {});
  await bBucket.remove([pathA1]).catch(() => {});
  const stillThere = await adminObjectExists(pathA1);
  let unchanged = false;
  if (stillThere) { const dl = await admin.storage.from(ORIGINALS_BUCKET).download(pathA1); const buf = dl.data ? Buffer.from(await dl.data.arrayBuffer()) : Buffer.alloc(0); unchanged = buf.equals(PDF); }
  denied("B: update/delete A's storage object", stillThere && unchanged);

  // ============ 4. SAME-USER DUPLICATE (Upload another copy) ============
  const docA2 = randomUUID();
  await insertReadingDoc(A, docA2);
  const up2 = await backupOriginal(A.backend, { documentId: docA2, filename: FILENAME, contentType: CONTENT_TYPE, sizeBytes: PDF.length, checksum: CHECKSUM, data: PDF });
  const pathA2 = storagePathFor(A.id, docA2, FILENAME);
  if (up2.ok) created.objectPaths.push(pathA2);
  rec("Same-user 2nd copy: metadata row permitted (0033)", up2.ok && pathA2 !== pathA1 && (await adminRowCount(docA2)) === 1);
  rec("Same-user 2nd copy: distinct document-scoped path", up2.ok && pathA2.startsWith(`${A.id}/${docA2}/`));
  // delete copy 2, confirm copy 1 untouched
  const delCopy2 = await removeOriginalsForDocument(A.backend, docA2);
  rec("Same-user: deleting copy 2 leaves copy 1", delCopy2.ok && !(await adminObjectExists(pathA2)) && (await adminObjectExists(pathA1)));

  // ============ 5. CROSS-USER SAME CHECKSUM ============
  const docB1 = randomUUID();
  await insertReadingDoc(B, docB1);
  const upB = await backupOriginal(B.backend, { documentId: docB1, filename: FILENAME, contentType: CONTENT_TYPE, sizeBytes: PDF.length, checksum: CHECKSUM, data: PDF });
  const pathB1 = storagePathFor(B.id, docB1, FILENAME);
  if (upB.ok) created.objectPaths.push(pathB1);
  rec("Cross-user same checksum: B stores own copy", upB.ok && pathB1.startsWith(`${B.id}/`) && (await adminRowCount(docB1)) === 1);
  // B's view by checksum shows ONLY B's rows (never A's existence).
  const bByChecksum = await B.client.from(ORIGINALS_TABLE).select("user_id").eq("checksum", CHECKSUM);
  const onlyB = (bByChecksum.data ?? []).length > 0 && (bByChecksum.data ?? []).every((r) => r.user_id === B.id);
  denied("Cross-user: B's checksum view excludes A", onlyB);

  // ============ 6. DELETE (A removes remaining doc; B's copy untouched) ============
  const delA1 = await removeOriginalsForDocument(A.backend, docA1);
  rec("Delete: A's original object removed", delA1.ok && !(await adminObjectExists(pathA1)));
  rec("Delete: A's metadata removed", (await adminRowCount(docA1)) === 0);
  rec("Delete isolation: B's copy remains", (await adminObjectExists(pathB1)) && (await adminRowCount(docB1)) === 1);

  return { A, B };
}

// ---- Run + guaranteed cleanup ----
let exitCode = 0;
try {
  await main();
} catch (e) {
  rec("Harness completed without fatal error", false, e?.message ?? String(e));
} finally {
  // Cleanup (service role): remove any objects we created, then delete users
  // (which cascades their DB rows). Storage is NOT cascaded, so remove it first.
  let cleanupOk = true;
  try {
    if (created.objectPaths.length) {
      const { error } = await admin.storage.from(ORIGINALS_BUCKET).remove(created.objectPaths);
      if (error) cleanupOk = false;
    }
    for (const uid of created.userIds) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) cleanupOk = false;
    }
  } catch { cleanupOk = false; }
  rec("Cleanup (test objects + users removed)", cleanupOk);
}

// ---- Report ----
const total = results.length;
const passed = results.filter((r) => r.pass).length;
const label = (r) => `${r.name} ${".".repeat(Math.max(2, 34 - r.name.length))} ${r.pass ? "PASS" : "FAIL"}${r.note && !r.pass ? `  (${r.note})` : ""}`;
console.log("\nLIFEOS-047A LIVE SUPABASE VALIDATION\n");
console.log(`Project: ${projectHost}\n`);
for (const r of results) console.log(label(r));
console.log(`\nTOTAL: ${passed}/${total} PASS`);
if (passed !== total) { console.log("\nFAILURES:"); for (const r of results.filter((x) => !x.pass)) console.log(`  - ${r.name}${r.note ? `: ${r.note}` : ""}`); }
exitCode = passed === total ? 0 : 1;
process.exit(exitCode);
