"use client";

/**
 * Today plan card (LIFEOS-037, Feature 16). A compact, progressive-disclosure
 * entry point on Today: the plan count, current focus target, current action,
 * the next few manually-ordered items, capacity + planning-inbox counts, and
 * Start-Focus / Open-Board. It does NOT duplicate the whole board.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { todayPlan } from "@/lib/planning/today-plan";
import { activeFocus } from "@/lib/planning/focus";
import { planningInbox } from "@/lib/planning/planning-inbox";

export default function TodayPlanCard() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const plan = useMemo(() => todayPlan(state), [state]);
  const focus = activeFocus(state);
  const inboxCount = useMemo(() => planningInbox(state).length, [state]);
  const inProgress = (state.nextActions ?? []).find((a) => a.status === "in_progress");

  if (plan.items.length === 0 && !focus && inboxCount === 0 && !inProgress) return null;

  return (
    <section aria-label="Plan" className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Plan</h2>
        <span className="text-[11px] text-zinc-400">{plan.items.length} in today&apos;s plan</span>
      </header>
      <div className="flex flex-col gap-2 text-sm">
        {focus && <p className="text-zinc-600 dark:text-zinc-300">Focusing on <Link href="/focus" className="font-medium text-sky-600 hover:underline dark:text-sky-400">{focus.title}</Link></p>}
        {inProgress && <p className="truncate text-zinc-600 dark:text-zinc-300">In progress · <Link href={`/actions/${inProgress.id}`} className="hover:underline">{inProgress.title}</Link></p>}
        {plan.items.slice(0, 3).map((item) => { const r = entityRef(ctx, item.ref.kind, item.ref.id); return <p key={`${item.ref.kind}:${item.ref.id}`} className="truncate text-zinc-700 dark:text-zinc-200">· <Link href={r.href} className="hover:underline">{r.title}</Link></p>; })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!focus && <Link href="/focus" className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Start focus</Link>}
        <Link href="/plan" className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Open planning board</Link>
        {inboxCount > 0 && <Link href="/plan/inbox" className="text-[11px] text-zinc-500 hover:underline">{inboxCount} to plan</Link>}
      </div>
    </section>
  );
}
