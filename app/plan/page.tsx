"use client";
/** Planning board (LIFEOS-037). */
import { useSyncExternalStore } from "react";
import PlanningBoard from "@/components/planning/PlanningBoard";
export default function PlanPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <PlanningBoard />;
}
