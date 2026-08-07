"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReviewSurfacedItem } from "@/types/mvp";
import {
  addPractices,
  addReflection,
  affirmBelief,
  attachReflectionToReview,
  getStoreSnapshot,
  markPracticeAcceptedInReview,
  questionBelief,
  recordFeedback,
  recordReviewJudgment,
  reviseBelief,
  startReview,
  useStore,
} from "@/lib/mvpStore";
import { buildDailyReview, MAX_DAILY_ITEMS } from "@/lib/formation/daily";
import { runPracticeSuggest } from "@/lib/formation/practice";
import PracticeList from "@/components/PracticeList";

const KIND_LABEL: Record<ReviewSurfacedItem["kind"], string> = {
  stale_belief: "A belief to revisit",
  questioned_belief: "A belief you questioned",
  unresolved_question: "An open question",
  quote: "A quote",
  capture: "A past thought",
  thread_change: "A thread that changed",
};

function ReviewItem({
  item, reviewId,
}: {
  item: ReviewSurfacedItem;
  reviewId: string;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [savedReflectionId, setSavedReflectionId] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [reflection, setReflection] = useState("");
  const [revising, setRevising] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [suggesting, setSuggesting] = useState(false);
  const [practiceNote, setPracticeNote] = useState<string | null>(null);

  const isBelief = item.kind === "stale_belief" || item.kind === "questioned_belief";

  function judge(decision: Parameters<typeof recordReviewJudgment>[2], label: string) {
    recordReviewJudgment(reviewId, item.id, decision);
    setDone(label);
  }

  function saveReflection() {
    if (!reflection.trim()) return;
    const rid = addReflection({
      prompt: item.title,
      response: reflection,
      beliefIds: item.beliefId ? [item.beliefId] : undefined,
      threadIds: item.threadId ? [item.threadId] : undefined,
      sourceIds: item.sourceId ? [item.sourceId] : undefined,
    });
    attachReflectionToReview(reviewId, rid);
    recordReviewJudgment(reviewId, item.id, "reflected");
    setReflecting(false);
    setSavedReflectionId(rid);
    setDone("Reflection saved — your belief was not changed.");
  }

  function saveRevision() {
    // Rewritten beliefs go through the existing append-only revision flow.
    if (item.beliefId && draft.trim() && draft.trim() !== item.title) {
      reviseBelief(item.beliefId, draft);
    }
    recordReviewJudgment(reviewId, item.id, "revised");
    setRevising(false);
    setDone("Revised — kept in your beliefs' revision history.");
  }

  async function suggestPractice() {
    if (!item.beliefId) return;
    setSuggesting(true);
    try {
      const { drafts, flagged } = await runPracticeSuggest(getStoreSnapshot(), { beliefId: item.beliefId });
      if (drafts.length) addPractices(drafts, "mock");
      setPracticeNote(
        drafts.length
          ? `${drafts.length} practice suggestion${drafts.length === 1 ? "" : "s"} added below.`
          : flagged.length
            ? "No safe practice could be suggested."
            : "No practice suggested.",
      );
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <li className="rounded-2xl border border-black/[.06] p-5 dark:border-white/[.08]">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{KIND_LABEL[item.kind]}</p>
      {item.href ? (
        <Link href={item.href} className="mt-1 block text-base leading-relaxed text-zinc-900 hover:underline dark:text-zinc-100">{item.title}</Link>
      ) : (
        <p className="mt-1 text-base leading-relaxed text-zinc-900 dark:text-zinc-100">{item.title}</p>
      )}
      <p className="mt-1 text-xs text-zinc-400">Why now: {item.reason}</p>

      {done ? (
        <p className="mt-3 text-sm text-zinc-500">
          {done}
          {savedReflectionId && (
            <Link href={`/decisions?reflection=${savedReflectionId}`} className="ml-2 underline-offset-4 hover:underline">
              Use as decision evidence →
            </Link>
          )}
        </p>
      ) : reflecting ? (
        <div className="mt-3">
          <textarea value={reflection} onChange={(e) => setReflection(e.target.value)} rows={3} autoFocus placeholder="Write a reflection…" className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.15]" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={saveReflection} disabled={!reflection.trim()} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">Save reflection</button>
            <button type="button" onClick={() => setReflecting(false)} className="rounded-full px-4 py-1.5 text-sm text-zinc-400">Cancel</button>
          </div>
        </div>
      ) : revising ? (
        <div className="mt-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus className="w-full resize-none rounded-lg border border-black/[.12] bg-transparent p-2.5 text-sm outline-none dark:border-white/[.15]" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={saveRevision} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save revision</button>
            <button type="button" onClick={() => setRevising(false)} className="rounded-full px-4 py-1.5 text-sm text-zinc-400">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => setReflecting(true)} className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Reflect</button>
          {isBelief && (
            <>
              <button type="button" onClick={() => { if (item.beliefId) affirmBelief(item.beliefId); judge("affirmed", "Affirmed."); }} className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Still true</button>
              <button type="button" onClick={() => setRevising(true)} className="rounded-full border border-black/[.12] px-3 py-1.5 hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Revise</button>
              <button type="button" onClick={() => { if (item.beliefId) questionBelief(item.beliefId); judge("questioned", "Marked questioned."); }} className="rounded-full px-3 py-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Question</button>
              <button type="button" onClick={suggestPractice} disabled={suggesting} className="rounded-full px-3 py-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">{suggesting ? "…" : "Suggest a practice"}</button>
            </>
          )}
          <button type="button" onClick={() => { recordFeedback(item.id, "snoozed", 60 * 24 * 3); judge("postponed", "Postponed for a few days."); }} className="rounded-full px-3 py-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Postpone</button>
          <button type="button" onClick={() => { recordFeedback(item.id, "dismissed"); judge("dismissed", "Dismissed."); }} className="rounded-full px-3 py-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Dismiss</button>
        </div>
      )}
      {practiceNote && <p className="mt-2 text-xs text-zinc-400">{practiceNote}</p>}
    </li>
  );
}

