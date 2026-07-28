"use client";

/** Focused single-action detail (LIFEOS-036). `?do=complete|defer|wait` deep-links. */

import { Suspense, use, useSyncExternalStore } from "react";
import ActionDetail from "@/components/actions/ActionDetail";

function Inner({ id }: { id: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ActionDetail actionId={id} />;
}

export default function ActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner id={id} /></Suspense>;
}
