"use client";

/**
 * Reading workspace (LIFEOS-028, Features 3–8, 14).
 *
 * A three-pane reader: left = document navigation, center = passage reader,
 * right = annotations + linked knowledge + notes. Users highlight text
 * (deterministic character spans), write markdown notes, and convert any passage
 * or highlight into a capture / belief / concept / question / research /
 * synthesis using the existing canonical creators — each conversion writes a
 * Citation back to the exact location. Keyboard: J/K move passages, H highlights
 * the selection, N adds a note, Esc clears. The layout collapses to a single
 * column on mobile with tab switches.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  addAnnotation, addHighlight, convertPassage, markPassageRead, openDocumentAt,
  removeAnnotation, removeHighlight, setDocumentNotes, setDocumentStatus, useStore,
  type ConversionTarget,
} from "@/lib/mvpStore";
import { resolveRecord } from "@/lib/command/records";
import { isTypingTarget } from "@/lib/command/shortcuts";
import { flatten, nextPassageId, prevPassageId, findPassage, sectionOfPassage } from "@/lib/library/reader";
import { HIGHLIGHT_COLORS, COLOR_HEX } from "@/lib/library/highlights";
import { renderMarkdownInline } from "@/lib/library/annotations";
import { STATUS_LABEL, READING_STATUSES, estimatedMinutesRemaining } from "@/lib/library/progress";
import SyncStatus from "@/components/SyncStatus";
import EntityLink from "@/components/entity/EntityLink";
import { trackOpenDocument, trackReading } from "@/lib/workspaces/tracking";
import type { HighlightColor, Passage, ReadingDocument } from "@/types/mvp";

const CONVERSIONS: { target: ConversionTarget; label: string }[] = [
  { target: "capture", label: "Capture" },
  { target: "belief", label: "Belief" },
  { target: "concept", label: "Concept" },
  { target: "question", label: "Question" },
  { target: "research", label: "Research" },
  { target: "synthesis", label: "Synthesis" },
];

/** Absolute char offsets of the current selection within `container`. */
function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(container);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end } : null;
}

/** Render passage text with inline highlight marks (sorted, non-overlapping). */
function PassageText({ passage }: { passage: Passage }) {
  const marks = [...passage.highlights].sort((a, b) => a.start - b.start);
  const segs: React.ReactNode[] = [];
  let cursor = 0;
  for (const h of marks) {
    if (h.start < cursor || h.end > passage.text.length) continue; // skip overlaps / stale
    if (h.start > cursor) segs.push(passage.text.slice(cursor, h.start));
    segs.push(<mark key={h.id} id={`hl-${h.id}`} title={h.note || undefined} style={{ background: COLOR_HEX[h.color] }} className="rounded px-0.5 text-inherit">{passage.text.slice(h.start, h.end)}</mark>);
    cursor = h.end;
  }
  if (cursor < passage.text.length) segs.push(passage.text.slice(cursor));
  return <>{segs}</>;
}