export default function ReviewPage() {
  const state = useStore();
  const daily = useMemo(() => buildDailyReview(state), [state]);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const proposedPractices = state.practices.filter((p) => p.status === "proposed");
  const activePractices = state.practices.filter((p) => p.status === "accepted" || p.status === "paused");

  function begin() {
    setReviewId(startReview("daily", daily));
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Today&apos;s review</h1>
        <p className="mt-1 text-sm text-zinc-500">
          A calm, finite check-in — at most {MAX_DAILY_ITEMS} things worth your attention. LifeOS surfaces and asks; you decide.
        </p>
      </header>

      {!reviewId ? (
        daily.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
            Nothing needs revisiting right now. Capture a thought or add a source, and come back later.
          </p>
        ) : (
          <button type="button" onClick={begin} className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">
            Begin today&apos;s review ({daily.length})
          </button>
        )
      ) : (
        <ul className="flex flex-col gap-4">
          {daily.map((item) => <ReviewItem key={item.id} item={item} reviewId={reviewId} />)}
        </ul>
      )}

      {/* Practice candidates */}
      {(proposedPractices.length > 0 || activePractices.length > 0) && (
        <section className="mt-12">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Practices</h2>
          <p className="mb-2 text-xs text-zinc-400">Small, optional practices — provisional until you accept them. No scheduling, no streaks.</p>
          <PracticeList
            practices={[...proposedPractices, ...activePractices]}
            onAccept={(pid) => reviewId && markPracticeAcceptedInReview(reviewId, pid)}
          />
        </section>
      )}

      <div className="mt-12 flex flex-wrap gap-4 border-t border-black/[.05] pt-6 dark:border-white/[.06]">
        <Link href="/review/weekly" className="text-sm text-zinc-500 underline-offset-4 hover:underline">Weekly review & alignment →</Link>
        <Link href="/formation" className="text-sm text-zinc-500 underline-offset-4 hover:underline">Reflect & formation timeline →</Link>
      </div>
    </main>
  );
}
