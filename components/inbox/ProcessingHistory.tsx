"use client";

/**
 * Processing history (LIFEOS-035, Feature 12). Renders a capture's compact,
 * append-only history — action, time, status transition, and targets. No full
 * text is ever shown here (it isn't stored).
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityRef } from "@/lib/entities/entity";
import { captureHistory, ACTION_LABEL } from "@/lib/inbox/history";
import type { Capture } from "@/types/mvp";

export default function ProcessingHistory({ capture }: { capture: Capture }) {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const events = captureHistory(capture);
  if (events.length === 0) return <p className="text-xs text-zinc-500">No processing history yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2">
          <span className="mt-0.5 w-24 shrink-0 text-[10px] text-zinc-400">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span className="min-w-0">
            <span className="text-zinc-700 dark:text-zinc-200">{ACTION_LABEL[e.action] ?? e.action}</span>
            {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && <span className="text-zinc-400"> · {e.fromStatus} → {e.toStatus}</span>}
            {e.detail && <span className="text-zinc-400"> · {e.detail}</span>}
            {(e.targets ?? []).length > 0 && (
              <span className="ml-1 inline-flex flex-wrap gap-1">
                {e.targets!.map((t) => { const r = entityRef(ctx, t.kind, t.id); return r.exists && r.href !== "/" ? <Link key={`${t.kind}:${t.id}`} href={r.href} className="text-sky-600 underline-offset-4 hover:underline dark:text-sky-400">{r.title}</Link> : null; })}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
