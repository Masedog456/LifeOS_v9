"use client";

/** Focused single-capture processor (LIFEOS-035). `?action=` deep-links a panel. */

import { Suspense, use, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import CaptureProcessor from "@/components/inbox/CaptureProcessor";

function Inner({ id }: { id: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const search = useSearchParams();
  if (!mounted) return <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <CaptureProcessor captureId={id} initialAction={search.get("action") ?? undefined} />;
}

export default function ProcessCapturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}><Inner id={id} /></Suspense>;
}
