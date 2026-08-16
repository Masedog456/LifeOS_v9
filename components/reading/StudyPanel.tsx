"use client";

/**
 * Ask · Summarize · Study (LIFEOS-047, Features 7–10) — a restrained AI layer
 * that sits UNDER reading, never over it. It is hidden until the reader opens it,
 * and everything it produces is grounded in THIS document's own passages:
 *
 *   - Ask       : answers strictly from retrieved passages; if the document
 *                 doesn't cover the question it says so and offers no citations,
 *                 rather than answering from general knowledge.
 *   - Summarize : a summary of the whole document or the current section, with
 *                 the passages it drew from listed as clickable citations.
 *   - Study     : deterministic, on-device key ideas / questions / flashcards,
 *                 each linked back to a real passage. Nothing here becomes a
 *                 belief or edits Knowledge on its own.
 *
 * Citations are page/passage references from the deterministic retrieval, never
 * parsed out of the model — so a page number is never invented. "Save to LifeOS"
 * reuses the existing convertPassage / addAnnotation creators, so anything saved
 * keeps a citation home on the exact passage it came from. Provenance of the AI
 * result (your configured provider vs. an on-device deterministic draft) is shown
 * plainly.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { addAnnotation, convertPassage, useStore, type ConversionTarget } from "@/lib/mvpStore";
import { resolveRecord } from "@/lib/command/records";
import {
  askDocument, summarizeScope, studyMaterial,
  type GroundedAnswer, type GroundedSummary, type SourceRef, type SummaryScope,
} from "@/lib/reading/study";
import { ORIGIN_LABEL, withAttribution, type OriginType } from "@/lib/provenance";
import type { ReadingDocument } from "@/types/mvp";
import { DEGRADED_MESSAGE } from "@/lib/aiClient";

type Mode = "ask" | "summarize" | "study";

/**
 * Human-readable line about where an AI result came from (privacy/transparency).
 *
 * The non-AI branch deliberately names both possible causes instead of asserting
 * one. It previously read "no AI provider is configured", which is false in the
 * two cases where a provider IS configured but did not answer: `/api/ai` returns
 * `source: "mock", degraded: true` when the provider call fails, and `aiClient`
 * falls back to `source: "mock"` when the fetch itself fails. Neither carries the
 * reason this far — `degraded` is dropped in `aiClient.call` — so the honest
 * statement is the one that holds in every case (LIFEOS-050C).
 *
 * Distinguishing "not configured" from "unreachable" would mean threading a flag
 * through aiClient, both study entry points, their two result interfaces and the
 * LIFEOS-049 synthesis path. That is worth doing when something depends on the
 * difference; it is not worth risking the reading suite for a caption.
 */
function sourceNote(source: string): string {
  return source === "ai"
    ? "Answered by your configured AI provider, using only the passages below."
    : "Answered on your device with a deterministic draft — no AI provider answered (either none is configured, or it couldn't be reached).";
}

