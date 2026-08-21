"use client";

/**
 * The front door (LIFEOS-060).
 *
 * Was: a box that sent everything to a model and answered "N beliefs waiting in
 * your Inbox" — so the primary input of a life-management product produced
 * philosophy, and an errand needed five more steps to become a task.
 *
 * Now: `CaptureComposer` interprets on this page and creates on confirm. The
 * resurfacing panels below it are unchanged; they were always the good part of
 * this screen, and they are a projection over existing records rather than
 * anything that competes with capture.
 */

import Link from "next/link";
import { resurfacedBelief, useStore } from "@/lib/mvpStore";
import CaptureComposer from "@/components/capture/CaptureComposer";

export default function Home() {
  const state = useStore();
  const resurfaced = resurfacedBelief(state);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      {resurfaced && (
        <section className="rounded-2xl border border-black/[.06] bg-black/[.02] p-5 dark:border-white/[.08] dark:bg-white/[.03]">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">You once wrote</p>
          <p className="mt-2 text-lg leading-relaxed text-zinc-800 dark:text-zinc-200">{resurfaced.text}</p>
          <a href="/beliefs" className="mt-3 inline-block text-sm text-zinc-500 underline-offset-4 hover:underline">
            Does this still feel true? →
          </a>
        </section>
      )}

      <CaptureComposer />

      <div className="text-center">
        <Link href="/today" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          See today →
        </Link>
      </div>
    </main>
  );
}
