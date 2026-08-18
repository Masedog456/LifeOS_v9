"use client";
/** The Living Constitution (LIFEOS-056). The Belief Ledger now lives at /beliefs. */
import { Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import ConstitutionPage from "@/components/constitution/ConstitutionPage";

function Route() {
  const params = useSearchParams();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ConstitutionPage initialId={params.get("element") ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}>
      <Route />
    </Suspense>
  );
}
