"use client";

/**
 * Weekly rollup (LIFEOS-034, Feature 11). A deterministic PROJECTION over the
 * week's daily reviews + activity. No scoring, no productivity rating, no
 * recommendations. Not persisted — computed on view with prev/next navigation.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { buildWeeklyRollup, weekLabel } from "@/lib/reviews/weekly-rollup";
import { formatDuration } from "@/lib/reviews/day-summary";
import { addDays, weekStartKey, todayKey, formatDayKey } from "@/lib/reviews/dates";
import { reviewHref } from "@/lib/reviews/review";

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between py-1 text-xs"><span className="text-zinc-500">{label}</span><span className="font-mono text-zinc-800 dark:text-zinc-200">{value}</span></div>;
}

export default function WeeklyRollup({ weekStart }: { weekStart: string }) {
  const state = useStore();
  const start = weekStartKey(weekStart);
  const today = todayKey();
  const rollup = buildWeeklyRollup(state, start, { today });
  const ctx = useMemo(() => makeEntityContext(state), [state]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Weekly rollup</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{weekLabel(rollup)} — a projection, not a score.</p>
        </div>
        <Link href="/daily/history" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">History</Link>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <Link href={`/daily/week/${addDays(start, -7)}`} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">← Previous week</Link>
        {start < weekStartKey(today) && <Link href={`/daily/week/${addDays(start, 7)}`} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Next week →</Link>}
      </div>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Reviews</h2>
        <div className="mb-2 flex flex-wrap gap-1">
          {rollup.days.map((d) => {
            const done = rollup.completedReviews.includes(d);
            const future = d > today;
            return <Link key={d} href={reviewHref(d)} className={`rounded-full px-2 py-1 text-[10px] ${done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : future ? "bg-black/[.04] text-zinc-400 dark:bg-white/[.05]" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>{formatDayKey(d, { weekday: "short" })}</Link>;
          })}
        </div>
        <Row label="Completed reviews" value={`${rollup.completedReviews.length} / 7`} />
        <Row label="Missed review days (past)" value={String(rollup.missedReviewDays.length)} />
      </section>

      <section className="mt-4 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Activity</h2>
        <Row label="Sessions" value={String(rollup.sessionCount)} />
        <Row label="Total session time" value={formatDuration(rollup.totalSessionMs)} />
        <Row label="Goals touched" value={String(rollup.goalsTouched.length)} />
        <Row label="Projects touched" value={String(rollup.projectsTouched.length)} />
        <Row label="Milestones completed" value={String(rollup.milestonesCompleted)} />
        <Row label="Reading activity" value={String(rollup.readingActivity)} />
        <Row label="Captures" value={String(rollup.captures)} />
        <Row label="Decisions" value={String(rollup.decisions)} />
        {rollup.timeByWorkspace.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Time by workspace</p>
            {rollup.timeByWorkspace.slice(0, 6).map((w) => <Row key={w.workspaceId} label={w.name} value={formatDuration(w.ms)} />)}
          </div>
        )}
      </section>

      {(rollup.repeatedFriction.length > 0 || rollup.unresolvedOpenLoops.length > 0) && (
        <section className="mt-4 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Patterns to notice</h2>
          {rollup.repeatedFriction.length > 0 && (
            <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-300">Repeated friction: {rollup.repeatedFriction.map((f) => `${f.area} (${f.count})`).join(", ")}.</p>
          )}
          {rollup.unresolvedOpenLoops.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Unresolved open loops</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                {rollup.unresolvedOpenLoops.slice(0, 8).map((l, i) => <li key={i} className="truncate">• {l.text} <span className="text-[10px] text-zinc-400">· {l.date}</span></li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {rollup.goalsTouched.length > 0 && (
        <section className="mt-4 rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Goals touched</h2>
          <div className="flex flex-wrap gap-1.5">
            {rollup.goalsTouched.map((id) => { const ref = entityRef(ctx, "goal", id); return ref.exists ? <Link key={id} href={ref.href} className="rounded-full bg-black/[.06] px-2 py-1 text-[11px] text-zinc-600 hover:bg-black/[.1] dark:bg-white/[.08] dark:text-zinc-300">{ref.title}</Link> : null; })}
          </div>
        </section>
      )}
    </main>
  );
}
