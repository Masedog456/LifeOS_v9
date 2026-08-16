"use client";
/** Notes — the lightweight keep-it surface (LIFEOS-052). */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import NotesPage from "@/components/notes/NotesPage";

function NotesRoute() {
  const params = useSearchParams();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  return <NotesPage initialNoteId={params.get("note") ?? undefined} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}>
      <NotesRoute />
    </Suspense>
  );
}
