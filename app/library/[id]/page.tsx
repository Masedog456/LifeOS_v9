"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  beliefsFromSource,
  patchSource,
  saveQuote,
  sendToInbox,
  setOriginalText,
  setSourceStatus,
  sourceById,
  useStore,
} from "@/lib/mvpStore";
import { analyzeSource, cancelAnalysis, estimateCalls, runStage } from "@/lib/pipeline";
import { extractPdf } from "@/lib/ingestion/pdfExtract";
import { askQuestion, generateBeliefs } from "@/lib/aiClient";
import { PROCESSING_LABELS, SOURCE_TYPE_LABELS, isProcessing } from "@/lib/labels";
import { buildRecords } from "@/lib/retrieval/records";
import { relatedTo } from "@/lib/retrieval/search";
import RetrievalResults from "@/components/RetrievalResults";
import type { ExtractionStatus, KnowledgeSource, StageName } from "@/types/mvp";

const EXTRACTION_LABELS: Record<ExtractionStatus, string> = {
  text_extracted: "Text extracted",
  partial_text: "Partial text extracted",
  scanned_ocr_required: "Scanned PDF — OCR required",
  extraction_failed: "Extraction failed",
};

export default function ReaderPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const state = useStore();
  const source = sourceById(state, id);

  const [note, setNote] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [showRelated, setShowRelated] = useState(false);

  // Contextual retrieval from OTHER sources — deterministic, collapsed by
  // default, and excluding this source's own records.
  const relatedElsewhere = useMemo(() => {
    if (!source || !showRelated) return [];
    const seed = source.summary || source.title;
    return relatedTo(seed, buildRecords(state), state.feedback, {
      excludeSourceId: id,
      semantic: state.embeddings.length > 0,
    });
  }, [showRelated, source, id, state]);

  // Mark as "reading" the first time it's opened.
  useEffect(() => {
    if (source && source.status === "unread") setSourceStatus(id, "reading");
  }, [id, source]);

  if (!source) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <p className="text-zinc-600 dark:text-zinc-300">Source not found.</p>
        <Link href="/library" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          ← Back to Library
        </Link>
      </main>
    );
  }

  const hasText = source.originalText.trim().length > 0;
  const related = beliefsFromSource(state, id);

  function selectedText(): string {
    return (window.getSelection?.()?.toString() ?? "").trim();
  }

  function saveHighlight() {
    const sel = selectedText();
    if (!sel) return setNote("Select some text in the passage first.");
    saveQuote(id, sel);
    setNote("Quote saved.");
  }

  async function sendSelection() {
    const sel = selectedText();
    if (!sel) return setNote("Select some text in the passage first.");
    setSending(true);
    const { result, source: aiSrc } = await generateBeliefs(sel);
    sendToInbox(sel, result, aiSrc, id);
    setSending(false);
    setNote(`Sent ${result.length} candidate belief${result.length === 1 ? "" : "s"} to your Inbox.`);
  }

  function sendCandidate(candidate: string) {
    sendToInbox(candidate, [{ claim: candidate }], source!.derivedSource ?? "mock", id);
    setNote("Sent to Inbox.");
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    const { result } = await askQuestion(source!.originalText.slice(0, 8000), question.trim());
    setAnswer(result);
    setAsking(false);
  }

  function provideText() {
    if (!pasted.trim()) return;
    if (setOriginalText(id, pasted.trim())) void analyzeSource(id, pasted.trim(), "quick");
    setPasted("");
  }

  // Re-upload a PDF to retry extraction (the binary is never stored).
  async function retryExtract(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setNote("Extracting…");
    const r = await extractPdf(file);
    patchSource(id, {
      extractionStatus: r.status,
      pageMap: r.ok ? r.pageMap : [],
      pdfMeta: {
        filename: file.name,
        size: file.size,
        pageCount: r.pageCount,
        mime: file.type || "application/pdf",
        uploadedAt: new Date().toISOString(),
        extractedPages: r.extractedPages,
      },
    });
    if (r.ok && setOriginalText(id, r.text)) {
      setNote(null);
      void analyzeSource(id, r.text, "quick");
    } else {
      setNote(r.message ?? "Extraction failed.");
    }
  }

  function pageForOffset(offset: number): number | undefined {
    return source!.pageMap?.find((p) => offset >= p.start && offset < p.end)?.page;
  }
  function pageForQuote(quote: string): number | undefined {
    const i = source!.originalText.indexOf(quote);
    return i < 0 ? undefined : pageForOffset(i);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <Link href="/library" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
        ← Library
      </Link>

      {/* Metadata */}
      <header className="mt-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-black/[.05] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-white/[.08]">
            {SOURCE_TYPE_LABELS[source.type]}
          </span>
          <span className="text-xs text-zinc-400">
            {isProcessing(source.processingState) && "⏳ "}
            {PROCESSING_LABELS[source.processingState]}
            {source.derivedSource === "mock" && source.processingState === "ready" && " · mock"}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{source.title}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {source.author && <span>{source.author} · </span>}
          {source.origin && <span>{source.origin} · </span>}
          {source.pdfMeta && (
            <span>
              {source.pdfMeta.pageCount} page{source.pdfMeta.pageCount === 1 ? "" : "s"} ·{" "}
              {Math.max(1, Math.round(source.pdfMeta.size / 1024))} KB ·{" "}
            </span>
          )}
          added {new Date(source.addedAt).toLocaleDateString()}
        </p>
        {source.extractionStatus && (
          <p className="mt-1 text-xs text-zinc-400">
            PDF: {EXTRACTION_LABELS[source.extractionStatus]}
            {source.pdfMeta && source.extractionStatus === "partial_text" &&
              ` (${source.pdfMeta.extractedPages}/${source.pdfMeta.pageCount} pages)`}
          </p>
        )}
        {source.processingError && (
          <p className="mt-2 text-sm text-red-500">Processing error: {source.processingError}</p>
        )}
      </header>

      {note && (
        <p className="mb-4 rounded-lg bg-black/[.03] px-3 py-2 text-sm text-zinc-600 dark:bg-white/[.05] dark:text-zinc-300">
          {note}
        </p>
      )}

      {/* Needs text (PDF/URL awaiting body) */}
      {!hasText ? (
        <section className="rounded-2xl border border-dashed border-black/[.12] p-5 dark:border-white/[.14]">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {source.extractionStatus === "scanned_ocr_required"
              ? "This looks like a scanned PDF — no selectable text was found. OCR isn't available yet; you can re-upload a text-based PDF or paste the text below."
              : source.input === "pdf"
                ? "Couldn't extract text from this PDF. Re-upload a text-based PDF to retry, or paste the text below."
                : `This ${SOURCE_TYPE_LABELS[source.type].toLowerCase()} source needs its text. Paste it below to process it.`}
          </p>
          {source.input === "pdf" && (
            <div className="mt-3">
              <label className="text-xs text-zinc-500">Retry extraction: </label>
              <input
                type="file"
                accept="application/pdf"
                onChange={retryExtract}
                className="text-sm"
              />
            </div>
          )}
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={8}
            placeholder="Paste the text of this source…"
            className="mt-3 w-full resize-none rounded-lg border border-black/[.10] bg-transparent p-3 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]"
          />
          <button
            type="button"
            onClick={provideText}
            disabled={!pasted.trim()}
            className="mt-3 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Set text & process
          </button>
        </section>
      ) : (
        <>
          <AnalysisPanel source={source} />

          {/* Derived: summary + concepts */}
          {source.summary && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Summary</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {source.summary}
              </p>
            </section>
          )}
          {source.keyConcepts.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Concepts</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {source.keyConcepts.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-black/[.10] px-2.5 py-0.5 text-xs text-zinc-600 dark:border-white/[.12] dark:text-zinc-300"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Reader */}
          <section className="mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Read</h2>
            <div className="mt-2 rounded-2xl border border-black/[.06] p-5 text-[15px] leading-relaxed text-zinc-800 dark:border-white/[.08] dark:text-zinc-200">
              {source.pageMap && source.pageMap.length > 0 ? (
                source.pageMap
                  .filter((p) => p.end > p.start)
                  .map((p) => (
                    <div key={p.page} className="mb-4">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-300 dark:text-zinc-600">
                        Page {p.page}
                      </div>
                      <div className="whitespace-pre-wrap">
                        {source.originalText.slice(p.start, p.end)}
                      </div>
                    </div>
                  ))
              ) : (
                <div className="whitespace-pre-wrap">{source.originalText}</div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">Select text, then:</span>
              <button
                type="button"
                onClick={saveHighlight}
                className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
              >
                Save quote
              </button>
              <button
                type="button"
                onClick={sendSelection}
                disabled={sending}
                className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {sending ? "Sending…" : "Send to Belief Inbox"}
              </button>
            </div>
          </section>

          {/* Ask one AI question */}
          <section className="mb-6 mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ask</h2>
            <div className="mt-2 flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Ask one question about this source…"
                className="flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]"
              />
              <button
                type="button"
                onClick={ask}
                disabled={asking || !question.trim()}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {asking ? "…" : "Ask"}
              </button>
            </div>
            {answer && (
              <p className="mt-3 rounded-lg bg-black/[.03] px-3 py-2 text-sm leading-relaxed text-zinc-700 dark:bg-white/[.05] dark:text-zinc-300">
                {answer}
              </p>
            )}
          </section>

          {/* Key quotes */}
          {source.keyQuotes.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Key quotes</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {source.keyQuotes.map((q, i) => {
                  const page = pageForQuote(q);
                  return (
                    <li
                      key={i}
                      className="border-l-2 border-zinc-300 pl-3 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                    >
                      {q}
                      {page !== undefined && (
                        <span className="ml-1 text-xs text-zinc-400">· p. {page}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Candidate beliefs → inbox (never auto) */}
          {source.candidateBeliefs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Candidate beliefs
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Send any of these to the Belief Inbox to judge them — nothing enters your
                Constitution automatically.
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {source.candidateBeliefs.map((c, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">{c}</span>
                    <button
                      type="button"
                      onClick={() => sendCandidate(c)}
                      className="shrink-0 rounded-full border border-black/[.12] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
                    >
                      Send to Inbox
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Related beliefs (provenance the other direction) */}
          {related.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Beliefs from this source
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {related.map((b) => (
                  <li key={b.id} className="text-sm text-zinc-700 dark:text-zinc-300">
                    <Link href="/beliefs" className="underline-offset-4 hover:underline">
                      {b.text}
                    </Link>
                    <span className="ml-2 text-xs text-zinc-400">({b.status})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Related from OTHER sources — collapsed contextual retrieval */}
          <section className="mb-6">
            <button
              type="button"
              onClick={() => setShowRelated((s) => !s)}
              className="text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {showRelated ? "Hide" : "Find"} related from your library
            </button>
            {showRelated && (
              <div className="mt-2">
                {relatedElsewhere.length > 0 ? (
                  <RetrievalResults results={relatedElsewhere} />
                ) : (
                  <p className="text-sm text-zinc-400">
                    Nothing else in your library looks closely related yet.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Footer controls */}
          <footer className="mt-8 flex flex-wrap items-center gap-3 border-t border-black/[.05] pt-4 dark:border-white/[.06]">
            {source.status !== "read" && (
              <button
                type="button"
                onClick={() => setSourceStatus(id, "read")}
                className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Mark as read
              </button>
            )}
            <Link
              href={`/compare?add=${id}`}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Compare with another source →
            </Link>
            <Link
              href={`/inquiry?add=${id}&q=${encodeURIComponent(`What does ${source.title} imply about `)}`}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Investigate this passage →
            </Link>
            <Link
              href={`/threads?seedType=source&seedId=${id}&title=${encodeURIComponent(source.title)}`}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Add to Megathread →
            </Link>
            <Link
              href={`/reason?mode=influence_trace&source=${id}&q=${encodeURIComponent(`What did ${source.title} influence?`)}`}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Trace influence →
            </Link>
            <Link
              href={`/formation?source=${id}&type=book_integration`}
              className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Integrate into your life →
            </Link>
          </footer>
        </>
      )}
    </main>
  );
}

const STAGES: StageName[] = ["summary", "quotes", "concepts", "beliefs"];

/**
 * Minimal analysis controls (LIFEOS-007): Quick / Full, per-stage retry,
 * status, coverage label, and an approximate AI-call count. No dashboard.
 */
function AnalysisPanel({ source }: { source: KnowledgeSource }) {
  const a = source.analysis;
  const busy = isProcessing(source.processingState);
  const quick = estimateCalls(source.id, "quick");
  const full = estimateCalls(source.id, "full");

  const coverage =
    a?.coverage === "full"
      ? "Full coverage"
      : a?.coverage === "sampled"
        ? `Sampled — ${a.chunksAnalyzed} of ${a.totalChunks} chunks`
        : "Not analyzed yet";

  return (
    <section className="mb-6 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Analysis</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {coverage}
            {a?.source === "ai" && " · AI"}
            {a?.source === "mock" && " · mock"}
            {a?.unmatchedQuotes ? ` · ${a.unmatchedQuotes} unmatched quote(s) dropped` : ""}
          </p>
        </div>
        <span className="text-xs text-zinc-400">
          {isProcessing(source.processingState) && "⏳ "}
          {PROCESSING_LABELS[source.processingState]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy ? (
          <button
            type="button"
            onClick={() => cancelAnalysis(source.id)}
            className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void analyzeSource(source.id, source.originalText, "quick")}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Quick analysis (~{quick} call{quick === 1 ? "" : "s"})
            </button>
            <button
              type="button"
              onClick={() => void analyzeSource(source.id, source.originalText, "full")}
              className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
            >
              Full analysis (~{full} call{full === 1 ? "" : "s"})
            </button>
          </>
        )}
      </div>

      {source.stages && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span>Stages:</span>
          {STAGES.map((st) => {
            const status = source.stages![st];
            return (
              <button
                key={st}
                type="button"
                disabled={busy}
                onClick={() => void runStage(source.id, st)}
                title={`Re-run ${st}`}
                className="rounded-full px-2 py-0.5 hover:bg-black/[.04] disabled:opacity-40 dark:hover:bg-white/[.06]"
              >
                {st}
                {status === "failed" ? " ⚠︎ retry" : status === "processed" ? " ↻" : ""}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
