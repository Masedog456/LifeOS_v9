"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  addCapture,
  attachProposals,
  resurfacedBelief,
  useStore,
} from "@/lib/mvpStore";
import { generateBeliefs } from "@/lib/aiClient";
import { buildRecords } from "@/lib/retrieval/records";
import { relatedTo, resurfaceLabel, type RankedResult } from "@/lib/retrieval/search";
import RetrievalResults from "@/components/RetrievalResults";

export default function Home() {
  const router = useRouter();
  const state = useStore();
  const resurfaced = resurfacedBelief(state);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [resurfaced2, setResurfaced2] = useState<RankedResult[]>([]);
  const [showMore, setShowMore] = useState(false);
  const submitting = useRef(false);

  function resurface(raw: string) {
    try {
      const related = relatedTo(raw, buildRecords(state), state.feedback, { semantic: state.embeddings.length > 0 }).slice(0, 3);
      setResurfaced2(related);
      setShowMore(false);
    } catch {
      setResurfaced2([]);
    }
  }

  async function generate(captureId: string, raw: string) {
    const { result, source } = await generateBeliefs(raw);
    attachProposals(captureId, result, source);
    return result.length;
  }

  async function handle(analyze: boolean) {
    const raw = text.trim();
    if (!raw || busy || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNote(null);

    const captureId = addCapture(raw);
    const count = await generate(captureId, raw);

    setText("");
    setBusy(false);
    submitting.current = false;

    if (analyze) {
      router.push("/inbox");
    } else {
      setNote(
        count > 0
          ? `Saved on this device. ${count} belief${count === 1 ? "" : "s"} waiting in your Inbox.`
          : "Saved on this device.",
      );
      resurface(raw);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handle(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      {resurfaced && (
        <section className="rounded-2xl border border-black/[.06] bg-black/[.02] p-5 dark:border-white/[.08] dark:bg-white/[.03]">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            You once wrote
          </p>
          <p className="mt-2 text-lg leading-relaxed text-zinc-800 dark:text-zinc-200">
            {resurfaced.text}
          </p>
          <a
            href="/beliefs"
            className="mt-3 inline-block text-sm text-zinc-500 underline-offset-4 hover:underline"
          >
            Does this still feel true? →
          </a>
        </section>
      )}

      <section>
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Chaos → order</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Bring what&apos;s competing for your attention into one place.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Capture a thought, responsibility, idea, commitment, or something you&apos;re learning. Conqify helps you give it shape without taking the choice away from you.
          </p>
        </div>

        <label htmlFor="capture" className="sr-only">
          What&apos;s on your mind?
        </label>
        <textarea
          id="capture"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What's on your mind?"
          rows={5}
          disabled={busy}
          className="w-full resize-none rounded-2xl border border-black/[.08] bg-transparent p-5 text-lg leading-relaxed outline-none transition-colors placeholder:text-zinc-400 focus:border-black/[.20] disabled:opacity-60 dark:border-white/[.10] dark:focus:border-white/[.25]"
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => handle(false)}
            disabled={!text.trim() || busy}
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Saving…" : "Capture"}
          </button>
          <button
            type="button"
            onClick={() => handle(true)}
            disabled={!text.trim() || busy}
            className="rounded-full border border-black/[.12] px-6 py-2.5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:opacity-30 dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            Analyze
          </button>
          {note && <span className="text-sm text-zinc-500">{note}</span>}
        </div>

        {!resurfaced && resurfaced2.length === 0 && (
          <p className="mt-6 text-sm leading-relaxed text-zinc-400">
            Start messy. Conqify can help turn scattered thoughts into notes, actions, protocols, projects, and things worth returning to.
          </p>
        )}
      </section>

      {resurfaced2.length > 0 && (
        <section className="rounded-2xl border border-black/[.06] bg-black/[.02] p-5 dark:border-white/[.08] dark:bg-white/[.03]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              This reminded Conqify of
            </p>
            <button
              type="button"
              onClick={() => setResurfaced2([])}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2">
            <RetrievalResults
              results={showMore ? resurfaced2 : resurfaced2.slice(0, 1)}
              label={(r) => resurfaceLabel(r.record)}
            />
          </div>
          {!showMore && resurfaced2.length > 1 && (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="mt-2 text-xs text-zinc-500 underline-offset-4 hover:underline"
            >
              Show {resurfaced2.length - 1} more →
            </button>
          )}
        </section>
      )}

      <div className="text-center">
        <Link href="/review" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          Begin today&apos;s review →
        </Link>
      </div>
    </main>
  );
}
