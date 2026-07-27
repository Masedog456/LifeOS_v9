"use client";

/**
 * Today's review entry point (LIFEOS-034, Feature 12).
 *
 * A single, compact card on the Daily Home using progressive disclosure: the
 * primary call-to-action reflects today's review status; a completed review
 * surfaces tomorrow's focus; a few open loops and a resume link are tucked
 * behind a details disclosure so the page is never overwhelmed.
 */

import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { findReviewByDate, latestCompletedReview, reviewCounts, reviewHref } from "@/lib/reviews/review";
import { deriveOpenLoops } from "@/lib/reviews/open-loops";
import { todayKey } from "@/lib/reviews/dates";

export default function TodayReviewCard() {
  const state = useStore();
  const today = todayKey();
  const todays = findReviewByDate(state, today);
  const status = todays?.status ?? "not_started";
  const latest = latestCompletedReview(state);
  const loops = deriveOpenLoops(state).slice(0, 4);

  const cta =
    status === "completed" ? { label: "Review completed ✓", href: reviewHref(today), tone: "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20" }
    : status === "in_progress" || status === "reopened" ? { label: "Continue today’s review →", href: "/daily", tone: "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/15" }
    : { label: "Review today →", href: "/daily", tone: "border-black/[.08] dark:border-white/[.10]" };

  return (
    <section aria-label="Daily review" className={`rounded-2xl border p-4 ${cta.tone}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Daily review</h2>
        <Link href="/daily/history" className="text-[11px] text-zinc-400 underline-offset-4 hover:underline">History →</Link>
      </div>
      <Link href={cta.href} className="mt-1.5 block text-sm font-medium text-zinc-800 underline-offset-4 hover:underline dark:text-zinc-100">{cta.label}</Link>
      {todays && status !== "not_started" && (
        <p className="mt-0.5 text-[11px] text-zinc-500">{(() => { const c = reviewCounts(todays); return `${c.wins} win(s) · ${c.lessons} lesson(s) · ${c.focus} focus`; })()}</p>
      )}

      {latest && latest.tomorrowFocus.length > 0 && latest.date !== today && (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Tomorrow focus (from {latest.date})</p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {[...latest.tomorrowFocus].sort((a, b) => a.order - b.order).slice(0, 4).map((f) => (
              <li key={f.id}><Link href={reviewHref(latest.date)} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">→ {f.text}</Link></li>
            ))}
          </ul>
        </div>
      )}

      {loops.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-zinc-500 marker:text-zinc-400">Open loops · {loops.length}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {loops.map((l) => (
              <li key={l.id} className="truncate text-[11px] text-zinc-600 dark:text-zinc-300">• {l.text}</li>
            ))}
          </ul>
          <Link href="/daily?step=openLoops" className="mt-1 inline-block text-[11px] text-zinc-400 underline-offset-4 hover:underline">Choose loops for today’s review →</Link>
        </details>
      )}
    </section>
  );
}
