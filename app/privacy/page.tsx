"use client";
/** Privacy Center (LIFEOS-040, Feature 27). */
import PrivacyCenter from "@/components/privacy/PrivacyCenter";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Privacy</h1><p className="mt-0.5 text-sm text-zinc-500">What LifeOS stores, where it lives, and the controls you have.</p></header>
      <SecurityErrorBoundary surface="privacy"><PrivacyCenter /></SecurityErrorBoundary>
    </main>
  );
}
