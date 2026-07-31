"use client";
/** Diagnostics Center (LIFEOS-040, Feature 11). */
import DiagnosticsCenter from "@/components/security/DiagnosticsCenter";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1><p className="mt-0.5 text-sm text-zinc-500">A sanitized view of versions, sync, storage, and connectivity. No record contents.</p></header>
      <SecurityErrorBoundary surface="diagnostics"><DiagnosticsCenter /></SecurityErrorBoundary>
    </main>
  );
}
