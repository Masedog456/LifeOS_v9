"use client";

/**
 * The last few things you told Conqify, and what became of them (LIFEOS-095).
 *
 * ## Why this exists
 *
 * The audit confirmed it by measuring: after confirming a real capture, the
 * page was byte-for-byte the empty composer again, the toast said "Saved 1
 * thing", named nothing, and vanished within 1.2 seconds. A capture product
 * whose front door keeps no trace of the last thing you captured cannot be
 * trusted with the next one.
 *
 * ## One row per captured moment (§18)
 *
 * A sentence that produced three records is ONE row with three outcomes, not
 * four cards. The row is anchored on the `Capture` — the thing the person
 * actually did — and the records hang off it.
 *
 * ## What it shows, and what it refuses to
 *
 * The person's own sentence (§17), and the product word for what it became
 * (§16). Never a candidate kind, never a processing status, never a confidence
 * — `captureHomeStrings` is swept for that vocabulary by assertion 95.34.
 *
 * ## Nothing new is stored
 *
 * `capture.linkedEntityRefs` is written by `commitCapture` today, in one
 * history event. This is a read (§34, §38).
 */

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { recentCaptures } from "@/lib/capture/home";

export default function RecentCaptures() {
  const state = useStore();
  const rows = useMemo(() => recentCaptures(state), [state]);

  // §35. A returning user with nothing recent gets the composer and nothing
  // else. An empty panel saying "no recent captures" is decoration that makes
  // a calm page look unfinished.
  if (rows.length === 0) return null;

  return (
    <section data-recent-captures aria-label="Recent captures">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Recently</h2>
      <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
        {rows.map((r) => (
          <li key={r.id} data-recent-capture={r.id} className="py-2">
            {/* §17. What you said, first and always — never replaced by what
                Conqify made of it. If the interpretation was wrong, this is
                the sentence you go back to. */}
            <p className="truncate text-sm text-zinc-800 dark:text-zinc-100" title={r.text}>{r.text}</p>

            {r.unfiled ? (
              // Said plainly rather than dressed as a status. It is not a
              // failure and it is not a queue item to feel behind on.
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Not filed yet ·{" "}
                <Link href="/process" className="underline underline-offset-2">Open the inbox</Link>
              </p>
            ) : r.outcomes.length === 0 ? (
              /* Filed, through a path this surface has no reader for — nine of
                 `convertCapture`'s targets are domains Home does not render.
                 It says the one thing it can verify and offers no link it
                 cannot honour. */
              <p className="mt-0.5 text-[11px] text-zinc-400">Filed</p>
            ) : (
              <ul className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {r.outcomes.map((o) => (
                  <li key={`${o.kind}:${o.id}`} data-recent-outcome={o.kind} className="text-[11px] text-zinc-500">
                    <span className="text-zinc-400">{o.label} · </span>
                    <Link href={o.href} className="underline-offset-2 hover:underline">{o.title}</Link>
                    {o.detail && <span className="text-zinc-400"> · {o.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
