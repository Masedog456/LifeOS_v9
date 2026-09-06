"use client";

/**
 * The front door (LIFEOS-060, rebuilt around one input in LIFEOS-095).
 *
 * Was: a box that sent everything to a model and answered "N beliefs waiting in
 * your Inbox" — so the primary input of a life-management product produced
 * philosophy, and an errand needed five more steps to become a task. LIFEOS-060
 * fixed that by interpreting here and creating on confirm.
 *
 * LIFEOS-095's audit found what was left. The composer WAS above the fold and
 * WAS autofocused — two of the briefed reds did not hold — but a successful
 * capture left the page indistinguishable from one where nothing had happened,
 * and a returning user met 529 px of chrome, a resurfaced belief and three
 * stacked pieces of copy before reaching the field.
 *
 * So the order is now the order §6 asks for:
 *
 *   1  capture
 *   2  what just happened            (inside the composer)
 *   3  recent captures and outcomes
 *   4  small secondary links
 *
 * The resurfaced belief did not get deleted — it is the good part of this
 * screen and it always was. It moved BELOW the input, where it is something you
 * find rather than something you get past.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { resurfacedBelief, useStore } from "@/lib/mvpStore";
import CaptureComposer from "@/components/capture/CaptureComposer";
import RecentCaptures from "@/components/capture/RecentCaptures";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildDecisionInbox, DECISION_HEADING } from "@/lib/guidance/decisions";
import { todayKey } from "@/lib/reviews/dates";

export default function Home() {
  const state = useStore();
  const resurfaced = resurfacedBelief(state);
  const today = todayKey();
  /**
   * §18. One captured moment, one thing on screen.
   *
   * While the composer is showing "Saved as Action · Email Marcus about the
   * lease · Sun, Sep 6", the recent list's newest row would say exactly that
   * again, 150 px below. The visual review caught it; the row is omitted until
   * the panel goes.
   */
  const [justFinished, setJustFinished] = useState<string | null>(null);

  /**
   * §14. A count, and only a count.
   *
   * LIFEOS-094 built the queue and gave it an address. Home says how many and
   * points at it; it does not reproduce a single question. `decisionCountLine`
   * returns null at zero, so an empty queue takes no space here either.
   */
  const decisions = useMemo(
    () => buildDecisionInbox(state, buildTodayIndexes(state, today), { today }).total,
    [state, today],
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <CaptureComposer onFinished={setJustFinished} />

      <RecentCaptures exclude={justFinished} />

      {/*
        §21, §22. One step away, never reproduced here.

        Today is a command center and Memory is a search surface; either one
        rendered on this page would make Home the dashboard §36 says not to
        build. A line of links is the whole handoff.
      */}
      <nav aria-label="Elsewhere" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-zinc-500 dark:text-zinc-400">
        <Link href="/today" className="underline-offset-4 hover:underline">Today →</Link>
        {decisions > 0 && (
          <Link href="/today/decisions" data-home-decisions className="underline-offset-4 hover:underline">
            {DECISION_HEADING} · {decisions} →
          </Link>
        )}
        <Link href="/process" className="underline-offset-4 hover:underline">Capture inbox →</Link>
      </nav>

      {/*
        Below the input, deliberately (§5). A belief you wrote months ago is
        worth meeting again; it is not worth meeting BEFORE you have said the
        thing you opened the app to say. On a returning mobile user this card
        was 129 px of the 529 px above the field.
      */}
      {resurfaced && (
        <section data-resurfaced className="rounded-2xl border border-black/[.06] bg-black/[.02] p-5 dark:border-white/[.08] dark:bg-white/[.03]">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">You once wrote</p>
          <p className="mt-2 text-lg leading-relaxed text-zinc-800 dark:text-zinc-200">{resurfaced.text}</p>
          <Link href="/beliefs" className="mt-3 inline-block text-sm text-zinc-500 dark:text-zinc-400 underline-offset-4 hover:underline">
            Does this still feel true? →
          </Link>
        </section>
      )}
    </main>
  );
}
