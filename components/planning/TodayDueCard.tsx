"use client";

/**
 * Today's time signal (LIFEOS-053) — what actually needs attention now, and a
 * short look at what is coming.
 *
 * Two sections, deliberately not three: **Needs attention** (overdue and due
 * today, together, because to a person on a Tuesday morning they are the same
 * question) and **Next 7 days**. Waiting follow-ups already surface through
 * `TodayActions`; repeating them here would be dashboard sprawl.
 *
 * Wording rules, asserted by tests in `lib/actions/selftest.ts`:
 *  - "Was due Mon, Aug 10" — past tense, stated once, no count, no exclamation.
 *  - Never "you're behind", "late", "failed", or a streak.
 * A deadline is the easiest place for a calm product to start nagging, and the
 * point of this card is that it declines to.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { overdueActions, dueTodayActions, upcomingActions, dueLabel, sortByDue, UPCOMING_WINDOW_DAYS } from "@/lib/actions/due";
import { todayKey } from "@/lib/reviews/dates";
import type { NextAction } from "@/types/mvp";

function Row({ action, today }: { action: NextAction; today: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <Link href={`/actions/${action.id}`} className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
        {action.title}
      </Link>
      <span className="shrink-0 text-[11px] text-zinc-500">{dueLabel(action, today)}</span>
    </li>
  );
}

export default function TodayDueCard() {
  const state = useStore();
  const today = todayKey();

  const { attention, upcoming } = useMemo(() => {
    const actions = state.nextActions ?? [];
    return {
      // Overdue first, then due today — both are "now", ordered by date.
      attention: sortByDue([...overdueActions(actions, today), ...dueTodayActions(actions, today)], today),
      upcoming: upcomingActions(actions, today),
    };
  }, [state, today]);

  if (attention.length === 0 && upcoming.length === 0) return null;

  return (
    <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      {attention.length > 0 && (
        <>
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Needs attention</h2>
          <ul className="mt-1 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {attention.map((a) => <Row key={a.id} action={a} today={today} />)}
          </ul>
        </>
      )}
      {upcoming.length > 0 && (
        <>
          <h2 className={`text-[10px] font-semibold uppercase tracking-wide text-zinc-400 ${attention.length > 0 ? "mt-4" : ""}`}>
            Next {UPCOMING_WINDOW_DAYS} days
          </h2>
          <ul className="mt-1 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {upcoming.map((a) => <Row key={a.id} action={a} today={today} />)}
          </ul>
        </>
      )}
    </section>
  );
}
