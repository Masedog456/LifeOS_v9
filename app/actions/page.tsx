"use client";

/** Next-action queue (LIFEOS-036). Query params: ?new, ?start=next, ?fromCapture=<id>. */

import { Suspense, useSyncExternalStore } from "react";
import ActionQueue from "@/components/actions/ActionQueue";

function Inner() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ActionQueue />;
}

export default function ActionsPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner /></Suspense>;
}
