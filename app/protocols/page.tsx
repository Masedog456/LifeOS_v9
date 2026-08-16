"use client";
/** Protocols — conditional intentions (LIFEOS-054). */
import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import ProtocolsPage from "@/components/protocols/ProtocolsPage";

function Route() {
  const params = useSearchParams();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ProtocolsPage initialId={params.get("protocol") ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}>
      <Route />
    </Suspense>
  );
}
