"use client";
/** The Life Architecture Interview (LIFEOS-058) — a guided route to a Constitution. */
import { useSyncExternalStore } from "react";
import ConstitutionBuilder from "@/components/interview/ConstitutionBuilder";

export default function Page() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ConstitutionBuilder />;
}
