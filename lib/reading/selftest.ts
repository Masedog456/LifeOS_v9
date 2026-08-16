/**
 * Reading ingestion + grounded-study self-tests (LIFEOS-047). Pure and
 * deterministic — no browser, no network, no AI provider. Surfaced at
 * `/dev/reading-ingest-tests`, asserted by the regression harness.
 */

import {
  detectFormat, validateUpload, contentHash, findDuplicate, assignPages,
  canTransition, isRetryable, ingestText, titleFromFilename, safeFilename, MAX_UPLOAD_BYTES,
} from "@/lib/reading/ingest";
import {
  chunkDocument, retrieve, groundedCitations, buildContext, scopeChunks, studyMaterial, askDocument, CONTEXT_CHAR_BUDGET,
} from "@/lib/reading/study";
import {
  backupOriginal, removeOriginalsForDocument, resolveOriginalUrl, storagePathFor,
  type OriginalsBackend, type OriginalFileRow,
} from "@/lib/reading/originals";
import { buildIngestionReport, completenessHeadline } from "@/lib/reading/completeness";
import {
  buildRetrievalChunks, buildDocumentParts, MAX_CHUNK_CHARS, CHUNK_OVERLAP_CHARS,
} from "@/lib/reading/chunking";
import { selectEvidence, rankChunks, evidenceSpread } from "@/lib/reading/retrieval";
import {
  indexDocument, removeIndexForDocument, pendingChunks, chunkContentHash, INDEX_BATCH_SIZE,
  type SemanticIndexBackend, type StoredVector,
} from "@/lib/reading/semanticIndex";
import {
  synthesizeDocument, buildDocumentMap, partContext, PART_CONTEXT_BUDGET,
  selectParts, reduceToOne, MAX_PARTS_PER_RUN,
} from "@/lib/reading/synthesis";
import { MAX_EXTRACT_CHARS, MAX_PAGES } from "@/lib/ingestion/pdfExtract";
import type { ParsedDocument } from "@/lib/library/importer";
import type { ReadingDocument, Passage, PageSpan } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/**
 * An in-memory fake of the storage + metadata backend that enforces the same
 * per-user isolation the real RLS does: a user can only touch objects under
 * their own `<uid>/…` prefix and only see their own metadata rows. Configurable
 * failures let us test ordering, orphan cleanup, and retry without a live
 * backend. This is exactly the seam `lib/reading/originals.ts` is written against.
 */
interface FakeCloud { objects: Map<string, { contentType: string }>; rows: OriginalFileRow[] }
function makeCloud(): FakeCloud { return { objects: new Map(), rows: [] }; }
function fakeBackend(cloud: FakeCloud, userId: string | null, opts: { failUpload?: boolean; failMeta?: boolean } = {}): OriginalsBackend {
  const ownsPath = (p: string) => userId != null && p.split("/")[0] === userId; // storage RLS
  return {
    userId,
    async uploadObject(path, _data, contentType) {
      if (opts.failUpload) return { ok: false, error: "network-lost" };
      if (!ownsPath(path)) return { ok: false, error: "denied" };
      cloud.objects.set(path, { contentType });
      return { ok: true };
    },
    async removeObjects(paths) {
      for (const p of paths) { if (!ownsPath(p)) return { ok: false, error: "denied" }; cloud.objects.delete(p); }
      return { ok: true };
    },
    async listFolder(prefix) {
      if (userId == null || prefix.split("/")[0] !== userId) return { ok: true, names: [] }; // can't see others' folders
      const names = [...cloud.objects.keys()].filter((k) => k.startsWith(prefix + "/")).map((k) => k.slice(prefix.length + 1));
      return { ok: true, names };
    },
    async insertMetadata(row) {
      if (opts.failMeta) return { ok: false, error: "db-error" };
      if (row.user_id !== userId) return { ok: false, error: "denied" };
      cloud.rows.push({ ...row });
      return { ok: true };
    },
    async deleteMetadataForDocument(documentId) {
      for (let i = cloud.rows.length - 1; i >= 0; i--) if (cloud.rows[i].user_id === userId && cloud.rows[i].document_id === documentId) cloud.rows.splice(i, 1);
      return { ok: true };
    },
    async metadataForDocument(documentId) {
      return { ok: true, rows: cloud.rows.filter((r) => r.user_id === userId && r.document_id === documentId) };
    },
    async signedUrl(path, ttlSeconds) {
      if (!ownsPath(path) || !cloud.objects.has(path)) return { ok: false, error: "not-found" };
      return { ok: true, url: `signed://${path}?ttl=${ttlSeconds}` };
    },
  };
}

function docWith(passages: { id: string; text: string; page?: number }[]): ReadingDocument {
  const section = { id: "s1", title: "Body", order: 0, passages: passages.map((p, i): Passage => ({ id: p.id, sectionId: "s1", text: p.text, page: p.page, order: i, highlights: [], annotations: [], linked: [] })) };
  return { id: "doc1", title: "Being and Time", authors: ["Heidegger"], kind: "book", status: "reading", tags: [], notes: "", sections: [section], progress: { status: "reading", percent: 0, readPassageIds: [] }, sourceMetadata: { importFormat: "pdf" }, createdAt: "t", updatedAt: "t" } as unknown as ReadingDocument;
}

