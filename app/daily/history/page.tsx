"use client";

/** Review history (LIFEOS-034, Feature 10). */

import { useSyncExternalStore } from "react";
import ReviewHistory from "@/components/reviews/ReviewHistory";

export default function ReviewHistoryPage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ReviewHistory />;
}
