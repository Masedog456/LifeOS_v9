/**
 * Reading companion self-tests (LIFEOS-028).
 *
 * Fixture-driven, deterministic assertions for the whole reading foundation —
 * import parsing, section/passage generation, assembly, reader navigation,
 * progress tracking, highlights, annotations, citation generation + source-
 * reference lookup, search integration, and a performance budget. Surfaced at
 * `/dev/reading-tests`, asserted by the `reading.mjs` E2E suite. Pure: no store,
 * no localStorage, no AI.
 */

import type { StoreState } from "@/types/mvp";
import { parseInput, passageCount } from "@/lib/library/importer";
import { assembleDocument, readingDashboard, readingStreak, authors, documentStats, type NewDocumentInput } from "@/lib/library/documents";
import { flatten, nextPassageId, prevPassageId, firstPassageOfSection, passagePosition } from "@/lib/library/reader";
import { withPassageRead, withStatus, estimatedMinutesRemaining, recomputePercent } from "@/lib/library/progress";
import { makeHighlight, overlaps } from "@/lib/library/highlights";
import { makeAnnotation, renderMarkdownInline } from "@/lib/library/annotations";
import { makeCitation, formatCitation, citationHref, citationsForRecord, primaryCitation } from "@/lib/library/citations";
import { buildSearchEntries } from "@/lib/command/records";
import { searchFlat } from "@/lib/command/search";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** Deterministic id/clock for reproducible fixtures. */
function idClock(seed = 0) {
  let n = seed;
  return { id: () => `id-${++n}`, now: () => new Date(Date.parse("2026-08-15T00:00:00.000Z") + n * 1000).toISOString() };
}

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [],
  };
}

const MD = `# On Attention

Attention is the rarest and purest form of generosity.

It is also finite.

## Distraction

The modern world is engineered to fragment focus.

### A note

Reclaiming attention is a discipline.`;

const SAMPLE: NewDocumentInput = {
  title: "The Attention Essays",
  subtitle: "On focus and distraction",
  authors: ["Simone Weil", "simone weil"], // duplicate spelling → deduped
  publication: "Collected Works",
  kind: "book",
  content: MD,
  format: "markdown",
};

function check(results: SelfTestResult[], name: string, cond: boolean, detail = ""): void {
  results.push({ name, pass: Boolean(cond), detail: cond ? detail || "ok" : detail || "assertion failed" });
}