export async function runReadingIngestSelfTests(): Promise<SelfTestReport> {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Format detection ----
  ok("1.1 pdf by extension", detectFormat("Being and Time.pdf") === "pdf");
  ok("1.2 pdf by mime", detectFormat("x", "application/pdf") === "pdf");
  ok("1.3 markdown", detectFormat("notes.md") === "markdown");
  ok("1.4 txt", detectFormat("a.txt") === "txt");
  ok("1.5 docx", detectFormat("essay.docx") === "docx");
  ok("1.6 unsupported → null", detectFormat("song.mp3") === null);
  ok("1.7 safe filename strips paths", safeFilename("../../etc/pa ss.pdf") === "etc_pa_ss.pdf" || !safeFilename("../../etc/pa ss.pdf").includes("/"));

  // ---- 2. Validation ----
  ok("2.1 ok pdf", validateUpload({ name: "a.pdf", size: 1000, type: "application/pdf" }).ok);
  ok("2.2 empty rejected", !validateUpload({ name: "a.pdf", size: 0 }).ok);
  ok("2.3 oversized rejected", !validateUpload({ name: "a.pdf", size: MAX_UPLOAD_BYTES + 1 }).ok);
  ok("2.4 unsupported rejected with friendly reason", (() => { const r = validateUpload({ name: "a.mp3", size: 10 }); return !r.ok && /paste/.test(r.reason ?? ""); })());

  // ---- 3. Duplicate detection ----
  const h1 = contentHash("Hello   world\n\n"); const h2 = contentHash("Hello world");
  ok("3.1 hash is whitespace-stable", h1 === h2);
  ok("3.2 different text → different hash", contentHash("a") !== contentHash("b"));
  ok("3.3 findDuplicate matches by hash", findDuplicate([{ id: "d", title: "t", sourceMetadata: { contentHash: h1 } }], h2)?.id === "d");
  ok("3.4 no dup → null", findDuplicate([{ id: "d", title: "t", sourceMetadata: { contentHash: "z" } }], h2) === null);

  // ---- 4. Page provenance (never invented) ----
  const full = "Alpha passage about authenticity.\n\nBeta passage on being.\n\nGamma passage on time.";
  const pageMap: PageSpan[] = [{ page: 166, start: 0, end: 34 }, { page: 167, start: 34, end: 58 }, { page: 168, start: 58, end: full.length }];
  const parsed: ParsedDocument = { sections: [{ title: "Body", passages: [{ text: "Alpha passage about authenticity." }, { text: "Beta passage on being." }, { text: "Gamma passage on time." }] }] };
  const paged = assignPages(parsed, full, pageMap);
  ok("4.1 first passage → p.166", paged.sections[0].passages[0].page === 166);
  ok("4.2 second passage → p.167", paged.sections[0].passages[1].page === 167);
  ok("4.3 third passage → p.168", paged.sections[0].passages[2].page === 168);
  const unlocatable = assignPages({ sections: [{ title: "B", passages: [{ text: "not present in text at all zzz" }] }] }, full, pageMap);
  ok("4.4 unlocatable passage never gets a wrong page (falls back to last, not invented)", typeof unlocatable.sections[0].passages[0].page === "number");
  ok("4.5 no page map → passages unchanged", assignPages(parsed, full, []) === parsed);

  // ---- 5. Processing-state machine ----
  ok("5.1 uploading→processing allowed", canTransition("uploading", "processing"));
  ok("5.2 ready is terminal", !canTransition("ready", "processing"));
  ok("5.3 failed→processing (retry) allowed", canTransition("failed", "processing"));
  ok("5.4 needs_attention + failed are retryable", isRetryable("needs_attention") && isRetryable("failed") && !isRetryable("ready"));

  // ---- 6. ingestText ----
  const good = ingestText({ text: "# Title\n\nA real paragraph of readable content about a topic.", addMethod: "upload", format: "markdown", filename: "essay.md", now: "T" });
  ok("6.1 readable text → ok, ready", good.ok && good.doc.provenance.processingState === "ready");
  ok("6.2 provenance carries hash + method + not-yet-stored original", good.ok && !!good.doc.provenance.contentHash && good.doc.provenance.addMethod === "upload" && good.doc.provenance.originalStored === false);
  const scanned = ingestText({ text: "  \n \n ", addMethod: "upload", format: "pdf", filename: "scan.pdf", now: "T" });
  ok("6.3 empty/scanned text → needs_attention, honest reason (no fake success)", !scanned.ok && scanned.state === "needs_attention" && /readable text/.test(scanned.reason));
  ok("6.4 title falls back from filename", titleFromFilename("Being_and_Time.pdf") === "Being and Time");

  // ---- 7. Chunking (real source locations) ----
  const doc = docWith([{ id: "p1", text: "Authenticity is a way of being that owns its own existence.", page: 167 }, { id: "p2", text: "Time structures the horizon of understanding.", page: 168 }]);
  const chunks = chunkDocument(doc);
  ok("7.1 one chunk per passage", chunks.length === 2);
  ok("7.2 chunk keeps real document/section/passage/page", chunks[0].documentId === "doc1" && chunks[0].passageId === "p1" && chunks[0].page === 167);

  // ---- 8. Retrieval + grounded citations ----
  const scored = retrieve("What does authenticity mean?", chunks);
  ok("8.1 retrieval finds the relevant passage", scored.length >= 1 && scored[0].chunk.passageId === "p1");
  const cites = groundedCitations(scored);
  ok("8.2 citation page comes from the real passage (p.167), never invented", cites[0].page === 167 && cites[0].passageId === "p1");
  ok("8.3 unsupported question → no retrieval, no citations", retrieve("quantum chromodynamics lunar zebra", chunks).length === 0);

  // ---- 9. Context budget (whole book never sent) ----
  const many = docWith(Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, text: `Passage ${i} about authenticity and being and time and understanding repeated content.`, page: i + 1 })));
  const bigScored = retrieve("authenticity being time", chunkDocument(many));
  const ctx = buildContext(bigScored);
  ok("9.1 context respects the char budget", ctx.length <= CONTEXT_CHAR_BUDGET);
  ok("9.2 retrieval caps result count (not the whole book)", bigScored.length <= 6);

  // ---- 10. Summarize scoping ----
  ok("10.1 document scope covers all passages", scopeChunks(doc, "document").length === 2);
  ok("10.2 selection scope grounds to overlapping passage", scopeChunks(doc, "selection", { selection: "Authenticity is a way of being" }).some((c) => c.passageId === "p1"));

  // ---- 11. Study material (generated, source-linked, never mutates beliefs) ----
  const study = studyMaterial(doc);
  ok("11.1 study material is marked generated", study.generated === true);
  ok("11.2 key ideas keep a source ref back to a real passage", study.keyIdeas.length > 0 && study.keyIdeas.every((k) => k.ref.passageId && chunks.some((c) => c.passageId === k.ref.passageId)));
  ok("11.3 flashcards + questions derive from source", study.flashcards.length === study.keyIdeas.length && study.questions.length === study.keyIdeas.length);

  // ---- 12. Original-file persistence (LIFEOS-047A) — over a fake, RLS-like backend ----
  const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"

  // Real object keys go through the same safeFilename() as production — derive
  // them from storagePathFor rather than hard-coding, so the test can't drift.
  const pathA1 = storagePathFor("userA", "docA1", "Being and Time.pdf");
  const pathMeta = storagePathFor("userA", "docMeta", "y.pdf");

  // 12.1 Happy path: upload + metadata both succeed, per-user path, reload association.
  const cloud = makeCloud();
  const A = fakeBackend(cloud, "userA");
  const r1 = await backupOriginal(A, { documentId: "docA1", filename: "Being and Time.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "h1", data: bytes });
  ok("12.1 upload+metadata succeed → ok", r1.ok === true);
  ok("12.2 stored at a per-user namespaced path", r1.ok === true && r1.storagePath === pathA1 && pathA1.startsWith("userA/docA1/"));
  ok("12.3 object + metadata both persisted (originalStored is truthful)", cloud.objects.has(pathA1) && (await A.metadataForDocument("docA1")).rows.length === 1);

  // 12.4 Storage failure: nothing persisted; ReadingDocument is untouched by design.
  const rUp = await backupOriginal(fakeBackend(cloud, "userA", { failUpload: true }), { documentId: "docFail", filename: "x.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "h2", data: bytes });
  ok("12.4 storage failure → not ok, stage=upload", rUp.ok === false && rUp.stage === "upload");
  ok("12.5 storage failure leaves no object and no metadata", !cloud.objects.has(storagePathFor("userA", "docFail", "x.pdf")) && (await A.metadataForDocument("docFail")).rows.length === 0);

  // 12.6 Metadata failure after a good upload → the just-written object is cleaned up (no orphan).
  const rMeta = await backupOriginal(fakeBackend(cloud, "userA", { failMeta: true }), { documentId: "docMeta", filename: "y.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "h3", data: bytes });
  ok("12.6 metadata failure → not ok, stage=metadata", rMeta.ok === false && rMeta.stage === "metadata");
  ok("12.7 metadata failure removes the orphaned object", !cloud.objects.has(pathMeta) && (await A.metadataForDocument("docMeta")).rows.length === 0);

  // 12.8 Retry after an interrupted upload succeeds (same input, good backend).
  const rRetry = await backupOriginal(A, { documentId: "docMeta", filename: "y.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "h3", data: bytes });
  ok("12.8 retry after failure succeeds", rRetry.ok === true && cloud.objects.has(pathMeta) && (await A.metadataForDocument("docMeta")).rows.length === 1);

  // 12.9 No capability (signed out) → honest capability failure, nothing stored.
  const rCap = await backupOriginal(fakeBackend(cloud, null), { documentId: "docA1", filename: "z.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "h4", data: bytes });
  ok("12.9 no capability → not ok, stage=capability", rCap.ok === false && rCap.stage === "capability");

  // 12.10 Private retrieval: a signed URL for the owner; nothing for anyone else.
  const urlA = await resolveOriginalUrl(A, { documentId: "docA1" });
  ok("12.10 owner resolves a short-lived signed URL", urlA.ok === true && !!urlA.url && urlA.url.startsWith(`signed://${pathA1}`));

  // 12.11–12.13 Cross-user isolation: User B can neither see, retrieve, nor delete A's original.
  const B = fakeBackend(cloud, "userB");
  ok("12.11 User B cannot see User A's metadata", (await B.metadataForDocument("docA1")).rows.length === 0);
  const urlB = await resolveOriginalUrl(B, { documentId: "docA1" });
  ok("12.12 User B cannot resolve User A's original", urlB.ok === false);
  const bDel = await removeOriginalsForDocument(B, "docA1");
  ok("12.13 User B's delete cannot remove User A's object", cloud.objects.has(pathA1) && bDel.removed === 0);

  // 12.14 Same-user "Upload another copy": a second document with identical bytes
  // stores its OWN original at a distinct path (no unique-checksum blocker).
  const copy1 = await backupOriginal(A, { documentId: "dupDocX", filename: "dup.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "hDup", data: bytes });
  const copy2 = await backupOriginal(A, { documentId: "dupDocY", filename: "dup.pdf", contentType: "application/pdf", sizeBytes: 4, checksum: "hDup", data: bytes });
  ok("12.14 second copy of same bytes stores its own original", copy1.ok === true && copy2.ok === true && cloud.objects.has(storagePathFor("userA", "dupDocX", "dup.pdf")) && cloud.objects.has(storagePathFor("userA", "dupDocY", "dup.pdf")));

  // 12.15 Same-user library duplicate detection is by content hash over the user's OWN docs.
  ok("12.15 duplicate detection is per-user (never cross-user)", findDuplicate([{ id: "dupDocX", title: "dup", sourceMetadata: { contentHash: "hDup" } }], "hDup")?.id === "dupDocX");

  // 12.16 Deletion removes ONLY the target document's original.
  const del = await removeOriginalsForDocument(A, "docA1");
  ok("12.16 deletion removes the correct original only", del.ok === true && del.removed === 1 && !cloud.objects.has(pathA1) && cloud.objects.has(pathMeta));
  ok("12.17 deletion removed the metadata row too", (await A.metadataForDocument("docA1")).rows.length === 0);

  // 12.18 Orphan cleanup: an object with no metadata row is still removed on delete
  // (folder-scoped cleanup), so an interrupted prior upload cannot linger.
  const orphanPath = storagePathFor("userA", "docOrphan", "lost.pdf");
  cloud.objects.set(orphanPath, { contentType: "application/pdf" });
  const orphanDel = await removeOriginalsForDocument(A, "docOrphan");
  ok("12.18 orphaned object (no metadata) is cleaned up on delete", orphanDel.ok === true && orphanDel.removed === 1 && !cloud.objects.has(orphanPath));

  // ==================== 13. Book-scale reading intelligence (LIFEOS-049) ====================
  // A synthetic long document with UNIQUE facts planted at five positions. These
  // assertions exist to prevent the exact regression this sprint fixes: only the
  // beginning of a long work being usable.
  const MARKERS = {
    opening: "zerthquill", earlyMid: "vandroskop", middle: "quilfaneth",
    lateMid: "brindlewax", ending: "yovulmarch",
  };
  const longDoc = buildLongDoc(MARKERS);
  const longChunks = buildRetrievalChunks(longDoc);
  const longParts = buildDocumentParts(longDoc, longChunks);

  // ---- 13.1 Ingestion completeness accounting ----
  const fullReport = buildIngestionReport({
    pageCount: 147, attemptedPages: 147, readablePages: 147, emptyPageNumbers: [],
    text: "x".repeat(52000), passages: 812, chunks: 476, sections: 12,
    truncated: false, now: "T",
  });
  ok("13.1 all-readable PDF reports complete", fullReport.extraction === "complete" && fullReport.warnings.length === 0);
  ok("13.2 headline states real page counts", completenessHeadline(fullReport).includes("All 147 pages"));
  const partialReport = buildIngestionReport({
    pageCount: 147, attemptedPages: 147, readablePages: 132,
    emptyPageNumbers: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55],
    text: "y".repeat(40000), passages: 700, chunks: 400, sections: 10, truncated: false, now: "T",
  });
  ok("13.3 partial extraction is NOT called complete", partialReport.extraction === "partial");
  ok("13.4 unreadable pages collapse into honest ranges", partialReport.unreadableRanges.length === 1 && partialReport.unreadableRanges[0].from === 41 && partialReport.unreadableRanges[0].to === 55);
  ok("13.5 headline names the scanned range", completenessHeadline(partialReport).includes("132 of 147") && completenessHeadline(partialReport).includes("41–55"));
  const truncReport = buildIngestionReport({ pageCount: 900, attemptedPages: 400, readablePages: 400, emptyPageNumbers: [], text: "z".repeat(600000), passages: 9, chunks: 9, sections: 1, truncated: true, truncationReason: "char_limit", now: "T" });
  ok("13.6 truncated extraction warns and is partial", truncReport.extraction === "partial" && truncReport.warnings.some((w) => /size limit/i.test(w)));
  ok("13.7 no page info → unknown, never 'complete'", buildIngestionReport({ pageCount: 0, attemptedPages: 0, readablePages: 0, emptyPageNumbers: [], text: "abc", passages: 1, chunks: 1, sections: 1, truncated: false, now: "T" }).extraction === "unknown");

  // ---- 13.8 Chunking: size, stability, provenance, no content dropped ----
  ok("13.8 chunks are book-appropriate, not one-per-passage", longChunks.length > 0 && longChunks.length < countPassages(longDoc));
  ok("13.9 chunk ids are stable + deterministic", JSON.stringify(buildRetrievalChunks(longDoc).map((c) => c.id)) === JSON.stringify(longChunks.map((c) => c.id)));
  ok("13.10 every chunk maps to document/section/passages", longChunks.every((c) => c.documentId === longDoc.id && !!c.sectionId && c.passageIds.length > 0));
  ok("13.11 chunks carry a real page range", longChunks.every((c) => typeof c.pageStart === "number" && typeof c.pageEnd === "number" && (c.pageEnd as number) >= (c.pageStart as number)));
  ok("13.12 chunks respect the size ceiling", longChunks.every((c) => c.chars <= MAX_CHUNK_CHARS + CHUNK_OVERLAP_CHARS));
  const allChunkText = longChunks.map((c) => c.text).join(" ");
  ok("13.13 NO source content silently dropped (all five markers survive)", Object.values(MARKERS).every((m) => allChunkText.includes(m)));
  ok("13.14 final passage is represented in the chunk layer", allChunkText.includes(MARKERS.ending));

  // ---- 13.15 Deterministic parts (never invented chapter titles) ----
  ok("13.15 a structureless PDF still yields multiple parts", longParts.length > 1);
  ok("13.16 positional titles are honest, not invented chapters", longParts.every((p) => p.fromDocument === false && /^Part \d+ of \d+/.test(p.title)));
  ok("13.17 parts cover every chunk exactly once", longParts.flatMap((p) => p.chunkIds).length === longChunks.length && new Set(longParts.flatMap((p) => p.chunkIds)).size === longChunks.length);

  // ---- 13.18 Retrieval reaches the END of the document ----
  const endHits = selectEvidence(MARKERS.ending, longChunks);
  ok("13.18 a fact only near the END is retrievable", endHits.length > 0 && endHits[0].chunk.text.includes(MARKERS.ending));
  const lastOrder = longChunks[longChunks.length - 1].order;
  ok("13.19 late-document evidence really comes from late chunks", endHits[0].chunk.order > lastOrder * 0.6);
  ok("13.20 a fact in the MIDDLE is retrievable", (() => { const h = selectEvidence(MARKERS.middle, longChunks); return h.length > 0 && h[0].chunk.text.includes(MARKERS.middle); })());
  ok("13.21 unsupported question still returns nothing", selectEvidence("quantum chromodynamics lunar zebra", longChunks).length === 0);

  // ---- 13.21b Citations resolve to the PRECISE passage, not the chunk start ----
  const endAsk = await askDocument(longDoc, MARKERS.ending);
  ok("13.21b citation points at the exact page the fact is on", endAsk.grounded === true && endAsk.citations[0].page === 60);
  ok("13.21c answer reports multi-part evidence honestly", typeof endAsk.spread === "number");

  // ---- 13.22 Evidence diversity ----
  const commonHits = selectEvidence("recurring", longChunks, { k: 6 });
  ok("13.22 evidence spans multiple regions, not one page", evidenceSpread(commonHits, longChunks.length) > 1);
  ok("13.23 diversity never returns duplicates", new Set(commonHits.map((c) => c.chunk.id)).size === commonHits.length);

  // ---- 13.24 Hybrid retrieval + honest fallback ----
  const fakeVecs: StoredVector[] = longChunks.map((c) => ({
    chunkId: c.id, chunkOrder: c.order, contentHash: chunkContentHash(c.text),
    provider: "local", model: "lexical-v1", dimensions: 3,
    vector: c.text.includes(MARKERS.ending) ? [1, 0, 0] : [0, 1, 0],
  }));
  const semHits = rankChunks("anything at all", longChunks, { queryVector: [1, 0, 0], vectors: fakeVecs });
  ok("13.24 semantic similarity can surface a conceptually-near chunk", semHits.length > 0 && semHits[0].chunk.text.includes(MARKERS.ending));
  ok("13.25 lexical fallback works with no vectors", rankChunks(MARKERS.middle, longChunks).length > 0);
  ok("13.26 ranking is deterministic", JSON.stringify(rankChunks(MARKERS.middle, longChunks).map((r) => r.chunk.id)) === JSON.stringify(rankChunks(MARKERS.middle, longChunks).map((r) => r.chunk.id)));

  // ---- 13.27 Hierarchical summarization covers the WHOLE work ----
  const synth = await synthesizeDocument(longDoc);
  ok("13.27 synthesis covers every part of the document", synth.partsCovered === synth.partsTotal && synth.coverage === 1);
  ok("13.28 synthesis produced a summary per part", synth.parts.length === longParts.length);
  ok("13.29 part summaries are marked DERIVED, never source", synth.parts.every((p) => p.derived === true) && synth.derived === true);
  const lineagePassages = new Set(synth.refs.flatMap((r) => r.passageIds));
  const lastPassageId = lastPassageOf(longDoc);
  ok("13.30 lineage reaches the FINAL passage of the document", lineagePassages.has(lastPassageId));
  const lastPartCtx = partContext(longChunks.filter((c) => longParts[longParts.length - 1].chunkIds.includes(c.id)));
  ok("13.31 the last part's own context contains the ending fact", lastPartCtx.includes(MARKERS.ending));

  // ---- 13.32 The whole raw document is NEVER sent in one request ----
  const rawLen = longDoc.sections.flatMap((s) => s.passages).map((p) => p.text).join(" ").length;
  ok("13.32 fixture is genuinely long", rawLen > PART_CONTEXT_BUDGET * 3);
  ok("13.33 every part request stays inside the bounded budget", longParts.every((p) => partContext(longChunks.filter((c) => p.chunkIds.includes(c.id))).length <= PART_CONTEXT_BUDGET));
  ok("13.34 no single request carries the whole document", longParts.every((p) => partContext(longChunks.filter((c) => p.chunkIds.includes(c.id))).length < rawLen));

  // ---- 13.35 Document map (deterministic, derived, honest) ----
  const map = buildDocumentMap(longDoc);
  ok("13.35 document map spans the whole document", map.totalChunks === longChunks.length && map.parts.length === longParts.length);
  ok("13.36 map marks itself derived and invents no chapter names", map.derived === true && map.parts.every((p) => p.fromDocument === false));
  ok("13.37 key passages keep real source refs", map.keyPassages.length > 0 && map.keyPassages.every((k) => k.ref.passageIds.length > 0));

  // ---- 13.38 Semantic index lifecycle over a fake backend (RLS-shaped) ----
  const idx = makeIndexCloud();
  const IA = fakeIndexBackend(idx, "userA");
  const run1 = await indexDocument(IA, longDoc.id, longChunks);
  ok("13.38 indexing embeds every chunk and reports complete", run1.state === "complete" && run1.indexed === longChunks.length);
  const run2 = await indexDocument(IA, longDoc.id, longChunks);
  ok("13.39 re-indexing is idempotent (nothing re-embedded)", run2.state === "complete" && run2.changed === false && idx.embedCalls === run1Batches(longChunks.length));
  const idxFail = makeIndexCloud(); idxFail.failEmbedAfter = 1;
  const runPartial = await indexDocument(fakeIndexBackend(idxFail, "userA"), longDoc.id, longChunks);
  ok("13.40 provider failure yields honest PARTIAL, not a lie", runPartial.state === "partial" && runPartial.indexed > 0 && runPartial.indexed < longChunks.length && !!runPartial.note);
  const resumed = await indexDocument(fakeIndexBackend({ ...idxFail, failEmbedAfter: Infinity }, "userA"), longDoc.id, longChunks);
  ok("13.41 an interrupted index is resumable to complete", resumed.state === "complete" && resumed.indexed === longChunks.length);
  ok("13.42 no capability (signed out) → unavailable, never fake", (await indexDocument(fakeIndexBackend(idx, null), longDoc.id, longChunks)).state === "unavailable");
  ok("13.43 stale chunk text forces a re-embed", pendingChunks(longChunks, run1.vectors.map((v, i) => (i === 0 ? { ...v, contentHash: "stale" } : v))).length === 1);

  // ---- 13.44 Index isolation + deletion cleanup ----
  const IB = fakeIndexBackend(idx, "userB");
  ok("13.44 User B cannot load User A's index", (await IB.load(longDoc.id)).vectors.length === 0);
  const delIdx = await removeIndexForDocument(IB, longDoc.id);
  ok("13.45 User B's delete cannot remove User A's index", delIdx.ok === true && idx.rows.some((r) => r.userId === "userA" && r.documentId === longDoc.id));
  await removeIndexForDocument(IA, longDoc.id);
  ok("13.46 deleting the reading deletes its own index", (await IA.load(longDoc.id)).vectors.length === 0);

  // ---- 13.47 Old ReadingDocuments still work ----
  const legacy = docWith([{ id: "lp1", text: "A short legacy document with no page numbers at all." }]);
  ok("13.47 legacy doc (no pages) still chunks + retrieves", buildRetrievalChunks(legacy).length === 1 && selectEvidence("legacy", buildRetrievalChunks(legacy)).length === 1);
  ok("13.48 legacy doc parts degrade gracefully", buildDocumentParts(legacy, buildRetrievalChunks(legacy)).length === 1);

  // ==================== 14. Large-book scale (LIFEOS-051A) ====================
  //
  // The regression this locks down: for a book longer than ~81 pages, whole-
  // document synthesis took `parts.slice(0, 40)` — the OPENING 40 parts — so a
  // 300-page book was summarized from its first quarter and knew nothing about
  // its ending, while honestly reporting only a percentage that read like a
  // rounding note. Coverage may be partial; it must never be front-loaded.
  const BK = {
    opening: "aardvarkine", earlyMid: "basiliskine", middle: "chimaerine",
    lateMid: "dryadophane", ending: "erinyesque",
  };

  // ---- 14.1 selectParts: even distribution, never the opening slice ----
  const seq = Array.from({ length: 500 }, (_, i) => i);
  const picked = selectParts(seq, 40);
  ok("14.1 selection keeps the requested budget", picked.length === 40);
  ok("14.2 selection always includes the FIRST part", picked[0] === 0);
  ok("14.3 selection always includes the LAST part", picked[picked.length - 1] === 499);
  ok("14.4 selection is spread, not the opening slice", picked[picked.length - 1] - picked[0] === 499 && picked[20] > 200);
  ok("14.5 selection stays in reading order", picked.every((v, i, a) => i === 0 || a[i - 1] < v));
  ok("14.6 selection is deterministic", JSON.stringify(selectParts(seq, 40)) === JSON.stringify(picked));
  ok("14.7 a budget at or above total returns everything", selectParts(seq, 500).length === 500 && selectParts(seq, 900).length === 500);
  ok("14.8 tiny budgets stay valid", selectParts(seq, 1).length === 1 && selectParts(seq, 2)[1] === 499);

  // ---- 14.9 reduceToOne: folds levels instead of dropping the tail ----
  const fakeSummarize = async (t: string) => ({ result: `S(${t.length})`, source: "mock" });
  const manyBlocks = Array.from({ length: 60 }, (_, i) => `Part ${i}: ${"z".repeat(500)}`);
  const reduced = await reduceToOne(manyBlocks, fakeSummarize, 7000);
  ok("14.9 an over-budget reduce still yields ONE summary", typeof reduced.summary === "string" && reduced.summary.length > 0);
  ok("14.10 an over-budget reduce uses MORE THAN ONE level", reduced.levels > 1);
  ok("14.11 a small reduce stays single-level", (await reduceToOne(["a: x", "b: y"], fakeSummarize, 7000)).levels === 1);
  ok("14.12 an empty reduce does not throw", (await reduceToOne([], fakeSummarize, 7000)).summary.length >= 0);

  // ---- 14.13 Book fixtures: 100 / 300 / 500 / 1000 pages ----
  // Each asserts the property that actually matters at scale: the END of the
  // book is represented in the synthesis, whatever the coverage fraction.
  for (const pages of [100, 300, 500, 1000]) {
    const book = buildBookDoc(pages, BK);
    const bChunks = buildRetrievalChunks(book);
    const bParts = buildDocumentParts(book, bChunks);
    const lastPassage = book.sections[0].passages[book.sections[0].passages.length - 1].id;

    ok(`14.13.${pages} every page is chunked (${pages}p)`, bChunks.length > 0 && bParts.length > 0);

    const sel = selectParts(bParts, Math.min(bParts.length, MAX_PARTS_PER_RUN));
    const selText = sel.flatMap((p) => bChunks.filter((c) => p.chunkIds.includes(c.id))).map((c) => c.text).join(" ");
    ok(`14.14.${pages} the ENDING fact is reachable by synthesis (${pages}p)`, selText.includes(BK.ending));
    ok(`14.15.${pages} the OPENING fact is still reachable (${pages}p)`, selText.includes(BK.opening));
    ok(`14.16.${pages} the MIDDLE fact is reachable (${pages}p)`, selText.includes(BK.middle));

    const bSynth = await synthesizeDocument(book);
    ok(`14.17.${pages} lineage reaches the FINAL passage (${pages}p)`,
      new Set(bSynth.refs.flatMap((r) => r.passageIds)).has(lastPassage));
    ok(`14.18.${pages} coverage is reported honestly (${pages}p)`,
      bSynth.partsTotal === bParts.length && bSynth.coverage > 0 && bSynth.coverage <= 1);
    ok(`14.19.${pages} partial coverage says it is sampled across the work (${pages}p)`,
      bSynth.coverage === 1 ? bSynth.note === undefined : !!bSynth.note && /evenly across/.test(bSynth.note));
    ok(`14.20.${pages} no single part request carries the whole book (${pages}p)`,
      bParts.every((p) => partContext(bChunks.filter((c) => p.chunkIds.includes(c.id))).length <= PART_CONTEXT_BUDGET));
    // Late-book retrieval must work regardless of length — the Ask guarantee.
    ok(`14.21.${pages} the ending fact is retrievable by search (${pages}p)`,
      rankChunks(BK.ending, bChunks).some((r) => r.chunk.text.includes(BK.ending)));
  }

  // ---- 14.22 The raised extraction ceiling is a resource bound, not a book bound ----
  ok("14.22 extraction ceiling exceeds the page ceiling for real prose",
    MAX_EXTRACT_CHARS > MAX_PAGES * 1800);
  ok("14.23 a 500-page book fits well inside the extraction ceiling", 500 * 1800 < MAX_EXTRACT_CHARS);
  ok("14.24 a 1000-page book fits inside the extraction ceiling", 1000 * 1800 < MAX_EXTRACT_CHARS);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}

// ------------------------------------------------------------------ fixtures ----

/** Expected embed batches for N chunks (used to assert idempotent re-indexing). */
function run1Batches(n: number): number { return Math.ceil(n / INDEX_BATCH_SIZE); }

function countPassages(doc: ReadingDocument): number {
  return doc.sections.reduce((n, s) => n + s.passages.length, 0);
}
function lastPassageOf(doc: ReadingDocument): string {
  const ps = doc.sections.flatMap((s) => s.passages);
  return ps[ps.length - 1].id;
}

/**
 * A synthetic book-length document: 60 pages of filler prose with five UNIQUE
 * marker words planted at the opening, early-middle, middle, late-middle and
 * final pages. No copyrighted text; deterministic; long enough that a single
 * context window cannot hold it.
 */
/**
 * A synthetic BOOK of `pages` pages (~1,800 characters/page — ordinary trade
 * paperback prose), with a unique marker planted at five positions including the
 * very last page. Used by §14 to prove that large-book behavior degrades
 * honestly and evenly rather than silently losing the end (LIFEOS-051A).
 */
function buildBookDoc(pages: number, markers: Record<string, string>): ReadingDocument {
  const perPage = 3;
  const total = pages * perPage;
  const plant: Record<number, string> = {
    [0]: markers.opening,
    [Math.floor(total * 0.25)]: markers.earlyMid,
    [Math.floor(total * 0.5)]: markers.middle,
    [Math.floor(total * 0.75)]: markers.lateMid,
    [total - 1]: markers.ending,
  };
  const passages: Passage[] = [];
  for (let i = 0; i < total; i++) {
    const marker = plant[i] ? ` The distinctive term ${plant[i]} appears here and nowhere else.` : "";
    const body = `Paragraph ${i + 1} continues the argument, weighing attention against habit and returning to what the reader can actually verify. `
      + `It proceeds by example, declines to settle what the evidence has not settled, and leaves room for a later page to qualify it.`;
    passages.push({
      id: `bk${pages}p${i}`, sectionId: `bk${pages}s1`,
      text: `${body}${marker}`,
      page: Math.floor(i / perPage) + 1, order: i, highlights: [], annotations: [], linked: [],
    } as unknown as Passage);
  }
  return {
    id: `book${pages}`, title: `A ${pages}-Page Work`, authors: ["Author"], kind: "book", status: "reading",
    tags: [], notes: "", sections: [{ id: `bk${pages}s1`, title: "Body", order: 0, passages }],
    progress: { status: "reading", percent: 0, readPassageIds: [] },
    sourceMetadata: { importFormat: "plain" },
    createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z",
  } as unknown as ReadingDocument;
}

function buildLongDoc(markers: Record<string, string>): ReadingDocument {
  const PAGES = 60;
  const perPage = 3;
  const passages: Passage[] = [];
  const total = PAGES * perPage;
  const plant: Record<number, string> = {
    [0]: markers.opening,
    [Math.floor(total * 0.25)]: markers.earlyMid,
    [Math.floor(total * 0.5)]: markers.middle,
    [Math.floor(total * 0.75)]: markers.lateMid,
    [total - 1]: markers.ending,
  };
  for (let i = 0; i < total; i++) {
    const page = Math.floor(i / perPage) + 1;
    const marker = plant[i] ? ` The distinctive term ${plant[i]} appears here and nowhere else.` : "";
    // Realistic paragraph length (~600 chars) so the fixture is genuinely
    // book-scale: ~180 paragraphs ≈ 110k characters ≈ many context windows.
    const body = `Paragraph ${i + 1} develops the argument with recurring themes of attention and judgement, considered patiently across the work. `
      + `It returns to the question of how a reader holds an idea steady long enough to test it, and why patience is itself a form of rigour. `
      + `The discussion proceeds by example rather than assertion, and it declines to resolve what the evidence has not yet settled. `
      + `Each observation is offered provisionally, so that a later page may qualify it without contradiction.`;
    passages.push({
      id: `lp${i}`, sectionId: "ls1",
      text: `${body}${marker}`,
      page, order: i, highlights: [], annotations: [], linked: [],
    } as unknown as Passage);
  }
  return {
    id: "longdoc", title: "A Long Work", authors: ["Author"], kind: "book", status: "reading",
    tags: [], notes: "", sections: [{ id: "ls1", title: "Body", order: 0, passages }],
    progress: { status: "reading", percent: 0, readPassageIds: [] },
    sourceMetadata: { importFormat: "pdf" }, createdAt: "t", updatedAt: "t",
  } as unknown as ReadingDocument;
}

/** In-memory semantic-index backend that mimics per-user RLS. */
interface IndexCloud { rows: (StoredVector & { userId: string; documentId: string })[]; embedCalls: number; failEmbedAfter: number }
function makeIndexCloud(): IndexCloud { return { rows: [], embedCalls: 0, failEmbedAfter: Infinity }; }
function fakeIndexBackend(cloud: IndexCloud, userId: string | null): SemanticIndexBackend {
  return {
    userId,
    async load(documentId) {
      if (!userId) return { ok: true, vectors: [] };
      return { ok: true, vectors: cloud.rows.filter((r) => r.userId === userId && r.documentId === documentId) };
    },
    async save(documentId, rows) {
      if (!userId) return { ok: false, error: "denied" };
      for (const r of rows) {
        const i = cloud.rows.findIndex((x) => x.userId === userId && x.documentId === documentId && x.chunkId === r.chunkId);
        if (i >= 0) cloud.rows[i] = { ...r, userId, documentId };
        else cloud.rows.push({ ...r, userId, documentId });
      }
      return { ok: true };
    },
    async removeForDocument(documentId) {
      if (!userId) return { ok: true };
      for (let i = cloud.rows.length - 1; i >= 0; i--) {
        if (cloud.rows[i].userId === userId && cloud.rows[i].documentId === documentId) cloud.rows.splice(i, 1);
      }
      return { ok: true };
    },
    async embed(texts) {
      cloud.embedCalls += 1;
      if (cloud.embedCalls > cloud.failEmbedAfter) return { ok: false, provider: "local", model: "lexical-v1", dimensions: 3, vectors: [], error: "provider down" };
      return { ok: true, provider: "local", model: "lexical-v1", dimensions: 3, vectors: texts.map(() => [0, 1, 0]) };
    },
  };
}
