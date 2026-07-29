"use client";
/** Focus Mode (LIFEOS-037). `?kind=&id=` starts focus; `?end=1` ends it. */
import { Suspense, useSyncExternalStore } from "react";
import FocusMode from "@/components/planning/FocusMode";
function Inner() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <FocusMode />;
}
export default function FocusPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner /></Suspense>;
}
