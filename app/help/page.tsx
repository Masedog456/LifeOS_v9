"use client";
/** Help Center (LIFEOS-041, Feature 12). */
import HelpDrawer from "@/components/design/HelpDrawer";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";
export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Help</h1><p className="mt-0.5 text-sm text-zinc-500">Guidance for every part of LifeOS, plus keyboard shortcuts and a glossary.</p></header>
      <SecurityErrorBoundary surface="help"><HelpDrawer /></SecurityErrorBoundary>
    </main>
  );
}
