"use client";

/**
 * `/today/review` — the one place a day gets closed (LIFEOS-092).
 *
 * Creates nothing by being visited: no `DailyReview` is auto-started, nothing is
 * pre-filled, and the absence of a review is never called incomplete. That rule
 * came from LIFEOS-073 and it is now the only rule, because `/daily` — which
 * wrote a `not_started` record the moment you opened it to look — redirects
 * here (§5, §27).
 *
 * `?date=` is the one thing the old route did better, absorbed rather than
 * dropped (§7, §17). `/daily/2026-09-04` was a URL you could bookmark, link and
 * share; the evening close's previous-day control was React state, so a past day
 * had no address. Now it does, and `/daily/[date]` redirects onto it.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReviewToday from "@/components/today/ReviewToday";
import { isDayKey } from "@/lib/reviews/dates";

function Inner() {
  const params = useSearchParams();
  const raw = params.get("date");
  // An unparseable date falls back to today rather than erroring: a bad
  // bookmark should still show you a day, not a stack trace.
  return <ReviewToday initialDate={raw && isDayKey(raw) ? raw : undefined} />;
}

export default function ReviewTodayPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    }>
      <Inner />
    </Suspense>
  );
}
