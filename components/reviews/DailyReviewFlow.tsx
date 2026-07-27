"use client";

/**
 * Daily review flow (LIFEOS-034, Features 3 & 9).
 *
 * A guided-but-non-forced review for one local date. Progress autosaves to the
 * store on every edit; the user may jump freely between steps, skip any of them,
 * complete, or reopen a completed review. Free-text fields commit on blur and are
 * protected by the shared unsaved-changes guard. Mobile-friendly and keyboard
 * accessible. This is a full page, never a modal.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore, getOrCreateReviewForDate, startDailyReview, updateDailyReview, completeDailyReview, reopenDailyReview, startProjectSession } from "@/lib/mvpStore";
import { findReviewByDate, reviewCounts, REVIEW_STEPS, REVIEW_STATUS_LABEL, startTomorrowActions, type ReviewStepKey } from "@/lib/reviews/review";
import { formatDayKey } from "@/lib/reviews/dates";
import { useUnsavedGuard } from "@/lib/ux/dirty-state";
import { openInspector } from "@/lib/entities/inspector";
import { toast } from "@/lib/ux/feedback";
import DaySummary from "@/components/reviews/DaySummary";
import WinsStep from "@/components/reviews/WinsStep";
import LessonsStep from "@/components/reviews/LessonsStep";
import FrictionStep from "@/components/reviews/FrictionStep";
import OpenLoopsStep from "@/components/reviews/OpenLoopsStep";
import TomorrowFocusStep from "@/components/reviews/TomorrowFocusStep";

export default function DailyReviewFlow({ date, initialStep }: { date: string; initialStep?: string }) {
  const state = useStore();
  const [step, setStep] = useState<ReviewStepKey>((REVIEW_STEPS.find((s) => s.key === initialStep)?.key) ?? "summary");

  // Ensure the canonical review exists for this date (idempotent per local date).
  // This updates the external store only — never React state — from the effect.
  useEffect(() => { getOrCreateReviewForDate(date); }, [date]);

  const review = findReviewByDate(state, date);
  const editable = review ? review.status !== "completed" : true;

  // Free-text drafts (summary + notes) commit on blur; the guard prompts if the
  // user tries to leave with an uncommitted edit. Drafts reset when the review
  // identity changes, using the ref-guarded render pattern (no setState effect).
  const [summaryDraft, setSummaryDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [draftForId, setDraftForId] = useState<string | undefined>(undefined);
  if (review && draftForId !== review.id) {
    // Adjusting state during render when a prop (the review identity) changes —
    // the React-endorsed alternative to a synchronizing effect.
    setDraftForId(review.id);
    setSummaryDraft(review.summary);
    setNotesDraft(review.notes);
  }
  const dirty = !!review && (summaryDraft !== review.summary || notesDraft !== review.notes);
  useUnsavedGuard(`daily-review-${date}`, dirty);
  const commitText = () => { if (review && dirty) updateDailyReview(review.id, { summary: summaryDraft, notes: notesDraft }); };

  const counts = review ? reviewCounts(review) : { wins: 0, lessons: 0, friction: 0, openLoops: 0, focus: 0 };
  const tomorrowActions = review ? startTomorrowActions(review) : [];

  if (!review) {
    return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Preparing your review…</p></main>;
  }

  const goto = (k: ReviewStepKey) => { commitText(); setStep(k); };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Daily review</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{formatDayKey(date, { weekday: "long", month: "long", day: "numeric" })} · <span data-review-status={review.status}>{REVIEW_STATUS_LABEL[review.status]}</span></p>
          </div>
          <Link href="/daily/history" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">History</Link>
        </div>
      </header>

      {/* Step navigation — free jumping, keyboard reachable (real buttons). */}
      <nav aria-label="Review steps" className="mb-5 -mx-1 flex gap-1 overflow-x-auto pb-1">
        {REVIEW_STEPS.map((s, i) => {
          const active = s.key === step;
          const badge = s.key === "wins" ? counts.wins : s.key === "lessons" ? counts.lessons : s.key === "friction" ? counts.friction : s.key === "openLoops" ? counts.openLoops : s.key === "tomorrow" ? counts.focus : 0;
          return (
            <button key={s.key} type="button" onClick={() => goto(s.key)} aria-current={active ? "step" : undefined} data-step={s.key}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.10] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-300 dark:hover:bg-white/[.06]"}`}>
              <span className="mr-1 text-[10px] opacity-60">{i + 1}</span>{s.label}{badge > 0 ? ` · ${badge}` : ""}
            </button>
          );
        })}
      </nav>

      {!editable && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50/50 px-3 py-2 text-xs dark:bg-emerald-950/20">
          <span className="text-emerald-700 dark:text-emerald-300">This review is complete. Reopen it to make changes.</span>
          <button type="button" onClick={() => { reopenDailyReview(review.id); toast({ kind: "info", message: "Review reopened" }); }} className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700">Reopen</button>
        </div>
      )}

      <section aria-label={REVIEW_STEPS.find((s) => s.key === step)?.label} className="flex flex-col gap-4">
        {step === "summary" && (
          <>
            <DaySummary date={date} />
            <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
              <label className="mb-1 block text-xs font-semibold text-zinc-500">What happened today? (optional)</label>
              <textarea value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} onBlur={commitText} disabled={!editable} rows={3} aria-label="Day summary" placeholder="A sentence or two, in your own words…" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-60 dark:border-white/12" />
            </div>
          </>
        )}
        {step === "wins" && (editable ? <WinsStep review={review} /> : <ReadOnlyList label="Wins" items={review.wins.map((w) => w.text)} />)}
        {step === "lessons" && (editable ? <LessonsStep review={review} /> : <ReadOnlyList label="Lessons" items={review.lessons.map((l) => l.text)} />)}
        {step === "friction" && (editable ? <FrictionStep review={review} /> : <ReadOnlyList label="Friction" items={review.friction.map((f) => f.description)} />)}
        {step === "openLoops" && (editable ? <OpenLoopsStep review={review} /> : <ReadOnlyList label="Open loops" items={review.openLoops.map((l) => l.text)} />)}
        {step === "tomorrow" && (editable ? <TomorrowFocusStep review={review} /> : <ReadOnlyList label="Tomorrow’s focus" items={review.tomorrowFocus.map((f) => f.text)} />)}

        {step === "complete" && (
          <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
            <h2 className="text-sm font-semibold">Confirm &amp; complete</h2>
            <p className="mt-1 text-xs text-zinc-500">A recap of what you recorded. Completing does not change any other record.</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              {([["Wins", counts.wins], ["Lessons", counts.lessons], ["Friction", counts.friction], ["Open loops", counts.openLoops], ["Tomorrow focus", counts.focus]] as [string, number][]).map(([l, n]) => (
                <div key={l} className="flex items-center justify-between"><dt className="text-zinc-500">{l}</dt><dd className="font-mono text-zinc-800 dark:text-zinc-200">{n}</dd></div>
              ))}
            </dl>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-zinc-500">Notes (optional)</label>
              <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} onBlur={commitText} disabled={!editable} rows={2} aria-label="Review notes" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60 dark:border-white/12" />
            </div>

            {review.status !== "completed" ? (
              <button type="button" onClick={() => { commitText(); completeDailyReview(review.id); toast({ kind: "success", message: "Daily review completed" }); }} className="mt-4 w-full rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">Complete review</button>
            ) : (
              <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-50/50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">Completed{review.completedAt ? ` at ${new Date(review.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.</p>
            )}

            {/* Start tomorrow (Feature 9) — reuse existing systems only. */}
            {review.status === "completed" && (review.tomorrowFocus.length > 0) && (
              <div className="mt-4">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Start tomorrow</p>
                <div className="flex flex-col gap-1.5">
                  {tomorrowActions.map((a) => (
                    a.href ? (
                      <div key={a.key} className="flex items-center gap-2">
                        <Link href={a.href} className="min-w-0 flex-1 truncate rounded-lg border border-black/[.10] px-3 py-1.5 text-xs text-zinc-700 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-200 dark:hover:bg-white/[.06]">{a.label}</Link>
                        {a.kind === "resume_project" && a.ref && <button type="button" onClick={() => { const sid = startProjectSession(a.ref!.id, "planning"); toast({ kind: sid ? "success" : "info", message: sid ? "Planning session started" : "Add a workspace to this project to start a session" }); }} className="shrink-0 rounded-full border border-black/[.10] px-2.5 py-1.5 text-[11px] hover:bg-black/[.04] dark:border-white/[.12] dark:hover:bg-white/[.06]">Start session</button>}
                      </div>
                    ) : (
                      <button key={a.key} type="button" onClick={() => a.ref && openInspector(a.ref.kind, a.ref.id)} className="rounded-lg border border-black/[.10] px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-black/[.04] dark:border-white/[.12] dark:text-zinc-200 dark:hover:bg-white/[.06]">{a.label}</button>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Footer navigation — Back / Skip / Next. */}
      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={() => { const i = REVIEW_STEPS.findIndex((s) => s.key === step); if (i > 0) goto(REVIEW_STEPS[i - 1].key); }} disabled={step === "summary"} className="rounded-full border border-black/[.12] px-4 py-2 text-xs disabled:opacity-40 dark:border-white/[.15]">← Back</button>
        <div className="flex items-center gap-2">
          {step !== "complete" && <button type="button" onClick={() => { const i = REVIEW_STEPS.findIndex((s) => s.key === step); goto(REVIEW_STEPS[i + 1].key); }} className="rounded-full px-3 py-2 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Skip</button>}
          {step !== "complete" ? (
            <button type="button" onClick={() => { const i = REVIEW_STEPS.findIndex((s) => s.key === step); goto(REVIEW_STEPS[i + 1].key); if (review.status === "not_started") startDailyReview(date); }} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Next →</button>
          ) : (
            <Link href="/daily/history" className="rounded-full border border-black/[.12] px-4 py-2 text-xs dark:border-white/[.15]">Done</Link>
          )}
        </div>
      </div>
    </main>
  );
}

function ReadOnlyList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="mb-2 text-sm font-semibold">{label}</h2>
      {items.length === 0 ? <p className="text-xs text-zinc-500">None recorded.</p> : (
        <ul className="flex flex-col gap-1 text-xs text-zinc-700 dark:text-zinc-200">{items.map((t, i) => <li key={i}>• {t}</li>)}</ul>
      )}
    </div>
  );
}
