"use client";

/**
 * Today plan card (LIFEOS-037, Feature 16; LIFEOS-107).
 *
 * An ENTRY POINT into planning, on a page that already renders the day.
 *
 * It used to list the plan's first three items and the in-progress action, and
 * the audit measured what that cost on `/today`: one planned action rendered
 * twice on the same page — once as a DO row that Today owns, once here — and
 * the in-progress action rendered twice INSIDE this card, as its own line and
 * again in the list beneath it. LIFEOS-104 §24 removed exactly this shape of
 * repetition from Today ("Call the dentist, three times in eleven rows"), but
 * its dedup cannot reach a card built by a different projection.
 *
 * So the card no longer restates the day. It carries what Today does NOT know
 * about — an open focus session, how much is waiting to be planned, the way to
 * the board — and the counts that say whether there is anything there. Nothing
 * was lost: every item it used to list is on the page already, owned by the
 * surface whose job it is (§7: one canonical interpretation of today).
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { todayPlan } from "@/lib/planning/today-plan";
import { activeFocus } from "@/lib/planning/focus";
import { planningInbox } from "@/lib/planning/planning-inbox";

export default function TodayPlanCard() {
  const state = useStore();
  const plan = useMemo(() => todayPlan(state), [state]);
  const focus = activeFocus(state);
  const inboxCount = useMemo(() => planningInbox(state).length, [state]);

  if (plan.items.length === 0 && !focus && inboxCount === 0) return null;

  return (
    <section aria-label="Plan" className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Plan</h2>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{plan.items.length} in today&apos;s plan</span>
      </header>
      {/* A focus SESSION is the one thing here Today has no idea about — it is
          planning state, not a commitment — so it is the one line kept. */}
      {focus && (
        <div className="flex flex-col gap-2 text-sm">
          <p data-plan-focus className="text-zinc-600 dark:text-zinc-300">Focusing on <Link href="/focus" className="font-medium text-sky-700 hover:underline dark:text-sky-400">{focus.title}</Link></p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!focus && <Link href="/focus" className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Start focus</Link>}
        <Link href="/plan" className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Open planning board</Link>
        {inboxCount > 0 && <Link href="/plan/inbox" className="text-[11px] text-zinc-500 dark:text-zinc-400 hover:underline">{inboxCount} to plan</Link>}
      </div>
    </section>
  );
}
