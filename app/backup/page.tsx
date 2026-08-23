"use client";
/** Export / import / backup (LIFEOS-040, Features 12-15). */
import ExportCenter from "@/components/backup/ExportCenter";
import ImportPreview from "@/components/backup/ImportPreview";
import CalendarIntegration from "@/components/calendar/CalendarIntegration";
import SecurityErrorBoundary from "@/components/security/SecurityErrorBoundary";

export default function BackupPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-5"><h1 className="text-2xl font-semibold tracking-tight">Data &amp; connections</h1><p className="mt-0.5 text-sm text-zinc-500">Export everything you own, restore from an archive, and manage where your data comes in from.</p></header>
      <SecurityErrorBoundary surface="backup" offerExport>
        <div className="flex flex-col gap-8">
          <ExportCenter />
          <ImportPreview />
          {/* LIFEOS-067 §38. No new provider dashboard: this page already owns
              "where your data lives and moves", and a calendar connection is
              one more of those. */}
          <CalendarIntegration />
        </div>
      </SecurityErrorBoundary>
    </main>
  );
}
