"use client";

/**
 * Calendar integration settings (LIFEOS-067 §26, §38).
 *
 * ## Boring on purpose
 *
 * Connection state, a calendar list, a last-refresh line, a refresh button, and
 * disconnect. There is no calendar grid here and there will not be one: Conqify
 * already has one place a schedule appears, and it is Today. A second calendar
 * view inside a product built to remove the second calendar would be funny in
 * the wrong way.
 *
 * ## It does not claim a connection it cannot make
 *
 * No provider can currently authorize (see `lib/calendar/provider.ts`), so this
 * panel says so plainly rather than showing a Connect button that fails. §36 is
 * explicit — if live access is unavailable, do not fake it — and a dead button
 * is a small lie that costs a user real time before they find out.
 *
 * ## It is still functional
 *
 * Where linked Events DO exist — restored from an archive, or written by a
 * future build — this shows them, and Disconnect works: it unlinks them and
 * keeps every one as an ordinary local Event, with its notes and project links
 * intact.
 */

import { useMemo, useState } from "react";
import { useStore, unlinkExternalEvent } from "@/lib/mvpStore";
import { isExternallyOwned } from "@/lib/calendar/external";
import {
  IMPORT_WINDOW_DAYS_BACK, IMPORT_WINDOW_DAYS_FORWARD, REQUIRED_SCOPES,
} from "@/lib/calendar/provider";
import { toast } from "@/lib/ux/feedback";

export default function CalendarIntegration() {
  const state = useStore();
  const [confirming, setConfirming] = useState(false);

  // Every provider that actually has linked Events in this store, and how many.
  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of state.events ?? []) {
      if (!isExternallyOwned(e)) continue;
      counts.set(e.externalProvider!, (counts.get(e.externalProvider!) ?? 0) + 1);
    }
    return [...counts.entries()].map(([provider, count]) => ({ provider, count }));
  }, [state.events]);

  function disconnect(provider: string) {
    let unlinked = 0;
    for (const e of state.events ?? []) {
      if (e.externalProvider !== provider) continue;
      if (unlinkExternalEvent(e.id)) unlinked += 1;
    }
    setConfirming(false);
    toast({
      kind: "success",
      message: `Disconnected. ${unlinked} event${unlinked === 1 ? "" : "s"} kept as your own — notes and links intact.`,
    });
  }

  return (
    <section data-calendar-integration className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Calendar</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Bring an external calendar into the same schedule Today already shows — so you keep one
          calendar instead of two.
        </p>
      </header>

      {providers.length === 0 ? (
        <div data-calendar-status="not-connected"
          className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Not connected</p>
          {/* The honest state, and why — not a Connect button that cannot work. */}
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
            Calendar import isn&apos;t available yet. Conqify can read a calendar&apos;s schedule and
            keep it reconciled, but it has no way to ask your calendar for permission — that needs an
            account-linking step this build doesn&apos;t have.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
            When it arrives it will ask for read-only access ({REQUIRED_SCOPES.length === 1 ? "one scope" : `${REQUIRED_SCOPES.length} scopes`}),
            import the last {IMPORT_WINDOW_DAYS_BACK} and next {IMPORT_WINDOW_DAYS_FORWARD} days, and
            never request permission to write to your calendar, read your contacts, or read your mail.
          </p>
        </div>
      ) : (
        providers.map(({ provider, count }) => (
          <div key={provider} data-calendar-status="connected"
            className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{provider}</p>
              <span data-calendar-count className="text-[11px] text-zinc-500">
                {count} event{count === 1 ? "" : "s"} from this calendar
              </span>
            </div>
            <p className="mt-1.5 text-sm text-zinc-500">
              These appear in Today and Week in Review alongside everything else. Their times come
              from the calendar; your notes and project links are yours.
            </p>

            {confirming ? (
              <div className="mt-3 rounded-xl bg-black/[.03] p-3 dark:bg-white/[.04]">
                {/* §17. Disconnect is not deletion, and the copy says exactly
                    what happens — including the part people worry about. */}
                <p className="text-sm text-zinc-700 dark:text-zinc-200">
                  Disconnecting keeps all {count} event{count === 1 ? "" : "s"} — with their notes and
                  links — as your own records. What stops is updating: later changes or deletions in
                  that calendar won&apos;t reach them.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button type="button" data-calendar-disconnect-confirm
                    onClick={() => disconnect(provider)}
                    className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                    Disconnect and keep the events
                  </button>
                  <button type="button" onClick={() => setConfirming(false)}
                    className="text-xs text-zinc-500 underline underline-offset-2">
                    Never mind
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" data-calendar-disconnect onClick={() => setConfirming(true)}
                className="mt-2.5 text-xs text-zinc-500 underline underline-offset-2">
                Disconnect
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}