function CitationList({ doc, cites, onJump }: { doc: ReadingDocument; cites: SourceRef[]; onJump: (passageId: string) => void }) {
  if (cites.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">From your document</p>
      <ul className="flex flex-col gap-1">
        {cites.map((c, i) => (
          <li key={`${c.passageId}:${i}`}>
            <button
              type="button"
              onClick={() => onJump(c.passageId)}
              className="w-full text-left text-[12px] text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-300"
              title="Jump to this passage"
            >
              <span className="font-medium text-zinc-800 dark:text-zinc-100">{c.page ? `${doc.title}, p. ${c.page}` : doc.title}</span>
              {" — "}
              <span className="text-zinc-500">“{c.snippet}{c.snippet.length >= 160 ? "…" : ""}”</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Save-to-LifeOS row — grounded on the primary cited passage; never auto-adds. */
function SaveRow({ doc, passageId, text, title, origin, onSaved }: { doc: ReadingDocument; passageId?: string; text: string; title?: string; origin: OriginType; onSaved: (label: string, href?: string) => void }) {
  const state = useStore();
  if (!passageId || !text.trim()) return null;
  const targets: { target: ConversionTarget; label: string }[] = [
    { target: "question", label: "Save as question" },
    { target: "research", label: "Save to Research" },
    { target: "belief", label: "Propose as belief" },
  ];
  const save = (target: ConversionTarget) => {
    const res = convertPassage(doc.id, passageId, target, { text: text.trim(), title: title?.trim(), origin });
    if (res) onSaved(`Saved to ${target === "research" ? "Research" : target}`, resolveRecord(state, res.kind, res.id)?.href);
  };
  const saveNote = () => {
    // A note is structurally user-authored material. Saving machine prose into
    // one verbatim would launder it, and the annotation model has no provenance
    // field — so the attribution is written into the note itself, where it
    // survives editing, export and re-import (LIFEOS-050). Adoption is never
    // inferred: if the user later rewrites this in their own words, that is
    // their act, not ours.
    const body = withAttribution(text.trim(), origin, "saved from Ask & study");
    const noteId = addAnnotation(doc.id, passageId, body);
    if (noteId) onSaved("Saved as a note on this passage");
  };
  const machine = origin !== "original_source" && origin !== "user_authored";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {machine && (
        <span className="mr-0.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400" title="Saved material is marked as AI-generated and is never used as source evidence.">
          {ORIGIN_LABEL[origin]}
        </span>
      )}
      <button type="button" onClick={saveNote} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15]">Save as note</button>
      {targets.map((t) => (
        <button key={t.target} type="button" onClick={() => save(t.target)} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15]">{t.label}</button>
      ))}
    </div>
  );
}

export default function StudyPanel({ doc, sectionId, onJump }: { doc: ReadingDocument; sectionId?: string; onJump: (passageId: string) => void }) {
  const [mode, setMode] = useState<Mode>("ask");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [summary, setSummary] = useState<GroundedSummary | null>(null);
  const [scope, setScope] = useState<SummaryScope>("document");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ label: string; href?: string } | null>(null);

  // Study material is deterministic + on-device — compute it directly (no await).
  const study = useMemo(() => studyMaterial(doc), [doc]);

  const flashSaved = useCallback((label: string, href?: string) => {
    setSaved({ label, href });
    setTimeout(() => setSaved(null), 6000);
  }, []);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true); setAnswer(null);
    try { setAnswer(await askDocument(doc, q)); }
    finally { setBusy(false); }
  }, [doc, question, busy]);

  const doSummarize = useCallback(async (s: SummaryScope) => {
    if (busy) return;
    setScope(s); setBusy(true); setSummary(null);
    try { setSummary(await summarizeScope(doc, s, { sectionId })); }
    finally { setBusy(false); }
  }, [doc, sectionId, busy]);

  const primaryPassage = (answer?.citations[0] ?? summary?.citations[0])?.passageId;

  return (
    <section data-study-panel className="mb-5 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <div className="mb-1 flex items-center gap-1.5" role="tablist" aria-label="Study this document">
        {(["ask", "summarize", "study"] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"}`}>
            {m === "ask" ? "Ask" : m === "summarize" ? "Summarize" : "Study"}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[11px] text-zinc-400">
        Grounded in this document only. Ask and Summarize send just the relevant passages to your AI provider; Study runs entirely on your device. The source stays primary — your judgment decides what to keep.
      </p>

      {mode === "ask" && (
        <div>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
              placeholder="Ask a question about this document…"
              aria-label="Ask a question about this document"
              className="min-w-0 flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12]"
            />
            <button type="button" onClick={() => void ask()} disabled={busy || !question.trim()} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">{busy ? "Thinking…" : "Ask"}</button>
          </div>
          {answer && (
            <div data-study-answer data-grounded={answer.grounded ? "true" : "false"} className="mt-3 rounded-xl bg-black/[.02] p-3 text-sm dark:bg-white/[.03]">
              <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">{answer.answer}</p>
              {answer.grounded ? (
                <>
                  <p className="mt-2 text-[10px] text-zinc-400">{sourceNote(answer.source)}</p>
                  {/* Say WHY it degraded — an expired session is not a missing
                      API key, and telling users to set one wasted their time. */}
                  {answer.degradedReason && (
                    <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                      {DEGRADED_MESSAGE[answer.degradedReason]}
                    </p>
                  )}
                  <CitationList doc={doc} cites={answer.citations} onJump={onJump} />
                  <SaveRow doc={doc} passageId={primaryPassage} text={answer.answer} title={question.trim()} origin="conqify_ai" onSaved={flashSaved} />
                </>
              ) : (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">No grounded answer — nothing was saved, and this isn&apos;t drawn from the document.</p>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "summarize" && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void doSummarize("document")} disabled={busy} className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${scope === "document" ? "bg-black/[.08] font-medium dark:bg-white/[.12]" : "border border-black/[.12] dark:border-white/[.15]"}`}>Whole document</button>
            <button type="button" onClick={() => void doSummarize("section")} disabled={busy || !sectionId} className={`rounded-full px-3 py-1.5 text-xs disabled:opacity-40 ${scope === "section" ? "bg-black/[.08] font-medium dark:bg-white/[.12]" : "border border-black/[.12] dark:border-white/[.15]"}`}>This section</button>
          </div>
          {busy && <p className="mt-3 text-[13px] text-zinc-400">Summarizing the source…</p>}
          {summary && !busy && (
            <div data-study-summary className="mt-3 rounded-xl bg-black/[.02] p-3 text-sm dark:bg-white/[.03]">
              <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">{summary.summary}</p>
              <p className="mt-2 text-[10px] text-zinc-400">{sourceNote(summary.source)}</p>
              <CitationList doc={doc} cites={summary.citations} onJump={onJump} />
              <SaveRow doc={doc} passageId={summary.citations[0]?.passageId} text={summary.summary} title={`Summary of ${doc.title}`} origin="conqify_ai" onSaved={flashSaved} />
            </div>
          )}
        </div>
      )}

      {mode === "study" && (
        <div className="flex flex-col gap-4">
          <p className="text-[11px] text-zinc-400">Generated study aids, drawn from this document&apos;s own passages. Nothing here changes your beliefs or Knowledge — save what you find useful.</p>
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Key ideas</h4>
            <ul className="flex flex-col gap-2">
              {study.keyIdeas.map((k, i) => (
                <li key={`${k.ref.passageId}:${i}`} className="rounded-lg bg-black/[.02] p-2.5 text-[13px] dark:bg-white/[.03]">
                  <button type="button" onClick={() => onJump(k.ref.passageId)} className="text-left text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100">
                    {k.text} {k.ref.page ? <span className="text-[11px] text-zinc-400">· p. {k.ref.page}</span> : null}
                  </button>
                  <SaveRow doc={doc} passageId={k.ref.passageId} text={k.text} title={k.text} origin="original_source" onSaved={flashSaved} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Questions to test yourself</h4>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-zinc-700 dark:text-zinc-200">
              {study.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Flashcards</h4>
            <ul className="flex flex-col gap-1.5">
              {study.flashcards.map((f, i) => (
                <li key={`${f.ref.passageId}:${i}`} className="rounded-lg border border-black/[.08] p-2.5 text-[13px] dark:border-white/[.10]">
                  <p className="font-medium text-zinc-800 dark:text-zinc-100">{f.front}</p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{f.back}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {saved && (
        <p className="mt-3 text-[12px] text-emerald-600 dark:text-emerald-400">
          ✓ {saved.label}{saved.href ? <> — <Link href={saved.href} className="underline underline-offset-2">open →</Link></> : null}
        </p>
      )}
    </section>
  );
}
