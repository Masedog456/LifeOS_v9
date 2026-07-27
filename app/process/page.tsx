"use client";

/** Capture inbox / processing queue (LIFEOS-035). */

import { Suspense, useSyncExternalStore } from "react";
import InboxPage from "@/components/inbox/InboxPage";

function Inner() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <InboxPage />;
}

export default function ProcessPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner /></Suspense>;
}
