"use client";

/**
 * Today's one Return item (LIFEOS-052).
 *
 * `dormancyView` has been a working Return primitive since LIFEOS-039, but it
 * lived at `/insights/dormancy` — a destination inside a menu of eighteen — so
 * in practice nothing ever came back. This surfaces exactly ONE item where the
 * daily loop actually passes.
 *
 * Rules this card keeps:
 *  - **One item, never a list.** A list of quiet records is a backlog.
 *  - **Always says why.** The reason is the fact itself, not a judgment.
 *  - **Pull, not push.** No notification, no badge, no streak, no guilt.
 *  - **Dismissible for the session.** Declining costs one click and is not
 *    recorded as a failure anywhere.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { buildActivityIndex } from "@/lib/insights/activity";
import { returnSuggestion } from "@/lib/planning/today-signals";
import { resolveRecord } from "@/lib/command/records";

export default function TodayReturnCard() {
  const state = useStore();
  const [dismissed, setDismissed] = useState(false);

  const suggestion = useMemo(() => {
    const index = buildActivityIndex(state);
    return returnSuggestion(state, index);
  }, [state]);

  if (!suggestion || dismissed) return null;
  const resolved = resolveRecord(state, suggestion.ref.kind, suggestion.ref.id);

  return (
    <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Worth returning to</h2>
          <p className="mt-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {resolved ? <Link href={resolved.href} className="hover:underline">{suggestion.title}</Link> : suggestion.title}
          </p>
          {/* The reason is stated as a fact. The user can always tell why this appeared. */}
          <p className="mt-0.5 text-xs text-zinc-500">{suggestion.reason}</p>
        </div>
        <button type="button" onClick={() => setDismissed(true)}
          className="shrink-0 rounded-full border border-black/[.12] px-3 py-1 text-[11px] text-zinc-500 dark:border-white/[.15]">
          Not now
        </button>
      </div>
    </section>
  );
}
