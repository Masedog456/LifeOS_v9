"use client";

/**
 * QuickCapture (LIFEOS-027, Feature 5).
 *
 * Create a capture without leaving the current page. The default flow is tiny —
 * one textarea and Save — with advanced fields (title, source, tags, and an
 * optional "then start" destination) tucked in a collapsible section. It reuses
 * the canonical `addCapture` store action (no shadow write path), preserves
 * unsaved text across accidental closes (a localStorage draft), guards against
 * duplicate submission, confirms success with a direct link, and restores focus
 * to the previous page on close.
 *
 * Capture's canonical record is `{ text, sourceId? }`; an optional title and
 * tags are folded deterministically into that single text field (a capture is
 * free text) rather than inventing new storage — no schema change.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addCapture, useStore } from "@/lib/mvpStore";

const DRAFT_KEY = "lifeos.quickcapture.draft.v1";

/** Read any preserved draft once, synchronously, for lazy state initialization. */
function readDraft(): { content: string; title: string; tags: string } {
  if (typeof window === "undefined") return { content: "", title: "", tags: "" };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) { const d = JSON.parse(raw); return { content: d.content ?? "", title: d.title ?? "", tags: d.tags ?? "" }; }
  } catch { /* ignore */ }
  return { content: "", title: "", tags: "" };
}

// Mounted only while open (see CommandCenter), so lazy initializers restore any
// preserved draft on mount — no reset effect needed.
export default function QuickCapture({ onClose }: { onClose: () => void }) {
  const state = useStore();
  const router = useRouter();
  const draft0 = useMemo(() => readDraft(), []);
  const [content, setContent] = useState(draft0.content);
  const [title, setTitle] = useState(draft0.title);
  const [sourceId, setSourceId] = useState("");
  const [tags, setTags] = useState(draft0.tags);
  const [destination, setDestination] = useState<"capture" | "dialogue">("capture");
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const submitting = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const sources = useMemo(() => state.sources, [state.sources]);

  // Focus the textarea on mount (no setState → allowed in an effect).
  useEffect(() => { textRef.current?.focus(); }, []);

  // Persist the draft as the user types (external sync only — no setState).
  useEffect(() => {
    if (saved) return;
    try {
      if (content || title || tags) localStorage.setItem(DRAFT_KEY, JSON.stringify({ content, title, tags }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* ignore */ }
  }, [saved, content, title, tags]);

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  const submit = () => {
    if (submitting.current) return; // duplicate-submission guard
    const body = content.trim();
    if (!body) return;
    submitting.current = true;
    const text = [title.trim() || null, body, tags.trim() ? tags.split(",").map((t) => `#${t.trim()}`).filter((t) => t.length > 1).join(" ") : null]
      .filter(Boolean).join("\n");
    const id = addCapture(text, sourceId || undefined);
    clearDraft();
    setContent(""); setTitle(""); setTags(""); setSourceId("");
    if (destination === "dialogue") {
      onClose();
      router.push(`/dialogue?topic=${encodeURIComponent(body.slice(0, 120))}`);
      return;
    }
    setSaved({ id });
    submitting.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Quick capture" onKeyDown={onKeyDown} className="w-full max-w-lg overflow-hidden rounded-2xl border border-black/[.08] bg-white shadow-2xl dark:border-white/[.12] dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
          <h2 className="text-sm font-semibold">Quick capture</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
        </div>

        {saved ? (
          <div className="p-4">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">✓ Captured.</p>
            <p className="mt-1 text-xs text-zinc-500">Your thought is saved. It will appear on the Capture page and can become a belief in the Inbox.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/" onClick={onClose} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">View captures →</Link>
              <button type="button" onClick={() => setSaved(null)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] dark:border-white/[.15]">Capture another</button>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <textarea
              ref={textRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="What are you thinking? (⌘/Ctrl+Enter to save)"
              className="w-full resize-none rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/[.25] dark:border-white/[.12] dark:focus:border-white/[.30]"
            />

            <button type="button" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="mt-2 text-[11px] text-zinc-500 underline-offset-4 hover:underline">
              {advanced ? "Hide options" : "More options"}
            </button>

            {advanced && (
              <div className="mt-2 flex flex-col gap-2">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated (optional)" className="w-full rounded-lg border border-black/[.10] bg-transparent px-3 py-2 text-sm outline-none dark:border-white/[.12]" />
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="w-16 shrink-0">Source</span>
                  <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="w-full rounded-lg border border-black/[.10] bg-transparent px-2 py-1.5 text-sm outline-none dark:border-white/[.12]">
                    <option value="">None</option>
                    {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="w-16 shrink-0">Then</span>
                  <select value={destination} onChange={(e) => setDestination(e.target.value as "capture" | "dialogue")} className="w-full rounded-lg border border-black/[.10] bg-transparent px-2 py-1.5 text-sm outline-none dark:border-white/[.12]">
                    <option value="capture">Just capture</option>
                    <option value="dialogue">Capture, then open a dialogue on it</option>
                  </select>
                </label>
              </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-full border border-black/[.12] px-3 py-1.5 text-[11px] text-zinc-500 dark:border-white/[.15]">Cancel</button>
              <button type="button" onClick={submit} disabled={!content.trim()} className="rounded-full bg-zinc-900 px-5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Save capture</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
