"use client";

/**
 * `/daily/[date]` — redirect, carrying the day with it (LIFEOS-092 §7, §27).
 *
 * This was the one thing the old route did better than the canonical review: a
 * past day had an address. `/daily/2026-09-04` could be bookmarked, linked and
 * shared, while the evening close's previous-day control was React state.
 *
 * So the capability moved rather than died — `/today/review?date=` — and this
 * route hands the date over instead of dropping it. A bookmark from a year ago
 * still lands on the day it named.
 */

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isDayKey } from "@/lib/reviews/dates";

export default function DailyDateRedirectPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const router = useRouter();
  const href = isDayKey(date) ? `/today/review?date=${date}` : "/today/review";
  useEffect(() => { router.replace(href); }, [router, href]);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <p className="text-sm text-zinc-400">
        Taking you to that day&apos;s review…{" "}
        <a href={href} data-daily-redirect className="underline underline-offset-4">
          Open it
        </a>
      </p>
    </main>
  );
}
