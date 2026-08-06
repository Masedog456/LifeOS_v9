"use client";
/** Help Center (LIFEOS-041, Feature 12). */
import HelpDrawer from "@/components/design/HelpDrawer";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";
export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Help</h1><p className="mt-0.5 text-sm text-zinc-500">Guidance for every part of LifeOS, plus keyboard shortcuts and a glossary.</p></header>
      <p className="mb-6 rounded-2xl border border-black/[.06] bg-black/[.015] px-4 py-3 text-[13px] leading-relaxed text-zinc-600 dark:border-white/[.08] dark:bg-white/[.02] dark:text-zinc-300">
        LifeOS is a quiet place to organize your reading, thinking, projects, and decisions — a trusted home for the
        work of living thoughtfully. It&apos;s built to strengthen your own judgment, not replace it: everything here
        helps you think, and nothing decides for you.
      </p>
      <SecurityErrorBoundary surface="help"><HelpDrawer /></SecurityErrorBoundary>
    </main>
  );
}
