"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  captureById,
  judgeProposal,
  pendingProposals,
  useStore,
} from "@/lib/mvpStore";

export default function InboxPage() {
  const state = useStore();
  const queue = pendingProposals(state);
  const total = state.proposals.length;
  const current = queue[0];

  // Track the reviewed count for the "N of M" indicator without exposing the pile.
  const reviewed = total - queue.length;

  const [activeId, setActiveId] = useState(current?.id);
  const [draft, setDraft] = useState(current?.claim ?? "");
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the editor when the current proposal changes — during render,
  // per React's guidance (not in an effect).
  if (current && current.id !== activeId) {
    setActiveId(current.id);
    setDraft(current.claim);
    setEditing(false);
  }

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  if (!current) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <p className="text-lg text-zinc-700 dark:text-zinc-300">
          {total === 0
            ? "Nothing to review yet."
            : `Inbox clear. You made ${total} decision${total === 1 ? "" : "s"} about what you believe.`}
        </p>
        {total === 0 ? (
          <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
            Capture a thought →
          </Link>
        ) : (
          <Link
            href="/constitution"
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            See them in your beliefs →
          </Link>
        )}
      </main>
    );
  }

  const capture = captureById(state, current.captureId);
  const changed = draft.trim() !== current.claim && draft.trim().length > 0;

  function accept() {
    judgeProposal(current!.id, "accepted");
  }
  function saveRewrite() {
    if (!changed) {
      accept();
      return;
    }
    judgeProposal(current!.id, "rewritten", draft);
  }
  function reject() {
    judgeProposal(current!.id, "rejected");
  }
  function question() {
    judgeProposal(current!.id, "questioned");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveRewrite();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "a") accept();
    else if (k === "r") reject();
    else if (k === "q") question();
    else if (k === "e") {
      e.preventDefault();
      setEditing(true);
    }
  }

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16 outline-none"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <p className="text-center text-xs font-medium uppercase tracking-wide text-zinc-400">
        {reviewed + 1} of {total}
      </p>

      <article className="rounded-2xl border border-black/[.06] p-6 dark:border-white/[.08]">
        {/* The evidence — the original captured text */}
        {capture && (
          <blockquote className="border-l-2 border-zinc-300 pl-4 text-zinc-500 dark:border-zinc-600">
            {capture.text}
          </blockquote>
        )}

        {/* The proposed belief, editable inline (Rewrite is the primary action) */}
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              {current.theme ? current.theme : "Proposed belief"}
            </p>
            {current.source === "mock" && (
              <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 dark:bg-white/[.08]">
                mock
              </span>
            )}
          </div>

          {editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="mt-2 w-full resize-none rounded-xl border border-black/[.12] bg-transparent p-3 text-xl leading-relaxed outline-none focus:border-black/[.25] dark:border-white/[.15] dark:focus:border-white/[.30]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 w-full rounded-xl border border-transparent p-3 text-left text-xl leading-relaxed transition-colors hover:border-black/[.08] hover:bg-black/[.02] dark:hover:border-white/[.08] dark:hover:bg-white/[.03]"
              title="Click to rewrite in your own words"
            >
              {draft || current.claim}
            </button>
          )}
          <p className="mt-1.5 px-1 text-xs text-zinc-400">
            {editing
              ? "Rewrite it in your own words — that's how it becomes yours. ⌘/Ctrl+Enter to save."
              : "Click the belief to rewrite it in your own words."}
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveRewrite}
            className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {changed ? "Save my version" : "Accept"}
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-full border border-black/[.12] px-5 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
            >
              Rewrite
            </button>
          )}
          <button
            type="button"
            onClick={question}
            className="rounded-full border border-black/[.12] px-5 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            Question
          </button>
          <button
            type="button"
            onClick={reject}
            className="rounded-full px-5 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Reject
          </button>
        </div>
      </article>

      <p className="text-center text-xs text-zinc-400">
        Keyboard: <kbd>A</kbd> accept · <kbd>E</kbd> rewrite · <kbd>Q</kbd>{" "}
        question · <kbd>R</kbd> reject
      </p>
    </main>
  );
}
