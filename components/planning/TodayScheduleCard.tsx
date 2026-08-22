"use client";

/**
 * Today's schedule (LIFEOS-061 §16, §17).
 *
 * Events happening today, chronologically, plus recurring actions whose current
 * occurrence falls today. A pure projection: it creates nothing, completes
 * nothing by being viewed, and stores no cursor.
 *
 * ## What this card refuses to do
 *
 * No urgency language. A past event is de-emphasized and nothing more — there is
 * no "you're late", no "you missed", no red alarm, no streak, no score. A clock
 * that scolds you is worse than no clock.
 *
 * **Events get no checkbox.** An Event happens and then has happened; there is
 * nothing to tick. Only a recurring ACTION shows a control, because only an
 * action has something to finish.
 *
 * ## Recurring occurrences appear once, or not at all
 *
 * The occurrence shown is derived from `(rule, anchor, completions)`. A
 * completed occurrence is not re-derived, so it does not come back on reload —
 * and there is no future spam, because only the CURRENT occurrence is asked for.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { completeOccurrence, completionIndex, occurrenceFor, useStore } from "@/lib/mvpStore";
import { eventsOnDay, hasStarted, nextEventToday, nowLocalTime } from "@/lib/time/events";
import { formatLocalTime } from "@/lib/time/localtime";
import { describeRule, readRule } from "@/lib/time/recurrence";
import { todayKey } from "@/lib/reviews/dates";
import { toast } from "@/lib/ux/feedback";
import type { NextAction } from "@/types/mvp";

export default function TodayScheduleCard() {
  const state = useStore();
  const today = todayKey();
  // Read once per render rather than per row, so every row agrees about "now".
  const [now] = useState(() => nowLocalTime());

  const view = useMemo(() => {
    const occurrences = eventsOnDay(state, today);
    // Built ONCE. Resolving each action against the whole completion list would
    // be a global historical scan per source (§15).
    const index = completionIndex(state);
    const dueToday: { action: NextAction; occurrence: string }[] = [];
    for (const action of state.nextActions ?? []) {
      if (!readRule(action.recurrence)) continue;
      if (action.status === "completed" || action.status === "cancelled") continue;
      const occurrence = occurrenceFor(action, today, index);
      if (occurrence === today) dueToday.push({ action, occurrence });
    }
    return { occurrences, dueToday, next: nextEventToday(occurrences, now) };
  }, [state, today, now]);

  if (view.occurrences.length === 0 && view.dueToday.length === 0) return null;

  return (
    <section data-today-schedule className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Today&apos;s schedule</h2>
        {view.next && (
          <span data-next-event className="text-[11px] text-zinc-500">
            Next: {view.next.event.title}
            {view.next.startTime ? ` · ${formatLocalTime(view.next.startTime)}` : ""}
          </span>
        )}
      </div>

      {view.occurrences.length > 0 && (
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {view.occurrences.map((o) => {
            const past = hasStarted(o, now);
            return (
              <li key={`${o.event.id}:${o.date}`} data-event
                className={`flex items-baseline justify-between gap-3 py-1 ${past ? "opacity-55" : ""}`}>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">
                  {o.event.title}
                  {/* Keyed on the RULE, not on `derived`: on its anchor day a recurring
                      event is the row itself rather than a derived instance, and hiding
                      the schedule there would tell the user it repeats on every day
                      except the first one they see it. */}
                  {o.event.recurrence && <span className="ml-1.5 text-[11px] text-zinc-400">{describeRule(o.event.recurrence)}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {o.allDay || !o.startTime ? "All day" : formatLocalTime(o.startTime)}
                  {o.endTime ? `–${formatLocalTime(o.endTime)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {view.dueToday.length > 0 && (
        <>
          <h3 className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Repeating today</h3>
          <ul className="mt-1 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {view.dueToday.map(({ action, occurrence }) => (
              <li key={action.id} data-recurring-today className="flex items-center justify-between gap-3 py-1">
                <Link href={`/actions/${action.id}`} className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {action.title}
                  <span className="ml-1.5 text-[11px] text-zinc-400">{describeRule(action.recurrence)}</span>
                </Link>
                {/* Only an ACTION gets this control. Events never do. */}
                <button
                  type="button"
                  data-complete-occurrence
                  onClick={() => {
                    if (completeOccurrence(action.id, occurrence)) {
                      toast({ kind: "success", message: "Done for today. It'll come back next time." });
                    }
                  }}
                  className="shrink-0 rounded-full border border-black/[.12] px-3 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"
                >
                  Mark done
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
