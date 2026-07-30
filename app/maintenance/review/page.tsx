import { Suspense } from "react";
import MaintenanceQueue from "@/components/maintenance/MaintenanceQueue";
export default function ReviewQueuePage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>}>
      <MaintenanceQueue />
    </Suspense>
  );
}
