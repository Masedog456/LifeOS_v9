"use client";
/** Weekly planning view (LIFEOS-037). */
import { useSyncExternalStore } from "react";
import WeeklyPlan from "@/components/planning/WeeklyPlan";
export default function WeekPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <WeeklyPlan />;
}
