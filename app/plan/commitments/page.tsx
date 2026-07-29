"use client";
/** Commitment review (LIFEOS-037). */
import { useSyncExternalStore } from "react";
import CommitmentReview from "@/components/planning/CommitmentReview";
export default function CommitmentsPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <CommitmentReview />;
}
