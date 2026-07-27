"use client";

/** Weekly rollup (LIFEOS-034, Feature 11) for the week starting `start`. */

import { use, useSyncExternalStore } from "react";
import WeeklyRollup from "@/components/reviews/WeeklyRollup";
import { isDayKey, todayKey } from "@/lib/reviews/dates";

export default function WeeklyRollupPage({ params }: { params: Promise<{ start: string }> }) {
  const { start } = use(params);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <WeeklyRollup weekStart={isDayKey(start) ? start : todayKey()} />;
}
