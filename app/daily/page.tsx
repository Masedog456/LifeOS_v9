"use client";

/**
 * Daily review — today (LIFEOS-034). A full-page flow (never a modal) for the
 * current LOCAL date. `?step=` may deep-link to a step.
 */

import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import DailyReviewFlow from "@/components/reviews/DailyReviewFlow";
import { todayKey } from "@/lib/reviews/dates";

function Inner() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const params = useSearchParams();
  if (!mounted) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <DailyReviewFlow date={todayKey()} initialStep={params.get("step") ?? undefined} />;
}

export default function DailyTodayPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner /></Suspense>;
}