function Reader() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const docId = params?.id ?? "";
  const doc = useMemo<ReadingDocument | undefined>(() => state.documents.find((d) => d.id === docId), [state.documents, docId]);

  const flat = useMemo(() => (doc ? flatten(doc) : []), [doc]);
  const [focusOverride, setFocusOverride] = useState<string>("");
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [convertOpen, setConvertOpen] = useState(false);
  const [toast, setToast] = useState<{ label: string; href: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [mobilePane, setMobilePane] = useState<"read" | "notes">("read");
  const passageRefs = useRef<Map<string, HTMLElement>>(new Map());

  // The focused passage: an explicit user choice, else ?passage / saved position
  // / the first passage. Computed (no init effect → no setState-in-effect).
  const focusId = focusOverride || search.get("passage") || doc?.progress.currentPassageId || flat[0]?.passage.id || "";
  const setFocusId = setFocusOverride;

  // Record the open position when the focused passage changes (external store
  // sync, not React state — safe in an effect).
  useEffect(() => {
    if (!doc || !focusId) return;
    const section = sectionOfPassage(doc, focusId);
    openDocumentAt(doc.id, section?.id, focusId);
    passageRefs.current.get(focusId)?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, docId]);

  // Feed the active thinking session's timeline when a document is opened/read.
  useEffect(() => {
    if (!doc) return;
    trackOpenDocument(doc.id, doc.title);
    trackReading(doc.id, doc.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const doHighlight = useCallback(() => {
    if (!doc || !focusId) return;
    const el = passageRefs.current.get(focusId);
    const passage = findPassage(doc, focusId);
    if (!el || !passage) return;
    const off = selectionOffsets(el) ?? { start: 0, end: passage.text.length };
    addHighlight(doc.id, focusId, off.start, off.end, color);
    window.getSelection()?.removeAllRanges();
  }, [doc, focusId, color]);

  const doConvert = useCallback((target: ConversionTarget) => {
    if (!doc || !focusId) return;
    const res = convertPassage(doc.id, focusId, target);
    setConvertOpen(false);
    if (res) {
      const live = resolveRecord(state, res.kind, res.id);
      setToast({ label: `Created ${target}`, href: live?.href ?? "/" });
      setTimeout(() => setToast(null), 6000);
    }
  }, [doc, focusId, state]);

  const addNote = useCallback(() => {
    if (!doc || !focusId || !noteDraft.trim()) return;
    addAnnotation(doc.id, focusId, noteDraft);
    setNoteDraft("");
  }, [doc, focusId, noteDraft]);

  // Keyboard navigation (guarded against typing).
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") { e.preventDefault(); setFocusId(nextPassageId(doc, focusId) ?? focusId); }
      else if (k === "k") { e.preventDefault(); setFocusId(prevPassageId(doc, focusId) ?? focusId); }
      else if (k === "h") { e.preventDefault(); doHighlight(); }
      else if (k === "n") { e.preventDefault(); setMobilePane("notes"); document.getElementById("note-input")?.focus(); }
      else if (e.key === "Escape") { window.getSelection()?.removeAllRanges(); setConvertOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, doHighlight, focusId, setFocusId]);

  if (!mounted) return <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening…</p></main>;
  if (!doc) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <p className="text-sm text-zinc-500">That document doesn&apos;t exist.</p>
        <Link href="/reading" className="mt-3 inline-block text-sm text-zinc-500 underline underline-offset-4">← Reading</Link>
      </main>
    );
  }

  const focusPassage = focusId ? findPassage(doc, focusId) : undefined;
  const position = flat.findIndex((f) => f.passage.id === focusId);
  const progressPct = flat.length ? Math.round(((position + 1) / flat.length) * 100) : 0;
  const isRead = focusPassage ? doc.progress.readPassageIds.includes(focusPassage.id) : false;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      {/* Header */}
      <header className="mb-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/reading" className="text-xs text-zinc-500 underline-offset-4 hover:underline">← Reading</Link>
          <SyncStatus />
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
            <p className="text-[11px] text-zinc-400">
              {doc.authors.map((a, i) => (
                <span key={a}>{i > 0 ? ", " : ""}<Link href={`/reading/author/${encodeURIComponent(a)}`} className="hover:underline">{a}</Link></span>
              ))}
              {doc.authors.length === 0 && "Unknown author"} · {doc.progress.percent}% read · ~{estimatedMinutesRemaining(doc)} min left
            </p>
          </div>
          <select value={doc.status} onChange={(e) => setDocumentStatus(doc.id, e.target.value as ReadingDocument["status"])} aria-label="Reading status" className="rounded-full border border-black/[.12] bg-transparent px-3 py-1.5 text-[11px] dark:border-white/[.15]">
            {READING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-zinc-800 dark:bg-zinc-200" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      {/* Mobile pane switch */}
      <div className="mb-3 flex gap-1 sm:hidden">
        <button type="button" onClick={() => setMobilePane("read")} aria-pressed={mobilePane === "read"} className={`rounded-full px-3 py-1 text-[11px] ${mobilePane === "read" ? "bg-black/[.08] font-medium dark:bg-white/[.12]" : "text-zinc-500"}`}>Read</button>
        <button type="button" onClick={() => setMobilePane("notes")} aria-pressed={mobilePane === "notes"} className={`rounded-full px-3 py-1 text-[11px] ${mobilePane === "notes" ? "bg-black/[.08] font-medium dark:bg-white/[.12]" : "text-zinc-500"}`}>Notes & links</button>
      </div>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[200px_minmax(0,1fr)_280px]">
        {/* Left: navigation */}
        <nav aria-label="Document sections" className="hidden lg:block">
          <div className="sticky top-4 max-h-[80vh] overflow-y-auto text-sm">
            {doc.sections.map((s) => (
              <div key={s.id} className="mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{s.title}</p>
                {s.passages.map((p) => (
                  <button key={p.id} type="button" onClick={() => setFocusId(p.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-[12px] ${p.id === focusId ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}>
                    {p.heading || p.text.slice(0, 40)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        {/* Center: reader */}
        <div className={mobilePane === "read" ? "block" : "hidden sm:block"}>
          {doc.sections.map((s) => (
            <section key={s.id} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">{s.title}</h2>
              {s.passages.map((p) => (
                <div
                  key={p.id}
                  ref={(el) => { if (el) passageRefs.current.set(p.id, el); }}
                  onClick={() => setFocusId(p.id)}
                  className={`group mb-3 rounded-lg border-l-2 py-2 pl-3 pr-2 ${p.id === focusId ? "border-zinc-800 bg-black/[.02] dark:border-zinc-200 dark:bg-white/[.03]" : "border-transparent"}`}
                >
                  {p.heading && <p className="mb-1 text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">{p.heading}</p>}
                  <p className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-100"><PassageText passage={p} /></p>
                  {p.id === focusId && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1" role="group" aria-label="Highlight color">
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button key={c} type="button" aria-label={`Highlight ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={`h-4 w-4 rounded-full border ${color === c ? "ring-2 ring-offset-1 ring-zinc-400" : ""}`} style={{ background: COLOR_HEX[c] }} />
                        ))}
                      </div>
                      <button type="button" onClick={doHighlight} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15]">Highlight</button>
                      <div className="relative">
                        <button type="button" onClick={() => setConvertOpen((v) => !v)} aria-expanded={convertOpen} className="rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] hover:bg-black/[.04] dark:border-white/[.15]">Convert ▾</button>
                        {convertOpen && (
                          <div className="absolute z-10 mt-1 w-40 rounded-lg border border-black/[.10] bg-white p-1 shadow-lg dark:border-white/[.12] dark:bg-zinc-900">
                            {CONVERSIONS.map((c) => (
                              <button key={c.target} type="button" onClick={() => doConvert(c.target)} className="block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-black/[.05] dark:hover:bg-white/[.06]">Create {c.label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => markPassageRead(doc.id, p.id, !isRead)} className={`rounded-full border px-2.5 py-1 text-[11px] ${isRead ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-black/[.12] dark:border-white/[.15]"}`}>{isRead ? "✓ Read" : "Mark read"}</button>
                      {p.linked.length > 0 && <span className="text-[10px] text-zinc-400">{p.linked.length} linked</span>}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}

          <div className="flex items-center justify-between border-t border-black/[.06] pt-3 text-[11px] text-zinc-400 dark:border-white/[.08]">
            <button type="button" onClick={() => setFocusId(prevPassageId(doc, focusId) ?? focusId)} className="rounded-full border border-black/[.12] px-3 py-1.5 dark:border-white/[.15]">← Prev (K)</button>
            <span>{position + 1} / {flat.length}</span>
            <button type="button" onClick={() => setFocusId(nextPassageId(doc, focusId) ?? focusId)} className="rounded-full border border-black/[.12] px-3 py-1.5 dark:border-white/[.15]">Next (J) →</button>
          </div>
        </div>

        {/* Right: annotations, linked knowledge, notes */}
        <aside className={`${mobilePane === "notes" ? "block" : "hidden sm:block"}`}>
          <div className="sticky top-4 flex max-h-[82vh] flex-col gap-4 overflow-y-auto">
            {focusPassage ? (
              <>
                <div>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Notes on this passage</h3>
                  <textarea id="note-input" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={2} placeholder="Add a note (markdown, ⏎ to keep typing)…" className="w-full resize-none rounded-lg border border-black/[.10] bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-black/[.25] dark:border-white/[.12]" />
                  <button type="button" onClick={addNote} disabled={!noteDraft.trim()} className="mt-1 rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Add note</button>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {focusPassage.annotations.map((a) => (
                      <li key={a.id} className="rounded-lg bg-black/[.03] px-2.5 py-1.5 text-[13px] dark:bg-white/[.04]">
                        <span dangerouslySetInnerHTML={{ __html: renderMarkdownInline(a.text) }} />
                        <button type="button" onClick={() => removeAnnotation(doc.id, a.id)} aria-label="Delete note" className="ml-2 text-[10px] text-zinc-400 hover:text-red-500">✕</button>
                      </li>
                    ))}
                  </ul>
                </div>

                {focusPassage.highlights.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Highlights</h3>
                    <ul className="flex flex-col gap-1">
                      {focusPassage.highlights.map((h) => (
                        <li key={h.id} className="flex items-start gap-1.5 text-[12px]">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_HEX[h.color] }} />
                          <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">“{h.text.length > 80 ? h.text.slice(0, 79) + "…" : h.text}”</span>
                          <button type="button" onClick={() => removeHighlight(doc.id, h.id)} aria-label="Remove highlight" className="text-[10px] text-zinc-400 hover:text-red-500">✕</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {focusPassage.linked.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Linked knowledge</h3>
                    <ul className="flex flex-col gap-1">
                      {focusPassage.linked.map((l, i) => {
                        const live = resolveRecord(state, l.kind, l.id);
                        return (
                          <li key={`${l.kind}:${l.id}:${i}`}>
                            {live ? <EntityLink kind={l.kind} id={l.id} className="text-[12px] text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200">{l.kind}: {live.title.slice(0, 44)}</EntityLink> : <span className="text-[12px] text-zinc-400">{l.kind} (removed)</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            ) : <p className="text-[13px] text-zinc-400">Select a passage to annotate.</p>}

            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Document notes</h3>
              <textarea value={doc.notes} onChange={(e) => setDocumentNotes(doc.id, e.target.value)} rows={3} placeholder="General reading notes (markdown)…" className="w-full resize-y rounded-lg border border-black/[.10] bg-transparent px-2.5 py-1.5 text-[13px] outline-none dark:border-white/[.12]" />
            </div>

            <div className="text-[10px] text-zinc-400">
              <p className="mb-1 font-semibold uppercase tracking-wide">Keyboard</p>
              <p>J/K next/prev · H highlight · N note · Esc clear</p>
            </div>
          </div>
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-black/[.10] bg-white px-4 py-2 text-sm shadow-lg dark:border-white/[.12] dark:bg-zinc-900">
          {toast.label} — <Link href={toast.href} className="underline underline-offset-2">open →</Link>
        </div>
      )}
    </main>
  );
}

export default function DocumentPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10" />}><Reader /></Suspense>;
}
