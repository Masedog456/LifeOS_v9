"use client";

/**
 * Import details (LIFEOS-049) — the honest answer to "did we import the whole
 * thing?", shown as a quiet, collapsed line in the Reader that expands into
 * plain facts.
 *
 * Deliberately consumer-language only: pages, words, passages, sections. No
 * vectors, chunks-as-jargon, database tables, or provider names. Documents
 * imported before this sprint carry no report — we say the details weren't
 * recorded rather than inventing a completeness claim.
 */

import { useMemo, useState } from "react";
import { buildRetrievalChunks } from "@/lib/reading/chunking";
import { completenessHeadline, type IngestionReport } from "@/lib/reading/completeness";
import type { ReadingDocument } from "@/types/mvp";

function isReport(v: unknown): v is IngestionReport {
  return !!v && typeof v === "object" && "extraction" in (v as Record<string, unknown>);
}

const fmt = (n: number) => n.toLocaleString();

export default function ImportDetails({ doc }: { doc: ReadingDocument }) {
  const [open, setOpen] = useState(false);
  const report = isReport(doc.sourceMetadata.ingestion) ? doc.sourceMetadata.ingestion : null;
  // Chunk count is derived live so it stays true even for older documents.
  const chunkCount = useMemo(() => buildRetrievalChunks(doc).length, [doc]);
  const passageCount = useMemo(
    () => doc.sections.reduce((n, s) => n + s.passages.length, 0),
    [doc],
  );

  const complete = report?.extraction === "complete";
  const partial = report?.extraction === "partial";

  return (
    <div data-import-details className="text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${partial ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {complete ? "Whole document imported" : partial ? "Some pages couldn't be read" : "Import details"}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-black/[.08] bg-black/[.015] p-3 dark:border-white/[.10] dark:bg-white/[.02]">
          {report ? (
            <>
              <p className={`mb-2 ${partial ? "text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-300"}`}>
                {completenessHeadline(report)}
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-500">
                {report.pageCount > 0 && (
                  <>
                    <dt>Pages in the file</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(report.pageCount)}</dd>
                    <dt>Pages with readable text</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(report.readablePages)}</dd>
                  </>
                )}
                <dt>Words imported</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">~{fmt(report.words)}</dd>
                <dt>Passages</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(passageCount)}</dd>
                <dt>Searchable sections</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(chunkCount)}</dd>
                <dt>Original file</dt>
                <dd className="text-right text-zinc-700 dark:text-zinc-200">
                  {/* The recorded state, not a live check. The reader strip
                      verifies the object is actually resolvable before it says
                      "safely stored" (LIFEOS-075 §4); this panel must not make
                      the stronger claim on weaker evidence. */}
                  {doc.sourceMetadata.originalStored ? "Stored" : "Not stored"}
                </dd>
              </dl>
              {report.warnings.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-amber-700 dark:text-amber-300">
                  {report.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              )}
              {partial && (
                <p className="mt-2 text-zinc-500">
                  You can still read and study everything that was imported. To include the
                  missing pages, add them as a separate reading.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mb-2 text-zinc-600 dark:text-zinc-300">
                Import details weren&apos;t recorded for this reading — it was added before LifeOS
                started keeping them. Everything below is counted from the document itself.
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-500">
                <dt>Passages</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(passageCount)}</dd>
                <dt>Searchable sections</dt><dd className="text-right tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(chunkCount)}</dd>
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}
