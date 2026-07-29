"use client";
/** Today Plan (LIFEOS-037). */
import { useSyncExternalStore } from "react";
import TodayPlan from "@/components/planning/TodayPlan";
export default function TodayPlanPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <TodayPlan />;
}
