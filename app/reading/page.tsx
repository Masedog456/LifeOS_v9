"use client";

/**
 * Library Home (LIFEOS-028, Feature 12) — the reading dashboard + importer.
 *
 * A projection over the document library: currently reading, continue reading,
 * unread, completed, recent highlights and notes, a reading streak, and pinned
 * documents. The import panel turns pasted plain text or Markdown into a
 * structured document (deterministic parser — no AI). All entry points link to
 * the reader at /document/[id].
 */

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createDocument, useStore } from "@/lib/mvpStore";
import { readingDashboard, documentStats, parsedPassages } from "@/lib/library/documents";
import { checkImportSize } from "@/lib/library/importer";
import { getPinned } from "@/lib/command/recent";
import { STATUS_LABEL } from "@/lib/library/progress";
import SyncStatus from "@/components/SyncStatus";
import type { DocumentKind, ReadingDocument } from "@/types/mvp";

const KIND_OPTIONS: DocumentKind[] = ["book", "article", "essay", "paper", "transcript", "lecture_notes", "journal_article", "report", "other"];

function ReadingHome() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [showImport, setShowImport] = useState(params.get("new") === "1");

  const dash = useMemo(() => readingDashboard(state), [state]);
  const pinnedDocs = mounted ? getPinned(state).filter((p) => p.kind === "document") : [];

  if (!mounted) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Opening your library…</p></main>;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reading</h1>
          <p className="mt-1 text-sm text-zinc-500">Import a document and gradually turn it into captures, beliefs, concepts, and research — every derived record keeps a citation home. {dash.streakDays > 0 && <span className="text-emerald-600 dark:text-emerald-400">🔥 {dash.streakDays}-day streak</span>}</p>
          <div className="mt-1.5"><SyncStatus /></div>
        </div>
        <button type="button" onClick={() => setShowImport((v) => !v)} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">＋ Add document</button>
      </header>

      {showImport && <ImportPanel onDone={(id) => router.push(`/document/${id}`)} onCancel={() => setShowImport(false)} />}

      {dash.total === 0 && !showImport ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          <p>No documents yet. Import a book, article, or transcript to start reading inside LifeOS.</p>
          <button type="button" onClick={() => setShowImport(true)} className="mt-2 rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Import your first document →</button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {pinnedDocs.length > 0 && (
            <Section title="Pinned">
              {pinnedDocs.map((p) => <DocRow key={p.id} doc={state.documents.find((d) => d.id === p.id)} />)}
            </Section>
          )}
          <Section title="Currently reading" show={dash.currentlyReading.length > 0}>{dash.currentlyReading.map((d) => <DocRow key={d.id} doc={d} />)}</Section>
          <Section title="Continue reading" show={dash.continueReading.length > 0}>{dash.continueReading.map((d) => <DocRow key={d.id} doc={d} />)}</Section>
          <Section title="Unread" show={dash.unread.length > 0}>{dash.unread.map((d) => <DocRow key={d.id} doc={d} />)}</Section>
          <Section title="Completed" show={dash.completed.length > 0}>{dash.completed.map((d) => <DocRow key={d.id} doc={d} />)}</Section>

          {dash.recentHighlights.length > 0 && (
            <Section title="Recent highlights">
              {dash.recentHighlights.map((h) => (
                <Link key={h.id} href={`/document/${h.documentId}?passage=${h.passageId}&highlight=${h.id}`} className="block rounded-lg border-l-2 border-amber-400 py-1 pl-3 text-sm text-zinc-700 hover:underline dark:text-zinc-200">
                  “{h.text.length > 100 ? h.text.slice(0, 99) + "…" : h.text}” <span className="text-[11px] text-zinc-400">· {h.documentTitle}</span>
                </Link>
              ))}
            </Section>
          )}
          {dash.recentAnnotations.length > 0 && (
            <Section title="Recent notes">
              {dash.recentAnnotations.map((a) => (
                <Link key={a.id} href={`/document/${a.documentId}?passage=${a.passageId}`} className="block py-1 text-sm text-zinc-700 hover:underline dark:text-zinc-200">
                  {a.text.length > 100 ? a.text.slice(0, 99) + "…" : a.text} <span className="text-[11px] text-zinc-400">· {a.documentTitle}</span>
                </Link>
              ))}
            </Section>
          )}
        </div>
      )}
    </main>
  );
}

