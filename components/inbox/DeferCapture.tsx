"use client";

/**
 * Defer control (LIFEOS-035, Feature 9). Tomorrow / next week / someday / a
 * specific local date. Deferred captures leave the inbox and return on their
 * date; "someday" stays until restored. No notifications, no recurrence.
 */

import { useState } from "react";
import { deferCapture } from "@/lib/mvpStore";
import { toast } from "@/lib/ux/feedback";
import { todayKey, addDays } from "@/lib/reviews/dates";
import type { Capture } from "@/types/mvp";

export default function DeferCapture({ capture, onDone }: { capture: Capture; onDone?: () => void }) {
  const [date, setDate] = useState(addDays(todayKey(), 1));
  const go = (opt: Parameters<typeof deferCapture>[1], label: string) => { deferCapture(capture.id, opt); toast({ kind: "info", message: `Deferred: ${label}` }); onDone?.(); };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">Send this out of the inbox until later. It returns automatically on its date.</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => go("tomorrow", "tomorrow")} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Tomorrow</button>
        <button type="button" onClick={() => go("next_week", "next week")} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Next week</button>
        <button type="button" onClick={() => go("someday", "someday")} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]">Someday</button>
      </div>
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Defer until date" className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/12" />
        <button type="button" onClick={() => go({ date }, date)} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Defer to date</button>
      </div>
    </div>
  );
}
