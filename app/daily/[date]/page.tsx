"use client";

/**
 * Daily review — a specific local date (LIFEOS-034). `?step=` deep-links a step.
 */

import { Suspense, use, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import DailyReviewFlow from "@/components/reviews/DailyReviewFlow";
import { isDayKey, todayKey } from "@/lib/reviews/dates";

function Inner({ date }: { date: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const search = useSearchParams();
  if (!mounted) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  const safe = isDayKey(date) ? date : todayKey();
  return <DailyReviewFlow date={safe} initialStep={search.get("step") ?? undefined} />;
}

export default function DailyDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return <Suspense fallback={<main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner date={date} /></Suspense>;
}
