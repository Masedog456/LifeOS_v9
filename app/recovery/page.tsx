"use client";
/** Recovery Center (LIFEOS-040, Feature 18). */
import RecoveryCenter from "@/components/backup/RecoveryCenter";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function RecoveryPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Recovery</h1><p className="mt-0.5 text-sm text-zinc-500">Recently discarded, archived, or conflicting items — each with a preview of impact.</p></header>
      <SecurityErrorBoundary surface="recovery"><RecoveryCenter /></SecurityErrorBoundary>
    </main>
  );
}
