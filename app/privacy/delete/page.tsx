"use client";
/** Account deletion (LIFEOS-040, Feature 16). */
import AccountDeletion from "@/components/privacy/AccountDeletion";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function DeletePage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Delete account</h1><p className="mt-0.5 text-sm text-zinc-500">Understand the scope, export first, then confirm.</p></header>
      <SecurityErrorBoundary surface="account-deletion"><AccountDeletion /></SecurityErrorBoundary>
    </main>
  );
}
