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
import { useStore } from "@/lib/mvpStore";
import { readingDashboard, documentStats } from "@/lib/library/documents";
import { getPinned } from "@/lib/command/recent";
import { STATUS_LABEL } from "@/lib/library/progress";
import SyncStatus from "@/components/SyncStatus";
import AddReadingPanel from "@/components/reading/AddReadingPanel";
import type { ReadingDocument } from "@/types/mvp";

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
        <button type="button" onClick={() => setShowImport((v) => !v)} className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">＋ Add reading</button>
      </header>

      {showImport && <AddReadingPanel onDone={(id) => router.push(`/document/${id}`)} onCancel={() => setShowImport(false)} />}

      {dash.total === 0 && !showImport ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          <p>Nothing here yet. Upload a PDF, Word doc, or text file — or paste an article — to start reading inside LifeOS.</p>
          <button type="button" onClick={() => setShowImport(true)} className="mt-2 rounded-full border border-black/[.12] px-4 py-2 text-sm hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Add your first reading →</button>
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

export default function ReadingPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}><ReadingHome /></Suspense>;
}