function Section({ title, show = true, children }: { title: string; show?: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function DocRow({ doc }: { doc: ReadingDocument | undefined }) {
  if (!doc) return null;
  const stats = documentStats(doc);
  return (
    <Link href={`/document/${doc.id}`} className="flex items-center gap-3 rounded-xl border border-black/[.06] p-3 transition-colors hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
      <span aria-hidden className="h-10 w-8 shrink-0 rounded" style={{ background: doc.coverColor ?? "#e5e7eb" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{doc.title}</span>
        <span className="block truncate text-[11px] text-zinc-400">{doc.authors.join(", ") || "Unknown author"} · {STATUS_LABEL[doc.status]} · {stats.passages} passages{stats.highlights > 0 ? ` · ${stats.highlights} highlights` : ""}</span>
      </span>
      <span className="shrink-0 text-[11px] text-zinc-400">{doc.progress.percent}%</span>
    </Link>
  );
}

function ImportPanel({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [kind, setKind] = useState<DocumentKind>("book");
  const [format, setFormat] = useState<"markdown" | "plain">("markdown");
  const [content, setContent] = useState("");
  const [confirmLarge, setConfirmLarge] = useState(false);
  const passages = content.trim() ? parsedPassages(content, format) : 0;
  const size = checkImportSize(content);

  const submit = () => {
    if (!title.trim() || !content.trim()) return;
    if (!size.ok) return;                       // hard-blocked (too large)
    if (size.warn && !confirmLarge) return;     // needs explicit confirmation
    const id = createDocument({
      title, kind, format,
      authors: authors.split(",").map((a) => a.trim()).filter(Boolean),
      content,
    });
    onDone(id);
  };

  return (
    <div className="mb-6 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <h2 className="text-sm font-semibold">Import a document</h2>
      <p className="mt-0.5 text-[11px] text-zinc-400">Paste plain text or Markdown. Headings become sections; paragraphs become passages. Nothing is sent anywhere — it&apos;s all parsed right here on your device.</p>
      <div className="mt-3 flex flex-col gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Document title" className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12]" />
        <div className="flex flex-wrap gap-2">
          <input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Author(s), comma-separated" aria-label="Authors" className="min-w-40 flex-1 rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
          <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} aria-label="Document kind" className="rounded-lg border border-black/[.10] bg-transparent px-2 py-2 text-sm outline-none dark:border-white/[.12]">
            {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
          </select>
          <select value={format} onChange={(e) => setFormat(e.target.value as "markdown" | "plain")} aria-label="Import format" className="rounded-lg border border-black/[.10] bg-transparent px-2 py-2 text-sm outline-none dark:border-white/[.12]">
            <option value="markdown">Markdown</option>
            <option value="plain">Plain text</option>
          </select>
        </div>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} placeholder="Paste the document text here…" aria-label="Document content" className="w-full resize-y rounded-lg border border-black/[.10] bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-black/[.25] dark:border-white/[.12]" />
        {size.message && (
          <div className={`rounded-lg px-3 py-2 text-[11px] ${size.ok ? "bg-amber-500/[.10] text-amber-700 dark:text-amber-300" : "bg-rose-500/[.10] text-rose-700 dark:text-rose-300"}`} role="alert">
            {size.message}
            {size.ok && size.warn && (
              <label className="mt-1 flex items-center gap-1.5">
                <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} /> Import this large document anyway
              </label>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">{passages} passage{passages === 1 ? "" : "s"} detected · {Math.round(size.chars / 1000)} KB</span>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] text-zinc-500 dark:border-white/[.15]">Cancel</button>
            <button type="button" onClick={submit} disabled={!title.trim() || !content.trim() || !size.ok || (size.warn && !confirmLarge)} className="rounded-full bg-zinc-900 px-5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Import & read →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReadingPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}><ReadingHome /></Suspense>;
}
