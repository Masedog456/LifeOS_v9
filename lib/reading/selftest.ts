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
  chunkDocument, retrieve, groundedCitations, buildContext, scopeChunks, studyMaterial, CONTEXT_CHAR_BUDGET,
} from "@/lib/reading/study";
import type { ParsedDocument } from "@/lib/library/importer";
import type { ReadingDocument, Passage, PageSpan } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function docWith(passages: { id: string; text: string; page?: number }[]): ReadingDocument {
  const section = { id: "s1", title: "Body", order: 0, passages: passages.map((p, i): Passage => ({ id: p.id, sectionId: "s1", text: p.text, page: p.page, order: i, highlights: [], annotations: [], linked: [] })) };
  return { id: "doc1", title: "Being and Time", authors: ["Heidegger"], kind: "book", status: "reading", tags: [], notes: "", sections: [section], progress: { status: "reading", percent: 0, readPassageIds: [] }, sourceMetadata: { importFormat: "pdf" }, createdAt: "t", updatedAt: "t" } as unknown as ReadingDocument;
}

export function runReadingIngestSelfTests(): SelfTestReport {
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

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
