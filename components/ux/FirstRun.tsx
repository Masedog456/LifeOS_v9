"use client";

/**
 * First-run checklist (LIFEOS-032, Feature 14).
 *
 * A lightweight, dismissible card guiding the user through real application
 * actions. No forced tour, no fake data — each step links to the real page and
 * checks itself off from derived state. Progress is saved; Skip dismisses; it can
 * be restarted from System Health. Hidden once complete or dismissed.
 */

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { readPrefs, writePrefs } from "@/lib/prefs";
import { firstRunSteps, firstRunProgress, shouldShowFirstRun } from "@/lib/ux/onboarding";

export default function FirstRun() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  if (!mounted) return null;
  const prefs = readPrefs();
  if (!shouldShowFirstRun(state, prefs)) return null;

  const steps = firstRunSteps(state, prefs);
  const { done, total } = firstRunProgress(steps);

  return (
    <section aria-label="Getting started" className="mb-6 rounded-xl border border-black/10 p-4 dark:border-white/12">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Getting started <span className="ml-1 text-xs font-normal text-zinc-400">{done}/{total}</span></h2>
        <button type="button" onClick={() => { writePrefs({ firstRun: { ...readPrefs().firstRun, dismissed: true } }); location.reload(); }} className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">Skip</button>
      </div>
      <ul className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={s.done ? "text-emerald-500" : "text-zinc-300 dark:text-zinc-600"}>{s.done ? "✓" : "○"}</span>
            <span className="min-w-0 flex-1">
              {s.done ? <span className="text-zinc-400 line-through">{s.label}</span> : <Link href={s.href} className="hover:underline">{s.label}</Link>}
              {!s.done && <span className="block text-[11px] text-zinc-400">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
