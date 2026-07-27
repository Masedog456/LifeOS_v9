"use client";

/**
 * Review history (LIFEOS-034, Feature 10). Groups reviews by Today / Yesterday /
 * This Week / Earlier with status + counts + tomorrow focus + linked goals and
 * projects, plus date navigation and a link into the weekly rollup.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { groupReviewsByRecency, reviewCounts, REVIEW_STATUS_LABEL, reviewHref } from "@/lib/reviews/review";
import { todayKey, formatDayKey, weekStartKey } from "@/lib/reviews/dates";

const STATUS_TONE: Record<string, string> = {
  completed: "text-emerald-600 dark:text-emerald-400",
  in_progress: "text-amber-600 dark:text-amber-400",
  reopened: "text-amber-600 dark:text-amber-400",
  not_started: "text-zinc-400",
};

export default function ReviewHistory() {
  const state = useStore();
  const today = todayKey();
  const groups = useMemo(() => groupReviewsByRecency(state, today), [state, today]);
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const [jump, setJump] = useState(today);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Review history</h1>
            <p className="mt-0.5 text-sm text-zinc-500">Your daily reviews. Nothing here is scored — it’s a record of your reflection.</p>
          </div>
          <Link href={`/daily/week/${weekStartKey(today)}`} className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Weekly rollup →</Link>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-zinc-500">Open a date</label>
          <input type="date" value={jump} onChange={(e) => setJump(e.target.value)} aria-label="Jump to date" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
          <Link href={reviewHref(jump)} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Open</Link>
          <Link href="/daily" className="ml-auto rounded-full border border-black/[.12] px-3 py-1 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Today’s review</Link>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">
          No reviews yet. <Link href="/daily" className="underline underline-offset-4">Start today’s review →</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.bucket}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.bucket}</h2>
              <ul className="flex flex-col gap-2">
                {g.reviews.map((r) => {
                  const c = reviewCounts(r);
                  const links = [...r.linkedGoals.map((id) => ({ kind: "goal", id })), ...r.linkedProjects.map((id) => ({ kind: "project", id }))];
                  return (
                    <li key={r.id}>
                      <Link href={reviewHref(r.date)} className="block rounded-2xl border border-black/[.06] p-3 hover:bg-black/[.02] dark:border-white/[.08] dark:hover:bg-white/[.03]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{formatDayKey(r.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                          <span className={`text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[r.status] ?? ""}`}>{REVIEW_STATUS_LABEL[r.status]}</span>
                        </div>
                        {r.summary && <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-300">{r.summary}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                          <span>{c.wins} win{c.wins === 1 ? "" : "s"}</span><span>·</span>
                          <span>{c.lessons} lesson{c.lessons === 1 ? "" : "s"}</span><span>·</span>
                          <span>{c.friction} friction</span><span>·</span>
                          <span>{c.openLoops} open</span><span>·</span>
                          <span>{c.focus} focus</span>
                        </div>
                        {(r.tomorrowFocus.length > 0 || links.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.tomorrowFocus.slice(0, 3).map((f) => <span key={f.id} className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">→ {f.text}</span>)}
                            {links.slice(0, 3).map((l) => { const ref = entityRef(ctx, l.kind, l.id); return ref.exists ? <span key={`${l.kind}:${l.id}`} className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.08]">{ref.title}</span> : null; })}
                          </div>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
