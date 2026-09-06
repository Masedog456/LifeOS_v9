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

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useStore, getSnapshot, deleteAction, deleteNote, deleteEvent,
  unlinkCaptureRef, restoreCapture,
} from "@/lib/mvpStore";
import { toast } from "@/lib/ux/feedback";
import { MAX_RECENT_CAPTURES, recentCaptures } from "@/lib/capture/home";
import { correctableOutcome, createdBy, keptRefs } from "@/lib/capture/corrections";
import CorrectionSheet from "@/components/capture/CorrectionSheet";

export default function RecentCaptures({ exclude }: {
  /**
   * A capture the composer is already showing in full, or null (§18).
   *
   * One more is fetched than is shown, so omitting a row does not shrink the
   * list — the fourth thing you said stays visible while the newest one is
   * being confirmed above.
   */
  exclude?: string | null;
} = {}) {
  const state = useStore();
  const rows = useMemo(
    () => recentCaptures(state, MAX_RECENT_CAPTURES + 1)
      .filter((r) => r.id !== exclude)
      .slice(0, MAX_RECENT_CAPTURES),
    [state, exclude],
  );

  /** Which outcome's correction sheet is open, as `captureId:kind:id`. */
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * LIFEOS-097 §19, §20. Undo one record, and only if this capture made it.
   *
   * Per outcome rather than per capture: a sentence that produced three records
   * gets three undos, so "remove the wait, keep the two actions" is possible
   * without rebuilding anything. `createdBy` reads the record's own
   * `sourceCaptureId`, which is what stops this deleting a record the
   * interpreter merely MATCHED — an existing action a completion sentence found
   * is somebody's real work, not this capture's to remove.
   */
  function undoOne(captureId: string, kind: string, id: string, title: string) {
    const fresh = getSnapshot();
    if (!createdBy(fresh, { kind, id } as Parameters<typeof createdBy>[1], captureId)) {
      toast({ kind: "info", message: `“${title}” wasn't created by this capture, so it stays.` });
      return;
    }
    if (kind === "action") deleteAction(id);
    else if (kind === "note") deleteNote(id);
    else if (kind === "event") deleteEvent(id);
    else { toast({ kind: "info", message: `“${title}” can only be removed from its own page.` }); return; }

    unlinkCaptureRef(captureId, { kind, id } as Parameters<typeof unlinkCaptureRef>[1]);
    // §3. The sentence goes back to the inbox rather than disappearing with the
    // record — but only once nothing this capture made is left, or a capture
    // with two records would return to the inbox while one still stood.
    if (keptRefs(getSnapshot(), captureId).length === 0) restoreCapture(captureId);
    toast({ kind: "success", message: `Removed “${title}”. Your words are still saved.` });
  }

  // §35. A returning user with nothing recent gets the composer and nothing
  // else. An empty panel saying "no recent captures" is decoration that makes
  // a calm page look unfinished.
  if (rows.length === 0) return null;

  return (
    <section data-recent-captures aria-label="Recent captures">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Recently</h2>
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
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Not filed yet ·{" "}
                <Link href="/process" className="underline underline-offset-2">Open the inbox</Link>
              </p>
            ) : r.outcomes.length === 0 ? (
              /* Filed, through a path this surface has no reader for — nine of
                 `convertCapture`'s targets are domains Home does not render.
                 It says the one thing it can verify and offers no link it
                 cannot honour. */
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Filed</p>
            ) : (
              <ul className="mt-0.5 flex flex-col gap-1">
                {r.outcomes.map((o) => {
                  const key = `${r.id}:${o.kind}:${o.id}`;
                  const correctable = correctableOutcome(state, { kind: o.kind, id: o.id } as Parameters<typeof correctableOutcome>[1],
                    { createdByCapture: createdBy(state, { kind: o.kind, id: o.id } as Parameters<typeof createdBy>[1], r.id) });
                  return (
                    <li key={`${o.kind}:${o.id}`} data-recent-outcome={o.kind} className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                          <span className="text-zinc-500 dark:text-zinc-400">{o.label} · </span>
                          <Link href={o.href} className="underline-offset-2 hover:underline">{o.title}</Link>
                          {o.detail && <span className="text-zinc-500 dark:text-zinc-400"> · {o.detail}</span>}
                        </span>
                        {/*
                          §5. Two words, not ten field buttons. Edit opens the
                          sheet; Undo appears only for a record this capture
                          actually created, so a matched record shows no control
                          that could remove it.
                        */}
                        {correctable && (
                          <button type="button" data-recent-edit={o.id}
                            onClick={() => setEditing(editing === key ? null : key)}
                            className="text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-200">
                            {editing === key ? "Close" : "Edit"}
                          </button>
                        )}
                        {correctable?.createdByCapture && (
                          <button type="button" data-recent-undo={o.id}
                            onClick={() => { setEditing(null); undoOne(r.id, o.kind, o.id, o.title); }}
                            className="text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-rose-500">
                            Undo
                          </button>
                        )}
                      </span>
                      {editing === key && correctable && (
                        <CorrectionSheet source={r.text} outcome={correctable}
                          onClose={() => setEditing(null)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
