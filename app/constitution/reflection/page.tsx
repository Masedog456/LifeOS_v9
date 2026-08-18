"use client";
/** Constitution in Practice (LIFEOS-057) — adopted elements vs recorded evidence. */
import { useSyncExternalStore } from "react";
import ConstitutionReflection from "@/components/constitution/ConstitutionReflection";

export default function Page() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <ConstitutionReflection />;
}
