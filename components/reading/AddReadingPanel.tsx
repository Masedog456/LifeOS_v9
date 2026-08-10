"use client";

/**
 * "Add reading" — the one obvious way to bring something you're reading into
 * LifeOS (LIFEOS-047, Features 1–5). Upload a file, add a link, or paste text;
 * it's extracted, page provenance is preserved for PDFs, and it opens in the
 * existing Reader. Honest processing states; scanned/encrypted/corrupt PDFs are
 * explained, not faked. No infrastructure jargon is shown to the user.
 */

import { useCallback, useRef, useState } from "react";
import { useStore, createReadingFromParsed } from "@/lib/mvpStore";
import { extractPdf } from "@/lib/ingestion/pdfExtract";
import {
  validateUpload, ingestText, contentHash, findDuplicate, safeFilename,
  type ReadingFormat, type ProcessingState,
} from "@/lib/reading/ingest";
import { toast } from "@/lib/ux/feedback";

type Tab = "upload" | "link" | "paste";
type Status = { state: ProcessingState | "idle"; message?: string };

export default function AddReadingPanel({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const state = useStore();
  const [tab, setTab] = useState<Tab>("upload");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [dup, setDup] = useState<{ id: string; title: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Paste / link fields.
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [url, setUrl] = useState("");

  const finish = useCallback((title: string, author: string | undefined, format: "plain" | "markdown", parsed: { sections: { title: string; passages: { heading?: string; text: string; page?: number; location?: string }[] }[] }, meta: Parameters<typeof createReadingFromParsed>[0]["sourceMetadata"]) => {
    const id = createReadingFromParsed({ title, authors: author ? [author] : undefined, parsed, sourceMetadata: meta });
    toast({ kind: "success", message: "Added to your reading" });
    onDone(id);
  }, [onDone]);

  const handleFile = useCallback(async (file: File) => {
    setDup(null);
    const v = validateUpload({ name: file.name, size: file.size, type: file.type });
    if (!v.ok || !v.format) { setStatus({ state: "failed", message: v.reason }); return; }
    const fmt: ReadingFormat = v.format;
    setStatus({ state: "uploading", message: `Reading “${safeFilename(file.name)}”…` });

    try {
      let text = ""; let pageMap = undefined as ReturnType<typeof Array.prototype.slice> | undefined; let pageCount: number | undefined; let note: string | undefined;
      if (fmt === "pdf") {
        setStatus({ state: "processing", message: "Extracting the text and pages…" });
        const res = await extractPdf(file);
        if (!res.ok) { setStatus({ state: res.status === "extraction_failed" && /scanned|readable/i.test(res.message ?? "") ? "needs_attention" : "failed", message: res.message ?? "We couldn't read this PDF." }); return; }
        text = res.text; pageMap = res.pageMap as unknown as typeof pageMap; pageCount = res.pageCount;
      } else if (fmt === "txt" || fmt === "markdown") {
        setStatus({ state: "processing", message: "Reading the text…" });
        text = await file.text();
      } else {
        // DOCX extraction is a documented next increment — never a fake success.
        setStatus({ state: "needs_attention", message: "Word (.docx) files aren't readable inside LifeOS yet. For now, paste the text using “Paste text”." });
        return;
      }

      // Duplicate detection (safe, deterministic — never deletes anything).
      const hash = contentHash(text);
      const existing = findDuplicate(state.documents, hash);
      if (existing) { setDup({ id: existing.id, title: existing.title }); setStatus({ state: "idle" }); return; }

      const out = ingestText({
        text, addMethod: "upload", format: fmt, filename: file.name, mimeType: file.type,
        sizeBytes: file.size, pageMap: pageMap as never, pageCount, now: new Date().toISOString(),
      });
      if (!out.ok) { setStatus({ state: out.state, message: out.reason }); return; }
      const meta = { importFormat: fmt === "markdown" ? "markdown" as const : fmt === "pdf" ? "pdf" as const : "plain" as const, ...out.doc.provenance, note };
      finish(out.doc.title, out.doc.author, out.doc.format, out.doc.parsed, meta as never);
    } catch {
      setStatus({ state: "failed", message: "Something went wrong reading that file. Your file wasn't changed — you can try again." });
    }
  }, [state.documents, finish]);

  const submitPaste = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;
    const existing = findDuplicate(state.documents, contentHash(text));
    if (existing) { setDup({ id: existing.id, title: existing.title }); return; }
    const out = ingestText({ text, title: pasteTitle, addMethod: "paste", format: /^\s*#{1,6}\s/m.test(text) ? "markdown" : "txt", now: new Date().toISOString() });
    if (!out.ok) { setStatus({ state: out.state, message: out.reason }); return; }
    finish(out.doc.title || "Pasted text", undefined, out.doc.format, out.doc.parsed, { importFormat: out.doc.format, ...out.doc.provenance } as never);
  }, [pasteText, pasteTitle, state.documents, finish]);

  const submitLink = useCallback(() => {
    const text = pasteText.trim();
    if (!/^https?:\/\//i.test(url.trim())) { setStatus({ state: "failed", message: "Enter a valid link starting with http:// or https://" }); return; }
    if (!text) { setStatus({ state: "needs_attention", message: "LifeOS can't fetch arbitrary links yet. Paste the article's text below and we'll keep the link with it." }); return; }
    const out = ingestText({ text, title: pasteTitle, addMethod: "link", format: /^\s*#{1,6}\s/m.test(text) ? "markdown" : "txt", url: url.trim(), now: new Date().toISOString() });
    if (!out.ok) { setStatus({ state: out.state, message: out.reason }); return; }
    finish(out.doc.title || url.trim(), undefined, out.doc.format, out.doc.parsed, { importFormat: out.doc.format, ...out.doc.provenance, importedFrom: url.trim() } as never);
  }, [url, pasteText, pasteTitle, finish]);

  const busy = status.state === "uploading" || status.state === "processing";

  return (
    <section data-add-reading className="mb-6 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1.5" role="tablist" aria-label="Add reading">
          {(["upload", "link", "paste"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => { setTab(t); setStatus({ state: "idle" }); setDup(null); }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"}`}>
              {t === "upload" ? "Upload a file" : t === "link" ? "Add a link" : "Paste text"}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Cancel</button>
      </div>

      {dup ? (
        <div data-add-duplicate className="rounded-xl border border-amber-500/30 bg-amber-500/[.05] p-4 text-sm">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">Already in your library</p>
          <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">&ldquo;{dup.title}&rdquo; looks like the same document.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onDone(dup.id)} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Open existing</button>
            <button type="button" onClick={() => { setDup(null); if (tab === "upload") fileInput.current?.click(); }} className="rounded-full border border-black/[.12] px-4 py-1.5 text-xs dark:border-white/[.15]">Upload another copy</button>
          </div>
        </div>
      ) : tab === "upload" ? (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? "border-zinc-500 bg-black/[.03] dark:bg-white/[.04]" : "border-black/[.12] dark:border-white/[.15]"}`}
          >
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Drag a file here, or choose one</p>
            <p className="mt-1 text-xs text-zinc-500">PDF, Word (.docx), plain text, or Markdown — up to 25 MB.</p>
            <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Choose a file</button>
            <input ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown,.docx,application/pdf,text/plain,text/markdown" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
          </div>
        </div>
      ) : tab === "link" ? (
        <div className="flex flex-col gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link" className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} placeholder="Paste the article's text here — LifeOS keeps the link with it." aria-label="Text" className="resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <button type="button" onClick={submitLink} className="self-start rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Add reading</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={7} placeholder="Paste plain text or Markdown. Headings become sections; paragraphs become passages. Nothing is sent anywhere — it's all read right here on your device." aria-label="Text" className="resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" />
          <button type="button" disabled={!pasteText.trim()} onClick={submitPaste} className="self-start rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Add reading</button>
        </div>
      )}

      {status.state !== "idle" && !dup && (
        <p data-add-status={status.state} className={`mt-3 text-[13px] ${status.state === "failed" ? "text-rose-600 dark:text-rose-400" : status.state === "needs_attention" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}>
          {busy && <span aria-hidden className="mr-1 inline-block animate-pulse">•</span>}
          {status.message ?? status.state}
        </p>
      )}
    </section>
  );
}