export function runReadingSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];

  // ---- Import parsing + section/passage generation ----
  const { parsed, format } = parseInput(MD, "markdown");
  check(results, "import: markdown detected", format === "markdown");
  check(results, "import: headings become sections", parsed.sections.length === 2 && parsed.sections[0].title === "On Attention" && parsed.sections[1].title === "Distraction");
  check(results, "import: paragraphs become passages", parsed.sections[0].passages.length === 2);
  check(results, "import: '###' becomes a passage heading", parsed.sections[1].passages.some((p) => p.heading === "A note"));
  check(results, "import: passageCount counts all", passageCount(parsed) === 4, `got ${passageCount(parsed)}`);
  const plain = parseInput("First para.\n\nSecond para.\n\nThird.", "plain");
  check(results, "import: plain text → one section, N passages", plain.parsed.sections.length === 1 && plain.parsed.sections[0].passages.length === 3);
  check(results, "import: deterministic (same input → same output)", JSON.stringify(parseInput(MD, "markdown")) === JSON.stringify(parseInput(MD, "markdown")));

  // ---- Assembly ----
  const doc = assembleDocument(SAMPLE, idClock());
  check(results, "assemble: title + subtitle set", doc.title === "The Attention Essays" && doc.subtitle === "On focus and distraction");
  check(results, "assemble: authors de-duplicated", doc.authors.length === 1 && doc.authors[0] === "Simone Weil");
  check(results, "assemble: sections + passages built", doc.sections.length === 2 && doc.sections.flatMap((s) => s.passages).length === 4);
  check(results, "assemble: passages carry sectionId + order", doc.sections[0].passages.every((p, i) => p.sectionId === doc.sections[0].id && p.order === i));
  check(results, "assemble: progress starts not_started at 0%", doc.progress.status === "not_started" && doc.progress.percent === 0 && doc.progress.readPassageIds.length === 0);
  check(results, "assemble: cover tint deterministic", assembleDocument(SAMPLE, idClock()).coverColor === doc.coverColor);
  const stats = documentStats(doc);
  check(results, "assemble: stats count passages + words", stats.passages === 4 && stats.words > 0);

  // ---- Reader navigation ----
  const flat = flatten(doc);
  check(results, "reader: flatten preserves reading order", flat.length === 4 && flat[0].index === 0 && flat[3].index === 3);
  const first = flat[0].passage.id;
  const second = flat[1].passage.id;
  check(results, "reader: next passage", nextPassageId(doc, first) === second);
  check(results, "reader: prev passage clamps at start", prevPassageId(doc, first) === first);
  check(results, "reader: next clamps at end", nextPassageId(doc, flat[3].passage.id) === flat[3].passage.id);
  check(results, "reader: section jump → first passage of section", firstPassageOfSection(doc, doc.sections[1].id) === doc.sections[1].passages[0].id);
  check(results, "reader: passage position 0–100", passagePosition(doc, flat[3].passage.id) === 100);

  // ---- Progress tracking ----
  const total = 4;
  let prog = doc.progress;
  prog = withPassageRead(prog, first, true, total, "2026-08-15T01:00:00Z");
  check(results, "progress: reading a passage sets 'reading' + 25%", prog.status === "reading" && prog.percent === 25, `${prog.status}/${prog.percent}`);
  for (const f of flat) prog = withPassageRead(prog, f.passage.id, true, total, "2026-08-15T02:00:00Z");
  check(results, "progress: all read → completed + 100% + finishedAt", prog.status === "completed" && prog.percent === 100 && Boolean(prog.finishedAt));
  check(results, "progress: recomputePercent handles empty", recomputePercent([], 0) === 0 && recomputePercent(["a", "a"], 4) === 25);
  const paused = withStatus(doc.progress, "paused", "2026-08-15T03:00:00Z");
  check(results, "progress: explicit status set", paused.status === "paused");
  check(results, "progress: estimated minutes remaining > 0 for unread", estimatedMinutesRemaining(doc) > 0);

  // ---- Highlights ----
  const passageText = doc.sections[0].passages[0].text;
  const hl = makeHighlight("p1", passageText, 0, 9, "yellow", idClock(50));
  check(results, "highlight: captures the exact span text", hl !== null && hl.text === passageText.slice(0, 9) && hl.color === "yellow");
  check(results, "highlight: empty selection → null", makeHighlight("p1", passageText, 5, 5, "green", idClock()) === null);
  check(results, "highlight: out-of-range clamps", makeHighlight("p1", passageText, -5, 9999, "blue", idClock())?.end === passageText.length);
  check(results, "highlight: overlap detection", overlaps({ start: 0, end: 5 }, { start: 3, end: 8 }) && !overlaps({ start: 0, end: 3 }, { start: 3, end: 6 }));

  // ---- Annotations ----
  check(results, "annotation: trims + builds", makeAnnotation("p1", "  a note  ", idClock())?.text === "a note");
  check(results, "annotation: empty → null", makeAnnotation("p1", "   ", idClock()) === null);
  check(results, "annotation: markdown renders + escapes", renderMarkdownInline("**bold** <script>") === "<strong>bold</strong> &lt;script&gt;");

  // ---- Citations (source references) ----
  const section = doc.sections[0];
  const passage = section.passages[0];
  const cite = makeCitation(doc, { section, passage }, { kind: "capture", id: "cap-9" }, idClock(100));
  check(results, "citation: links record → document location", cite.recordKind === "capture" && cite.recordId === "cap-9" && cite.documentId === doc.id && cite.sectionId === section.id && cite.passageId === passage.id);
  check(results, "citation: caches title + author", cite.documentTitle === doc.title && cite.author === "Simone Weil");
  check(results, "citation: href returns to the passage", citationHref(cite) === `/document/${doc.id}?passage=${passage.id}`);
  check(results, "citation: formats readably", /Simone Weil/.test(formatCitation(cite)) && /Attention Essays/.test(formatCitation(cite)));
  const state = emptyState();
  state.documents = [doc];
  state.citations = [cite];
  check(results, "citation: reverse lookup record → source", citationsForRecord(state, "capture", "cap-9").length === 1 && primaryCitation(state, "capture", "cap-9")?.id === cite.id);

  // ---- Search integration (reuses LIFEOS-027) ----
  const index = buildSearchEntries(state);
  check(results, "search: documents indexed", index.some((e) => e.kind === "document" && e.id === doc.id));
  check(results, "search: passages indexed", index.filter((e) => e.kind === "passage").length === 4);
  check(results, "search: authors indexed", index.some((e) => e.kind === "author"));
  const found = searchFlat(index, "attention essays");
  check(results, "search: finds the document by title", found[0]?.entry.kind === "document");
  check(results, "search: passage body searchable", searchFlat(index, "generosity").some((r) => r.entry.kind === "passage"));

  // ---- Dashboard + authors ----
  const dash = readingDashboard(state);
  check(results, "dashboard: unread bucket", dash.unread.some((d) => d.id === doc.id) && dash.total === 1);
  check(results, "dashboard: authors projected", authors(state).some((a) => a.name === "Simone Weil" && a.documentCount === 1));
  check(results, "dashboard: streak from lastOpened", readingStreak([{ ...doc, progress: { ...doc.progress, lastOpenedAt: new Date().toISOString() } }]) >= 1);

  // ---- Performance: assemble + index a large document ----
  const bigContent = Array.from({ length: 800 }, (_, i) => `# Section ${i}\n\nPassage body number ${i} about attention and focus.`).join("\n\n");
  const p0 = Date.now();
  const big = assembleDocument({ title: "Big", authors: ["A"], content: bigContent, format: "markdown" }, idClock());
  const bigState = emptyState(); bigState.documents = [big];
  const bigIndex = buildSearchEntries(bigState);
  const hits = searchFlat(bigIndex, "attention").length;
  const perfMs = Date.now() - p0;
  check(results, "perf: assemble + index a large doc under budget", perfMs < 1000, `${perfMs}ms, ${bigIndex.length} entries, ${hits} hits`);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
