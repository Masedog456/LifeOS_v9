"use client";

/**
 * Weekly planning view (LIFEOS-037, Feature 4). A projection — NOT a seven-day
 * calendar grid; nothing is assigned to clock times or weekdays. Groups: This
 * Week, unfinished Today, active milestones, projects touched this week, waiting
 * follow-ups, deferred returns, and completed actions for context.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, type EntityContext } from "@/lib/entities/entity";
import { weeklyPlan } from "@/lib/planning/weekly-plan";

function RefList({ ctx, refs }: { ctx: EntityContext; refs: { kind: string; id: string }[] }) {
  return <ul className="flex flex-col gap-0.5">{refs.map((r) => { const e = entityRef(ctx, r.kind, r.id); return <li key={`${r.kind}:${r.id}`} className="truncate text-sm"><Link href={e.href} className="hover:underline">{e.title}</Link></li>; })}</ul>;
}
function Group({ title, children, n }: { title: string; children: React.ReactNode; n: number }) {
  if (n === 0) return null;
  return <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title} <span className="text-zinc-300 dark:text-zinc-600">· {n}</span></h2>{children}</section>;
}

export default function WeeklyPlan() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const wp = useMemo(() => weeklyPlan(state), [state]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">This week</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Week of {wp.weekStart}. A projection of what you&apos;ve chosen and what&apos;s in motion — not a calendar.</p>
        </div>
        <Link href="/plan" className="shrink-0 rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Board →</Link>
      </header>
      <div className="flex flex-col gap-3">
        <Group title="This Week" n={wp.thisWeek.length}><RefList ctx={ctx} refs={wp.thisWeek.map((a) => a.ref)} /></Group>
        <Group title="Unfinished Today" n={wp.unfinishedToday.length}><RefList ctx={ctx} refs={wp.unfinishedToday.map((a) => a.ref)} /></Group>
        <Group title="Active milestones" n={wp.activeMilestones.length}><RefList ctx={ctx} refs={wp.activeMilestones.map((m) => ({ kind: "milestone", id: m.milestoneId }))} /></Group>
        <Group title="Projects touched this week" n={wp.projectsTouched.length}><RefList ctx={ctx} refs={wp.projectsTouched.map((p) => ({ kind: "project", id: p.id }))} /></Group>
        <Group title="Waiting follow-ups" n={wp.waitingFollowUps.length}><RefList ctx={ctx} refs={wp.waitingFollowUps.map((a) => ({ kind: "action", id: a.id }))} /></Group>
        <Group title="Deferred returns" n={wp.deferredReturns.length}><RefList ctx={ctx} refs={wp.deferredReturns.map((a) => ({ kind: "action", id: a.id }))} /></Group>
        <Group title="Completed this week (context)" n={wp.completedThisWeek.length}><RefList ctx={ctx} refs={wp.completedThisWeek.map((a) => ({ kind: "action", id: a.id }))} /></Group>
      </div>
    </main>
  );
}
