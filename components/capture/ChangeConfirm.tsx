"use client";

/**
 * The change-confirmation panel (LIFEOS-065 §23, §27, §28).
 *
 * Capture recognises rescheduling language and switches into THIS state before
 * anything is written. That is the whole safety design: ordinary capture creates
 * on confirm, and so does this — but what it confirms is a change to something
 * that already exists, shown as before → after in the user's own vocabulary.
 *
 * ## No patch objects on screen
 *
 * "Dentist · Tuesday 2:30 PM → Friday 3:00 PM". Not `{date: "2026-03-06"}`.
 * The user is agreeing to a change to their week, not to a field write.
 *
 * ## Ambiguity is a question, never a coin flip
 *
 * Two records named Dentist means two rows and no default selection. Picking
 * the newer one silently is the single failure mode this sprint exists to
 * prevent, so there is no code path here that can.
 */

import { useState } from "react";
import { formatDayKey } from "@/lib/reviews/dates";
import { formatLocalTime } from "@/lib/time/localtime";
import {
  buildProposal, type EditTarget, type TemporalEditIntent,
} from "@/lib/capture/temporal-edit";

/** How the panel describes each operation, in product words. */
const OPERATION_LABEL: Record<string, string> = {
  move_date: "Change date",
  change_time: "Change time",
  clear_time: "Remove the time",
  defer: "Hide until later",
  cancel_event: "Remove event",
  change_recurrence: "Change schedule",
  stop_recurrence: "Stop repeating",
};

function when(date?: string, time?: string, recurrence?: string): string {
  const bits = [
    recurrence,
    date ? formatDayKey(date) : undefined,
    time ? formatLocalTime(time) : undefined,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "No date";
}

export interface ChangeConfirmProps {
  intents: TemporalEditIntent[];
  /** Applies one confirmed change. Returns what to tell the user. */
  onApply: (intent: TemporalEditIntent, target: EditTarget, destructive: boolean) => void;
  onDismiss: () => void;
}

export default function ChangeConfirm({ intents, onApply, onDismiss }: ChangeConfirmProps) {
  // Which record each ambiguous intent is aimed at. Deliberately starts empty:
  // an ambiguous edit has no default, and `undefined` is what disables Confirm.
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [done, setDone] = useState<Record<number, string>>({});

  return (
    <div data-change-confirm className="mt-5 flex flex-col gap-3">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {intents.length === 1 ? "This looks like a change:" : `This looks like ${intents.length} changes:`}
      </p>

      {intents.map((intent, i) => {
        const target = intent.authority === "unambiguous"
          ? intent.candidateMatches[0]
          : intent.candidateMatches.find((c) => c.id === chosen[i]);
        const proposal = target ? buildProposal(intent, target) : null;
        const refusal = proposal?.refusal ?? (target ? undefined : intent.refusal);
        const destructive = intent.operation === "cancel_event";
        const applied = done[i];

        return (
          <div key={i} data-change-proposal={intent.operation}
            className="rounded-2xl border border-black/[.08] p-3 dark:border-white/[.10]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {OPERATION_LABEL[intent.operation] ?? "Change"}
              </span>
              {destructive && (
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                  Permanent
                </span>
              )}
            </div>

            {applied ? (
              <p data-change-applied className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-200">{applied}</p>
            ) : (
              <>
                {/* NO MATCH — never a fallback record, never a new one (§28). */}
                {intent.authority === "no_match" && (
                  <p data-change-unresolved className="mt-1.5 text-sm text-amber-700 dark:text-amber-400">
                    {intent.refusal?.message ?? "Couldn't tell which record you want to change."}
                  </p>
                )}

                {/* AMBIGUOUS — the user picks. Nothing is preselected (§8). */}
                {intent.authority === "ambiguous" && (
                  <div className="mt-1.5">
                    <p data-change-ambiguous className="text-[11px] text-zinc-500">
                      {intent.candidateMatches.length} records match “{intent.targetQuery}”. Which one?
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {intent.candidateMatches.map((c) => (
                        <li key={`${c.kind}:${c.id}`}>
                          <button
                            type="button"
                            data-change-option={c.id}
                            aria-pressed={chosen[i] === c.id}
                            onClick={() => setChosen((p) => ({ ...p, [i]: c.id }))}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-sm ${
                              chosen[i] === c.id
                                ? "border-zinc-900 dark:border-zinc-100"
                                : "border-black/[.10] dark:border-white/[.12]"
                            }`}
                          >
                            {c.title}
                            <span className="ml-1.5 text-[11px] text-zinc-500">
                              {when(c.currentDate, c.currentTime, c.recurrence ? "Repeats" : undefined)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* The change itself — before → after, in plain words (§23). */}
                {proposal && (
                  <div className="mt-1.5">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">{proposal.target.title}</p>
                    <p data-change-summary className="mt-0.5 text-[11px] text-zinc-500">
                      {intent.operation === "cancel_event" || intent.operation === "defer"
                        ? proposal.summary
                        : (
                          <>
                            {when(proposal.before.date, proposal.before.time, proposal.before.recurrence)}
                            <span aria-hidden className="mx-1.5">→</span>
                            <span className="font-medium text-zinc-800 dark:text-zinc-100">
                              {when(proposal.after.date, proposal.after.time, proposal.after.recurrence)}
                            </span>
                          </>
                        )}
                    </p>
                  </div>
                )}

                {refusal && (
                  <p data-change-refusal className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    {refusal.message}
                  </p>
                )}

                {/* Confirm exists only when there is exactly one record to change
                    AND nothing refuses it — except a deletion, where the button
                    itself carries the consequence (§13). */}
                {proposal && (!refusal || destructive) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-change-confirm-btn
                      onClick={() => {
                        onApply(intent, proposal.target, destructive);
                        setDone((p) => ({ ...p, [i]: `Updated “${proposal.target.title}”.` }));
                      }}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                        destructive
                          ? "bg-amber-700 text-white"
                          : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      }`}
                    >
                      {destructive ? "Delete it" : "Confirm change"}
                    </button>
                    {intent.candidateMatches.length > 1 && (
                      <button type="button" onClick={() => setChosen((p) => ({ ...p, [i]: "" }))}
                        className="text-xs text-zinc-500 underline underline-offset-2">
                        Choose another
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button type="button" data-change-dismiss onClick={onDismiss}
          className="text-xs text-zinc-500 underline underline-offset-2">
          Never mind — keep this as a new capture instead
        </button>
      </div>
    </div>
  );
}
