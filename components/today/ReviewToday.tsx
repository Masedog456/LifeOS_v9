"use client";

/**
 * Review today — the day closed from evidence, not from a form (LIFEOS-073 §5).
 *
 * ## Why this is not the `/daily` wizard
 *
 * `/daily` is a seven-step flow that asks for wins, lessons, friction, open
 * loops and tomorrow's focus, and saves a `DailyReview` record. That is
 * journaling, it is optional, and it stays exactly where it is. But it cannot be
 * the default way to find out what happened today, because it requires the user
 * to type the answer to a question the store can already answer.
 *
 * This page requires nothing. It reads the same autobiographical evidence Week
 * in Review reads, over a one-day range, and creates no record by being viewed
 * (§17).
 *
 * ## What it refuses to say
 *
 *   "Your day is complete"  — evening is a time, not a verdict (§20)
 *   "You did nothing today" — an empty day is a fact about records (§22)
 *   "Unfinished" / "missed" — the word is "Still open" (§13, §19)
 *   "You attended X"        — nothing records attendance (§29)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import {
  buildDailyExecutiveView, CHANGE_LABEL, NO_CHANGES_TODAY, NOTHING_TOMORROW,
  REVIEW_TODAY_LABEL,
} from "@/lib/today/daily";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import { formatLocalTime } from "@/lib/time/localtime";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { nowLocalTime } from "@/lib/time/events";

const metaClass = "shrink-0 text-[11px] text-zinc-500";
const rowClass = "flex items-baseline justify-between gap-3 py-1";

function Block({ title, show, children, id }: {
  title: string; show: boolean; children: React.ReactNode; id: string;
}) {
  if (!show) return null;
  return (
    <section data-review-section={id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

export default function ReviewToday() {
  const state = useStore();
  const today = todayKey();
  const [now] = useState(() => nowLocalTime());
  const ix = useMemo(() => buildTodayIndexes(state, today, now), [state, today, now]);
  const v = useMemo(() => buildDailyExecutiveView(state, ix, today), [state, ix, today]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <header>
        {/* "Review today" — a thing you can do, not a state the day is in. The
            heading is the same at 7 PM as at 2 PM (§20, §21). */}
        <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{REVIEW_TODAY_LABEL}</h1>
        <p className="mt-0.5 text-[11px] text-zinc-500">{formatDayKey(v.date)}</p>
        <p data-review-summary className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
          {v.changedToday.length === 0 && v.completedToday.length === 0 ? NO_CHANGES_TODAY : v.summary}
        </p>
      </header>

      <Block title="Completed today" id="completed" show={v.completedToday.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {v.completedToday.map((e) => (
            <li key={`${e.recordRef.id}:${e.kind}`} data-review-completed className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>{CHANGE_LABEL[e.kind]}</span>
            </li>
          ))}
        </ul>
      </Block>

      {/* §10, §21. Every row names the transition and traces to the field that
          recorded it. There is no "worked on" here because nothing records it. */}
      <Block title="Changed today" id="changed" show={v.changedToday.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {v.changedToday.map((e) => (
            <li key={`${e.kind}:${e.recordRef.id}:${e.at}`} data-review-changed={e.kind} className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>
                {CHANGE_LABEL[e.kind] ?? e.kind}{e.detail ? ` · ${e.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {/* §13, §19, §27. "Still open" is a status. Each row carries the SAME
          resolver every other surface uses — no closure-specific controls. */}
      <Block title="Still open" id="still-open" show={v.stillOpen.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {v.stillOpen.map((o) => (
            <li key={o.action.id} data-review-open className="py-1">
              <div className={rowClass}>
                <Link href={`/actions/${o.action.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {o.action.title}
                </Link>
                <span className={metaClass}>{o.detail}</span>
              </div>
              <ResolutionControls title={o.action.title}
                actions={resolutionsForAction(state, o.action.id, { today, ix })} />
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Waiting" id="waiting" show={v.waiting.length > 0}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {v.waiting.map((w) => (
            <li key={w.action.id} data-review-waiting className="py-1">
              <div className={rowClass}>
                <Link href={`/actions/${w.action.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {w.action.title}
                </Link>
                <span className={metaClass}>
                  {w.waitingOn ? `Waiting on ${w.waitingOn}` : "Waiting"}
                  {w.followUpDue ? " · follow-up due" : ""}
                </span>
              </div>
              <ResolutionControls title={w.action.title}
                actions={resolutionsForAction(state, w.action.id, { today, ix })} />
            </li>
          ))}
        </ul>
      </Block>

      {/* §15. Dated evidence only. Undated open work is never moved here. */}
      <section data-review-section="tomorrow" className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Tomorrow</h2>
        {v.tomorrow.length === 0 ? (
          <p data-review-no-tomorrow className="text-[11px] text-zinc-500">{NOTHING_TOMORROW}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {v.tomorrow.map((t) => (
              <li key={`${t.kind}:${t.id}`} data-review-tomorrow={t.kind} className={rowClass}>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{t.title}</span>
                <span className={metaClass}>
                  {[t.time ? formatLocalTime(t.time) : undefined, t.detail].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* §18, §26. The user's own words only. `buildRangeReview` filters machine
          prose out upstream by provenance, so AI text can never appear here. */}
      <Block title="In your own words" id="reflections" show={v.reflections.length > 0}>
        <ul className="flex flex-col gap-1.5">
          {v.reflections.map((r) => (
            <li key={`${r.recordRef.kind}:${r.recordRef.id}`} data-review-words
              className="text-sm text-zinc-700 dark:text-zinc-200">
              “{r.title}”
            </li>
          ))}
        </ul>
      </Block>

      <footer className="flex flex-col gap-2 text-[11px] text-zinc-500">
        <p data-review-coverage>{v.coverage}</p>
        {v.limitations.length > 0 && (
          <ul data-review-limitations className="flex flex-col gap-0.5">
            {v.limitations.map((l) => <li key={l}>· {l}</li>)}
          </ul>
        )}
        <p className="mt-1">
          {/* The wizard remains, named as what it is: optional reflection on top
              of evidence the user did not have to write down (§17). */}
          <Link href="/daily" className="underline-offset-4 hover:underline">
            Add your own reflection →
          </Link>
          {" · "}
          <Link href="/memory/week" className="underline-offset-4 hover:underline">Review this week →</Link>
        </p>
      </footer>
    </div>
  );
}
